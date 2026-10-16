"""Authenticated campaign APIs and independently authenticated provider callbacks."""
import hmac
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from urllib.parse import parse_qs

import azure.functions as func
from twilio.request_validator import RequestValidator

from crm_shared import resolve_actor_from_session
from function_app import app
from services.outreach_service import (ACTIVE, configuration_errors, caller_numbers, create_campaign,
    TERMINAL, campaign_payload, apply_call_status, save_result, tool_token, twilio_client, process_outreach,
    outreach_from_email)
from shared.config import get_public_api_base
from shared.db import OutreachCampaign, OutreachLead, SessionLocal
from utils.cors import build_cors_headers
from sqlalchemy import or_
from sqlalchemy.orm import defer
from services.outreach_history import (call_payload, ensure_conversation, iso, log_event,
    sync_conversation, sync_pending_conversations, transcript_payload)
from services.manual_outreach import ManualCallConflict, start_manual_call
from shared.db import OutreachCallEvent, OutreachConversation
from services import outreach_billing as billing

logger = logging.getLogger(__name__)


def response(req, payload, status=200):
    return func.HttpResponse(json.dumps(payload), status_code=status, mimetype="application/json",
                             headers={**build_cors_headers(req, ["GET", "POST"]), "Cache-Control": "no-store"})


def actor_for(req):
    actor = resolve_actor_from_session(req)
    return actor


def body_for(req):
    if len(req.get_body()) > 3 * 1024 * 1024:
        raise ValueError("Request is too large")
    body = req.get_json()
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")
    return body


@app.route(route="outreach/config", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def outreach_config(req):
    if req.method == "OPTIONS":
        return response(req, {})
    actor = actor_for(req)
    if not actor:
        return response(req, {"error": "Sign in as an account owner to manage AI outreach"}, 401)
    db = SessionLocal()
    try:
        from services.tenant_telephony import ensure_reserved_number, own_numbers, number_payload
        number_error = None
        try:
            ensure_reserved_number(db, actor.client_id)
        except Exception:
            db.rollback()
            number_error = "Could not verify the assigned Twilio number. Refresh to check again."
        return response(req, {"caller_ids": caller_numbers(db, actor.client_id),
                              "numbers": [number_payload(n) for n in own_numbers(db, actor.client_id)],
                              "number_error": number_error, "configuration_errors": configuration_errors(),
                              "from_email": outreach_from_email(),
                              "notification_email": actor.email,
                              "billing": {"is_platform_admin": billing.is_platform_admin(actor),
                                          "wallet": billing.wallet_payload(db, actor.client_id)},
                              "timezone": "Europe/London", "country": "GB"})
    finally:
        db.close()


@app.route(route="outreach/manual-calls", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def outreach_manual_call(req):
    if req.method == "OPTIONS":
        return response(req, {})
    actor = actor_for(req)
    if not actor:
        return response(req, {"error": "Sign in as an account owner to start a call"}, 401)
    db = SessionLocal()
    try:
        body = body_for(req)
        body["notification_email"] = str(body.get("notification_email") or "").strip() or actor.email
        campaign, lead, created = start_manual_call(db, actor.client_id, body, actor=actor)
        conversation = db.get(OutreachConversation, lead.id)
        return response(req, {"call": call_payload(lead, campaign, conversation),
            "campaign_id": campaign.id, "created": created}, 201 if created else 200)
    except billing.BillingError as exc:
        db.rollback()
        return response(req, {"error": str(exc)}, exc.status)
    except ManualCallConflict as exc:
        db.rollback()
        return response(req, {"error": str(exc)}, 409)
    except ValueError as exc:
        db.rollback()
        return response(req, {"error": str(exc)}, 400)
    finally:
        db.close()


@app.route(route="outreach/campaigns", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def outreach_campaigns(req):
    if req.method == "OPTIONS":
        return response(req, {})
    actor = actor_for(req)
    if not actor:
        return response(req, {"error": "Sign in as an account owner to manage AI outreach"}, 401)
    db = SessionLocal()
    try:
        if req.method == "POST":
            body = body_for(req)
            body["notification_email"] = str(body.get("notification_email") or "").strip() or actor.email
            campaign, errors = create_campaign(db, actor.client_id, body)
            return response(req, {"campaign": campaign_payload(db, campaign, True), "import_errors": errors}, 201)
        campaigns = db.query(OutreachCampaign).filter_by(client_id=actor.client_id).order_by(OutreachCampaign.created_at.desc()).limit(100).all()
        return response(req, {"items": [campaign_payload(db, c) for c in campaigns]})
    except ValueError as exc:
        db.rollback()
        return response(req, {"error": str(exc)}, 400)
    finally:
        db.close()


@app.route(route="outreach/campaigns/{campaign_id}", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def outreach_campaign(req):
    if req.method == "OPTIONS":
        return response(req, {})
    actor = actor_for(req)
    if not actor:
        return response(req, {"error": "Sign in as an account owner to manage AI outreach"}, 401)
    db = SessionLocal()
    try:
        campaign = db.query(OutreachCampaign).filter_by(id=req.route_params.get("campaign_id"), client_id=actor.client_id).first()
        if not campaign:
            return response(req, {"error": "Campaign not found"}, 404)
        if req.method == "POST":
            body = body_for(req)
            action = body.get("action")
            if action == "start":
                errors = configuration_errors()
                if errors:
                    return response(req, {"error": "; ".join(errors)}, 409)
                if campaign.status not in {"draft", "paused"}:
                    return response(req, {"error": "Only draft or paused campaigns can start"}, 409)
                if campaign.caller_id not in caller_numbers(db, actor.client_id):
                    return response(req, {"error": "Campaign caller ID is no longer active"}, 409)
                if db.query(OutreachLead).filter_by(campaign_id=campaign.id, status="needs_review").first():
                    return response(req, {"error": "Resolve uncertain calls against Twilio logs before resuming"}, 409)
                if not db.query(OutreachLead).filter_by(campaign_id=campaign.id, status="queued").first():
                    return response(req, {"error": "No eligible contacts remain"}, 409)
                next_lead = db.query(OutreachLead).filter_by(campaign_id=campaign.id, status="queued").order_by(OutreachLead.position).first()
                billing.bind_campaign(db, campaign.id, actor, body.get("quote_id"), next_lead.phone, campaign.caller_id)
                campaign.status, campaign.error = "running", None
            elif action == "pause":
                if campaign.status != "running":
                    return response(req, {"error": "Only a running campaign can pause"}, 409)
                campaign.status = "paused"
            else:
                raise ValueError("Action must be start or pause")
            db.commit()
        return response(req, {"campaign": campaign_payload(db, campaign, True)})
    except billing.BillingError as exc:
        db.rollback()
        return response(req, {"error": str(exc)}, exc.status)
    except ValueError as exc:
        db.rollback()
        return response(req, {"error": str(exc)}, 400)
    finally:
        db.close()


@app.route(route="outreach/leads/{lead_id}/status", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def outreach_status(req):
    # Always validate: the dialer's development signature bypass does not apply to campaigns.
    try:
        if len(req.get_body()) > 16384:
            raise ValueError("Callback is too large")
        parsed = parse_qs(req.get_body().decode("utf-8"), keep_blank_values=True)
        if any(len(values) != 1 for values in parsed.values()):
            raise ValueError("Duplicate callback fields")
        form = {key: values[0] for key, values in parsed.items()}
    except ValueError:
        return response(req, {"error": "Invalid Twilio callback body"}, 400)
    token = os.getenv("TWILIO_AUTH_TOKEN", "")
    signature = req.headers.get("X-Twilio-Signature", "")
    url = f"{get_public_api_base()}/api/outreach/leads/{req.route_params.get('lead_id')}/status"
    if not token or not signature or not RequestValidator(token).validate(url, form, signature):
        return response(req, {"error": "Invalid Twilio signature"}, 403)
    values = form
    if values.get("AccountSid") != os.getenv("TWILIO_ACCOUNT_SID"):
        return response(req, {"error": "Twilio account mismatch"}, 403)
    db = SessionLocal()
    try:
        lead = db.get(OutreachLead, req.route_params.get("lead_id"))
        if not lead:
            return response(req, {"error": "Contact not found"}, 404)
        campaign = db.get(OutreachCampaign, lead.campaign_id)
        if values.get("To") != lead.phone or values.get("From") != campaign.caller_id:
            return response(req, {"error": "Call numbers do not match this contact"}, 403)
        sequence = int(values["SequenceNumber"]) if "SequenceNumber" in values else None
        duration = int(values["CallDuration"]) if "CallDuration" in values else None
        if duration is not None and not 0 <= duration <= 86400:
            raise ValueError("Invalid call duration")
        apply_call_status(db, lead, values.get("CallSid"), values.get("CallStatus"), sequence, duration)
        return response(req, {"ok": True})
    except ValueError as exc:
        db.rollback()
        return response(req, {"error": str(exc)}, 400)
    finally:
        db.close()


@app.route(route="outreach/leads/{lead_id}/review", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def outreach_review(req):
    if req.method == "OPTIONS":
        return response(req, {})
    actor = actor_for(req)
    if not actor:
        return response(req, {"error": "Sign in as an account owner to review outreach"}, 401)
    db = SessionLocal()
    try:
        lead = db.query(OutreachLead).join(OutreachCampaign).filter(
            OutreachLead.id == req.route_params.get("lead_id"), OutreachCampaign.client_id == actor.client_id).first()
        if not lead:
            return response(req, {"error": "Contact not found"}, 404)
        if lead.status != "needs_review":
            return response(req, {"error": "This call does not need review"}, 409)
        body = body_for(req)
        campaign = db.get(OutreachCampaign, lead.campaign_id)
        sid = str(body.get("call_sid") or "").strip()
        if sid:
            if not sid.startswith("CA") or len(sid) != 34:
                raise ValueError("Provide a valid Twilio Call SID")
            call = twilio_client().calls(sid).fetch()
            if call.to != lead.phone or call.from_ != campaign.caller_id:
                raise ValueError("Provider call numbers do not match this contact")
            if not call.date_created or abs((call.date_created.replace(tzinfo=None) - lead.started_at).total_seconds()) > 300:
                raise ValueError("Call timestamp does not match this attempt")
            if call.status not in TERMINAL:
                raise ValueError("The provider call is still active; wait for it to finish")
            apply_call_status(db, lead, sid, call.status,
                duration=int(call.duration) if str(call.duration).isdigit() else None)
            lead.error = "Reconciled with Twilio by account owner"
        elif body.get("confirmed_no_active_call") is True:
            lead.status, lead.ended_at, lead.error = "canceled", datetime.utcnow(), "Account owner checked provider logs and skipped this contact; no redial"
            log_event(db, lead, "canceled", lead.error)
        else:
            raise ValueError("Provide a Twilio Call SID or confirm that provider logs show no active call")
        db.commit()
        return response(req, {"ok": True})
    except ValueError as exc:
        db.rollback()
        return response(req, {"error": str(exc)}, 400)
    except Exception:
        db.rollback()
        logger.exception("Provider lookup failed during outreach review")
        return response(req, {"error": "Could not verify the call with Twilio; try again"}, 502)
    finally:
        db.close()


@app.route(route="outreach/leads/{lead_id}/result", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def outreach_result(req):
    lead_id = req.route_params.get("lead_id", "")
    try:
        expected = tool_token(lead_id)
    except ValueError:
        return response(req, {"error": "Outreach tools are not configured"}, 503)
    if not hmac.compare_digest(req.headers.get("X-Outreach-Token", ""), expected):
        return response(req, {"error": "Invalid tool authentication"}, 403)
    db = SessionLocal()
    try:
        lead = db.get(OutreachLead, lead_id)
        if not lead:
            return response(req, {"error": "Contact not found"}, 404)
        save_result(db, lead, body_for(req))
        return response(req, {"ok": True, "message": "Result saved. Team follow-up is queued only for interested owners who gave permission."})
    except ValueError as exc:
        db.rollback()
        return response(req, {"error": str(exc)}, 400)
    finally:
        db.close()


@app.timer_trigger(schedule="0 * * * * *", arg_name="timer", run_on_startup=False, use_monitor=True)
def outreach_worker(timer: func.TimerRequest):
    process_outreach()


@app.route(route="outreach/calls", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def outreach_calls(req):
    if req.method == "OPTIONS":
        return response(req, {})
    actor = actor_for(req)
    if not actor:
        return response(req, {"error": "Sign in as an account owner to view call history"}, 401)
    db = SessionLocal()
    try:
        page, page_size = int(req.params.get("page", "1")), int(req.params.get("page_size", "25"))
        if not 1 <= page <= 1000000 or not 1 <= page_size <= 100:
            raise ValueError("Invalid call history page")
        query = db.query(OutreachLead, OutreachCampaign, OutreachConversation).join(
            OutreachCampaign, OutreachCampaign.id == OutreachLead.campaign_id).outerjoin(
            OutreachConversation, OutreachConversation.lead_id == OutreachLead.id).filter(
            OutreachCampaign.client_id == actor.client_id,
            or_(OutreachLead.started_at.isnot(None), OutreachLead.twilio_call_sid.isnot(None), OutreachLead.ultravox_call_id.isnot(None)))
        campaign_id = req.params.get("campaign_id")
        if campaign_id:
            query = query.filter(OutreachCampaign.id == campaign_id)
        status = req.params.get("status")
        if status:
            if status not in ACTIVE | TERMINAL | {"needs_review"}:
                raise ValueError("Unknown call status")
            query = query.filter(OutreachLead.status == status)
        outcome = req.params.get("outcome")
        if outcome:
            from services.outreach_service import OUTCOMES
            if outcome not in OUTCOMES | {"uncaptured"}:
                raise ValueError("Unknown call outcome")
            value = OutreachLead.result["outcome"].as_string()
            query = query.filter(value.is_(None) if outcome == "uncaptured" else value == outcome)
        search = req.params.get("q", "").strip()
        if len(search) > 200:
            raise ValueError("Search must be at most 200 characters")
        if search:
            escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            terms = [OutreachLead.restaurant_name, OutreachLead.phone, OutreachCampaign.name,
                     OutreachLead.result["owner_name"].as_string(), OutreachLead.result["owner_email"].as_string(),
                     OutreachLead.twilio_call_sid, OutreachLead.ultravox_call_id]
            query = query.filter(or_(*(term.ilike(f"%{escaped}%", escape="\\") for term in terms)))
        dates = {}
        for key in ("from", "to"):
            if req.params.get(key):
                try:
                    dates[key] = datetime.strptime(req.params[key], "%Y-%m-%d")
                except ValueError as exc:
                    raise ValueError("Use YYYY-MM-DD for call history dates") from exc
        if "from" in dates and "to" in dates and dates["from"] > dates["to"]:
            raise ValueError("The end date must not be before the start date")
        for key, value in dates.items():
            boundary = (value + timedelta(days=1) if key == "to" else value).replace(
                tzinfo=ZoneInfo("Europe/London")).astimezone(timezone.utc).replace(tzinfo=None)
            query = query.filter(OutreachLead.started_at < boundary if key == "to" else OutreachLead.started_at >= boundary)
        total = query.count()
        stats = {"total": total, "completed": query.filter(OutreachLead.status == "completed").count(),
                 "interested": query.filter(OutreachLead.result["outcome"].as_string() == "interested").count(),
                 "with_transcript": query.filter(OutreachConversation.message_count > 0).count()}
        # List queries return transcript metadata only. Full dialogue is fetched for one call.
        rows = query.options(defer(OutreachConversation.messages)).order_by(
            OutreachLead.started_at.desc(), OutreachLead.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
        return response(req, {"items": [call_payload(lead, campaign, conversation) for lead, campaign, conversation in rows],
            "total": total, "page": page, "page_size": page_size, "stats": stats})
    except (ValueError, OverflowError) as exc:
        return response(req, {"error": str(exc)}, 400)
    finally:
        db.close()


@app.route(route="outreach/leads/{lead_id}/conversation", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def outreach_conversation(req):
    if req.method == "OPTIONS":
        return response(req, {})
    actor = actor_for(req)
    if not actor:
        return response(req, {"error": "Sign in as an account owner to view conversations"}, 401)
    db = SessionLocal()
    try:
        pair = db.query(OutreachLead, OutreachCampaign).join(OutreachCampaign,
            OutreachCampaign.id == OutreachLead.campaign_id).filter(
            OutreachLead.id == req.route_params.get("lead_id"), OutreachCampaign.client_id == actor.client_id).first()
        if not pair:
            return response(req, {"error": "Conversation not found"}, 404)
        lead, campaign = pair
        record = ensure_conversation(db, lead)
        db.commit()
        # Opening an older call also backfills its transcript. Cached final transcripts
        # need no provider access and remain readable during a provider outage.
        record = sync_conversation(db, lead, force=req.params.get("refresh") == "true")
        db.refresh(lead)
        events = db.query(OutreachCallEvent).filter_by(lead_id=lead.id).order_by(
            OutreachCallEvent.occurred_at, OutreachCallEvent.id).all()
        return response(req, {"call": call_payload(lead, campaign, record), "transcript": transcript_payload(lead, record),
            "events": [{"id": event.id, "event": event.event, "detail": event.detail, "at": iso(event.occurred_at)} for event in events]})
    finally:
        db.close()


@app.timer_trigger(schedule="15 * * * * *", arg_name="timer", run_on_startup=False, use_monitor=True)
def outreach_conversation_worker(timer: func.TimerRequest):
    db = SessionLocal()
    try:
        sync_pending_conversations(db)
    finally:
        db.close()
