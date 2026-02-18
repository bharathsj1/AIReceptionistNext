from __future__ import annotations

import base64
import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import azure.functions as func
from sqlalchemy import func as sa_func, or_

from shared.config import get_setting
from shared.db import Client, ClientUser, SessionLocal, User
from services.crm_rbac import normalize_role


@dataclass
class CRMActor:
    tenant_id: str
    client_id: int
    email: str
    role: str
    scope: str
    user_id: Optional[str]
    client_user_id: Optional[str]


def _normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(raw: str) -> Optional[bytes]:
    value = str(raw or "").strip()
    if not value:
        return None
    padding = "=" * ((4 - len(value) % 4) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding)
    except Exception:  # pylint: disable=broad-except
        return None


def _auth_session_secret() -> str:
    for key in (
        "AUTH_SESSION_SECRET",
        "APP_SESSION_SECRET",
        "JWT_SECRET",
        "SECRET_KEY",
        "WEBSITE_AUTH_ENCRYPTION_KEY",
        "AZURE_STORAGE_CONNECTION_STRING",
    ):
        value = str(get_setting(key) or "").strip()
        if value:
            return value
    return ""


def _auth_session_ttl_seconds() -> int:
    raw = str(get_setting("AUTH_SESSION_TTL_SECONDS") or "").strip()
    try:
        parsed = int(raw) if raw else 12 * 60 * 60
    except ValueError:
        parsed = 12 * 60 * 60
    return max(15 * 60, min(7 * 24 * 60 * 60, parsed))


def _extract_email(req: func.HttpRequest, body: Optional[dict] = None) -> str:
    body = body or {}
    headers = req.headers or {}
    candidates = [
        headers.get("x-user-email"),
        headers.get("X-User-Email"),
        headers.get("x-email"),
        req.params.get("email"),
        body.get("email"),
        body.get("userEmail"),
    ]
    for candidate in candidates:
        normalized = _normalize_email(candidate)
        if normalized:
            return normalized
    return ""


def _extract_auth_session_token(req: func.HttpRequest, body: Optional[dict] = None) -> str:
    body = body or {}
    headers = req.headers or {}
    auth_header = str(headers.get("Authorization") or headers.get("authorization") or "").strip()
    if auth_header:
        parts = auth_header.split(" ", 1)
        if len(parts) == 2 and parts[0].strip().lower() == "bearer":
            token = parts[1].strip()
            if token:
                return token
    query_token = req.params.get("auth_token")
    if isinstance(query_token, str) and query_token.strip():
        return query_token.strip()
    body_token = body.get("auth_token") or body.get("authToken")
    if isinstance(body_token, str) and body_token.strip():
        return body_token.strip()
    return ""


def issue_auth_session_token(
    email: str,
    *,
    client_id: Optional[int] = None,
    role: Optional[str] = None,
    scope: Optional[str] = None,
    ttl_seconds: Optional[int] = None,
) -> Tuple[Optional[str], Optional[str]]:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        return None, None
    secret = _auth_session_secret()
    if not secret:
        return None, None
    expires_in = ttl_seconds if isinstance(ttl_seconds, int) and ttl_seconds > 0 else _auth_session_ttl_seconds()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    payload: Dict[str, Any] = {
        "email": normalized_email,
        "exp": int(expires_at.timestamp()),
    }
    if client_id is not None:
        payload["client_id"] = int(client_id)
    if role:
        payload["role"] = str(role).strip().lower()
    if scope:
        payload["scope"] = str(scope).strip().lower()
    payload_bytes = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).digest()
    token = f"{_b64url_encode(payload_bytes)}.{_b64url_encode(digest)}"
    return token, expires_at.isoformat()


def _verify_auth_session_token(token: str) -> Optional[Dict[str, Any]]:
    raw = str(token or "").strip()
    if "." not in raw:
        return None
    payload_part, sig_part = raw.split(".", 1)
    payload_bytes = _b64url_decode(payload_part)
    sig_bytes = _b64url_decode(sig_part)
    if not payload_bytes or not sig_bytes:
        return None
    secret = _auth_session_secret()
    if not secret:
        return None
    expected = hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, sig_bytes):
        return None
    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except Exception:  # pylint: disable=broad-except
        return None
    if not isinstance(payload, dict):
        return None
    try:
        exp_ts = int(payload.get("exp") or 0)
    except (TypeError, ValueError):
        return None
    if exp_ts <= int(datetime.now(timezone.utc).timestamp()):
        return None
    email = _normalize_email(payload.get("email"))
    if not email:
        return None
    payload["email"] = email
    return payload


def _resolve_actor_for_email(db, email: str) -> Optional[CRMActor]:
    normalized_email = _normalize_email(email)
    if not normalized_email:
        return None
    client = (
        db.query(Client)
        .filter(sa_func.lower(sa_func.trim(Client.email)) == normalized_email)
        .order_by(Client.id.asc())
        .first()
    )
    if client:
        owner_user = None
        if client.user_id:
            owner_user = db.query(User).filter_by(id=client.user_id).one_or_none()
        return CRMActor(
            tenant_id=str(client.id),
            client_id=int(client.id),
            email=normalized_email,
            role="admin",
            scope="primary_user",
            user_id=str(owner_user.id) if owner_user else None,
            client_user_id=None,
        )

    cuser = (
        db.query(ClientUser)
        .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == normalized_email)
        .filter(
            or_(
                ClientUser.is_active.is_(True),
                ClientUser.is_active.is_(None),
            )
        )
        .filter(sa_func.lower(sa_func.coalesce(ClientUser.status, "active")) != "disabled")
        .order_by(ClientUser.id.asc())
        .first()
    )
    if cuser:
        client = db.query(Client).filter_by(id=cuser.client_id).one_or_none()
        if not client:
            return None
        return CRMActor(
            tenant_id=str(client.id),
            client_id=int(client.id),
            email=normalized_email,
            role=normalize_role(cuser.role, "client_user"),
            scope="client_user",
            user_id=None,
            client_user_id=str(cuser.id),
        )

    user = (
        db.query(User)
        .filter(sa_func.lower(sa_func.trim(User.email)) == normalized_email)
        .order_by(User.id.asc())
        .first()
    )
    if not user:
        return None
    client = db.query(Client).filter_by(user_id=user.id).one_or_none()
    if not client:
        return None
    return CRMActor(
        tenant_id=str(client.id),
        client_id=int(client.id),
        email=normalized_email,
        role="admin",
        scope="primary_user",
        user_id=str(user.id),
        client_user_id=None,
    )


def resolve_actor(req: func.HttpRequest, body: Optional[dict] = None) -> Optional[CRMActor]:
    email = _extract_email(req, body)
    if not email:
        return None
    db = SessionLocal()
    try:
        return _resolve_actor_for_email(db, email)
    finally:
        db.close()


def resolve_actor_from_session(req: func.HttpRequest, body: Optional[dict] = None) -> Optional[CRMActor]:
    claims = _verify_auth_session_token(_extract_auth_session_token(req, body))
    if not claims:
        return None

    token_email = _normalize_email(claims.get("email"))
    if not token_email:
        return None

    provided_email = _extract_email(req, body)
    if provided_email and provided_email != token_email:
        return None

    db = SessionLocal()
    try:
        actor = _resolve_actor_for_email(db, token_email)
        if not actor:
            return None
        claim_client_id = claims.get("client_id")
        if claim_client_id is not None:
            try:
                if int(claim_client_id) != int(actor.client_id):
                    return None
            except (TypeError, ValueError):
                return None
        return actor
    finally:
        db.close()


def list_tenant_users(actor: CRMActor, include_disabled: bool = False) -> List[Dict[str, Any]]:
    db = SessionLocal()
    try:
        client = db.query(Client).filter_by(id=actor.client_id).one_or_none()
        if not client:
            return []
        users: List[Dict[str, Any]] = [
            {
                "id": f"owner:{client.id}",
                "email": _normalize_email(client.email),
                "role": "admin",
                "scope": "primary_user",
                "active": True,
            }
        ]
        query = db.query(ClientUser).filter(ClientUser.client_id == actor.client_id).order_by(ClientUser.id.asc())
        if not include_disabled:
            query = query.filter(
                or_(
                    ClientUser.is_active.is_(True),
                    ClientUser.is_active.is_(None),
                )
            ).filter(sa_func.lower(sa_func.coalesce(ClientUser.status, "active")) != "disabled")
        for row in query.all():
            users.append(
                {
                    "id": f"client_user:{row.id}",
                    "email": _normalize_email(row.email),
                    "role": normalize_role(row.role, "client_user"),
                    "scope": "client_user",
                    "active": bool(row.is_active is not False and str(row.status or "active").lower() != "disabled"),
                    "rawRole": row.role,
                    "status": row.status or "active",
                    "lastLoginAt": row.last_login_at.isoformat() if row.last_login_at else None,
                }
            )
        return users[:10]
    finally:
        db.close()
