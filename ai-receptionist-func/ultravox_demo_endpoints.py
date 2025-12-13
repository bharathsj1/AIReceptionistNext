import json
import logging
from typing import Any, Dict, List, Optional

import azure.functions as func
import httpx

from function_app import app
from shared.config import get_required_setting
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)

DEFAULT_AGENT_ID = "0a6ea934-ddea-4819-a3a4-ab7475b1366e"
ULTRAVOX_API_BASE = "https://api.ultravox.ai/api"


def _build_payload(voice_id: Optional[str] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
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

    if voice_id:
        # Pass voice preference via templateContext/metadata since voiceId is not a top-level field.
        payload["templateContext"] = {"voiceId": voice_id}
        payload["metadata"] = {"voiceId": voice_id}

    return payload


@app.function_name(name="UltravoxDemoCall")
@app.route(route="ultravox-demo-call", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def create_ultravox_demo_call(req: func.HttpRequest) -> func.HttpResponse:
    """
    Create a demo Ultravox call and return the joinUrl for the web client.
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        api_key = get_required_setting("ULTRAVOX_API_KEY")
    except ValueError as exc:
        logger.error("Ultravox API key missing: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Server is not configured with ULTRAVOX_API_KEY"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )

    try:
        body = req.get_json()
    except ValueError:
        body = {}

    agent_id: Optional[str] = None
    voice_id: Optional[str] = None
    if isinstance(body, dict):
        agent_id = body.get("agentId") or body.get("agent_id")
        if agent_id is not None and not isinstance(agent_id, str):
            agent_id = None
        voice_id = body.get("voiceId") or body.get("voice_id")
        if voice_id is not None and not isinstance(voice_id, str):
            voice_id = None

    agent_id = agent_id or DEFAULT_AGENT_ID

    url = f"{ULTRAVOX_API_BASE}/agents/{agent_id}/calls"
    payload = _build_payload(voice_id)
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
            headers=cors,
        )

    if resp.status_code >= 300:
        logger.error("Ultravox API error %s: %s", resp.status_code, resp.text)
        return func.HttpResponse(
            json.dumps({"error": "Failed to start Ultravox demo call"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )

    data = resp.json()
    join_url = data.get("joinUrl")
    if not join_url:
        logger.error("Ultravox API response missing joinUrl: %s", data)
        return func.HttpResponse(
            json.dumps({"error": "Ultravox joinUrl was missing in response"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )

    return func.HttpResponse(
        json.dumps({"joinUrl": join_url}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )


@app.function_name(name="UltravoxVoices")
@app.route(route="ultravox-voices", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def list_ultravox_voices(req: func.HttpRequest) -> func.HttpResponse:
    """
    Fetch available Ultravox voices for selection in the demo UI.
    """
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        api_key = get_required_setting("ULTRAVOX_API_KEY")
    except ValueError as exc:
        logger.error("Ultravox API key missing: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Server is not configured with ULTRAVOX_API_KEY"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )

    url = f"{ULTRAVOX_API_BASE}/voices"
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
    }

    voices: List[Dict[str, Any]] = []
    seen_ids = set()
    next_token: Optional[str] = None

    def extract_page_items(payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, dict):
            for key in ("voices", "items", "data", "results"):
                maybe = payload.get(key)
                if isinstance(maybe, list):
                    return [item for item in maybe if isinstance(item, dict)]
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        return []

    try:
        with httpx.Client(timeout=20.0) as client:
            while True:
                params = {"pageSize": 200}
                if next_token:
                    params["pageToken"] = next_token

                resp = client.get(url, headers=headers, params=params)
                if resp.status_code >= 300:
                    logger.error("Ultravox voices API error %s: %s", resp.status_code, resp.text)
                    return func.HttpResponse(
                        json.dumps({"error": "Failed to fetch Ultravox voices"}),
                        status_code=500,
                        mimetype="application/json",
                        headers=cors,
                    )

                try:
                    data = resp.json()
                except ValueError:
                    logger.error("Ultravox voices API returned invalid JSON: %s", resp.text)
                    return func.HttpResponse(
                        json.dumps({"error": "Invalid response from Ultravox voices API"}),
                        status_code=500,
                        mimetype="application/json",
                        headers=cors,
                    )

                items = extract_page_items(data)
                for item in items:
                    vid = item.get("id") or item.get("voiceId")
                    if vid and vid not in seen_ids:
                        seen_ids.add(vid)
                        voices.append(item)

                next_token = (
                    data.get("nextPageToken")
                    or data.get("nextToken")
                    or data.get("nextPage")
                    or data.get("pageToken")
                )
                if not next_token:
                    break
    except httpx.RequestError as exc:
        logger.error("Failed to reach Ultravox API (voices): %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Could not contact Ultravox API"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )

    return func.HttpResponse(
        json.dumps({"voices": voices}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )
