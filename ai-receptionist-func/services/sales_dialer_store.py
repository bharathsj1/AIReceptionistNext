from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

SALES_CALL_LOGS_TABLE = os.getenv("SALES_CALL_LOGS_TABLE", "SalesCallLogs")

_service_client = None
_table_client = None
_table_lock = Lock()
_table_init_failed = False

_memory_store: Dict[str, Dict[str, dict]] = {}
_memory_lock = Lock()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _try_import_tables():
    try:
        from azure.data.tables import TableServiceClient  # type: ignore
        from azure.core.exceptions import ResourceExistsError  # type: ignore

        return TableServiceClient, ResourceExistsError
    except Exception as exc:  # pylint: disable=broad-except
        logger.info("Azure Tables SDK unavailable for sales dialer store: %s", exc)
        return None, None


def _get_service_client():
    global _service_client, _table_init_failed
    if _table_init_failed:
        return None
    if _service_client is not None:
        return _service_client
    conn_str = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not conn_str:
        return None
    TableServiceClient, _ = _try_import_tables()
    if not TableServiceClient:
        return None
    try:
        _service_client = TableServiceClient.from_connection_string(conn_str)
        return _service_client
    except Exception as exc:  # pylint: disable=broad-except
        _table_init_failed = True
        logger.warning("Failed to initialize sales dialer TableServiceClient: %s", exc)
        return None


def _get_table_client():
    global _table_client
    if _table_client is not None:
        return _table_client
    service = _get_service_client()
    if service is None:
        return None
    _, ResourceExistsError = _try_import_tables()
    with _table_lock:
        if _table_client is not None:
            return _table_client
        try:
            client = service.get_table_client(SALES_CALL_LOGS_TABLE)
            try:
                client.create_table()
            except Exception as exc:  # pylint: disable=broad-except
                if ResourceExistsError and isinstance(exc, ResourceExistsError):
                    pass
                else:
                    raise
            _table_client = client
            return client
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Failed to initialize sales dialer table '%s': %s", SALES_CALL_LOGS_TABLE, exc)
            return None


def _escape_odata(value: str) -> str:
    return str(value or "").replace("'", "''")


def _deserialize_entity(entity: dict | None) -> Optional[dict]:
    if not entity:
        return None
    payload = {
        "tenantId": str(entity.get("PartitionKey") or ""),
        "callSid": str(entity.get("RowKey") or ""),
    }
    for key, value in entity.items():
        if key in {"PartitionKey", "RowKey", "Timestamp", "etag"}:
            continue
        payload[key] = value
    return payload


def _memory_upsert(tenant_id: str, call_sid: str, payload: dict) -> dict:
    with _memory_lock:
        partition = _memory_store.setdefault(tenant_id, {})
        base = partition.get(call_sid, {})
        merged = {**base, **payload}
        merged["tenantId"] = tenant_id
        merged["callSid"] = call_sid
        merged["updatedAt"] = _utc_now_iso()
        if not merged.get("createdAt"):
            merged["createdAt"] = merged["updatedAt"]
        partition[call_sid] = merged
        return dict(merged)


def _memory_list(tenant_id: str, limit: int, user_id: Optional[str]) -> list[dict]:
    with _memory_lock:
        values = list(_memory_store.get(tenant_id, {}).values())
    if user_id:
        values = [item for item in values if str(item.get("userId") or "") == str(user_id)]
    values.sort(
        key=lambda row: str(
            row.get("startedAt")
            or row.get("createdAt")
            or row.get("updatedAt")
            or ""
        ),
        reverse=True,
    )
    return [dict(item) for item in values[:limit]]


def upsert_call_log(tenant_id: str, call_sid: str, patch: dict) -> dict:
    safe_tenant = str(tenant_id or "").strip()
    safe_sid = str(call_sid or "").strip()
    if not safe_tenant or not safe_sid:
        return {}

    client = _get_table_client()
    now_iso = _utc_now_iso()
    if client:
        existing = None
        try:
            existing = client.get_entity(partition_key=safe_tenant, row_key=safe_sid)
        except Exception:  # pylint: disable=broad-except
            existing = None

        fields = {
            **{
                k: v
                for k, v in (existing or {}).items()
                if k not in {"PartitionKey", "RowKey", "Timestamp", "etag"}
            },
            **(patch or {}),
            "updatedAt": now_iso,
        }
        if not fields.get("createdAt"):
            fields["createdAt"] = fields["updatedAt"]
        entity = {"PartitionKey": safe_tenant, "RowKey": safe_sid, **fields}
        try:
            client.upsert_entity(entity=entity)
        except TypeError:
            client.upsert_entity(entity, mode="MERGE")
        return _deserialize_entity(entity) or {}

    return _memory_upsert(safe_tenant, safe_sid, patch or {})


def get_call_log(tenant_id: str, call_sid: str) -> Optional[dict]:
    safe_tenant = str(tenant_id or "").strip()
    safe_sid = str(call_sid or "").strip()
    if not safe_tenant or not safe_sid:
        return None
    client = _get_table_client()
    if client:
        try:
            entity = client.get_entity(partition_key=safe_tenant, row_key=safe_sid)
            return _deserialize_entity(entity)
        except Exception:  # pylint: disable=broad-except
            return None
    with _memory_lock:
        entry = _memory_store.get(safe_tenant, {}).get(safe_sid)
        return dict(entry) if entry else None


def list_call_logs(tenant_id: str, *, limit: int = 25, user_id: Optional[str] = None) -> list[dict]:
    safe_tenant = str(tenant_id or "").strip()
    safe_limit = max(1, min(100, int(limit or 25)))
    safe_user_id = str(user_id or "").strip() or None
    if not safe_tenant:
        return []

    client = _get_table_client()
    if client:
        filter_expr = f"PartitionKey eq '{_escape_odata(safe_tenant)}'"
        if safe_user_id:
            filter_expr += f" and userId eq '{_escape_odata(safe_user_id)}'"
        try:
            try:
                entities = list(client.query_entities(query_filter=filter_expr, results_per_page=safe_limit))
            except TypeError:
                entities = list(client.query_entities(filter_expr))
        except Exception:  # pylint: disable=broad-except
            entities = []
        rows = [_deserialize_entity(entity) for entity in entities]
        rows = [row for row in rows if row]
        rows.sort(
            key=lambda row: str(
                row.get("startedAt")
                or row.get("createdAt")
                or row.get("updatedAt")
                or ""
            ),
            reverse=True,
        )
        return rows[:safe_limit]

    return _memory_list(safe_tenant, safe_limit, safe_user_id)
