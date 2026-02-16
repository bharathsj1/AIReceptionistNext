from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import azure.functions as func
from sqlalchemy import func as sa_func, or_

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


def resolve_actor(req: func.HttpRequest, body: Optional[dict] = None) -> Optional[CRMActor]:
    email = _extract_email(req, body)
    if not email:
        return None
    db = SessionLocal()
    try:
        client = (
            db.query(Client)
            .filter(sa_func.lower(sa_func.trim(Client.email)) == email)
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
                email=email,
                role="admin",
                scope="primary_user",
                user_id=str(owner_user.id) if owner_user else None,
                client_user_id=None,
            )

        cuser = (
            db.query(ClientUser)
            .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == email)
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
                email=email,
                role=normalize_role(cuser.role, "client_user"),
                scope="client_user",
                user_id=None,
                client_user_id=str(cuser.id),
            )

        user = (
            db.query(User)
            .filter(sa_func.lower(sa_func.trim(User.email)) == email)
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
            email=email,
            role="admin",
            scope="primary_user",
            user_id=str(user.id),
            client_user_id=None,
        )
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

