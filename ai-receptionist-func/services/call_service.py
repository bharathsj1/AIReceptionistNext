import logging
from datetime import datetime

from shared.db import Call

logger = logging.getLogger(__name__)


def upsert_call(
    db,
    twilio_call_sid: str,
    caller_number: str | None,
    ai_phone_number: str | None,
    status: str,
    selected_agent_id: str | None = None,
) -> Call:
    call = db.query(Call).filter_by(twilio_call_sid=twilio_call_sid).one_or_none()
    now = datetime.utcnow()
    if call:
        call.caller_number = caller_number or call.caller_number
        call.ai_phone_number = ai_phone_number or call.ai_phone_number
        call.selected_agent_id = selected_agent_id or call.selected_agent_id
        call.status = status or call.status
        call.started_at = call.started_at or now
        call.updated_at = now
        db.flush()
        return call
    call = Call(
        twilio_call_sid=twilio_call_sid,
        caller_number=caller_number,
        ai_phone_number=ai_phone_number,
        selected_agent_id=selected_agent_id,
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


def mark_call_ended(db, call: Call, ended_at: datetime | None = None) -> None:
    call.status = "ended"
    call.ended_at = ended_at or datetime.utcnow()
    call.updated_at = datetime.utcnow()
    db.flush()


def update_call_status(db, call: Call, status: str) -> None:
    call.status = status
    call.updated_at = datetime.utcnow()
    db.flush()
