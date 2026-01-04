from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import uuid4

from sqlalchemy import or_

from shared.db import Task


def _format_dt(value: Optional[datetime]) -> Optional[str]:
    if not value:
        return None
    try:
        return value.isoformat()
    except Exception:
        return str(value)


def task_to_dict(task: Task) -> dict:
    return {
        "id": task.id,
        "clientId": task.client_id,
        "callId": task.call_id,
        "twilioCallSid": task.twilio_call_sid,
        "type": task.type,
        "status": task.status,
        "title": task.title,
        "summary": task.summary,
        "detailsJson": task.details_json or {},
        "customerName": task.customer_name,
        "customerPhone": task.customer_phone,
        "customerEmail": task.customer_email,
        "createdAt": _format_dt(task.created_at),
        "updatedAt": _format_dt(task.updated_at),
        "decisionAt": _format_dt(task.decision_at),
        "decisionReason": task.decision_reason,
    }


def create_task(db, payload: dict) -> Task:
    task = Task(
        id=payload.get("id") or str(uuid4()),
        client_id=str(payload.get("clientId")),
        call_id=payload.get("callId"),
        twilio_call_sid=payload.get("twilioCallSid"),
        type=payload.get("type"),
        status=payload.get("status") or "NEW",
        title=payload.get("title"),
        summary=payload.get("summary"),
        details_json=payload.get("detailsJson") or {},
        customer_name=payload.get("customerName"),
        customer_phone=payload.get("customerPhone"),
        customer_email=payload.get("customerEmail"),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(task)
    db.flush()
    return task


def _client_id_filters(client_id: str):
    client_id_str = str(client_id)
    patterns = [
        f"%value': '{client_id_str}%",
        f"%\"value\"%{client_id_str}%",
    ]
    return or_(
        Task.client_id == client_id_str,
        Task.client_id.ilike(patterns[0]),
        Task.client_id.ilike(patterns[1]),
    )


def list_tasks(
    db,
    client_id: str,
    status: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 200,
) -> List[dict]:
    query = db.query(Task).filter(_client_id_filters(client_id))
    if status and status != "ALL":
        query = query.filter(Task.status == status)
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                Task.title.ilike(pattern),
                Task.summary.ilike(pattern),
                Task.customer_name.ilike(pattern),
                Task.customer_phone.ilike(pattern),
                Task.customer_email.ilike(pattern),
            )
        )
    query = query.order_by(Task.created_at.desc())
    if limit:
        query = query.limit(limit)
    return [task_to_dict(task) for task in query.all()]


def list_task_updates(
    db,
    client_id: str,
    since_dt: Optional[datetime] = None,
    limit: int = 200,
) -> List[Task]:
    query = db.query(Task).filter(_client_id_filters(client_id))
    if since_dt:
        query = query.filter(Task.updated_at > since_dt)
    query = query.order_by(Task.updated_at.asc())
    if limit:
        query = query.limit(limit)
    return query.all()


def get_task(db, client_id: str, task_id: str) -> Optional[Task]:
    return (
        db.query(Task)
        .filter(_client_id_filters(client_id), Task.id == str(task_id))
        .one_or_none()
    )


def delete_task(db, task: Task) -> None:
    db.delete(task)
    db.flush()


def update_task_status(
    db,
    task: Task,
    status: str,
    decision_at: Optional[datetime] = None,
    decision_reason: Optional[str] = None,
) -> Task:
    task.status = status
    task.decision_at = decision_at
    task.decision_reason = decision_reason
    task.updated_at = datetime.utcnow()
    db.add(task)
    db.flush()
    return task
