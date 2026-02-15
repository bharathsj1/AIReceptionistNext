from __future__ import annotations

import json
import logging
from typing import Optional, Tuple

import azure.functions as func
from sqlalchemy import func as sa_func

from shared.config import get_setting
from shared.db import Client, ClientUser, User

logger = logging.getLogger(__name__)

_TRUTHY = {"1", "true", "yes", "y", "on"}


def _flag_enabled(name: str, default: bool = False) -> bool:
    raw = get_setting(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in _TRUTHY


def tasks_enabled() -> bool:
    return True


def tasks_live_enabled() -> bool:
    return True


def disabled_response(cors: dict, status_code: int = 404) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({"ok": False, "message": "disabled"}),
        status_code=status_code,
        mimetype="application/json",
        headers=cors,
    )


def parse_json_body(req: func.HttpRequest) -> dict:
    try:
        body = req.get_json()
    except ValueError:
        body = None
    return body or {}


def verify_tasks_secret(req: func.HttpRequest) -> bool:
    secret = get_setting("TASKS_TOOL_SECRET")
    if not secret:
        return True
    provided = (
        req.headers.get("X-TASKS-TOOL-SECRET")
        or req.headers.get("x-tasks-tool-secret")
        or req.params.get("secret")
    )
    return bool(provided and provided == secret)


def _normalize_email(value: Optional[str]) -> str:
    return str(value or "").strip().lower()


def find_client_and_user(db, email: Optional[str]) -> Tuple[Optional[Client], Optional[User]]:
    normalized = _normalize_email(email)
    if not normalized:
        return None, None
    user = (
        db.query(User)
        .filter(sa_func.lower(sa_func.trim(User.email)) == normalized)
        .order_by(User.id.asc())
        .first()
    )
    client = (
        db.query(Client)
        .filter(sa_func.lower(sa_func.trim(Client.email)) == normalized)
        .order_by(Client.id.asc())
        .first()
    )
    client_user = (
        db.query(ClientUser)
        .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == normalized)
        .order_by(ClientUser.id.asc())
        .first()
    )
    if not client and client_user:
        client = db.query(Client).filter_by(id=client_user.client_id).one_or_none()
    if not client and user:
        client = db.query(Client).filter_by(user_id=user.id).one_or_none()
    if client and not user and client.user_id:
        user = db.query(User).filter_by(id=client.user_id).one_or_none()
    return client, user
