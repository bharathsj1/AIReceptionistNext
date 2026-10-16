"""GBP wallets, immutable call reservations, and the sole platform admin policy."""
import base64
import hashlib
import math
import os
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from cryptography.fernet import Fernet
from sqlalchemy.exc import IntegrityError

from crm_shared import _auth_session_secret
from services import outreach_pricing as pricing
from shared.config import get_public_api_base
from shared.db import (OutreachWallet, OutreachWalletEntry, OutreachCallQuote,
    OutreachCampaignBilling, OutreachCallCharge, OutreachBillingSetting, OutreachPaymentOrder, OutreachCampaign)

PLATFORM_ADMIN_EMAIL = "bharath.sj1@gmail.com"
TOPUP_AMOUNTS = (1000, 2500, 5000, 10000)


class BillingError(ValueError):
    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


def is_platform_admin(actor):
    return bool(actor and actor.scope == "primary_user" and actor.email.strip().lower() == PLATFORM_ADMIN_EMAIL)


def wallet(db, client_id):
    row = db.get(OutreachWallet, client_id)
    if row: return row
    row = OutreachWallet(client_id=client_id, balance_pence=0, reserved_pence=0)
    db.add(row)
    try: db.commit()
    except IntegrityError: db.rollback()
    return db.get(OutreachWallet, client_id)


def wallet_payload(db, client_id):
    row = wallet(db, client_id)
    return {"currency": "GBP", "balance_pence": row.balance_pence, "reserved_pence": row.reserved_pence,
        "available_pence": max(0, row.balance_pence - row.reserved_pence), "credit_value_pence": 1, "frozen": row.frozen}


def credit_wallet(db, client_id, amount, reference, kind="topup", order=None, refunded=0, disputed=False):
    wallet(db, client_id)
    key = f"{kind}:{reference}"
    if db.get(OutreachWalletEntry, key): return False
    db.add(OutreachWalletEntry(id=key, client_id=client_id, kind=kind, amount_pence=amount,
        reference=reference, description="Stripe wallet top-up" if amount > 0 else "Stripe payment reversed"))
    if refunded:
        db.add(OutreachWalletEntry(id=f"initial-refund:{reference}", client_id=client_id, kind="refund", amount_pence=-refunded,
            reference=reference, description="Stripe wallet payment refunded"))
    if order:
        order.refunded_pence, order.status, order.error = refunded, "completed", None
    try:
        db.flush()
        db.query(OutreachWallet).filter_by(client_id=client_id).update({
            "balance_pence": OutreachWallet.balance_pence + amount - refunded,
            **({"frozen": True} if disputed else {})}, synchronize_session=False)
        db.commit()
        db.expire_all()
        return True
    except IntegrityError:
        db.rollback()
        return False


def quote_payload(quote):
    return {"id": quote.id, "phone": quote.phone, "caller_id": quote.caller_id, "rate_gbp": quote.rate_gbp,
        "credits_per_minute": str(Decimal(quote.rate_gbp) * 100), "currency": "GBP",
        "call_type": quote.details.get("call_type", "ai"),
        "billing_unit": quote.details.get("billing_unit", "started_minute"), "minimum_pence": pricing.pence(quote.rate_gbp),
        "expires_at": quote.expires_at.isoformat() + "Z"}


def create_call_quote(db, actor, phone, caller, call_type="ai"):
    from services.outreach_service import normalize_uk_phone, caller_numbers
    phone = normalize_uk_phone(phone)
    if caller not in caller_numbers(db, actor.client_id): raise BillingError("Choose a calling number owned by your account", 400)
    if call_type not in {"ai", "normal"}: raise BillingError("Choose AI call or normal call", 400)
    details = {**pricing.call_price(phone, caller, call_type), "call_type": call_type}
    quote = OutreachCallQuote(id=str(uuid4()), client_id=actor.client_id, actor_email=actor.email.lower(),
        phone=phone, caller_id=caller, rate_gbp=details["rate_gbp"], details=details,
        expires_at=datetime.utcnow() + timedelta(minutes=5))
    db.add(quote); db.commit()
    result = quote_payload(quote)
    result["admin_exempt"] = is_platform_admin(actor)
    return result


def bind_campaign(db, campaign_id, actor, quote_id, phone, caller, commit=True, call_type="ai"):
    if not actor: raise BillingError("A signed-in billing identity is required", 401)
    campaign = db.get(OutreachCampaign, campaign_id)
    if not campaign or campaign.client_id != actor.client_id:
        raise BillingError("Campaign not found", 404)
    admin = is_platform_admin(actor)
    rate = None
    if not admin:
        if stripe_api_key(db).startswith("sk_test_"):
            raise BillingError("Stripe is in test mode. Test payments cannot fund live calls.", 402)
        quote = db.query(OutreachCallQuote).filter_by(id=quote_id, client_id=actor.client_id,
            actor_email=actor.email.lower(), phone=phone, caller_id=caller).first()
        if not quote or quote.expires_at <= datetime.utcnow() or quote.details.get("call_type", "ai") != call_type:
            raise BillingError("Review a current call price before starting")
        rate = quote.rate_gbp
        funds = db.get(OutreachWallet, actor.client_id)
        if not funds or funds.frozen or funds.balance_pence - funds.reserved_pence < pricing.pence(rate):
            raise BillingError("Insufficient wallet credits. Add balance before making calls.", 402)
    row = db.get(OutreachCampaignBilling, campaign_id)
    if not row:
        row = OutreachCampaignBilling(campaign_id=campaign_id, client_id=actor.client_id)
        db.add(row)
    row.actor_email, row.admin_exempt, row.max_rate_gbp = actor.email.lower(), admin, rate
    if commit: db.commit()


def reserve_call(db, campaign, lead):
    call_type = (lead.contact or {}).get("call_type", "ai")
    existing = db.get(OutreachCallCharge, lead.id)
    if existing:
        if existing.status not in {"reserved", "exempt"}: raise BillingError("This call already has a settled billing record")
        return existing
    context = db.get(OutreachCampaignBilling, campaign.id)
    if not context or context.client_id != campaign.client_id: raise BillingError("Review the campaign's price and restart it before calling")
    # The exemption is recorded only by a signed-in admin action and is checked
    # against the immutable email allowlist again by the background worker.
    admin = context.admin_exempt and context.actor_email == PLATFORM_ADMIN_EMAIL
    if admin:
        row = OutreachCallCharge(lead_id=lead.id, client_id=campaign.client_id, actor_email=context.actor_email,
            admin_exempt=True, rate_gbp="0", rate_details={"call_type": call_type}, reserved_pence=0, charged_pence=0,
            max_duration_seconds=600, status="exempt")
        db.add(row)
        try: db.commit()
        except IntegrityError: db.rollback()
        return db.get(OutreachCallCharge, lead.id)
    if stripe_api_key(db).startswith("sk_test_"):
        raise BillingError("Stripe is in test mode. Test payments cannot fund live calls.", 402)
    details = {**pricing.call_price(lead.phone, campaign.caller_id, call_type), "call_type": call_type}
    rate = pricing.decimal_price(details["rate_gbp"])
    if not context.max_rate_gbp or rate > Decimal(context.max_rate_gbp):
        raise BillingError("This destination costs more than the approved rate. Review its price and resume the campaign.")
    funds = db.get(OutreachWallet, campaign.client_id)
    available = funds.balance_pence - funds.reserved_pence if funds and not funds.frozen else 0
    minutes = next((n for n in range(10, 0, -1) if pricing.pence(rate * n) <= available), 0)
    if not minutes: raise BillingError("Insufficient wallet credits. Add balance before making calls.", 402)
    reserve = pricing.pence(rate * minutes)
    row = OutreachCallCharge(lead_id=lead.id, client_id=campaign.client_id, actor_email=context.actor_email,
        admin_exempt=False, rate_gbp=str(rate), rate_details=details, reserved_pence=reserve,
        charged_pence=0, max_duration_seconds=minutes * 60, status="reserved")
    try:
        db.add(row); db.flush()
        claimed = db.query(OutreachWallet).filter_by(client_id=campaign.client_id).filter(
            OutreachWallet.frozen.is_(False),
            OutreachWallet.balance_pence - OutreachWallet.reserved_pence >= reserve).update({
                "reserved_pence": OutreachWallet.reserved_pence + reserve}, synchronize_session=False)
        if not claimed:
            db.rollback()
            raise BillingError("Wallet credits are reserved by another call. Add balance or wait for it to finish.", 402)
        db.commit()
        return row
    except IntegrityError:
        db.rollback()
        return reserve_call(db, campaign, lead)


def settle_call(db, lead_id, duration):
    row = db.get(OutreachCallCharge, lead_id)
    if not row or row.status == "settled" or duration is None: return
    if isinstance(duration, bool) or not str(duration).isdigit(): raise BillingError("Invalid billable duration", 400)
    seconds = int(duration)
    if seconds < 0: raise BillingError("Invalid billable duration", 400)
    normal = row.rate_details.get("call_type") == "normal"
    if normal:
        from shared.db import OutreachBrowserCall
        browser = db.get(OutreachBrowserCall, lead_id)
        if not browser or browser.parent_duration is None or browser.child_duration is None: return
        seconds = browser.child_duration
        cost = 0 if row.admin_exempt else min(row.reserved_pence, pricing.pence(2 * (
            Decimal(row.rate_details["twilio_gbp"]) * math.ceil(seconds / 60) +
            Decimal(row.rate_details["browser_gbp"]) * math.ceil(browser.parent_duration / 60))))
    else:
        cost = 0 if row.admin_exempt else min(row.reserved_pence, pricing.pence(Decimal(row.rate_gbp) * math.ceil(seconds / 60)))
    updated = db.query(OutreachCallCharge).filter_by(lead_id=lead_id).filter(
        OutreachCallCharge.status.in_(["reserved", "exempt"])).update({"status": "settled", "charged_pence": cost,
            "duration_seconds": seconds, "settled_at": datetime.utcnow()}, synchronize_session=False)
    if updated and not row.admin_exempt:
        db.query(OutreachWallet).filter_by(client_id=row.client_id).update({
            "balance_pence": OutreachWallet.balance_pence - cost,
            "reserved_pence": OutreachWallet.reserved_pence - row.reserved_pence}, synchronize_session=False)
        db.add(OutreachWalletEntry(id=f"call:{lead_id}", client_id=row.client_id, kind="call", amount_pence=-cost,
            reference=lead_id, description=f"{'Normal' if normal else 'AI'} call · {seconds}s · £{row.rate_gbp}/started minute"))
    db.commit(); db.expire_all()


def encryption():
    secret = _auth_session_secret()
    if not secret: raise BillingError("Billing secret storage is not configured", 503)
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("outreach-billing:" + secret).encode()).digest()))


def webhook_secret(db):
    configured = os.getenv("OUTREACH_STRIPE_WEBHOOK_SECRET", "").strip()
    if configured: return configured
    return stored_secret(db, "stripe_webhook")


def stored_secret(db, setting_id):
    record = db.get(OutreachBillingSetting, setting_id)
    if record and record.status == "configured" and record.encrypted_value:
        try: return encryption().decrypt(record.encrypted_value.encode()).decode()
        except Exception: return ""
    return ""


def stripe_api_key(db):
    # A sole-admin-confirmed initial setup takes precedence over an unused
    # deployment default. Once orders/callbacks exist, changing it is blocked.
    return stored_secret(db, "stripe_api_key") or os.getenv("STRIPE_SECRET_KEY", "").strip()


def billing_ready(db):
    return bool(stripe_api_key(db) and webhook_secret(db) and get_public_api_base().startswith("https://"))


def billing_payload(db, actor):
    admin = is_platform_admin(actor)
    ledger = db.query(OutreachWalletEntry).filter_by(client_id=actor.client_id).order_by(OutreachWalletEntry.created_at.desc()).limit(50).all()
    orders = db.query(OutreachPaymentOrder).filter_by(client_id=actor.client_id).order_by(OutreachPaymentOrder.created_at.desc()).limit(30).all()
    from services.outreach_payments import order_payload
    provider_balance = None
    if admin:
        try:
            from services.outreach_service import twilio_client
            balance = pricing.cached("admin_balance", lambda: twilio_client().balance.fetch())
            provider_balance = {"balance": str(balance.balance), "currency": balance.currency}
        except Exception: pass
    return {"is_platform_admin": admin, "role": "platform_admin" if admin else "customer",
        "wallet": wallet_payload(db, actor.client_id), "stripe_configured": billing_ready(db),
        "stripe_key_present": bool(stripe_api_key(db)), "provider_balance": provider_balance,
        "stripe_test_mode": stripe_api_key(db).startswith("sk_test_"),
        "number_markup": 2, "call_markup_mode": os.getenv("OUTREACH_CALL_MARKUP_MODE", "combined"),
        "topup_amounts_pence": list(TOPUP_AMOUNTS),
        "ledger": [{"id": e.id, "kind": e.kind, "amount_pence": e.amount_pence,
            "description": e.description, "created_at": e.created_at.isoformat() + "Z"} for e in ledger],
        "orders": [order_payload(o) for o in orders]}
