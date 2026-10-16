"""Tenant-owned call history and durable Ultravox conversation transcripts.

Provider reference: https://docs.ultravox.ai/api-reference/calls/calls-messages-list
Fetch every in-call stage and cursor page. Never forward credentials to a next URL.
"""
import logging
import math
import os
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, quote, urlparse

import requests
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError

from shared.db import OutreachCallEvent, OutreachConversation, OutreachLead

logger = logging.getLogger(__name__)
TERMINAL = {"completed", "busy", "no-answer", "failed", "canceled"}


def iso(value):
    return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z") if value else None


def parse_time(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
    except (ValueError, OverflowError):
        return None


def seconds(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(str(value).removesuffix("s"))
        return result if math.isfinite(result) and result >= 0 else None
    except (ValueError, TypeError):
        return None


def log_event(db, lead, event, detail=None):
    db.add(OutreachCallEvent(lead_id=lead.id, event=event, detail=detail))


def ensure_conversation(db, lead):
    record = db.get(OutreachConversation, lead.id)
    if record is None:
        # Savepoints handle two viewers opening a historical call at the same time.
        try:
            with db.begin_nested():
                record = OutreachConversation(lead_id=lead.id, messages=[], message_count=0,
                    status="pending", is_final=False, sync_attempts=0)
                db.add(record)
                db.flush()
        except IntegrityError:
            record = db.get(OutreachConversation, lead.id)
    return record


def normalize_messages(raw):
    messages, seen, text_size = [], set(), 0
    for index, message in enumerate(raw):
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or message.get("speaker") or "").lower().removeprefix("message_role_")
        speaker = {"user": "contact", "agent": "ai", "assistant": "ai"}.get(role)
        text = message.get("text")
        # System prompts, tool invocations and tool responses are not spoken dialogue.
        if not speaker or not isinstance(text, str) or not text.strip() or message.get("toolName"):
            continue
        text_size += len(text)
        if text_size > 2_000_000:
            raise ValueError("Transcript exceeds the supported size")
        stage, stage_index = message.get("callStageId"), message.get("callStageMessageIndex")
        identity = (stage, stage_index) if stage is not None and stage_index is not None else None
        if identity and identity in seen:
            continue
        if identity:
            seen.add(identity)
        span = message.get("wallClockTimespan") or message.get("timespan") or {}
        offset = seconds(span.get("start")) if isinstance(span, dict) else None
        messages.append({"id": f"{stage}:{stage_index}" if identity else str(index),
                         "speaker": speaker, "text": text.strip(), "offset_seconds": offset,
                         "ordinal": index})
    # Prefer wall-clock offsets across stages; preserve provider order where timing is absent.
    if messages and all(message["offset_seconds"] is not None for message in messages):
        messages.sort(key=lambda message: (message["offset_seconds"], message["ordinal"]))
    return messages


def fetch_provider_conversation(call_id):
    key = os.getenv("ULTRAVOX_API_KEY", "")
    if not key:
        raise ValueError("Ultravox is not configured. Ask your administrator to connect it.")
    base = os.getenv("ULTRAVOX_BASE_URL", "https://api.ultravox.ai/api").rstrip("/")
    url = f"{base}/calls/{quote(str(call_id), safe='')}"
    headers = {"X-API-Key": key}
    # A single timeout budget bounds the whole fetch, including paginated transcripts.
    deadline = time.monotonic() + 25

    def get(path, params=None):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise requests.Timeout()
        response = requests.get(path, headers=headers, params=params,
                                timeout=min(10, remaining), allow_redirects=False)
        if response.status_code == 404:
            raise LookupError("The transcript is not currently available from Ultravox.")
        if response.status_code != 200:
            raise ValueError("Ultravox could not return this conversation. Try refreshing later.")
        return response.json()

    details = get(url)
    if not isinstance(details, dict):
        raise ValueError("Ultravox returned an invalid call record.")
    raw, cursor, visited = [], None, set()
    for _ in range(50):
        params = {"mode": "in_call", "pageSize": 200}
        if cursor:
            params["cursor"] = cursor
        payload = get(f"{url}/messages", params)
        page = payload.get("results") if isinstance(payload, dict) else payload
        if not isinstance(page, list):
            raise ValueError("Ultravox returned an invalid transcript page.")
        raw.extend(page)
        if len(raw) > 10000:
            raise ValueError("Transcript exceeds the supported message count.")
        next_url = payload.get("next") if isinstance(payload, dict) else None
        if not next_url:
            return details, normalize_messages(raw)
        # Extract only the cursor; do not request provider-supplied URLs with our API key.
        if not isinstance(next_url, str):
            raise ValueError("Ultravox returned an invalid transcript cursor.")
        cursor = parse_qs(urlparse(next_url).query).get("cursor", [None])[0]
        if not cursor or cursor in visited:
            raise ValueError("Ultravox returned a repeated or missing transcript cursor.")
        visited.add(cursor)
    raise ValueError("Transcript pagination did not finish. Try refreshing later.")


def sync_conversation(db, lead, force=False, now=None):
    now = now or datetime.utcnow()
    record = ensure_conversation(db, lead)
    if not lead.ultravox_call_id or (record.is_final and (record.message_count or not force)):
        db.commit()
        return record
    # Throttle viewers and worker attempts together, including explicit refresh clicks.
    if record.checked_at and record.checked_at > now - timedelta(seconds=15):
        return record
    if not force and record.next_sync_at and record.next_sync_at > now:
        return record
    claimed = db.query(OutreachConversation).filter_by(lead_id=lead.id).filter(
        or_(OutreachConversation.is_final.is_(False), OutreachConversation.message_count == 0 if force else False)).filter(
        or_(OutreachConversation.locked_until.is_(None), OutreachConversation.locked_until < now)).update(
            {"locked_until": now + timedelta(seconds=45)}, synchronize_session=False)
    db.commit()
    if not claimed:
        db.refresh(record)
        return record
    try:
        details, messages = fetch_provider_conversation(lead.ultravox_call_id)
        db.refresh(record)
        # A shortened or temporarily empty provider response must not erase saved dialogue.
        if len(messages) < (record.message_count or 0):
            raise ValueError("Ultravox returned an incomplete update. The saved transcript is preserved.")
        record.messages, record.message_count = messages, len(messages)
        record.joined_at = parse_time(details.get("joined")) or record.joined_at
        record.provider_ended_at = parse_time(details.get("ended")) or record.provider_ended_at
        record.end_reason = details.get("endReason") if isinstance(details.get("endReason"), str) else record.end_reason
        if record.joined_at and record.provider_ended_at:
            record.duration_seconds = max(0, (record.provider_ended_at - record.joined_at).total_seconds())
        settled = bool(record.provider_ended_at and record.provider_ended_at <= now - timedelta(seconds=60))
        record.is_final = settled and (bool(messages) or record.sync_attempts >= 2)
        record.status = "ready" if record.is_final and messages else "empty" if record.is_final else "partial" if messages else "pending"
        record.error = None
        record.synced_at = now
    except Exception as exc:
        db.refresh(record)
        # Provider responses and message text must never be written to application logs.
        logger.warning("Conversation sync failed for lead %s (%s)", lead.id, type(exc).__name__)
        record.error = str(exc) if isinstance(exc, (ValueError, LookupError)) else "The conversation service is temporarily unavailable. Your saved transcript is preserved."
        if not record.message_count:
            record.status = "unavailable"
    finally:
        record.checked_at = now
        record.sync_attempts += 1
        record.next_sync_at = None if record.is_final else now + timedelta(seconds=min(1800, 30 * 2 ** min(record.sync_attempts - 1, 6)))
        record.locked_until = None
        db.commit()
    return record


def sync_pending_conversations(db, limit=10):
    now = datetime.utcnow()
    leads = db.query(OutreachLead).outerjoin(OutreachConversation, OutreachConversation.lead_id == OutreachLead.id).filter(
        OutreachLead.ultravox_call_id.isnot(None),
        or_(OutreachConversation.lead_id.is_(None),
            (OutreachConversation.is_final.is_(False) & (OutreachConversation.sync_attempts < 24) &
             or_(OutreachConversation.next_sync_at.is_(None), OutreachConversation.next_sync_at <= now))),
    ).order_by(OutreachConversation.next_sync_at.asc(), OutreachLead.started_at.asc()).limit(limit).all()
    for lead in leads:
        sync_conversation(db, lead, now=now)


def transcript_status(lead, record):
    if not lead.started_at:
        status = "not_started"
    elif not lead.ultravox_call_id:
        status = "unavailable" if lead.status in TERMINAL | {"needs_review"} else "pending"
    else:
        status = record.status if record else "pending"
    return status


def transcript_payload(lead, record):
    return {"status": transcript_status(lead, record), "messages": record.messages if record else [],
            "is_final": record.is_final if record else False,
            "message_count": record.message_count if record else 0,
            "synced_at": iso(record.synced_at) if record else None,
            "checked_at": iso(record.checked_at) if record else None,
            "error": record.error if record else None}


def call_payload(lead, campaign, conversation=None):
    return {"id": lead.id, "campaign_id": campaign.id, "campaign_name": campaign.name,
            "restaurant_name": lead.restaurant_name, "phone": lead.phone, "caller_id": campaign.caller_id,
            "status": lead.status, "error": lead.error, "result": lead.result,
            "started_at": iso(lead.started_at), "ended_at": iso(lead.ended_at),
            "answered_at": iso(conversation.joined_at) if conversation else None,
            "duration_seconds": conversation.duration_seconds if conversation else None,
            "twilio_call_sid": lead.twilio_call_sid, "ultravox_call_id": lead.ultravox_call_id,
            "notification_status": lead.notification_status,
            "transcript_status": transcript_status(lead, conversation),
            "transcript_message_count": conversation.message_count if conversation else 0,
            "transcript_is_final": conversation.is_final if conversation else False}
