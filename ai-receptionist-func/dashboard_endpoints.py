import json
import logging
from typing import Optional

import azure.functions as func
from function_app import app
from services.ultravox_service import get_ultravox_agent
from shared.db import Client, PhoneNumber, SessionLocal, User

logger = logging.getLogger(__name__)


def _find_client_and_user(db, email: str) -> tuple[Optional[Client], Optional[User]]:
    user = db.query(User).filter_by(email=email).one_or_none()
    client = db.query(Client).filter_by(email=email).one_or_none()
    return client, user


@app.function_name(name="DashboardGet")
@app.route(route="dashboard", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def dashboard_get(req: func.HttpRequest) -> func.HttpResponse:
    """
    GET /api/dashboard?email=...
    Returns client, user, ultravoX agent info, and phone numbers for the given email.
    """
    email = req.params.get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
        )

    db = SessionLocal()
    try:
        client, user = _find_client_and_user(db, email)
        if not client:
            return func.HttpResponse(
                json.dumps({"error": "Client not found"}),
                status_code=404,
                mimetype="application/json",
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
        )
    finally:
        db.close()


@app.function_name(name="DashboardUpdateAgent")
@app.route(route="dashboard/agent", methods=["PUT"], auth_level=func.AuthLevel.ANONYMOUS)
def dashboard_update_agent(req: func.HttpRequest) -> func.HttpResponse:
    """
    PUT /api/dashboard/agent
    Body: { "email": "...", "system_prompt": "...", "voice": "Jessica", "temperature": 0.4 }
    Updates the Ultravox agent callTemplate fields (simple PATCH).
    """
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
            )

        return func.HttpResponse(
            json.dumps({"message": "Agent updated"}),
            status_code=200,
            mimetype="application/json",
        )
    finally:
        db.close()
