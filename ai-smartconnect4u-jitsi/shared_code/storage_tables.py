from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from azure.data.tables import TableServiceClient, UpdateMode

logger = logging.getLogger(__name__)

MEETINGS_TABLE = os.getenv("MEETINGS_TABLE_NAME", "Meetings")
ARTIFACTS_TABLE = os.getenv("MEETING_ARTIFACTS_TABLE_NAME", "MeetingArtifacts")

_TABLE_SERVICE: TableServiceClient | None = None


class StorageConfigError(RuntimeError):
    pass


def _connection_string() -> str:
    conn = os.getenv("AZURE_STORAGE_CONNECTION_STRING") or os.getenv("AzureWebJobsStorage")
    if not conn:
        raise StorageConfigError("AZURE_STORAGE_CONNECTION_STRING (or AzureWebJobsStorage) is required")
    return conn


def _table_service() -> TableServiceClient:
    global _TABLE_SERVICE
    if _TABLE_SERVICE is None:
        _TABLE_SERVICE = TableServiceClient.from_connection_string(_connection_string())
    return _TABLE_SERVICE


def _table_client(name: str):
    service = _table_service()
    try:
        service.create_table_if_not_exists(name)
    except Exception as exc:  # pylint: disable=broad-except
        logger.debug("create_table_if_not_exists failed (likely exists): %s", exc)
    return service.get_table_client(table_name=name)


def _utcnow_iso() -> str:
    return datetime.utcnow().replace(tzinfo=timezone.utc).isoformat()


def _generate_meeting_id() -> str:
    # Un-guessable, URL-safe; ~128 bits of entropy
    return secrets.token_urlsafe(16)


def _room_name(tenant_id: str, meeting_id: str) -> str:
    digest = hashlib.sha256(f"{tenant_id}:{meeting_id}".encode("utf-8")).digest()
    return "sc4u-" + base64.b32encode(digest).decode("utf-8").lower().strip("=")[:16]


def create_meeting(
    *,
    tenant_id: str,
    user_id: str,
    title: Optional[str] = None,
    public_join: bool = False,
    scheduled_for: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not tenant_id or not user_id:
        raise ValueError("tenant_id and user_id are required")

    meeting_id = _generate_meeting_id()
    room = _room_name(tenant_id, meeting_id)
    url = f"/meet/{meeting_id}"

    entity: Dict[str, Any] = {
        "PartitionKey": str(tenant_id),
        "RowKey": meeting_id,
        "meetingId": meeting_id,
        "jitsiRoomName": room,
        "joinUrl": url,
        "title": title or "",
        "scheduledFor": scheduled_for or None,
        "publicJoin": bool(public_join),
        "status": "created",
        "createdAt": _utcnow_iso(),
        "createdByUserId": str(user_id),
        "lastUpdatedAt": _utcnow_iso(),
    }
    if metadata:
        entity["metadataJson"] = json.dumps(metadata)

    _table_client(MEETINGS_TABLE).create_entity(entity=entity)
    return entity


def list_meetings(*, tenant_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    client = _table_client(MEETINGS_TABLE)
    filter_expr = f"PartitionKey eq '{tenant_id}'"
    items = list(client.query_entities(query_filter=filter_expr))
    items.sort(key=lambda e: e.get("createdAt", "") or e.get("scheduledFor", ""), reverse=True)
    return items[:limit]


def list_public_meetings(*, limit: int = 50) -> List[Dict[str, Any]]:
    """Return latest public-join meetings across all tenants."""
    client = _table_client(MEETINGS_TABLE)
    try:
        items = list(client.query_entities(filter="publicJoin eq true"))
    except Exception:  # pylint: disable=broad-except
        items = list(client.list_entities())  # fallback if filter not supported
    items.sort(key=lambda e: e.get("createdAt", "") or e.get("scheduledFor", ""), reverse=True)
    return items[:limit]


def get_meeting(tenant_id: str, meeting_id: str) -> Optional[Dict[str, Any]]:
    client = _table_client(MEETINGS_TABLE)
    try:
        return client.get_entity(partition_key=tenant_id, row_key=meeting_id)
    except Exception:  # pylint: disable=broad-except
        return None


def find_meeting_by_id(meeting_id: str) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Lookup a meeting by RowKey across partitions for public endpoints."""
    client = _table_client(MEETINGS_TABLE)
    try:
        results = list(client.query_entities(query_filter=f"RowKey eq '{meeting_id}'"))
        if not results:
            return None
        entity = results[0]
        return str(entity.get("PartitionKey")), entity
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("find_meeting_by_id failed: %s", exc)
        return None


def update_meeting(tenant_id: str, meeting_id: str, updates: Dict[str, Any]) -> None:
    if not updates:
        return
    updates = dict(updates)
    updates["PartitionKey"] = tenant_id
    updates["RowKey"] = meeting_id
    updates["lastUpdatedAt"] = _utcnow_iso()
    _table_client(MEETINGS_TABLE).upsert_entity(mode=UpdateMode.MERGE, entity=updates)


def set_meeting_status(tenant_id: str, meeting_id: str, status: str, **extra_fields: Any) -> None:
    payload = {"status": status}
    payload.update(extra_fields)
    update_meeting(tenant_id, meeting_id, payload)


def save_artifacts(
    *,
    tenant_id: str,
    meeting_id: str,
    transcript_text: Optional[str],
    transcript_blob_name: Optional[str],
    summary_json: Optional[Dict[str, Any]],
    tasks_json: Optional[Any],
    language: Optional[str] = None,
    duration_seconds: Optional[float] = None,
    processed_at: Optional[str] = None,
    tasks_updated_at: Optional[str] = None,
) -> Dict[str, Any]:
    entity: Dict[str, Any] = {
        "PartitionKey": tenant_id,
        "RowKey": meeting_id,
        "meetingId": meeting_id,
        "updatedAt": _utcnow_iso(),
    }
    if transcript_text:
        entity["transcriptText"] = transcript_text
    if transcript_blob_name:
        entity["transcriptBlobName"] = transcript_blob_name
    if summary_json is not None:
        entity["summaryJson"] = json.dumps(summary_json)
    if tasks_json is not None:
        entity["tasksJson"] = json.dumps(tasks_json)
    if language:
        entity["language"] = language
    if duration_seconds is not None:
        entity["durationSeconds"] = float(duration_seconds)
    if processed_at:
        entity["processedAt"] = processed_at
    if tasks_updated_at:
        entity["tasksUpdatedAt"] = tasks_updated_at

    client = _table_client(ARTIFACTS_TABLE)
    client.upsert_entity(mode=UpdateMode.MERGE, entity=entity)
    return entity


def get_artifacts(tenant_id: str, meeting_id: str) -> Optional[Dict[str, Any]]:
    client = _table_client(ARTIFACTS_TABLE)
    try:
        return client.get_entity(partition_key=tenant_id, row_key=meeting_id)
    except Exception:  # pylint: disable=broad-except
        return None
