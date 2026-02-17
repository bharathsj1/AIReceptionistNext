import json
import logging
from datetime import datetime, timezone

import azure.functions as func
from sqlalchemy import func as sa_func, or_

from function_app import app
from onboarding_endpoints import get_twilio_client
from services.call_service import mark_call_ended, resolve_call, update_call_status, upsert_call
from services.ultravox_service import get_ultravox_call_messages
from shared.config import get_setting
from shared.db import Call, PhoneNumber, SessionLocal, Client, ClientUser, User
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)
TERMINAL_CALL_STATUSES = {"completed", "ended", "canceled", "cancelled", "failed", "busy", "no-answer"}


def _normalize_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def _resolve_client_by_email(db, email: str | None) -> Client | None:
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
        return client

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
        return db.query(Client).filter_by(id=client_user.client_id).one_or_none()

    user = (
        db.query(User)
        .filter(sa_func.lower(sa_func.trim(User.email)) == normalized)
        .order_by(User.id.asc())
        .first()
    )
    if user:
        return db.query(Client).filter_by(user_id=user.id).one_or_none()
    return None


def _to_naive_utc(value: datetime | None) -> datetime | None:
    if not value:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _parse_iso_to_naive_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return _to_naive_utc(parsed)


def _reconcile_call_status_with_twilio(db, calls: list[Call]) -> None:
    active_calls = [
        call
        for call in calls
        if not call.ended_at or str(call.status or "").strip().lower() not in TERMINAL_CALL_STATUSES
    ]
    if not active_calls:
        return
    try:
        twilio_client = get_twilio_client()
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Calls reconciliation skipped: Twilio unavailable: %s", exc)
        return

    now = datetime.utcnow()
    changed = False
    for call in active_calls:
        try:
            twilio_call = twilio_client.calls(call.twilio_call_sid).fetch()
        except Exception as exc:  # pylint: disable=broad-except
            logger.debug("Twilio fetch skipped for sid=%s: %s", call.twilio_call_sid, exc)
            continue

        twilio_status = str(getattr(twilio_call, "status", "") or "").strip().lower()
        twilio_end = _to_naive_utc(getattr(twilio_call, "end_time", None))

        if twilio_status and twilio_status != str(call.status or "").strip().lower():
            call.status = twilio_status
            changed = True
        if twilio_end and call.ended_at != twilio_end:
            call.ended_at = twilio_end
            changed = True
        elif twilio_status in TERMINAL_CALL_STATUSES and not call.ended_at:
            call.ended_at = now
            changed = True

    if changed:
        db.flush()


def _verify_ultravox_secret(req: func.HttpRequest) -> bool:
    secret = get_setting("ULTRAVOX_WEBHOOK_SECRET")
    if not secret:
        return True
    provided = (
        req.headers.get("X-Ultravox-Webhook-Secret")
        or req.headers.get("X-Webhook-Secret")
        or req.params.get("secret")
    )
    return bool(provided and provided == secret)


def _normalize_messages(raw_messages: list[dict]) -> list[dict]:
    normalized = []
    for idx, msg in enumerate(raw_messages or []):
        if not isinstance(msg, dict):
            continue
        text = msg.get("text") or msg.get("content") or msg.get("message") or ""
        role = (msg.get("role") or msg.get("speaker") or msg.get("speakerRole") or "system").lower()
        timestamp = msg.get("timestamp") or msg.get("created_at") or msg.get("createdAt") or msg.get("time")
        normalized.append(
            {
                "role": role,
                "text": text,
                "timestamp": timestamp,
                "ordinal": msg.get("ordinal", idx),
            }
        )
    return normalized


@app.function_name(name="UltravoxWebhook")
@app.route(route="ultravox/webhook", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def ultravox_webhook(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if not _verify_ultravox_secret(req):
        logger.warning("Ultravox webhook rejected: invalid secret")
        return func.HttpResponse(
            json.dumps({"error": "unauthorized"}),
            status_code=401,
            mimetype="application/json",
            headers=cors,
        )

    try:
        body = req.get_json()
    except ValueError:
        body = None
    body = body or {}

    event = (body.get("event") or body.get("type") or "").lower()
    event_id = body.get("id") or body.get("eventId") or body.get("event_id")
    call_payload = body.get("call") or {}
    call_id = (
        body.get("callId")
        or body.get("call_id")
        or call_payload.get("id")
        or call_payload.get("callId")
        or call_payload.get("call_id")
    )
    metadata = call_payload.get("metadata") or body.get("metadata") or {}
    twilio_sid = metadata.get("twilioCallSid") or metadata.get("twilio_call_sid")

    logger.info("Ultravox webhook event=%s event_id=%s call_id=%s twilio_sid=%s", event, event_id, call_id, twilio_sid)

    if event not in {"call.started", "call.ended", "call.failed"}:
        return func.HttpResponse(json.dumps({"status": "ignored"}), status_code=200, mimetype="application/json", headers=cors)

    db = SessionLocal()
    try:
        call = resolve_call(db, call_id, twilio_sid)
        if not call and twilio_sid:
            call = upsert_call(
                db,
                twilio_sid,
                caller_number=None,
                ai_phone_number=metadata.get("aiPhoneNumber"),
                status="initiated",
                selected_agent_id=metadata.get("selectedAgentId"),
            )
            call.ultravox_call_id = call_id or call.ultravox_call_id
            db.flush()
        if not call:
            logger.warning("Ultravox webhook: call not found for call_id=%s twilio_sid=%s", call_id, twilio_sid)
            return func.HttpResponse(
                json.dumps({"status": "not_found"}),
                status_code=202,
                mimetype="application/json",
                headers=cors,
            )
        if call_id and not call.ultravox_call_id:
            call.ultravox_call_id = call_id
        if event == "call.started":
            update_call_status(db, call, "in_progress")
        elif event == "call.failed":
            update_call_status(db, call, "failed")
        else:
            mark_call_ended(db, call, ended_at=datetime.utcnow())
        db.commit()
        return func.HttpResponse(json.dumps({"status": "ok"}), status_code=200, mimetype="application/json", headers=cors)
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Ultravox webhook failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Webhook processing failed"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="CallsList")
@app.route(route="calls", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def calls_list(req: func.HttpRequest) -> func.HttpResponse:
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

    db = SessionLocal()
    try:
        client = _resolve_client_by_email(db, email)
        if not client:
            return func.HttpResponse(
                json.dumps({"calls": []}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )
        numbers = [
            p.twilio_phone_number
            for p in db.query(PhoneNumber).filter_by(client_id=client.id, is_active=True)
        ]
        query = db.query(Call)
        ai_phone_number = req.params.get("aiPhoneNumber") or req.params.get("ai_phone_number")
        start_from = req.params.get("from")
        start_to = req.params.get("to")
        if ai_phone_number:
            query = query.filter(Call.ai_phone_number == ai_phone_number)
        elif numbers:
            query = query.filter(Call.ai_phone_number.in_(numbers))
        if start_from:
            parsed_from = _parse_iso_to_naive_utc(start_from)
            if parsed_from:
                query = query.filter(Call.started_at >= parsed_from)
        if start_to:
            parsed_to = _parse_iso_to_naive_utc(start_to)
            if parsed_to:
                query = query.filter(Call.started_at <= parsed_to)
        calls = query.order_by(Call.started_at.desc(), Call.created_at.desc()).limit(200).all()
        _reconcile_call_status_with_twilio(db, calls)
        db.commit()
        payload = [
            {
                "id": c.id,
                "sid": c.twilio_call_sid,
                "twilio_call_sid": c.twilio_call_sid,
                "ultravox_call_id": c.ultravox_call_id,
                "caller_number": c.caller_number,
                "ai_phone_number": c.ai_phone_number,
                "selected_agent_id": c.selected_agent_id,
                "status": c.status,
                "started_at": c.started_at.isoformat() if c.started_at else None,
                "start_time": c.started_at.isoformat() if c.started_at else None,
                "ended_at": c.ended_at.isoformat() if c.ended_at else None,
                "end_time": c.ended_at.isoformat() if c.ended_at else None,
                "duration": (
                    max(0, int((c.ended_at - c.started_at).total_seconds()))
                    if c.started_at and c.ended_at
                    else None
                ),
            }
            for c in calls
        ]
        return func.HttpResponse(json.dumps({"calls": payload}), status_code=200, mimetype="application/json", headers=cors)
    finally:
        db.close()


@app.function_name(name="CallTranscript")
@app.route(route="calls/{call_id}/transcript", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def call_transcript(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    call_id = req.route_params.get("call_id")
    if not call_id:
        return func.HttpResponse(json.dumps({"error": "call_id is required"}), status_code=400, mimetype="application/json", headers=cors)

    db = SessionLocal()
    try:
        call = None
        if call_id.isdigit():
            call = db.query(Call).filter_by(id=int(call_id)).one_or_none()
        if not call:
            call = db.query(Call).filter_by(twilio_call_sid=call_id).one_or_none()
        if not call:
            return func.HttpResponse(json.dumps({"error": "call not found"}), status_code=404, mimetype="application/json", headers=cors)

        if call.ultravox_call_id:
            try:
                raw_messages = get_ultravox_call_messages(call.ultravox_call_id)
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("Transcript fetch failed for call_id=%s: %s", call.ultravox_call_id, exc)
                return func.HttpResponse(
                    json.dumps({"error": "Failed to fetch transcript"}),
                    status_code=500,
                    mimetype="application/json",
                    headers=cors,
                )
            normalized = _normalize_messages(raw_messages)
            return func.HttpResponse(
                json.dumps({"call": {"id": call.id, "twilio_call_sid": call.twilio_call_sid}, "messages": normalized}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

        return func.HttpResponse(
            json.dumps({"error": "Transcript not ready yet"}),
            status_code=409,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()
