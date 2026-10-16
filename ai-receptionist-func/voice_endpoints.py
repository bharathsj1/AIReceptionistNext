import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import parse_qs

import azure.functions as func
from sqlalchemy import func as sa_func, or_
from twilio.base.exceptions import TwilioRestException
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.rest import Client
from twilio.twiml.voice_response import VoiceResponse

from function_app import app
from shared.db import CallerNumber, Client as ClientRecord, ClientUser, SessionLocal, User

PHONE_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")
IDENTITY_PATTERN = re.compile(r"^[A-Za-z0-9_]{1,121}$")
MISSED_STATUSES = {"no-answer", "busy", "failed", "canceled"}
SUPPORTED_PERIODS = {"all", "today", "this_week", "this_month", "custom"}
COUNTRY_TO_DIAL_PREFIXES = {
    "GB": ["+44"],
    "UK": ["+44"],
    "US": ["+1"],
    "CA": ["+1"],
    "AU": ["+61"],
    "NZ": ["+64"],
    "IE": ["+353"],
    "IN": ["+91"],
    "FR": ["+33"],
    "DE": ["+49"],
    "ES": ["+34"],
    "IT": ["+39"],
}
API_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}
LOCAL_SETTINGS_PATH = os.path.join(os.path.dirname(__file__), "local.settings.json")


def _json_response(payload: dict, status_code: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        body=json.dumps(payload),
        status_code=status_code,
        headers=API_HEADERS,
        mimetype="application/json",
    )


def _xml_response(body: str, status_code: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        body=body,
        status_code=status_code,
        headers={"Content-Type": "application/xml"},
        mimetype="application/xml",
    )


def _is_e164(value: Optional[str]) -> bool:
    return bool(value and PHONE_PATTERN.fullmatch(value.strip()))


def _read_local_setting(name: str) -> str:
    try:
        with open(LOCAL_SETTINGS_PATH, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
            values = payload.get("Values", {})
            value = values.get(name, "")
            return value.strip() if isinstance(value, str) else ""
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return ""


def _get_setting(name: str) -> str:
    env_value = (os.getenv(name) or "").strip()
    if env_value:
        return env_value
    return _read_local_setting(name)


def _is_valid_identity(identity: str) -> bool:
    return bool(identity and IDENTITY_PATTERN.fullmatch(identity))


def _to_iso8601(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _to_int(value: Optional[str]) -> int:
    try:
        return int(value) if value else 0
    except (TypeError, ValueError):
        return 0


def _normalize_e164(value: Optional[str]) -> str:
    if not value:
        return ""
    raw = str(value).strip()
    if not raw:
        return ""
    if raw.startswith("client:"):
        return raw
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return ""
    if raw.startswith("+"):
        candidate_digits = digits
    else:
        candidate_digits = digits
        if candidate_digits.startswith("00") and len(candidate_digits) > 2:
            candidate_digits = candidate_digits[2:]
        elif candidate_digits.startswith("011") and len(candidate_digits) > 3:
            candidate_digits = candidate_digits[3:]
        candidate_digits = candidate_digits.lstrip("0")
    candidate = f"+{candidate_digits}" if candidate_digits else ""
    return candidate if _is_e164(candidate) else ""


def _normalize_email(value: Optional[str]) -> str:
    return str(value or "").strip().lower()


def _resolve_client_by_email(db, email: Optional[str]) -> Optional[ClientRecord]:
    normalized = _normalize_email(email)
    if not normalized:
        return None

    client = (
        db.query(ClientRecord)
        .filter(sa_func.lower(sa_func.trim(ClientRecord.email)) == normalized)
        .order_by(ClientRecord.id.asc())
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
        return db.query(ClientRecord).filter_by(id=client_user.client_id).one_or_none()

    user = (
        db.query(User)
        .filter(sa_func.lower(sa_func.trim(User.email)) == normalized)
        .order_by(User.id.asc())
        .first()
    )
    if user:
        return db.query(ClientRecord).filter_by(user_id=user.id).order_by(ClientRecord.id.asc()).first()
    return None


def _extract_request_email(req: func.HttpRequest) -> str:
    query_email = (
        req.params.get("email")
        or req.params.get("userEmail")
        or req.params.get("sessionEmail")
        or ""
    ).strip()
    if query_email:
        return _normalize_email(query_email)
    form_email = (
        _get_form_param(req, "Email")
        or _get_form_param(req, "email")
        or _get_form_param(req, "sessionEmail")
        or ""
    ).strip()
    return _normalize_email(form_email)



def _list_client_caller_number_items(db, client_id: int) -> list[dict]:
    rows = (
        db.query(CallerNumber)
        .filter(
            CallerNumber.client_id == client_id,
            or_(
                CallerNumber.is_active.is_(True),
                CallerNumber.is_active.is_(None),
            ),
        )
        .order_by(CallerNumber.id.asc())
        .all()
    )
    items: list[dict] = []
    seen_numbers: set[str] = set()
    for row in rows:
        raw_number = str(row.phone_number or "").strip()
        if not raw_number:
            continue
        normalized = _normalize_e164(raw_number)
        value = normalized or raw_number
        if value in seen_numbers:
            continue
        seen_numbers.add(value)
        items.append(
            {
                "phone_number": value,
                "friendly_name": (row.friendly_name or raw_number).strip(),
            }
        )
    return items


def _resolve_country_code(req: func.HttpRequest) -> str:
    header_keys = [
        "cf-ipcountry",
        "x-country-code",
        "x-geo-country",
        "x-azure-country",
        "x-appservice-country",
        "cloudfront-viewer-country",
        "x-vercel-ip-country",
        "x-country",
    ]
    for key in header_keys:
        value = req.headers.get(key)
        if value:
            code = str(value).strip().upper()
            if len(code) == 2:
                return code

    query_country = (req.params.get("country") or "").strip().upper()
    if len(query_country) == 2:
        return query_country

    body_country = (_get_form_param(req, "Country") or "").strip().upper()
    if len(body_country) == 2:
        return body_country

    fallback = (_get_setting("TWILIO_DEFAULT_COUNTRY") or "US").strip().upper()
    return fallback if len(fallback) == 2 else "US"


def _call_field(call, field_name: str, fallback: str = "") -> str:
    # Twilio objects can expose fields as attributes or in internal properties.
    attr_value = getattr(call, field_name, None)
    if isinstance(attr_value, str) and attr_value.strip():
        return attr_value.strip()

    props = getattr(call, "_properties", None)
    if isinstance(props, dict):
        prop_value = props.get(field_name)
        if isinstance(prop_value, str) and prop_value.strip():
            return prop_value.strip()

    return fallback


def _call_number_field(call, *field_names: str) -> str:
    for field_name in field_names:
        value = _call_field(call, field_name)
        if value:
            return value
    return ""


def _build_rest_client() -> Optional[Client]:
    account_sid = _get_setting("TWILIO_ACCOUNT_SID")
    api_key_sid = _get_setting("TWILIO_API_KEY")
    api_key_secret = _get_setting("TWILIO_API_SECRET")
    auth_token = _get_setting("TWILIO_AUTH_TOKEN")

    if account_sid and api_key_sid and api_key_secret:
        return Client(api_key_sid, api_key_secret, account_sid)

    if account_sid and auth_token:
        return Client(account_sid, auth_token)

    return None


def _list_active_numbers(client: Client, default_from: str = "") -> list[dict]:
    options: list[dict] = []
    seen: set[str] = set()

    def add(number: str, friendly_name: str = "") -> None:
        normalized = _normalize_e164(number)
        if not normalized or normalized in seen:
            return
        seen.add(normalized)
        options.append(
            {
                "phone_number": normalized,
                "friendly_name": (friendly_name or normalized).strip(),
            }
        )

    try:
        for item in client.incoming_phone_numbers.list(limit=200):
            capabilities = getattr(item, "capabilities", None)
            if capabilities is None:
                properties = getattr(item, "_properties", None)
                if isinstance(properties, dict):
                    capabilities = properties.get("capabilities")
            if isinstance(capabilities, dict) and not capabilities.get("voice", False):
                continue
            add(getattr(item, "phone_number", ""), getattr(item, "friendly_name", ""))
    except TwilioRestException:
        pass
    except Exception:
        pass

    try:
        for item in client.outgoing_caller_ids.list(limit=200):
            add(getattr(item, "phone_number", ""), getattr(item, "friendly_name", ""))
    except TwilioRestException:
        pass
    except Exception:
        pass

    add(default_from, "Default caller ID")
    return options


def _select_number_for_country(options: list[dict], country_code: str, fallback_number: str) -> str:
    prefixes = COUNTRY_TO_DIAL_PREFIXES.get(str(country_code or "").upper(), [])
    if prefixes:
        for item in options:
            number = str(item.get("phone_number") or "")
            if any(number.startswith(prefix) for prefix in prefixes):
                return number

    fallback_e164 = _normalize_e164(fallback_number)
    if fallback_e164:
        for item in options:
            if item.get("phone_number") == fallback_e164:
                return fallback_e164

    return str(options[0].get("phone_number") or "") if options else ""


def _list_allowed_numbers_for_request(
    req: func.HttpRequest,
    twilio_client: Client,
    fallback_number: str,
) -> list[dict]:
    from crm_shared import resolve_actor_from_session
    from services.outreach_service import caller_numbers
    actor = resolve_actor_from_session(req)
    if not actor:
        return []
    db = SessionLocal()
    try:
        return [{"phone_number": n, "friendly_name": n} for n in caller_numbers(db, actor.client_id)]
    finally:
        db.close()


def _resolve_selected_from_number(req: func.HttpRequest, client: Client, fallback_number: str) -> tuple[str, Optional[str]]:
    requested = _get_form_param(req, "FromNumber") or _get_form_param(req, "callerId")
    requested_raw = str(requested or "").strip()
    requested_e164 = _normalize_e164(requested)
    options = _list_allowed_numbers_for_request(req, client, fallback_number)
    allowed_raw = {str(item.get("phone_number") or "").strip() for item in options if str(item.get("phone_number") or "").strip()}
    allowed_e164 = {_normalize_e164(number) for number in allowed_raw}
    allowed_e164 = {number for number in allowed_e164 if number}

    if requested_raw:
        if requested_raw in allowed_raw:
            return requested_e164 or requested_raw, None
        if requested_e164 and requested_e164 in allowed_e164:
            return requested_e164, None
        return "", "Selected caller number is not active on this Twilio account."

    country_code = _resolve_country_code(req)
    selected = _select_number_for_country(options, country_code, fallback_number)
    selected_raw = str(selected or "").strip()
    if selected_raw:
        selected_e164 = _normalize_e164(selected_raw)
        return selected_e164 or selected_raw, None
    return "", "No active Twilio caller number is configured."


def _call_to_payload(call, default_from_number: str = "") -> dict:
    status = (call.status or "").strip().lower()
    duration_seconds = _to_int(call.duration)
    from_number = _call_number_field(call, "from", "from_", "from_formatted")
    to_number = _call_number_field(call, "to", "to_formatted")
    direction = (call.direction or "").strip().lower()
    is_missed = status in MISSED_STATUSES
    if not from_number and direction.startswith("outbound") and _is_e164(default_from_number):
        from_number = default_from_number

    return {
        "sid": call.sid,
        "parent_call_sid": call.parent_call_sid,
        "from": from_number,
        "to": to_number,
        "direction": direction,
        "status": status,
        "duration_seconds": duration_seconds,
        "duration_minutes": round(duration_seconds / 60, 2),
        "price": call.price,
        "price_unit": call.price_unit,
        "start_time": _to_iso8601(call.start_time),
        "end_time": _to_iso8601(call.end_time),
        "date_created": _to_iso8601(call.date_created),
        "is_missed": is_missed,
        "is_completed": status == "completed",
        "leg_type": "child" if call.parent_call_sid else "primary",
    }


def _get_limit(req: func.HttpRequest, default: int = 100, maximum: int = 250) -> int:
    raw = (req.params.get("limit") or "").strip()
    if not raw:
        return default
    try:
        parsed = int(raw)
    except ValueError:
        return default
    return max(1, min(maximum, parsed))


def _parse_iso8601(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def _parse_yyyy_mm_dd(value: str) -> Optional[datetime]:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
        return parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _call_event_time(item: dict) -> Optional[datetime]:
    return _parse_iso8601(item.get("start_time")) or _parse_iso8601(item.get("date_created"))


def _resolve_period_bounds(
    period: str, start_date: Optional[str], end_date: Optional[str]
) -> tuple[Optional[datetime], Optional[datetime], Optional[str]]:
    now = datetime.now(timezone.utc)
    period = period.lower()

    if period == "all":
        return None, None, None

    if period == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return start, start + timedelta(days=1), None

    if period == "this_week":
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        return start, start + timedelta(days=7), None

    if period == "this_month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if start.month == 12:
            end = start.replace(year=start.year + 1, month=1)
        else:
            end = start.replace(month=start.month + 1)
        return start, end, None

    if period == "custom":
        parsed_start = _parse_yyyy_mm_dd(start_date) if start_date else None
        parsed_end = _parse_yyyy_mm_dd(end_date) if end_date else None

        if start_date and not parsed_start:
            return None, None, "Invalid start_date. Use YYYY-MM-DD."
        if end_date and not parsed_end:
            return None, None, "Invalid end_date. Use YYYY-MM-DD."

        start_bound = parsed_start
        end_bound = parsed_end + timedelta(days=1) if parsed_end else None
        if start_bound and end_bound and start_bound >= end_bound:
            return None, None, "end_date must be same day or after start_date."
        return start_bound, end_bound, None

    return None, None, "Invalid period. Use all, today, this_week, this_month, or custom."


def _get_form_param(req: func.HttpRequest, key: str) -> str:
    direct = (req.params.get(key) or "").strip()
    if direct:
        return direct

    try:
        body = req.get_body().decode("utf-8")
        parsed = parse_qs(body, keep_blank_values=True)
        values = parsed.get(key, [])
        return values[0].strip() if values else ""
    except Exception:
        return ""


@app.function_name(name="Hello")
@app.route(route="hello", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def hello(req: func.HttpRequest) -> func.HttpResponse:
    return _json_response({"message": "Twilio live dialer is running."})


@app.function_name(name="VoiceToken")
@app.route(route="voice-token", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def voice_token(req: func.HttpRequest) -> func.HttpResponse:
    """Shared legacy dialler routes are retired in the calling workspace."""
    return _json_response({"error": "Use signed-in outreach calling and history routes"},
        status_code=204 if req.method == "OPTIONS" else 410)


@app.function_name(name="VoiceOutbound")
@app.route(route="voice-outbound", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def voice_outbound(req: func.HttpRequest) -> func.HttpResponse:
    """Shared legacy dialler routes are retired in the calling workspace."""
    return _json_response({"error": "Use signed-in outreach calling and history routes"},
        status_code=204 if req.method == "OPTIONS" else 410)


@app.function_name(name="CallHistory")
@app.route(route="call-history", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def call_history(req: func.HttpRequest) -> func.HttpResponse:
    """Shared legacy dialler routes are retired in the calling workspace."""
    return _json_response({"error": "Use signed-in outreach calling and history routes"},
        status_code=204 if req.method == "OPTIONS" else 410)


@app.function_name(name="ActivePhoneNumbers")
@app.route(route="active-phone-numbers", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def active_phone_numbers(req: func.HttpRequest) -> func.HttpResponse:
    from number_endpoints import account_numbers
    return account_numbers(req)
