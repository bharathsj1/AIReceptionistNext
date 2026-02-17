from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from threading import Lock
from typing import Dict, List, Optional
from uuid import uuid4

logger = logging.getLogger(__name__)

_TABLE_NAME = os.getenv("TASK_EVENTS_TABLE", "taskevents")
_MAX_MEMORY_EVENTS = 500

_memory_events: List[dict] = []
_memory_lock = Lock()

_table_client = None
_table_error = False


def _now_ts() -> tuple[int, str]:
    now = datetime.now(timezone.utc)
    ts_ms = int(now.timestamp() * 1000)
    ts_iso = now.isoformat().replace("+00:00", "Z")
    return ts_ms, ts_iso


def _cursor_from_ts(ts_ms: Optional[int] = None) -> str:
    if ts_ms is None:
        ts_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    return f"{ts_ms:013d}_0"


def default_cursor() -> str:
    return _cursor_from_ts()


def _get_table_client():
    global _table_client, _table_error
    if _table_error:
        return None
    if _table_client is not None:
        return _table_client
    conn_str = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not conn_str:
        return None
    try:
        from azure.data.tables import TableServiceClient
        from azure.core.exceptions import ResourceExistsError
    except Exception as exc:  # pylint: disable=broad-except
        _table_error = True
        logger.info("Azure Table client unavailable: %s", exc)
        return None
    try:
        service = TableServiceClient.from_connection_string(conn_str)
        table_client = service.get_table_client(_TABLE_NAME)
        try:
            table_client.create_table()
        except ResourceExistsError:
            pass
        _table_client = table_client
        return _table_client
    except Exception as exc:  # pylint: disable=broad-except
        _table_error = True
        logger.warning("Failed to initialize Azure Table client: %s", exc)
        return None


def publish_task_event(client_id: str, event_type: str, task: dict) -> Optional[dict]:
    if not client_id or not event_type or not task:
        return None
    ts_ms, ts_iso = _now_ts()
    row_key = f"{ts_ms:013d}_{uuid4().hex}"
    event = {
        "id": row_key,
        "cursor": row_key,
        "type": event_type,
        "taskId": task.get("id"),
        "task": task,
        "ts": ts_iso,
    }

    table_client = _get_table_client()
    if table_client:
        entity = {
            "PartitionKey": str(client_id),
            "RowKey": row_key,
            "type": event_type,
            "taskId": task.get("id"),
            "taskJson": json.dumps(task, ensure_ascii=True),
            "ts": ts_iso,
        }
        try:
            table_client.create_entity(entity=entity)
            return event
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Azure Table write failed, using memory store: %s", exc)

    with _memory_lock:
        _memory_events.append(event)
        if len(_memory_events) > _MAX_MEMORY_EVENTS:
            _memory_events[:] = _memory_events[-_MAX_MEMORY_EVENTS :]
    return event


def _normalize_entity(entity: Dict[str, str]) -> dict:
    task_json = entity.get("taskJson") or entity.get("task_json")
    task = None
    if isinstance(task_json, str):
        try:
            task = json.loads(task_json)
        except Exception:
            task = None
    if task is None:
        task = entity.get("task") if isinstance(entity.get("task"), dict) else {}
    row_key = entity.get("RowKey") or entity.get("rowKey") or entity.get("id")
    return {
        "id": row_key,
        "cursor": row_key,
        "type": entity.get("type") or entity.get("eventType"),
        "taskId": entity.get("taskId"),
        "task": task,
        "ts": entity.get("ts"),
    }


def fetch_task_events(client_id: str, since: Optional[str], limit: int = 100) -> List[dict]:
    if not client_id:
        return []
    if not since:
        since = default_cursor()

    table_client = _get_table_client()
    if table_client:
        safe_client = str(client_id).replace("'", "''")
        filter_expr = f"PartitionKey eq '{safe_client}' and RowKey gt '{since}'"
        try:
            try:
                entities = list(table_client.query_entities(query_filter=filter_expr))
            except TypeError:
                entities = list(table_client.query_entities(filter_expr))
            entities.sort(key=lambda item: item.get("RowKey", ""))
            if limit:
                entities = entities[:limit]
            return [_normalize_entity(entity) for entity in entities]
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Azure Table query failed, using memory store: %s", exc)

    with _memory_lock:
        events = [event for event in _memory_events if event.get("cursor", "") > since]
    events.sort(key=lambda item: item.get("cursor", ""))
    if limit:
        events = events[:limit]
    return events
