import json
import logging
from datetime import datetime

import azure.functions as func

from function_app import app
from services.call_service import mark_call_ended, resolve_call, store_call_messages, upsert_call
from services.ultravox_service import get_ultravox_call_messages
from shared.config import get_setting
from shared.db import Call, CallMessage, PhoneNumber, SessionLocal, Client
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


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

    if event != "call.ended":
        return func.HttpResponse(json.dumps({"status": "ignored"}), status_code=200, mimetype="application/json", headers=cors)

    db = SessionLocal()
    try:
        call = resolve_call(db, call_id, twilio_sid)
        if not call and twilio_sid:
            call = upsert_call(db, twilio_sid, None, None, "ended")
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

        mark_call_ended(db, call, ended_at=datetime.utcnow())
        if call_id:
            messages = get_ultravox_call_messages(call_id)
            stored, transcript_text = store_call_messages(db, call, messages)
            logger.info("Stored %s Ultravox messages for call_id=%s", stored, call_id)
            db.commit()
            return func.HttpResponse(
                json.dumps({"status": "ok", "stored": stored, "transcript_len": len(transcript_text or "")}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )
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
        client = db.query(Client).filter_by(email=email).one_or_none()
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
        if numbers:
            query = query.filter(Call.to_number.in_(numbers) | Call.from_number.in_(numbers))
        calls = query.order_by(Call.started_at.desc(), Call.created_at.desc()).limit(200).all()
        owned_numbers = set(numbers)
        payload = [
            {
                "id": c.id,
                "sid": c.twilio_call_sid,
                "twilio_call_sid": c.twilio_call_sid,
                "ultravox_call_id": c.ultravox_call_id,
                "from_number": c.from_number,
                "to_number": c.to_number,
                "status": c.status,
                "started_at": c.started_at.isoformat() if c.started_at else None,
                "start_time": c.started_at.isoformat() if c.started_at else None,
                "ended_at": c.ended_at.isoformat() if c.ended_at else None,
                "direction": "inbound" if c.to_number in owned_numbers else "outbound" if c.from_number in owned_numbers else "unknown",
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

        messages = (
            db.query(CallMessage)
            .filter_by(call_id=call.id)
            .order_by(CallMessage.ordinal.asc().nullslast(), CallMessage.message_ts.asc().nullslast())
            .all()
        )
        if messages:
            msg_payload = [
                {
                    "id": m.id,
                    "role": m.speaker_role,
                    "text": m.text,
                    "timestamp": m.message_ts.isoformat() if m.message_ts else None,
                    "ordinal": m.ordinal,
                }
                for m in messages
            ]
            transcript_text = call.transcript_text or "\n".join(
                [f"{m.speaker_role}: {m.text}" for m in messages if m.text]
            )
            return func.HttpResponse(
                json.dumps({"call": {"id": call.id, "twilio_call_sid": call.twilio_call_sid}, "messages": msg_payload, "transcript": transcript_text}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

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
                json.dumps({"call": {"id": call.id, "twilio_call_sid": call.twilio_call_sid}, "messages": normalized, "transcript": call.transcript_text}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

        return func.HttpResponse(
            json.dumps({"call": {"id": call.id, "twilio_call_sid": call.twilio_call_sid}, "messages": [], "transcript": call.transcript_text}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()
