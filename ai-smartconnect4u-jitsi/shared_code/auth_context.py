from __future__ import annotations

import json
import logging
from typing import NamedTuple, Optional

import azure.functions as func

logger = logging.getLogger(__name__)


class AuthContext(NamedTuple):
    tenant_id: str
    user_id: str
    email: Optional[str]


class AuthError(Exception):
    pass


def _pick(source, *keys) -> Optional[str]:
    for key in keys:
        if not source:
            continue
        if key in source and source.get(key) is not None:
            value = source.get(key)
            if isinstance(value, str):
                cleaned = value.strip()
                if cleaned:
                    return cleaned
            else:
                return str(value)
    return None


def resolve_auth(req: func.HttpRequest) -> AuthContext:
    try:
        body = req.get_json()
    except ValueError:
        body = {}

    headers = {k.lower(): v for k, v in req.headers.items()} if req.headers else {}
    params = req.params or {}

    tenant_id = _pick(headers, "x-tenant-id", "x-client-id") or _pick(
        params, "tenantId", "tenant_id", "clientId", "client_id"
    ) or _pick(body, "tenantId", "tenant_id", "clientId", "client_id")

    user_id = _pick(headers, "x-user-id", "x-userid") or _pick(params, "userId", "user_id") or _pick(
        body, "userId", "user_id"
    )

    email = _pick(headers, "x-user-email", "x-email") or _pick(params, "email", "userEmail") or _pick(
        body, "email", "userEmail"
    )

    if not tenant_id or not user_id:
        raise AuthError("tenantId and userId are required. Send x-tenant-id/x-user-id headers or tenantId/userId parameters.")

    return AuthContext(tenant_id=str(tenant_id), user_id=str(user_id), email=email)


def require_auth(req: func.HttpRequest, cors: dict) -> AuthContext | func.HttpResponse:
    try:
        return resolve_auth(req)
    except AuthError as exc:
        logger.warning("Auth failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "unauthorized", "message": str(exc)}),
            status_code=401,
            mimetype="application/json",
            headers=cors,
        )
