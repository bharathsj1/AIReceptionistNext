import json
import logging
from datetime import datetime
from typing import Iterable, Tuple

from shared.db import Call, CallMessage

logger = logging.getLogger(__name__)


def upsert_call(db, twilio_call_sid: str, from_number: str | None, to_number: str | None, status: str) -> Call:
    call = db.query(Call).filter_by(twilio_call_sid=twilio_call_sid).one_or_none()
    now = datetime.utcnow()
    if call:
        call.from_number = from_number or call.from_number
        call.to_number = to_number or call.to_number
        call.status = status or call.status
        call.started_at = call.started_at or now
        call.updated_at = now
        db.flush()
        return call
    call = Call(
        twilio_call_sid=twilio_call_sid,
        from_number=from_number,
        to_number=to_number,
        status=status,
        started_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(call)
    db.flush()
    return call


def attach_ultravox_call(db, twilio_call_sid: str, ultravox_call_id: str | None) -> Call | None:
    if not ultravox_call_id:
        return None
    call = db.query(Call).filter_by(twilio_call_sid=twilio_call_sid).one_or_none()
    if not call:
        return None
    if not call.ultravox_call_id:
        call.ultravox_call_id = ultravox_call_id
        call.updated_at = datetime.utcnow()
        db.flush()
    return call


def resolve_call(db, ultravox_call_id: str | None, twilio_sid: str | None) -> Call | None:
    if ultravox_call_id:
        call = db.query(Call).filter_by(ultravox_call_id=ultravox_call_id).one_or_none()
        if call:
            return call
    if twilio_sid:
        return db.query(Call).filter_by(twilio_call_sid=twilio_sid).one_or_none()
    return None


def _extract_message_text(msg: dict) -> str:
    for key in ("text", "content", "message"):
        val = msg.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _extract_message_role(msg: dict) -> str:
    for key in ("role", "speaker", "speakerRole", "speaker_role"):
        val = msg.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip().lower()
    return "system"


def _extract_message_ts(msg: dict) -> datetime | None:
    for key in ("timestamp", "created_at", "createdAt", "time"):
        val = msg.get(key)
        if isinstance(val, str) and val.strip():
            try:
                return datetime.fromisoformat(val.replace("Z", "+00:00"))
            except ValueError:
                continue
    return None


def store_call_messages(db, call: Call, messages: Iterable[dict]) -> Tuple[int, str]:
    stored = 0
    transcript_lines = []
    for idx, msg in enumerate(messages):
        if not isinstance(msg, dict):
            continue
        existing = (
            db.query(CallMessage)
            .filter_by(call_id=call.id, ordinal=idx)
            .one_or_none()
        )
        if existing:
            continue
        text = _extract_message_text(msg)
        role = _extract_message_role(msg)
        timestamp = _extract_message_ts(msg)
        raw_json = json.dumps(msg)
        db.add(
            CallMessage(
                call_id=call.id,
                speaker_role=role,
                text=text,
                message_ts=timestamp,
                ordinal=idx,
                raw_json=raw_json,
            )
        )
        stored += 1
        if text:
            transcript_lines.append(f"{role}: {text}")
    if transcript_lines:
        call.transcript_text = "\n".join(transcript_lines)
    call.updated_at = datetime.utcnow()
    db.flush()
    return stored, call.transcript_text or ""


def mark_call_ended(db, call: Call, ended_at: datetime | None = None) -> None:
    call.status = "ended"
    call.ended_at = ended_at or datetime.utcnow()
    call.updated_at = datetime.utcnow()
    db.flush()
