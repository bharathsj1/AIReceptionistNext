import json
import logging
import smtplib
import ssl
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Dict

import azure.functions as func
import httpx
import stripe
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from function_app import app
from services.receptionist_usage_service import build_receptionist_usage_summary
from shared.config import get_required_setting, get_setting, get_smtp_settings
from shared.db import SessionLocal, Subscription, Payment, AITool, Client, User, ClientUser
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


PLAN_AMOUNTS = {
    "bronze": 50000,  # $500.00
    "silver": 60000,  # $600.00
    "gold": 70000,    # $700.00
}
TOOL_SLUGS = ["ai_receptionist", "email_manager", "social_media_manager"]
PLAN_TOOL_ACCESS = {
    "bronze": ["ai_receptionist"],
    "silver": ["ai_receptionist", "email_manager"],
    "gold": TOOL_SLUGS,
    "custom": TOOL_SLUGS,
}
DEFAULT_TOOL = "ai_receptionist"
PLAN_AMOUNTS_BY_TOOL = {
    DEFAULT_TOOL: PLAN_AMOUNTS,
    "email_manager": PLAN_AMOUNTS,
    "social_media_manager": PLAN_AMOUNTS,
}
SUPPORTED_CUSTOM_CURRENCIES = {"usd", "cad", "gbp"}


def _normalize_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def _resolve_subscription_lookup_context(db: Session, email: str) -> tuple[list[str], Client | None]:
    normalized = _normalize_email(email)
    if not normalized:
        return [], None

    emails = {normalized}
    client = (
        db.query(Client)
        .filter(sa_func.lower(sa_func.trim(Client.email)) == normalized)
        .order_by(Client.id.asc())
        .first()
    )
    user = (
        db.query(User)
        .filter(sa_func.lower(sa_func.trim(User.email)) == normalized)
        .order_by(User.id.asc())
        .first()
    )
    client_user = (
        db.query(ClientUser)
        .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == normalized)
        .order_by(ClientUser.id.asc())
        .first()
    )

    if not client and client_user:
        client = db.query(Client).filter(Client.id == client_user.client_id).one_or_none()
    if not client and user:
        client = db.query(Client).filter(Client.user_id == user.id).order_by(Client.id.asc()).first()
    if client and not user and client.user_id:
        user = db.query(User).filter(User.id == client.user_id).one_or_none()

    if client and client.email:
        emails.add(_normalize_email(client.email))
    if user and user.email:
        emails.add(_normalize_email(user.email))
    if client:
        for row in db.query(ClientUser.email).filter(ClientUser.client_id == client.id).all():
            member_email = _normalize_email(row[0] if row else "")
            if member_email:
                emails.add(member_email)

    return sorted(email for email in emails if email), client


def _resolve_subscription_lookup_emails(db: Session, email: str) -> list[str]:
    emails, _ = _resolve_subscription_lookup_context(db, email)
    return emails


def _get_stripe_client() -> stripe.StripeClient:
    secret_key = get_required_setting("STRIPE_SECRET_KEY")
    stripe.api_key = secret_key
    return stripe

def _get_plan_amount(plan_id: str, tool: str) -> int | None:
    """
    Resolve the plan amount for a given tool. Falls back to receptionist pricing when
    the tool is unknown so legacy flows continue to work.
    """
    tool_key = (tool or DEFAULT_TOOL).lower()
    plan_map = PLAN_AMOUNTS_BY_TOOL.get(tool_key) or PLAN_AMOUNTS_BY_TOOL.get(DEFAULT_TOOL, {})
    return plan_map.get(plan_id)


def _tools_for_plan(plan_id: str, default_tool: str) -> list[str]:
    plan_key = (plan_id or "").lower()
    base_tool = (default_tool or DEFAULT_TOOL).lower()
    allowed = PLAN_TOOL_ACCESS.get(plan_key)
    if allowed:
        return allowed
    return [base_tool]


def _get_or_create_customer(stripe_client, email: str) -> str:
    """Find existing customer by email or create a new one."""
    try:
        existing = stripe_client.Customer.search(query=f"email:'{email}'", limit=1)
        if existing and existing.data:
            return existing.data[0].id
    except Exception:  # noqa: BLE001
        # If search not available in restricted keys, fall back to create
        pass

    customer = stripe_client.Customer.create(email=email)
    return customer.id


def _normalize_custom_currency(value) -> str:
    currency = str(value or "usd").strip().lower()
    if currency in SUPPORTED_CUSTOM_CURRENCIES:
        return currency
    return "usd"


def _parse_custom_amount_to_cents(value) -> int | None:
    if value is None:
        return None
    normalized = str(value).strip().replace(",", "")
    if not normalized:
        return None
    try:
        amount = Decimal(normalized)
    except (InvalidOperation, ValueError, TypeError):
        return None
    if amount < Decimal("1"):
        return None
    cents = int((amount * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if cents < 100:
        return None
    return cents


def _get_or_create_tool(db: Session, tool_slug: str) -> AITool:
    slug = (tool_slug or DEFAULT_TOOL).lower()
    tool = db.query(AITool).filter(AITool.slug == slug).one_or_none()
    if tool:
        return tool
    tool = AITool(slug=slug, name=slug.replace("_", " ").title())
    db.add(tool)
    db.flush()
    return tool


def _get_or_create_price(
    stripe_client,
    plan_id: str,
    amount: int,
    tool: str,
    custom_amount_cents: int | None = None,
    currency: str = "usd",
) -> str:
    """
    Find or create a monthly price for the plan using lookup_key.
    """
    tool_key = (tool or DEFAULT_TOOL).lower()
    currency_key = _normalize_custom_currency(currency)
    if custom_amount_cents is not None:
        lookup_key = f"{tool_key}_{plan_id}_custom_{custom_amount_cents}_{currency_key}_monthly"
    else:
        lookup_key = f"{tool_key}_{plan_id}_monthly"
    try:
        prices = stripe_client.Price.list(lookup_keys=[lookup_key], active=True, limit=1)
        if prices and prices.data:
            return prices.data[0].id
    except Exception:
        # fallback to create
        pass

    if custom_amount_cents is not None:
        product_name = (
            f"{tool_key.replace('_', ' ').title()} {plan_id.title()} Custom "
            f"({custom_amount_cents / 100:.2f} {currency_key.upper()})"
        )
    else:
        product_name = f"{tool_key.replace('_', ' ').title()} {plan_id.title()}"
    product = stripe_client.Product.create(name=product_name)
    price = stripe_client.Price.create(
        unit_amount=amount,
        currency=currency_key,
        recurring={"interval": "month"},
        product=product.id,
        lookup_key=lookup_key,
    )
    return price.id


def _convert_timestamp_to_datetime(timestamp: int | None) -> datetime | None:
    """Safely convert Unix timestamp to datetime, handling None and invalid values."""
    if timestamp is None or timestamp == 0:
        return None
    try:
        return datetime.utcfromtimestamp(timestamp)
    except (ValueError, OSError, OverflowError) as e:
        logger.warning("Failed to convert timestamp %s to datetime: %s", timestamp, e)
        return None


def _get_invoice_field(invoice_obj, field: str):
    if invoice_obj is None:
        return None
    if isinstance(invoice_obj, dict):
        return invoice_obj.get(field)
    return getattr(invoice_obj, field, None)


def _get_event_type(event) -> str | None:
    if isinstance(event, dict):
        return event.get("type")
    return getattr(event, "type", None)


def _get_event_object(event):
    if isinstance(event, dict):
        return (event.get("data") or {}).get("object")
    data = getattr(event, "data", None)
    return getattr(data, "object", None)


def _resolve_invoice_email(stripe_client, invoice_obj) -> str | None:
    email = _get_invoice_field(invoice_obj, "customer_email") or _get_invoice_field(invoice_obj, "email")
    if email:
        return email
    customer_id = _get_invoice_field(invoice_obj, "customer")
    if not customer_id:
        return None
    try:
        customer = stripe_client.Customer.retrieve(customer_id)
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Failed to retrieve Stripe customer %s for invoice email: %s", customer_id, exc)
        return None
    if isinstance(customer, dict):
        return customer.get("email")
    return getattr(customer, "email", None)


def _upsert_payment_from_invoice(
    db: Session,
    *,
    stripe_subscription_id: str | None,
    invoice_id: str | None,
    payment_intent_id: str | None,
    status: str,
    amount: int,
    currency: str,
) -> Payment | None:
    if not stripe_subscription_id:
        return None
    subscription = (
        db.query(Subscription)
        .filter(Subscription.stripe_subscription_id == stripe_subscription_id)
        .one_or_none()
    )
    if not subscription:
        return None

    payment = None
    if invoice_id:
        payment = db.query(Payment).filter(Payment.stripe_invoice_id == invoice_id).one_or_none()
    if not payment and payment_intent_id:
        payment = (
            db.query(Payment)
            .filter(Payment.stripe_payment_intent_id == payment_intent_id)
            .one_or_none()
        )
    if payment:
        payment.status = status
        payment.amount = amount
        payment.currency = currency
    else:
        payment = Payment(
            subscription_id=subscription.id,
            stripe_invoice_id=invoice_id,
            stripe_payment_intent_id=payment_intent_id,
            amount=amount,
            currency=currency,
            status=status,
        )
        db.add(payment)
    db.commit()
    return payment


def _is_invoice_paid(invoice_obj) -> bool:
    paid = _get_invoice_field(invoice_obj, "paid")
    if paid is not None:
        return bool(paid)
    status = _get_invoice_field(invoice_obj, "status")
    return str(status or "").lower() == "paid"


def _payment_intent_succeeded(stripe_client, invoice_obj) -> bool:
    payment_intent = _get_invoice_field(invoice_obj, "payment_intent")
    if not payment_intent:
        return False
    if isinstance(payment_intent, dict):
        status = payment_intent.get("status")
    else:
        try:
            payment_intent = stripe_client.PaymentIntent.retrieve(payment_intent)
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Failed to retrieve Stripe payment intent %s: %s", payment_intent, exc)
            return False
        if isinstance(payment_intent, dict):
            status = payment_intent.get("status")
        else:
            status = getattr(payment_intent, "status", None)
    return str(status or "").lower() == "succeeded"


def _download_invoice_pdf(invoice_obj) -> bytes | None:
    invoice_pdf_url = _get_invoice_field(invoice_obj, "invoice_pdf")
    if not invoice_pdf_url:
        logger.warning("Stripe invoice is missing invoice_pdf URL.")
        return None
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            resp = client.get(invoice_pdf_url)
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Failed to download invoice PDF: %s", exc)
        return None
    if resp.status_code >= 300:
        logger.warning(
            "Failed to download invoice PDF (%s) at %s: %s",
            resp.status_code,
            resp.url,
            resp.text,
        )
        return None
    return resp.content


def _send_invoice_email(email: str, invoice_id: str, invoice_number: str | None, pdf_bytes: bytes) -> bool:
    """
    Send an invoice PDF as an email attachment to the customer.
    Returns True on success, False on failure.
    """
    smtp = get_smtp_settings()
    if not smtp.get("host") or not smtp.get("username") or not smtp.get("password"):
        logger.warning("SMTP not configured; skipping invoice email.")
        return False

    identifier = (invoice_number or invoice_id or "invoice").replace(" ", "_")
    subject = f"Your AI Receptionist invoice {identifier}".strip()
    body = (
        "Hi,\n\n"
        "Thanks for your payment. Your invoice is attached as a PDF.\n\n"
        "If you have any questions, reply to this email.\n\n"
        "Thanks,\nAI Receptionist Team\n"
    )

    message = MIMEMultipart()
    message["From"] = smtp["from_email"]
    message["To"] = email
    message["Subject"] = subject
    message.attach(MIMEText(body, "plain"))

    attachment = MIMEBase("application", "pdf")
    attachment.set_payload(pdf_bytes)
    encoders.encode_base64(attachment)
    filename = f"invoice-{identifier}.pdf"
    attachment.add_header("Content-Disposition", f'attachment; filename="{filename}"')
    message.attach(attachment)

    host = smtp["host"]
    use_tls = smtp.get("use_tls", True)
    use_ssl = smtp.get("use_ssl", False)
    port = smtp.get("port")

    if port is None:
        port = 465 if use_ssl else (587 if use_tls else 25)

    def _send():
        if use_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context) as server:
                code, capabilities = server.ehlo()
                logger.debug("SMTP EHLO (SSL) response code: %s, capabilities: %s", code, capabilities)
                if smtp.get("username") and not server.has_extn("auth"):
                    raise RuntimeError("SMTP AUTH not supported on this endpoint/port.")
                if smtp.get("username"):
                    server.login(smtp["username"], smtp["password"])
                server.sendmail(smtp["from_email"], [email], message.as_string())
        else:
            context = ssl.create_default_context() if use_tls else None
            with smtplib.SMTP(host, port) as server:
                code, capabilities = server.ehlo()
                logger.debug("SMTP EHLO response code: %s, capabilities: %s", code, capabilities)
                if use_tls:
                    server.starttls(context=context)
                    code_tls, capabilities_tls = server.ehlo()
                    logger.debug("SMTP EHLO after STARTTLS code: %s, capabilities: %s", code_tls, capabilities_tls)
                if smtp.get("username") and not server.has_extn("auth"):
                    raise RuntimeError("SMTP AUTH not supported on this endpoint/port.")
                if smtp.get("username"):
                    server.login(smtp["username"], smtp["password"])
                server.sendmail(smtp["from_email"], [email], message.as_string())

    try:
        _send()
        return True
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("First attempt to send invoice email failed: %s", exc)
        try:
            _send()
            return True
        except Exception as exc2:  # pylint: disable=broad-except
            logger.error("Failed to send invoice email after retry: %s", exc2)
            return False


def _maybe_send_invoice_email(
    db: Session,
    stripe_client,
    *,
    email: str,
    invoice_id: str | None,
    payment_intent_id: str | None,
) -> None:
    if not email or not invoice_id:
        if not email:
            logger.warning("Invoice email skipped: missing customer email for invoice %s.", invoice_id)
        return

    payment = None
    if invoice_id:
        payment = db.query(Payment).filter(Payment.stripe_invoice_id == invoice_id).one_or_none()
    if not payment and payment_intent_id:
        payment = (
            db.query(Payment)
            .filter(Payment.stripe_payment_intent_id == payment_intent_id)
            .one_or_none()
        )
    if payment and payment.invoice_sent_at:
        return

    try:
        invoice = stripe_client.Invoice.retrieve(invoice_id)
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Failed to retrieve Stripe invoice %s: %s", invoice_id, exc)
        return

    if not _is_invoice_paid(invoice) and not _payment_intent_succeeded(stripe_client, invoice):
        logger.info("Stripe invoice %s not paid yet; skipping email.", invoice_id)
        return

    pdf_bytes = _download_invoice_pdf(invoice)
    if not pdf_bytes:
        return

    invoice_number = _get_invoice_field(invoice, "number")
    if _send_invoice_email(email, invoice_id, invoice_number, pdf_bytes):
        if payment:
            payment.invoice_sent_at = datetime.utcnow()
            db.commit()
        else:
            logger.info("Invoice email sent for %s, but no payment record found.", invoice_id)


def _upsert_subscription_record(
    db: Session,
    *,
    email: str,
    tool: str,
    plan_id: str,
    stripe_customer_id: str,
    stripe_subscription_id: str,
    price_id: str,
    status: str,
    current_period_end: int,
    invoice_id: str | None,
    payment_intent_id: str | None,
    amount: int,
    currency: str,
) -> None:
    sub = db.query(Subscription).filter_by(stripe_subscription_id=stripe_subscription_id).first()
    tool_obj = _get_or_create_tool(db, tool)
    if not sub:
        sub = Subscription(
            email=email,
            tool=tool,
            tool_id=tool_obj.id,
            plan_id=plan_id,
            price_id=price_id,
            stripe_customer_id=stripe_customer_id,
            stripe_subscription_id=stripe_subscription_id,
            status=status,
            current_period_end=_convert_timestamp_to_datetime(current_period_end),
        )
        db.add(sub)
        db.flush()
    else:
        sub.email = email
        sub.tool = tool or sub.tool or DEFAULT_TOOL
        sub.tool_id = tool_obj.id
        sub.plan_id = plan_id
        sub.price_id = price_id
        sub.status = status
        sub.current_period_end = _convert_timestamp_to_datetime(current_period_end)
        sub.stripe_customer_id = stripe_customer_id

    if invoice_id or payment_intent_id:
        existing_payment = None
        if invoice_id:
            existing_payment = (
                db.query(Payment)
                .filter(Payment.stripe_invoice_id == invoice_id)
                .first()
            )
        if not existing_payment and payment_intent_id:
            existing_payment = (
                db.query(Payment)
                .filter(Payment.stripe_payment_intent_id == payment_intent_id)
                .first()
            )

        if existing_payment:
            existing_payment.status = status
            existing_payment.amount = amount
            existing_payment.currency = currency
        else:
            payment = Payment(
                subscription_id=sub.id,
                stripe_invoice_id=invoice_id,
                stripe_payment_intent_id=payment_intent_id,
                amount=amount,
                currency=currency,
                status=status,
            )
            db.add(payment)

    db.commit()


@app.function_name(name="CreateSubscription")
@app.route(route="payments/create-subscription", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def create_subscription(req: func.HttpRequest) -> func.HttpResponse:
    """
    Create a Stripe Subscription for the selected plan and return the client secret for payment confirmation.
    Expects JSON body:
      { "planId": "bronze" | "silver" | "gold", "toolId": "<tool>", "email": "required",
        "customAmount": "optional >= 1", "customAmountCurrency": "optional (usd/cad/gbp)" }
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        data = req.get_json()
    except ValueError:
        data = {}

    plan_id = (data.get("planId") or "").lower()
    tool_id = (data.get("toolId") or data.get("tool") or DEFAULT_TOOL).lower()
    email = data.get("email") if isinstance(data.get("email"), str) else None
    custom_amount_raw = data.get("customAmount")
    if custom_amount_raw in (None, ""):
        custom_amount_raw = data.get("customAmountUsd")
    custom_amount_currency = _normalize_custom_currency(data.get("customAmountCurrency"))
    custom_amount_cents = _parse_custom_amount_to_cents(custom_amount_raw)
    if custom_amount_raw not in (None, "") and custom_amount_cents is None:
        return func.HttpResponse(
            json.dumps({"error": "customAmount must be a number greater than or equal to 1"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    amount = custom_amount_cents or _get_plan_amount(plan_id, tool_id)
    if not amount or not email:
        return func.HttpResponse(
            json.dumps({"error": "Invalid or missing planId/toolId/email"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    try:
        client = _get_stripe_client()
        customer_id = _get_or_create_customer(client, email)
        price_id = _get_or_create_price(
            client,
            plan_id,
            amount,
            tool_id,
            custom_amount_cents=custom_amount_cents,
            currency=custom_amount_currency if custom_amount_cents is not None else "usd",
        )
        metadata = {"planId": plan_id, "toolId": tool_id, "email": email}
        if custom_amount_cents is not None:
            metadata["customAmount"] = f"{custom_amount_cents / 100:.2f}"
            metadata["customAmountCurrency"] = custom_amount_currency
        subscription = client.Subscription.create(
            customer=customer_id,
            items=[{"price": price_id}],
            payment_behavior="default_incomplete",
            payment_settings={"save_default_payment_method": "on_subscription"},
            billing_mode={"type": "flexible"},
            expand=["latest_invoice.confirmation_secret", "pending_setup_intent"],
            metadata=metadata,
        )

        # Determine which client secret to return based on Stripe's basil pattern.
        client_secret = None
        intent_type = None

        pending_setup = getattr(subscription, "pending_setup_intent", None)
        if pending_setup:
            # Setup intent flow
            if isinstance(pending_setup, dict):
                client_secret = pending_setup.get("client_secret")
            else:
                client_secret = getattr(pending_setup, "client_secret", None)
            intent_type = "setup"
        else:
            # Payment intent via confirmation_secret on invoice
            invoice = subscription.latest_invoice
            confirmation_secret = getattr(invoice, "confirmation_secret", None) if invoice else None
            if isinstance(confirmation_secret, dict):
                client_secret = confirmation_secret.get("client_secret")
            else:
                client_secret = getattr(confirmation_secret, "client_secret", None)
            intent_type = "payment"

        if not client_secret:
            raise RuntimeError("Missing confirmation client secret from subscription (basil flow)")

        invoice = subscription.latest_invoice
        invoice_id = getattr(invoice, "id", None) if invoice else None
        payment_intent_id = None
        current_period_end_val = getattr(subscription, "current_period_end", None) or 0

        # Persist pending subscription record
        try:
            db = SessionLocal()
            _upsert_subscription_record(
                db,
                email=email,
                tool=tool_id,
                plan_id=plan_id,
                stripe_customer_id=customer_id,
                stripe_subscription_id=subscription.id,
                price_id=price_id,
                status=subscription.status,
                current_period_end=current_period_end_val,
                invoice_id=invoice_id,
                payment_intent_id=payment_intent_id,
                amount=amount,
                currency=custom_amount_currency if custom_amount_cents is not None else "usd",
            )
        finally:
            db.close()

    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Failed to create subscription: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": f"Failed to create subscription: {str(exc)}"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )

    return func.HttpResponse(
            json.dumps(
                {
                "type": intent_type,
                "clientSecret": client_secret,
                "subscriptionId": subscription.id,
                "toolId": tool_id,
                "customerId": customer_id,
                "status": subscription.status,
                "currency": custom_amount_currency if custom_amount_cents is not None else "usd",
            }
        ),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )


@app.function_name(name="ConfirmSubscription")
@app.route(route="payments/confirm-subscription", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def confirm_subscription(req: func.HttpRequest) -> func.HttpResponse:
    """
    Confirm subscription status after payment on the client.
    Body: { "subscriptionId": "<stripe_subscription_id>", "email": "<email>", "planId": "<plan>",
      "toolId": "<tool>", "customAmount": "optional", "customAmountCurrency": "optional" }
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        data = req.get_json()
    except ValueError:
        data = {}

    subscription_id = data.get("subscriptionId")
    email = data.get("email")
    plan_id = (data.get("planId") or "").lower()
    tool_id = (data.get("toolId") or data.get("tool") or DEFAULT_TOOL).lower()
    custom_amount_raw = data.get("customAmount")
    if custom_amount_raw in (None, ""):
        custom_amount_raw = data.get("customAmountUsd")
    custom_amount_currency = _normalize_custom_currency(data.get("customAmountCurrency"))
    custom_amount_cents = _parse_custom_amount_to_cents(custom_amount_raw)
    if custom_amount_raw not in (None, "") and custom_amount_cents is None:
        return func.HttpResponse(
            json.dumps({"error": "customAmount must be a number greater than or equal to 1"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    if not subscription_id or not email or not plan_id:
        return func.HttpResponse(
            json.dumps({"error": "subscriptionId, planId, and email are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    try:
        client = _get_stripe_client()
        subscription = client.Subscription.retrieve(subscription_id, expand=["latest_invoice.payment_intent"])
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to retrieve subscription %s: %s", subscription_id, exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to verify subscription"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )

    metadata = getattr(subscription, "metadata", {}) or {}
    if isinstance(metadata, dict):
        meta_tool = metadata.get("toolId") or metadata.get("tool")
        if meta_tool:
            tool_id = (meta_tool or tool_id).lower()
        if not plan_id and metadata.get("planId"):
            plan_id = metadata.get("planId")
        if custom_amount_cents is None:
            custom_amount_cents = _parse_custom_amount_to_cents(
                metadata.get("customAmount") or metadata.get("customAmountUsd")
            )
        if custom_amount_currency == "usd":
            custom_amount_currency = _normalize_custom_currency(metadata.get("customAmountCurrency"))

    status = subscription.status
    customer_id = subscription.customer if isinstance(subscription.customer, str) else getattr(subscription.customer, "id", None)
    latest_invoice = subscription.latest_invoice
    invoice_id = None
    payment_intent_id = None
    payment_currency = custom_amount_currency if custom_amount_cents is not None else "usd"
    amount = custom_amount_cents or _get_plan_amount(plan_id, tool_id) or PLAN_AMOUNTS.get(plan_id, 0)
    price_id = None
    current_period_end_val = getattr(subscription, "current_period_end", None) or 0

    if latest_invoice:
        invoice_obj = latest_invoice
        invoice_id = getattr(invoice_obj, "id", None) or invoice_obj.get("id") if isinstance(invoice_obj, dict) else invoice_id
        payment_intent = None
        if hasattr(invoice_obj, "payment_intent"):
            payment_intent = invoice_obj.payment_intent
        elif isinstance(invoice_obj, dict):
            payment_intent = invoice_obj.get("payment_intent")

        if isinstance(payment_intent, str):
            payment_intent = client.PaymentIntent.retrieve(payment_intent)
        if payment_intent:
            payment_intent_id = getattr(payment_intent, "id", None) or payment_intent.get("id") if isinstance(payment_intent, dict) else None
            if getattr(payment_intent, "amount", None):
                amount = payment_intent.amount
            elif isinstance(payment_intent, dict) and payment_intent.get("amount"):
                amount = payment_intent["amount"]
            if getattr(payment_intent, "currency", None):
                payment_currency = str(payment_intent.currency).lower()
            elif isinstance(payment_intent, dict) and payment_intent.get("currency"):
                payment_currency = str(payment_intent["currency"]).lower()

        invoice_currency = _get_invoice_field(invoice_obj, "currency")
        if invoice_currency and not payment_intent_id:
            payment_currency = str(invoice_currency).lower()

        lines = None
        if hasattr(invoice_obj, "lines"):
            lines = invoice_obj.lines
        elif isinstance(invoice_obj, dict):
            lines = invoice_obj.get("lines")
        if lines and hasattr(lines, "data"):
            line_items = lines.data
        elif lines and isinstance(lines, dict):
            line_items = lines.get("data", [])
        else:
            line_items = []
        if line_items:
            price = getattr(line_items[0], "price", None) if not isinstance(line_items[0], dict) else line_items[0].get("price")
            if isinstance(price, str):
                price_id = price
            elif isinstance(price, dict):
                price_id = price.get("id")

    try:
        db = SessionLocal()
        _upsert_subscription_record(
            db,
            email=email,
            tool=tool_id,
            plan_id=plan_id,
            stripe_customer_id=customer_id or "",
            stripe_subscription_id=subscription.id,
            price_id=price_id or "",
            status=status,
            current_period_end=current_period_end_val,
            invoice_id=invoice_id,
            payment_intent_id=payment_intent_id,
            amount=amount,
            currency=payment_currency,
        )
        _maybe_send_invoice_email(
            db,
            client,
            email=email,
            invoice_id=invoice_id,
            payment_intent_id=payment_intent_id,
        )
    finally:
        db.close()

    return func.HttpResponse(
        json.dumps({"status": status}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )


@app.function_name(name="StripeWebhook")
@app.route(route="payments/stripe-webhook", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def stripe_webhook(req: func.HttpRequest) -> func.HttpResponse:
    """
    Stripe webhook endpoint for invoice payment events.
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    payload = req.get_body()
    sig_header = req.headers.get("Stripe-Signature")
    webhook_secret = get_setting("STRIPE_WEBHOOK_SECRET")
    event = None

    if webhook_secret:
        try:
            event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
        except ValueError as exc:
            logger.warning("Stripe webhook payload invalid: %s", exc)
            return func.HttpResponse("Invalid payload", status_code=400, headers=cors)
        except stripe.error.SignatureVerificationError as exc:
            logger.warning("Stripe webhook signature failed: %s", exc)
            return func.HttpResponse("Invalid signature", status_code=400, headers=cors)
    else:
        logger.warning("STRIPE_WEBHOOK_SECRET not set; accepting unsigned Stripe webhook.")
        try:
            event = json.loads(payload.decode("utf-8"))
        except ValueError as exc:
            logger.warning("Stripe webhook payload decode failed: %s", exc)
            return func.HttpResponse("Invalid payload", status_code=400, headers=cors)

    event_type = _get_event_type(event)
    event_obj = _get_event_object(event)
    if not event_type or not event_obj:
        logger.warning("Stripe webhook missing type or object.")
        return func.HttpResponse("Invalid event", status_code=400, headers=cors)

    if event_type in {"invoice.payment_succeeded", "invoice.paid"}:
        invoice_id = _get_invoice_field(event_obj, "id")
        subscription_id = _get_invoice_field(event_obj, "subscription")
        payment_intent_id = _get_invoice_field(event_obj, "payment_intent")
        amount = _get_invoice_field(event_obj, "amount_paid") or _get_invoice_field(event_obj, "amount_due") or 0
        currency = _get_invoice_field(event_obj, "currency") or "usd"
        status = _get_invoice_field(event_obj, "status") or "paid"

        try:
            client = _get_stripe_client()
            email = _resolve_invoice_email(client, event_obj)
            db = SessionLocal()
            _upsert_payment_from_invoice(
                db,
                stripe_subscription_id=subscription_id,
                invoice_id=invoice_id,
                payment_intent_id=payment_intent_id,
                status=status,
                amount=amount,
                currency=currency,
            )
            _maybe_send_invoice_email(
                db,
                client,
                email=email or "",
                invoice_id=invoice_id,
                payment_intent_id=payment_intent_id,
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Stripe webhook processing failed: %s", exc)
            return func.HttpResponse("Webhook processing failed", status_code=500, headers=cors)
        finally:
            if "db" in locals():
                db.close()

    return func.HttpResponse("ok", status_code=200, headers=cors)


@app.function_name(name="GetSubscriptionStatus")
@app.route(route="subscriptions/status", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def get_subscription_status(req: func.HttpRequest) -> func.HttpResponse:
    """
    Check subscription status by email.
    Query params: ?email=...&toolId=... (toolId optional; when omitted, returns all tools)
    """
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = _normalize_email(req.params.get("email"))
    tool_param = (req.params.get("tool") or req.params.get("toolId") or "").lower() or None
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    try:
        db = SessionLocal()
        lookup_emails, client = _resolve_subscription_lookup_context(db, email)
        if not lookup_emails:
            lookup_emails = [email]
        subs = (
            db.query(Subscription)
            .filter(sa_func.lower(sa_func.trim(Subscription.email)).in_(lookup_emails))
            .order_by(Subscription.updated_at.desc())
            .all()
        )
        subscriptions_payload = []
        for sub in subs:
            primary_tool = (
                sub.tool
                or getattr(sub.tool_rel, "slug", None)
                or DEFAULT_TOOL
            ).lower()
            tools = _tools_for_plan(sub.plan_id, primary_tool)
            for tool_value in tools:
                if tool_param and tool_param != tool_value:
                    continue
                subscriptions_payload.append(
                    {
                        "tool": tool_value,
                        "active": (sub.status or "").lower() in {"active", "trialing"},
                        "status": sub.status,
                        "planId": sub.plan_id,
                        "currentPeriodEnd": sub.current_period_end.isoformat() if sub.current_period_end else None,
                    }
                )
        active_any = any(item["active"] for item in subscriptions_payload)
        primary = subscriptions_payload[0] if subscriptions_payload else None
        body = {
            "active": primary["active"] if tool_param else active_any,
            "tool": tool_param,
            "subscriptions": subscriptions_payload,
            "receptionist_usage": build_receptionist_usage_summary(db, client, lookup_emails),
        }
        if primary:
            body["status"] = primary["status"]
            body["planId"] = primary["planId"]
            body["currentPeriodEnd"] = primary["currentPeriodEnd"]
        else:
            body["reason"] = "not_found"

        return func.HttpResponse(
            json.dumps(body), status_code=200, mimetype="application/json", headers=cors
        )
    finally:
        db.close()
