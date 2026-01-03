import json
import logging
import time
from datetime import datetime, timezone

import azure.functions as func

from function_app import app
from repository.tasks_repo import list_task_updates, task_to_dict
from services.task_events_store import default_cursor, fetch_task_events
from shared.db import SessionLocal
from tasks_shared import disabled_response, find_client_and_user, tasks_enabled, tasks_live_enabled
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


def _cursor_to_dt(cursor: str | None) -> datetime | None:
    if not cursor:
        return None
    raw = str(cursor)
    if "_" in raw:
        raw = raw.split("_", 1)[0]
    if raw.isdigit():
        value = int(raw)
        if value > 10_000_000_000:
            return datetime.utcfromtimestamp(value / 1000)
        return datetime.utcfromtimestamp(value)
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:  # pylint: disable=broad-except
        return None


def _task_event(task) -> dict:
    payload = task_to_dict(task)
    stamp = task.updated_at or task.created_at or datetime.utcnow()
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    ts_ms = int(stamp.timestamp() * 1000)
    cursor = f"{ts_ms:013d}_{task.id}"
    return {
        "id": cursor,
        "cursor": cursor,
        "type": "task.updated",
        "taskId": task.id,
        "task": payload,
        "ts": payload.get("updatedAt") or payload.get("createdAt"),
    }


@app.function_name(name="TasksChanges")
@app.route(route="tasks/changes", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def tasks_changes(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if not tasks_enabled() or not tasks_live_enabled():
        return disabled_response(cors)

    email = req.params.get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    cursor = req.params.get("since") or req.params.get("cursor") or default_cursor()
    timeout_raw = req.params.get("timeout")
    try:
        timeout = min(int(timeout_raw or 25), 25)
    except ValueError:
        timeout = 25

    db = SessionLocal()
    try:
        client, _ = find_client_and_user(db, email)
        if not client:
            return func.HttpResponse(
                json.dumps({"error": "Client not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        client_id = str(client.id)
    finally:
        db.close()

    events = []
    deadline = time.time() + max(timeout, 1)
    while time.time() < deadline:
        events = fetch_task_events(client_id, cursor)
        if events:
            break
        time.sleep(1)

    if not events:
        since_dt = _cursor_to_dt(cursor)
        db = SessionLocal()
        try:
            tasks = list_task_updates(db, client_id, since_dt=since_dt, limit=100)
            events = [_task_event(task) for task in tasks]
        finally:
            db.close()

    next_cursor = events[-1].get("cursor") if events else cursor

    return func.HttpResponse(
        json.dumps({"events": events, "cursor": next_cursor}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )
