from __future__ import annotations

from datetime import datetime
import re
from typing import Iterable, Optional

from sqlalchemy import or_

from shared.db import Contact


def _normalize_email(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    trimmed = str(value).strip().lower()
    return trimmed or None


def _normalize_phone(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    cleaned = re.sub(r"[^\d+]", "", str(value))
    return cleaned or None


def _normalize_tags(tags: Optional[Iterable[str]]) -> list[str]:
    if not tags:
        return []
    cleaned = []
    for tag in tags:
        if tag is None:
            continue
        text = str(tag).strip()
        if text and text not in cleaned:
            cleaned.append(text)
    return cleaned


def contact_to_dict(contact: Contact) -> dict:
    return {
        "id": contact.id,
        "userId": contact.user_id,
        "clientId": contact.client_id,
        "source": contact.source,
        "sourceRef": contact.source_ref,
        "name": contact.name,
        "email": contact.email,
        "phone": contact.phone,
        "tags": contact.tags_json or [],
        "metadata": contact.metadata_json or {},
        "lastSeenAt": contact.last_seen_at.isoformat() if contact.last_seen_at else None,
        "createdAt": contact.created_at.isoformat() if contact.created_at else None,
        "updatedAt": contact.updated_at.isoformat() if contact.updated_at else None,
    }


def _find_contact(
    db,
    *,
    user_id: int,
    source: Optional[str] = None,
    source_ref: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None,
) -> Optional[Contact]:
    if source and source_ref:
        existing = (
            db.query(Contact)
            .filter(Contact.user_id == user_id, Contact.source == source, Contact.source_ref == source_ref)
            .one_or_none()
        )
        if existing:
            return existing
    if email:
        existing = (
            db.query(Contact)
            .filter(Contact.user_id == user_id, Contact.email == email)
            .one_or_none()
        )
        if existing:
            return existing
    if phone:
        existing = (
            db.query(Contact)
            .filter(Contact.user_id == user_id, Contact.phone == phone)
            .one_or_none()
        )
        if existing:
            return existing
    return None


def upsert_contact(
    db,
    *,
    user_id: int,
    client_id: Optional[int],
    name: Optional[str],
    email: Optional[str],
    phone: Optional[str],
    source: str = "manual",
    source_ref: Optional[str] = None,
    tags: Optional[Iterable[str]] = None,
    metadata: Optional[dict] = None,
    touch: bool = True,
) -> Contact:
    safe_email = _normalize_email(email)
    safe_phone = _normalize_phone(phone)
    safe_tags = _normalize_tags(tags)
    safe_name = str(name).strip() if name else None
    safe_source = source or "manual"
    safe_source_ref = str(source_ref).strip() if source_ref else None

    contact = _find_contact(
        db,
        user_id=user_id,
        source=safe_source,
        source_ref=safe_source_ref,
        email=safe_email,
        phone=safe_phone,
    )

    if contact:
        if safe_name and contact.name != safe_name:
            contact.name = safe_name
        if safe_email and contact.email != safe_email:
            contact.email = safe_email
        if safe_phone and contact.phone != safe_phone:
            contact.phone = safe_phone
        if client_id and not contact.client_id:
            contact.client_id = client_id
        existing_tags = contact.tags_json or []
        merged_tags = _normalize_tags(existing_tags + safe_tags)
        contact.tags_json = merged_tags or None
        if metadata:
            existing_meta = contact.metadata_json or {}
            existing_meta.update(metadata)
            contact.metadata_json = existing_meta
        contact.source = contact.source or safe_source
        contact.source_ref = contact.source_ref or safe_source_ref
        if touch:
            contact.last_seen_at = datetime.utcnow()
        contact.updated_at = datetime.utcnow()
        db.add(contact)
        db.flush()
        return contact

    contact = Contact(
        user_id=user_id,
        client_id=client_id,
        source=safe_source,
        source_ref=safe_source_ref,
        name=safe_name,
        email=safe_email,
        phone=safe_phone,
        tags_json=safe_tags or None,
        metadata_json=metadata or None,
        last_seen_at=datetime.utcnow() if touch else None,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(contact)
    db.flush()
    return contact


def list_contacts(
    db,
    *,
    user_id: int,
    source: Optional[str] = None,
    search: Optional[str] = None,
    tag: Optional[str] = None,
    limit: int = 200,
) -> list[dict]:
    query = db.query(Contact).filter(Contact.user_id == user_id)
    if source:
        query = query.filter(Contact.source == source)
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                Contact.name.ilike(pattern),
                Contact.email.ilike(pattern),
                Contact.phone.ilike(pattern),
            )
        )
    query = query.order_by(Contact.updated_at.desc())
    if limit:
        query = query.limit(limit)
    contacts = query.all()
    if tag:
        tag_value = str(tag).strip().lower()
        filtered = []
        for contact in contacts:
            tags = contact.tags_json or []
            if any(str(item).strip().lower() == tag_value for item in tags):
                filtered.append(contact)
        contacts = filtered
    return [contact_to_dict(contact) for contact in contacts]


def delete_contact(db, *, user_id: int, contact_id: int) -> bool:
    contact = (
        db.query(Contact)
        .filter(Contact.user_id == user_id, Contact.id == int(contact_id))
        .one_or_none()
    )
    if not contact:
        return False
    db.delete(contact)
    db.flush()
    return True
