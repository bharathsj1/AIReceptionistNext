import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import parse_qs

import azure.functions as func
from twilio.base.exceptions import TwilioRestException
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.rest import Client
from twilio.twiml.voice_response import VoiceResponse

from function_app import app

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
    plus = raw.startswith("+")
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return ""
    candidate = f"+{digits}" if plus or digits else ""
    return candidate if _is_e164(candidate) else ""


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


def _resolve_selected_from_number(req: func.HttpRequest, client: Client, fallback_number: str) -> tuple[str, Optional[str]]:
    requested = _get_form_param(req, "FromNumber") or _get_form_param(req, "callerId")
    requested_e164 = _normalize_e164(requested)
    options = _list_active_numbers(client, fallback_number)
    allowed = {item["phone_number"] for item in options}

    if requested and not requested_e164:
        return "", "Invalid caller number format. Use E.164."
    if requested_e164 and requested_e164 not in allowed:
        return "", "Selected caller number is not active on this Twilio account."
    if requested_e164:
        return requested_e164, None

    country_code = _resolve_country_code(req)
    selected = _select_number_for_country(options, country_code, fallback_number)
    if selected:
        return selected, None
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
    if req.method == "OPTIONS":
        return func.HttpResponse(status_code=204, headers=API_HEADERS)

    identity = (req.params.get("identity") or "web_user").strip()
    if not _is_valid_identity(identity):
        return _json_response(
            {
                "error": (
                    "Invalid identity. Use 1-121 chars with letters, numbers, or underscore only."
                )
            },
            status_code=400,
        )

    account_sid = _get_setting("TWILIO_ACCOUNT_SID")
    api_key_sid = _get_setting("TWILIO_API_KEY")
    api_key_secret = _get_setting("TWILIO_API_SECRET")
    twiml_app_sid = _get_setting("TWILIO_TWIML_APP_SID")

    if not all([account_sid, api_key_sid, api_key_secret, twiml_app_sid]):
        return _json_response(
            {
                "error": (
                    "Missing client-call config. Set TWILIO_ACCOUNT_SID, TWILIO_API_KEY, "
                    "TWILIO_API_SECRET, and TWILIO_TWIML_APP_SID."
                )
            },
            status_code=500,
        )

    token = AccessToken(
        account_sid=account_sid,
        signing_key_sid=api_key_sid,
        secret=api_key_secret,
        identity=identity,
        ttl=3600,
    )
    token.add_grant(VoiceGrant(outgoing_application_sid=twiml_app_sid))
    jwt_token = token.to_jwt()
    token_value = jwt_token.decode("utf-8") if isinstance(jwt_token, bytes) else jwt_token

    return _json_response({"token": token_value, "identity": identity, "expires_in": 3600})


@app.function_name(name="VoiceOutbound")
@app.route(route="voice-outbound", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def voice_outbound(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return func.HttpResponse(status_code=204, headers=API_HEADERS)

    to_number = _get_form_param(req, "To")
    fallback_from = _get_setting("TWILIO_FROM_NUMBER") or _get_setting("TWILIO_CALLER_ID")

    response = VoiceResponse()
    client = _build_rest_client()
    if not client:
        response.say("Twilio credentials are missing.", voice="alice", language="en-US")
        response.hangup()
        return _xml_response(str(response), status_code=200)

    from_number, from_error = _resolve_selected_from_number(req, client, fallback_from)
    if from_error:
        response.say(from_error, voice="alice", language="en-US")
        response.hangup()
        return _xml_response(str(response), status_code=200)

    if not _is_e164(to_number):
        response.say("Invalid destination number.", voice="alice", language="en-US")
        response.hangup()
        return _xml_response(str(response), status_code=200)

    if not _is_e164(from_number):
        response.say("Calling service is not configured correctly.", voice="alice", language="en-US")
        response.hangup()
        return _xml_response(str(response), status_code=200)

    dial = response.dial(caller_id=from_number, answer_on_bridge=True)
    dial.number(to_number)
    return _xml_response(str(response), status_code=200)


@app.function_name(name="CallHistory")
@app.route(route="call-history", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def call_history(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return func.HttpResponse(status_code=204, headers=API_HEADERS)

    client = _build_rest_client()
    if not client:
        return _json_response(
            {
                "error": (
                    "Missing Twilio credentials for history. Set TWILIO_ACCOUNT_SID and either "
                    "(TWILIO_API_KEY + TWILIO_API_SECRET) or TWILIO_AUTH_TOKEN."
                )
            },
            status_code=500,
        )

    limit = _get_limit(req)
    status_filter = (req.params.get("status") or "all").strip().lower()
    query = (req.params.get("q") or "").strip().lower()
    period = (req.params.get("period") or "all").strip().lower()
    start_date = (req.params.get("start_date") or "").strip()
    end_date = (req.params.get("end_date") or "").strip()

    if period not in SUPPORTED_PERIODS:
        return _json_response(
            {"error": "Invalid period. Use all, today, this_week, this_month, or custom."},
            status_code=400,
        )

    start_bound, end_bound, bounds_error = _resolve_period_bounds(period, start_date, end_date)
    if bounds_error:
        return _json_response({"error": bounds_error}, status_code=400)

    try:
        calls = client.calls.list(limit=limit)
    except TwilioRestException as exc:
        return _json_response(
            {"error": "Twilio API error while loading call history", "details": str(exc)},
            status_code=502,
        )
    except Exception as exc:  # pragma: no cover - defensive guard for runtime failures
        return _json_response({"error": "Failed to load call history", "details": str(exc)}, status_code=500)

    default_from = _get_setting("TWILIO_FROM_NUMBER") or _get_setting("TWILIO_CALLER_ID")
    items = [_call_to_payload(call, default_from_number=default_from) for call in calls]

    if query:
        items = [
            item
            for item in items
            if query in item["to"].lower() or query in item["from"].lower() or query in (item["status"] or "")
        ]

    if status_filter == "missed":
        items = [item for item in items if item["is_missed"]]
    elif status_filter == "completed":
        items = [item for item in items if item["is_completed"]]
    elif status_filter != "all":
        items = [item for item in items if item["status"] == status_filter]

    if start_bound or end_bound:
        filtered_items = []
        for item in items:
            call_time = _call_event_time(item)
            if not call_time:
                continue
            if start_bound and call_time < start_bound:
                continue
            if end_bound and call_time >= end_bound:
                continue
            filtered_items.append(item)
        items = filtered_items

    total_minutes = round(sum(item["duration_seconds"] for item in items) / 60, 2)
    missed_count = sum(1 for item in items if item["is_missed"])
    completed_count = sum(1 for item in items if item["is_completed"])

    summary = {
        "total_calls": len(items),
        "completed_calls": completed_count,
        "missed_calls": missed_count,
        "total_minutes": total_minutes,
    }

    filters = {
        "status": status_filter,
        "q": query,
        "period": period,
        "start_date": start_date or None,
        "end_date": end_date or None,
    }
    return _json_response({"summary": summary, "filters": filters, "calls": items})


@app.function_name(name="ActivePhoneNumbers")
@app.route(route="active-phone-numbers", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def active_phone_numbers(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return func.HttpResponse(status_code=204, headers=API_HEADERS)

    client = _build_rest_client()
    if not client:
        return _json_response(
            {
                "error": (
                    "Missing Twilio credentials. Set TWILIO_ACCOUNT_SID and either "
                    "(TWILIO_API_KEY + TWILIO_API_SECRET) or TWILIO_AUTH_TOKEN."
                )
            },
            status_code=500,
        )

    default_from = _get_setting("TWILIO_FROM_NUMBER") or _get_setting("TWILIO_CALLER_ID")
    items = _list_active_numbers(client, default_from)
    resolved_country = _resolve_country_code(req)
    selected = _select_number_for_country(items, resolved_country, default_from)
    return _json_response({"items": items, "selected": selected, "resolved_country": resolved_country})
