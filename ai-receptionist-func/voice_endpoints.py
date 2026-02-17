from __future__ import annotations

import json
import logging
import os
import re
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, quote, urlparse

import azure.functions as func
from sqlalchemy import func as sa_func, or_
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.request_validator import RequestValidator
from twilio.rest import Client as TwilioRestClient
from twilio.twiml.voice_response import VoiceResponse

from function_app import app
from services.sales_dialer_store import list_call_logs, upsert_call_log
from shared.config import get_public_api_base, get_required_setting, get_setting
from shared.db import Client, ClientUser, SessionLocal, User
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)

E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")
TERMINAL_STATUSES = {"completed", "busy", "failed", "no-answer", "canceled", "cancelled"}
VOICE_TOKEN_TTL_SECONDS = max(300, min(24 * 3600, int(os.getenv("VOICE_TOKEN_TTL_SECONDS", "3600"))))
VOICE_DIAL_RATE_MAX = max(1, int(os.getenv("VOICE_DIAL_RATE_LIMIT_MAX", "12")))
VOICE_DIAL_RATE_WINDOW = max(1, int(os.getenv("VOICE_DIAL_RATE_LIMIT_WINDOW_SECONDS", "60")))
DEFAULT_CALLER_ID = (os.getenv("TWILIO_CALLER_ID") or "+14313400857").strip()
BLOCKED_PREFIXES = [
    str(raw).strip()
    for raw in (os.getenv("VOICE_BLOCKED_PREFIXES") or "+1900,+1976,+979").split(",")
    if str(raw).strip()
]


@dataclass
class VoiceActor:
    tenant_id: str
    client_id: int
    user_key: str
    user_id: str
    email: str
    role: str
    scope: str
    default_rep_phone: str


class SimpleRateLimiter:
    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._buckets: dict[str, deque] = {}

    def allow(self, key: str) -> tuple[bool, int]:
        now = time.time()
        window_start = now - self.window_seconds
        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = deque()
            self._buckets[key] = bucket
        while bucket and bucket[0] < window_start:
            bucket.popleft()
        if len(bucket) >= self.max_requests:
            retry_after = int(self.window_seconds - (now - bucket[0]))
            return False, max(retry_after, 1)
        bucket.append(now)
        return True, 0


VOICE_DIAL_RATE_LIMITER = SimpleRateLimiter(VOICE_DIAL_RATE_MAX, VOICE_DIAL_RATE_WINDOW)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_response(payload: Dict[str, Any], status_code: int, headers: Dict[str, str]) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(payload),
        status_code=status_code,
        mimetype="application/json",
        headers=headers,
    )


def _normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_e164(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    keep_plus = raw.startswith("+")
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return ""
    if keep_plus:
        return f"+{digits}"
    if raw.startswith("00"):
        return f"+{digits[2:]}" if len(digits) > 2 else ""
    return f"+{digits}"


def _is_valid_e164(value: str) -> bool:
    return bool(E164_PATTERN.match(str(value or "").strip()))


def _is_blocked_number(number: str) -> bool:
    candidate = str(number or "")
    return any(candidate.startswith(prefix) for prefix in BLOCKED_PREFIXES)


def _extract_client_ip(req: func.HttpRequest) -> str:
    forwarded = req.headers.get("x-forwarded-for") or req.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return (
        req.headers.get("x-client-ip")
        or req.headers.get("X-Client-IP")
        or req.headers.get("x-real-ip")
        or req.headers.get("X-Real-IP")
        or "unknown"
    )


def _extract_email(req: func.HttpRequest, body: Optional[dict] = None) -> str:
    body = body or {}
    candidates = [
        req.headers.get("x-user-email"),
        req.headers.get("X-User-Email"),
        req.headers.get("x-email"),
        req.params.get("email"),
        body.get("email"),
        body.get("userEmail"),
    ]
    for value in candidates:
        normalized = _normalize_email(value)
        if normalized:
            return normalized
    return ""


def _is_allowed_sales_role(role: str, scope: str) -> bool:
    scope_value = str(scope or "").strip().lower()
    if scope_value == "primary_user":
        return True
    normalized = re.sub(r"[\s_-]+", "", str(role or "").strip().lower())
    return normalized in {"admin", "salesrep", "sales"}


def _resolve_actor_by_email(db, email: str) -> Optional[VoiceActor]:
    normalized = _normalize_email(email)
    if not normalized:
        return None

    client = (
        db.query(Client)
        .filter(sa_func.lower(sa_func.trim(Client.email)) == normalized)
        .order_by(Client.id.asc())
        .first()
    )
    if client:
        owner = db.query(User).filter(User.id == client.user_id).one_or_none() if client.user_id else None
        user_key = f"u{owner.id}" if owner else f"o{client.id}"
        owner_id = str(owner.id if owner else client.id)
        default_rep_phone = _normalize_e164(
            (owner.business_number if owner else None) or client.business_phone or ""
        )
        return VoiceActor(
            tenant_id=str(client.id),
            client_id=int(client.id),
            user_key=user_key,
            user_id=owner_id,
            email=normalized,
            role="admin",
            scope="primary_user",
            default_rep_phone=default_rep_phone,
        )

    client_user = (
        db.query(ClientUser)
        .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == normalized)
        .filter(
            or_(
                ClientUser.is_active.is_(True),
                ClientUser.is_active.is_(None),
            )
        )
        .filter(sa_func.lower(sa_func.coalesce(ClientUser.status, "active")) != "disabled")
        .order_by(ClientUser.id.asc())
        .first()
    )
    if client_user:
        client = db.query(Client).filter(Client.id == client_user.client_id).one_or_none()
        if not client:
            return None
        return VoiceActor(
            tenant_id=str(client.id),
            client_id=int(client.id),
            user_key=f"c{client_user.id}",
            user_id=str(client_user.id),
            email=normalized,
            role=str(client_user.role or "member").strip().lower(),
            scope="client_user",
            default_rep_phone="",
        )

    user = (
        db.query(User)
        .filter(sa_func.lower(sa_func.trim(User.email)) == normalized)
        .order_by(User.id.asc())
        .first()
    )
    if not user:
        return None
    client = db.query(Client).filter(Client.user_id == user.id).order_by(Client.id.asc()).first()
    if not client:
        return None
    default_rep_phone = _normalize_e164(user.business_number or client.business_phone or "")
    return VoiceActor(
        tenant_id=str(client.id),
        client_id=int(client.id),
        user_key=f"u{user.id}",
        user_id=str(user.id),
        email=normalized,
        role="admin",
        scope="primary_user",
        default_rep_phone=default_rep_phone,
    )


def _resolve_actor_from_identity(db, identity: str) -> Optional[VoiceActor]:
    raw_identity = str(identity or "").strip()
    if ":" not in raw_identity:
        return None
    tenant_part, user_part = raw_identity.split(":", 1)
    tenant_id = str(tenant_part or "").strip()
    user_key = str(user_part or "").strip()
    if not tenant_id.isdigit() or not user_key:
        return None
    client = db.query(Client).filter(Client.id == int(tenant_id)).one_or_none()
    if not client:
        return None

    if user_key.startswith("c"):
        raw_user_id = user_key[1:]
        if not raw_user_id.isdigit():
            return None
        client_user = (
            db.query(ClientUser)
            .filter(ClientUser.id == int(raw_user_id), ClientUser.client_id == int(tenant_id))
            .filter(
                or_(
                    ClientUser.is_active.is_(True),
                    ClientUser.is_active.is_(None),
                )
            )
            .filter(sa_func.lower(sa_func.coalesce(ClientUser.status, "active")) != "disabled")
            .one_or_none()
        )
        if not client_user:
            return None
        return VoiceActor(
            tenant_id=tenant_id,
            client_id=int(tenant_id),
            user_key=f"c{client_user.id}",
            user_id=str(client_user.id),
            email=_normalize_email(client_user.email),
            role=str(client_user.role or "member").strip().lower(),
            scope="client_user",
            default_rep_phone="",
        )

    if user_key.startswith("u"):
        raw_user_id = user_key[1:]
        if not raw_user_id.isdigit():
            return None
        user = db.query(User).filter(User.id == int(raw_user_id)).one_or_none()
        if not user:
            return None
        if client.user_id and int(client.user_id) != int(user.id):
            return None
        default_rep_phone = _normalize_e164(user.business_number or client.business_phone or "")
        return VoiceActor(
            tenant_id=tenant_id,
            client_id=int(tenant_id),
            user_key=f"u{user.id}",
            user_id=str(user.id),
            email=_normalize_email(user.email),
            role="admin",
            scope="primary_user",
            default_rep_phone=default_rep_phone,
        )
    if user_key.startswith("o"):
        raw_owner_key = user_key[1:]
        if not raw_owner_key.isdigit() or int(raw_owner_key) != int(tenant_id):
            return None
        default_rep_phone = _normalize_e164(client.business_phone or "")
        return VoiceActor(
            tenant_id=tenant_id,
            client_id=int(tenant_id),
            user_key=f"o{tenant_id}",
            user_id=str(tenant_id),
            email=_normalize_email(client.email),
            role="admin",
            scope="primary_user",
            default_rep_phone=default_rep_phone,
        )
    return None


def _build_identity(actor: VoiceActor) -> str:
    return f"{actor.tenant_id}:{actor.user_key}"


def _public_api_url(path: str) -> str:
    base = (get_public_api_base() or "").rstrip("/")
    normalized_path = path if path.startswith("/") else f"/{path}"
    if not normalized_path.startswith("/api/"):
        normalized_path = f"/api{normalized_path}"
    return f"{base}{normalized_path}"


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
    auth_token = get_setting("TWILIO_AUTH_TOKEN")
    if not signature or not auth_token:
        return False
    try:
        validator = RequestValidator(auth_token)
    except Exception:  # pylint: disable=broad-except
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


def _voice_access_token(identity: str) -> str:
    account_sid = get_required_setting("TWILIO_ACCOUNT_SID")
    api_key_sid = get_required_setting("TWILIO_API_KEY_SID")
    api_key_secret = get_required_setting("TWILIO_API_KEY_SECRET")
    twiml_app_sid = (
        get_setting("TWILIO_CALLER_APP_SID")
        or get_setting("TWILIO_APP_SID")
        or ""
    ).strip()
    if not twiml_app_sid:
        raise ValueError("Missing required environment variable: TWILIO_CALLER_APP_SID")
    token = AccessToken(
        account_sid,
        api_key_sid,
        api_key_secret,
        identity=identity,
        ttl=VOICE_TOKEN_TTL_SECONDS,
    )
    token.add_grant(
        VoiceGrant(
            outgoing_application_sid=twiml_app_sid,
            incoming_allow=False,
        )
    )
    jwt = token.to_jwt()
    return jwt.decode("utf-8") if isinstance(jwt, bytes) else str(jwt)


def _twilio_client() -> TwilioRestClient:
    account_sid = get_required_setting("TWILIO_ACCOUNT_SID")
    api_key_sid = get_required_setting("TWILIO_API_KEY_SID")
    api_key_secret = get_required_setting("TWILIO_API_KEY_SECRET")
    return TwilioRestClient(api_key_sid, api_key_secret, account_sid)


def _caller_id_for_tenant(tenant_id: str) -> str:
    default_caller = _normalize_e164(DEFAULT_CALLER_ID)
    raw_map = os.getenv("TWILIO_CALLER_ID_BY_TENANT_JSON")
    if not raw_map:
        return default_caller
    try:
        payload = json.loads(raw_map)
    except json.JSONDecodeError:
        return default_caller
    if not isinstance(payload, dict):
        return default_caller
    candidate = _normalize_e164(payload.get(str(tenant_id)))
    if candidate and _is_valid_e164(candidate):
        return candidate
    return default_caller


def _status_callback_url(
    *,
    tenant_id: str,
    user_key: str,
    direction: str,
    to_number: str,
    from_number: str,
) -> str:
    return (
        f"{_public_api_url('/voice/status')}"
        f"?tenantId={quote(str(tenant_id))}"
        f"&userId={quote(str(user_key))}"
        f"&direction={quote(str(direction))}"
        f"&to={quote(str(to_number))}"
        f"&from={quote(str(from_number))}"
    )


def _base_log_payload(
    *,
    actor: VoiceActor,
    direction: str,
    to_number: str,
    from_number: str,
    call_sid: Optional[str] = None,
    status: Optional[str] = None,
) -> dict:
    now_iso = _utc_now_iso()
    return {
        "tenantId": actor.tenant_id,
        "userId": actor.user_key,
        "direction": direction,
        "to": to_number,
        "from": from_number,
        "callSid": str(call_sid or "").strip(),
        "status": status or "initiated",
        "startedAt": now_iso,
        "updatedAt": now_iso,
        "createdAt": now_iso,
    }


def _dial_rate_key(actor: VoiceActor, req: func.HttpRequest) -> str:
    return f"{actor.tenant_id}:{actor.user_key}:{_extract_client_ip(req)}"


def _twiml_rate_key(identity: str, req: func.HttpRequest) -> str:
    return f"{identity}:{_extract_client_ip(req)}"


def _resolve_actor_from_auth(req: func.HttpRequest, body: Optional[dict], cors: Dict[str, str]) -> tuple[Optional[VoiceActor], Optional[func.HttpResponse]]:
    email = _extract_email(req, body)
    if not email:
        return None, _json_response({"error": "authentication required"}, 401, cors)
    db = SessionLocal()
    try:
        actor = _resolve_actor_by_email(db, email)
    finally:
        db.close()
    if not actor:
        return None, _json_response({"error": "unable to resolve tenant context"}, 401, cors)
    if not _is_allowed_sales_role(actor.role, actor.scope):
        return None, _json_response({"error": "forbidden"}, 403, cors)
    return actor, None


@app.function_name(name="VoiceToken")
@app.route(route="voice/token", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def voice_token(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    actor, error_response = _resolve_actor_from_auth(req, None, cors)
    if error_response:
        return error_response
    try:
        identity = _build_identity(actor)
        jwt = _voice_access_token(identity)
        return _json_response(
            {
                "token": jwt,
                "identity": identity,
                "expiresIn": VOICE_TOKEN_TTL_SECONDS,
                "tenantId": actor.tenant_id,
                "userId": actor.user_key,
                "callerId": _caller_id_for_tenant(actor.tenant_id),
            },
            200,
            cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Voice token mint failed: %s", exc)
        return _json_response({"error": "unable to mint token"}, 500, cors)


@app.function_name(name="VoiceTwiml")
@app.route(route="voice/twiml", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def voice_twiml(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    form_payload, _ = _parse_twilio_form(req)
    if not _validate_twilio_signature(req, form_payload):
        return _json_response({"error": "invalid twilio signature"}, 403, cors)

    raw_from = str(form_payload.get("From") or "").strip()
    identity = raw_from.split("client:", 1)[1] if raw_from.startswith("client:") else raw_from
    if ":" not in identity:
        return _json_response({"error": "invalid identity"}, 403, cors)
    allowed, retry_after = VOICE_DIAL_RATE_LIMITER.allow(_twiml_rate_key(identity, req))
    if not allowed:
        return _json_response(
            {"error": "rate_limited", "retryAfter": retry_after},
            429,
            {**cors, "Retry-After": str(retry_after)},
        )

    db = SessionLocal()
    try:
        actor = _resolve_actor_from_identity(db, identity)
    finally:
        db.close()
    if not actor or not _is_allowed_sales_role(actor.role, actor.scope):
        return _json_response({"error": "forbidden"}, 403, cors)

    to_number = _normalize_e164(form_payload.get("To"))
    if not _is_valid_e164(to_number):
        return _json_response({"error": "invalid_to_number"}, 400, cors)
    if _is_blocked_number(to_number):
        return _json_response({"error": "target number blocked"}, 400, cors)

    caller_id = _caller_id_for_tenant(actor.tenant_id)
    status_callback = _status_callback_url(
        tenant_id=actor.tenant_id,
        user_key=actor.user_key,
        direction="outbound",
        to_number=to_number,
        from_number=caller_id,
    )
    twilio_call_sid = str(form_payload.get("CallSid") or "").strip()
    if twilio_call_sid:
        upsert_call_log(
            actor.tenant_id,
            twilio_call_sid,
            _base_log_payload(
                actor=actor,
                direction="outbound",
                to_number=to_number,
                from_number=caller_id,
                call_sid=twilio_call_sid,
                status="initiated",
            ),
        )

    response = VoiceResponse()
    dial = response.dial(caller_id=caller_id, answer_on_bridge=True)
    dial.number(
        to_number,
        status_callback=status_callback,
        status_callback_event="initiated ringing answered completed",
        status_callback_method="POST",
    )
    return func.HttpResponse(str(response), status_code=200, mimetype="application/xml", headers=cors)


@app.function_name(name="VoiceDialout")
@app.route(route="voice/dialout", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def voice_dialout(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    body = body or {}

    actor, error_response = _resolve_actor_from_auth(req, body, cors)
    if error_response:
        return error_response
    allowed, retry_after = VOICE_DIAL_RATE_LIMITER.allow(_dial_rate_key(actor, req))
    if not allowed:
        return _json_response(
            {"error": "rate_limited", "retryAfter": retry_after},
            429,
            {**cors, "Retry-After": str(retry_after)},
        )

    to_number = _normalize_e164(body.get("to") or body.get("To"))
    rep_phone = _normalize_e164(body.get("repPhone") or body.get("rep_phone") or actor.default_rep_phone)
    if not _is_valid_e164(to_number):
        return _json_response({"error": "invalid_to_number"}, 400, cors)
    if _is_blocked_number(to_number):
        return _json_response({"error": "target number blocked"}, 400, cors)
    if not _is_valid_e164(rep_phone):
        return _json_response({"error": "valid repPhone is required for dial-out fallback"}, 400, cors)

    caller_id = _caller_id_for_tenant(actor.tenant_id)
    bridge_status_callback = _status_callback_url(
        tenant_id=actor.tenant_id,
        user_key=actor.user_key,
        direction="outbound",
        to_number=to_number,
        from_number=caller_id,
    )
    rep_status_callback = _status_callback_url(
        tenant_id=actor.tenant_id,
        user_key=actor.user_key,
        direction="dialout_rep_leg",
        to_number=rep_phone,
        from_number=caller_id,
    )

    bridge_twiml = VoiceResponse()
    bridge_twiml.say("Connecting your sales call.")
    dial = bridge_twiml.dial(caller_id=caller_id, answer_on_bridge=True)
    dial.number(
        to_number,
        status_callback=bridge_status_callback,
        status_callback_event="initiated ringing answered completed",
        status_callback_method="POST",
    )

    try:
        twilio_client = _twilio_client()
        call = twilio_client.calls.create(
            to=rep_phone,
            from_=caller_id,
            twiml=str(bridge_twiml),
            status_callback=rep_status_callback,
            status_callback_event=["initiated", "ringing", "answered", "completed"],
            status_callback_method="POST",
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Dial-out call creation failed: %s", exc)
        return _json_response({"error": "dial-out failed"}, 500, cors)

    upsert_call_log(
        actor.tenant_id,
        str(call.sid),
        _base_log_payload(
            actor=actor,
            direction="dialout_rep_leg",
            to_number=rep_phone,
            from_number=caller_id,
            call_sid=str(call.sid),
            status=str(call.status or "queued"),
        ),
    )

    return _json_response(
        {
            "ok": True,
            "callSid": str(call.sid),
            "status": str(call.status or "queued"),
            "to": to_number,
            "repPhone": rep_phone,
            "from": caller_id,
        },
        200,
        cors,
    )


@app.function_name(name="VoiceStatus")
@app.route(route="voice/status", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def voice_status(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    form_payload, _ = _parse_twilio_form(req)
    if not _validate_twilio_signature(req, form_payload):
        return _json_response({"error": "invalid twilio signature"}, 403, cors)

    call_sid = str(form_payload.get("CallSid") or "").strip()
    if not call_sid:
        return _json_response({"ok": True}, 200, cors)

    tenant_id = str(req.params.get("tenantId") or form_payload.get("tenantId") or "").strip()
    user_key = str(req.params.get("userId") or form_payload.get("userId") or "").strip()
    direction = str(req.params.get("direction") or form_payload.get("direction") or "outbound").strip()
    to_number = _normalize_e164(req.params.get("to") or form_payload.get("To"))
    from_number = _normalize_e164(req.params.get("from") or form_payload.get("From"))
    call_status = str(form_payload.get("CallStatus") or form_payload.get("DialCallStatus") or "").strip().lower()
    duration_raw = form_payload.get("CallDuration") or form_payload.get("DialCallDuration")
    recording_url = str(form_payload.get("RecordingUrl") or "").strip()
    now_iso = _utc_now_iso()

    if not tenant_id:
        raw_from = str(form_payload.get("From") or "")
        identity = raw_from.split("client:", 1)[1] if raw_from.startswith("client:") else raw_from
        if ":" in identity:
            tenant_id = identity.split(":", 1)[0].strip()
    if not tenant_id:
        logger.warning("Voice status callback ignored: missing tenant id for sid=%s", call_sid)
        return _json_response({"ok": True}, 200, cors)

    patch: dict[str, Any] = {
        "tenantId": tenant_id,
        "userId": user_key,
        "direction": direction or "outbound",
        "to": to_number,
        "from": from_number,
        "status": call_status or "unknown",
        "callSid": call_sid,
        "updatedAt": now_iso,
    }
    if call_status in {"initiated", "ringing", "answered", "in-progress", "queued"}:
        patch.setdefault("startedAt", now_iso)
    if call_status in TERMINAL_STATUSES:
        patch["endedAt"] = now_iso
    if duration_raw not in (None, ""):
        try:
            patch["duration"] = max(0, int(duration_raw))
        except (TypeError, ValueError):
            pass
    if recording_url:
        patch["recordingUrl"] = recording_url

    upsert_call_log(tenant_id, call_sid, patch)
    return _json_response({"ok": True}, 200, cors)


@app.function_name(name="VoiceLogs")
@app.route(route="voice/logs", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def voice_logs(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    actor, error_response = _resolve_actor_from_auth(req, None, cors)
    if error_response:
        return error_response

    limit_raw = req.params.get("limit")
    try:
        limit = int(limit_raw) if limit_raw else 20
    except ValueError:
        limit = 20
    limit = max(1, min(100, limit))

    include_all = str(req.params.get("all") or "").strip().lower() in {"1", "true", "yes"}
    is_admin = actor.scope == "primary_user" or re.sub(r"[\s_-]+", "", actor.role) == "admin"
    user_filter = None if (include_all and is_admin) else actor.user_key

    items = list_call_logs(actor.tenant_id, limit=limit, user_id=user_filter)
    return _json_response(
        {
            "items": items,
            "count": len(items),
            "tenantId": actor.tenant_id,
        },
        200,
        cors,
    )
