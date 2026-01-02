import logging
import re
import time
from typing import Dict, List, Optional, Tuple

import httpx

from services.ultravox_agent_builder import _sanitize_name, build_ultravox_agent_payload  # pylint: disable=protected-access
from shared.config import get_required_setting, get_setting

ULTRAVOX_BASE_URL_DEFAULT = "https://api.ultravox.ai/api"

logger = logging.getLogger(__name__)


def _base_url() -> str:
    """Resolve the Ultravox base URL from env with a sensible default."""
    return (get_setting("ULTRAVOX_BASE_URL") or ULTRAVOX_BASE_URL_DEFAULT).rstrip("/")


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
    voice_override: str | None = None,
    greeting_override: str | None = None,
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
        voice_override=voice_override,
        greeting_override=greeting_override,
    )

    with httpx.Client(timeout=20) as client:
        response = client.post(f"{_base_url()}/agents", headers=_headers(), json=payload)
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
                voice_override=voice_override,
                greeting_override=greeting_override,
            )
            response = client.post(f"{_base_url()}/agents", headers=_headers(), json=payload)

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


def create_ultravox_call(agent_id: str, caller_number: str, metadata: dict | None = None) -> tuple[str, str | None]:
    """Create an Ultravox call and return (joinUrl, callId)."""
    payload = {
        # Minimal Twilio medium for inbound Streams; no unsupported "incoming" field.
        "medium": {"twilio": {}},
        "firstSpeakerSettings": {"agent": {}},
        "recordingEnabled": True,
    }
    if metadata:
        payload["metadata"] = metadata

    timeout = httpx.Timeout(connect=5.0, read=8.0, write=5.0, pool=None)
    with httpx.Client(timeout=timeout) as client:
        response = client.post(f"{_base_url()}/agents/{agent_id}/calls", headers=_headers(), json=payload)
    if response.status_code >= 300:
        logger.error("Ultravox call creation failed: %s - %s", response.status_code, response.text)
        raise RuntimeError("Failed to create Ultravox call")

    data = response.json()
    join_url = data.get("joinUrl") or data.get("join_url")
    call_id = data.get("id") or data.get("callId") or data.get("call_id")
    if not join_url:
        logger.error("Ultravox call response missing joinUrl: %s", data)
        raise RuntimeError("Ultravox call response missing joinUrl")
    return join_url, call_id


def update_ultravox_agent_prompt(agent_id: str, prompt_text: str) -> bool:
    """Update an agent's system prompt. Returns True when the patch succeeds."""
    if not agent_id or not prompt_text:
        return False
    try:
        agent = get_ultravox_agent(agent_id)
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Unable to fetch Ultravox agent for prompt update: %s", exc)
        return False

    call_template = agent.get("callTemplate") or {}
    updated_template = dict(call_template)
    updated_template["systemPrompt"] = prompt_text

    with httpx.Client(timeout=20) as client:
        resp = client.patch(
            f"{_base_url()}/agents/{agent_id}",
            headers=_headers(),
            json={"callTemplate": updated_template},
        )
    if resp.status_code >= 300:
        logger.warning(
            "Failed to update Ultravox agent prompt for %s: %s - %s",
            agent_id,
            resp.status_code,
            resp.text,
        )
        return False
    _ensure_prompt_instruction(agent_id)
    return True


def get_ultravox_call_messages(call_id: str) -> list[dict]:
    """Fetch Ultravox call messages for transcript rendering."""
    if not call_id:
        return []
    with httpx.Client(timeout=20) as client:
        resp = client.get(f"{_base_url()}/calls/{call_id}/messages", headers=_headers())
    if resp.status_code >= 300:
        logger.error("Ultravox call messages failed: %s - %s", resp.status_code, resp.text)
        raise RuntimeError("Failed to fetch Ultravox call messages")
    data = resp.json()
    if isinstance(data, dict):
        for key in ("messages", "items", "data", "results"):
            if isinstance(data.get(key), list):
                return data.get(key)
    return data if isinstance(data, list) else []


def list_ultravox_agents(limit: int = 20) -> List[Dict]:
    """
    Return a list of available Ultravox agents.
    The API surface may evolve; this currently issues GET /agents with an optional limit.
    """
    params = {"limit": limit} if limit else None
    with httpx.Client(timeout=20) as client:
        response = client.get(f"{_base_url()}/agents", headers=_headers(), params=params)

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
        response = client.get(f"{_base_url()}/agents/{agent_id}", headers=_headers())

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
        resp = client.post(f"{_base_url()}/webhooks", headers=_headers(), json=payload)
    if resp.status_code >= 300:
        logger.error("Ultravox create webhook failed: %s - %s", resp.status_code, resp.text)
        raise RuntimeError(f"Failed to create webhook: {resp.text}")
    try:
        return resp.json()
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Ultravox webhook response parse failed: %s", exc)
        return {}


def list_ultravox_webhooks() -> List[Dict]:
    """List all Ultravox webhooks."""
    with httpx.Client(timeout=20) as client:
        resp = client.get(f"{_base_url()}/webhooks", headers=_headers())
    if resp.status_code >= 300:
        logger.error("Ultravox list webhooks failed: %s - %s", resp.status_code, resp.text)
        raise RuntimeError(f"Failed to list webhooks: {resp.text}")
    data = resp.json()
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("items", "webhooks", "data", "results"):
            maybe = data.get(key)
            if isinstance(maybe, list):
                return maybe
    return []


def list_ultravox_tools(model_tool_name: Optional[str] = None) -> List[Dict]:
    """List Ultravox tools (optionally filtered by modelToolName)."""
    params = {"modelToolName": model_tool_name} if model_tool_name else None
    with httpx.Client(timeout=20) as client:
        resp = client.get(f"{_base_url()}/tools", headers=_headers(), params=params)
    if resp.status_code >= 300:
        logger.error("Ultravox list tools failed: %s - %s", resp.status_code, resp.text)
        raise RuntimeError(f"Failed to list Ultravox tools ({resp.status_code}): {resp.text}")
    data = resp.json()
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("items", "tools", "data", "results"):
            maybe = data.get(key)
            if isinstance(maybe, list):
                return maybe
    return []


def create_ultravox_tool(payload: Dict) -> Dict:
    """Create an Ultravox tool."""
    with httpx.Client(timeout=20) as client:
        resp = client.post(f"{_base_url()}/tools", headers=_headers(), json=payload)
    if resp.status_code >= 300:
        logger.error("Ultravox create tool failed: %s - %s", resp.status_code, resp.text)
        raise RuntimeError(f"Failed to create Ultravox tool ({resp.status_code}): {resp.text}")
    return resp.json()


def attach_tool_to_agent(
    agent_id: str,
    tool_id: str,
    name_override: Optional[str] = None,
    description_override: Optional[str] = None,
    parameter_overrides: Optional[Dict] = None,
) -> bool:
    """
    Attach a tool to an agent by updating callTemplate.selectedTools.
    Returns True if an update occurred.
    """
    agent = get_ultravox_agent(agent_id)
    call_template = agent.get("callTemplate") or {}
    selected = call_template.get("selectedTools") or []

    def _id_from_entry(entry):
        if isinstance(entry, dict):
            return entry.get("id") or entry.get("toolId") or entry.get("tool_id") or entry.get("name")
        return entry

    selected_ids = [_id_from_entry(x) for x in selected]

    def _normalize_entry(entry):
        if isinstance(entry, dict):
            return entry
        return {"toolId": entry}

    normalized_selected = [_normalize_entry(x) for x in selected]

    entry_base: Dict = {"toolId": tool_id}
    if name_override:
        entry_base["nameOverride"] = name_override
    if description_override:
        entry_base["descriptionOverride"] = description_override
    if parameter_overrides:
        entry_base["parameterOverrides"] = parameter_overrides

    updated_entries = []
    found = False
    for entry in normalized_selected:
        if _id_from_entry(entry) == tool_id:
            updated_entries.append(entry_base)
            found = True
        else:
            updated_entries.append(entry)
    if not found:
        updated_entries.append(entry_base)

    def _patch_selected(new_selected) -> Tuple[bool, str]:
        updated_template = dict(call_template)
        updated_template["selectedTools"] = new_selected
        with httpx.Client(timeout=20) as client:
            resp = client.patch(
                f"{_base_url()}/agents/{agent_id}",
                headers=_headers(),
                json={"callTemplate": updated_template},
            )
        return resp.status_code < 300, resp.text

    ok, resp_text = _patch_selected(updated_entries)
    if not ok:
        logger.error("Ultravox attach tool failed: %s", resp_text)
        raise RuntimeError(f"Failed to attach tool to agent: {resp_text}")

    try:
        refreshed = get_ultravox_agent(agent_id)
        refreshed_selected = (refreshed.get("callTemplate") or {}).get("selectedTools") or []
        refreshed_ids = [_id_from_entry(x) for x in refreshed_selected]
        if tool_id in refreshed_ids:
            logger.info("Ultravox tool %s attached to agent %s", tool_id, agent_id)
            return True
        logger.warning(
            "Ultravox attach tool patch succeeded but tool not present in selectedTools for agent %s",
            agent_id,
        )
        return False
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Ultravox attach tool verification failed: %s", exc)
        return False


BOOKING_TOOL_INSTRUCTION = (
    "After the caller confirms the appointment details, you MUST call the `calendar_book` tool with:\n"
    "- start in ISO 8601 in Europe/London (no 'tomorrow' wording)\n"
    "- callerPhone and callerName\n"
    "- callerEmail if provided by the caller\n"
    "- duration_minutes=30\n"
    "Only call the tool if it is a weekday and start time is between 09:00 and 16:30 Europe/London."
)
AVAILABILITY_TOOL_INSTRUCTION = (
    "When the caller proposes a time, you MUST call `calendar_availability` to check the slot before promising it. "
    "If the slot is busy, propose the next available option returned."
)


def _ensure_prompt_instruction(agent_id: str) -> None:
    """Ensure the booking instruction is present in the agent system prompt."""
    try:
        agent = get_ultravox_agent(agent_id)
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Unable to fetch Ultravox agent for prompt update: %s", exc)
        return

    call_template = agent.get("callTemplate") or {}
    system_prompt = call_template.get("systemPrompt") or call_template.get("system_prompt") or ""
    additions = []
    if BOOKING_TOOL_INSTRUCTION not in system_prompt:
        additions.append(BOOKING_TOOL_INSTRUCTION)
    if AVAILABILITY_TOOL_INSTRUCTION not in system_prompt:
        additions.append(AVAILABILITY_TOOL_INSTRUCTION)
    if not additions:
        return

    updated_prompt = (system_prompt.rstrip() + "\n\n" + "\n\n".join(additions)).strip()
    updated_template = dict(call_template)
    updated_template["systemPrompt"] = updated_prompt

    with httpx.Client(timeout=20) as client:
        resp = client.patch(
            f"{_base_url()}/agents/{agent_id}",
            headers=_headers(),
            json={"callTemplate": updated_template},
        )
    if resp.status_code >= 300:
        logger.warning(
            "Failed to update Ultravox agent prompt for %s: %s - %s",
            agent_id,
            resp.status_code,
            resp.text,
        )
    else:
        logger.info("Ultravox agent %s prompt updated with booking tool instruction", agent_id)


def _build_booking_tool_payload(public_api_base: str) -> Dict:
    """Construct the HTTP tool payload for calendar booking."""
    url = f"{public_api_base.rstrip('/')}/api/calendar/book"
    def _param(name: str, schema_type: str, required: bool, description: Optional[str] = None) -> Dict:
        schema: Dict[str, str] = {"type": schema_type}
        if description:
            schema["description"] = description
        return {
            "name": name,
            "location": "PARAMETER_LOCATION_BODY",
            "required": required,
            "schema": schema,
        }

    body_parameters = [
        _param("start", "string", True, "ISO-8601 start time"),
        _param("end", "string", False, "ISO-8601 end time"),
        _param("duration_minutes", "number", False),
        _param("buffer_minutes", "number", False),
        _param("callerName", "string", False),
        _param("callerEmail", "string", False),
        _param("callerPhone", "string", True),
        _param("callId", "string", False),
        _param("agentId", "string", False),
    ]
    return {
        "name": "calendar_book",
        "definition": {
            "modelToolName": "calendar_book",
            "description": "Books a Google Calendar event for the caller.",
            "dynamicParameters": body_parameters,
            "http": {
                "httpMethod": "POST",
                "baseUrlPattern": url,
            },
        },
    }


def _build_availability_tool_payload(public_api_base: str) -> Dict:
    """Construct the HTTP tool payload for calendar availability checks."""
    url = f"{public_api_base.rstrip('/')}/api/calendar/availability"

    def _param(name: str, schema_type: str, required: bool, description: Optional[str] = None) -> Dict:
        schema: Dict[str, str] = {"type": schema_type}
        if description:
            schema["description"] = description
        return {
            "name": name,
            "location": "PARAMETER_LOCATION_BODY",
            "required": required,
            "schema": schema,
        }

    body_parameters = [
        _param("start", "string", True, "ISO-8601 start time"),
        _param("duration_minutes", "number", False),
        _param("buffer_minutes", "number", False),
        _param("callerPhone", "string", False),
        _param("callerName", "string", False),
        _param("agentId", "string", False),
    ]
    return {
        "name": "calendar_availability",
        "definition": {
            "modelToolName": "calendar_availability",
            "description": "Checks calendar availability for a proposed slot.",
            "dynamicParameters": body_parameters,
            "http": {
                "baseUrlPattern": url,
                "httpMethod": "POST",
            },
        },
    }


def _find_existing_booking_tool(tools: List[Dict], public_api_base: str) -> Optional[Dict]:
    """Return an existing booking tool if present."""
    target_url = f"{public_api_base.rstrip('/')}/api/calendar/book"
    fallback = None
    for tool in tools:
        model_name = (
            tool.get("modelToolName")
            or (tool.get("definition") or {}).get("modelToolName")
            or tool.get("name")
        )
        if str(model_name or "").lower() != "calendar_book":
            continue
        http_cfg = tool.get("http") or tool.get("httpConfig") or {}
        tool_url = http_cfg.get("baseUrlPattern") or http_cfg.get("url") or tool.get("url")
        if tool_url and tool_url.rstrip("/") == target_url:
            return tool
        fallback = fallback or tool
    return fallback


def _find_existing_availability_tool(tools: List[Dict], public_api_base: str) -> Optional[Dict]:
    target_url = f"{public_api_base.rstrip('/')}/api/calendar/availability"
    fallback = None
    for tool in tools:
        model_name = (
            tool.get("modelToolName")
            or (tool.get("definition") or {}).get("modelToolName")
            or tool.get("name")
        )
        if str(model_name or "").lower() != "calendar_availability":
            continue
        http_cfg = tool.get("http") or tool.get("httpConfig") or {}
        tool_url = http_cfg.get("baseUrlPattern") or http_cfg.get("url") or tool.get("url")
        if tool_url and tool_url.rstrip("/") == target_url:
            return tool
        fallback = fallback or tool
    return fallback


def ensure_booking_tool(agent_id: str, public_api_base: str) -> Tuple[Optional[str], bool, bool]:
    """
    Ensure the calendar_book tool exists and is attached to the given agent.
    Returns (tool_id, created, attached).
    """
    tool_id: Optional[str] = None
    created = False
    attached = False

    tools = list_ultravox_tools(model_tool_name="calendar_book")
    existing = _find_existing_booking_tool(tools, public_api_base)

    # If filtered lookup missed it, try unfiltered list to reuse existing tool.
    if not existing:
        try:
            all_tools = list_ultravox_tools()
            existing = _find_existing_booking_tool(all_tools, public_api_base) or existing
        except Exception as exc:  # pylint: disable=broad-except
            logger.info("Ultravox list tools (unfiltered) failed, will attempt creation: %s", exc)

    if existing:
        tool_id = existing.get("id") or existing.get("toolId") or existing.get("tool_id")
        logger.info("Ultravox booking tool already exists: %s", tool_id)
    else:
        payload = _build_booking_tool_payload(public_api_base)
        try:
            created_tool = create_ultravox_tool(payload)
            tool_id = created_tool.get("id") or created_tool.get("toolId") or created_tool.get("tool_id")
            created = True
            logger.info("Ultravox booking tool created: %s", tool_id)
        except RuntimeError as exc:
            if "unique set" in str(exc).lower() or "already exists" in str(exc).lower():
                logger.info("Ultravox booking tool already exists (unique constraint); reusing existing")
                all_tools = list_ultravox_tools()
                existing = _find_existing_booking_tool(all_tools, public_api_base)
                tool_id = existing.get("id") if existing else None
            else:
                raise

    if not tool_id:
        logger.warning("Ultravox booking tool id missing; cannot attach to agent %s", agent_id)
        _ensure_prompt_instruction(agent_id)
        return None, created, attached

    if tool_id:
        try:
            attached = attach_tool_to_agent(
                agent_id,
                tool_id,
                name_override="calendar_book",
                description_override="Books a Google Calendar event for the caller.",
                parameter_overrides={"agentId": {"location": "PARAMETER_LOCATION_BODY", "value": agent_id}},
            ) or attached
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Failed to attach booking tool %s to agent %s: %s", tool_id, agent_id, exc)

    _ensure_prompt_instruction(agent_id)

    return tool_id, created, attached


def ensure_availability_tool(agent_id: str, public_api_base: str) -> Tuple[Optional[str], bool, bool]:
    """
    Ensure the calendar_availability tool exists and is attached to the given agent.
    Returns (tool_id, created, attached).
    """
    tool_id: Optional[str] = None
    created = False
    attached = False

    try:
        tools = list_ultravox_tools(model_tool_name="calendar_availability")
    except Exception:
        tools = []
    existing = _find_existing_availability_tool(tools, public_api_base)
    if not existing:
        try:
            all_tools = list_ultravox_tools()
            existing = _find_existing_availability_tool(all_tools, public_api_base) or existing
        except Exception:
            existing = existing
    if existing:
        tool_id = existing.get("id") or existing.get("toolId") or existing.get("tool_id")
        logger.info("Ultravox availability tool already exists: %s", tool_id)
    else:
        payload = _build_availability_tool_payload(public_api_base)
        created_tool = create_ultravox_tool(payload)
        tool_id = created_tool.get("id") or created_tool.get("toolId") or created_tool.get("tool_id")
        created = True
        logger.info("Ultravox availability tool created: %s", tool_id)

    if not tool_id:
        logger.warning("Ultravox availability tool id missing; cannot attach to agent %s", agent_id)
        _ensure_prompt_instruction(agent_id)
        return None, created, attached

    try:
        attached = attach_tool_to_agent(
            agent_id,
            tool_id,
            name_override="calendar_availability",
            description_override="Checks calendar availability for a proposed slot.",
            parameter_overrides={"agentId": {"location": "PARAMETER_LOCATION_BODY", "value": agent_id}},
        ) or attached
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to attach availability tool %s to agent %s: %s", tool_id, agent_id, exc)

    _ensure_prompt_instruction(agent_id)
    return tool_id, created, attached
