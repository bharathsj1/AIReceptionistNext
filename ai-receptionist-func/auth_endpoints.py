import json
import logging
import secrets
import base64
import hashlib
import re
import smtplib
import ssl
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple
from zoneinfo import ZoneInfo
from urllib.parse import parse_qs, quote

import azure.functions as func
import requests
from sqlalchemy import func as sa_func, or_
from sqlalchemy.exc import OperationalError
from function_app import app
from shared.config import get_google_oauth_settings, get_outlook_oauth_settings, get_public_api_base, get_setting, get_smtp_settings
from shared.db import SessionLocal, User, Client, GoogleToken, OutlookToken, ClientUser
from utils.cors import build_cors_headers
from services.ultravox_service import (
    create_ultravox_webhook,
    ensure_booking_tool,
    ensure_availability_tool,
    ensure_tasks_tool,
    get_ultravox_agent,
    list_ultravox_tools,
)
from services.prompt_registry_service import generate_prompt_record

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return f"{salt}${hashed}"


def _verify_password(password: str, stored: str) -> bool:
    if "$" not in stored:
        return False
    salt, hashed = stored.split("$", 1)
    check = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return secrets.compare_digest(check, hashed)


def _normalize_email(value: Optional[str]) -> str:
    return str(value or "").strip().lower()


def _resolve_primary_user(db, email: Optional[str] = None, user_id: Optional[str] = None) -> Optional[User]:
    normalized = _normalize_email(email) if email else ""
    if normalized:
        user = (
            db.query(User)
            .filter(sa_func.lower(sa_func.trim(User.email)) == normalized)
            .order_by(User.id.asc())
            .first()
        )
        if user:
            return user
        cuser = (
            db.query(ClientUser)
            .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == normalized)
            .order_by(ClientUser.id.asc())
            .first()
        )
        if cuser:
            client = db.query(Client).filter_by(id=cuser.client_id).one_or_none()
            if client and client.user_id:
                return db.query(User).filter_by(id=client.user_id).one_or_none()
            if client and client.email:
                owner_email = _normalize_email(client.email)
                return (
                    db.query(User)
                    .filter(sa_func.lower(sa_func.trim(User.email)) == owner_email)
                    .order_by(User.id.asc())
                    .first()
                )
        return None
    if user_id:
        try:
            return db.query(User).filter_by(id=int(user_id)).one_or_none()
        except (TypeError, ValueError):
            return None
    return None


def _is_client_user_email(db, email: Optional[str]) -> bool:
    normalized = _normalize_email(email)
    if not normalized:
        return False
    entry = (
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
    return entry is not None


def _generate_reset_token() -> str:
    return secrets.token_urlsafe(32)


def _ensure_utc(dt: datetime) -> datetime:
    """
    Ensure datetimes have an explicit UTC timezone so Google Calendar accepts them.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _build_event_id(raw_id: Optional[str]) -> Optional[str]:
    """
    Build a Google Calendar event id suitable for idempotency.
    Rules: 5-1024 chars, letters/numbers/underscore only. We drop dashes and other chars to avoid "Invalid resource id".
    """
    if not raw_id:
        return None
    # Remove everything except alphanumerics/underscore to avoid Google 400.
    safe = re.sub(r"[^a-zA-Z0-9_]", "", str(raw_id)).lower()
    safe = safe.lstrip("_")
    if safe and not re.match(r"^[a-zA-Z0-9]", safe):
        safe = f"a{safe}"
    if len(safe) < 5:
        safe = (safe + "00000")[:5]
    if len(safe) > 1024:
        safe = safe[:1024]
    if not re.match(r"^[a-zA-Z0-9_]{5,1024}$", safe):
        return None
    return safe


def _merge_website_data(existing: Optional[str], additions: Dict[str, Any]) -> str:
    if not additions:
        return existing or ""
    base: Dict[str, Any] = {}
    if existing:
        try:
            parsed = json.loads(existing)
            if isinstance(parsed, dict):
                base = parsed
            else:
                base = {"raw_website_data": parsed}
        except json.JSONDecodeError:
            base = {"raw_website_data": existing}
    base.update(additions)
    return json.dumps(base)


def _normalize_business_profile(raw: Any) -> Optional[Dict[str, str]]:
    if raw is None:
        return None
    payload = raw
    if isinstance(raw, str):
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(payload, dict):
        return None
    source = payload.get("business_profile") if isinstance(payload.get("business_profile"), dict) else payload
    if not isinstance(source, dict):
        return None
    return {
        "business_name": str(source.get("business_name") or source.get("businessName") or source.get("name") or ""),
        "business_summary": str(source.get("business_summary") or source.get("businessSummary") or ""),
        "business_location": str(source.get("business_location") or source.get("location") or ""),
        "business_hours": str(source.get("business_hours") or source.get("hours") or ""),
        "business_openings": str(source.get("business_openings") or source.get("openings") or ""),
        "business_services": str(source.get("business_services") or source.get("services") or ""),
        "business_notes": str(source.get("business_notes") or source.get("notes") or ""),
        "contact_email": str(source.get("contact_email") or source.get("businessEmail") or source.get("contactEmail") or ""),
        "contact_phone": str(
            source.get("contact_phone")
            or source.get("businessPhone")
            or source.get("contactNumber")
            or source.get("business_phone")
            or ""
        ),
    }


def _extract_knowledge_text(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw.strip() or None
    if not isinstance(raw, dict):
        return None
    for key in ("knowledgeText", "knowledge_text", "raw_website_data", "website_text"):
        value = raw.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _trigger_prompt_generation_async(
    *,
    client_id: int,
    category: Optional[str],
    sub_type: Optional[str],
    task_type: Optional[str],
    business_profile: Optional[Dict[str, Any]],
    knowledge_text: Optional[str],
    created_by: str,
) -> None:
    if not client_id or not sub_type:
        return

    def _worker() -> None:
        db = SessionLocal()
        try:
            generate_prompt_record(
                db,
                client_id=client_id,
                category=category,
                sub_type=sub_type,
                task_type=task_type,
                business_profile=business_profile,
                knowledge_text=knowledge_text,
                created_by=created_by,
            )
            db.commit()
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Prompt generation failed: %s", exc)
            try:
                db.rollback()
            except Exception:  # pylint: disable=broad-except
                pass
        finally:
            db.close()

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()


def _parse_dt_with_london_default(value: str) -> datetime:
    """
    Parse an ISO timestamp; if no timezone, assume Europe/London, then convert to UTC.
    """
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        try:
            dt = dt.replace(tzinfo=ZoneInfo("Europe/London"))
        except Exception:  # pylint: disable=broad-except
            dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _extract_time_fields(payload: dict) -> Tuple[Optional[str], Optional[str], Optional[int], Optional[int]]:
    """
    Extract start/end/duration/buffer from known top-level or nested shapes.
    Accepts variants such as startTime/start_time and nested booking/appointment objects.
    """
    contexts = []
    if isinstance(payload, dict):
        contexts.append(payload)
        for key in ("call", "booking", "appointment"):
            child = payload.get(key)
            if isinstance(child, dict):
                contexts.append(child)
                for sub_key in ("booking", "appointment", "slot"):
                    sub_child = child.get(sub_key)
                    if isinstance(sub_child, dict):
                        contexts.append(sub_child)

    def first(*keys):
        for ctx in contexts:
            for key in keys:
                if key in ctx and ctx.get(key):
                    return ctx.get(key)
        return None

    start_iso = first(
        "start",
        "startTime",
        "start_time",
        "start_time_iso",
        "startTimeIso",
        "requestedStart",
        "requested_start",
    )
    end_iso = first(
        "end",
        "endTime",
        "end_time",
        "end_time_iso",
        "endTimeIso",
        "requestedEnd",
        "requested_end",
    )
    duration = first("duration_minutes", "durationMinutes", "duration")
    buffer = first("buffer_minutes", "bufferMinutes", "buffer")
    return start_iso, end_iso, duration, buffer


def _get_client_id(req: func.HttpRequest, body: Optional[dict] = None) -> Optional[int]:
    """
    Try to extract a client identifier from headers or body.
    Accepts: x-client-id, x-tenant-id headers or clientId / client_id / tenantId keys in the body.
    """
    body = body or {}
    candidates = []
    for key in ("clientId", "client_id", "tenantId", "tenant_id"):
        if key in body and body.get(key) is not None:
            candidates.append(body.get(key))
    for key in ("x-client-id", "x-tenant-id", "x-tenantid"):
        header_val = req.headers.get(key)
        if header_val:
            candidates.append(header_val)
    for val in candidates:
        try:
            cid = int(val)
            if cid > 0:
                return cid
        except (TypeError, ValueError):
            continue
    return None


def _get_request_user_email(req: func.HttpRequest) -> Optional[str]:
    for key in ("x-user-email", "X-User-Email", "x-useremail"):
        value = req.headers.get(key)
        if value:
            normalized = _normalize_email(value)
            if normalized:
                return normalized
    return None


def _send_appointment_confirmation_email(
    to_email: str,
    business_name: Optional[str],
    start_time: datetime,
    end_time: datetime,
    caller_name: Optional[str],
    business_phone: Optional[str],
    business_email: Optional[str],
) -> bool:
    smtp = get_smtp_settings()
    if not smtp.get("host") or not smtp.get("username") or not smtp.get("password"):
        logger.warning("SMTP not configured; skipping appointment confirmation email.")
        return False

    safe_business = business_name or "our team"
    subject = f"Appointment confirmed with {safe_business}"
    greeting = f"Hi {caller_name}," if caller_name else "Hi,"
    start_str = start_time.strftime("%A, %d %B %Y at %H:%M %Z")
    end_str = end_time.strftime("%H:%M %Z")
    contact_lines = []
    if business_phone:
        contact_lines.append(f"Phone: {business_phone}")
    if business_email:
        contact_lines.append(f"Email: {business_email}")
    contact_block = "\n".join(contact_lines)
    if contact_block:
        contact_block = f"\n\nContact details:\n{contact_block}"

    body = (
        f"{greeting}\n\n"
        f"Your appointment with {safe_business} is confirmed.\n"
        f"Time: {start_str} - {end_str}\n"
        "If you need to make changes, reply to this email or contact us directly."
        f"{contact_block}\n\n"
        "Thanks,\n"
        f"{safe_business}\n"
    )
    message = f"From: {smtp['from_email']}\r\nTo: {to_email}\r\nSubject: {subject}\r\n\r\n{body}"

    host = smtp["host"]
    use_tls = smtp.get("use_tls", True)
    use_ssl = smtp.get("use_ssl", False)
    port = smtp.get("port")

    if port is None:
        port = 465 if use_ssl else (587 if use_tls else 25)

    def _send():
        if use_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context) as server:
                server.ehlo()
                if smtp.get("username") and not server.has_extn("auth"):
                    raise RuntimeError("SMTP AUTH not supported on this endpoint/port.")
                if smtp.get("username"):
                    server.login(smtp["username"], smtp["password"])
                server.sendmail(smtp["from_email"], [to_email], message.encode("utf-8"))
        else:
            context = ssl.create_default_context() if use_tls else None
            with smtplib.SMTP(host, port) as server:
                server.ehlo()
                if use_tls:
                    server.starttls(context=context)
                    server.ehlo()
                if smtp.get("username") and not server.has_extn("auth"):
                    raise RuntimeError("SMTP AUTH not supported on this endpoint/port.")
                if smtp.get("username"):
                    server.login(smtp["username"], smtp["password"])
                server.sendmail(smtp["from_email"], [to_email], message.encode("utf-8"))

    try:
        _send()
        return True
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("First attempt to send appointment confirmation failed: %s", exc)
        try:
            _send()
            return True
        except Exception as exc2:  # pylint: disable=broad-except
            logger.error("Failed to send appointment confirmation after retry: %s", exc2)
            return False


def _send_password_reset_email(
    to_email: str,
    reset_link: str,
    app_reset_link: Optional[str] = None,
) -> bool:
    smtp = get_smtp_settings()
    if not smtp.get("host") or not smtp.get("from_email"):
        logger.warning("SMTP not configured; skipping password reset email.")
        return False
    if smtp.get("username") and not smtp.get("password"):
        logger.warning("SMTP username is set but password is missing; skipping password reset email.")
        return False

    subject = "Reset your SmartConnect4u password"
    preferred_link = app_reset_link or reset_link
    body = (
        "Hi,\n\n"
        "We received a request to reset your password.\n\n"
        f"Reset password: {preferred_link}\n"
    )
    if app_reset_link and reset_link and app_reset_link != reset_link:
        body += f"Fallback reset link: {reset_link}\n"
    body += (
        "\nThis link expires in 1 hour.\n"
        "If you did not request this, you can ignore this email.\n\n"
        "Thanks,\nSmartConnect4u\n"
    )

    message = (
        f"From: {smtp['from_email']}\r\n"
        f"To: {to_email}\r\n"
        f"Subject: {subject}\r\n"
        "\r\n"
        f"{body}"
    )

    host = smtp["host"]
    use_tls = smtp.get("use_tls", True)
    use_ssl = smtp.get("use_ssl", False)
    port = smtp.get("port")
    if port is None:
        port = 465 if use_ssl else (587 if use_tls else 25)

    def _send():
        if use_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context) as server:
                server.ehlo()
                if smtp.get("username") and not server.has_extn("auth"):
                    raise RuntimeError("SMTP AUTH not supported on this endpoint/port.")
                if smtp.get("username"):
                    server.login(smtp["username"], smtp["password"])
                server.sendmail(smtp["from_email"], [to_email], message.encode("utf-8"))
        else:
            context = ssl.create_default_context() if use_tls else None
            with smtplib.SMTP(host, port) as server:
                server.ehlo()
                if use_tls:
                    server.starttls(context=context)
                    server.ehlo()
                if smtp.get("username") and not server.has_extn("auth"):
                    raise RuntimeError("SMTP AUTH not supported on this endpoint/port.")
                if smtp.get("username"):
                    server.login(smtp["username"], smtp["password"])
                server.sendmail(smtp["from_email"], [to_email], message.encode("utf-8"))

    try:
        _send()
        return True
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("First attempt to send password reset email failed: %s", exc)
        try:
            _send()
            return True
        except Exception as exc2:  # pylint: disable=broad-except
            logger.error("Failed to send password reset email after retry: %s", exc2)
            return False


def _build_google_auth_url(state: str, force_consent: bool = False) -> str:
    settings = get_google_oauth_settings()
    scope = settings["scopes"]
    redirect_uri = settings["redirect_uri"]
    client_id = settings["client_id"]
    base = "https://accounts.google.com/o/oauth2/v2/auth"
    prompt = "consent" if force_consent else "select_account"
    return (
        f"{base}?response_type=code"
        f"&client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&scope={scope}"
        f"&access_type=offline"
        f"&include_granted_scopes=true"
        f"&prompt={prompt}"
        f"&state={state}"
    )


def _encode_oauth_state(payload: dict) -> str:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _decode_oauth_state(state: str | None) -> dict | None:
    if not state or not isinstance(state, str):
        return None
    try:
        padded = state + "=" * (-len(state) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("utf-8"))
        return json.loads(raw.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None


def _exchange_code_for_tokens(code: str) -> Tuple[Optional[dict], Optional[str]]:
    settings = get_google_oauth_settings()
    payload = {
        "code": code,
        "client_id": settings["client_id"],
        "client_secret": settings["client_secret"],
        "redirect_uri": settings["redirect_uri"],
        "grant_type": "authorization_code",
    }
    try:
        resp = requests.post("https://oauth2.googleapis.com/token", data=payload, timeout=10)
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _refresh_google_token(refresh_token: str) -> Tuple[Optional[dict], Optional[str]]:
    settings = get_google_oauth_settings()
    payload = {
        "refresh_token": refresh_token,
        "client_id": settings["client_id"],
        "client_secret": settings["client_secret"],
        "grant_type": "refresh_token",
    }
    try:
        resp = requests.post("https://oauth2.googleapis.com/token", data=payload, timeout=10)
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _get_google_userinfo(access_token: str) -> Tuple[Optional[dict], Optional[str]]:
    try:
        resp = requests.get(
            "https://www.googleapis.com/oauth2/v1/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
            params={"alt": "json"},
        )
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _build_outlook_auth_url(state: str) -> str:
    settings = get_outlook_oauth_settings()
    scope = quote(settings["scopes"])
    redirect_uri = quote(settings["redirect_uri"])
    client_id = settings["client_id"]
    tenant = settings["tenant"]
    base = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
    return (
        f"{base}?client_id={client_id}"
        f"&response_type=code"
        f"&redirect_uri={redirect_uri}"
        f"&response_mode=query"
        f"&scope={scope}"
        f"&prompt=select_account"
        f"&state={state}"
    )


def _exchange_outlook_code_for_tokens(code: str) -> Tuple[Optional[dict], Optional[str]]:
    settings = get_outlook_oauth_settings()
    payload = {
        "client_id": settings["client_id"],
        "client_secret": settings["client_secret"],
        "redirect_uri": settings["redirect_uri"],
        "grant_type": "authorization_code",
        "code": code,
        "scope": settings["scopes"],
    }
    token_url = f"https://login.microsoftonline.com/{settings['tenant']}/oauth2/v2.0/token"
    try:
        resp = requests.post(token_url, data=payload, timeout=10)
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _refresh_outlook_token(refresh_token: str) -> Tuple[Optional[dict], Optional[str]]:
    settings = get_outlook_oauth_settings()
    payload = {
        "client_id": settings["client_id"],
        "client_secret": settings["client_secret"],
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
        "scope": settings["scopes"],
    }
    token_url = f"https://login.microsoftonline.com/{settings['tenant']}/oauth2/v2.0/token"
    try:
        resp = requests.post(token_url, data=payload, timeout=10)
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _get_outlook_userinfo(access_token: str) -> Tuple[Optional[dict], Optional[str]]:
    try:
        resp = requests.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _get_calendar_list(access_token: str) -> Tuple[Optional[dict], Optional[str]]:
    try:
        resp = requests.get(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
            params={"maxResults": 20},
        )
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _get_calendar_events_for_calendar(
    access_token: str, calendar_id: str, max_results: int, time_min: str, time_max: str
) -> Tuple[Optional[list], Optional[str]]:
    try:
        encoded_id = quote(calendar_id, safe="")
        resp = requests.get(
            f"https://www.googleapis.com/calendar/v3/calendars/{encoded_id}/events",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
            params={
                "maxResults": max_results,
                "orderBy": "startTime",
                "singleEvents": "true",
                "timeMin": time_min,
                "timeMax": time_max,
            },
        )
        if resp.status_code != 200:
            return None, resp.text
        payload = resp.json()
        return payload.get("items", []), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _get_calendar_events(
    access_token: str,
    max_results: int = 200,
    time_min: str | None = None,
    time_max: str | None = None,
) -> Tuple[Optional[dict], Optional[str]]:
    time_min = time_min or (datetime.utcnow() - timedelta(days=30)).isoformat() + "Z"
    time_max = time_max or (datetime.utcnow() + timedelta(days=30)).isoformat() + "Z"
    calendar_list, list_error = _get_calendar_list(access_token)
    calendar_items = (calendar_list or {}).get("items", []) if not list_error else []
    diagnostics = {
        "calendarListCount": len(calendar_items),
        "selectedCalendarIds": [],
        "perCalendarCounts": {},
        "errors": [],
    }
    selected_calendars = [
        cal.get("id")
        for cal in calendar_items
        if cal.get("id")
        and (
            cal.get("primary")
            or cal.get("selected")
            or cal.get("accessRole") in ("owner", "writer")
        )
    ]
    if not selected_calendars:
        selected_calendars = ["primary"]
    diagnostics["selectedCalendarIds"] = selected_calendars

    events: list = []
    per_calendar = max(5, int(max_results / max(1, len(selected_calendars))))
    for calendar_id in selected_calendars:
        items, err = _get_calendar_events_for_calendar(
            access_token, calendar_id, per_calendar, time_min, time_max
        )
        if err or not items:
            if err:
                diagnostics["errors"].append({calendar_id: err})
            continue
        for item in items:
            item["calendarId"] = calendar_id
        events.extend(items)
        diagnostics["perCalendarCounts"][calendar_id] = len(items)

    if not events and list_error:
        return None, list_error

    def _event_start_value(item: dict) -> str:
        start = (item.get("start") or {}).get("dateTime") or (item.get("start") or {}).get("date")
        return start or ""

    events.sort(key=_event_start_value)
    return {"items": events[:max_results], "diagnostics": diagnostics}, None


def _freebusy(access_token: str, start_iso: str, end_iso: str) -> Tuple[Optional[dict], Optional[str]]:
    """
    Check primary calendar free/busy between start and end (ISO 8601).
    """
    payload = {
        "timeMin": start_iso,
        "timeMax": end_iso,
        "items": [{"id": "primary"}],
    }
    try:
        resp = requests.post(
            "https://www.googleapis.com/calendar/v3/freeBusy",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=payload,
            timeout=10,
        )
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _create_calendar_event(
    access_token: str,
    summary: str,
    start_iso: str,
    end_iso: str,
    description: Optional[str] = None,
    attendees: Optional[list] = None,
    event_id: Optional[str] = None,
    time_zone: Optional[str] = None,
) -> Tuple[Optional[dict], Optional[str]]:
    payload = {
        "summary": summary,
        "start": {"dateTime": start_iso},
        "end": {"dateTime": end_iso},
    }
    if time_zone:
        payload["start"]["timeZone"] = time_zone
        payload["end"]["timeZone"] = time_zone
    if description:
        payload["description"] = description
    if attendees:
        payload["attendees"] = attendees
    if event_id:
        payload["id"] = event_id

    try:
        resp = requests.post(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=payload,
            timeout=10,
        )
        if resp.status_code == 409:
            # Duplicate event id; treat as already created.
            return {"duplicate": True, "id": event_id}, None
        if resp.status_code >= 300:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _build_event_time_payload(value: Optional[str], time_zone: Optional[str] = None) -> dict:
    if not value:
        return {}
    if "T" in value:
        payload = {"dateTime": value}
        if time_zone:
            payload["timeZone"] = time_zone
        return payload
    return {"date": value}


def _update_calendar_event(
    access_token: str,
    event_id: str,
    summary: Optional[str] = None,
    start_iso: Optional[str] = None,
    end_iso: Optional[str] = None,
    description: Optional[str] = None,
    time_zone: Optional[str] = None,
) -> Tuple[Optional[dict], Optional[str]]:
    payload: dict = {}
    if summary is not None:
        payload["summary"] = summary
    if start_iso:
        payload["start"] = _build_event_time_payload(start_iso, time_zone=time_zone)
    if end_iso:
        payload["end"] = _build_event_time_payload(end_iso, time_zone=time_zone)
    if description is not None:
        payload["description"] = description

    if not payload:
        return None, "No updates provided."

    try:
        resp = requests.patch(
            f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=payload,
            timeout=10,
        )
        if resp.status_code >= 300:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _ensure_ultravox_booking_tool_for_user(email: str, db):
    """
    Ensure the Ultravox HTTP tool for booking is created and attached to the user's agent.
    Best-effort; failures are logged and do not block auth.
    """
    try:
        client = db.query(Client).filter_by(email=email).one_or_none()
        if not client or not client.ultravox_agent_id:
            return

        base = get_public_api_base()
        booking_id, booking_created, booking_attached = ensure_booking_tool(client.ultravox_agent_id, base)
        availability_id, availability_created, availability_attached = ensure_availability_tool(client.ultravox_agent_id, base)
        logger.info(
            "Ultravox tools ensure: agent=%s booking_id=%s booking_created=%s booking_attached=%s availability_id=%s availability_created=%s availability_attached=%s",
            client.ultravox_agent_id,
            booking_id,
            booking_created,
            booking_attached,
            availability_id,
            availability_created,
            availability_attached,
        )
        tasks_id, tasks_created, tasks_attached = ensure_tasks_tool(
            client.ultravox_agent_id,
            base,
            str(client.id),
        )
        logger.info(
            "Ultravox tasks tool ensure: agent=%s tasks_id=%s tasks_created=%s tasks_attached=%s",
            client.ultravox_agent_id,
            tasks_id,
            tasks_created,
            tasks_attached,
        )
        # Keep the legacy call.ended webhook as non-blocking telemetry; avoid duplicates.
        try:
            from services.ultravox_service import list_ultravox_webhooks  # lazy import to avoid cycles

            existing_hooks = list_ultravox_webhooks()
            destination = f"{base}/api/calendar/book"
            scoped = [
                hook
                for hook in existing_hooks
                if (hook.get("url") or "").rstrip("/") == destination
                and hook.get("agentId") == client.ultravox_agent_id
                and "call.ended" in (hook.get("events") or [])
            ]
            if scoped:
                logger.info("Ultravox call.ended webhook already exists for agent %s", client.ultravox_agent_id)
            else:
                scope = {"type": "AGENT", "value": client.ultravox_agent_id}
                create_ultravox_webhook(destination, ["call.ended"], scope=scope)
        except Exception as exc:  # pylint: disable=broad-except
            logger.info("Ultravox call.ended webhook skipped: %s", exc)
        # Transcript webhook for call.ended events (new).
        try:
            from services.ultravox_service import list_ultravox_webhooks  # lazy import to avoid cycles

            existing_hooks = list_ultravox_webhooks()
            destination = f"{base}/api/ultravox/webhook"
            scoped = [
                hook
                for hook in existing_hooks
                if (hook.get("url") or "").rstrip("/") == destination
                and hook.get("agentId") == client.ultravox_agent_id
                and "call.ended" in (hook.get("events") or [])
            ]
            if scoped:
                logger.info("Ultravox transcript webhook already exists for agent %s", client.ultravox_agent_id)
            else:
                scope = {"type": "AGENT", "value": client.ultravox_agent_id}
                create_ultravox_webhook(destination, ["call.ended"], scope=scope)
        except Exception as exc:  # pylint: disable=broad-except
            logger.info("Ultravox transcript webhook skipped: %s", exc)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Ultravox booking tool ensure failed for %s: %s", email, exc)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.function_name(name="AuthSignup")
@app.route(route="auth/signup", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_signup(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    email = _normalize_email((body or {}).get("email"))
    password = str((body or {}).get("password") or "")
    if not email or not password:
        return func.HttpResponse(
            json.dumps({"error": "email and password are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        existing = (
            db.query(User)
            .filter(sa_func.lower(sa_func.trim(User.email)) == email)
            .one_or_none()
        )
        if existing:
            return func.HttpResponse(
                json.dumps({"error": "User already exists"}),
                status_code=409,
                mimetype="application/json",
                headers=cors,
            )

        user = User(email=email, password_hash=_hash_password(password))
        db.add(user)
        db.flush()

        # Link to client if exists
        client = (
            db.query(Client)
            .filter(sa_func.lower(sa_func.trim(Client.email)) == email)
            .one_or_none()
        )
        if client:
            client.user_id = user.id

        db.commit()
        return func.HttpResponse(
            json.dumps({"user_id": user.id, "email": user.email}),
            status_code=201,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Signup failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Signup failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="AuthLogin")
@app.route(route="auth/login", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_login(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    email = _normalize_email((body or {}).get("email"))
    password = str((body or {}).get("password") or "")
    if not email or not password:
        return func.HttpResponse(
            json.dumps({"error": "email and password are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        # 1) Try client-level users first
        password_candidates = [password]
        trimmed_password = password.strip()
        if trimmed_password and trimmed_password != password:
            password_candidates.append(trimmed_password)

        candidate_client_users = (
            db.query(ClientUser)
            .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == email)
            .filter(
                or_(
                    ClientUser.is_active.is_(True),
                    ClientUser.is_active.is_(None),
                )
            )
            .filter(sa_func.lower(sa_func.coalesce(ClientUser.status, "active")) != "disabled")
            .order_by(ClientUser.id.asc())
            .all()
        )
        cuser = next(
            (
                entry
                for entry in candidate_client_users
                if any(_verify_password(candidate, entry.password_hash) for candidate in password_candidates)
            ),
            None,
        )
        if cuser:
            cuser.last_login_at = datetime.utcnow()
            db.commit()
            return func.HttpResponse(
                json.dumps(
                    {
                        "user_id": cuser.id,
                        "email": cuser.email,
                        "client_id": cuser.client_id,
                        "role": cuser.role or "admin",
                        "scope": "client_user",
                    }
                ),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

        # 2) Fallback to legacy single-user login
        user = (
            db.query(User)
            .filter(sa_func.lower(sa_func.trim(User.email)) == email)
            .order_by(User.id.asc())
            .first()
        )
        if not user or not any(_verify_password(candidate, user.password_hash) for candidate in password_candidates):
            return func.HttpResponse(
                json.dumps({"error": "Invalid credentials"}),
                status_code=401,
                mimetype="application/json",
                headers=cors,
            )
        client = (
            db.query(Client)
            .filter(sa_func.lower(sa_func.trim(Client.email)) == email)
            .order_by(Client.id.asc())
            .first()
        )
        return func.HttpResponse(
            json.dumps(
                {
                    "user_id": user.id,
                    "email": user.email,
                    "client_id": client.id if client else None,
                    "role": "admin",
                    "scope": "primary_user",
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Login failed: %s", exc)
        try:
            db.rollback()
        except Exception:  # pylint: disable=broad-except
            pass
        return func.HttpResponse(
            json.dumps({"error": "Login failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="AuthEmailExists")
@app.route(route="auth/email-exists", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_email_exists(req: func.HttpRequest) -> func.HttpResponse:
    """
    Check if a user with the given email already exists.
    Query param: ?email=<email>
    """
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = _normalize_email(req.params.get("email"))
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    db = SessionLocal()
    try:
        exists = (
            db.query(User)
            .filter(sa_func.lower(sa_func.trim(User.email)) == email)
            .count()
            > 0
            or db.query(ClientUser)
            .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == email)
            .count()
            > 0
        )
        return func.HttpResponse(
            json.dumps({"exists": exists}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Client user management (multi-user per client)
# ---------------------------------------------------------------------------


@app.function_name(name="ClientUsersList")
@app.route(route="auth/client-users/list", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def client_users_list(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    client_id = _get_client_id(req)
    if not client_id:
        return func.HttpResponse(
            json.dumps({"error": "clientId is required (header x-client-id or body clientId)"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        requester_email = _get_request_user_email(req)
        if requester_email and _is_client_user_email(db, requester_email):
            return func.HttpResponse(
                json.dumps({"error": "Added users cannot change settings"}),
                status_code=403,
                mimetype="application/json",
                headers=cors,
            )
        users = (
            db.query(ClientUser)
            .filter(ClientUser.client_id == client_id, ClientUser.is_active.is_(True))
            .order_by(ClientUser.created_at.asc())
            .all()
        )
        total_active = len(users)
        remaining = max(0, 5 - total_active)
        payload = [
            {
                "id": u.id,
                "email": u.email,
                "role": u.role or "admin",
                "status": u.status or ("active" if u.is_active else "disabled"),
                "is_active": bool(u.is_active),
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            }
            for u in users
        ]
        return func.HttpResponse(
            json.dumps({"client_id": client_id, "users": payload, "remaining_slots": remaining, "limit": 5}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="ClientUsersCreate")
@app.route(route="auth/client-users", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def client_users_create(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = {}

    client_id = _get_client_id(req, body)
    email = _normalize_email((body or {}).get("email"))
    password = str((body or {}).get("password") or "").strip()
    role = ((body or {}).get("role") or "admin").strip().lower()

    if not client_id:
        return func.HttpResponse(
            json.dumps({"error": "clientId is required (header x-client-id or body clientId)"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    if not email or not password:
        return func.HttpResponse(
            json.dumps({"error": "email and password are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        requester_email = _get_request_user_email(req)
        if requester_email and _is_client_user_email(db, requester_email):
            return func.HttpResponse(
                json.dumps({"error": "Added users cannot change settings"}),
                status_code=403,
                mimetype="application/json",
                headers=cors,
            )
        active_count = (
            db.query(ClientUser)
            .filter(ClientUser.client_id == client_id, ClientUser.is_active.is_(True))
            .count()
        )
        if active_count >= 5:
            return func.HttpResponse(
                json.dumps({"error": "Maximum users reached", "limit": 5}),
                status_code=409,
                mimetype="application/json",
                headers=cors,
            )

        existing_client_user = (
            db.query(ClientUser)
            .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == email)
            .order_by(ClientUser.id.asc())
            .first()
        )
        existing_user = (
            db.query(User)
            .filter(sa_func.lower(sa_func.trim(User.email)) == email)
            .order_by(User.id.asc())
            .first()
        )
        existing_client_owner = (
            db.query(Client)
            .filter(sa_func.lower(sa_func.trim(Client.email)) == email)
            .order_by(Client.id.asc())
            .first()
        )
        if existing_client_user or existing_user or existing_client_owner:
            return func.HttpResponse(
                json.dumps({"error": "User is already present"}),
                status_code=409,
                mimetype="application/json",
                headers=cors,
            )

        user_obj = ClientUser(
            client_id=client_id,
            email=email,
            password_hash=_hash_password(password),
            role=role,
            is_active=True,
            status="active",
        )
        db.add(user_obj)

        # Backward compatibility: create a legacy user row for this newly added client user.
        db.add(
            User(
                email=email,
                password_hash=user_obj.password_hash,
                is_admin=(role == "admin"),
            )
        )

        db.commit()
        db.refresh(user_obj)
        return func.HttpResponse(
            json.dumps(
                {
                    "id": user_obj.id,
                    "email": user_obj.email,
                    "client_id": user_obj.client_id,
                    "role": user_obj.role or "admin",
                }
            ),
            status_code=201,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        try:
            db.rollback()
        except Exception:  # pylint: disable=broad-except
            pass
        logger.error("Failed to create client user: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Unable to create user", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="ClientUsersDelete")
@app.route(route="auth/client-users/{user_id}", methods=["DELETE", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def client_users_delete(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["DELETE", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    client_id = _get_client_id(req)
    if not client_id:
        return func.HttpResponse(
            json.dumps({"error": "clientId is required (header x-client-id or body clientId)"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    route_params = req.route_params or {}
    user_id_val = route_params.get("user_id")
    try:
        uid = int(user_id_val)
    except (TypeError, ValueError):
        return func.HttpResponse(
            json.dumps({"error": "user_id must be an integer"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        requester_email = _get_request_user_email(req)
        if requester_email and _is_client_user_email(db, requester_email):
            return func.HttpResponse(
                json.dumps({"error": "Added users cannot change settings"}),
                status_code=403,
                mimetype="application/json",
                headers=cors,
            )
        user_obj = (
            db.query(ClientUser)
            .filter(ClientUser.id == uid, ClientUser.client_id == client_id)
            .one_or_none()
        )
        if not user_obj:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        db.delete(user_obj)
        db.commit()
        return func.HttpResponse("", status_code=204, headers=cors)
    except Exception as exc:  # pylint: disable=broad-except
        try:
            db.rollback()
        except Exception:  # pylint: disable=broad-except
            pass
        logger.error("Failed to delete client user: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Unable to delete user", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="ClientUsersUpdate")
@app.route(route="auth/client-users/{user_id}/update", methods=["PATCH", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def client_users_update(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["PATCH", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    client_id = _get_client_id(req)
    if not client_id:
        return func.HttpResponse(
            json.dumps({"error": "clientId is required (header x-client-id or body clientId)"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    route_params = req.route_params or {}
    user_id_val = route_params.get("user_id")
    try:
        uid = int(user_id_val)
    except (TypeError, ValueError):
        return func.HttpResponse(
            json.dumps({"error": "user_id must be an integer"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    try:
        body = req.get_json()
    except ValueError:
        body = {}

    allowed_status = {"active", "invited", "disabled"}
    new_status = body.get("status")
    new_role = body.get("role")
    new_password = body.get("password")
    new_active = body.get("is_active")

    db = SessionLocal()
    try:
        requester_email = _get_request_user_email(req)
        if requester_email and _is_client_user_email(db, requester_email):
            return func.HttpResponse(
                json.dumps({"error": "Added users cannot change settings"}),
                status_code=403,
                mimetype="application/json",
                headers=cors,
            )
        user_obj = (
            db.query(ClientUser)
            .filter(ClientUser.id == uid, ClientUser.client_id == client_id)
            .one_or_none()
        )
        if not user_obj:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        if new_status:
            if new_status not in allowed_status:
                return func.HttpResponse(
                    json.dumps({"error": f"status must be one of {sorted(allowed_status)}"}),
                    status_code=400,
                    mimetype="application/json",
                    headers=cors,
                )
            user_obj.status = new_status
            user_obj.is_active = new_status != "disabled"

        if new_role:
            user_obj.role = str(new_role).strip().lower()

        if new_password is not None:
            cleaned_password = str(new_password).strip()
            if not cleaned_password:
                return func.HttpResponse(
                    json.dumps({"error": "password cannot be empty"}),
                    status_code=400,
                    mimetype="application/json",
                    headers=cors,
                )
            user_obj.password_hash = _hash_password(cleaned_password)

        if isinstance(new_active, bool):
            user_obj.is_active = new_active
            if new_active and user_obj.status == "disabled":
                user_obj.status = "active"
            if not new_active and user_obj.status == "active":
                user_obj.status = "disabled"

        db.commit()
        db.refresh(user_obj)
        return func.HttpResponse(
            json.dumps(
                {
                    "id": user_obj.id,
                    "email": user_obj.email,
                    "client_id": user_obj.client_id,
                    "role": user_obj.role,
                    "status": user_obj.status,
                    "is_active": user_obj.is_active,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        try:
            db.rollback()
        except Exception:  # pylint: disable=broad-except
            pass
        logger.error("Failed to update client user: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Unable to update user", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="ClientBusinessDetails")
@app.route(route="clients/business-details", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def client_business_details(req: func.HttpRequest) -> func.HttpResponse:
    """
    Create or update a client with business name/phone after signup.
    Payload: { email, businessName, businessPhone, websiteUrl?, businessCategory?, businessSubType?, businessCustomType? }
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    email = _normalize_email((body or {}).get("email"))
    business_name = (body or {}).get("businessName")
    business_phone = (body or {}).get("businessPhone")
    business_category = (body or {}).get("businessCategory")
    business_sub_type = (body or {}).get("businessSubType")
    business_custom_type = (body or {}).get("businessCustomType")
    website_url = (body or {}).get("websiteUrl")
    website_data = (body or {}).get("websiteData")
    profile = _normalize_business_profile(website_data)
    website_payload = {"business_profile": profile} if profile else None

    if not email or not business_name or not business_phone:
        return func.HttpResponse(
            json.dumps({"error": "email, businessName, and businessPhone are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        if _is_client_user_email(db, email):
            return func.HttpResponse(
                json.dumps({"error": "Added users cannot change settings"}),
                status_code=403,
                mimetype="application/json",
                headers=cors,
            )

        user = (
            db.query(User)
            .filter(sa_func.lower(sa_func.trim(User.email)) == email)
            .order_by(User.id.asc())
            .first()
        )
        if user:
            user.business_name = business_name
            user.business_number = business_phone
            db.flush()
        client = (
            db.query(Client)
            .filter(sa_func.lower(sa_func.trim(Client.email)) == email)
            .order_by(Client.id.asc())
            .first()
        )
        if client:
            client.business_name = business_name
            client.business_phone = business_phone
            client.name = business_name
            client.user_id = user.id if user else client.user_id
            if business_category is not None:
                client.business_category = business_category
            if business_sub_type is not None:
                client.business_sub_type = business_sub_type
            if business_custom_type is not None:
                client.business_custom_type = business_custom_type
            if website_url:
                client.website_url = website_url
            if website_payload:
                client.website_data = _merge_website_data(client.website_data, website_payload)
            db.commit()
            profile_payload = _normalize_business_profile(website_data) or {
                "businessName": business_name,
                "businessPhone": business_phone,
            }
            _trigger_prompt_generation_async(
                client_id=client.id,
                category=client.business_category,
                sub_type=client.business_sub_type,
                task_type=None,
                business_profile=profile_payload,
                knowledge_text=_extract_knowledge_text(website_data),
                created_by=f"user:{email}",
            )
            return func.HttpResponse(
                json.dumps({"client_id": client.id, "email": client.email}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

        website_url = website_url or "pending"
        client = Client(
            email=email,
            website_url=website_url,
            name=business_name,
            business_name=business_name,
            business_phone=business_phone,
            business_category=business_category,
            business_sub_type=business_sub_type,
            business_custom_type=business_custom_type,
            user_id=user.id if user else None,
            website_data=_merge_website_data(None, website_payload) if website_payload else None,
        )
        db.add(client)
        db.commit()
        profile_payload = _normalize_business_profile(website_data) or {
            "businessName": business_name,
            "businessPhone": business_phone,
        }
        _trigger_prompt_generation_async(
            client_id=client.id,
            category=client.business_category,
            sub_type=client.business_sub_type,
            task_type=None,
            business_profile=profile_payload,
            knowledge_text=_extract_knowledge_text(website_data),
            created_by=f"user:{email}",
        )
        return func.HttpResponse(
            json.dumps({"client_id": client.id, "email": client.email}),
            status_code=201,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Failed to save client details: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to save client details", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="UserByEmail")
@app.route(route="auth/user-by-email", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def user_by_email(req: func.HttpRequest) -> func.HttpResponse:
    """Return user fields including business name/number."""
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = _normalize_email(req.params.get("email"))
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    db = SessionLocal()
    try:
        user = (
            db.query(User)
            .filter(sa_func.lower(sa_func.trim(User.email)) == email)
            .order_by(User.id.asc())
            .first()
        )

        if user:
            payload = {
                "user_id": user.id,
                "email": user.email,
                "business_name": user.business_name,
                "business_number": user.business_number,
            }
        else:
            cuser = (
                db.query(ClientUser)
                .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == email)
                .order_by(ClientUser.id.asc())
                .first()
            )
            if not cuser:
                return func.HttpResponse(
                    json.dumps({"error": "not found"}),
                    status_code=404,
                    mimetype="application/json",
                    headers=cors,
                )

            client = db.query(Client).filter_by(id=cuser.client_id).one_or_none()
            owner = None
            if client and client.user_id:
                owner = db.query(User).filter_by(id=client.user_id).one_or_none()

            payload = {
                "user_id": cuser.id,
                "email": cuser.email,
                "business_name": (owner.business_name if owner else None) or (client.business_name if client else None),
                "business_number": (owner.business_number if owner else None) or (client.business_phone if client else None),
                "client_id": cuser.client_id,
                "role": cuser.role or "admin",
                "scope": "client_user",
            }
        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()

@app.function_name(name="ClientByEmail")
@app.route(route="clients/by-email", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def client_by_email(req: func.HttpRequest) -> func.HttpResponse:
    """Return client profile by email, including business fields."""
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = _normalize_email(req.params.get("email"))
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    db = SessionLocal()
    try:
        client = (
            db.query(Client)
            .filter(sa_func.lower(sa_func.trim(Client.email)) == email)
            .order_by(Client.id.asc())
            .first()
        )
        if not client:
            cuser = (
                db.query(ClientUser)
                .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == email)
                .order_by(ClientUser.id.asc())
                .first()
            )
            if cuser:
                client = db.query(Client).filter_by(id=cuser.client_id).one_or_none()
        if not client:
            return func.HttpResponse(
                json.dumps({"error": "not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        user = None
        if client.user_id:
            user = db.query(User).filter_by(id=client.user_id).one_or_none()
        payload = {
            "client_id": client.id,
            "email": client.email,
            "business_name": client.business_name,
            "business_phone": client.business_phone,
            "business_category": client.business_category,
            "business_sub_type": client.business_sub_type,
            "business_custom_type": client.business_custom_type,
            "website_url": client.website_url,
            "website_data": client.website_data,
            "user_id": client.user_id,
            "user_business_name": user.business_name if user else None,
            "user_business_number": user.business_number if user else None,
        }
        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="AuthForgotPassword")
@app.route(route="auth/forgot-password", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_forgot_password(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    email = _normalize_email((body or {}).get("email"))
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = (
            db.query(User)
            .filter(sa_func.lower(sa_func.trim(User.email)) == email)
            .order_by(User.id.asc())
            .first()
        )
        if user:
            user.reset_token = _generate_reset_token()
            user.reset_token_expires = datetime.utcnow() + timedelta(hours=1)
            token = user.reset_token
        else:
            cuser = (
                db.query(ClientUser)
                .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == email)
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
            if not cuser:
                return func.HttpResponse(
                    json.dumps({"message": "If the account exists, a reset link will be sent."}),
                    status_code=200,
                    mimetype="application/json",
                    headers=cors,
                )
            cuser.reset_token = _generate_reset_token()
            cuser.reset_token_expires = datetime.utcnow() + timedelta(hours=1)
            token = cuser.reset_token

        if not token:
            return func.HttpResponse(
                json.dumps({"message": "If the account exists, a reset link will be sent."}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )
        db.commit()

        reset_link = f"{req.url.replace('/auth/forgot-password', '/auth/reset-password')}?token={token}"
        frontend_base = (
            get_setting("PUBLIC_WEB_APP_URL")
            or get_setting("WEB_APP_URL")
            or get_setting("APP_URL")
            or req.headers.get("origin")
        )
        app_reset_link = None
        if frontend_base:
            safe_frontend_base = str(frontend_base).strip().rstrip("/")
            if safe_frontend_base:
                app_reset_link = f"{safe_frontend_base}/?reset_token={token}"

        email_sent = _send_password_reset_email(
            to_email=email,
            reset_link=reset_link,
            app_reset_link=app_reset_link,
        )
        if not email_sent:
            logger.warning("Password reset email send failed for: %s", email)
        return func.HttpResponse(
            json.dumps(
                {
                    "message": "If the account exists, a reset link will be sent.",
                    "email_sent": email_sent,
                    "reset_link": reset_link if not email_sent else None,
                    "reset_password_url": app_reset_link if not email_sent else None,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Forgot password failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Forgot password failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="AuthResetPassword")
@app.route(route="auth/reset-password", methods=["POST", "GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_reset_password(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if req.method == "GET":
        token = req.params.get("token")
        if not token:
            return func.HttpResponse(
                "Token is required to reset your password.",
                status_code=400,
                mimetype="text/plain",
                headers=cors,
            )
        html = f"""
        <!doctype html>
        <html>
        <head><title>Reset Password</title></head>
        <body>
            <h2>Reset your password</h2>
            <form method="POST" action="">
                <input type="hidden" name="token" value="{token}">
                <label for="new_password">New password</label>
                <input id="new_password" type="password" name="new_password" required>
                <button type="submit">Reset password</button>
            </form>
        </body>
        </html>
        """
        return func.HttpResponse(html, status_code=200, mimetype="text/html", headers=cors)

    token = None
    new_password = None
    try:
        body = req.get_json()
        token = (body or {}).get("token")
        new_password = (body or {}).get("new_password")
    except ValueError:
        try:
            form_data = parse_qs(req.get_body().decode("utf-8"))
            token = (form_data.get("token") or [None])[0]
            new_password = (form_data.get("new_password") or [None])[0]
        except Exception:  # pylint: disable=broad-except
            token = None
            new_password = None
    if not token or not new_password:
        return func.HttpResponse(
            json.dumps({"error": "token and new_password are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = (
            db.query(User)
            .filter(User.reset_token == token, User.reset_token_expires >= datetime.utcnow())
            .one_or_none()
        )
        cuser = None
        if user:
            user.password_hash = _hash_password(new_password)
            user.reset_token = None
            user.reset_token_expires = None
        else:
            cuser = (
                db.query(ClientUser)
                .filter(ClientUser.reset_token == token, ClientUser.reset_token_expires >= datetime.utcnow())
                .filter(
                    or_(
                        ClientUser.is_active.is_(True),
                        ClientUser.is_active.is_(None),
                    )
                )
                .filter(sa_func.lower(sa_func.coalesce(ClientUser.status, "active")) != "disabled")
                .one_or_none()
            )
            if not cuser:
                return func.HttpResponse(
                    json.dumps({"error": "Invalid or expired token"}),
                    status_code=400,
                    mimetype="application/json",
                    headers=cors,
                )
            cuser.password_hash = _hash_password(new_password)
            cuser.reset_token = None
            cuser.reset_token_expires = None

        db.commit()

        return func.HttpResponse(
            json.dumps({"message": "Password reset successful"}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Reset password failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Reset password failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="GoogleAuthUrl")
@app.route(route="auth/google/url", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_google_url(req: func.HttpRequest) -> func.HttpResponse:  # pylint: disable=unused-argument
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    force_param = req.params.get("force") or ""
    force_consent = str(force_param).lower() in {"1", "true", "yes"}
    settings = get_google_oauth_settings()
    if not settings["client_id"] or not settings["client_secret"]:
        return func.HttpResponse(
            json.dumps({"error": "Google OAuth env vars missing"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    if email and not force_consent:
        db = SessionLocal()
        try:
            user = db.query(User).filter_by(email=email).one_or_none()
            if user:
                token = (
                    db.query(GoogleToken)
                    .filter_by(user_id=user.id)
                    .order_by(GoogleToken.created_at.desc())
                    .first()
                )
                if not token or not token.refresh_token:
                    force_consent = True
        finally:
            db.close()
    state_payload = {"nonce": secrets.token_urlsafe(16), "provider": "outlook"}
    if email:
        state_payload["email"] = email
    state = _encode_oauth_state(state_payload)
    url = _build_google_auth_url(state, force_consent=force_consent)
    return func.HttpResponse(
        json.dumps({"auth_url": url, "state": state}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )


@app.function_name(name="GoogleAuthCallback")
@app.route(
    route="auth/google/callback",
    methods=["GET", "POST", "OPTIONS"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def auth_google_callback(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    code = req.params.get("code") or None
    state = req.params.get("state")
    if not code:
        try:
            body = req.get_json()
            code = code or (body or {}).get("code")
            state = state or (body or {}).get("state")
        except ValueError:
            code = code or None
    if not code:
        return func.HttpResponse(
            json.dumps({"error": "Missing code"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    token_data, token_error = _exchange_code_for_tokens(code)
    if token_error or not token_data:
        return func.HttpResponse(
            json.dumps({"error": "Failed to exchange code", "details": token_error}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in")
    token_type = token_data.get("token_type")
    id_token = token_data.get("id_token")
    scope = token_data.get("scope")

    profile, profile_error = _get_google_userinfo(access_token)
    if profile_error or not profile:
        return func.HttpResponse(
            json.dumps({"error": "Failed to fetch user profile", "details": profile_error}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    google_email = profile.get("email")
    name = profile.get("name") or google_email
    state_payload = _decode_oauth_state(state)
    requested_email = (state_payload or {}).get("email") if isinstance(state_payload, dict) else None
    target_email = requested_email or google_email
    if not target_email:
        return func.HttpResponse(
            json.dumps({"error": "Missing email"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=target_email).one_or_none()
        is_new_user = False
        if not user:
            if requested_email:
                return func.HttpResponse(
                    json.dumps({"error": "User not found for calendar connection"}),
                    status_code=404,
                    mimetype="application/json",
                    headers=cors,
                )
            is_new_user = True
            temp_password = secrets.token_urlsafe(12)
            user = User(email=target_email, password_hash=_hash_password(temp_password))
            db.add(user)
            db.flush()

        google_token = (
            db.query(GoogleToken)
            .filter_by(user_id=user.id)
            .order_by(GoogleToken.created_at.desc())
            .first()
        )
        expires_at = (
            datetime.utcnow() + timedelta(seconds=int(expires_in))
            if expires_in
            else None
        )
        if google_token:
            google_token.access_token = access_token
            google_token.refresh_token = refresh_token or google_token.refresh_token
            google_token.scope = scope
            google_token.token_type = token_type
            google_token.expires_at = expires_at
            google_token.id_token = id_token.encode("utf-8") if isinstance(id_token, str) else id_token
            google_token.google_account_email = google_email
        else:
            google_token = GoogleToken(
                user_id=user.id,
                access_token=access_token,
                refresh_token=refresh_token,
                scope=scope,
                token_type=token_type,
                expires_at=expires_at,
                id_token=id_token.encode("utf-8") if isinstance(id_token, str) else id_token,
                google_account_email=google_email,
            )
            db.add(google_token)

        # Link any pending client record
        client = db.query(Client).filter_by(email=user.email).one_or_none()
        if client:
            client.user_id = user.id
            client.name = client.name or name
        db.commit()

        # Ensure Ultravox booking tool is present/attached (best-effort)
        _ensure_ultravox_booking_tool_for_user(user.email, db)

        payload = {
            "user_id": user.id,
            "email": user.email,
            "state": state,
            "is_new_user": is_new_user,
            "token": {
                "expires_at": expires_at.isoformat() if expires_at else None,
                "has_refresh": bool(refresh_token),
                "scope": scope,
            },
            "profile": {"name": name},
            "google_account_email": google_email,
        }
        # If Google hits this endpoint directly, show simple HTML for the SPA to read.
        if req.method == "GET":
            html = (
                "<script>"
                "window.opener && window.opener.postMessage("  # type: ignore
                + json.dumps(payload)
                + ', "*");'
                "window.close();"
                "</script>"
                "<p>Google connected. You can close this tab.</p>"
            )
            return func.HttpResponse(html, status_code=200, mimetype="text/html", headers=cors)

        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Google auth callback failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Google auth failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="CalendarEvents")
@app.route(route="calendar/events", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def calendar_events(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id")
    max_results_param = req.params.get("max_results")
    range_from = req.params.get("from")
    range_to = req.params.get("to")
    max_results = 200
    if max_results_param:
        try:
            max_results = min(int(max_results_param), 200)
        except ValueError:
            max_results = 200

    db = SessionLocal()
    try:
        user = _resolve_primary_user(db, email=email, user_id=user_id)
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        token = (
            db.query(GoogleToken)
            .filter_by(user_id=user.id)
            .order_by(GoogleToken.created_at.desc())
            .first()
        )
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token = token.access_token
        now = datetime.utcnow()
        if token.expires_at and token.expires_at <= now and token.refresh_token:
            refreshed, refresh_error = _refresh_google_token(token.refresh_token)
            if refresh_error or not refreshed:
                return func.HttpResponse(
                    json.dumps({"error": "Unable to refresh token", "details": refresh_error}),
                    status_code=401,
                    mimetype="application/json",
                    headers=cors,
                )
            access_token = refreshed.get("access_token") or access_token
            token.access_token = access_token
            token.expires_at = (
                datetime.utcnow() + timedelta(seconds=int(refreshed.get("expires_in")))
                if refreshed.get("expires_in")
                else None
            )
            db.commit()

        # Ensure Ultravox booking tool is present/attached (best-effort)
        _ensure_ultravox_booking_tool_for_user(email, db)

        events, events_error = _get_calendar_events(
            access_token,
            max_results=max_results,
            time_min=range_from,
            time_max=range_to,
        )
        if events_error or events is None:
            return func.HttpResponse(
                json.dumps({"error": "Failed to fetch calendar", "details": events_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        return func.HttpResponse(
            json.dumps(
                {
                    "events": events.get("items", []),
                    "summary": events.get("summary"),
                    "user": user.email,
                    "account_email": token.google_account_email,
                    "diagnostics": events.get("diagnostics"),
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except OperationalError as exc:
        logger.warning("CalendarEvents database unavailable: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Database unavailable", "details": str(exc)}),
            status_code=503,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Calendar events failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Calendar fetch failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        try:
            db.close()
        except OperationalError as exc:
            logger.warning("CalendarEvents DB close failed: %s", exc)


@app.function_name(name="CalendarUpdate")
@app.route(route="calendar/update", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def calendar_update(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None

    email = body.get("email") if isinstance(body, dict) else None
    user_id = body.get("user_id") if isinstance(body, dict) else None
    event_id = body.get("eventId") if isinstance(body, dict) else None
    summary = body.get("summary") if isinstance(body, dict) else None
    start_iso = body.get("start") if isinstance(body, dict) else None
    end_iso = body.get("end") if isinstance(body, dict) else None
    description = body.get("description") if isinstance(body, dict) else None

    if not event_id or not (email or user_id):
        return func.HttpResponse(
            json.dumps({"error": "eventId and email (or user_id) are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = _resolve_primary_user(db, email=email, user_id=user_id)
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        token = (
            db.query(GoogleToken)
            .filter_by(user_id=user.id)
            .order_by(GoogleToken.created_at.desc())
            .first()
        )
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token = token.access_token
        now = datetime.utcnow()
        if token.expires_at and token.expires_at <= now and token.refresh_token:
            refreshed, refresh_error = _refresh_google_token(token.refresh_token)
            if refresh_error or not refreshed:
                return func.HttpResponse(
                    json.dumps({"error": "Unable to refresh token", "details": refresh_error}),
                    status_code=401,
                    mimetype="application/json",
                    headers=cors,
                )
            access_token = refreshed.get("access_token") or access_token
            token.access_token = access_token
            token.expires_at = (
                datetime.utcnow() + timedelta(seconds=int(refreshed.get("expires_in")))
                if refreshed.get("expires_in")
                else None
            )
            db.commit()

        updated, update_error = _update_calendar_event(
            access_token,
            event_id,
            summary=summary,
            start_iso=start_iso,
            end_iso=end_iso,
            description=description,
        )
        if update_error or not updated:
            return func.HttpResponse(
                json.dumps({"error": "Failed to update event", "details": update_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        return func.HttpResponse(
            json.dumps({"event": updated}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Calendar update failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Calendar update failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="CalendarCreate")
@app.route(route="calendar/create", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def calendar_create(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None

    email = body.get("email") if isinstance(body, dict) else None
    user_id = body.get("user_id") if isinstance(body, dict) else None
    summary = body.get("summary") if isinstance(body, dict) else None
    start_iso = body.get("start") if isinstance(body, dict) else None
    end_iso = body.get("end") if isinstance(body, dict) else None
    description = body.get("description") if isinstance(body, dict) else None

    if not start_iso or not (email or user_id):
        return func.HttpResponse(
            json.dumps({"error": "start and email (or user_id) are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = _resolve_primary_user(db, email=email, user_id=user_id)
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        token = (
            db.query(GoogleToken)
            .filter_by(user_id=user.id)
            .order_by(GoogleToken.created_at.desc())
            .first()
        )
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token = token.access_token
        now = datetime.utcnow()
        if token.expires_at and token.expires_at <= now and token.refresh_token:
            refreshed, refresh_error = _refresh_google_token(token.refresh_token)
            if refresh_error or not refreshed:
                return func.HttpResponse(
                    json.dumps({"error": "Unable to refresh token", "details": refresh_error}),
                    status_code=401,
                    mimetype="application/json",
                    headers=cors,
                )
            access_token = refreshed.get("access_token") or access_token
            token.access_token = access_token
            token.expires_at = (
                datetime.utcnow() + timedelta(seconds=int(refreshed.get("expires_in")))
                if refreshed.get("expires_in")
                else None
            )
            db.commit()

        summary = summary or "New event"
        event, event_error = _create_calendar_event(
            access_token,
            summary,
            start_iso=start_iso,
            end_iso=end_iso or start_iso,
            description=description,
        )
        if event_error or not event:
            return func.HttpResponse(
                json.dumps({"error": "Failed to create event", "details": event_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        return func.HttpResponse(
            json.dumps({"event": event}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Calendar create failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Calendar create failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="CalendarBook")
@app.route(route="calendar/book", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def calendar_book(req: func.HttpRequest) -> func.HttpResponse:
    """
    Create an event on the user's primary Google Calendar if the slot is free.
    Body: { email?, agentId?, call.agent.id?, start, end?, duration_minutes?, buffer_minutes?, title?, description?, callerName?, callerEmail?, callerPhone? }
    If email is missing but agentId is provided, we resolve the client's email from the Ultravox agent id.
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    # Parse raw body once to avoid Kestrel "Unexpected end of request content".
    try:
        raw = req.get_body() or b""
        # Log the incoming payload for diagnostics (truncated to avoid oversized logs).
        try:
            logger.info("CalendarBook raw body (%s bytes): %s", len(raw), raw[:5000].decode("utf-8", "ignore"))
        except Exception:  # pylint: disable=broad-except
            logger.info("CalendarBook raw body length: %s bytes", len(raw))
        body = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:  # pylint: disable=broad-except
        logger.warning("CalendarBook invalid JSON body")
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    if not isinstance(body, dict):
        body = {}

    logger.info("CalendarBook parsed body keys: %s", list(body.keys()))

    extracted_start, extracted_end, extracted_duration, extracted_buffer = _extract_time_fields(body)

    email = body.get("email")
    agent_id = (
        body.get("agentId")
        or body.get("agent_id")
        or (body.get("agent") or {}).get("id")
        or (body.get("call") or {}).get("agentId")
        or (body.get("call") or {}).get("agent_id")
        or ((body.get("call") or {}).get("agent") or {}).get("id")
    )
    if isinstance(agent_id, dict):
        agent_id = (
            agent_id.get("value")
            or agent_id.get("agentId")
            or agent_id.get("agent_id")
            or agent_id.get("id")
        )

    start_iso = body.get("start")
    end_iso = body.get("end")
    duration_minutes = body.get("duration_minutes") or 30
    buffer_minutes = body.get("buffer_minutes") or 5
    title = body.get("title") or "Phone appointment with AI Receptionist"
    description = body.get("description")
    caller_name = body.get("callerName") or body.get("caller_name")
    caller_email = body.get("callerEmail") or body.get("caller_email")
    caller_phone = body.get("callerPhone") or body.get("caller_phone")
    call_id = (
        body.get("callId")
        or (body.get("call") or {}).get("callId")
        or body.get("call_id")
        or (body.get("call") or {}).get("call_id")
    )
    if isinstance(call_id, str) and call_id.lower() in ("null", "none", ""):
        call_id = None

    logger.info(
        "CalendarBook resolved identifiers: email=%s agent_id=%s call_id=%s start=%s end=%s duration=%s buffer=%s",
        email,
        agent_id,
        call_id,
        extracted_start,
        extracted_end,
        extracted_duration or duration_minutes,
        extracted_buffer or buffer_minutes,
    )

    start_iso = (
        extracted_start
        or body.get("start")
        or body.get("start_iso")
        or body.get("start_time")
        or body.get("start_time_iso")
    )
    end_iso = extracted_end or body.get("end") or body.get("end_iso") or body.get("end_time") or body.get("end_time_iso")
    duration_minutes = extracted_duration or body.get("duration_minutes") or body.get("duration") or 30
    buffer_minutes = extracted_buffer or body.get("buffer_minutes") or body.get("buffer") or 5

    if (body.get("event") or "").lower() == "call.ended" and not start_iso:
        logger.info("CalendarBook skipping call.ended webhook without start time (noop).")
        return func.HttpResponse(
            json.dumps({"message": "No booking created; call.ended payload missing start"}),
            status_code=202,
            mimetype="application/json",
            headers=cors,
        )
    caller_lines = []
    if caller_name:
        caller_lines.append(f"Caller: {caller_name}")
    if caller_email:
        caller_lines.append(f"Email: {caller_email}")
    if caller_phone:
        caller_lines.append(f"Phone: {caller_phone}")
    caller_lines.append(f"Duration: {duration_minutes} min")
    caller_lines.append(f"Buffer: {buffer_minutes} min")
    if caller_lines:
        extra = "\n".join(caller_lines)
        description = f"{description or ''}\n\n{extra}".strip()

    try:
        duration_minutes = int(duration_minutes)
    except Exception:
        duration_minutes = 30
    try:
        buffer_minutes = int(buffer_minutes)
    except Exception:
        buffer_minutes = 5

    db = SessionLocal()
    try:
        user = None
        client = None
        if email:
            user = db.query(User).filter_by(email=email).one_or_none()
            client = db.query(Client).filter_by(email=email).one_or_none()
        if not client and agent_id:
            client = db.query(Client).filter_by(ultravox_agent_id=agent_id).one_or_none()
            if client and not email:
                email = client.email
        if not user and email:
            user = db.query(User).filter_by(email=email).one_or_none()

        logger.info("CalendarBook user lookup: email=%s user_found=%s", email, bool(user))
        if not email or not user:
            logger.warning("CalendarBook user not found for email=%s agent_id=%s", email, agent_id)
            return func.HttpResponse(
                json.dumps({"error": "User not found", "hint": "Provide email or agentId"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        token = (
            db.query(GoogleToken)
            .filter_by(user_id=user.id)
            .order_by(GoogleToken.created_at.desc())
            .first()
        )
        logger.info("CalendarBook token lookup for user_id=%s found=%s", user.id, bool(token))
        if not token:
            logger.warning("CalendarBook no Google token for user_id=%s", user.id)
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token = token.access_token
        now = datetime.utcnow()
        if token.expires_at and token.expires_at <= now and token.refresh_token:
            logger.info("CalendarBook token expired, attempting refresh for user_id=%s", user.id)
            refreshed, refresh_error = _refresh_google_token(token.refresh_token)
            if refresh_error or not refreshed:
                logger.error("CalendarBook refresh failed: %s", refresh_error)
                return func.HttpResponse(
                    json.dumps({"error": "Unable to refresh token", "details": refresh_error}),
                    status_code=401,
                    mimetype="application/json",
                    headers=cors,
                )
            access_token = refreshed.get("access_token") or access_token
            token.access_token = access_token
            token.expires_at = (
                datetime.utcnow() + timedelta(seconds=int(refreshed.get("expires_in")))
                if refreshed.get("expires_in")
                else None
            )
            db.commit()

        if not start_iso:
            logger.warning("CalendarBook missing start; refusing to auto-schedule without a requested slot")
            return func.HttpResponse(
                json.dumps({"error": "Missing start time", "hint": "Provide start in ISO 8601 (e.g., 2025-12-17T15:00:00Z)"}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )
        try:
            start_dt = _parse_dt_with_london_default(start_iso)
        except Exception:  # pylint: disable=broad-except
            logger.warning("CalendarBook invalid start format: %s", start_iso)
            return func.HttpResponse(
                json.dumps({"error": "Invalid start time format", "value": start_iso}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )
        if end_iso:
            try:
                end_dt = _parse_dt_with_london_default(end_iso)
            except Exception:  # pylint: disable=broad-except
                logger.warning("CalendarBook invalid end format: %s", end_iso)
                return func.HttpResponse(
                    json.dumps({"error": "Invalid end time format", "value": end_iso}),
                    status_code=400,
                    mimetype="application/json",
                    headers=cors,
                )
        else:
            end_dt = start_dt + timedelta(minutes=duration_minutes)
        end_dt = _ensure_utc(end_dt)

        buffered_end = (
            _ensure_utc(end_dt + timedelta(minutes=buffer_minutes)) if buffer_minutes else end_dt
        )

        start_london = start_dt.astimezone(ZoneInfo("Europe/London"))
        end_london = end_dt.astimezone(ZoneInfo("Europe/London"))
        start_for_google = start_london.isoformat()
        end_for_google = end_london.isoformat()

        logger.info(
            "CalendarBook resolved timing: start=%s end=%s buffered_end=%s duration=%s buffer=%s",
            start_dt.isoformat(),
            end_dt.isoformat(),
            buffered_end.isoformat(),
            duration_minutes,
            buffer_minutes,
        )

        fb, fb_error = _freebusy(
            access_token,
            start_dt.isoformat(),
            buffered_end.isoformat(),
        )
        logger.info("CalendarBook free/busy response: error=%s busy_entries=%s", fb_error, (fb or {}).get("calendars", {}))
        if fb_error or not fb:
            logger.warning("CalendarBook free/busy failure: %s", fb_error)
            return func.HttpResponse(
                json.dumps({"error": "Unable to check availability", "details": fb_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        busy = fb.get("calendars", {}).get("primary", {}).get("busy", [])
        if busy:
            logger.warning("CalendarBook slot busy: %s", busy)
            return func.HttpResponse(
                json.dumps({"error": "Slot is busy", "busy": busy}),
                status_code=409,
                mimetype="application/json",
                headers=cors,
            )

        attendees = []
        if caller_email:
            attendees.append({"email": caller_email})
        # Use call_id as event_id to get idempotency (Google returns 409 on duplicate).
        event_id = _build_event_id(call_id)

        event_error = None
        event = None
        tried_id = False

        if event_id:
            tried_id = True
            logger.info("CalendarBook creating event with id=%s attendees=%s", event_id, attendees)
            event, event_error = _create_calendar_event(
                access_token,
                title,
                start_for_google,
                end_for_google,
                description=description,
                attendees=attendees or None,
                event_id=event_id,
                time_zone="Europe/London",
            )

        # If no event_id was provided, or the id attempt failed, try once without id.
        if not event and not event_error and not tried_id:
            logger.info("CalendarBook creating event without explicit id (call_id missing)")
            event, event_error = _create_calendar_event(
                access_token,
                title,
                start_for_google,
                end_for_google,
                description=description,
                attendees=attendees or None,
                event_id=None,
                time_zone="Europe/London",
            )

        # If invalid id or other creation error, retry once without event_id.
        if (event_error or not event) and tried_id:
            if event_error and "Invalid resource id" in str(event_error):
                logger.info("Retrying calendar create without event_id (invalid id: %s)", event_id)
                event, event_error = _create_calendar_event(
                    access_token,
                    title,
                    start_for_google,
                    end_for_google,
                    description=description,
                    attendees=attendees or None,
                    event_id=None,
                    time_zone="Europe/London",
                )

        if event_error or not event:
            logger.error(
                "CalendarBook event creation failed: event_error=%s event_id_used=%s tried_id=%s",
                event_error,
                event_id,
                tried_id,
            )
            return func.HttpResponse(
                json.dumps(
                    {
                        "error": "Failed to create event",
                        "details": event_error,
                        "event_id_used": event_id if tried_id else None,
                    }
                ),
                status_code=500,
                mimetype="application/json",
                headers=cors,
            )

        logger.info(
            "CalendarBook event created: id=%s status=%s idempotent_id=%s",
            (event or {}).get("id"),
            (event or {}).get("status"),
            event_id,
        )
        email_sent = False
        caller_email_value = caller_email.strip() if isinstance(caller_email, str) else ""
        if caller_email_value and event and not event.get("duplicate"):
            business_name = None
            business_phone = None
            business_email = None
            if client:
                business_name = client.business_name or client.name
                business_phone = client.business_phone
                business_email = client.email
            email_sent = _send_appointment_confirmation_email(
                caller_email_value,
                business_name,
                start_london,
                end_london,
                caller_name,
                business_phone,
                business_email,
            )
            logger.info("CalendarBook confirmation email sent=%s to=%s", email_sent, caller_email_value)
        elif not caller_email_value:
            logger.info("CalendarBook no caller email provided; skipping confirmation email.")
        elif event and event.get("duplicate"):
            logger.info("CalendarBook duplicate event; skipping confirmation email.")
        return func.HttpResponse(
            json.dumps(
                {
                    "event": event,
                    "idempotent_event_id": event_id,
                    "caller_email_sent": email_sent,
                    "resolved": {
                        "start": start_dt.isoformat(),
                        "end": end_dt.isoformat(),
                        "duration_minutes": duration_minutes,
                        "buffer_minutes": buffer_minutes,
                        "title": title,
                        "description": description,
                    },
                }
            ),
            status_code=201,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.exception("Calendar book failed")
        return func.HttpResponse(
            json.dumps({"error": "Calendar booking failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="UltravoxDebugTools")
@app.route(route="ultravox/debug-tools", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def ultravox_debug_tools(req: func.HttpRequest) -> func.HttpResponse:
    """
    Debug helper to list Ultravox tools and agent attachments (guarded by ENABLE_ULTRAVOX_DEBUG flag).
    """
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if (get_setting("ENABLE_ULTRAVOX_DEBUG") or "").lower() not in ("1", "true", "yes", "on"):
        return func.HttpResponse(
            json.dumps({"error": "Debug endpoint disabled"}),
            status_code=404,
            mimetype="application/json",
            headers=cors,
        )

    agent_id = req.params.get("agentId") or req.params.get("agent_id")
    if not agent_id:
        return func.HttpResponse(
            json.dumps({"error": "agentId is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    try:
        agent = get_ultravox_agent(agent_id)
        selected = (agent.get("callTemplate") or {}).get("selectedTools") or []
        tools = list_ultravox_tools()
        attached = [
            tool
            for tool in tools
            if (tool.get("id") or tool.get("toolId") or tool.get("tool_id")) in selected
        ]
        payload = {
            "agentId": agent_id,
            "selectedTools": selected,
            "attachedTools": attached,
            "availableTools": tools,
        }
        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Ultravox debug tools failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to list Ultravox tools"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )


@app.function_name(name="UltravoxEnsureBookingTool")
@app.route(route="ultravox/ensure-tool", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def ultravox_ensure_booking_tool(req: func.HttpRequest) -> func.HttpResponse:
    """
    Force ensure/attach the calendar_book and calendar_availability tools for an agent (guarded by ENABLE_ULTRAVOX_DEBUG).
    Body or params: { agentId? , email? }
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if (get_setting("ENABLE_ULTRAVOX_DEBUG") or "").lower() not in ("1", "true", "yes", "on"):
        return func.HttpResponse(
            json.dumps({"error": "Debug endpoint disabled"}),
            status_code=404,
            mimetype="application/json",
            headers=cors,
        )

    try:
        body = req.get_json()
    except ValueError:
        body = {}
    agent_id = (body or {}).get("agentId") or req.params.get("agentId") or (body or {}).get("agent_id")
    email = (body or {}).get("email") or req.params.get("email")

    db = SessionLocal()
    try:
        if not agent_id and email:
            client = db.query(Client).filter_by(email=email).one_or_none()
            agent_id = client.ultravox_agent_id if client else None
        if not agent_id:
            return func.HttpResponse(
                json.dumps({"error": "agentId or email is required"}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        base = get_public_api_base()
        booking_id, booking_created, booking_attached = ensure_booking_tool(agent_id, base)
        availability_id, availability_created, availability_attached = ensure_availability_tool(agent_id, base)
        agent = get_ultravox_agent(agent_id)
        call_template = agent.get("callTemplate") or {}
        selected = call_template.get("selectedTools") or []
        return func.HttpResponse(
            json.dumps(
                {
                    "agentId": agent_id,
                    "booking_tool_id": booking_id,
                    "booking_created": booking_created,
                    "booking_attached": booking_attached,
                    "availability_tool_id": availability_id,
                    "availability_created": availability_created,
                    "availability_attached": availability_attached,
                    "selectedTools": selected,
                    "callTemplate": call_template,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Ultravox ensure tool failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to ensure tool", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="CalendarAvailability")
@app.route(route="calendar/availability", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def calendar_availability(req: func.HttpRequest) -> func.HttpResponse:
    """
    Check if a slot is available and suggest the next available slot if busy.
    Body: { start, duration_minutes?, buffer_minutes?, email?, agentId?, callerPhone?, callerName? }
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        raw = req.get_body() or b""
        body = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:  # pylint: disable=broad-except
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    if not isinstance(body, dict):
        body = {}

    start_iso = body.get("start")
    duration_minutes = body.get("duration_minutes") or 30
    buffer_minutes = body.get("buffer_minutes") or 5
    email = body.get("email")
    agent_id = (
        body.get("agentId")
        or body.get("agent_id")
        or (body.get("agent") or {}).get("id")
        or (body.get("call") or {}).get("agentId")
        or (body.get("call") or {}).get("agent_id")
        or ((body.get("call") or {}).get("agent") or {}).get("id")
    )
    if isinstance(agent_id, dict):
        agent_id = (
            agent_id.get("value")
            or agent_id.get("agentId")
            or agent_id.get("agent_id")
            or agent_id.get("id")
        )

    try:
        duration_minutes = int(duration_minutes)
    except Exception:
        duration_minutes = 30
    try:
        buffer_minutes = int(buffer_minutes)
    except Exception:
        buffer_minutes = 5

    if not start_iso:
        return func.HttpResponse(
            json.dumps({"error": "Missing start time", "hint": "Provide start in ISO 8601 (e.g., 2025-12-17T15:00:00Z)"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    try:
        if isinstance(start_iso, str) and start_iso.lower() in (
            "current_date_time_iso",
            "current_datetime_iso",
            "current",
            "now",
        ):
            start_dt = datetime.now(ZoneInfo("Europe/London"))
        else:
            start_dt = _parse_dt_with_london_default(start_iso)
    except Exception:  # pylint: disable=broad-except
        return func.HttpResponse(
            json.dumps({"error": "Invalid start time format", "value": start_iso}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    end_dt = _ensure_utc(start_dt + timedelta(minutes=duration_minutes))
    buffered_end = _ensure_utc(end_dt + timedelta(minutes=buffer_minutes)) if buffer_minutes else end_dt

    db = SessionLocal()
    try:
        user = None
        if email:
            user = db.query(User).filter_by(email=email).one_or_none()
        if not user and agent_id:
            client = db.query(Client).filter_by(ultravox_agent_id=agent_id).one_or_none()
            if client:
                email = client.email
                user = db.query(User).filter_by(email=email).one_or_none()
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found", "hint": "Provide email or agentId"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        token = (
            db.query(GoogleToken)
            .filter_by(user_id=user.id)
            .order_by(GoogleToken.created_at.desc())
            .first()
        )
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token = token.access_token
        now = datetime.utcnow()
        if token.expires_at and token.expires_at <= now and token.refresh_token:
            refreshed, refresh_error = _refresh_google_token(token.refresh_token)
            if refresh_error or not refreshed:
                return func.HttpResponse(
                    json.dumps({"error": "Unable to refresh token", "details": refresh_error}),
                    status_code=401,
                    mimetype="application/json",
                    headers=cors,
                )
            access_token = refreshed.get("access_token") or access_token
            token.access_token = access_token
            token.expires_at = (
                datetime.utcnow() + timedelta(seconds=int(refreshed.get("expires_in")))
                if refreshed.get("expires_in")
                else None
            )
            db.commit()

        fb, fb_error = _freebusy(
            access_token,
            start_dt.isoformat(),
            buffered_end.isoformat(),
        )
        if fb_error or not fb:
            return func.HttpResponse(
                json.dumps({"error": "Unable to check availability", "details": fb_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        busy = fb.get("calendars", {}).get("primary", {}).get("busy", [])
        available = not bool(busy)

        def _next_available_slot() -> Optional[dict]:
            probe_start = buffered_end
            for _ in range(12):  # check next 12 slots (e.g., ~6 hours with 30m slots)
                probe_end = probe_start + timedelta(minutes=duration_minutes + buffer_minutes)
                check, check_err = _freebusy(access_token, probe_start.isoformat(), probe_end.isoformat())
                if check_err or not check:
                    probe_start = probe_end
                    continue
                probe_busy = check.get("calendars", {}).get("primary", {}).get("busy", [])
                if not probe_busy:
                    return {
                        "start": probe_start.isoformat(),
                        "end": (probe_start + timedelta(minutes=duration_minutes)).isoformat(),
                    }
                probe_start = max(
                    probe_end,
                    datetime.fromisoformat(probe_busy[-1]["end"].replace("Z", "+00:00")).astimezone(timezone.utc),
                )
            return None

        suggestion = None
        if not available:
            suggestion = _next_available_slot()

        return func.HttpResponse(
            json.dumps(
                {
                    "available": available,
                    "requested": {"start": start_dt.isoformat(), "end": end_dt.isoformat()},
                    "busy": busy if not available else [],
                    "suggestion": suggestion,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.exception("Calendar availability failed")
        return func.HttpResponse(
            json.dumps({"error": "Calendar availability failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="GoogleDisconnect")
@app.route(route="auth/google/disconnect", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def google_disconnect(req: func.HttpRequest) -> func.HttpResponse:
    """
    Delete stored Google tokens for a user to disconnect calendar access.
    Body or params: { email }
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = {}
    email = (body or {}).get("email") or req.params.get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).one_or_none()
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        db.query(GoogleToken).filter_by(user_id=user.id).delete()
        db.commit()
        return func.HttpResponse(
            json.dumps({"message": "Google disconnected"}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Google disconnect failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to disconnect Google", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="OutlookAuthUrl")
@app.route(route="auth/outlook/url", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_outlook_url(req: func.HttpRequest) -> func.HttpResponse:  # pylint: disable=unused-argument
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    settings = get_outlook_oauth_settings()
    if not settings["client_id"] or not settings["client_secret"]:
        return func.HttpResponse(
            json.dumps({"error": "Outlook OAuth env vars missing"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    state_payload = {"nonce": secrets.token_urlsafe(16)}
    if email:
        state_payload["email"] = email
    state = _encode_oauth_state(state_payload)
    url = _build_outlook_auth_url(state)
    return func.HttpResponse(
        json.dumps({"auth_url": url, "state": state}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )


@app.function_name(name="OutlookAuthCallback")
@app.route(
    route="auth/outlook/callback",
    methods=["GET", "POST", "OPTIONS"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def auth_outlook_callback(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    code = req.params.get("code") or None
    state = req.params.get("state")
    if not code:
        try:
            body = req.get_json()
            code = code or (body or {}).get("code")
            state = state or (body or {}).get("state")
        except ValueError:
            code = code or None
    if not code:
        return func.HttpResponse(
            json.dumps({"error": "Missing code"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    token_data, token_error = _exchange_outlook_code_for_tokens(code)
    if token_error or not token_data:
        return func.HttpResponse(
            json.dumps({"error": "Failed to exchange code", "details": token_error}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in")
    token_type = token_data.get("token_type")
    scope = token_data.get("scope")

    profile, profile_error = _get_outlook_userinfo(access_token)
    if profile_error or not profile:
        return func.HttpResponse(
            json.dumps({"error": "Failed to fetch user profile", "details": profile_error}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    outlook_email = profile.get("mail") or profile.get("userPrincipalName")
    name = profile.get("displayName") or outlook_email
    state_payload = _decode_oauth_state(state)
    requested_email = (state_payload or {}).get("email") if isinstance(state_payload, dict) else None
    target_email = requested_email or outlook_email
    if not target_email:
        return func.HttpResponse(
            json.dumps({"error": "Missing email"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=target_email).one_or_none()
        is_new_user = False
        if not user:
            if requested_email:
                return func.HttpResponse(
                    json.dumps({"error": "User not found for Outlook connection"}),
                    status_code=404,
                    mimetype="application/json",
                    headers=cors,
                )
            is_new_user = True
            temp_password = secrets.token_urlsafe(12)
            user = User(email=target_email, password_hash=_hash_password(temp_password))
            db.add(user)
            db.flush()

        outlook_token = (
            db.query(OutlookToken)
            .filter_by(user_id=user.id)
            .order_by(OutlookToken.created_at.desc())
            .first()
        )
        expires_at = (
            datetime.utcnow() + timedelta(seconds=int(expires_in))
            if expires_in
            else None
        )
        if outlook_token:
            outlook_token.access_token = access_token
            outlook_token.refresh_token = refresh_token or outlook_token.refresh_token
            outlook_token.scope = scope
            outlook_token.token_type = token_type
            outlook_token.expires_at = expires_at
            outlook_token.outlook_account_email = outlook_email
        else:
            outlook_token = OutlookToken(
                user_id=user.id,
                access_token=access_token,
                refresh_token=refresh_token,
                scope=scope,
                token_type=token_type,
                expires_at=expires_at,
                outlook_account_email=outlook_email,
            )
            db.add(outlook_token)

        client = db.query(Client).filter_by(email=user.email).one_or_none()
        if client:
            client.user_id = user.id
            client.name = client.name or name
        db.commit()

        payload = {
            "user_id": user.id,
            "email": user.email,
            "state": state,
            "is_new_user": is_new_user,
            "token": {
                "expires_at": expires_at.isoformat() if expires_at else None,
                "has_refresh": bool(refresh_token),
                "scope": scope,
            },
            "profile": {"name": name},
            "outlook_account_email": outlook_email,
        }
        if req.method == "GET":
            html = (
                "<script>"
                "window.opener && window.opener.postMessage("  # type: ignore
                + json.dumps(payload)
                + ', "*");'
                "window.close();"
                "</script>"
                "<p>Outlook connected. You can close this tab.</p>"
            )
            return func.HttpResponse(html, status_code=200, mimetype="text/html", headers=cors)

        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Outlook auth callback failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Outlook auth callback failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="OutlookDisconnect")
@app.route(route="auth/outlook/disconnect", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def outlook_disconnect(req: func.HttpRequest) -> func.HttpResponse:
    """
    Delete stored Outlook tokens for a user to disconnect contacts access.
    Body or params: { email }
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = {}
    email = (body or {}).get("email") or req.params.get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).one_or_none()
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        db.query(OutlookToken).filter_by(user_id=user.id).delete()
        db.commit()
        return func.HttpResponse(
            json.dumps({"message": "Outlook disconnected"}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Outlook disconnect failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to disconnect Outlook", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()
