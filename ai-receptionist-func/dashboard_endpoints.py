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

logger = logging.getLogger(__name__)


def _find_client_and_user(db, email: str) -> tuple[Optional[Client], Optional[User]]:
    user = db.query(User).filter_by(email=email).one_or_none()
    client = db.query(Client).filter_by(email=email).one_or_none()
    return client, user


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

    db = SessionLocal()
    try:
        client, user = _find_client_and_user(db, email)
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

        payload = {
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
            },
            "phone_numbers": phone_list,
            "ultravox_agent": agent_info,
        }
        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


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
        if not phone_numbers:
            return func.HttpResponse(
                json.dumps({"calls": []}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

        numbers = [p.twilio_phone_number for p in phone_numbers]
        after_dt = None
        if days_filter:
            after_dt = datetime.now(timezone.utc) - timedelta(days=days_filter)
        try:
            twilio_client = get_twilio_client()
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Failed to init Twilio client: %s", exc)
            return func.HttpResponse(
                json.dumps({"error": "Twilio client init failed", "details": str(exc)}),
                status_code=500,
                mimetype="application/json",
            )

        # Collect calls for each number (incoming/outgoing) and dedupe by SID.
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

        # Format response
        calls = []
        for call in calls_by_sid.values():
            # Twilio may not always populate from_ (or the attr may be absent); fall back to raw properties.
            from_number = getattr(call, "from_", None)
            if from_number is None and hasattr(call, "_properties"):
                from_number = call._properties.get("from")

            calls.append(
                {
                    "sid": call.sid,
                    "status": call.status,
                    "direction": call.direction,
                    "from": from_number,
                    "to": call.to,
                    "duration": call.duration,
                    "start_time": call.start_time.isoformat() if call.start_time else None,
                    "end_time": call.end_time.isoformat() if call.end_time else None,
                    "price": call.price,
                }
            )

        # Sort by start_time desc
        calls.sort(key=lambda c: c.get("start_time") or "", reverse=True)

        return func.HttpResponse(
            json.dumps({"calls": calls[:limit]}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


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
