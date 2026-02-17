import json
import logging
import os
from datetime import datetime
from typing import Optional
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import azure.functions as func
from sqlalchemy import func as sa_func, or_
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import Gather, VoiceResponse

if str(os.getenv("UNIT_TESTING", "")).strip().lower() in {"1", "true", "yes", "on"}:
    # Keeps unit tests importable without bootstrapping the full function host.
    app = func.FunctionApp()
else:
    from function_app import app
from services.call_routing_rules import match_rule
from services.call_routing_store import (
    client_id_from_tenant_id,
    get_forward_targets,
    get_routing_config,
    get_transfer_log_by_call_sid,
    normalize_e164,
    resolve_routing_bundle_by_twilio_number,
    tenant_id_from_client_id,
    upsert_forward_targets,
    upsert_routing_config,
    upsert_transfer_log,
)
from services.call_service import attach_ultravox_call, upsert_call, update_call_status
from services.ultravox_service import create_ultravox_call
from shared.config import get_public_api_base, get_required_setting, get_setting
from shared.db import Call, Client, ClientUser, PhoneNumber, SessionLocal, User
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)

COUNTRY_TIMEZONE_DEFAULTS = {
    "GB": "Europe/London",
    "US": "America/New_York",
    "CA": "America/Toronto",
    "AU": "Australia/Sydney",
    "NZ": "Pacific/Auckland",
    "IE": "Europe/Dublin",
    "IN": "Asia/Kolkata",
}


def _normalize_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def _public_api_url(path: str) -> str:
    base = (get_public_api_base() or "").rstrip("/")
    normalized_path = path if path.startswith("/") else f"/{path}"
    if not normalized_path.startswith("/api/"):
        normalized_path = f"/api{normalized_path}"
    return f"{base}{normalized_path}"


def _country_default_timezone(country: str | None) -> str:
    code = str(country or "").strip().upper()
    return COUNTRY_TIMEZONE_DEFAULTS.get(code) or "UTC"


def _parse_twilio_form(req: func.HttpRequest) -> tuple[dict, str]:
    raw_body = req.get_body().decode("utf-8") if req.get_body() else ""
    parsed = parse_qs(raw_body, keep_blank_values=True)
    payload = {key: values[0] if values else "" for key, values in parsed.items()}
    return payload, raw_body


def _validate_twilio_signature(req: func.HttpRequest, form_payload: dict) -> bool:
    strict = str(get_setting("TWILIO_VALIDATE_SIGNATURE", "true") or "").strip().lower()
    if strict in {"0", "false", "no", "off"}:
        return True
    signature = req.headers.get("X-Twilio-Signature")
    if not signature:
        return False
    try:
        validator = RequestValidator(get_required_setting("TWILIO_AUTH_TOKEN"))
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Twilio signature validation setup failed: %s", exc)
        return False

    params = {str(k): str(v) for k, v in (form_payload or {}).items()}
    parsed_url = urlparse(req.url)
    candidate_urls = [req.url]
    public_base = (get_public_api_base() or "").rstrip("/")
    if public_base:
        candidate_urls.append(f"{public_base}{parsed_url.path}")
        if not parsed_url.path.startswith("/api/"):
            candidate_urls.append(f"{public_base}/api{parsed_url.path}")
    for candidate in dict.fromkeys(candidate_urls):
        try:
            if validator.validate(candidate, params, signature):
                return True
        except Exception:  # pylint: disable=broad-except
            continue
    return False


def _find_client_and_user(db, email: str) -> tuple[Optional[Client], Optional[User]]:
    normalized = _normalize_email(email)
    if not normalized:
        return None, None
    user = (
        db.query(User)
        .filter(sa_func.lower(sa_func.trim(User.email)) == normalized)
        .order_by(User.id.asc())
        .first()
    )
    client = (
        db.query(Client)
        .filter(sa_func.lower(sa_func.trim(Client.email)) == normalized)
        .order_by(Client.id.asc())
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
    return client, user


def _is_client_user_for_client(db, client_id: int, email: str) -> bool:
    normalized = _normalize_email(email)
    if not normalized:
        return False
    row = (
        db.query(ClientUser)
        .filter(ClientUser.client_id == client_id)
        .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == normalized)
        .filter(
            or_(
                ClientUser.is_active.is_(True),
                ClientUser.is_active.is_(None),
            )
        )
        .filter(sa_func.lower(sa_func.coalesce(ClientUser.status, "active")) != "disabled")
        .first()
    )
    return row is not None


def _active_phone_numbers(db, client_id: int) -> list[str]:
    rows = (
        db.query(PhoneNumber.twilio_phone_number)
        .filter(PhoneNumber.client_id == client_id, PhoneNumber.is_active.is_(True))
        .all()
    )
    return [normalize_e164(row[0]) for row in rows if row and row[0]]


def _default_rules(agent_key: str | None = None) -> list[dict]:
    return [
        {
            "name": "Open hours",
            "days": ["MON", "TUE", "WED", "THU", "FRI"],
            "timeRanges": [{"start": "09:00", "end": "17:00"}],
            "action": {"type": "ULTRAVOX", "agentKey": agent_key or ""},
            "priority": 10,
        },
        {
            "name": "After hours",
            "days": ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
            "timeRanges": [{"start": "00:00", "end": "23:59"}],
            "action": {"type": "FORWARD"},
            "priority": 50,
        },
    ]


def _default_forward_settings(client: Client | None = None) -> dict:
    target = normalize_e164(getattr(client, "business_phone", None)) if client else ""
    targets = [{"to": target, "label": "Primary", "priority": 1}] if target else []
    return {
        "targets": targets,
        "ringStrategy": "sequential",
        "timeoutSeconds": 20,
        "fallback": "voicemail",
    }


def _without_tenant_id(payload: dict | None) -> dict:
    data = dict(payload or {})
    data.pop("tenantId", None)
    return data


def _build_whisper_url(parent_call_sid: str, summary: str | None) -> str:
    short_summary = (summary or "SmartConnect4u inbound call").strip()
    short_summary = short_summary[:220]
    return (
        f"{_public_api_url('/twilio/voice/whisper')}"
        f"?parentCallSid={quote(parent_call_sid)}"
        f"&summary={quote(short_summary)}"
    )


def _build_voicemail_twiml() -> str:
    response = VoiceResponse()
    response.say("We are sorry we missed your call. Please leave a message after the tone.")
    response.record(max_length=120, play_beep=True, trim="trim-silence")
    return str(response)


def _build_ai_callback_twiml() -> str:
    response = VoiceResponse()
    gather = Gather(
        input="dtmf",
        num_digits=15,
        timeout=8,
        action=_public_api_url("/twilio/voice/callback-capture"),
        method="POST",
    )
    gather.say("No one is available right now. Please enter your callback number, followed by pound.")
    response.append(gather)
    response.say("No callback number received. Goodbye.")
    response.hangup()
    return str(response)


def _build_hangup_twiml(message: str = "No agents are available right now.") -> str:
    response = VoiceResponse()
    response.say(message)
    response.hangup()
    return str(response)


def _build_dial_twiml(
    *,
    parent_call_sid: str,
    targets: list[dict],
    timeout_seconds: int,
    summary: str | None,
    action_url: str,
) -> str:
    response = VoiceResponse()
    dial = response.dial(
        timeout=max(5, int(timeout_seconds or 20)),
        answer_on_bridge=True,
        action=action_url,
        method="POST",
    )
    whisper_url = _build_whisper_url(parent_call_sid, summary)
    for item in targets:
        to_number = normalize_e164(item.get("to"))
        if not to_number:
            continue
        dial.number(to_number, url=whisper_url)
    return str(response)


def _resolve_call_context(db, to_number: str) -> tuple[str | None, Client | None, dict | None, dict | None]:
    normalized_to = normalize_e164(to_number)
    bundle = resolve_routing_bundle_by_twilio_number(normalized_to)
    tenant_id = bundle.get("tenantId") if bundle else None
    client = None
    if tenant_id:
        client_id = client_id_from_tenant_id(tenant_id)
        if client_id:
            client = db.query(Client).filter(Client.id == client_id).one_or_none()

    if not client:
        phone = (
            db.query(PhoneNumber)
            .filter(PhoneNumber.twilio_phone_number == normalized_to, PhoneNumber.is_active.is_(True))
            .first()
        )
        if phone:
            client = db.query(Client).filter(Client.id == phone.client_id).one_or_none()
            if client:
                tenant_id = tenant_id_from_client_id(client.id)
    routing_config = bundle.get("routingConfig") if bundle else None
    forward_targets = bundle.get("forwardTargets") if bundle else None
    return tenant_id, client, routing_config, forward_targets


def _ultravox_connect_twiml(
    db,
    *,
    call_sid: str,
    from_number: str,
    to_number: str,
    agent_key: str,
) -> str:
    join_url, ultravox_call_id = create_ultravox_call(
        agent_key,
        caller_number=from_number or "",
        metadata={
            "twilioCallSid": call_sid,
            "aiPhoneNumber": to_number,
            "selectedAgentId": agent_key,
        },
    )
    if call_sid:
        attach_ultravox_call(db, call_sid, ultravox_call_id)
        call = upsert_call(
            db,
            call_sid,
            caller_number=from_number,
            ai_phone_number=to_number,
            status="in_progress",
            selected_agent_id=agent_key,
        )
        update_call_status(db, call, "in_progress")
    response = VoiceResponse()
    connect = response.connect()
    connect.stream(url=join_url)
    return str(response)


def _start_forwarding(
    *,
    tenant_id: str,
    call_sid: str,
    twilio_number: str,
    targets: list[dict],
    ring_strategy: str,
    timeout_seconds: int,
    fallback: str,
    summary: str | None,
    reason: str | None = None,
    agent_key: str | None = None,
) -> str:
    normalized_targets = []
    for idx, item in enumerate(targets or []):
        to_number = normalize_e164((item or {}).get("to"))
        if not to_number:
            continue
        normalized_targets.append(
            {
                "to": to_number,
                "label": (item or {}).get("label") or f"Target {idx + 1}",
                "priority": int((item or {}).get("priority") or idx + 1),
            }
        )
    normalized_targets.sort(key=lambda item: int(item.get("priority") or 9999))
    if not normalized_targets:
        return _build_hangup_twiml("No forwarding targets configured.")

    ring_mode = str(ring_strategy or "sequential").strip().lower()
    if ring_mode not in {"sequential", "simultaneous"}:
        ring_mode = "sequential"

    upsert_transfer_log(
        tenant_id,
        call_sid,
        {
            "status": "dialing",
            "twilioNumber": normalize_e164(twilio_number),
            "targets": normalized_targets,
            "ringStrategy": ring_mode,
            "timeoutSeconds": int(timeout_seconds or 20),
            "fallback": fallback or "voicemail",
            "summary": summary or "",
            "reason": reason or "",
            "currentIndex": 0,
            "agentKey": agent_key or "",
            "startedAt": datetime.utcnow().isoformat(),
        },
    )
    action_url = _public_api_url("/twilio/voice/forward-next")
    if ring_mode == "simultaneous":
        dial_targets = normalized_targets
    else:
        dial_targets = [normalized_targets[0]]
    return _build_dial_twiml(
        parent_call_sid=call_sid,
        targets=dial_targets,
        timeout_seconds=int(timeout_seconds or 20),
        summary=summary,
        action_url=action_url,
    )


def _fallback_twiml(db, *, log: dict, form: dict) -> str:
    fallback = str(log.get("fallback") or "voicemail").strip().lower()
    if fallback == "voicemail":
        return _build_voicemail_twiml()
    if fallback == "ai_callback":
        return _build_ai_callback_twiml()
    if fallback == "ultravox":
        tenant_id = log.get("tenantId")
        client_id = client_id_from_tenant_id(tenant_id)
        client = db.query(Client).filter(Client.id == client_id).one_or_none() if client_id else None
        agent_key = log.get("agentKey") or getattr(client, "ultravox_agent_id", None)
        call_sid = form.get("CallSid") or log.get("callSid")
        from_number = normalize_e164(form.get("From"))
        twilio_number = normalize_e164(log.get("twilioNumber") or form.get("To"))
        if agent_key and call_sid and twilio_number:
            try:
                twiml = _ultravox_connect_twiml(
                    db,
                    call_sid=call_sid,
                    from_number=from_number,
                    to_number=twilio_number,
                    agent_key=agent_key,
                )
                upsert_transfer_log(tenant_id, call_sid, {"status": "fallback_ultravox"})
                return twiml
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("Ultravox fallback failed: %s", exc)
        return _build_hangup_twiml("Unable to connect to AI fallback right now.")
    return _build_hangup_twiml()


@app.function_name(name="DashboardRoutingSettings")
@app.route(route="dashboard/routing-settings", methods=["GET", "PUT", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def dashboard_routing_settings(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "PUT", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if req.method == "GET":
        email = _normalize_email(req.params.get("email"))
        twilio_number = normalize_e164(req.params.get("twilioNumber"))
    else:
        body = req.get_json() if req.get_body() else {}
        email = _normalize_email((body or {}).get("email"))
        twilio_number = normalize_e164((body or {}).get("twilioNumber"))
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        client, _ = _find_client_and_user(db, email)
        if not client:
            return func.HttpResponse(
                json.dumps({"error": "Client not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        tenant_id = tenant_id_from_client_id(client.id)
        numbers = _active_phone_numbers(db, client.id)
        selected_number = twilio_number if twilio_number in numbers else (numbers[0] if numbers else "")
        if not selected_number:
            return func.HttpResponse(
                json.dumps({"error": "No active Twilio number found for client"}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        if req.method == "GET":
            config = get_routing_config(tenant_id, selected_number)
            forward = get_forward_targets(tenant_id, selected_number)
            if not config:
                config = {
                    "tenantId": tenant_id,
                    "twilioNumber": selected_number,
                    "country": (get_setting("TWILIO_DEFAULT_COUNTRY") or "US").upper(),
                    "timezone": _country_default_timezone(get_setting("TWILIO_DEFAULT_COUNTRY") or "US"),
                    "enabled": True,
                    "rules": _default_rules(client.ultravox_agent_id),
                }
            if not forward:
                forward = {
                    "tenantId": tenant_id,
                    "twilioNumber": selected_number,
                    **_default_forward_settings(client),
                }
            config = _without_tenant_id(config)
            forward = _without_tenant_id(forward)
            payload = {
                "canEdit": not _is_client_user_for_client(db, client.id, email),
                "phoneNumbers": numbers,
                "selectedTwilioNumber": selected_number,
                "routingConfig": config,
                "forwardTargets": forward,
                "availableAgents": [
                    {
                        "key": client.ultravox_agent_id,
                        "label": "Primary AI Agent",
                    }
                ]
                if client.ultravox_agent_id
                else [],
            }
            return func.HttpResponse(json.dumps(payload), status_code=200, mimetype="application/json", headers=cors)

        body = body or {}
        if _is_client_user_for_client(db, client.id, email):
            return func.HttpResponse(
                json.dumps({"error": "Added users can view routing settings but cannot modify them"}),
                status_code=403,
                mimetype="application/json",
                headers=cors,
            )
        incoming_config = body.get("routingConfig") if isinstance(body.get("routingConfig"), dict) else {}
        incoming_forward = body.get("forwardTargets") if isinstance(body.get("forwardTargets"), dict) else {}
        country = (incoming_config.get("country") or body.get("country") or "US").upper()
        timezone_name = incoming_config.get("timezone") or body.get("timezone") or _country_default_timezone(country)
        enabled = bool(incoming_config.get("enabled", True))
        rules = incoming_config.get("rules") if isinstance(incoming_config.get("rules"), list) else []
        if not rules:
            rules = _default_rules(client.ultravox_agent_id)

        targets = incoming_forward.get("targets") if isinstance(incoming_forward.get("targets"), list) else []
        ring_strategy = incoming_forward.get("ringStrategy") or "sequential"
        timeout_seconds = int(incoming_forward.get("timeoutSeconds") or 20)
        fallback = incoming_forward.get("fallback") or "voicemail"

        config = upsert_routing_config(
            tenant_id,
            selected_number,
            country=country,
            timezone_name=timezone_name,
            enabled=enabled,
            rules=rules,
            updated_by=email,
        )
        forward = upsert_forward_targets(
            tenant_id,
            selected_number,
            targets=targets,
            ring_strategy=ring_strategy,
            timeout_seconds=timeout_seconds,
            fallback=fallback,
            updated_by=email,
        )
        config = _without_tenant_id(config)
        forward = _without_tenant_id(forward)
        return func.HttpResponse(
            json.dumps(
                {
                    "ok": True,
                    "selectedTwilioNumber": selected_number,
                    "routingConfig": config,
                    "forwardTargets": forward,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("dashboard_routing_settings failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to manage routing settings", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="TwilioInboundRouter")
@app.route(route="twilio/voice/inbound", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def twilio_voice_inbound(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    form, _ = _parse_twilio_form(req)
    if not _validate_twilio_signature(req, form):
        return func.HttpResponse("Unauthorized", status_code=401, headers=cors)

    call_sid = form.get("CallSid") or ""
    from_number = normalize_e164(form.get("From"))
    to_number = normalize_e164(form.get("To") or form.get("Called"))
    if not to_number:
        return func.HttpResponse(_build_hangup_twiml("Missing destination number."), mimetype="text/xml", headers=cors)

    db = SessionLocal()
    try:
        tenant_id, client, routing_config, forward_config = _resolve_call_context(db, to_number)
        if call_sid:
            upsert_call(
                db,
                call_sid,
                caller_number=from_number,
                ai_phone_number=to_number,
                status="initiated",
                selected_agent_id=getattr(client, "ultravox_agent_id", None),
            )

        timezone_name = (routing_config or {}).get("timezone") if routing_config else None
        if not timezone_name:
            timezone_name = _country_default_timezone((routing_config or {}).get("country") if routing_config else None)
        try:
            local_now = datetime.now(ZoneInfo(timezone_name))
        except Exception:
            timezone_name = "UTC"
            local_now = datetime.now(ZoneInfo("UTC"))
        matched_rule = match_rule(local_now, (routing_config or {}).get("rules") or [])
        action = (matched_rule or {}).get("action") if isinstance(matched_rule, dict) else None
        action_type = str((action or {}).get("type") or "ULTRAVOX").strip().upper()
        forward_mode = str((action or {}).get("forwardMode") or "").strip().lower()

        if action_type == "ULTRAVOX":
            agent_key = (action or {}).get("agentKey") or getattr(client, "ultravox_agent_id", None)
            if not agent_key:
                twiml = _build_hangup_twiml("AI agent is not configured for this number.")
            else:
                twiml = _ultravox_connect_twiml(
                    db,
                    call_sid=call_sid,
                    from_number=from_number,
                    to_number=to_number,
                    agent_key=agent_key,
                )
        elif action_type == "FORWARD":
            forward = forward_config or _default_forward_settings(client)
            fallback = forward.get("fallback") or "voicemail"
            agent_key = (action or {}).get("agentKey") or getattr(client, "ultravox_agent_id", None)
            if forward_mode == "ring_then_ai" and agent_key:
                fallback = "ultravox"
            if not tenant_id and client:
                tenant_id = tenant_id_from_client_id(client.id)
            if not tenant_id:
                twiml = _build_hangup_twiml("Tenant routing not configured.")
            else:
                twiml = _start_forwarding(
                    tenant_id=tenant_id,
                    call_sid=call_sid,
                    twilio_number=to_number,
                    targets=forward.get("targets") or [],
                    ring_strategy=forward.get("ringStrategy") or "sequential",
                    timeout_seconds=int(forward.get("timeoutSeconds") or 20),
                    fallback=fallback,
                    summary=f"Inbound call for {getattr(client, 'business_name', 'SmartConnect4u')}",
                    reason=f"rule:{(matched_rule or {}).get('name') or 'forward'}",
                    agent_key=agent_key,
                )
        elif action_type == "VOICEMAIL":
            twiml = _build_voicemail_twiml()
        else:
            twiml = _build_hangup_twiml()
        db.commit()
        return func.HttpResponse(twiml, status_code=200, mimetype="text/xml", headers=cors)
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("twilio_voice_inbound failed: %s", exc)
        return func.HttpResponse(_build_hangup_twiml(), status_code=200, mimetype="text/xml", headers=cors)
    finally:
        db.close()


@app.function_name(name="TwilioForwardNext")
@app.route(route="twilio/voice/forward-next", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def twilio_forward_next(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    form, _ = _parse_twilio_form(req)
    if not _validate_twilio_signature(req, form):
        return func.HttpResponse("Unauthorized", status_code=401, headers=cors)

    call_sid = form.get("CallSid") or ""
    dial_status = str(form.get("DialCallStatus") or "").strip().lower()
    log = get_transfer_log_by_call_sid(call_sid)
    if not log:
        return func.HttpResponse(_build_hangup_twiml(), status_code=200, mimetype="text/xml", headers=cors)

    tenant_id = log.get("tenantId")
    if dial_status == "completed":
        upsert_transfer_log(
            tenant_id,
            call_sid,
            {
                "status": "connected",
                "chosenTarget": form.get("Called") or form.get("DialCallSid") or "",
                "completedAt": datetime.utcnow().isoformat(),
            },
        )
        return func.HttpResponse(str(VoiceResponse()), status_code=200, mimetype="text/xml", headers=cors)

    targets = log.get("targets") if isinstance(log.get("targets"), list) else []
    ring_strategy = str(log.get("ringStrategy") or "sequential").lower()
    timeout_seconds = int(log.get("timeoutSeconds") or 20)
    summary = log.get("summary") or ""
    current_index = int(log.get("currentIndex") or 0)
    if ring_strategy == "sequential":
        next_index = current_index + 1
        if next_index < len(targets):
            upsert_transfer_log(tenant_id, call_sid, {"status": "dialing", "currentIndex": next_index})
            twiml = _build_dial_twiml(
                parent_call_sid=call_sid,
                targets=[targets[next_index]],
                timeout_seconds=timeout_seconds,
                summary=summary,
                action_url=_public_api_url("/twilio/voice/forward-next"),
            )
            return func.HttpResponse(twiml, status_code=200, mimetype="text/xml", headers=cors)

    db = SessionLocal()
    try:
        upsert_transfer_log(
            tenant_id,
            call_sid,
            {
                "status": "fallback",
                "lastDialStatus": dial_status,
                "failedAt": datetime.utcnow().isoformat(),
            },
        )
        twiml = _fallback_twiml(db, log=log, form=form)
        db.commit()
        return func.HttpResponse(twiml, status_code=200, mimetype="text/xml", headers=cors)
    finally:
        db.close()


@app.function_name(name="TwilioWhisper")
@app.route(route="twilio/voice/whisper", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def twilio_whisper(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    form, _ = _parse_twilio_form(req)
    if not _validate_twilio_signature(req, form):
        return func.HttpResponse("Unauthorized", status_code=401, headers=cors)
    summary = (req.params.get("summary") or "SmartConnect4u inbound call").strip()[:220]
    parent_call_sid = (req.params.get("parentCallSid") or "").strip()
    response = VoiceResponse()
    gather = Gather(
        num_digits=1,
        timeout=6,
        action=f"{_public_api_url('/twilio/voice/whisper-result')}?parentCallSid={quote(parent_call_sid)}",
        method="POST",
    )
    gather.say(f"Whisper summary. {summary}. Press 1 to accept, any other key to decline.")
    response.append(gather)
    response.say("No response. Declining.")
    response.hangup()
    return func.HttpResponse(str(response), status_code=200, mimetype="text/xml", headers=cors)


@app.function_name(name="TwilioWhisperResult")
@app.route(route="twilio/voice/whisper-result", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def twilio_whisper_result(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    form, _ = _parse_twilio_form(req)
    if not _validate_twilio_signature(req, form):
        return func.HttpResponse("Unauthorized", status_code=401, headers=cors)
    digits = str(form.get("Digits") or "").strip()
    parent_call_sid = (req.params.get("parentCallSid") or "").strip()
    if parent_call_sid:
        log = get_transfer_log_by_call_sid(parent_call_sid)
        if log:
            upsert_transfer_log(log.get("tenantId"), parent_call_sid, {"digits": digits})

    response = VoiceResponse()
    if digits == "1":
        response.say("Connecting.")
    else:
        response.say("Declined.")
        response.hangup()
    return func.HttpResponse(str(response), status_code=200, mimetype="text/xml", headers=cors)


@app.function_name(name="TwilioCallbackCapture")
@app.route(route="twilio/voice/callback-capture", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def twilio_callback_capture(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    form, _ = _parse_twilio_form(req)
    if not _validate_twilio_signature(req, form):
        return func.HttpResponse("Unauthorized", status_code=401, headers=cors)
    callback_digits = str(form.get("Digits") or "").strip()
    call_sid = str(form.get("CallSid") or "").strip()
    log = get_transfer_log_by_call_sid(call_sid)
    if log:
        upsert_transfer_log(log.get("tenantId"), call_sid, {"callbackDigits": callback_digits, "status": "callback_captured"})
    response = VoiceResponse()
    response.say("Thank you. We have captured your callback number.")
    response.hangup()
    return func.HttpResponse(str(response), status_code=200, mimetype="text/xml", headers=cors)


@app.function_name(name="UltravoxTransferTool")
@app.route(route="ultravox/tools/warm-transfer", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def ultravox_warm_transfer(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    provided_secret = req.headers.get("X-ULTRAVOX-TOOL-SECRET")
    expected_secret = get_setting("ULTRAVOX_TOOL_SECRET")
    if not expected_secret or provided_secret != expected_secret:
        logger.warning("Ultravox warm transfer rejected due to invalid secret")
        return func.HttpResponse(
            json.dumps({"error": "unauthorized"}),
            status_code=401,
            mimetype="application/json",
            headers=cors,
        )
    try:
        payload = req.get_json()
    except ValueError:
        payload = {}

    call_sid = str((payload or {}).get("callSid") or "").strip()
    if not call_sid:
        return func.HttpResponse(
            json.dumps({"error": "callSid is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    preferred = normalize_e164((payload or {}).get("preferredTarget"))
    summary = str((payload or {}).get("summary") or "Caller requested a human handoff.").strip()[:220]
    reason = str((payload or {}).get("reason") or "warm_transfer").strip()

    db = SessionLocal()
    try:
        call = db.query(Call).filter(Call.twilio_call_sid == call_sid).one_or_none()
        twilio_number = normalize_e164((payload or {}).get("twilioNumber") or (call.ai_phone_number if call else ""))
        if not twilio_number:
            return func.HttpResponse(
                json.dumps({"error": "Unable to resolve Twilio number for callSid"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        tenant_id, client, _routing, forward_config = _resolve_call_context(db, twilio_number)
        if not tenant_id:
            return func.HttpResponse(
                json.dumps({"error": "Tenant not found for twilio number"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        forward = forward_config or _default_forward_settings(client)
        targets = list(forward.get("targets") or [])
        if preferred:
            preferred_first = [item for item in targets if normalize_e164(item.get("to")) == preferred]
            others = [item for item in targets if normalize_e164(item.get("to")) != preferred]
            targets = preferred_first + others
        if not targets:
            return func.HttpResponse(
                json.dumps({"error": "No forwarding targets configured"}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        twiml = _start_forwarding(
            tenant_id=tenant_id,
            call_sid=call_sid,
            twilio_number=twilio_number,
            targets=targets,
            ring_strategy=forward.get("ringStrategy") or "sequential",
            timeout_seconds=int(forward.get("timeoutSeconds") or 20),
            fallback=forward.get("fallback") or "voicemail",
            summary=summary,
            reason=reason,
            agent_key=getattr(client, "ultravox_agent_id", None),
        )
        from onboarding_endpoints import get_twilio_client

        twilio_client = get_twilio_client()
        twilio_client.calls(call_sid).update(twiml=twiml, method="POST")
        upsert_transfer_log(
            tenant_id,
            call_sid,
            {
                "status": "warm_transfer_requested",
                "reason": reason,
                "summary": summary,
                "requestedAt": datetime.utcnow().isoformat(),
            },
        )
        return func.HttpResponse(
            json.dumps({"status": "ok", "callSid": call_sid}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("ultravox_warm_transfer failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Warm transfer failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()
