from __future__ import annotations

from typing import Any, Dict, Iterable, Tuple

TASK_STATUSES = ["new", "in_progress", "blocked", "waiting", "completed", "archived"]
TASK_MEMBER_MUTABLE_FIELDS = {
    "status",
    "progressPercent",
    "description",
    "tags",
    "timeLoggedMinutes",
    "attachments",
}
TASK_SYSTEM_MUTABLE_FIELDS = {"updatedAt", "completedAt"}
TASK_MANAGER_MUTABLE_FIELDS = {
    "title",
    "description",
    "priority",
    "startDateTime",
    "endDateTime",
    "dueDate",
    "assignedTo",
    "assignedToEmail",
    "watchers",
    "tags",
    "status",
    "progressPercent",
    "relatedContactId",
    "relatedDealId",
    "relatedCompanyId",
    "slaDueAt",
    "archived",
    "dependencies",
    "timeLoggedMinutes",
    "attachments",
}


def normalize_role(raw_role: str | None, scope: str | None = None) -> str:
    scope_value = str(scope or "").strip().lower()
    if scope_value == "primary_user":
        return "admin"
    if scope_value == "client_user":
        # Added users should operate as restricted members in CRM.
        return "member"
    role = str(raw_role or "").strip().lower()
    if role in {"admin", "owner"}:
        return "manager"
    if role in {"manager", "lead"}:
        return "manager"
    if role in {"member", "editor", "user"}:
        return "member"
    return "member"


def can_manage_all(role: str) -> bool:
    return role in {"admin", "manager"}


def _to_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    return []


def is_task_member(task: Dict[str, Any], actor_email: str | None) -> bool:
    email = str(actor_email or "").strip().lower()
    if not email:
        return False
    assigned = str(task.get("assignedToEmail") or "").strip().lower()
    return bool(assigned and assigned == email)


def can_view_task(role: str, actor_email: str | None, task: Dict[str, Any]) -> bool:
    if can_manage_all(role):
        return True
    return is_task_member(task, actor_email)


def _has_fields(updates: Dict[str, Any], names: Iterable[str]) -> bool:
    return any(name in updates for name in names)


def can_create_task(role: str) -> bool:
    return role in {"admin", "manager", "member"}


def can_create_deal(role: str) -> bool:
    return role in {"admin", "manager", "member"}


def can_create_contact(role: str) -> bool:
    return role in {"admin", "manager", "member"}


def can_patch_task(
    role: str,
    actor_email: str | None,
    before: Dict[str, Any],
    updates: Dict[str, Any],
) -> Tuple[bool, str | None]:
    if can_manage_all(role):
        return True, None
    if role != "member":
        return False, "forbidden"
    if not is_task_member(before, actor_email):
        return False, "forbidden"
    forbidden_for_member = set(updates.keys()) - TASK_MANAGER_MUTABLE_FIELDS - TASK_SYSTEM_MUTABLE_FIELDS
    if forbidden_for_member:
        return False, f"member_cannot_update_fields:{','.join(sorted(forbidden_for_member))}"
    return True, None


def normalize_task_status(value: Any) -> str:
    normalized = str(value or "new").strip().lower().replace(" ", "_")
    if normalized not in TASK_STATUSES:
        return "new"
    return normalized


def clamp_progress(value: Any) -> int:
    try:
        numeric = int(float(value))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, numeric))
