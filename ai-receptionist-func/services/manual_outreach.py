"""User-initiated, single-contact calls using the existing outreach lifecycle."""
import hashlib
import json
import os
from uuid import UUID, NAMESPACE_URL, uuid5
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError

from services import outreach_service as outreach
from services.outreach_history import log_event
from shared.db import OutreachCampaign, OutreachLead, OutreachSuppression, OutreachBrowserCall


class ManualCallConflict(ValueError):
    pass


def start_manual_call(db, client_id, body, now=None, actor=None):
    try:
        request_id = str(UUID(str(body.get("request_id", ""))))
    except ValueError as exc:
        raise ValueError("A valid call request ID is required") from exc
    phone = outreach.normalize_uk_phone(body.get("phone"))
    call_type = body.get("call_type", "ai")
    if call_type not in {"ai", "normal"}: raise ValueError("Choose AI call or normal call")
    if call_type == "normal" and not actor:
        from services.outreach_billing import BillingError
        raise BillingError("A signed-in calling identity is required", 401)
    details = {key: str(body.get(key) or "").strip() for key in (
        "restaurant_name", "benefits", "notification_email", "caller_id")}
    if not details["restaurant_name"] or len(details["restaurant_name"]) > 150:
        raise ValueError("Provide a business name of up to 150 characters")
    if call_type == "ai" and (not details["benefits"] or len(details["benefits"]) > 12000):
        raise ValueError("Provide verified benefits of up to 12,000 characters")
    if call_type == "ai" and not outreach.valid_email(details["notification_email"]):
        raise ValueError("Provide a valid team notification email")
    if call_type == "normal":
        details["benefits"], details["notification_email"] = "", ""
        details["call_type"] = "normal"

    fingerprint = hashlib.sha256(json.dumps({**details, "phone": phone}, sort_keys=True).encode()).hexdigest()
    # A stable primary key makes repeated/concurrent delivery the same request,
    # even across processes or restarts. It is scoped to the signed-in tenant.
    campaign_id = str(uuid5(NAMESPACE_URL, f"vedora-manual:{client_id}:{request_id}"))

    def existing():
        campaign = db.query(OutreachCampaign).filter_by(id=campaign_id, client_id=client_id).first()
        if not campaign:
            return None
        lead = db.query(OutreachLead).filter_by(campaign_id=campaign.id).one()
        if lead.contact.get("request_fingerprint") != fingerprint:
            raise ManualCallConflict("This request already belongs to another call. Check call history before starting a new call.")
        return campaign, lead, False

    replay = existing()
    if replay:
        return replay
    from services import browser_calling
    errors = browser_calling.configuration_errors(db) if call_type == "normal" else outreach.configuration_errors(db)
    if errors:
        raise ManualCallConflict("; ".join(errors))
    if details["caller_id"] not in outreach.caller_numbers(db, client_id):
        raise ValueError("Select an active caller ID belonging to your account")
    if db.get(OutreachSuppression, (client_id, phone)):
        raise ManualCallConflict("This number has opted out of outreach and cannot be called")
    # A lost browser callback must not block this number forever. Reconcile only
    # this tenant's saved attempts; a provider failure leaves the guard in place.
    browser_attempts = db.query(OutreachBrowserCall).join(OutreachLead).join(OutreachCampaign).filter(
        OutreachCampaign.client_id == client_id, OutreachLead.phone == phone,
        OutreachLead.status.in_(outreach.ACTIVE | {"needs_review"})).all()
    for attempt in browser_attempts:
        try:
            browser_calling.reconcile(db, attempt, now)
        except Exception:
            db.rollback()
            outreach.logger.warning("Browser attempt %s could not be reconciled before manual call", attempt.lead_id)
    active = db.query(OutreachLead).join(OutreachCampaign).filter(
        OutreachCampaign.client_id == client_id, OutreachLead.phone == phone,
        OutreachLead.status.in_(outreach.ACTIVE | {"needs_review"})).first()
    if active:
        raise ManualCallConflict("This number has an active or uncertain call. Check call history before calling again.")
    campaign = OutreachCampaign(id=campaign_id, client_id=client_id,
        name=f"{'Normal call' if call_type == 'normal' else 'Manual call'} · {details['restaurant_name']}"[:150], benefits=details["benefits"],
        notification_email=details["notification_email"], caller_id=details["caller_id"],
        voice=os.getenv("OUTREACH_ULTRAVOX_VOICE") or None, start_hour=0, end_hour=24, status="running")
    lead = OutreachLead(id=str(uuid5(NAMESPACE_URL, f"vedora-manual-lead:{campaign_id}")),
        campaign_id=campaign.id, position=0, phone=phone, restaurant_name=details["restaurant_name"],
        status="queued",
        contact={"source": "manual", "call_type": call_type, "request_fingerprint": fingerprint, "restaurant_name": details["restaurant_name"]})
    try:
        db.add(campaign)
        db.flush()
        db.add(lead)
        db.flush()
        if call_type == "normal":
            db.add(OutreachBrowserCall(lead_id=lead.id, actor_email=actor.email.lower(),
                status="waiting", expires_at=datetime.utcnow() + timedelta(minutes=2)))
        from services.outreach_billing import bind_campaign
        bind_campaign(db, campaign.id, actor, body.get("quote_id"), phone, details["caller_id"], commit=False, call_type=call_type)
        log_event(db, lead, "manual_requested", "Call initiated manually from the workspace")
        db.commit()
    except IntegrityError:
        db.rollback()
        replay = existing()
        if replay:
            return replay
        raise
    if call_type == "normal": browser_calling.prepare(db, campaign, lead)
    else: outreach.launch_call(db, campaign, lead)
    db.refresh(lead)
    db.refresh(campaign)
    return campaign, lead, True
