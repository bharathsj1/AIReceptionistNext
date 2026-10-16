"""Stripe-confirmed wallet funding and recurring number rental fulfillment."""
import hashlib
import json
import os
import re
from datetime import datetime, timedelta
from decimal import Decimal
from urllib.parse import urlparse

import stripe
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError

from services import outreach_billing as billing, outreach_pricing as pricing
from services import tenant_telephony as telephony
from shared.config import get_public_api_base
from shared.db import (OutreachPaymentOrder, OutreachBillingSetting, NumberPurchase,
    TenantPhoneNumber, PhoneNumber, OutreachWallet, OutreachWalletEntry)

PURPOSE = "vedora_outreach"
API_VERSION = "2024-06-20"
EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed",
    "checkout.session.expired", "invoice.paid", "invoice.payment_failed", "customer.subscription.updated",
    "customer.subscription.deleted", "charge.refunded", "charge.dispute.created"]


def provider_data(value):
    # stripe-python 15 resources no longer implement dict.get(). Convert nested
    # metadata/items too, so webhook and API responses use the same safe shape.
    return value.to_dict(recursive=True) if isinstance(value, stripe.StripeObject) else value


def options(db):
    key = billing.stripe_api_key(db)
    if not key: raise billing.BillingError("Stripe payments are not configured", 503)
    return {"api_key": key, "stripe_version": API_VERSION, "max_network_retries": 0}


def configure_stripe_key(db, actor, body):
    if not billing.is_platform_admin(actor):
        raise billing.BillingError("Only the platform admin can configure Stripe", 403)
    if billing.stripe_api_key(db) or db.get(OutreachBillingSetting, "stripe_api_key"):
        raise billing.BillingError("Stripe credentials already exist. Credential replacement requires deployment administrator review.")
    # Never switch the receiving account after orders or callbacks exist.
    if billing.webhook_secret(db) or db.get(OutreachBillingSetting, "stripe_webhook") or db.query(OutreachPaymentOrder.id).first():
        raise billing.BillingError("Billing was already initialized. Restore its original deployment credentials instead of changing Stripe accounts.")
    key = body.get("secret_key")
    if not isinstance(key, str) or not re.fullmatch(r"sk_(?:live|test)_[A-Za-z0-9]{20,200}", key):
        raise billing.BillingError("Enter a valid Stripe secret key, starting with sk_live_ or sk_test_.", 400)
    publishable = body.get("publishable_key") or ""
    if not isinstance(publishable, str) or (publishable and (
            not re.fullmatch(r"pk_(?:live|test)_[A-Za-z0-9]{20,200}", publishable)
            or publishable.split("_", 2)[1] != key.split("_", 2)[1])):
        raise billing.BillingError("The publishable key must match the secret key's live or test mode.", 400)
    cipher = billing.encryption()
    try:
        account = provider_data(stripe.Account.retrieve(api_key=key, stripe_version=API_VERSION, max_network_retries=0))
    except Exception:
        raise billing.BillingError("Stripe could not validate this key. Check the key and try again.", 400) from None
    account_id = account.get("id")
    if not isinstance(account_id, str) or not re.fullmatch(r"acct_[A-Za-z0-9]+", account_id):
        raise billing.BillingError("Stripe did not confirm the receiving account", 502)
    live = key.startswith("sk_live_")
    if live and not account.get("charges_enabled"):
        raise billing.BillingError("This Stripe account cannot accept live payments yet. Finish its Stripe setup first.", 400)
    result = {"account_id": account_id, "business_name": (account.get("business_profile") or {}).get("name") or "Stripe account",
        "mode": "live" if live else "test", "saved": False}
    if body.get("confirm_account") is not True:
        return result  # Read-only preview. Nothing is stored until the admin confirms.
    if body.get("account_id") != account_id:
        raise billing.BillingError("Review and confirm this Stripe account before saving", 409)
    row = OutreachBillingSetting(id="stripe_api_key", encrypted_value=cipher.encrypt(key.encode()).decode(),
        provider_reference=account_id, status="configured")
    db.add(row)
    if publishable:
        db.add(OutreachBillingSetting(id="stripe_publishable_key", encrypted_value=cipher.encrypt(publishable.encode()).decode(),
            provider_reference=account_id, status="configured"))
    try: db.commit()
    except IntegrityError:
        db.rollback()
        raise billing.BillingError("Stripe setup was changed by another request. Refresh before continuing.") from None
    return {**result, "saved": True}


def checkout_origin():
    base = os.getenv("PUBLIC_APP_URL", "").strip().rstrip("/") or get_public_api_base()
    parsed = urlparse(base)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise billing.BillingError("A public HTTPS application URL is required for payments", 503)
    return base


def connect_stripe(db, actor):
    if not billing.is_platform_admin(actor): raise billing.BillingError("Only the platform admin can connect Stripe", 403)
    request_options = options(db)  # Missing credentials must not leave a partial setup record.
    if billing.webhook_secret(db): return {"configured": True}
    url = get_public_api_base().rstrip("/") + "/api/outreach/billing/stripe-webhook"
    if not url.startswith("https://"): raise billing.BillingError("Configure public HTTPS callbacks before connecting Stripe", 503)
    cipher = billing.encryption()
    row = db.get(OutreachBillingSetting, "stripe_webhook")
    if not row:
        row = OutreachBillingSetting(id="stripe_webhook", status="pending")
        db.add(row)
        try: db.commit()
        except IntegrityError: db.rollback()
    row = db.get(OutreachBillingSetting, "stripe_webhook")
    # A fixed idempotency key makes concurrent setup clicks the same operation.
    # Beyond Stripe's retention window an uncertain setup needs operator review.
    if row.status == "creating" and row.created_at < datetime.utcnow() - timedelta(hours=23):
        raise billing.BillingError("Stripe connection needs administrator review before another setup attempt")
    row.status = "creating"; db.commit()
    endpoint = stripe.WebhookEndpoint.create(url=url, enabled_events=EVENTS, api_version=API_VERSION,
        metadata={"purpose": PURPOSE}, idempotency_key="outreach-webhook-" + hashlib.sha256(url.encode()).hexdigest(), **request_options)
    row = db.get(OutreachBillingSetting, "stripe_webhook")
    row.encrypted_value = cipher.encrypt(str(endpoint["secret"]).encode()).decode()
    row.provider_reference, row.status = endpoint["id"], "configured"
    db.commit()
    return {"configured": True, "callback_url": url}


def order_payload(row):
    return {"id": row.id, "kind": row.kind, "status": row.status, "amount_pence": row.amount_pence,
        "currency": "GBP", "phone_number": (row.details or {}).get("phone_number"),
        "monthly_price": str(Decimal(row.amount_pence) / 100) if row.kind == "number" else None,
        "checkout_url": row.checkout_url if row.status in {"checkout_open", "pending", "checkout_review"} else None,
        "paid_until": row.paid_until.isoformat() + "Z" if row.paid_until else None,
        "cancel_requested": row.cancel_requested, "error": row.error,
        "created_at": row.created_at.isoformat() + "Z"}


def available_numbers(db, actor, number_type, contains):
    data = telephony.available_numbers(db, actor.client_id, number_type, contains)
    data["test_checkout_only"] = not billing.is_platform_admin(actor) and billing.stripe_api_key(db).startswith("sk_test_")
    quote = pricing.number_price(telephony.twilio_client(), number_type, billing.is_platform_admin(actor))
    for item in data["items"]:
        item.update(monthly_price=quote["monthly_price"], currency="GBP",
            payment_required=not billing.is_platform_admin(actor), multiplier=quote["multiplier"])
    return data


def make_checkout(db, row):
    if row.stripe_session_id:
        return row
    if row.created_at < datetime.utcnow() - timedelta(hours=23):
        raise billing.BillingError("This checkout needs administrator review before another payment attempt")
    origin = checkout_origin()
    metadata = {"purpose": PURPOSE, "order_id": row.id, "client_id": str(row.client_id), "kind": row.kind}
    price = {"currency": "gbp", "unit_amount": row.amount_pence,
        "product_data": {"name": "Vedora Outreach wallet credits" if row.kind == "topup" else f"Vedora Outreach number {row.details['phone_number']}"}}
    kwargs = {}
    if row.kind == "number":
        price["recurring"] = {"interval": "month"}
        kwargs["subscription_data"] = {"metadata": metadata}
    else:
        kwargs["payment_intent_data"] = {"metadata": metadata}
    try:
        session = stripe.checkout.Session.create(mode="subscription" if row.kind == "number" else "payment",
            payment_method_types=["card"], customer_email=row.actor_email,
            line_items=[{"price_data": price, "quantity": 1}], metadata=metadata, client_reference_id=row.id,
            success_url=f"{origin}/dashboard?billing_order={row.id}",
            cancel_url=f"{origin}/dashboard?billing_order={row.id}&checkout_cancelled=1",
            idempotency_key=f"outreach-checkout-{row.id}", **kwargs, **options(db))
        session = provider_data(session)
        # Never offer a non-Stripe redirect returned from an unexpected provider.
        if not str(session.get("url", "")).startswith("https://checkout.stripe.com/"):
            raise billing.BillingError("Stripe did not return a secure checkout URL")
        row.stripe_session_id, row.checkout_url, row.status = session["id"], session["url"], "checkout_open"
        row.error = None; db.commit()
    except Exception:
        db.rollback(); row = db.get(OutreachPaymentOrder, row.id)
        if not row.stripe_session_id:
            row.status, row.error = "checkout_review", "Checkout response was interrupted. Check this payment before starting another one."
            db.commit()
        raise billing.BillingError("Could not confirm the checkout. Check the existing payment before trying again.", 502) from None
    return row


def topup_checkout(db, actor, body):
    if billing.is_platform_admin(actor): raise billing.BillingError("The platform admin uses provider balances and does not need wallet top-ups", 400)
    if not billing.billing_ready(db): raise billing.BillingError("Stripe billing is not connected. No payment has been taken.", 503)
    amount = body.get("amount_pence")
    if type(amount) is not int or amount not in billing.TOPUP_AMOUNTS:
        raise billing.BillingError("Choose an available wallet top-up amount", 400)
    key = telephony.request_key(actor.client_id, "topup", body.get("request_id"))
    existing = db.get(OutreachPaymentOrder, key)
    if existing:
        if existing.kind != "topup" or existing.amount_pence != amount: raise billing.BillingError("This request belongs to another payment")
        return make_checkout(db, existing) if existing.status in {"pending", "checkout_review"} else existing
    row = OutreachPaymentOrder(id=key, client_id=actor.client_id, actor_email=actor.email.lower(), kind="topup",
        amount_pence=amount, currency="gbp", details={}, status="pending")
    db.add(row)
    try: db.commit()
    except IntegrityError:
        db.rollback(); return topup_checkout(db, actor, body)
    return make_checkout(db, row)


def number_checkout(db, actor, body):
    if billing.is_platform_admin(actor):
        # Only the signed-in allowlisted admin can bypass Stripe.
        provider = telephony.twilio_client()
        quote = pricing.number_price(provider, body.get("number_type"), True)
        if Decimal(str(body.get("monthly_price", "0"))) != Decimal(quote["monthly_price"]) or body.get("currency", "").upper() != "GBP":
            raise billing.BillingError("The price changed. Search again before buying.")
        return telephony.purchase_payload(telephony.purchase_number(db, actor.client_id,
            {**body, "monthly_price": quote["provider_price"], "currency": quote["provider_currency"]}, admin_actor=actor))
    if not billing.billing_ready(db): raise billing.BillingError("Stripe billing is not connected. No payment has been taken.", 503)
    key = telephony.request_key(actor.client_id, "number-payment", body.get("request_id"))
    phone = telephony.normalize_uk_phone(body.get("phone_number"))
    kind = body.get("number_type")
    if kind not in {"mobile", "local"} or body.get("confirm_purchase") is not True:
        raise billing.BillingError("Choose a number and confirm its recurring monthly charge", 400)
    existing = db.get(OutreachPaymentOrder, key)
    if existing:
        if existing.kind != "number" or existing.details.get("phone_number") != phone or existing.details.get("number_type") != kind or Decimal(existing.amount_pence) / 100 != pricing.decimal_price(body.get("monthly_price", "0")):
            raise billing.BillingError("This request belongs to another purchase")
        return order_payload(make_checkout(db, existing) if existing.status in {"pending", "checkout_review"} else existing)
    conflict = db.query(OutreachPaymentOrder).filter_by(client_id=actor.client_id, kind="number").filter(
        OutreachPaymentOrder.status.notin_(["refunded", "cancelled", "failed", "expired", "test_completed"])).all()
    if any(row.details.get("phone_number") == phone for row in conflict):
        raise billing.BillingError("This number already has a payment in progress. Check Billing & wallet first.")
    provider = telephony.twilio_client()
    quote = pricing.number_price(provider, kind)
    if Decimal(str(body.get("monthly_price", "0"))) != Decimal(quote["monthly_price"]) or str(body.get("currency", "")).upper() != "GBP":
        raise billing.BillingError("The monthly price changed. Search again and review the new quote.")
    items = telephony.available_numbers(db, actor.client_id, kind, phone[-10:])["items"]
    if not any(item["phone_number"] == phone for item in items): raise billing.BillingError("That number is no longer available")
    telephony.regulatory_settings(db, actor.client_id)  # Validate account-scoped regulatory references before taking payment.
    row = OutreachPaymentOrder(id=key, client_id=actor.client_id, actor_email=actor.email.lower(), kind="number",
        amount_pence=quote["amount_pence"], currency="gbp", status="pending",
        details={"phone_number": phone, "number_type": kind, **quote})
    db.add(row)
    try: db.commit()
    except IntegrityError:
        db.rollback(); return number_checkout(db, actor, body)
    return order_payload(make_checkout(db, row))


def subscription_period(subscription):
    ends = [item.get("current_period_end") for item in (subscription.get("items") or {}).get("data", []) if item.get("current_period_end")]
    end = subscription.get("current_period_end") or (min(ends) if ends else None)
    if not end: raise billing.BillingError("Stripe did not confirm the number's paid period")
    return datetime.utcfromtimestamp(int(end))


def require_paid_purchase(db, client_id, body, order_id=None, admin_actor=None):
    if billing.is_platform_admin(admin_actor) and admin_actor.client_id == client_id: return
    order = db.get(OutreachPaymentOrder, order_id) if order_id else None
    if not order or order.client_id != client_id or order.kind != "number" or order.status not in {"paid", "provisioning", "completed"} or not order.stripe_session_id or not order.stripe_subscription_id or not order.paid_until or order.paid_until <= datetime.utcnow():
        raise billing.BillingError("A confirmed Stripe payment is required before purchasing a number", 402)
    if order.details.get("phone_number") != body.get("phone_number") or order.details.get("number_type") != body.get("number_type"):
        raise billing.BillingError("The payment does not cover this number", 402)


def refund_number_order(db, order):
    if order.status == "refunded": return
    order.status = "refund_pending"; db.commit()
    try:
        if order.stripe_subscription_id:
            subscription = provider_data(stripe.Subscription.retrieve(order.stripe_subscription_id, **options(db)))
            if subscription.get("status") != "canceled":
                stripe.Subscription.cancel(order.stripe_subscription_id, prorate=False, invoice_now=False, **options(db))
        if not order.stripe_payment_intent_id: raise billing.BillingError("Payment reference needs administrator review")
        refund = stripe.Refund.create(payment_intent=order.stripe_payment_intent_id, amount=order.amount_pence,
            idempotency_key=f"outreach-refund-{order.id}", metadata={"purpose": PURPOSE, "order_id": order.id}, **options(db))
        refund = provider_data(refund)
        order.refund_id = refund["id"]
        order.status = "refunded" if refund.get("status") == "succeeded" else "refund_pending"
        order.error = "The number could not be provisioned. The subscription was cancelled and a full refund was requested."
        db.commit()
    except Exception:
        db.rollback(); order = db.get(OutreachPaymentOrder, order.id)
        order.status, order.error = "refund_pending", "Provisioning failed. Your refund needs administrator review; do not pay again."
        db.commit()


def fulfill_order(db, order):
    if order.status in {"refunded", "refund_pending", "cancelled", "expired"}: return order
    if not order.stripe_session_id: return order
    session = provider_data(stripe.checkout.Session.retrieve(order.stripe_session_id, **options(db)))
    metadata = session.get("metadata") or {}
    if (session.get("id") != order.stripe_session_id or metadata.get("purpose") != PURPOSE or metadata.get("order_id") != order.id
        or metadata.get("client_id") != str(order.client_id) or metadata.get("kind") != order.kind
        or session.get("currency") != "gbp" or session.get("amount_total") != order.amount_pence
        or session.get("mode") != ("subscription" if order.kind == "number" else "payment")):
        raise billing.BillingError("Stripe payment details do not match the saved order")
    if session.get("payment_status") != "paid" or session.get("status") != "complete":
        if session.get("status") == "expired" and order.status in {"pending", "checkout_open", "checkout_review"}:
            order.status = "expired"; db.commit()
        return order
    if billing.stripe_api_key(db).startswith("sk_test_"):
        order.status = "test_completed"
        order.error = "Stripe test payment verified. No spendable wallet credits or live Twilio number were created."
        db.commit()
        return order
    order.stripe_customer_id = session.get("customer")
    if order.kind == "topup":
        if not session.get("payment_intent"): raise billing.BillingError("Stripe payment confirmation is missing")
        intent = provider_data(stripe.PaymentIntent.retrieve(session["payment_intent"], **options(db)))
        if intent.get("status") != "succeeded" or intent.get("currency") != "gbp" or intent.get("amount_received") != order.amount_pence or not intent.get("latest_charge"):
            raise billing.BillingError("Stripe has not confirmed the wallet payment")
        charge = provider_data(stripe.Charge.retrieve(intent["latest_charge"], **options(db)))
        if charge.get("payment_intent") != session["payment_intent"] or charge.get("amount") != order.amount_pence or charge.get("currency") != "gbp":
            raise billing.BillingError("Wallet payment reference mismatch")
        refunded = int(charge.get("amount_refunded") or 0)
        if not 0 <= refunded <= order.amount_pence: raise billing.BillingError("Invalid refund amount")
        order.stripe_payment_intent_id = session["payment_intent"]
        db.commit()
        billing.credit_wallet(db, order.client_id, order.amount_pence, order.id, order=order, refunded=refunded, disputed=bool(charge.get("disputed")))
        order = db.get(OutreachPaymentOrder, order.id)
        order.status = "completed"; order.error = None; db.commit()
        reverse_topup(db, order, charge)
        return order
    if not session.get("subscription"): raise billing.BillingError("The number subscription is missing")
    subscription = provider_data(stripe.Subscription.retrieve(session["subscription"], **options(db)))
    if (subscription.get("metadata") or {}).get("order_id") != order.id:
        raise billing.BillingError("The number subscription does not match this order")
    order.stripe_subscription_id = subscription["id"]
    invoice = provider_data(stripe.Invoice.retrieve(subscription["latest_invoice"], **options(db)))
    if invoice.get("status") != "paid" or invoice.get("amount_paid") != order.amount_pence or invoice.get("currency") != "gbp" or invoice.get("subscription") != subscription["id"]:
        db.commit()
        return order
    order.stripe_payment_intent_id = order.stripe_payment_intent_id or invoice.get("payment_intent")
    if subscription.get("status") != "active":
        db.commit(); return order
    paid_until = subscription_period(subscription)
    order.paid_until = max(order.paid_until or paid_until, paid_until)
    if order.status == "completed": db.commit(); return order
    if order.status not in {"paid", "provisioning", "needs_review"}:
        order.status = "paid"
    db.commit()
    claimed = db.query(OutreachPaymentOrder).filter_by(id=order.id).filter(
        or_(OutreachPaymentOrder.locked_until.is_(None), OutreachPaymentOrder.locked_until < datetime.utcnow())).update({
            "locked_until": datetime.utcnow() + timedelta(minutes=5), "status": "provisioning"}, synchronize_session=False)
    db.commit()
    if not claimed: db.refresh(order); return order
    db.refresh(order)
    details = order.details
    try:
        purchased = telephony.purchase_number(db, order.client_id, {"request_id": order.id,
            "phone_number": details["phone_number"], "number_type": details["number_type"], "confirm_purchase": True,
            "monthly_price": details["provider_price"], "currency": details["provider_currency"]}, billing_order_id=order.id)
        order.provider_purchase_id = purchased.id
        if purchased.status == "completed": order.status, order.error = "completed", None
        elif purchased.status == "failed": order.status = "refund_pending"
        else: order.status, order.error = "needs_review", "Payment received; Twilio provisioning is being checked. Do not pay again."
        order.locked_until = None; db.commit()
        if order.status == "refund_pending": refund_number_order(db, order)
    except (ValueError, billing.BillingError):
        db.rollback(); order = db.get(OutreachPaymentOrder, order.id)
        # A durable provider attempt may have succeeded despite an interrupted response.
        provider_id = telephony.request_key(order.client_id, "number", order.id)
        attempted = db.get(NumberPurchase, provider_id)
        if attempted and attempted.status in {"purchasing", "needs_review", "completed"}:
            order.status, order.error, order.locked_until = "needs_review", "Payment received; provider outcome needs reconciliation. Do not pay again.", None
            db.commit()
        else:
            order.locked_until = None; db.commit(); refund_number_order(db, order)
    return db.get(OutreachPaymentOrder, order.id)


def number_entitled(db, client_id, phone):
    if telephony.account_email(db, client_id) == billing.PLATFORM_ADMIN_EMAIL: return True
    if billing.stripe_api_key(db).startswith("sk_test_"): return False
    return any(row.details.get("phone_number") == phone and row.paid_until and row.paid_until > datetime.utcnow()
        for row in db.query(OutreachPaymentOrder).filter_by(client_id=client_id, kind="number", status="completed").all())


def cancel_number(db, actor, order_id, confirmed):
    order = db.query(OutreachPaymentOrder).filter_by(id=order_id, client_id=actor.client_id, kind="number").first()
    if not order: raise billing.BillingError("Number subscription not found", 404)
    if confirmed is not True: raise billing.BillingError("Confirm ending the number subscription", 400)
    if order.status != "completed" or not order.stripe_subscription_id:
        raise billing.BillingError("This subscription needs review before it can be cancelled")
    stripe.Subscription.modify(order.stripe_subscription_id, cancel_at_period_end=True,
        idempotency_key=f"outreach-cancel-{order.id}", **options(db))
    order.cancel_requested = True; db.commit()
    return order


def sync_subscription(db, order):
    if not order.stripe_subscription_id: return
    subscription = provider_data(stripe.Subscription.retrieve(order.stripe_subscription_id, **options(db)))
    if (subscription.get("metadata") or {}).get("order_id") != order.id: raise billing.BillingError("Subscription ownership mismatch")
    order.cancel_requested = bool(subscription.get("cancel_at_period_end"))
    invoice_id = subscription.get("latest_invoice")
    if invoice_id and subscription.get("status") == "active" and order.status == "completed":
        invoice = provider_data(stripe.Invoice.retrieve(invoice_id, **options(db)))
        if invoice.get("status") == "paid" and invoice.get("amount_paid") == order.amount_pence and invoice.get("currency") == "gbp" and invoice.get("subscription") == subscription["id"]:
            end = subscription_period(subscription)
            order.paid_until = max(order.paid_until or end, end)
    db.commit()
    if order.status == "completed" and (not order.paid_until or order.paid_until > datetime.utcnow()): return
    if order.status not in {"completed", "release_pending"}: return
    # Paid service ends before provider release. No delayed or duplicate webhook
    # can grant another paid period without retrieving a current paid invoice.
    order.status = "release_pending"; db.commit()
    if subscription.get("status") != "canceled":
        stripe.Subscription.cancel(order.stripe_subscription_id, prorate=False, invoice_now=False, **options(db))
    purchase = db.get(NumberPurchase, order.provider_purchase_id) if order.provider_purchase_id else None
    number = db.query(TenantPhoneNumber).filter_by(client_id=order.client_id, phone_number=order.details["phone_number"]).first()
    if number:
        number.is_active = False
        db.query(PhoneNumber).filter_by(client_id=order.client_id, twilio_phone_number=number.phone_number).update({"is_active": False})
        db.commit()
        if not purchase or purchase.number_sid != number.sid:
            order.error = "Service ended; number ownership needs administrator review before release."
            db.commit(); return
        try: telephony.twilio_client().incoming_phone_numbers(number.sid).delete()
        except Exception as exc:
            if getattr(exc, "status", None) != 404:
                order.error = "Service ended; provider number release is pending."
                db.commit(); return
    order.status, order.error = "cancelled", None
    db.commit()


def process_order(db, order):
    if order.status in {"pending", "checkout_review"} and not order.stripe_session_id:
        make_checkout(db, order)
    if order.status in {"completed", "release_pending"} and order.kind == "number": sync_subscription(db, order)
    elif order.status in {"checkout_open", "paid", "provisioning", "needs_review"}: fulfill_order(db, order)
    elif order.status == "refund_pending":
        if not order.refund_id: refund_number_order(db, order)
        else:
            refund = provider_data(stripe.Refund.retrieve(order.refund_id, **options(db)))
            if refund.get("status") == "succeeded": order.status = "refunded"; db.commit()
    return order


def reverse_topup(db, order, charge):
    refunded = int(charge.get("amount_refunded") or 0)
    if refunded < 0 or refunded > order.amount_pence: raise billing.BillingError("Refund amount does not match the wallet payment")
    previous = order.refunded_pence
    if refunded <= previous: return
    changed = db.query(OutreachPaymentOrder).filter_by(id=order.id, refunded_pence=previous).update({"refunded_pence": refunded}, synchronize_session=False)
    if not changed: db.rollback(); db.refresh(order); return reverse_topup(db, order, charge)
    delta = refunded - previous
    db.query(OutreachWallet).filter_by(client_id=order.client_id).update({"balance_pence": OutreachWallet.balance_pence - delta}, synchronize_session=False)
    db.add(OutreachWalletEntry(id=f"refund:{charge['id']}:{refunded}", client_id=order.client_id, kind="refund",
        amount_pence=-delta, reference=order.id, description="Stripe wallet payment refunded"))
    db.commit(); db.expire_all()


def handle_webhook(db, event):
    event = provider_data(event)
    obj = event["data"]["object"]
    kind = event["type"]
    if bool(event.get("livemode")) != billing.stripe_api_key(db).startswith("sk_live_"):
        raise billing.BillingError("Stripe event mode does not match this deployment", 400)
    if kind.startswith("checkout.session."):
        order = db.query(OutreachPaymentOrder).filter_by(stripe_session_id=obj.get("id")).first()
        if order: fulfill_order(db, order)
    elif kind in {"invoice.paid", "invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted"}:
        sid = obj.get("subscription") if kind.startswith("invoice.") else obj.get("id")
        order = db.query(OutreachPaymentOrder).filter_by(stripe_subscription_id=sid).first()
        if not order and kind.startswith("customer.subscription."):
            order = db.get(OutreachPaymentOrder, (obj.get("metadata") or {}).get("order_id"))
        if order and order.kind == "number":
            if not order.stripe_subscription_id: fulfill_order(db, order)
            elif order.status in {"completed", "release_pending"}: sync_subscription(db, order)
            elif order.status not in {"cancelled", "refunded", "refund_pending"}: fulfill_order(db, order)
    elif kind in {"charge.refunded", "charge.dispute.created"}:
        charge = provider_data(stripe.Charge.retrieve(obj["id"] if kind == "charge.refunded" else obj["charge"], **options(db)))
        payment_id = charge.get("payment_intent")
        order = db.query(OutreachPaymentOrder).filter_by(stripe_payment_intent_id=payment_id).first() if payment_id else None
        if order and order.status == "completed":
            if charge.get("currency") != "gbp" or charge.get("amount") != order.amount_pence:
                raise billing.BillingError("Refund payment mismatch")
            if kind == "charge.refunded" and order.kind == "topup":
                reverse_topup(db, order, charge)
            elif order.kind == "number":
                # Refunded/disputed rental cannot retain access to the number.
                order.status, order.error = "release_pending", "Number payment was refunded or disputed."
                db.commit(); sync_subscription(db, order)
            else:
                db.query(OutreachWallet).filter_by(client_id=order.client_id).update({"frozen": True})
                db.commit()
