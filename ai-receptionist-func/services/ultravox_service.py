import logging
import time
import uuid
from typing import Dict, List

import httpx

from services.ultravox_agent_builder import build_ultravox_agent_payload
from shared.config import get_required_setting

ULTRAVOX_BASE_URL = "https://api.ultravox.ai/api"

logger = logging.getLogger(__name__)


def _headers() -> Dict[str, str]:
    """Build auth headers for Ultravox requests."""
    api_key = get_required_setting("ULTRAVOX_API_KEY")
    return {
        "X-API-Key": api_key,
        "Content-Type": "application/json",
    }


def create_ultravox_agent(business_name: str, website_url: str, summary: str) -> str:
    """
    Create an Ultravox agent and return its ID.
    Retries once with a unique suffix if the name already exists.
    """
    payload = build_ultravox_agent_payload(business_name, website_url, summary)

    with httpx.Client(timeout=20) as client:
        response = client.post(f"{ULTRAVOX_BASE_URL}/agents", headers=_headers(), json=payload)
        if response.status_code == 400 and "already exists" in response.text.lower():
            # Add a short suffix to avoid name collisions while keeping within 64 chars.
            suffix = uuid.uuid4().hex[:6]
            payload = build_ultravox_agent_payload(
                business_name,
                website_url,
                summary,
                agent_name_override=f"{business_name} AI Receptionist-{suffix}",
            )
            response = client.post(f"{ULTRAVOX_BASE_URL}/agents", headers=_headers(), json=payload)

    if response.status_code >= 300:
        logger.error(
            "Ultravox agent creation failed: %s - %s",
            response.status_code,
            response.text,
        )
        raise RuntimeError(f"Ultravox agent creation failed ({response.status_code}): {response.text}")

    data = response.json()
    agent_id = data.get("id") or data.get("agentId") or data.get("agent_id") or data.get("agent", {}).get("id")
    if not agent_id:
        logger.error("Ultravox agent creation response missing id: %s", response.text)
        raise RuntimeError(f"Ultravox agent creation returned no id: {response.text}")

    # Verify the agent exists (some API responses may return an id without persistence).
    for attempt in range(2):
        try:
            get_ultravox_agent(agent_id)
            break
        except Exception as exc:  # pylint: disable=broad-except
            if attempt == 1:
                raise RuntimeError(f"Ultravox agent verification failed: {exc}") from exc
            time.sleep(1.0)
    return agent_id


def create_ultravox_call(agent_id: str, caller_number: str) -> str:
    """Create an Ultravox call and return joinUrl."""
    payload = {
        # Align with Ultravox call schema: specify inbound Twilio stream explicitly.
        "medium": {"twilio": {"incoming": {}}},
        "firstSpeakerSettings": {"agent": {}},
        "recordingEnabled": True,
    }
    # Ultravox schema allows templateContext with known keys; avoid arbitrary nesting.
    if caller_number:
        payload["templateContext"] = {"customerName": caller_number}

    with httpx.Client(timeout=20) as client:
        response = client.post(f"{ULTRAVOX_BASE_URL}/agents/{agent_id}/calls", headers=_headers(), json=payload)
    if response.status_code >= 300:
        logger.error("Ultravox call creation failed: %s - %s", response.status_code, response.text)
        raise RuntimeError("Failed to create Ultravox call")

    data = response.json()
    join_url = data.get("joinUrl") or data.get("join_url")
    if not join_url:
        logger.error("Ultravox call response missing joinUrl: %s", data)
        raise RuntimeError("Ultravox call response missing joinUrl")
    return join_url


def list_ultravox_agents(limit: int = 20) -> List[Dict]:
    """
    Return a list of available Ultravox agents.
    The API surface may evolve; this currently issues GET /agents with an optional limit.
    """
    params = {"limit": limit} if limit else None
    with httpx.Client(timeout=20) as client:
        response = client.get(f"{ULTRAVOX_BASE_URL}/agents", headers=_headers(), params=params)

    if response.status_code >= 300:
        logger.error("Ultravox list agents failed: %s - %s", response.status_code, response.text)
        raise RuntimeError(f"Failed to list Ultravox agents ({response.status_code}): {response.text}")

    data = response.json()
    # Support both list responses and wrapped objects.
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        # Common patterns: {"items": [...]}, {"agents": [...]}
        for key in ("items", "agents", "data"):
            if key in data and isinstance(data[key], list):
                return data[key]
    return []


def get_ultravox_agent(agent_id: str) -> Dict:
    """Fetch a single Ultravox agent by id."""
    with httpx.Client(timeout=20) as client:
        response = client.get(f"{ULTRAVOX_BASE_URL}/agents/{agent_id}", headers=_headers())

    if response.status_code == 404:
        raise RuntimeError(f"Ultravox agent {agent_id} not found (404): {response.text}")
    if response.status_code >= 300:
        logger.error("Ultravox get agent failed: %s - %s", response.status_code, response.text)
        raise RuntimeError(f"Failed to get Ultravox agent ({response.status_code}): {response.text}")

    return response.json()
