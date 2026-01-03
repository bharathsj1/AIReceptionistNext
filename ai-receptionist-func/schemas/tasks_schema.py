from __future__ import annotations

import re
from typing import Any, Dict, Optional

TASK_TYPES = {
    "ORDER",
    "BOOKING",
    "QUOTE_REQUEST",
    "SUPPORT_TICKET",
    "LEAD",
    "MESSAGE",
}

TASK_STATUSES = {
    "NEW",
    "PENDING",
    "ACCEPTED",
    "REJECTED",
    "COMPLETED",
    "CANCELLED",
}


def _normalize_enum(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip().upper()
    if not normalized:
        return None
    normalized = re.sub(r"[\s-]+", "_", normalized)
    return normalized


def _extract_client_id(raw: Any) -> str:
    if raw is None:
        raise ValueError("clientId is required")
    if isinstance(raw, dict):
        for key in ("value", "id", "clientId"):
            if key in raw and raw[key] is not None:
                raw = raw[key]
                break
    text = str(raw).strip()
    if not text:
        raise ValueError("clientId is required")
    match = re.search(r"['\"]value['\"]\s*:\s*['\"]([^'\"]+)['\"]", text)
    if match:
        return match.group(1).strip()
    return text


def _require_str(payload: Dict[str, Any], field: str) -> str:
    value = payload.get(field)
    if value is None:
        raise ValueError(f"{field} is required")
    text = str(value).strip()
    if not text:
        raise ValueError(f"{field} is required")
    return text


def _optional_str(payload: Dict[str, Any], field: str) -> Optional[str]:
    value = payload.get(field)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_status_filter(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = _normalize_enum(value)
    if not normalized:
        return None
    if normalized == "ALL":
        return "ALL"
    if normalized not in TASK_STATUSES:
        raise ValueError("Invalid status filter")
    return normalized


def validate_task_create(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Invalid JSON payload")

    client_id = _extract_client_id(payload.get("clientId"))
    type_raw = _require_str(payload, "type")
    task_type = _normalize_enum(type_raw)
    if task_type not in TASK_TYPES:
        raise ValueError("Invalid task type")

    title = _require_str(payload, "title")
    summary = _require_str(payload, "summary")

    details = payload.get("detailsJson")
    if details is None:
        details = {}
    if not isinstance(details, dict):
        raise ValueError("detailsJson must be an object")

    return {
        "clientId": client_id,
        "type": task_type,
        "title": title,
        "summary": summary,
        "detailsJson": details,
        "customerName": _optional_str(payload, "customerName"),
        "customerPhone": _optional_str(payload, "customerPhone"),
        "customerEmail": _optional_str(payload, "customerEmail"),
        "callId": _optional_str(payload, "callId"),
        "twilioCallSid": _optional_str(payload, "twilioCallSid"),
    }
