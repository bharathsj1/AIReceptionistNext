from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple
from uuid import uuid4

logger = logging.getLogger(__name__)

TABLES = {
    "contacts": os.getenv("CRM_CONTACTS_TABLE", "CRMContacts"),
    "companies": os.getenv("CRM_COMPANIES_TABLE", "CRMCompanies"),
    "deals": os.getenv("CRM_DEALS_TABLE", "CRMDeals"),
    "tasks": os.getenv("CRM_TASKS_TABLE", "CRMTasks"),
    "comments": os.getenv("CRM_COMMENTS_TABLE", "CRMComments"),
    "activities": os.getenv("CRM_ACTIVITIES_TABLE", "CRMActivities"),
    "email_links": os.getenv("CRM_EMAIL_LINKS_TABLE", "CRMEmailLinks"),
    "notifications": os.getenv("CRM_NOTIFICATIONS_TABLE", "CRMNotifications"),
    "audit": os.getenv("CRM_AUDIT_TABLE", "CRMAuditLog"),
    "task_by_assignee": os.getenv("CRM_TASK_ASSIGNEE_INDEX_TABLE", "CRMTaskByAssignee"),
    "task_by_status": os.getenv("CRM_TASK_STATUS_INDEX_TABLE", "CRMTaskByStatus"),
}

_service_client = None
_table_clients: Dict[str, Any] = {}
_table_init_failed = False
_table_lock = Lock()

_memory_lock = Lock()
_memory_store: Dict[str, Dict[str, Dict[str, dict]]] = {}


def tenant_partition(tenant_id: Any) -> str:
    return str(tenant_id or "").strip()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return _utc_now().isoformat().replace("+00:00", "Z")


def _new_id() -> str:
    ts_ms = int(_utc_now().timestamp() * 1000)
    return f"{ts_ms:013d}_{uuid4().hex[:12]}"


def _escape_odata(value: str) -> str:
    return str(value or "").replace("'", "''")


def _parse_iso(value: Any) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def _json_load(raw: Any) -> Any:
    if not isinstance(raw, str):
        return raw
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def _try_import_tables():
    try:
        from azure.data.tables import TableServiceClient  # type: ignore
        from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError  # type: ignore
        return TableServiceClient, ResourceExistsError, ResourceNotFoundError
    except Exception as exc:  # pylint: disable=broad-except
        logger.info("Azure Tables SDK unavailable, using in-memory CRM store: %s", exc)
        return None, None, None


def _get_service_client():
    global _service_client, _table_init_failed
    if _table_init_failed:
        return None
    if _service_client is not None:
        return _service_client
    conn_str = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not conn_str:
        return None
    TableServiceClient, _, _ = _try_import_tables()
    if not TableServiceClient:
        return None
    try:
        _service_client = TableServiceClient.from_connection_string(conn_str)
        return _service_client
    except Exception as exc:  # pylint: disable=broad-except
        _table_init_failed = True
        logger.warning("Failed to init Azure Table service for CRM: %s", exc)
        return None


def _get_table_client(table_name: str):
    if table_name in _table_clients:
        return _table_clients[table_name]
    service = _get_service_client()
    if service is None:
        return None
    _, ResourceExistsError, _ = _try_import_tables()
    with _table_lock:
        if table_name in _table_clients:
            return _table_clients[table_name]
        try:
            client = service.get_table_client(table_name)
            try:
                client.create_table()
            except Exception as exc:  # pylint: disable=broad-except
                if ResourceExistsError and isinstance(exc, ResourceExistsError):
                    pass
                else:
                    raise
            _table_clients[table_name] = client
            return client
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Failed to initialize CRM table '%s': %s", table_name, exc)
            return None


def _encode_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    encoded: Dict[str, Any] = {}
    for key, value in payload.items():
        if value is None:
            continue
        if isinstance(value, (list, dict)):
            encoded[f"{key}Json"] = _json_dump(value)
        else:
            encoded[key] = value
    return encoded


def _decode_payload(entity: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in entity.items():
        if key in {"PartitionKey", "RowKey", "Timestamp", "etag"}:
            continue
        if key.endswith("Json"):
            out[key[:-4]] = _json_load(value)
        else:
            out[key] = value
    out["id"] = entity.get("RowKey") or out.get("id")
    return out


def _memory_create(table_name: str, tenant_id: str, row_key: str, payload: Dict[str, Any]) -> dict:
    with _memory_lock:
        table_bucket = _memory_store.setdefault(table_name, {})
        tenant_bucket = table_bucket.setdefault(tenant_id, {})
        entity = {
            "PartitionKey": tenant_id,
            "RowKey": row_key,
            **payload,
        }
        tenant_bucket[row_key] = entity
        return entity


def _memory_get(table_name: str, tenant_id: str, row_key: str) -> Optional[dict]:
    with _memory_lock:
        return (
            _memory_store
            .get(table_name, {})
            .get(tenant_id, {})
            .get(row_key)
        )


def _memory_delete(table_name: str, tenant_id: str, row_key: str) -> bool:
    with _memory_lock:
        table_bucket = _memory_store.get(table_name, {})
        tenant_bucket = table_bucket.get(tenant_id, {})
        return tenant_bucket.pop(row_key, None) is not None


def _memory_list(table_name: str, tenant_id: str) -> List[dict]:
    with _memory_lock:
        tenant_bucket = _memory_store.get(table_name, {}).get(tenant_id, {})
        return list(tenant_bucket.values())


def create_entity(table_key: str, tenant_id: str, payload: Dict[str, Any], entity_id: Optional[str] = None) -> Dict[str, Any]:
    tenant = tenant_partition(tenant_id)
    now = utc_now_iso()
    row_key = str(entity_id or payload.get("id") or _new_id())
    base = {
        **payload,
        "createdAt": payload.get("createdAt") or now,
        "updatedAt": now,
    }
    encoded = _encode_payload(base)
    client = _get_table_client(TABLES[table_key])
    if client:
        entity = {
            "PartitionKey": tenant,
            "RowKey": row_key,
            **encoded,
        }
        client.create_entity(entity=entity)
        return _decode_payload(entity)

    memory_entity = _memory_create(TABLES[table_key], tenant, row_key, encoded)
    return _decode_payload(memory_entity)


def upsert_entity(table_key: str, tenant_id: str, entity_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    tenant = tenant_partition(tenant_id)
    existing = get_entity(table_key, tenant, entity_id) or {}
    merged = {
        **existing,
        **payload,
        "id": entity_id,
        "createdAt": existing.get("createdAt") or payload.get("createdAt") or utc_now_iso(),
        "updatedAt": utc_now_iso(),
    }
    encoded = _encode_payload(merged)
    client = _get_table_client(TABLES[table_key])
    if client:
        entity = {
            "PartitionKey": tenant,
            "RowKey": entity_id,
            **encoded,
        }
        client.upsert_entity(entity=entity)
        return _decode_payload(entity)
    memory_entity = _memory_create(TABLES[table_key], tenant, entity_id, encoded)
    return _decode_payload(memory_entity)


def get_entity(table_key: str, tenant_id: str, entity_id: str) -> Optional[Dict[str, Any]]:
    tenant = tenant_partition(tenant_id)
    if not tenant or not entity_id:
        return None
    client = _get_table_client(TABLES[table_key])
    if client:
        _, _, ResourceNotFoundError = _try_import_tables()
        try:
            entity = client.get_entity(partition_key=tenant, row_key=entity_id)
            return _decode_payload(entity)
        except Exception as exc:  # pylint: disable=broad-except
            if ResourceNotFoundError and isinstance(exc, ResourceNotFoundError):
                return None
            logger.warning("CRM get_entity fallback to memory (%s/%s): %s", table_key, entity_id, exc)
    memory_entity = _memory_get(TABLES[table_key], tenant, entity_id)
    return _decode_payload(memory_entity) if memory_entity else None


def delete_entity(table_key: str, tenant_id: str, entity_id: str) -> bool:
    tenant = tenant_partition(tenant_id)
    if not tenant or not entity_id:
        return False
    client = _get_table_client(TABLES[table_key])
    if client:
        _, _, ResourceNotFoundError = _try_import_tables()
        try:
            client.delete_entity(partition_key=tenant, row_key=entity_id)
            return True
        except Exception as exc:  # pylint: disable=broad-except
            if ResourceNotFoundError and isinstance(exc, ResourceNotFoundError):
                return False
            logger.warning("CRM delete_entity fallback to memory (%s/%s): %s", table_key, entity_id, exc)
    return _memory_delete(TABLES[table_key], tenant, entity_id)


def list_entities(
    table_key: str,
    tenant_id: str,
    *,
    limit: int = 50,
    cursor: Optional[str] = None,
    filter_fn: Optional[Callable[[Dict[str, Any]], bool]] = None,
    descending: bool = False,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    tenant = tenant_partition(tenant_id)
    safe_limit = max(1, min(200, int(limit or 50)))
    cursor_value = str(cursor or "")
    rows: List[Dict[str, Any]] = []
    client = _get_table_client(TABLES[table_key])
    if client:
        filter_expr = f"PartitionKey eq '{_escape_odata(tenant)}'"
        if cursor_value:
            op = "lt" if descending else "gt"
            filter_expr += f" and RowKey {op} '{_escape_odata(cursor_value)}'"
        try:
            try:
                iterator = client.query_entities(query_filter=filter_expr)
            except TypeError:
                # Some azure-data-tables versions expect positional query_filter.
                iterator = client.query_entities(filter_expr)
            rows = [_decode_payload(item) for item in iterator]
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("CRM list_entities fallback to memory (%s): %s", table_key, exc)
            rows = [_decode_payload(item) for item in _memory_list(TABLES[table_key], tenant)]
    else:
        rows = [_decode_payload(item) for item in _memory_list(TABLES[table_key], tenant)]

    rows.sort(key=lambda item: str(item.get("id") or ""))
    if descending:
        rows.reverse()
    if filter_fn:
        rows = [item for item in rows if filter_fn(item)]
    page = rows[:safe_limit]
    next_cursor = page[-1]["id"] if len(rows) > safe_limit and page else None
    return page, next_cursor


def is_same_tenant(item: Dict[str, Any], tenant_id: str) -> bool:
    return str(item.get("PartitionKey") or item.get("tenantId") or "") == tenant_partition(tenant_id)


def remove_task_indexes(tenant_id: str, task: Dict[str, Any]) -> None:
    tenant = tenant_partition(tenant_id)
    task_id = str(task.get("id") or "")
    if not task_id:
        return
    assigned_to = str(task.get("assignedToEmail") or "").strip().lower()
    status = str(task.get("status") or "new").strip().lower()
    if assigned_to:
        delete_entity("task_by_assignee", f"{tenant}|{assigned_to}", task_id)
    if status:
        delete_entity("task_by_status", f"{tenant}|{status}", task_id)


def upsert_task_indexes(tenant_id: str, task: Dict[str, Any]) -> None:
    tenant = tenant_partition(tenant_id)
    task_id = str(task.get("id") or "")
    if not task_id:
        return
    assigned_to = str(task.get("assignedToEmail") or "").strip().lower()
    status = str(task.get("status") or "new").strip().lower()
    if assigned_to:
        upsert_entity(
            "task_by_assignee",
            f"{tenant}|{assigned_to}",
            task_id,
            {
                "taskId": task_id,
                "dueDate": task.get("dueDate"),
                "priority": task.get("priority"),
                "status": status,
                "title": task.get("title"),
                "updatedAt": task.get("updatedAt"),
            },
        )
    if status:
        upsert_entity(
            "task_by_status",
            f"{tenant}|{status}",
            task_id,
            {
                "taskId": task_id,
                "assignedToEmail": assigned_to,
                "dueDate": task.get("dueDate"),
                "priority": task.get("priority"),
                "title": task.get("title"),
                "updatedAt": task.get("updatedAt"),
            },
        )


def lookup_task_ids_by_index(
    tenant_id: str,
    *,
    assignee_email: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 200,
) -> Optional[set]:
    tenant = tenant_partition(tenant_id)
    indexed_sets: List[set] = []
    if assignee_email:
        partition = f"{tenant}|{str(assignee_email).strip().lower()}"
        rows, _ = list_entities("task_by_assignee", partition, limit=limit)
        indexed_sets.append({str(row.get("taskId") or row.get("id")) for row in rows if row.get("taskId") or row.get("id")})
    if status:
        partition = f"{tenant}|{str(status).strip().lower()}"
        rows, _ = list_entities("task_by_status", partition, limit=limit)
        indexed_sets.append({str(row.get("taskId") or row.get("id")) for row in rows if row.get("taskId") or row.get("id")})
    if not indexed_sets:
        return None
    result = indexed_sets[0]
    for entry in indexed_sets[1:]:
        result = result.intersection(entry)
    return result


def write_audit_event(
    tenant_id: str,
    *,
    actor_email: str,
    actor_user_id: Optional[str],
    actor_role: str,
    entity_type: str,
    entity_id: str,
    action: str,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    meta: Optional[dict] = None,
) -> Dict[str, Any]:
    payload = {
        "tenantId": tenant_partition(tenant_id),
        "actorEmail": actor_email,
        "actorUserId": actor_user_id,
        "actorRole": actor_role,
        "entityType": entity_type,
        "entityId": entity_id,
        "action": action,
        "before": before or None,
        "after": after or None,
        "meta": meta or None,
        "timestamp": utc_now_iso(),
    }
    return create_entity("audit", tenant_id, payload)


def create_notification(
    tenant_id: str,
    *,
    user_email: str,
    notif_type: str,
    title: str,
    message: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
) -> Dict[str, Any]:
    payload = {
        "userEmail": str(user_email or "").strip().lower(),
        "type": notif_type,
        "title": title,
        "message": message,
        "entityType": entity_type,
        "entityId": entity_id,
        "read": False,
        "createdAt": utc_now_iso(),
    }
    return create_entity("notifications", tenant_id, payload)


def list_timeline_items(
    tenant_id: str,
    *,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    def matches(item: Dict[str, Any]) -> bool:
        if entity_type and str(item.get("entityType") or "").lower() != str(entity_type).lower():
            return False
        if entity_id and str(item.get("entityId") or "") != str(entity_id):
            return False
        return True

    comments, _ = list_entities("comments", tenant_id, limit=limit, filter_fn=matches, descending=True)
    activities, _ = list_entities("activities", tenant_id, limit=limit, filter_fn=matches, descending=True)
    audits, _ = list_entities("audit", tenant_id, limit=limit, filter_fn=matches, descending=True)
    emails, _ = list_entities("email_links", tenant_id, limit=limit, filter_fn=matches, descending=True)

    tagged = []
    for item in comments:
        tagged.append({"kind": "comment", **item})
    for item in activities:
        tagged.append({"kind": "activity", **item})
    for item in audits:
        tagged.append({"kind": "audit", **item})
    for item in emails:
        tagged.append({"kind": "email_link", **item})

    tagged.sort(key=lambda item: str(item.get("id") or ""), reverse=True)
    return tagged[: max(1, min(200, limit))]


def reset_memory_store_for_tests() -> None:
    with _memory_lock:
        _memory_store.clear()
