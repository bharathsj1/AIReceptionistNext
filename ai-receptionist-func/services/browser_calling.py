"""Single-use browser-to-PSTN calls. Destinations always come from saved tenant data."""
import hashlib
import json
import os
import re
from datetime import datetime

from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.rest import Client
from twilio.twiml.voice_response import VoiceResponse

from services import outreach_billing as billing
from shared.config import get_public_api_base
from shared.db import OutreachBillingSetting, OutreachBrowserCall, OutreachLead, OutreachCampaign


def settings(db):
    raw = billing.stored_secret(db, "twilio_browser_voice")
    try:
        data = json.loads(raw)
        return data if data.get("account_sid") == os.getenv("TWILIO_ACCOUNT_SID") else {}
    except (ValueError, TypeError): return {}


def configuration_errors(db):
    errors = [f"Configure {key}" for key in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN") if not os.getenv(key)]
    if not get_public_api_base().startswith("https://"):
        errors.append("API_PUBLIC_BASE_URL must be a public HTTPS origin for provider callbacks")
    if not settings(db): errors.append("Connect browser calling in the normal-call form")
    return errors


def configure(db, actor, body):
    if not billing.is_platform_admin(actor): raise billing.BillingError("Platform administrator access required", 403)
    if settings(db): return {"ready": True}
    base = get_public_api_base()
    if not base.startswith("https://"): raise billing.BillingError("Configure public HTTPS callbacks first", 503)
    key = str(body.get("api_key") or os.getenv("TWILIO_API_KEY") or "").strip()
    secret = str(body.get("api_secret") or os.getenv("TWILIO_API_SECRET") or "").strip()
    if not re.fullmatch(r"SK[0-9a-fA-F]{32}", key) or not 16 <= len(secret) <= 256:
        raise billing.BillingError("Enter an existing Twilio API key and its secret for this account", 400)
    cipher = billing.encryption()
    from services.outreach_payments import setup_lock
    from services.outreach_service import twilio_client
    with setup_lock(db, "browser_voice_setup_lock", "Browser calling"):
        if settings(db): return {"ready": True}
        try:
            Client(key, secret, account_sid=os.environ["TWILIO_ACCOUNT_SID"]).applications.list(limit=1)
            provider = twilio_client()
            name = "Vedora Outreach browser " + hashlib.sha256(base.encode()).hexdigest()[:12]
            apps = provider.applications.list(friendly_name=name, limit=2)
            voice_url, status_url = base + "/api/outreach/browser/voice", base + "/api/outreach/browser/status"
            if len(apps) > 1: raise ValueError("Multiple matching voice applications")
            application = apps[0] if apps else provider.applications.create(friendly_name=name,
                voice_url=voice_url, voice_method="POST", status_callback=status_url, status_callback_method="POST")
            if application.voice_url != voice_url or application.status_callback != status_url:
                raise ValueError("Voice application configuration mismatch")
        except Exception:
            raise billing.BillingError("Twilio could not validate browser calling. Check the existing API key and account permissions before retrying.", 503) from None
        data = {"account_sid": os.environ["TWILIO_ACCOUNT_SID"], "api_key": key, "api_secret": secret, "app_sid": application.sid}
        row = db.get(OutreachBillingSetting, "twilio_browser_voice")
        if row is None:
            row = OutreachBillingSetting(id="twilio_browser_voice"); db.add(row)
        row.encrypted_value, row.status = cipher.encrypt(json.dumps(data).encode()).decode(), "configured"
        db.commit()
    return {"ready": True}


def identity(lead_id):
    return "outreach_" + lead_id.replace("-", "")


def connection_payload(db, actor, lead):
    row = db.get(OutreachBrowserCall, lead.id)
    if not row or row.actor_email != actor.email.lower() or db.get(OutreachCampaign, lead.campaign_id).client_id != actor.client_id:
        raise billing.BillingError("Only the user who initiated this call can connect its microphone", 403)
    if row.status != "waiting" or row.expires_at <= datetime.utcnow(): return None
    config = settings(db)
    if not config: raise billing.BillingError("Browser calling is not configured", 503)
    token = AccessToken(config["account_sid"], config["api_key"], config["api_secret"],
        identity=identity(lead.id), ttl=max(1, int((row.expires_at - datetime.utcnow()).total_seconds())))
    token.add_grant(VoiceGrant(outgoing_application_sid=config["app_sid"], incoming_allow=False))
    return {"token": token.to_jwt(), "lead_id": lead.id}


def prepare(db, campaign, lead):
    if lead.status != "queued": return
    charge = billing.reserve_call(db, campaign, lead)
    lead.status, lead.started_at = "preparing", datetime.utcnow()
    from services.outreach_history import ensure_conversation, log_event
    ensure_conversation(db, lead)
    log_event(db, lead, "browser_waiting", "Waiting for the initiating user's microphone")
    db.commit()
    return charge


def voice_twiml(db, values):
    from services.outreach_service import caller_numbers, twilio_client
    from shared.db import OutreachSuppression, OutreachCallCharge
    lead = db.get(OutreachLead, values.get("LeadId"))
    row = db.get(OutreachBrowserCall, lead.id) if lead else None
    parent = values.get("CallSid", "")
    if not row or values.get("From") != "client:" + identity(lead.id) or not re.fullmatch(r"CA[0-9a-fA-F]{32}", parent):
        raise ValueError("Invalid browser call identity")
    campaign = db.get(OutreachCampaign, lead.campaign_id)
    charge = db.get(OutreachCallCharge, lead.id)
    if not charge or charge.status not in {"reserved", "exempt"} or lead.status != "preparing" or campaign.status != "running":
        raise ValueError("This call is not ready to connect")
    if campaign.caller_id not in caller_numbers(db, campaign.client_id) or db.get(OutreachSuppression, (campaign.client_id, lead.phone)):
        raise ValueError("Calling number unavailable or contact opted out")
    if not db.query(OutreachBrowserCall).filter_by(lead_id=lead.id, status="waiting", parent_sid=None).filter(
            OutreachBrowserCall.expires_at > datetime.utcnow()).update({"status": "dialing", "parent_sid": parent}, synchronize_session=False):
        raise ValueError("This browser call has already been used or expired")
    db.commit()
    # Hard cap the billable browser leg before issuing any destination Dial.
    try:
        twilio_client().calls(parent).update(time_limit=charge.max_duration_seconds)
    except Exception:
        db.refresh(row)
        row.child_duration, row.status = 0, "failed"
        lead.error = "Twilio could not apply the call budget limit; no destination was dialled"
        db.commit()
        raise ValueError(lead.error) from None
    response = VoiceResponse()
    dial = response.dial(caller_id=campaign.caller_id, answer_on_bridge=True, timeout=30,
        time_limit=charge.max_duration_seconds, action=f"{get_public_api_base()}/api/outreach/browser/finish", method="POST")
    dial.number(lead.phone, status_callback=f"{get_public_api_base()}/api/outreach/leads/{lead.id}/status",
        status_callback_event="initiated ringing answered completed", status_callback_method="POST")
    return str(response)


def finish(db, values):
    from services.outreach_service import apply_call_status, TERMINAL
    row = db.query(OutreachBrowserCall).filter_by(parent_sid=values.get("CallSid")).first()
    if not row: raise ValueError("Unknown browser call")
    lead = db.get(OutreachLead, row.lead_id)
    status, sid = values.get("DialCallStatus"), values.get("DialCallSid")
    if status in TERMINAL and sid:
        duration = values.get("DialCallDuration")
        duration = int(duration) if str(duration).isdigit() else None
        apply_call_status(db, lead, sid, status, duration=duration)


def parent_status(db, values):
    from services.outreach_service import TERMINAL
    row = db.query(OutreachBrowserCall).filter_by(parent_sid=values.get("CallSid")).first()
    if not row: return
    duration = values.get("CallDuration")
    if values.get("CallStatus") in TERMINAL and str(duration).isdigit() and 0 <= int(duration) <= 86400:
        row.parent_duration = int(duration)
        db.commit()
        billing.settle_call(db, row.lead_id, row.child_duration or 0)


def reconcile(db, row, now=None):
    from services.outreach_service import apply_call_status, twilio_client, TERMINAL
    from services.outreach_history import log_event
    now = now or datetime.utcnow()
    lead = db.get(OutreachLead, row.lead_id)
    campaign = db.get(OutreachCampaign, lead.campaign_id)
    if row.status == "waiting" and row.expires_at <= now:
        canceled = db.query(OutreachBrowserCall).filter_by(lead_id=row.lead_id, status="waiting", parent_sid=None).update(
            {"status": "canceled", "parent_duration": 0, "child_duration": 0}, synchronize_session=False)
        db.commit(); db.refresh(row)
        if canceled:
            lead.status, lead.ended_at = "canceled", now
            log_event(db, lead, "canceled", "Browser connection expired before dialling")
            db.commit()
    if row.parent_sid and row.parent_duration is None:
        parent = twilio_client().calls(row.parent_sid).fetch()
        if parent.from_ != "client:" + identity(lead.id): raise ValueError("Browser provider identity mismatch")
        if parent.status in TERMINAL and str(parent.duration).isdigit():
            row.parent_duration = int(parent.duration); db.commit()
    if row.parent_duration is not None and row.child_duration is None and row.parent_sid:
        children = twilio_client().calls.list(parent_call_sid=row.parent_sid, limit=2)
        matches = [child for child in children if child.to == lead.phone and child.from_ == campaign.caller_id]
        if len(matches) == 1:
            child = matches[0]
            if child.status in TERMINAL and str(child.duration).isdigit():
                apply_call_status(db, lead, child.sid, child.status, duration=int(child.duration))
        elif not children:
            row.child_duration = 0
            lead.status, lead.ended_at = "failed", now
            lead.error = lead.error or "Browser call ended before the contact was connected"
            db.commit()
    if row.parent_duration is not None and row.child_duration is not None:
        billing.settle_call(db, lead.id, row.child_duration)
        row.status, campaign.status = "finished", "completed"
        db.commit()


def stop(db, actor, lead_id):
    from services.outreach_service import twilio_client
    lead = db.get(OutreachLead, lead_id)
    if not lead or db.get(OutreachCampaign, lead.campaign_id).client_id != actor.client_id:
        raise billing.BillingError("Call not found", 404)
    row = db.get(OutreachBrowserCall, lead.id)
    if not row or row.actor_email != actor.email.lower(): raise billing.BillingError("Call initiator access required", 403)
    if row.status == "waiting":
        db.query(OutreachBrowserCall).filter_by(lead_id=lead.id, status="waiting", parent_sid=None).update(
            {"expires_at": datetime.utcnow()}, synchronize_session=False)
        db.commit(); db.refresh(row)
    if row.parent_sid and row.parent_duration is None:
        twilio_client().calls(row.parent_sid).update(status="completed")
    reconcile(db, row)
    return {"ok": True}
