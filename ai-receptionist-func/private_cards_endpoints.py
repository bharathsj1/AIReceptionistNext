from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, Optional, Tuple

import azure.functions as func
from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import BlobServiceClient, ContentSettings, PublicAccess

from crm_shared import resolve_actor
from function_app import app
from shared_code.private_cards import (
    build_vcard,
    generate_token,
    safe_filename,
    sanitize_public_card,
)
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)

PRIVATE_PARTITION = "PRIVATE"
PRIVATE_CARDS_TABLE = os.getenv("PRIVATE_CARDS_TABLE", "PrivateCards")
PUBLIC_APP_URL = (os.getenv("PUBLIC_APP_URL") or "https://smartconnect4u.com").rstrip("/")
BLOB_CONTAINER_PHOTOS = (os.getenv("BLOB_CONTAINER_PHOTOS") or "employee-photos").strip().lower()
MAX_PHOTO_BYTES = int(os.getenv("PRIVATE_CARD_MAX_PHOTO_BYTES", str(5 * 1024 * 1024)))
RATE_TOKENS = max(1, int(os.getenv("PRIVATE_CARD_RATE_LIMIT_TOKENS", "12")))
RATE_WINDOW_SEC = max(1, int(os.getenv("PRIVATE_CARD_RATE_LIMIT_WINDOW_SEC", "60")))

_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{20,32}$")
_BOUNDARY_PATTERN = re.compile(r'boundary=(?:"([^"]+)"|([^;]+))', re.I)
_FILENAME_PATTERN = re.compile(r'filename="([^"]+)"', re.I)
_NAME_PATTERN = re.compile(r'name="([^"]+)"', re.I)
_CONTENT_TYPE_PATTERN = re.compile(r"^content-type:\s*([^\r\n;]+)", re.I | re.M)

_RATE_BUCKETS: Dict[str, tuple[float, float]] = {}
_RATE_LOCK = Lock()

_service_client = None
_table_client = None
_table_init_failed = False
_table_lock = Lock()

_memory_lock = Lock()
_memory_cards: Dict[str, Dict[str, Any]] = {}


def _try_import_tables():
    try:
        from azure.data.tables import TableServiceClient  # type: ignore

        return TableServiceClient
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Azure Tables import unavailable for private cards: %s", exc)
        return None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _to_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    lowered = str(value).strip().lower()
    if lowered in {"1", "true", "yes", "y", "on"}:
        return True
    if lowered in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_optional(value: Any) -> str:
    return str(value or "").strip()


def _validate_token(value: str | None) -> bool:
    return bool(_TOKEN_PATTERN.match(str(value or "").strip()))


def _is_rate_limited(client_ip: str | None) -> bool:
    if not client_ip:
        return False
    now = time.time()
    with _RATE_LOCK:
        tokens, last = _RATE_BUCKETS.get(client_ip, (RATE_TOKENS, now))
        elapsed = now - last
        refill_rate = RATE_TOKENS / RATE_WINDOW_SEC
        tokens = min(RATE_TOKENS, tokens + elapsed * refill_rate)
        if tokens < 1:
            _RATE_BUCKETS[client_ip] = (tokens, now)
            return True
        _RATE_BUCKETS[client_ip] = (tokens - 1, now)
    return False


def _extract_client_ip(req: func.HttpRequest) -> str:
    candidate = (
        req.headers.get("x-forwarded-for")
        or req.headers.get("x-client-ip")
        or req.headers.get("x-azure-clientip")
        or ""
    )
    return candidate.split(",")[0].strip()


def _cors(req: func.HttpRequest, methods: list[str]) -> Dict[str, str]:
    return build_cors_headers(req, methods)


def _public_headers(req: func.HttpRequest, methods: list[str]) -> Dict[str, str]:
    return {
        **_cors(req, methods),
        "X-Robots-Tag": "noindex, nofollow",
        "Cache-Control": "no-store",
    }


def _json_response(payload: Dict[str, Any], status_code: int, headers: Dict[str, str]) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(payload),
        status_code=status_code,
        mimetype="application/json",
        headers=headers,
    )


def _get_service_client():
    global _service_client, _table_init_failed
    if _table_init_failed:
        return None
    if _service_client is not None:
        return _service_client

    conn_str = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not conn_str:
        return None

    table_cls = _try_import_tables()
    if not table_cls:
        return None

    try:
        _service_client = table_cls.from_connection_string(conn_str)
        return _service_client
    except Exception as exc:  # pylint: disable=broad-except
        _table_init_failed = True
        logger.warning("Failed to initialize private card table service: %s", exc)
        return None


def _get_table_client():
    global _table_client
    if _table_client is not None:
        return _table_client

    service = _get_service_client()
    if service is None:
        return None

    with _table_lock:
        if _table_client is not None:
            return _table_client
        try:
            client = service.get_table_client(PRIVATE_CARDS_TABLE)
            try:
                client.create_table()
            except ResourceExistsError:
                pass
            _table_client = client
            return _table_client
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Failed to initialize private cards table '%s': %s", PRIVATE_CARDS_TABLE, exc)
            return None


def _memory_get(token: str) -> Optional[Dict[str, Any]]:
    with _memory_lock:
        existing = _memory_cards.get(token)
        if not existing:
            return None
        return {**existing}


def _memory_create(token: str, payload: Dict[str, Any]) -> bool:
    with _memory_lock:
        if token in _memory_cards:
            return False
        _memory_cards[token] = {**payload}
        return True


def _memory_upsert(token: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    with _memory_lock:
        _memory_cards[token] = {**payload}
        return {**_memory_cards[token]}


def _entity_to_dict(entity: Dict[str, Any] | None) -> Dict[str, Any]:
    if not entity:
        return {}
    payload = dict(entity)
    payload["token"] = str(payload.get("token") or payload.get("RowKey") or "")
    payload["isActive"] = _to_bool(payload.get("isActive"), default=True)
    return payload


def _get_card_entity(token: str) -> Optional[Dict[str, Any]]:
    client = _get_table_client()
    if client:
        try:
            entity = client.get_entity(partition_key=PRIVATE_PARTITION, row_key=token)
            return _entity_to_dict(entity)
        except Exception as exc:  # pylint: disable=broad-except
            if isinstance(exc, ResourceNotFoundError):
                return None
            logger.warning("Private card get failed for token=%s: %s", token, exc)
    return _memory_get(token)


def _create_card_entity(token: str, payload: Dict[str, Any]) -> bool:
    entity = {
        "PartitionKey": PRIVATE_PARTITION,
        "RowKey": token,
        **payload,
    }
    client = _get_table_client()
    if client:
        try:
            client.create_entity(entity=entity)
            return True
        except Exception as exc:  # pylint: disable=broad-except
            if isinstance(exc, ResourceExistsError):
                return False
            logger.error("Private card create failed for token=%s: %s", token, exc)
            raise
    return _memory_create(token, payload)


def _upsert_card_entity(token: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    entity = {
        "PartitionKey": PRIVATE_PARTITION,
        "RowKey": token,
        **payload,
    }
    client = _get_table_client()
    if client:
        try:
            client.upsert_entity(entity=entity, mode="MERGE")
        except TypeError:
            client.upsert_entity(entity=entity)
        except Exception:
            client.upsert_entity(entity=entity)
        return _entity_to_dict(entity)
    return _memory_upsert(token, payload)


def _generate_unique_token() -> str:
    for _ in range(40):
        token = generate_token(24)
        if not _get_card_entity(token):
            return token
    raise RuntimeError("Unable to generate unique private card token")


def _require_admin(req: func.HttpRequest, body: Dict[str, Any], cors: Dict[str, str]) -> Tuple[Optional[Any], Optional[func.HttpResponse]]:
    actor = resolve_actor(req, body)
    if not actor:
        return None, _json_response({"error": "auth required"}, 401, cors)
    if str(actor.role or "").strip().lower() != "admin":
        return None, _json_response({"error": "admin required"}, 403, cors)
    return actor, None


def _admin_view(entity: Dict[str, Any]) -> Dict[str, Any]:
    allowed = {
        "token": str(entity.get("token") or ""),
        "fullName": _normalize_optional(entity.get("fullName")),
        "jobTitle": _normalize_optional(entity.get("jobTitle")),
        "department": _normalize_optional(entity.get("department")),
        "companyName": _normalize_optional(entity.get("companyName")),
        "workPhone": _normalize_optional(entity.get("workPhone")),
        "mobilePhone": _normalize_optional(entity.get("mobilePhone")),
        "whatsappPhone": _normalize_optional(entity.get("whatsappPhone")),
        "email": _normalize_email(entity.get("email")),
        "website": _normalize_optional(entity.get("website")),
        "address": _normalize_optional(entity.get("address")),
        "mapUrl": _normalize_optional(entity.get("mapUrl")),
        "linkedInUrl": _normalize_optional(entity.get("linkedInUrl")),
        "photoUrl": _normalize_optional(entity.get("photoUrl")),
        "isActive": _to_bool(entity.get("isActive"), default=True),
        "createdAt": _normalize_optional(entity.get("createdAt")),
        "updatedAt": _normalize_optional(entity.get("updatedAt")),
        "hasKey": bool(str(entity.get("keyHash") or "").strip()),
    }
    return allowed


def _resolve_public_card(req: func.HttpRequest) -> Optional[Dict[str, Any]]:
    token = (req.params.get("token") or "").strip()
    if not _validate_token(token):
        return None

    entity = _get_card_entity(token)
    if not entity or not _to_bool(entity.get("isActive"), default=True):
        return None

    return entity


def _content_type_to_ext(content_type: str, filename: str) -> str:
    lowered = (content_type or "").strip().lower()
    if lowered == "image/png":
        return ".png"
    if lowered in {"image/jpeg", "image/jpg"}:
        return ".jpg"
    ext = os.path.splitext(filename or "")[1].lower()
    if ext == ".png":
        return ".png"
    return ".jpg"


def _extract_part_bytes(raw_part: bytes) -> tuple[bytes, str, str]:
    section = raw_part.lstrip(b"\r\n")
    head, sep, body = section.partition(b"\r\n\r\n")
    if not sep:
        return b"", "", ""

    headers = head.decode("utf-8", errors="ignore")
    name_match = _NAME_PATTERN.search(headers)
    filename_match = _FILENAME_PATTERN.search(headers)
    field_name = (name_match.group(1) if name_match else "").strip().lower()
    filename = (filename_match.group(1) if filename_match else "").strip()
    content_type_match = _CONTENT_TYPE_PATTERN.search(headers)
    content_type = (content_type_match.group(1) if content_type_match else "").strip().lower()

    payload = body
    if payload.endswith(b"\r\n"):
        payload = payload[:-2]
    if payload.endswith(b"--"):
        payload = payload[:-2]

    if not filename and field_name not in {"file", "photo", "image"}:
        return b"", "", ""
    return payload, content_type, filename


def _extract_multipart_image(req: func.HttpRequest) -> tuple[Optional[bytes], str, str]:
    content_type = (req.headers.get("content-type") or req.headers.get("Content-Type") or "").strip()
    boundary_match = _BOUNDARY_PATTERN.search(content_type)
    if not boundary_match:
        return None, "", ""
    boundary = (boundary_match.group(1) or boundary_match.group(2) or "").strip()
    if not boundary:
        return None, "", ""

    marker = f"--{boundary}".encode("utf-8")
    body = req.get_body() or b""
    for raw_part in body.split(marker):
        chunk = raw_part.strip()
        if not chunk or chunk == b"--":
            continue
        payload, part_type, filename = _extract_part_bytes(raw_part)
        if payload:
            return payload, part_type, filename
    return None, "", ""


def _extract_base64_image(body: Dict[str, Any]) -> tuple[Optional[bytes], str, str]:
    content_base64 = (body.get("content_base64") or body.get("contentBase64") or "").strip()
    data_url = (body.get("data_url") or body.get("dataUrl") or "").strip()
    filename = _normalize_optional(body.get("filename") or "photo.jpg")
    content_type = _normalize_optional(body.get("content_type") or body.get("contentType")).lower()

    if data_url and not content_base64:
        if "," not in data_url:
            return None, "", ""
        header, encoded = data_url.split(",", 1)
        if "base64" not in header.lower():
            return None, "", ""
        content_base64 = encoded.strip()
        if not content_type and ";" in header:
            content_type = header.split(";", 1)[0].replace("data:", "").strip().lower()

    if not content_base64:
        return None, "", ""

    try:
        raw = base64.b64decode(content_base64, validate=True)
    except Exception:  # pylint: disable=broad-except
        return None, "", ""

    return raw, content_type, filename


def _extract_photo_upload(req: func.HttpRequest) -> tuple[Optional[bytes], str, str]:
    content_type = (req.headers.get("content-type") or req.headers.get("Content-Type") or "").lower()
    if "multipart/form-data" in content_type:
        return _extract_multipart_image(req)

    try:
        body = req.get_json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return _extract_base64_image(body)


def _upload_photo_blob(token: str, raw_bytes: bytes, content_type: str, filename: str) -> str:
    conn_str = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not conn_str:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING is required")

    content_type = (content_type or "").split(";")[0].strip().lower()
    if content_type and not content_type.startswith("image/"):
        raise ValueError("Only image uploads are allowed")

    ext = _content_type_to_ext(content_type, filename)
    if ext == ".png":
        normalized_content_type = "image/png"
    else:
        normalized_content_type = "image/jpeg"

    blob_name = f"{token}{ext}"
    blob_service = BlobServiceClient.from_connection_string(conn_str)
    container = blob_service.get_container_client(BLOB_CONTAINER_PHOTOS)
    try:
        container.create_container(public_access=PublicAccess.Blob)
    except TypeError:
        container.create_container()
    except ResourceExistsError:
        pass
    blob = container.get_blob_client(blob_name)
    blob.upload_blob(
        raw_bytes,
        overwrite=True,
        content_settings=ContentSettings(content_type=normalized_content_type),
    )
    return blob.url


@app.function_name(name="PrivateCards")
@app.route(route="private-cards", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def private_cards_create(req: func.HttpRequest) -> func.HttpResponse:
    cors = _cors(req, ["POST", "OPTIONS"])
    if req.method.upper() == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}

    _, auth_error = _require_admin(req, body, cors)
    if auth_error:
        return auth_error

    full_name = _normalize_optional(body.get("fullName"))
    email = _normalize_email(body.get("email"))
    if not full_name or not email:
        return _json_response({"error": "fullName and email are required"}, 400, cors)

    token = ""
    created = False
    for _ in range(8):
        token = _generate_unique_token()
        now_iso = _utc_now_iso()
        entity = {
            "token": token,
            "fullName": full_name,
            "jobTitle": _normalize_optional(body.get("jobTitle")),
            "department": _normalize_optional(body.get("department")),
            "companyName": _normalize_optional(body.get("companyName")) or "SmartConnect4u",
            "workPhone": _normalize_optional(body.get("workPhone")),
            "mobilePhone": _normalize_optional(body.get("mobilePhone")),
            "whatsappPhone": _normalize_optional(body.get("whatsappPhone")),
            "email": email,
            "website": _normalize_optional(body.get("website")) or "https://smartconnect4u.com",
            "address": _normalize_optional(body.get("address")),
            "mapUrl": _normalize_optional(body.get("mapUrl")),
            "linkedInUrl": _normalize_optional(body.get("linkedInUrl")),
            "photoUrl": _normalize_optional(body.get("photoUrl")),
            "isActive": _to_bool(body.get("isActive"), default=True),
            "createdAt": now_iso,
            "updatedAt": now_iso,
        }
        try:
            created = _create_card_entity(token, entity)
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Failed to create private card: %s", exc)
            return _json_response({"error": "Failed to create private card"}, 500, cors)
        if created:
            break
    if not created:
        return _json_response({"error": "Unable to allocate unique token"}, 500, cors)

    url = f"{PUBLIC_APP_URL}/card/{token}"
    card_url = f"{PUBLIC_APP_URL}/api/private-card?token={token}"
    vcard_url = f"{PUBLIC_APP_URL}/api/private-vcard?token={token}"

    payload = {
        "url": url,
        "cardUrl": card_url,
        "vcardUrl": vcard_url,
    }
    return _json_response(payload, 201, cors)


@app.function_name(name="PrivateCardUpdate")
@app.route(route="private-cards/{token}", methods=["PUT", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def private_cards_update(req: func.HttpRequest) -> func.HttpResponse:
    cors = _cors(req, ["PUT", "OPTIONS"])
    if req.method.upper() == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    token = (req.route_params.get("token") or "").strip()
    if not _validate_token(token):
        return _json_response({"error": "invalid token"}, 400, cors)

    try:
        body = req.get_json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}

    _, auth_error = _require_admin(req, body, cors)
    if auth_error:
        return auth_error

    existing = _get_card_entity(token)
    if not existing:
        return _json_response({"error": "not found"}, 404, cors)

    allowed_fields = {
        "fullName",
        "jobTitle",
        "department",
        "companyName",
        "workPhone",
        "mobilePhone",
        "whatsappPhone",
        "email",
        "website",
        "address",
        "mapUrl",
        "linkedInUrl",
        "photoUrl",
        "isActive",
    }

    updates: Dict[str, Any] = {}
    for key, value in body.items():
        if key not in allowed_fields:
            continue
        if key == "email":
            updates[key] = _normalize_email(value)
        elif key == "isActive":
            updates[key] = _to_bool(value, default=True)
        else:
            updates[key] = _normalize_optional(value)

    merged = {
        **existing,
        **updates,
        "updatedAt": _utc_now_iso(),
    }

    persisted = _upsert_card_entity(token, merged)
    return _json_response({"card": _admin_view(persisted)}, 200, cors)


@app.function_name(name="PrivateCardPhotoUpload")
@app.route(route="private-cards/{token}/photo", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def private_card_photo_upload(req: func.HttpRequest) -> func.HttpResponse:
    cors = _cors(req, ["POST", "OPTIONS"])
    if req.method.upper() == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    token = (req.route_params.get("token") or "").strip()
    if not _validate_token(token):
        return _json_response({"error": "invalid token"}, 400, cors)

    try:
        body = req.get_json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}

    _, auth_error = _require_admin(req, body, cors)
    if auth_error:
        return auth_error

    existing = _get_card_entity(token)
    if not existing:
        return _json_response({"error": "not found"}, 404, cors)

    raw_bytes, content_type, filename = _extract_photo_upload(req)
    if not raw_bytes:
        return _json_response({"error": "multipart/form-data file or base64 payload is required"}, 400, cors)
    if len(raw_bytes) > MAX_PHOTO_BYTES:
        return _json_response({"error": "photo too large"}, 413, cors)

    try:
        photo_url = _upload_photo_blob(token, raw_bytes, content_type, filename)
    except ValueError as exc:
        return _json_response({"error": str(exc)}, 400, cors)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Private card photo upload failed: %s", exc)
        return _json_response({"error": "photo upload failed"}, 500, cors)

    merged = {
        **existing,
        "photoUrl": photo_url,
        "updatedAt": _utc_now_iso(),
    }
    _upsert_card_entity(token, merged)
    return _json_response({"photoUrl": photo_url}, 200, cors)


@app.function_name(name="PrivateCardPublic")
@app.route(route="private-card", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def private_card_public(req: func.HttpRequest) -> func.HttpResponse:
    headers = _public_headers(req, ["GET", "OPTIONS"])
    if req.method.upper() == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=headers)

    if _is_rate_limited(_extract_client_ip(req)):
        return _json_response({"error": "too many requests"}, 429, headers)

    entity = _resolve_public_card(req)
    if not entity:
        return _json_response({"error": "not found"}, 404, headers)

    return _json_response(sanitize_public_card(entity), 200, headers)


@app.function_name(name="PrivateVcardPublic")
@app.route(route="private-vcard", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def private_vcard_public(req: func.HttpRequest) -> func.HttpResponse:
    headers = _public_headers(req, ["GET", "OPTIONS"])
    if req.method.upper() == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=headers)

    if _is_rate_limited(_extract_client_ip(req)):
        return _json_response({"error": "too many requests"}, 429, headers)

    entity = _resolve_public_card(req)
    if not entity:
        return _json_response({"error": "not found"}, 404, headers)

    public_card = sanitize_public_card(entity)
    display_name = public_card.get("fullName") or "contact"
    filename = safe_filename(display_name)
    vcard_text = build_vcard(public_card)

    return func.HttpResponse(
        body=vcard_text,
        status_code=200,
        mimetype="text/vcard; charset=utf-8",
        headers={
            **headers,
            "Content-Type": "text/vcard; charset=utf-8",
            "Content-Disposition": f'attachment; filename="{filename}.vcf"',
        },
    )
