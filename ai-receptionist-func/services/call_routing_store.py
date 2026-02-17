from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, Iterable, Optional

logger = logging.getLogger(__name__)

ROUTING_CONFIGS_TABLE = os.getenv("ROUTING_CONFIGS_TABLE", "RoutingConfigs")
FORWARD_TARGETS_TABLE = os.getenv("FORWARD_TARGETS_TABLE", "ForwardTargets")
TRANSFER_LOGS_TABLE = os.getenv("TRANSFER_LOGS_TABLE", "TransferLogs")

_service_client = None
_table_clients: Dict[str, Any] = {}
_table_lock = Lock()
_table_init_failed = False

_memory_store: Dict[str, Dict[str, Dict[str, dict]]] = {}
_memory_lock = Lock()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def tenant_id_from_client_id(client_id: Any) -> str:
    return f"client:{int(client_id)}"


def client_id_from_tenant_id(tenant_id: str | None) -> Optional[int]:
    raw = str(tenant_id or "").strip().lower()
    if not raw.startswith("client:"):
        return None
    try:
        return int(raw.split(":", 1)[1])
    except (TypeError, ValueError):
        return None


def normalize_e164(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    # Keep + and digits only.
    cleaned = re.sub(r"[^\d+]", "", raw)
    if cleaned.startswith("00"):
        cleaned = f"+{cleaned[2:]}"
    if cleaned and not cleaned.startswith("+"):
        cleaned = f"+{cleaned}"
    cleaned = f"+{re.sub(r'[^0-9]', '', cleaned)}" if cleaned.startswith("+") else cleaned
    return cleaned


def _try_import_tables():
    try:
        from azure.data.tables import TableServiceClient  # type: ignore
        from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError  # type: ignore

        return TableServiceClient, ResourceExistsError, ResourceNotFoundError
    except Exception as exc:  # pylint: disable=broad-except
        logger.info("Azure Tables SDK unavailable for routing store: %s", exc)
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
        logger.warning("Failed to initialize routing TableServiceClient: %s", exc)
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
            logger.warning("Failed to initialize routing table '%s': %s", table_name, exc)
            return None


def _escape_odata(value: str) -> str:
    return str(value or "").replace("'", "''")


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def _json_load(raw: Any, default: Any = None) -> Any:
    if raw is None:
        return default
    if isinstance(raw, (dict, list)):
        return raw
    if not isinstance(raw, str):
        return raw
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default if default is not None else raw


def _memory_upsert(table_name: str, partition_key: str, row_key: str, entity: dict) -> dict:
    with _memory_lock:
        table = _memory_store.setdefault(table_name, {})
        partition = table.setdefault(partition_key, {})
        payload = {"PartitionKey": partition_key, "RowKey": row_key, **entity}
        partition[row_key] = payload
        return payload


def _memory_get(table_name: str, partition_key: str, row_key: str) -> Optional[dict]:
    with _memory_lock:
        return _memory_store.get(table_name, {}).get(partition_key, {}).get(row_key)


def _memory_find_by_row_key(table_name: str, row_key: str) -> Optional[dict]:
    with _memory_lock:
        for partition in _memory_store.get(table_name, {}).values():
            if row_key in partition:
                return partition[row_key]
    return None


def _upsert_entity(table_name: str, partition_key: str, row_key: str, fields: dict) -> dict:
    client = _get_table_client(table_name)
    entity = {"PartitionKey": partition_key, "RowKey": row_key, **fields}
    if client:
        # Azure Tables SDK versions differ in how UpdateMode must be passed.
        # Default upsert behavior is merge; prefer no explicit mode first.
        try:
            client.upsert_entity(entity=entity)
        except TypeError:
            # Older signatures may require positional args or explicit mode.
            client.upsert_entity(entity, mode="MERGE")
        except Exception:
            # Some versions require UpdateMode enum values.
            try:
                from azure.data.tables import UpdateMode  # type: ignore

                client.upsert_entity(entity=entity, mode=UpdateMode.MERGE)
            except Exception:
                # Last fallback: explicit string variant accepted by some releases.
                client.upsert_entity(entity=entity, mode="merge")
        return entity
    return _memory_upsert(table_name, partition_key, row_key, fields)


def _get_entity(table_name: str, partition_key: str, row_key: str) -> Optional[dict]:
    client = _get_table_client(table_name)
    if client:
        try:
            return client.get_entity(partition_key=partition_key, row_key=row_key)
        except Exception:  # pylint: disable=broad-except
            return None
    return _memory_get(table_name, partition_key, row_key)


def _find_entity_by_row_key(table_name: str, row_key: str) -> Optional[dict]:
    client = _get_table_client(table_name)
    if client:
        filter_expr = f"RowKey eq '{_escape_odata(row_key)}'"
        try:
            try:
                entities = list(client.query_entities(query_filter=filter_expr))
            except TypeError:
                entities = list(client.query_entities(filter_expr))
        except Exception:  # pylint: disable=broad-except
            entities = []
        return entities[0] if entities else None
    return _memory_find_by_row_key(table_name, row_key)


def get_routing_config(tenant_id: str, twilio_number: str) -> Optional[dict]:
    row_key = normalize_e164(twilio_number)
    if not tenant_id or not row_key:
        return None
    entity = _get_entity(ROUTING_CONFIGS_TABLE, tenant_id, row_key)
    if not entity:
        return None
    return {
        "tenantId": entity.get("PartitionKey"),
        "twilioNumber": entity.get("RowKey"),
        "country": entity.get("country"),
        "timezone": entity.get("timezone"),
        "enabled": bool(entity.get("enabled", True)),
        "rules": _json_load(entity.get("rulesJson"), default=[]),
        "updatedBy": entity.get("updatedBy"),
        "updatedAt": entity.get("updatedAt"),
    }


def upsert_routing_config(
    tenant_id: str,
    twilio_number: str,
    *,
    country: str,
    timezone_name: str,
    enabled: bool,
    rules: Iterable[dict],
    updated_by: str,
) -> dict:
    row_key = normalize_e164(twilio_number)
    payload = {
        "country": (country or "").upper(),
        "timezone": timezone_name,
        "enabled": bool(enabled),
        "rulesJson": _json_dump(list(rules or [])),
        "updatedBy": updated_by,
        "updatedAt": _utc_now_iso(),
    }
    entity = _upsert_entity(ROUTING_CONFIGS_TABLE, tenant_id, row_key, payload)
    return {
        "tenantId": entity.get("PartitionKey"),
        "twilioNumber": entity.get("RowKey"),
        "country": payload["country"],
        "timezone": payload["timezone"],
        "enabled": payload["enabled"],
        "rules": list(rules or []),
        "updatedBy": payload["updatedBy"],
        "updatedAt": payload["updatedAt"],
    }


def get_forward_targets(tenant_id: str, twilio_number: str) -> Optional[dict]:
    row_key = normalize_e164(twilio_number)
    if not tenant_id or not row_key:
        return None
    entity = _get_entity(FORWARD_TARGETS_TABLE, tenant_id, row_key)
    if not entity:
        return None
    return {
        "tenantId": entity.get("PartitionKey"),
        "twilioNumber": entity.get("RowKey"),
        "targets": _json_load(entity.get("targetsJson"), default=[]),
        "ringStrategy": entity.get("ringStrategy") or "sequential",
        "timeoutSeconds": int(entity.get("timeoutSeconds") or 20),
        "fallback": entity.get("fallback") or "voicemail",
        "updatedBy": entity.get("updatedBy"),
        "updatedAt": entity.get("updatedAt"),
    }


def upsert_forward_targets(
    tenant_id: str,
    twilio_number: str,
    *,
    targets: Iterable[dict],
    ring_strategy: str,
    timeout_seconds: int,
    fallback: str,
    updated_by: str,
) -> dict:
    row_key = normalize_e164(twilio_number)
    payload = {
        "targetsJson": _json_dump(list(targets or [])),
        "ringStrategy": ring_strategy or "sequential",
        "timeoutSeconds": int(timeout_seconds or 20),
        "fallback": fallback or "voicemail",
        "updatedBy": updated_by,
        "updatedAt": _utc_now_iso(),
    }
    entity = _upsert_entity(FORWARD_TARGETS_TABLE, tenant_id, row_key, payload)
    return {
        "tenantId": entity.get("PartitionKey"),
        "twilioNumber": entity.get("RowKey"),
        "targets": list(targets or []),
        "ringStrategy": payload["ringStrategy"],
        "timeoutSeconds": payload["timeoutSeconds"],
        "fallback": payload["fallback"],
        "updatedBy": payload["updatedBy"],
        "updatedAt": payload["updatedAt"],
    }


def resolve_routing_bundle_by_twilio_number(twilio_number: str) -> Optional[dict]:
    row_key = normalize_e164(twilio_number)
    if not row_key:
        return None
    config_entity = _find_entity_by_row_key(ROUTING_CONFIGS_TABLE, row_key)
    if not config_entity:
        return None
    tenant_id = config_entity.get("PartitionKey")
    config = get_routing_config(tenant_id, row_key)
    forward = get_forward_targets(tenant_id, row_key)
    return {
        "tenantId": tenant_id,
        "twilioNumber": row_key,
        "routingConfig": config,
        "forwardTargets": forward,
    }


def upsert_transfer_log(tenant_id: str, call_sid: str, patch: dict) -> dict:
    row_key = str(call_sid or "").strip()
    if not tenant_id or not row_key:
        return {}
    existing = _get_entity(TRANSFER_LOGS_TABLE, tenant_id, row_key) or {}
    payload = {
        **{k: v for k, v in existing.items() if k not in {"PartitionKey", "RowKey"}},
        **(patch or {}),
        "updatedAt": _utc_now_iso(),
    }
    if "createdAt" not in payload:
        payload["createdAt"] = payload["updatedAt"]
    # Normalize JSON-ish keys for stable storage.
    normalized = {}
    for key, value in payload.items():
        if isinstance(value, (dict, list)):
            normalized[f"{key}Json"] = _json_dump(value)
        else:
            normalized[key] = value
    entity = _upsert_entity(TRANSFER_LOGS_TABLE, tenant_id, row_key, normalized)
    return deserialize_transfer_log(entity)


def deserialize_transfer_log(entity: dict | None) -> Optional[dict]:
    if not entity:
        return None
    payload: Dict[str, Any] = {
        "tenantId": entity.get("PartitionKey"),
        "callSid": entity.get("RowKey"),
    }
    for key, value in entity.items():
        if key in {"PartitionKey", "RowKey", "Timestamp", "etag"}:
            continue
        if key.endswith("Json"):
            payload[key[:-4]] = _json_load(value, default={})
        else:
            payload[key] = value
    return payload


def get_transfer_log(tenant_id: str, call_sid: str) -> Optional[dict]:
    row_key = str(call_sid or "").strip()
    if not tenant_id or not row_key:
        return None
    return deserialize_transfer_log(_get_entity(TRANSFER_LOGS_TABLE, tenant_id, row_key))


def get_transfer_log_by_call_sid(call_sid: str) -> Optional[dict]:
    row_key = str(call_sid or "").strip()
    if not row_key:
        return None
    return deserialize_transfer_log(_find_entity_by_row_key(TRANSFER_LOGS_TABLE, row_key))
