import json
import logging
from datetime import datetime
from typing import Dict

import azure.functions as func
import stripe
from sqlalchemy.orm import Session

from function_app import app
from shared.config import get_required_setting
from shared.db import SessionLocal, Subscription, Payment
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


PLAN_AMOUNTS = {
    "bronze": 50000,  # $500.00
    "silver": 60000,  # $600.00
    "gold": 70000,    # $700.00
}


def _get_stripe_client() -> stripe.StripeClient:
    secret_key = get_required_setting("STRIPE_SECRET_KEY")
    stripe.api_key = secret_key
    return stripe


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


def _get_or_create_price(stripe_client, plan_id: str, amount: int) -> str:
    """
    Find or create a monthly price for the plan using lookup_key.
    """
    lookup_key = f"ai_receptionist_{plan_id}_monthly"
    try:
        prices = stripe_client.Price.list(lookup_keys=[lookup_key], active=True, limit=1)
        if prices and prices.data:
            return prices.data[0].id
    except Exception:
        # fallback to create
        pass

    product = stripe_client.Product.create(name=f"AI Receptionist {plan_id.title()}")
    price = stripe_client.Price.create(
        unit_amount=amount,
        currency="usd",
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


def _upsert_subscription_record(
    db: Session,
    *,
    email: str,
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
    if not sub:
        sub = Subscription(
            email=email,
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
    Expects JSON body: { "planId": "bronze" | "silver" | "gold", "email": "required" }
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        data = req.get_json()
    except ValueError:
        data = {}

    plan_id = (data.get("planId") or "").lower()
    email = data.get("email") if isinstance(data.get("email"), str) else None

    amount = PLAN_AMOUNTS.get(plan_id)
    if not amount or not email:
        return func.HttpResponse(
            json.dumps({"error": "Invalid or missing planId/email"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    try:
        client = _get_stripe_client()
        customer_id = _get_or_create_customer(client, email)
        price_id = _get_or_create_price(client, plan_id, amount)
        subscription = client.Subscription.create(
            customer=customer_id,
            items=[{"price": price_id}],
            payment_behavior="default_incomplete",
            payment_settings={"save_default_payment_method": "on_subscription"},
            billing_mode={"type": "flexible"},
            expand=["latest_invoice.confirmation_secret", "pending_setup_intent"],
            metadata={"planId": plan_id, "email": email},
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
                plan_id=plan_id,
                stripe_customer_id=customer_id,
                stripe_subscription_id=subscription.id,
                price_id=price_id,
                status=subscription.status,
                current_period_end=current_period_end_val,
                invoice_id=invoice_id,
                payment_intent_id=payment_intent_id,
                amount=amount,
                currency="usd",
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
                "customerId": customer_id,
                "status": subscription.status,
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
    Body: { "subscriptionId": "<stripe_subscription_id>", "email": "<email>", "planId": "<plan>" }
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
    plan_id = data.get("planId")

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

    status = subscription.status
    customer_id = subscription.customer if isinstance(subscription.customer, str) else getattr(subscription.customer, "id", None)
    latest_invoice = subscription.latest_invoice
    invoice_id = None
    payment_intent_id = None
    amount = PLAN_AMOUNTS.get(plan_id, 0)
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
            plan_id=plan_id,
            stripe_customer_id=customer_id or "",
            stripe_subscription_id=subscription.id,
        price_id=price_id or "",
        status=status,
        current_period_end=current_period_end_val,
        invoice_id=invoice_id,
        payment_intent_id=payment_intent_id,
        amount=amount,
        currency="usd",
    )
    finally:
        db.close()

    return func.HttpResponse(
        json.dumps({"status": status}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )


@app.function_name(name="GetSubscriptionStatus")
@app.route(route="subscriptions/status", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def get_subscription_status(req: func.HttpRequest) -> func.HttpResponse:
    """
    Check subscription status by email.
    Query param: ?email=
    """
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    try:
        db = SessionLocal()
        sub = (
            db.query(Subscription)
            .filter(Subscription.email == email)
            .order_by(Subscription.updated_at.desc())
            .first()
        )
        if not sub:
            body = {"active": False, "reason": "not_found"}
        else:
            body = {
                "active": sub.status in {"active", "trialing"},
                "status": sub.status,
                "planId": sub.plan_id,
                "currentPeriodEnd": sub.current_period_end.isoformat() if sub.current_period_end else None,
            }
        return func.HttpResponse(json.dumps(body), status_code=200, mimetype="application/json", headers=cors)
    finally:
        db.close()
