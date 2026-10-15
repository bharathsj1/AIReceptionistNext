"""Authenticated campaign APIs and independently authenticated provider callbacks."""
import hmac
import json
import logging
import os
from datetime import datetime
from urllib.parse import parse_qs

import azure.functions as func
from twilio.request_validator import RequestValidator

from crm_shared import resolve_actor_from_session
from function_app import app
from services.outreach_service import (ACTIVE, configuration_errors, caller_numbers, create_campaign,
    TERMINAL, campaign_payload, apply_call_status, save_result, tool_token, twilio_client, process_outreach)
from shared.config import get_public_api_base
from shared.db import OutreachCampaign, OutreachLead, SessionLocal
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


def response(req, payload, status=200):
    return func.HttpResponse(json.dumps(payload), status_code=status, mimetype="application/json",
                             headers=build_cors_headers(req, ["GET", "POST"]))


def actor_for(req):
    actor = resolve_actor_from_session(req)
    return actor if actor and actor.role in {"admin", "manager"} else None


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
        return response(req, {"caller_ids": caller_numbers(db, actor.client_id), "configuration_errors": configuration_errors(),
                              "timezone": "Europe/London", "country": "GB"})
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
            campaign, errors = create_campaign(db, actor.client_id, body_for(req))
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
            action = body_for(req).get("action")
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
                campaign.status, campaign.error = "running", None
            elif action == "pause":
                if campaign.status != "running":
                    return response(req, {"error": "Only a running campaign can pause"}, 409)
                campaign.status = "paused"
            else:
                raise ValueError("Action must be start or pause")
            db.commit()
        return response(req, {"campaign": campaign_payload(db, campaign, True)})
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
        apply_call_status(db, lead, values.get("CallSid"), values.get("CallStatus"), sequence)
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
            apply_call_status(db, lead, sid, call.status)
            lead.error = "Reconciled with Twilio by account owner"
        elif body.get("confirmed_no_active_call") is True:
            lead.status, lead.ended_at, lead.error = "canceled", datetime.utcnow(), "Account owner checked provider logs and skipped this contact; no redial"
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
