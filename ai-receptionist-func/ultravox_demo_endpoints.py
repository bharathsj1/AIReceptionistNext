import json
import logging
from typing import Any, Dict

import azure.functions as func
import httpx

from function_app import app
from shared.config import get_required_setting

logger = logging.getLogger(__name__)

AGENT_ID = "0a6ea934-ddea-4819-a3a4-ab7475b1366e"
ULTRAVOX_API_BASE = "https://api.ultravox.ai/api"


def _build_payload() -> Dict[str, Any]:
    return {
        "medium": {
            "webRtc": {
                "dataMessages": {
                    "transcript": True,
                    "state": True,
                    "callEvent": True,
                }
            }
        },
        "initialOutputMedium": "MESSAGE_MEDIUM_VOICE",
    }


@app.function_name(name="UltravoxDemoCall")
@app.route(route="ultravox-demo-call", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def create_ultravox_demo_call(req: func.HttpRequest) -> func.HttpResponse:
    """
    Create a demo Ultravox call and return the joinUrl for the web client.
    """
    try:
        api_key = get_required_setting("ULTRAVOX_API_KEY")
    except ValueError as exc:
        logger.error("Ultravox API key missing: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Server is not configured with ULTRAVOX_API_KEY"}),
            status_code=500,
            mimetype="application/json",
        )

    url = f"{ULTRAVOX_API_BASE}/agents/{AGENT_ID}/calls"
    payload = _build_payload()
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
    }

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(url, headers=headers, json=payload)
    except httpx.RequestError as exc:
        logger.error("Failed to reach Ultravox API: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Could not contact Ultravox API"}),
            status_code=500,
            mimetype="application/json",
        )

    if resp.status_code >= 300:
        logger.error("Ultravox API error %s: %s", resp.status_code, resp.text)
        return func.HttpResponse(
            json.dumps({"error": "Failed to start Ultravox demo call"}),
            status_code=500,
            mimetype="application/json",
        )

    data = resp.json()
    join_url = data.get("joinUrl")
    if not join_url:
        logger.error("Ultravox API response missing joinUrl: %s", data)
        return func.HttpResponse(
            json.dumps({"error": "Ultravox joinUrl was missing in response"}),
            status_code=500,
            mimetype="application/json",
        )

    return func.HttpResponse(
        json.dumps({"joinUrl": join_url}),
        status_code=200,
        mimetype="application/json",
    )
