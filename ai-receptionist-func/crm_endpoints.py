from __future__ import annotations

import json
import logging
import csv
import ipaddress
import urllib.error
import urllib.request
from io import StringIO
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import azure.functions as func
from sqlalchemy import func as sa_func

from function_app import app
from crm_shared import CRMActor, list_tenant_users, resolve_actor_from_session
from shared.config import get_setting
from shared.db import Client, SessionLocal, TaskManagerItem, User
from services.crm_rbac import (
    TASK_MANAGER_MUTABLE_FIELDS,
    can_create_contact,
    can_create_deal,
    can_create_task,
    can_manage_all,
    can_patch_task,
    can_view_task,
    clamp_progress,
    normalize_task_status,
)
from services.crm_store import (
    create_entity,
    create_notification,
    delete_entity,
    get_entity,
    list_entities,
    list_timeline_items,
    lookup_task_ids_by_index,
    remove_task_indexes,
    upsert_entity,
    upsert_task_indexes,
    utc_now_iso,
    write_audit_event,
)
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)

MAX_PAGE_SIZE = 100


def _json(data: Dict[str, Any], *, status_code: int, cors: Dict[str, str]) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(data),
        status_code=status_code,
        mimetype="application/json",
        headers=cors,
    )


def _error(
    *,
    cors: Dict[str, str],
    status_code: int,
    message: str,
    code: str,
    details: Optional[Any] = None,
) -> func.HttpResponse:
    payload = {"error": message, "code": code}
    if details is not None:
        payload["details"] = details
    return _json(payload, status_code=status_code, cors=cors)


def _parse_body(req: func.HttpRequest) -> Dict[str, Any]:
    try:
        payload = req.get_json()
        if isinstance(payload, dict):
            return payload
    except ValueError:
        pass
    return {}


def _get_limit(req: func.HttpRequest, default: int = 50) -> int:
    raw = req.params.get("limit")
    try:
        parsed = int(raw) if raw else default
    except ValueError:
        parsed = default
    return max(1, min(MAX_PAGE_SIZE, parsed))


def _normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_list(value: Any, *, lower: bool = False) -> List[str]:
    if not isinstance(value, list):
        return []
    out: List[str] = []
    for item in value:
        text = str(item or "").strip()
        if not text:
            continue
        out.append(text.lower() if lower else text)
    return out


def _parse_datetime_utc(value: Any) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _normalize_attachments(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: List[Dict[str, Any]] = []
    for raw in value:
        if not isinstance(raw, dict):
            continue
        item = {
            "id": str(raw.get("id") or "").strip(),
            "name": str(raw.get("name") or "").strip(),
            "url": str(raw.get("url") or "").strip(),
            "mimeType": str(raw.get("mimeType") or raw.get("mime") or "").strip(),
            "sizeBytes": 0,
            "uploadedAt": str(raw.get("uploadedAt") or raw.get("createdAt") or utc_now_iso()),
            "uploadedByEmail": _normalize_email(raw.get("uploadedByEmail")),
        }
        try:
            item["sizeBytes"] = max(0, int(raw.get("sizeBytes") or raw.get("size") or 0))
        except (TypeError, ValueError):
            item["sizeBytes"] = 0
        if item["name"] or item["url"]:
            out.append(item)
    return out


def _extract_client_ip(req: func.HttpRequest) -> Optional[str]:
    header_keys = [
        "x-forwarded-for",
        "x-original-for",
        "x-real-ip",
        "cf-connecting-ip",
        "true-client-ip",
    ]
    for key in header_keys:
        raw = req.headers.get(key)
        if not raw:
            continue
        first = str(raw).split(",")[0].strip()
        if not first:
            continue
        try:
            ipaddress.ip_address(first)
            return first
        except ValueError:
            continue
    return None


def _country_from_headers(req: func.HttpRequest) -> Optional[str]:
    header_keys = [
        "cf-ipcountry",
        "x-country-code",
        "x-geo-country",
        "x-azure-country",
        "x-appservice-country",
    ]
    for key in header_keys:
        value = req.headers.get(key)
        if value and isinstance(value, str):
            code = value.strip().upper()
            if len(code) == 2:
                return code
    return None


def _lookup_country_from_ip(ip_address: str) -> Optional[str]:
    try:
        ip_obj = ipaddress.ip_address(ip_address)
        if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_reserved:
            return None
    except ValueError:
        return None
    url_template = get_setting("IP_GEOLOCATION_URL") or "https://ipapi.co/{ip}/json/"
    url = url_template.format(ip=ip_address)
    try:
        request = urllib.request.Request(url=url, headers={"User-Agent": "smartconnect4u-crm/1.0"})
        with urllib.request.urlopen(request, timeout=2.5) as response:
            payload = response.read().decode("utf-8", errors="ignore")
        data = json.loads(payload) if payload else {}
        code = str(data.get("country_code") or data.get("country") or "").strip().upper()
        if len(code) == 2:
            return code
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return None
    except Exception:  # pylint: disable=broad-except
        return None
    return None


def _resolve_country_code(req: func.HttpRequest, body: Optional[Dict[str, Any]] = None) -> str:
    fallback = (get_setting("TWILIO_DEFAULT_COUNTRY") or "US").strip().upper() or "US"
    query_explicit = (
        req.params.get("country")
        or req.params.get("countryCode")
        or req.params.get("country_code")
    )
    if isinstance(query_explicit, str):
        query_code = query_explicit.strip().upper()
        if len(query_code) == 2:
            return query_code
    if isinstance(body, dict):
        explicit = body.get("country") or body.get("countryCode") or body.get("country_code")
        if isinstance(explicit, str):
            code = explicit.strip().upper()
            if len(code) == 2:
                return code
    header_country = _country_from_headers(req)
    if header_country:
        return header_country
    ip_addr = _extract_client_ip(req)
    if ip_addr:
        resolved = _lookup_country_from_ip(ip_addr)
        if resolved:
            return resolved
    return fallback


def _currency_for_country(country_code: str) -> str:
    code = str(country_code or "").strip().upper()
    mapping = {
        "US": "USD",
        "CA": "CAD",
        "GB": "GBP",
        "UK": "GBP",
        "AU": "AUD",
        "NZ": "NZD",
        "IN": "INR",
        "SG": "SGD",
        "AE": "AED",
        "DE": "EUR",
        "FR": "EUR",
        "ES": "EUR",
        "IT": "EUR",
        "NL": "EUR",
        "IE": "EUR",
        "PT": "EUR",
        "BE": "EUR",
        "AT": "EUR",
        "LU": "EUR",
        "FI": "EUR",
        "GR": "EUR",
        "JP": "JPY",
    }
    return mapping.get(code, "USD")


def _resolve_actor_or_error(
    req: func.HttpRequest,
    body: Dict[str, Any],
    cors: Dict[str, str],
) -> Tuple[Optional[CRMActor], Optional[func.HttpResponse]]:
    actor = resolve_actor_from_session(req, body)
    if not actor:
        return None, _error(
            cors=cors,
            status_code=401,
            message="CRM authentication required",
            code="auth_required",
        )
    return actor, None


def _is_primary_admin(actor: CRMActor) -> bool:
    return actor.role == "admin" and str(actor.scope or "").strip().lower() == "primary_user"


def _task_visible_for_actor(actor: CRMActor, item: Dict[str, Any]) -> bool:
    return can_view_task(actor.role, actor.email, item)


def _deal_visible_for_actor(actor: CRMActor, item: Dict[str, Any]) -> bool:
    if can_manage_all(actor.role):
        return True
    if actor.role == "member":
        return True
    owner_email = _normalize_email(item.get("ownerEmail"))
    if owner_email and owner_email == actor.email:
        return True
    watchers = _normalize_list(item.get("watchers"), lower=True)
    collaborators = _normalize_list(item.get("collaborators"), lower=True)
    return actor.email in watchers or actor.email in collaborators


def _contact_visible_for_actor(actor: CRMActor, item: Dict[str, Any]) -> bool:
    if can_manage_all(actor.role):
        return True
    owner_email = _normalize_email(item.get("ownerEmail"))
    return not owner_email or owner_email == actor.email


def _resolve_entity_for_comments(actor: CRMActor, entity_type: str, entity_id: str) -> Tuple[Optional[Dict[str, Any]], bool]:
    normalized_type = str(entity_type or "").strip().lower()
    normalized_id = str(entity_id or "").strip()
    if normalized_type == "task":
        item = get_entity("tasks", actor.tenant_id, normalized_id)
        return item, bool(item and _task_visible_for_actor(actor, item))
    if normalized_type == "deal":
        item = get_entity("deals", actor.tenant_id, normalized_id)
        return item, bool(item and _deal_visible_for_actor(actor, item))
    if normalized_type == "contact":
        item = get_entity("contacts", actor.tenant_id, normalized_id)
        return item, bool(item and _contact_visible_for_actor(actor, item))
    return None, False


def _match_common_search(item: Dict[str, Any], search: str) -> bool:
    if not search:
        return True
    needle = search.strip().lower()
    if not needle:
        return True
    text_fields = [
        item.get("title"),
        item.get("name"),
        item.get("description"),
        item.get("summary"),
        item.get("email"),
        item.get("company"),
    ]
    haystack = " ".join(str(value or "") for value in text_fields).lower()
    return needle in haystack


def _match_due_window(item: Dict[str, Any], due_before: str, due_after: str) -> bool:
    due = item.get("dueDate")
    if not due:
        return not due_after
    due_dt = _parse_datetime_utc(due)
    if due_dt is None:
        return False
    if due_before:
        cutoff = _parse_datetime_utc(due_before)
        if cutoff and due_dt > cutoff:
            return False
    if due_after:
        cutoff = _parse_datetime_utc(due_after)
        if cutoff and due_dt < cutoff:
            return False
    return True


def _match_created_window(item: Dict[str, Any], created_before: str, created_after: str) -> bool:
    if not created_before and not created_after:
        return True
    created_raw = item.get("createdAt") or item.get("updatedAt")
    if not created_raw:
        return False
    created_dt = _parse_datetime_utc(created_raw)
    if created_dt is None:
        return False
    if created_before:
        before_dt = _parse_datetime_utc(created_before)
        if before_dt and created_dt > before_dt:
            return False
    if created_after:
        after_dt = _parse_datetime_utc(created_after)
        if after_dt and created_dt < after_dt:
            return False
    return True


def _match_expected_close_window(item: Dict[str, Any], close_before: str, close_after: str) -> bool:
    if not close_before and not close_after:
        return True
    value = item.get("expectedCloseDate") or item.get("createdAt")
    if not value:
        return False
    target_dt = _parse_datetime_utc(value)
    if target_dt is None:
        return False
    if close_before:
        before_dt = _parse_datetime_utc(close_before)
        if before_dt and target_dt > before_dt:
            return False
    if close_after:
        after_dt = _parse_datetime_utc(close_after)
        if after_dt and target_dt < after_dt:
            return False
    return True


def _task_filter_fn(
    actor: CRMActor,
    req: func.HttpRequest,
    task_ids: Optional[set] = None,
):
    assignee = _normalize_email(req.params.get("assignee") or req.params.get("assignedToEmail"))
    status = str(req.params.get("status") or "").strip().lower()
    priority = str(req.params.get("priority") or "").strip().lower()
    tag = str(req.params.get("tag") or "").strip().lower()
    related_contact = str(req.params.get("contactId") or req.params.get("relatedContactId") or "").strip()
    related_deal = str(req.params.get("dealId") or req.params.get("relatedDealId") or "").strip()
    related_company = str(req.params.get("companyId") or req.params.get("relatedCompanyId") or "").strip()
    due_before = str(req.params.get("dueBefore") or "").strip()
    due_after = str(req.params.get("dueAfter") or "").strip()
    created_before = str(req.params.get("createdBefore") or "").strip()
    created_after = str(req.params.get("createdAfter") or "").strip()
    search = str(req.params.get("search") or req.params.get("q") or "").strip()
    include_archived = str(req.params.get("includeArchived") or "false").lower() in {"1", "true", "yes"}

    def _fn(item: Dict[str, Any]) -> bool:
        if task_ids is not None and str(item.get("id")) not in task_ids:
            return False
        if not include_archived and bool(item.get("archived")):
            return False
        if not _task_visible_for_actor(actor, item):
            return False
        if assignee and _normalize_email(item.get("assignedToEmail")) != assignee:
            return False
        if status and str(item.get("status") or "").strip().lower() != status:
            return False
        if priority and str(item.get("priority") or "").strip().lower() != priority:
            return False
        if tag:
            tags = _normalize_list(item.get("tags"), lower=True)
            if tag not in tags:
                return False
        if related_contact and str(item.get("relatedContactId") or "") != related_contact:
            return False
        if related_deal and str(item.get("relatedDealId") or "") != related_deal:
            return False
        if related_company and str(item.get("relatedCompanyId") or "") != related_company:
            return False
        if due_before or due_after:
            try:
                if not _match_due_window(item, due_before, due_after):
                    return False
            except ValueError:
                return False
        if created_before or created_after:
            if not _match_created_window(item, created_before, created_after):
                return False
        if not _match_common_search(item, search):
            return False
        return True

    return _fn


def _sanitize_task_payload(actor: CRMActor, payload: Dict[str, Any]) -> Dict[str, Any]:
    now = utc_now_iso()
    status = normalize_task_status(payload.get("status"))
    progress = clamp_progress(payload.get("progressPercent"))
    assigned_email = _normalize_email(payload.get("assignedToEmail") or payload.get("assignedTo"))
    watchers = _normalize_list(payload.get("watchers"), lower=True)
    tags = _normalize_list(payload.get("tags"))
    start_date_time = payload.get("startDateTime") or payload.get("startDate")
    end_date_time = payload.get("endDateTime") or payload.get("endDate") or payload.get("dueDate")
    task = {
        "title": str(payload.get("title") or "").strip(),
        "description": str(payload.get("description") or "").strip(),
        "status": status,
        "priority": str(payload.get("priority") or "med").strip().lower(),
        "progressPercent": progress,
        "startDateTime": start_date_time,
        "endDateTime": end_date_time,
        "dueDate": end_date_time,
        "createdByEmail": actor.email,
        "createdBy": actor.user_id or actor.client_user_id or actor.email,
        "assignedToEmail": assigned_email,
        "assignedTo": payload.get("assignedTo"),
        "watchers": watchers,
        "tags": tags,
        "dependencies": _normalize_list(payload.get("dependencies")),
        "attachments": _normalize_attachments(payload.get("attachments")),
        "relatedContactId": payload.get("relatedContactId"),
        "relatedDealId": payload.get("relatedDealId"),
        "relatedCompanyId": payload.get("relatedCompanyId"),
        "slaDueAt": payload.get("slaDueAt"),
        "timeLoggedMinutes": max(0, int(payload.get("timeLoggedMinutes") or 0)),
        "archived": status == "archived" or bool(payload.get("archived")),
        "createdAt": now,
        "updatedAt": now,
    }
    if status == "completed":
        task["completedAt"] = payload.get("completedAt") or now
    return task


def _task_patch_from_payload(before: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    patch: Dict[str, Any] = {}
    for field in TASK_MANAGER_MUTABLE_FIELDS:
        if field in payload:
            patch[field] = payload.get(field)
    if "assignedTo" in patch and "assignedToEmail" not in patch:
        patch["assignedToEmail"] = patch["assignedTo"]
    if "assignedToEmail" in patch:
        patch["assignedToEmail"] = _normalize_email(patch.get("assignedToEmail"))
    if "endDateTime" in patch and "dueDate" not in patch:
        patch["dueDate"] = patch.get("endDateTime")
    elif "dueDate" in patch and "endDateTime" not in patch:
        patch["endDateTime"] = patch.get("dueDate")
    if "status" in patch:
        patch["status"] = normalize_task_status(patch.get("status"))
    if "progressPercent" in patch:
        patch["progressPercent"] = clamp_progress(patch.get("progressPercent"))
    if "watchers" in patch:
        patch["watchers"] = _normalize_list(patch.get("watchers"), lower=True)
    if "tags" in patch:
        patch["tags"] = _normalize_list(patch.get("tags"))
    if "dependencies" in patch:
        patch["dependencies"] = _normalize_list(patch.get("dependencies"))
    if "attachments" in patch:
        patch["attachments"] = _normalize_attachments(patch.get("attachments"))
    if "timeLoggedMinutes" in patch:
        try:
            patch["timeLoggedMinutes"] = max(0, int(patch.get("timeLoggedMinutes") or 0))
        except (TypeError, ValueError):
            patch["timeLoggedMinutes"] = int(before.get("timeLoggedMinutes") or 0)
    patch["updatedAt"] = utc_now_iso()
    if patch.get("status") == "completed":
        patch["completedAt"] = patch.get("completedAt") or utc_now_iso()
    return patch


def _emit_task_assignment_notifications(actor: CRMActor, before: Dict[str, Any], after: Dict[str, Any]) -> None:
    before_assignee = _normalize_email(before.get("assignedToEmail"))
    after_assignee = _normalize_email(after.get("assignedToEmail"))
    task_id = str(after.get("id"))
    title = str(after.get("title") or "Task")
    if after_assignee and after_assignee != before_assignee:
        create_notification(
            actor.tenant_id,
            user_email=after_assignee,
            notif_type="task_assigned",
            title="New task assigned",
            message=f"You were assigned: {title}",
            entity_type="task",
            entity_id=task_id,
        )


def _emit_due_soon_notification(actor: CRMActor, task: Dict[str, Any]) -> None:
    assignee = _normalize_email(task.get("assignedToEmail"))
    due_raw = task.get("dueDate")
    if not assignee or not due_raw:
        return
    due_dt = _parse_datetime_utc(due_raw)
    if due_dt is None:
        return
    now = datetime.now(timezone.utc)
    if now <= due_dt <= now + timedelta(hours=48):
        create_notification(
            actor.tenant_id,
            user_email=assignee,
            notif_type="task_due_soon",
            title="Task due soon",
            message=f"Task '{task.get('title') or task.get('id')}' is due soon.",
            entity_type="task",
            entity_id=str(task.get("id")),
        )


def _resolve_task_manager_user_id(db, client_id: int, email: str) -> Optional[int]:
    normalized = _normalize_email(email)
    if not normalized:
        return None
    client = db.query(Client).filter_by(id=client_id).one_or_none()
    if not client:
        return None
    if _normalize_email(client.email) == normalized and client.user_id:
        return int(client.user_id)
    user = (
        db.query(User)
        .filter(sa_func.lower(sa_func.trim(User.email)) == normalized)
        .order_by(User.id.asc())
        .first()
    )
    if user and client.user_id and int(user.id) == int(client.user_id):
        return int(user.id)
    return None


def _sync_task_manager_item_from_crm(actor: CRMActor, task: Dict[str, Any]) -> None:
    task_id = str(task.get("id") or "").strip()
    if not task_id:
        return
    assignee = _normalize_email(task.get("assignedToEmail"))
    db = SessionLocal()
    try:
        existing = (
            db.query(TaskManagerItem)
            .filter(
                TaskManagerItem.client_id == actor.client_id,
                TaskManagerItem.source_type == "crm_task",
                TaskManagerItem.source_id == task_id,
            )
            .one_or_none()
        )
        if not assignee:
            if existing:
                db.delete(existing)
                db.commit()
            return

        start_dt = _parse_datetime_utc(task.get("startDateTime"))
        end_dt = _parse_datetime_utc(task.get("endDateTime") or task.get("dueDate"))
        if start_dt is None and end_dt is None:
            if existing and existing.start_time and existing.end_time:
                start_time = existing.start_time
                end_time = existing.end_time
            else:
                start_time = datetime.utcnow().replace(second=0, microsecond=0)
                end_time = start_time + timedelta(hours=1)
        else:
            if start_dt is None and end_dt is not None:
                start_dt = end_dt - timedelta(hours=1)
            if start_dt is not None and end_dt is None:
                end_dt = start_dt + timedelta(hours=1)
            if start_dt is None or end_dt is None:
                start_dt = datetime.utcnow().replace(second=0, microsecond=0, tzinfo=timezone.utc)
                end_dt = start_dt + timedelta(hours=1)
            start_time = start_dt.astimezone(timezone.utc).replace(tzinfo=None)
            end_time = end_dt.astimezone(timezone.utc).replace(tzinfo=None)
            if end_time <= start_time:
                end_time = start_time + timedelta(hours=1)

        payload = {
            "user_id": _resolve_task_manager_user_id(db, actor.client_id, assignee),
            "owner_email": assignee,
            "title": str(task.get("title") or "CRM Task").strip(),
            "description": str(task.get("description") or "").strip() or None,
            "start_time": start_time,
            "end_time": end_time,
            "status": str(task.get("status") or "scheduled").strip().lower() or "scheduled",
        }
        if existing:
            existing.user_id = payload["user_id"]
            existing.owner_email = payload["owner_email"]
            existing.title = payload["title"]
            existing.description = payload["description"]
            existing.start_time = payload["start_time"]
            existing.end_time = payload["end_time"]
            existing.status = payload["status"]
            db.add(existing)
        else:
            db.add(
                TaskManagerItem(
                    client_id=actor.client_id,
                    source_type="crm_task",
                    source_id=task_id,
                    **payload,
                )
            )
        db.commit()
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.warning("Failed to sync CRM task %s into task manager: %s", task_id, exc)
    finally:
        db.close()


def _delete_task_manager_item_for_crm(actor: CRMActor, task_id: str) -> None:
    normalized_task_id = str(task_id or "").strip()
    if not normalized_task_id:
        return
    db = SessionLocal()
    try:
        (
            db.query(TaskManagerItem)
            .filter(
                TaskManagerItem.client_id == actor.client_id,
                TaskManagerItem.source_type == "crm_task",
                TaskManagerItem.source_id == normalized_task_id,
            )
            .delete(synchronize_session=False)
        )
        db.commit()
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.warning("Failed to remove synced task manager item for CRM task %s: %s", normalized_task_id, exc)
    finally:
        db.close()


@app.function_name(name="CrmTasks")
@app.route(route="crm/tasks", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_tasks(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    if req.method == "GET":
        assignee = _normalize_email(req.params.get("assignee") or req.params.get("assignedToEmail"))
        status = str(req.params.get("status") or "").strip().lower()
        task_ids = lookup_task_ids_by_index(actor.tenant_id, assignee_email=assignee or None, status=status or None)
        items, next_cursor = list_entities(
            "tasks",
            actor.tenant_id,
            limit=_get_limit(req, default=50),
            cursor=req.params.get("cursor"),
            filter_fn=_task_filter_fn(actor, req, task_ids=task_ids),
            descending=True,
        )
        return _json({"items": items, "nextCursor": next_cursor}, status_code=200, cors=cors)

    if not can_create_task(actor.role):
        return _error(cors=cors, status_code=403, message="Task creation is not permitted", code="forbidden")
    title = str(body.get("title") or "").strip()
    if not title:
        return _error(cors=cors, status_code=400, message="title is required", code="validation_error")

    task = _sanitize_task_payload(actor, body)
    task["title"] = title
    created = create_entity("tasks", actor.tenant_id, task)
    upsert_task_indexes(actor.tenant_id, created)
    write_audit_event(
        actor.tenant_id,
        actor_email=actor.email,
        actor_user_id=actor.user_id or actor.client_user_id,
        actor_role=actor.role,
        entity_type="task",
        entity_id=str(created.get("id")),
        action="task_created",
        before=None,
        after=created,
    )
    _emit_task_assignment_notifications(actor, {}, created)
    _emit_due_soon_notification(actor, created)
    _sync_task_manager_item_from_crm(actor, created)
    return _json({"item": created}, status_code=201, cors=cors)


@app.function_name(name="CrmTaskDetail")
@app.route(route="crm/tasks/{task_id}", methods=["GET", "PATCH", "DELETE", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_task_detail(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "PATCH", "DELETE", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    task_id = str(req.route_params.get("task_id") or "").strip()
    if not task_id:
        return _error(cors=cors, status_code=400, message="task id is required", code="validation_error")
    before = get_entity("tasks", actor.tenant_id, task_id)
    if not before:
        return _error(cors=cors, status_code=404, message="task not found", code="not_found")
    if not _task_visible_for_actor(actor, before):
        return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")

    if req.method == "GET":
        timeline = list_timeline_items(actor.tenant_id, entity_type="task", entity_id=task_id, limit=100)
        return _json({"item": before, "timeline": timeline}, status_code=200, cors=cors)

    if req.method == "DELETE":
        if not can_manage_all(actor.role):
            return _error(cors=cors, status_code=403, message="Only admin/manager can delete tasks", code="forbidden")
        remove_task_indexes(actor.tenant_id, before)
        deleted = delete_entity("tasks", actor.tenant_id, task_id)
        if deleted:
            _delete_task_manager_item_for_crm(actor, task_id)
        if deleted:
            write_audit_event(
                actor.tenant_id,
                actor_email=actor.email,
                actor_user_id=actor.user_id or actor.client_user_id,
                actor_role=actor.role,
                entity_type="task",
                entity_id=task_id,
                action="task_deleted",
                before=before,
                after=None,
            )
        return _json({"deleted": bool(deleted)}, status_code=200, cors=cors)

    updates = _task_patch_from_payload(before, body)
    if not updates:
        return _error(cors=cors, status_code=400, message="no valid fields to update", code="validation_error")
    allowed, reason = can_patch_task(actor.role, actor.email, before, updates)
    if not allowed:
        return _error(cors=cors, status_code=403, message="forbidden", code=reason or "forbidden")

    after = upsert_entity("tasks", actor.tenant_id, task_id, updates)
    if (
        _normalize_email(before.get("assignedToEmail")) != _normalize_email(after.get("assignedToEmail"))
        or str(before.get("status") or "").lower() != str(after.get("status") or "").lower()
    ):
        remove_task_indexes(actor.tenant_id, before)
    upsert_task_indexes(actor.tenant_id, after)
    write_audit_event(
        actor.tenant_id,
        actor_email=actor.email,
        actor_user_id=actor.user_id or actor.client_user_id,
        actor_role=actor.role,
        entity_type="task",
        entity_id=task_id,
        action="task_updated",
        before=before,
        after=after,
    )
    _emit_task_assignment_notifications(actor, before, after)
    if str(before.get("status") or "").lower() != str(after.get("status") or "").lower():
        assignee = _normalize_email(after.get("assignedToEmail"))
        if assignee:
            create_notification(
                actor.tenant_id,
                user_email=assignee,
                notif_type="task_status_changed",
                title="Task status updated",
                message=f"Task '{after.get('title')}' moved to {after.get('status')}.",
                entity_type="task",
                entity_id=task_id,
            )
    _emit_due_soon_notification(actor, after)
    _sync_task_manager_item_from_crm(actor, after)
    return _json({"item": after}, status_code=200, cors=cors)


@app.function_name(name="CrmTaskComments")
@app.route(route="crm/tasks/{task_id}/comments", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_task_comments(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    task_id = str(req.route_params.get("task_id") or "").strip()
    return _handle_entity_comments(
        req=req,
        actor=actor,
        cors=cors,
        body=body,
        entity_type="task",
        entity_id=task_id,
    )


def _handle_entity_comments(
    *,
    req: func.HttpRequest,
    actor: CRMActor,
    cors: Dict[str, str],
    body: Dict[str, Any],
    entity_type: str,
    entity_id: str,
) -> func.HttpResponse:
    normalized_type = str(entity_type or "").strip().lower()
    normalized_id = str(entity_id or "").strip()
    if normalized_type not in {"task", "deal", "contact"} or not normalized_id:
        return _error(
            cors=cors,
            status_code=400,
            message="entityType and entityId are required",
            code="validation_error",
        )
    entity, allowed = _resolve_entity_for_comments(actor, normalized_type, normalized_id)
    if not entity:
        return _error(cors=cors, status_code=404, message=f"{normalized_type} not found", code="not_found")
    if not allowed:
        return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")

    if req.method == "GET":
        comments, next_cursor = list_entities(
            "comments",
            actor.tenant_id,
            limit=_get_limit(req, default=50),
            cursor=req.params.get("cursor"),
            filter_fn=lambda item: str(item.get("entityType") or "").lower() == normalized_type
            and str(item.get("entityId") or "") == normalized_id,
            descending=False,
        )
        return _json({"items": comments, "nextCursor": next_cursor}, status_code=200, cors=cors)

    text = str(body.get("text") or body.get("body") or "").strip()
    if not text:
        return _error(cors=cors, status_code=400, message="comment text is required", code="validation_error")
    mentions = list(dict.fromkeys(_normalize_list(body.get("mentions"), lower=True)))
    parent_comment_id = str(body.get("parentCommentId") or "").strip()
    if parent_comment_id:
        parent_comment = get_entity("comments", actor.tenant_id, parent_comment_id)
        if not parent_comment:
            return _error(cors=cors, status_code=404, message="parent comment not found", code="not_found")
        if (
            str(parent_comment.get("entityType") or "").lower() != normalized_type
            or str(parent_comment.get("entityId") or "") != normalized_id
        ):
            return _error(
                cors=cors,
                status_code=400,
                message="parent comment belongs to a different entity",
                code="validation_error",
            )
    payload = {
        "entityType": normalized_type,
        "entityId": normalized_id,
        "parentCommentId": parent_comment_id or None,
        "text": text,
        "mentions": mentions,
        "createdByEmail": actor.email,
        "createdBy": actor.user_id or actor.client_user_id or actor.email,
        "createdAt": utc_now_iso(),
        "updatedAt": utc_now_iso(),
    }
    created = create_entity("comments", actor.tenant_id, payload)
    write_audit_event(
        actor.tenant_id,
        actor_email=actor.email,
        actor_user_id=actor.user_id or actor.client_user_id,
        actor_role=actor.role,
        entity_type=normalized_type,
        entity_id=normalized_id,
        action=f"{normalized_type}_comment_added",
        before=None,
        after=created,
    )
    entity_name = str(entity.get("title") or entity.get("name") or normalized_id)
    for mentioned in mentions:
        create_notification(
            actor.tenant_id,
            user_email=mentioned,
            notif_type="mention",
            title="You were mentioned",
            message=f"{actor.email} mentioned you on {normalized_type} '{entity_name}'.",
            entity_type=normalized_type,
            entity_id=normalized_id,
        )
    return _json({"item": created}, status_code=201, cors=cors)


@app.function_name(name="CrmDealComments")
@app.route(route="crm/deals/{deal_id}/comments", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_deal_comments(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor
    deal_id = str(req.route_params.get("deal_id") or "").strip()
    return _handle_entity_comments(
        req=req,
        actor=actor,
        cors=cors,
        body=body,
        entity_type="deal",
        entity_id=deal_id,
    )


@app.function_name(name="CrmContactComments")
@app.route(route="crm/contacts/{contact_id}/comments", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_contact_comments(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor
    contact_id = str(req.route_params.get("contact_id") or "").strip()
    return _handle_entity_comments(
        req=req,
        actor=actor,
        cors=cors,
        body=body,
        entity_type="contact",
        entity_id=contact_id,
    )


@app.function_name(name="CrmComments")
@app.route(route="crm/comments", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_comments(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    if req.method == "POST":
        entity_type = str(body.get("entityType") or "").strip().lower()
        entity_id = str(body.get("entityId") or "").strip()
        return _handle_entity_comments(
            req=req,
            actor=actor,
            cors=cors,
            body=body,
            entity_type=entity_type,
            entity_id=entity_id,
        )

    entity_type = str(req.params.get("entityType") or "").strip().lower()
    entity_id = str(req.params.get("entityId") or "").strip()
    limit = _get_limit(req, default=50)
    cursor = req.params.get("cursor")

    def _filter(item: Dict[str, Any]) -> bool:
        comment_entity_type = str(item.get("entityType") or "").strip().lower()
        comment_entity_id = str(item.get("entityId") or "").strip()
        if entity_type and comment_entity_type != entity_type:
            return False
        if entity_id and comment_entity_id != entity_id:
            return False
        _, allowed = _resolve_entity_for_comments(actor, comment_entity_type, comment_entity_id)
        return allowed

    items, next_cursor = list_entities(
        "comments",
        actor.tenant_id,
        limit=limit,
        cursor=cursor,
        filter_fn=_filter,
        descending=True,
    )
    return _json({"items": items, "nextCursor": next_cursor}, status_code=200, cors=cors)


@app.function_name(name="CrmCommentDetail")
@app.route(route="crm/comments/{comment_id}", methods=["GET", "PATCH", "DELETE", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_comment_detail(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "PATCH", "DELETE", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    comment_id = str(req.route_params.get("comment_id") or "").strip()
    if not comment_id:
        return _error(cors=cors, status_code=400, message="comment id is required", code="validation_error")
    before = get_entity("comments", actor.tenant_id, comment_id)
    if not before:
        return _error(cors=cors, status_code=404, message="comment not found", code="not_found")
    entity_type = str(before.get("entityType") or "").strip().lower()
    entity_id = str(before.get("entityId") or "").strip()
    _, allowed = _resolve_entity_for_comments(actor, entity_type, entity_id)
    if not allowed:
        return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")

    if req.method == "GET":
        return _json({"item": before}, status_code=200, cors=cors)

    is_author = _normalize_email(before.get("createdByEmail")) == actor.email
    if req.method == "DELETE":
        if not (is_author or can_manage_all(actor.role)):
            return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")
        deleted = delete_entity("comments", actor.tenant_id, comment_id)
        if deleted:
            write_audit_event(
                actor.tenant_id,
                actor_email=actor.email,
                actor_user_id=actor.user_id or actor.client_user_id,
                actor_role=actor.role,
                entity_type=entity_type,
                entity_id=entity_id,
                action=f"{entity_type}_comment_deleted",
                before=before,
                after=None,
            )
        return _json({"deleted": bool(deleted)}, status_code=200, cors=cors)

    if not (is_author or can_manage_all(actor.role)):
        return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")
    text = str(body.get("text") or body.get("body") or "").strip()
    if not text:
        return _error(cors=cors, status_code=400, message="comment text is required", code="validation_error")
    updates = {
        "text": text,
        "mentions": _normalize_list(body.get("mentions"), lower=True) if "mentions" in body else before.get("mentions", []),
        "edited": True,
        "editedAt": utc_now_iso(),
        "editedByEmail": actor.email,
    }
    after = upsert_entity("comments", actor.tenant_id, comment_id, updates)
    write_audit_event(
        actor.tenant_id,
        actor_email=actor.email,
        actor_user_id=actor.user_id or actor.client_user_id,
        actor_role=actor.role,
        entity_type=entity_type,
        entity_id=entity_id,
        action=f"{entity_type}_comment_updated",
        before=before,
        after=after,
    )
    return _json({"item": after}, status_code=200, cors=cors)


def _generic_read_list(
    *,
    table_key: str,
    req: func.HttpRequest,
    actor: CRMActor,
    visibility_fn,
    cors: Dict[str, str],
    extra_match=None,
) -> func.HttpResponse:
    cursor = req.params.get("cursor")
    limit = _get_limit(req, default=50)
    search = str(req.params.get("search") or req.params.get("q") or "").strip()

    def _filter(item: Dict[str, Any]) -> bool:
        if not visibility_fn(actor, item):
            return False
        if search and not _match_common_search(item, search):
            return False
        if extra_match and not extra_match(item):
            return False
        return True

    items, next_cursor = list_entities(
        table_key,
        actor.tenant_id,
        limit=limit,
        cursor=cursor,
        filter_fn=_filter,
        descending=True,
    )
    return _json({"items": items, "nextCursor": next_cursor}, status_code=200, cors=cors)


@app.function_name(name="CrmDeals")
@app.route(route="crm/deals", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_deals(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    if req.method == "GET":
        stage = str(req.params.get("stage") or "").strip().lower()
        owner_email = _normalize_email(req.params.get("owner") or req.params.get("ownerEmail"))
        created_before = str(req.params.get("createdBefore") or "").strip()
        created_after = str(req.params.get("createdAfter") or "").strip()
        close_before = str(req.params.get("expectedCloseBefore") or req.params.get("closeBefore") or "").strip()
        close_after = str(req.params.get("expectedCloseAfter") or req.params.get("closeAfter") or "").strip()
        return _generic_read_list(
            table_key="deals",
            req=req,
            actor=actor,
            visibility_fn=_deal_visible_for_actor,
            cors=cors,
            extra_match=lambda item: (
                (not stage or str(item.get("stage") or "").strip().lower() == stage)
                and (not owner_email or _normalize_email(item.get("ownerEmail")) == owner_email)
                and _match_created_window(item, created_before, created_after)
                and _match_expected_close_window(item, close_before, close_after)
            ),
        )

    if not can_create_deal(actor.role):
        return _error(cors=cors, status_code=403, message="Deal creation is not permitted", code="forbidden")

    name = str(body.get("name") or "").strip()
    if not name:
        return _error(cors=cors, status_code=400, message="deal name is required", code="validation_error")
    owner_email = _normalize_email(body.get("ownerEmail") or body.get("owner"))
    country_code = _resolve_country_code(req, body)
    currency = _currency_for_country(country_code)
    deal = {
        "name": name,
        "description": str(body.get("description") or "").strip(),
        "stage": str(body.get("stage") or "lead").strip().lower(),
        "value": float(body.get("value") or 0),
        "currency": currency,
        "countryCode": country_code,
        "expectedCloseDate": body.get("expectedCloseDate"),
        "ownerEmail": owner_email or actor.email,
        "watchers": _normalize_list(body.get("watchers"), lower=True),
        "collaborators": _normalize_list(body.get("collaborators"), lower=True),
        "contactIds": _normalize_list(body.get("contactIds")),
        "companyId": body.get("companyId"),
        "nextAction": body.get("nextAction"),
        "createdByEmail": actor.email,
        "createdAt": utc_now_iso(),
        "updatedAt": utc_now_iso(),
    }
    created = create_entity("deals", actor.tenant_id, deal)
    write_audit_event(
        actor.tenant_id,
        actor_email=actor.email,
        actor_user_id=actor.user_id or actor.client_user_id,
        actor_role=actor.role,
        entity_type="deal",
        entity_id=str(created.get("id")),
        action="deal_created",
        before=None,
        after=created,
    )
    return _json({"item": created}, status_code=201, cors=cors)


@app.function_name(name="CrmDealDetail")
@app.route(route="crm/deals/{deal_id}", methods=["GET", "PATCH", "DELETE", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_deal_detail(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "PATCH", "DELETE", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    deal_id = str(req.route_params.get("deal_id") or "").strip()
    if not deal_id:
        return _error(cors=cors, status_code=400, message="deal id is required", code="validation_error")
    before = get_entity("deals", actor.tenant_id, deal_id)
    if not before:
        return _error(cors=cors, status_code=404, message="deal not found", code="not_found")
    if not _deal_visible_for_actor(actor, before):
        return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")

    if req.method == "GET":
        timeline = list_timeline_items(actor.tenant_id, entity_type="deal", entity_id=deal_id, limit=100)
        return _json({"item": before, "timeline": timeline}, status_code=200, cors=cors)

    if req.method == "DELETE":
        if not can_manage_all(actor.role):
            return _error(cors=cors, status_code=403, message="Only admin/manager can delete deals", code="forbidden")
        deleted = delete_entity("deals", actor.tenant_id, deal_id)
        if deleted:
            write_audit_event(
                actor.tenant_id,
                actor_email=actor.email,
                actor_user_id=actor.user_id or actor.client_user_id,
                actor_role=actor.role,
                entity_type="deal",
                entity_id=deal_id,
                action="deal_deleted",
                before=before,
                after=None,
            )
        return _json({"deleted": bool(deleted)}, status_code=200, cors=cors)

    allowed_fields = {
        "name",
        "description",
        "stage",
        "value",
        "expectedCloseDate",
        "ownerEmail",
        "watchers",
        "collaborators",
        "contactIds",
        "companyId",
        "nextAction",
        "notes",
    }
    updates = {key: body.get(key) for key in allowed_fields if key in body}
    if not updates:
        return _error(cors=cors, status_code=400, message="no valid fields to update", code="validation_error")
    if "ownerEmail" in updates:
        updates["ownerEmail"] = _normalize_email(updates.get("ownerEmail"))
    if "watchers" in updates:
        updates["watchers"] = _normalize_list(updates.get("watchers"), lower=True)
    if "collaborators" in updates:
        updates["collaborators"] = _normalize_list(updates.get("collaborators"), lower=True)
    if "contactIds" in updates:
        updates["contactIds"] = _normalize_list(updates.get("contactIds"))
    updates["updatedAt"] = utc_now_iso()
    after = upsert_entity("deals", actor.tenant_id, deal_id, updates)
    write_audit_event(
        actor.tenant_id,
        actor_email=actor.email,
        actor_user_id=actor.user_id or actor.client_user_id,
        actor_role=actor.role,
        entity_type="deal",
        entity_id=deal_id,
        action="deal_updated",
        before=before,
        after=after,
    )
    return _json({"item": after}, status_code=200, cors=cors)


@app.function_name(name="CrmCompanies")
@app.route(route="crm/companies", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_companies(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    if req.method == "GET":
        return _generic_read_list(
            table_key="companies",
            req=req,
            actor=actor,
            visibility_fn=lambda _actor, _item: True,
            cors=cors,
        )

    if not can_manage_all(actor.role):
        return _error(cors=cors, status_code=403, message="Only admin/manager can create companies", code="forbidden")

    name = str(body.get("name") or "").strip()
    if not name:
        return _error(cors=cors, status_code=400, message="company name is required", code="validation_error")
    company = {
        "name": name,
        "domain": str(body.get("domain") or "").strip().lower(),
        "industry": str(body.get("industry") or "").strip(),
        "size": str(body.get("size") or "").strip(),
        "ownerEmail": _normalize_email(body.get("ownerEmail")) or actor.email,
        "tags": _normalize_list(body.get("tags")),
        "createdByEmail": actor.email,
        "createdAt": utc_now_iso(),
        "updatedAt": utc_now_iso(),
    }
    created = create_entity("companies", actor.tenant_id, company)
    write_audit_event(
        actor.tenant_id,
        actor_email=actor.email,
        actor_user_id=actor.user_id or actor.client_user_id,
        actor_role=actor.role,
        entity_type="company",
        entity_id=str(created.get("id")),
        action="company_created",
        before=None,
        after=created,
    )
    return _json({"item": created}, status_code=201, cors=cors)


@app.function_name(name="CrmCompanyDetail")
@app.route(route="crm/companies/{company_id}", methods=["GET", "PATCH", "DELETE", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_company_detail(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "PATCH", "DELETE", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    company_id = str(req.route_params.get("company_id") or "").strip()
    before = get_entity("companies", actor.tenant_id, company_id)
    if not before:
        return _error(cors=cors, status_code=404, message="company not found", code="not_found")
    if req.method == "GET":
        return _json({"item": before}, status_code=200, cors=cors)
    if not can_manage_all(actor.role):
        return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")

    if req.method == "DELETE":
        deleted = delete_entity("companies", actor.tenant_id, company_id)
        if deleted:
            write_audit_event(
                actor.tenant_id,
                actor_email=actor.email,
                actor_user_id=actor.user_id or actor.client_user_id,
                actor_role=actor.role,
                entity_type="company",
                entity_id=company_id,
                action="company_deleted",
                before=before,
                after=None,
            )
        return _json({"deleted": bool(deleted)}, status_code=200, cors=cors)

    allowed = {"name", "domain", "industry", "size", "ownerEmail", "tags"}
    updates = {key: body.get(key) for key in allowed if key in body}
    if "ownerEmail" in updates:
        updates["ownerEmail"] = _normalize_email(updates.get("ownerEmail"))
    if "tags" in updates:
        updates["tags"] = _normalize_list(updates.get("tags"))
    updates["updatedAt"] = utc_now_iso()
    after = upsert_entity("companies", actor.tenant_id, company_id, updates)
    write_audit_event(
        actor.tenant_id,
        actor_email=actor.email,
        actor_user_id=actor.user_id or actor.client_user_id,
        actor_role=actor.role,
        entity_type="company",
        entity_id=company_id,
        action="company_updated",
        before=before,
        after=after,
    )
    return _json({"item": after}, status_code=200, cors=cors)


@app.function_name(name="CrmContacts")
@app.route(route="crm/contacts", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_contacts(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    if req.method == "GET":
        lifecycle = str(req.params.get("lifecycleStage") or "").strip().lower()
        lead_source = str(req.params.get("leadSource") or "").strip().lower()
        company_id = str(req.params.get("companyId") or "").strip()
        tag = str(req.params.get("tag") or "").strip().lower()
        return _generic_read_list(
            table_key="contacts",
            req=req,
            actor=actor,
            visibility_fn=_contact_visible_for_actor,
            cors=cors,
            extra_match=lambda item: (
                (not lifecycle or str(item.get("lifecycleStage") or "").strip().lower() == lifecycle)
                and (not lead_source or str(item.get("leadSource") or "").strip().lower() == lead_source)
                and (not company_id or str(item.get("companyId") or "") == company_id)
                and (not tag or tag in _normalize_list(item.get("tags"), lower=True))
            ),
        )

    if not can_create_contact(actor.role):
        return _error(cors=cors, status_code=403, message="Contact creation is not permitted", code="forbidden")

    name = str(body.get("name") or "").strip()
    if not name:
        return _error(cors=cors, status_code=400, message="contact name is required", code="validation_error")
    item = {
        "name": name,
        "email": _normalize_email(body.get("email")),
        "phone": str(body.get("phone") or "").strip(),
        "companyId": body.get("companyId"),
        "company": str(body.get("company") or "").strip(),
        "tags": _normalize_list(body.get("tags")),
        "leadSource": str(body.get("leadSource") or "manual").strip().lower(),
        "lifecycleStage": str(body.get("lifecycleStage") or "lead").strip().lower(),
        "ownerEmail": _normalize_email(body.get("ownerEmail")) or actor.email,
        "externalContactId": body.get("externalContactId"),
        "createdByEmail": actor.email,
        "createdAt": utc_now_iso(),
        "updatedAt": utc_now_iso(),
    }
    created = create_entity("contacts", actor.tenant_id, item)
    write_audit_event(
        actor.tenant_id,
        actor_email=actor.email,
        actor_user_id=actor.user_id or actor.client_user_id,
        actor_role=actor.role,
        entity_type="contact",
        entity_id=str(created.get("id")),
        action="contact_created",
        before=None,
        after=created,
    )
    return _json({"item": created}, status_code=201, cors=cors)


@app.function_name(name="CrmContactDetail")
@app.route(route="crm/contacts/{contact_id}", methods=["GET", "PATCH", "DELETE", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_contact_detail(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "PATCH", "DELETE", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    contact_id = str(req.route_params.get("contact_id") or "").strip()
    before = get_entity("contacts", actor.tenant_id, contact_id)
    if not before:
        return _error(cors=cors, status_code=404, message="contact not found", code="not_found")
    if not _contact_visible_for_actor(actor, before):
        return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")

    if req.method == "GET":
        related_tasks, _ = list_entities(
            "tasks",
            actor.tenant_id,
            limit=100,
            filter_fn=lambda item: str(item.get("relatedContactId") or "") == contact_id and _task_visible_for_actor(actor, item),
            descending=True,
        )
        related_deals, _ = list_entities(
            "deals",
            actor.tenant_id,
            limit=100,
            filter_fn=lambda item: contact_id in _normalize_list(item.get("contactIds"))
            or str(item.get("primaryContactId") or "") == contact_id,
            descending=True,
        )
        email_links, _ = list_entities(
            "email_links",
            actor.tenant_id,
            limit=100,
            filter_fn=lambda item: str(item.get("entityType") or "").lower() == "contact"
            and str(item.get("entityId") or "") == contact_id,
            descending=True,
        )
        return _json(
            {"item": before, "relatedTasks": related_tasks, "relatedDeals": related_deals, "emailLinks": email_links},
            status_code=200,
            cors=cors,
        )

    if req.method == "DELETE":
        if not can_manage_all(actor.role):
            return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")
        deleted = delete_entity("contacts", actor.tenant_id, contact_id)
        if deleted:
            write_audit_event(
                actor.tenant_id,
                actor_email=actor.email,
                actor_user_id=actor.user_id or actor.client_user_id,
                actor_role=actor.role,
                entity_type="contact",
                entity_id=contact_id,
                action="contact_deleted",
                before=before,
                after=None,
            )
        return _json({"deleted": bool(deleted)}, status_code=200, cors=cors)

    if can_manage_all(actor.role):
        allowed = {
            "name",
            "email",
            "phone",
            "company",
            "companyId",
            "tags",
            "leadSource",
            "lifecycleStage",
            "ownerEmail",
        }
    else:
        allowed = {"tags", "lifecycleStage"}
    updates = {key: body.get(key) for key in allowed if key in body}
    if not updates:
        return _error(cors=cors, status_code=400, message="no valid fields to update", code="validation_error")
    if "email" in updates:
        updates["email"] = _normalize_email(updates.get("email"))
    if "ownerEmail" in updates:
        updates["ownerEmail"] = _normalize_email(updates.get("ownerEmail"))
    if "tags" in updates:
        updates["tags"] = _normalize_list(updates.get("tags"))
    updates["updatedAt"] = utc_now_iso()
    after = upsert_entity("contacts", actor.tenant_id, contact_id, updates)
    write_audit_event(
        actor.tenant_id,
        actor_email=actor.email,
        actor_user_id=actor.user_id or actor.client_user_id,
        actor_role=actor.role,
        entity_type="contact",
        entity_id=contact_id,
        action="contact_updated",
        before=before,
        after=after,
    )
    return _json({"item": after}, status_code=200, cors=cors)


@app.function_name(name="CrmActivities")
@app.route(route="crm/activities", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_activities(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    if req.method == "GET":
        entity_type = str(req.params.get("entityType") or "").strip().lower()
        entity_id = str(req.params.get("entityId") or "").strip()
        items, next_cursor = list_entities(
            "activities",
            actor.tenant_id,
            limit=_get_limit(req, default=50),
            cursor=req.params.get("cursor"),
            filter_fn=lambda item: (
                (not entity_type or str(item.get("entityType") or "").strip().lower() == entity_type)
                and (not entity_id or str(item.get("entityId") or "") == entity_id)
            ),
            descending=True,
        )
        return _json({"items": items, "nextCursor": next_cursor}, status_code=200, cors=cors)

    if not can_manage_all(actor.role):
        return _error(cors=cors, status_code=403, message="Only admin/manager can log activities", code="forbidden")
    activity_type = str(body.get("type") or "").strip().lower()
    if activity_type not in {"call", "email", "meeting", "note", "status"}:
        return _error(cors=cors, status_code=400, message="invalid activity type", code="validation_error")
    item = {
        "type": activity_type,
        "entityType": str(body.get("entityType") or "").strip().lower(),
        "entityId": str(body.get("entityId") or "").strip(),
        "title": str(body.get("title") or "").strip(),
        "description": str(body.get("description") or "").strip(),
        "metadata": body.get("metadata") if isinstance(body.get("metadata"), dict) else {},
        "createdByEmail": actor.email,
        "createdAt": utc_now_iso(),
        "updatedAt": utc_now_iso(),
    }
    created = create_entity("activities", actor.tenant_id, item)
    write_audit_event(
        actor.tenant_id,
        actor_email=actor.email,
        actor_user_id=actor.user_id or actor.client_user_id,
        actor_role=actor.role,
        entity_type=item.get("entityType") or "activity",
        entity_id=item.get("entityId") or str(created.get("id")),
        action="activity_created",
        before=None,
        after=created,
    )
    return _json({"item": created}, status_code=201, cors=cors)


@app.function_name(name="CrmEmailLinks")
@app.route(route="crm/email-links", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_email_links(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor

    if req.method == "GET":
        entity_type = str(req.params.get("entityType") or "").strip().lower()
        entity_id = str(req.params.get("entityId") or "").strip()
        items, next_cursor = list_entities(
            "email_links",
            actor.tenant_id,
            limit=_get_limit(req, default=50),
            cursor=req.params.get("cursor"),
            filter_fn=lambda item: (
                (not entity_type or str(item.get("entityType") or "").strip().lower() == entity_type)
                and (not entity_id or str(item.get("entityId") or "") == entity_id)
            ),
            descending=True,
        )
        return _json({"items": items, "nextCursor": next_cursor}, status_code=200, cors=cors)

    entity_type = str(body.get("entityType") or "").strip().lower()
    entity_id = str(body.get("entityId") or "").strip()
    if entity_type not in {"task", "deal", "contact"} or not entity_id:
        return _error(cors=cors, status_code=400, message="entityType and entityId are required", code="validation_error")
    if entity_type == "task":
        entity = get_entity("tasks", actor.tenant_id, entity_id)
        if not entity or not _task_visible_for_actor(actor, entity):
            return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")
    if entity_type == "deal":
        entity = get_entity("deals", actor.tenant_id, entity_id)
        if not entity or not _deal_visible_for_actor(actor, entity):
            return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")
    if entity_type == "contact":
        entity = get_entity("contacts", actor.tenant_id, entity_id)
        if not entity or not _contact_visible_for_actor(actor, entity):
            return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")

    link = {
        "entityType": entity_type,
        "entityId": entity_id,
        "provider": str(body.get("provider") or "gmail").strip().lower(),
        "threadId": str(body.get("threadId") or "").strip(),
        "messageId": str(body.get("messageId") or "").strip(),
        "subject": str(body.get("subject") or "").strip(),
        "snippet": str(body.get("snippet") or "").strip(),
        "linkedByEmail": actor.email,
        "linkedAt": utc_now_iso(),
    }
    created = create_entity("email_links", actor.tenant_id, link)
    write_audit_event(
        actor.tenant_id,
        actor_email=actor.email,
        actor_user_id=actor.user_id or actor.client_user_id,
        actor_role=actor.role,
        entity_type=entity_type,
        entity_id=entity_id,
        action="email_linked",
        before=None,
        after=created,
    )
    return _json({"item": created}, status_code=201, cors=cors)


@app.function_name(name="CrmNotifications")
@app.route(route="crm/notifications", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_notifications(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    actor, auth_error = _resolve_actor_or_error(req, {}, cors)
    if auth_error:
        return auth_error
    assert actor
    include_all = str(req.params.get("all") or "").lower() in {"1", "true", "yes"}

    def _filter(item: Dict[str, Any]) -> bool:
        if include_all and can_manage_all(actor.role):
            return True
        return _normalize_email(item.get("userEmail")) == actor.email

    items, next_cursor = list_entities(
        "notifications",
        actor.tenant_id,
        limit=_get_limit(req, default=50),
        cursor=req.params.get("cursor"),
        filter_fn=_filter,
        descending=True,
    )
    return _json({"items": items, "nextCursor": next_cursor}, status_code=200, cors=cors)


@app.function_name(name="CrmNotificationRead")
@app.route(route="crm/notifications/{notif_id}/read", methods=["PATCH", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_notification_read(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["PATCH", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    body = _parse_body(req)
    actor, auth_error = _resolve_actor_or_error(req, body, cors)
    if auth_error:
        return auth_error
    assert actor
    notif_id = str(req.route_params.get("notif_id") or "").strip()
    before = get_entity("notifications", actor.tenant_id, notif_id)
    if not before:
        return _error(cors=cors, status_code=404, message="notification not found", code="not_found")
    owner_email = _normalize_email(before.get("userEmail"))
    if owner_email != actor.email and not can_manage_all(actor.role):
        return _error(cors=cors, status_code=403, message="forbidden", code="forbidden")
    after = upsert_entity("notifications", actor.tenant_id, notif_id, {"read": True, "readAt": utc_now_iso()})
    return _json({"item": after}, status_code=200, cors=cors)


@app.function_name(name="CrmAudit")
@app.route(route="crm/audit", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_audit(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    actor, auth_error = _resolve_actor_or_error(req, {}, cors)
    if auth_error:
        return auth_error
    assert actor
    if not can_manage_all(actor.role):
        return _json({"items": [], "nextCursor": None}, status_code=200, cors=cors)
    entity_type = str(req.params.get("entityType") or "").strip().lower()
    entity_id = str(req.params.get("entityId") or "").strip()
    items, next_cursor = list_entities(
        "audit",
        actor.tenant_id,
        limit=_get_limit(req, default=100),
        cursor=req.params.get("cursor"),
        filter_fn=lambda item: (
            (not entity_type or str(item.get("entityType") or "").strip().lower() == entity_type)
            and (not entity_id or str(item.get("entityId") or "") == entity_id)
        ),
        descending=True,
    )
    return _json({"items": items, "nextCursor": next_cursor}, status_code=200, cors=cors)


@app.function_name(name="CrmUsers")
@app.route(route="crm/users", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_users(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    actor, auth_error = _resolve_actor_or_error(req, {}, cors)
    if auth_error:
        return auth_error
    assert actor

    users = list_tenant_users(actor, include_disabled=False)
    tasks, _ = list_entities("tasks", actor.tenant_id, limit=200, descending=True)
    workload_map: Dict[str, Dict[str, int]] = {}
    for user in users:
        email = _normalize_email(user.get("email"))
        workload_map[email] = {"openTasks": 0, "overdue": 0}
    now = datetime.now(timezone.utc)
    for task in tasks:
        assignee = _normalize_email(task.get("assignedToEmail"))
        if assignee not in workload_map:
            continue
        status = str(task.get("status") or "").lower()
        if status in {"completed", "archived"}:
            continue
        workload_map[assignee]["openTasks"] += 1
        due_raw = task.get("dueDate")
        if due_raw:
            due_dt = _parse_datetime_utc(due_raw)
            if due_dt and due_dt < now:
                workload_map[assignee]["overdue"] += 1
    for user in users:
        email = _normalize_email(user.get("email"))
        user["workload"] = workload_map.get(email, {"openTasks": 0, "overdue": 0})
    return _json(
        {
            "items": users,
            "maxUsers": 10,
            "canManageUsers": can_manage_all(actor.role),
        },
        status_code=200,
        cors=cors,
    )


@app.function_name(name="CrmDashboard")
@app.route(route="crm/dashboard", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_dashboard(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    actor, auth_error = _resolve_actor_or_error(req, {}, cors)
    if auth_error:
        return auth_error
    assert actor
    country_code = _resolve_country_code(req, None)
    dashboard_currency = _currency_for_country(country_code)

    tasks, _ = list_entities(
        "tasks",
        actor.tenant_id,
        limit=500,
        descending=True,
        filter_fn=lambda item: _task_visible_for_actor(actor, item),
    )
    deals, _ = list_entities(
        "deals",
        actor.tenant_id,
        limit=500,
        descending=True,
        filter_fn=lambda item: _deal_visible_for_actor(actor, item),
    )
    notifications, _ = list_entities(
        "notifications",
        actor.tenant_id,
        limit=50,
        descending=True,
        filter_fn=lambda item: _normalize_email(item.get("userEmail")) == actor.email and not bool(item.get("read")),
    )
    now = datetime.now(timezone.utc)
    week_start = now - timedelta(days=7)

    open_tasks = 0
    overdue = 0
    completed_this_week = 0
    my_tasks = 0
    team_tasks = 0
    status_breakdown: Dict[str, int] = {}
    for task in tasks:
        status = str(task.get("status") or "new").lower()
        status_breakdown[status] = status_breakdown.get(status, 0) + 1
        is_open = status not in {"completed", "archived"}
        if is_open:
            open_tasks += 1
            team_tasks += 1
            if _normalize_email(task.get("assignedToEmail")) == actor.email:
                my_tasks += 1
            due_raw = task.get("dueDate")
            if due_raw:
                due_dt = _parse_datetime_utc(due_raw)
                if due_dt and due_dt < now:
                    overdue += 1
        completed_raw = task.get("completedAt")
        if completed_raw:
            completed_dt = _parse_datetime_utc(completed_raw)
            if completed_dt and completed_dt >= week_start:
                completed_this_week += 1

    active_deal_value = 0.0
    stage_breakdown: Dict[str, Dict[str, float]] = {}
    for deal in deals:
        stage = str(deal.get("stage") or "lead").lower()
        value = float(deal.get("value") or 0)
        deal_currency = str(deal.get("currency") or dashboard_currency).strip().upper()
        bucket = stage_breakdown.setdefault(stage, {"count": 0, "value": 0.0})
        bucket["count"] += 1
        if deal_currency == dashboard_currency:
            bucket["value"] += value
        if stage not in {"won", "lost", "closed"} and deal_currency == dashboard_currency:
            active_deal_value += value

    recent_activity = list_timeline_items(actor.tenant_id, limit=30)[:15]
    return _json(
        {
            "kpis": {
                "openTasks": open_tasks,
                "overdueTasks": overdue,
                "completedThisWeek": completed_this_week,
                "activeDealsValue": active_deal_value,
                "myTasks": my_tasks,
                "teamTasks": team_tasks,
                "unreadNotifications": len(notifications),
            },
            "taskStatusBreakdown": status_breakdown,
            "dealStageBreakdown": stage_breakdown,
            "recentActivity": recent_activity,
            "currency": dashboard_currency,
            "countryCode": country_code,
        },
        status_code=200,
        cors=cors,
    )


def _csv_response(rows: List[Dict[str, Any]], *, filename: str, cors: Dict[str, str]) -> func.HttpResponse:
    output = StringIO()
    if rows:
        writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    else:
        output.write("")
    headers = dict(cors)
    headers["Content-Type"] = "text/csv; charset=utf-8"
    headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return func.HttpResponse(output.getvalue(), status_code=200, headers=headers)


@app.function_name(name="CrmTasksReport")
@app.route(route="crm/reports/tasks", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_tasks_report(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    actor, auth_error = _resolve_actor_or_error(req, {}, cors)
    if auth_error:
        return auth_error
    assert actor
    if not _is_primary_admin(actor):
        return _error(cors=cors, status_code=403, message="Only tenant admin can export reports", code="forbidden")

    tasks, _ = list_entities(
        "tasks",
        actor.tenant_id,
        limit=1000,
        descending=True,
    )
    rows: List[Dict[str, Any]] = []
    for task in tasks:
        rows.append(
            {
                "id": task.get("id"),
                "title": task.get("title"),
                "status": task.get("status"),
                "priority": task.get("priority"),
                "progressPercent": task.get("progressPercent"),
                "dueDate": task.get("dueDate"),
                "assignedToEmail": task.get("assignedToEmail"),
                "createdByEmail": task.get("createdByEmail"),
                "relatedContactId": task.get("relatedContactId"),
                "relatedDealId": task.get("relatedDealId"),
                "tags": ",".join(_normalize_list(task.get("tags"))),
                "timeLoggedMinutes": task.get("timeLoggedMinutes"),
                "createdAt": task.get("createdAt"),
                "updatedAt": task.get("updatedAt"),
            }
        )
    return _csv_response(rows, filename="crm_tasks_report.csv", cors=cors)


@app.function_name(name="CrmDealsReport")
@app.route(route="crm/reports/deals", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def crm_deals_report(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    actor, auth_error = _resolve_actor_or_error(req, {}, cors)
    if auth_error:
        return auth_error
    assert actor
    if not _is_primary_admin(actor):
        return _error(cors=cors, status_code=403, message="Only tenant admin can export reports", code="forbidden")

    deals, _ = list_entities(
        "deals",
        actor.tenant_id,
        limit=1000,
        descending=True,
    )
    rows: List[Dict[str, Any]] = []
    for deal in deals:
        rows.append(
            {
                "id": deal.get("id"),
                "name": deal.get("name"),
                "stage": deal.get("stage"),
                "value": deal.get("value"),
                "expectedCloseDate": deal.get("expectedCloseDate"),
                "ownerEmail": deal.get("ownerEmail"),
                "companyId": deal.get("companyId"),
                "contactIds": ",".join(_normalize_list(deal.get("contactIds"))),
                "nextAction": deal.get("nextAction"),
                "createdByEmail": deal.get("createdByEmail"),
                "createdAt": deal.get("createdAt"),
                "updatedAt": deal.get("updatedAt"),
            }
        )
    return _csv_response(rows, filename="crm_deals_report.csv", cors=cors)
