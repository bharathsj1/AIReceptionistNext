import hashlib
import json
import uuid
from typing import Any, Dict, Iterable, Optional

from sqlalchemy import func

from shared.db import PromptRegistry


def _stable_json(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def compute_prompt_hash(prompt_text: str) -> str:
    return _sha256((prompt_text or "").strip())


def build_source_payload(
    category: Optional[str],
    sub_type: Optional[str],
    task_type: Optional[str],
    business_profile: Optional[Dict[str, Any]],
    knowledge_text: Optional[str],
) -> Dict[str, Any]:
    return {
        "category": category or "",
        "subType": sub_type or "",
        "taskType": task_type or "",
        "businessProfile": business_profile or {},
        "knowledgeText": knowledge_text or "",
    }


def compute_source_data_hash(
    category: Optional[str],
    sub_type: Optional[str],
    task_type: Optional[str],
    business_profile: Optional[Dict[str, Any]],
    knowledge_text: Optional[str],
) -> str:
    payload = build_source_payload(category, sub_type, task_type, business_profile, knowledge_text)
    return _sha256(_stable_json(payload))


def get_active_prompt(db, client_id: int, sub_type: str, task_type: Optional[str] = None) -> PromptRegistry | None:
    base_query = (
        db.query(PromptRegistry)
        .filter(
            PromptRegistry.client_id == client_id,
            PromptRegistry.sub_type == sub_type,
            PromptRegistry.is_active.is_(True),
        )
    )
    if task_type is not None:
        prompt = (
            base_query.filter(PromptRegistry.task_type == task_type)
            .order_by(PromptRegistry.version.desc())
            .first()
        )
        if prompt:
            return prompt
    prompt = (
        base_query.filter(PromptRegistry.task_type.is_(None))
        .order_by(PromptRegistry.version.desc())
        .first()
    )
    if prompt:
        return prompt
    return base_query.order_by(PromptRegistry.version.desc()).first()


def list_prompt_versions(
    db,
    client_id: int,
    sub_type: str,
    task_type: Optional[str] = None,
) -> list[PromptRegistry]:
    query = db.query(PromptRegistry).filter(
        PromptRegistry.client_id == client_id,
        PromptRegistry.sub_type == sub_type,
    )
    if task_type is None:
        query = query.filter(PromptRegistry.task_type.is_(None))
    else:
        query = query.filter(PromptRegistry.task_type == task_type)
    return query.order_by(PromptRegistry.version.desc()).all()


def _next_version(db, client_id: int, sub_type: str, task_type: Optional[str]) -> int:
    query = db.query(func.max(PromptRegistry.version)).filter(
        PromptRegistry.client_id == client_id,
        PromptRegistry.sub_type == sub_type,
    )
    if task_type is None:
        query = query.filter(PromptRegistry.task_type.is_(None))
    else:
        query = query.filter(PromptRegistry.task_type == task_type)
    max_version = query.scalar() or 0
    return int(max_version) + 1


def deactivate_others(
    db,
    client_id: int,
    sub_type: str,
    task_type: Optional[str],
    exclude_ids: Iterable[str] | None = None,
) -> None:
    exclude_ids = set(exclude_ids or [])
    query = db.query(PromptRegistry).filter(
        PromptRegistry.client_id == client_id,
        PromptRegistry.sub_type == sub_type,
    )
    if task_type is None:
        query = query.filter(PromptRegistry.task_type.is_(None))
    else:
        query = query.filter(PromptRegistry.task_type == task_type)
    for row in query.all():
        if row.id in exclude_ids:
            continue
        if row.is_active:
            row.is_active = False
    db.flush()


def create_prompt_version(
    db,
    client_id: int,
    category: Optional[str],
    sub_type: str,
    task_type: Optional[str],
    prompt_text: str,
    prompt_hash: str,
    source_data_hash: str,
    created_by: Optional[str] = None,
) -> PromptRegistry:
    version = _next_version(db, client_id, sub_type, task_type)
    record = PromptRegistry(
        id=str(uuid.uuid4()),
        client_id=client_id,
        category=category,
        sub_type=sub_type,
        task_type=task_type,
        version=version,
        is_active=True,
        prompt_text=prompt_text,
        prompt_hash=prompt_hash,
        source_data_hash=source_data_hash,
        created_by=created_by,
    )
    db.add(record)
    db.flush()
    deactivate_others(db, client_id, sub_type, task_type, exclude_ids=[record.id])
    return record


def set_active_version(
    db,
    client_id: int,
    sub_type: str,
    task_type: Optional[str],
    version: int,
) -> PromptRegistry | None:
    query = db.query(PromptRegistry).filter(
        PromptRegistry.client_id == client_id,
        PromptRegistry.sub_type == sub_type,
        PromptRegistry.version == version,
    )
    if task_type is None:
        query = query.filter(PromptRegistry.task_type.is_(None))
    else:
        query = query.filter(PromptRegistry.task_type == task_type)
    record = query.one_or_none()
    if not record:
        return None
    record.is_active = True
    deactivate_others(db, client_id, sub_type, task_type, exclude_ids=[record.id])
    db.flush()
    return record
