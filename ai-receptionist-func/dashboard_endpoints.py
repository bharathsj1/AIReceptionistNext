import json
import logging
from typing import Optional

import azure.functions as func
from function_app import app
from onboarding_endpoints import get_twilio_client
from datetime import datetime, timedelta, timezone
from services.ultravox_service import get_ultravox_agent
from shared.db import Client, PhoneNumber, SessionLocal, User
from utils.cors import build_cors_headers
from sqlalchemy.exc import OperationalError
from shared.db import engine

logger = logging.getLogger(__name__)


def _find_client_and_user(db, email: str) -> tuple[Optional[Client], Optional[User]]:
    user = db.query(User).filter_by(email=email).one_or_none()
    client = db.query(Client).filter_by(email=email).one_or_none()
    return client, user


def _with_db_retry(work_fn, *, max_attempts: int = 2):
    """
    Run a DB operation with a single retry on OperationalError.
    Disposes the engine between attempts to clear bad connections.
    """
    last_exc = None
    for attempt in range(max_attempts):
        db = SessionLocal()
        try:
            result = work_fn(db)
            db.close()
            return result
        except OperationalError as exc:  # database dropped connection
            last_exc = exc
            logger.warning("DB OperationalError (attempt %s/%s): %s", attempt + 1, max_attempts, exc)
            try:
                db.rollback()
            except Exception:  # pylint: disable=broad-except
                pass
            db.close()
            engine.dispose()
        except Exception:
            try:
                db.rollback()
            except Exception:  # pylint: disable=broad-except
                pass
            db.close()
            raise
    if last_exc:
        raise last_exc
    raise RuntimeError("DB operation failed after retries")


@app.function_name(name="DashboardGet")
@app.route(route="dashboard", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def dashboard_get(req: func.HttpRequest) -> func.HttpResponse:
    """
    GET /api/dashboard?email=...
    Returns client, user, ultravoX agent info, and phone numbers for the given email.
    """
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

    try:
        payload = _with_db_retry(
            lambda db: _build_dashboard_payload(db, email)
        )
        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except OperationalError as exc:  # pylint: disable=broad-except
        logger.error("DashboardGet database failure after retry: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Database unavailable", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )


def _build_dashboard_payload(db, email: str) -> dict:
    client, user = _find_client_and_user(db, email)
    if not client:
        raise ValueError("Client not found")

    phone_numbers = (
        db.query(PhoneNumber).filter_by(client_id=client.id, is_active=True).all()
    )
    phone_list = [
        {"phone_number": p.twilio_phone_number, "twilio_sid": p.twilio_sid}
        for p in phone_numbers
    ]

    agent_info = None
    if client.ultravox_agent_id:
        try:
            agent_info = get_ultravox_agent(client.ultravox_agent_id)
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Failed to fetch Ultravox agent: %s", exc)

    return {
        "user": {
            "id": user.id if user else None,
            "email": email,
            "is_admin": bool(user.is_admin) if user else False,
        },
        "client": {
            "id": client.id,
            "name": client.name,
            "website_url": client.website_url,
            "ultravox_agent_id": client.ultravox_agent_id,
            "business_name": client.business_name,
            "business_phone": client.business_phone,
            "booking_enabled": bool(client.booking_enabled),
            "booking_duration_minutes": client.booking_duration_minutes,
            "booking_buffer_minutes": client.booking_buffer_minutes,
        },
        "phone_numbers": phone_list,
        "ultravox_agent": agent_info,
    }


@app.function_name(name="DashboardCallLogs")
@app.route(route="dashboard/calls", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def dashboard_call_logs(req: func.HttpRequest) -> func.HttpResponse:
    """
    GET /api/dashboard/calls?email=...&limit=...&days=...
    Fetch recent Twilio calls for the client's active phone numbers.
    Days filters by start_time >= now - days.
    """
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    limit_param = req.params.get("limit")
    days_param = req.params.get("days")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    try:
        limit = min(int(limit_param), 50) if limit_param else 20
    except ValueError:
        limit = 20
    try:
        days_filter = int(days_param) if days_param else None
    except ValueError:
        days_filter = None

    try:
        calls = _with_db_retry(lambda db: _fetch_calls_for_client(db, email, limit, days_filter))
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Client not found"}),
            status_code=404,
            mimetype="application/json",
            headers=cors,
        )
    except OperationalError as exc:  # pylint: disable=broad-except
        logger.error("DashboardCallLogs database failure after retry: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Database unavailable", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("DashboardCallLogs failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to fetch calls", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )

    return func.HttpResponse(
        json.dumps({"calls": calls[:limit]}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )


def _fetch_calls_for_client(db, email: str, limit: int, days_filter: Optional[int]):
    client, _ = _find_client_and_user(db, email)
    if not client:
        raise ValueError("Client not found")

    phone_numbers = (
        db.query(PhoneNumber).filter_by(client_id=client.id, is_active=True).all()
    )
    if not phone_numbers:
        return []

    numbers = [p.twilio_phone_number for p in phone_numbers]
    after_dt = None
    if days_filter:
        after_dt = datetime.now(timezone.utc) - timedelta(days=days_filter)
    try:
        twilio_client = get_twilio_client()
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to init Twilio client: %s", exc)
        raise

    calls_by_sid = {}
    for num in numbers:
        try:
            call_list = twilio_client.calls.list(to=num, limit=limit, start_time_after=after_dt)
            for call in call_list:
                calls_by_sid[call.sid] = call
            call_list_from = twilio_client.calls.list(from_=num, limit=limit, start_time_after=after_dt)
            for call in call_list_from:
                calls_by_sid[call.sid] = call
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Failed to fetch Twilio calls for %s: %s", num, exc)

    calls = []
    for call in calls_by_sid.values():
        from_number = getattr(call, "from_", None)
        if from_number is None and hasattr(call, "_properties"):
            from_number = call._properties.get("from")
        from_formatted = getattr(call, "from_formatted", None)
        if from_formatted is None and hasattr(call, "_properties"):
            from_formatted = call._properties.get("from_formatted") or call._properties.get("fromFormatted")
        caller_name = getattr(call, "caller_name", None)
        if caller_name is None and hasattr(call, "_properties"):
            caller_name = call._properties.get("caller_name") or call._properties.get("callerName")
        from_display = from_formatted or caller_name or from_number
        if not from_display and hasattr(call, "_properties"):
            # Some payloads store the caller in "to" when mirrored; as a last resort use raw string.
            from_display = call._properties.get("from") or call._properties.get("caller")

        resolved_from = from_display or from_number or call.to  # prefer caller; last resort use 'to'

        calls.append(
            {
                "sid": call.sid,
                "status": call.status,
                "direction": call.direction,
                "from": resolved_from,
                "from_raw": from_number,
                "from_display": from_display,
                "to": call.to,
                "duration": call.duration,
                "start_time": call.start_time.isoformat() if call.start_time else None,
                "end_time": call.end_time.isoformat() if call.end_time else None,
                "price": call.price,
            }
        )

    calls.sort(key=lambda c: c.get("start_time") or "", reverse=True)
    return calls


@app.function_name(name="DashboardUpdateAgent")
@app.route(route="dashboard/agent", methods=["PUT", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def dashboard_update_agent(req: func.HttpRequest) -> func.HttpResponse:
    """
    PUT /api/dashboard/agent
    Body: { "email": "...", "system_prompt": "...", "voice": "Jessica", "temperature": 0.4 }
    Updates the Ultravox agent callTemplate fields (simple PATCH).
    """
    cors = build_cors_headers(req, ["PUT", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        body = {}

    email = body.get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    system_prompt = body.get("system_prompt")
    voice = body.get("voice")
    temperature = body.get("temperature")

    db = SessionLocal()
    try:
        client, _ = _find_client_and_user(db, email)
        if not client or not client.ultravox_agent_id:
            return func.HttpResponse(
                json.dumps({"error": "Client or agent not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        update_payload = {"callTemplate": {}}
        if isinstance(system_prompt, str) and system_prompt.strip():
            update_payload["callTemplate"]["systemPrompt"] = system_prompt.strip()
        if isinstance(voice, str) and voice.strip():
            update_payload["callTemplate"]["voice"] = voice.strip()
        if isinstance(temperature, (int, float)):
            update_payload["callTemplate"]["temperature"] = float(temperature)

        if not update_payload["callTemplate"]:
            return func.HttpResponse(
                json.dumps({"error": "No updatable fields provided"}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        from services.ultravox_service import _headers, ULTRAVOX_BASE_URL  # pylint: disable=protected-access
        import httpx

        with httpx.Client(timeout=20) as client_http:
            resp = client_http.patch(
                f"{ULTRAVOX_BASE_URL}/agents/{client.ultravox_agent_id}",
                headers=_headers(),
                json=update_payload,
            )
        if resp.status_code >= 300:
            return func.HttpResponse(
                json.dumps({"error": "Ultravox update failed", "details": resp.text}),
                status_code=500,
                mimetype="application/json",
                headers=cors,
            )

        return func.HttpResponse(
            json.dumps({"message": "Agent updated"}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="DashboardCallTranscript")
@app.route(
    route="dashboard/call-transcript",
    methods=["GET", "OPTIONS"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def dashboard_call_transcript(req: func.HttpRequest) -> func.HttpResponse:
    """
    GET /api/dashboard/call-transcript?email=...&callSid=...
    Returns Twilio recordings and any transcriptions for a specific call SID.
    """
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    call_sid = req.params.get("callSid") or req.params.get("call_sid")
    if not email or not call_sid:
        return func.HttpResponse(
            json.dumps({"error": "email and callSid are required"}),
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

        phone_numbers = (
            db.query(PhoneNumber).filter_by(client_id=client.id, is_active=True).all()
        )
        owned_numbers = {p.twilio_phone_number for p in phone_numbers}

        try:
            twilio_client = get_twilio_client()
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Failed to init Twilio client: %s", exc)
            return func.HttpResponse(
                json.dumps({"error": "Twilio client init failed", "details": str(exc)}),
                status_code=500,
                mimetype="application/json",
                headers=cors,
            )

        try:
            call = twilio_client.calls(call_sid).fetch()
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Call fetch failed for %s: %s", call_sid, exc)
            return func.HttpResponse(
                json.dumps({"error": "Call not found", "details": str(exc)}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        # Verify the call belongs to one of the client's numbers when possible.
        call_from = getattr(call, "from_", None) or getattr(call, "from", None)
        call_to = getattr(call, "to", None)
        if owned_numbers and call_from not in owned_numbers and call_to not in owned_numbers:
            return func.HttpResponse(
                json.dumps({"error": "Call does not belong to this client"}),
                status_code=403,
                mimetype="application/json",
                headers=cors,
            )

        recordings = []
        transcripts = []

        try:
            recs = twilio_client.calls(call_sid).recordings.list(limit=10)
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Recording fetch failed for %s: %s", call_sid, exc)
            recs = []

        for rec in recs:
            rec_entry = {
                "sid": rec.sid,
                "status": getattr(rec, "status", None),
                "duration": getattr(rec, "duration", None),
                "date_created": rec.date_created.isoformat() if rec.date_created else None,
                "media_url": getattr(rec, "media_url", None),
            }
            recordings.append(rec_entry)
            try:
                trans = twilio_client.transcriptions.list(recording_sid=rec.sid, limit=10)
            except Exception as exc:  # pylint: disable=broad-except
                logger.warning("Transcription fetch failed for recording %s: %s", rec.sid, exc)
                trans = []

            for t_item in trans:
                text = (
                    getattr(t_item, "transcription_text", None)
                    or getattr(t_item, "transcriptionText", None)
                    or getattr(getattr(t_item, "_properties", {}), "get", lambda *_: None)("transcription_text")
                )
                transcripts.append(
                    {
                        "sid": t_item.sid,
                        "status": getattr(t_item, "status", None),
                        "text": text,
                        "price": getattr(t_item, "price", None),
                        "date_created": t_item.date_created.isoformat() if t_item.date_created else None,
                    }
                )

        payload = {
            "call": {
                "sid": call.sid,
                "from": call_from,
                "to": call_to,
                "status": getattr(call, "status", None),
                "start_time": call.start_time.isoformat() if call.start_time else None,
                "end_time": call.end_time.isoformat() if call.end_time else None,
                "direction": getattr(call, "direction", None),
                "duration": getattr(call, "duration", None),
            },
            "recordings": recordings,
            "transcripts": transcripts,
        }

        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="DashboardBookingSettings")
@app.route(
    route="dashboard/booking-settings",
    methods=["PUT", "OPTIONS"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def dashboard_booking_settings(req: func.HttpRequest) -> func.HttpResponse:
    """
    PUT /api/dashboard/booking-settings
    Body: { "email": "...", "booking_enabled": bool, "duration_minutes": int, "buffer_minutes": int }
    Stores booking preferences on the client.
    """
    cors = build_cors_headers(req, ["PUT", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        body = {}

    email = body.get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    booking_enabled = bool(body.get("booking_enabled"))
    duration_minutes = body.get("duration_minutes")
    buffer_minutes = body.get("buffer_minutes")

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

        client.booking_enabled = booking_enabled
        if isinstance(duration_minutes, int):
            client.booking_duration_minutes = duration_minutes
        if isinstance(buffer_minutes, int):
            client.booking_buffer_minutes = buffer_minutes
        db.commit()

        return func.HttpResponse(
            json.dumps({"message": "Booking settings saved"}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Failed to save booking settings: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to save booking settings", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()
