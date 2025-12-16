import logging
import re
import time
from typing import Dict, List

import httpx

from services.ultravox_agent_builder import _sanitize_name, build_ultravox_agent_payload  # pylint: disable=protected-access
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


def create_ultravox_agent(
    business_name: str,
    website_url: str,
    summary: str,
    system_prompt_override: str | None = None,
) -> str:
    """
    Create an Ultravox agent and return its ID.
    Retries once with a deterministic numeric suffix if the name already exists.
    """
    payload = build_ultravox_agent_payload(
        business_name,
        website_url,
        summary,
        system_prompt_override=system_prompt_override,
    )

    with httpx.Client(timeout=20) as client:
        response = client.post(f"{ULTRAVOX_BASE_URL}/agents", headers=_headers(), json=payload)
        if response.status_code == 400 and "already exists" in response.text.lower():
            # Append _<existing_count> to avoid name collisions (e.g., Foo, Foo_1, Foo_2).
            attempted_name = payload.get("name") or _sanitize_name(business_name)
            existing_count = _count_existing_agents_with_base_name(attempted_name)
            deduped_name = _build_deduped_agent_name(attempted_name, existing_count)
            payload = build_ultravox_agent_payload(
                business_name,
                website_url,
                summary,
                agent_name_override=deduped_name,
                system_prompt_override=system_prompt_override,
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
        # Minimal Twilio medium for inbound Streams; no unsupported "incoming" field.
        "medium": {"twilio": {}},
        "firstSpeakerSettings": {"agent": {}},
        "recordingEnabled": True,
    }

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


def _count_existing_agents_with_base_name(base_name: str) -> int:
    """
    Count agents that share the same base name (Foo or Foo_<n>), so we can pick the next suffix.
    """
    safe_base = _sanitize_name(base_name)
    try:
        agents = list_ultravox_agents(limit=200)
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Could not list Ultravox agents to resolve name collision: %s", exc)
        return 0

    pattern = re.compile(rf"^{re.escape(safe_base)}(?:_(\d+))?$")
    return sum(1 for agent in agents if pattern.match(str(agent.get("name") or "")))


def _build_deduped_agent_name(base_name: str, existing_count: int) -> str:
    """
    Append _<count> while staying within 64 chars and preserving the suffix.
    """
    safe_base = _sanitize_name(base_name)
    suffix_num = existing_count if existing_count else 1
    suffix = f"_{suffix_num}"
    max_base_len = 64 - len(suffix)
    truncated_base = safe_base[:max_base_len].rstrip("_-")
    candidate = f"{truncated_base}{suffix}"
    return _sanitize_name(candidate)


def create_ultravox_webhook(
    destination_url: str,
    event_types: list[str],
    scope: dict | None = None,
    secret: str | None = None,
) -> dict:
    """
    Create a webhook in Ultravox for the given events.
    scope example: {"type": "AGENT", "value": "<agentId>"} or {"type": "GLOBAL"}
    event_types example: ["call.ended", "call.started"]
    """
    # Per Ultravox docs: fields are url, events (e.g., call.started, call.ended), optional agentId, secrets.
    normalized_events = [str(evt or "").lower() for evt in (event_types or []) if str(evt or "").strip()]
    if not normalized_events:
        normalized_events = ["call.ended"]

    payload: dict = {
        "url": destination_url,
        "events": normalized_events,
    }
    # If scope is provided as {"type": "AGENT", "value": "<id>"}, map to agentId field.
    if scope and scope.get("type") == "AGENT" and scope.get("value"):
        payload["agentId"] = scope.get("value")
    if secret:
        payload["secrets"] = [secret]

    with httpx.Client(timeout=20) as client:
        resp = client.post(f"{ULTRAVOX_BASE_URL}/webhooks", headers=_headers(), json=payload)
    if resp.status_code >= 300:
        logger.error("Ultravox create webhook failed: %s - %s", resp.status_code, resp.text)
        raise RuntimeError(f"Failed to create webhook: {resp.text}")
    try:
        return resp.json()
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Ultravox webhook response parse failed: %s", exc)
        return {}
