from __future__ import annotations

import json
import logging
from typing import Optional, Tuple

import azure.functions as func

from shared.config import get_setting
from shared.db import Client, User

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


def find_client_and_user(db, email: Optional[str]) -> Tuple[Optional[Client], Optional[User]]:
    if not email:
        return None, None
    user = db.query(User).filter_by(email=email).one_or_none()
    client = db.query(Client).filter_by(email=email).one_or_none()
    if not client and user:
        client = db.query(Client).filter_by(user_id=user.id).one_or_none()
    return client, user
