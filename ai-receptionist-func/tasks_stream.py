import json
import logging
import time

import azure.functions as func

from function_app import app
from services.task_events_store import default_cursor, fetch_task_events
from shared.db import SessionLocal
from tasks_shared import disabled_response, find_client_and_user, tasks_enabled, tasks_live_enabled
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


@app.function_name(name="TasksStream")
@app.route(route="tasks/stream", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def tasks_stream(req: func.HttpRequest) -> func.HttpResponse:
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

    cursor_param = req.params.get("since") or req.params.get("cursor")
    cursor = cursor_param or default_cursor()
    timeout_raw = req.params.get("timeout")
    try:
        timeout = min(int(timeout_raw or 25), 25)
    except ValueError:
        timeout = 25
    if cursor_param is None:
        timeout = 0

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

    events = fetch_task_events(client_id, cursor)
    if not events and timeout > 0:
        deadline = time.time() + max(timeout, 0)
        while time.time() < deadline:
            events = fetch_task_events(client_id, cursor)
            if events:
                break
            time.sleep(1)

    lines = ["retry: 5000"]
    if events:
        for event in events:
            lines.append(f"event: {event.get('type')}")
            lines.append(f"data: {json.dumps(event, ensure_ascii=True)}")
            lines.append("")
        cursor = events[-1].get("cursor") or cursor
    else:
        ping = {"ts": time.time(), "cursor": cursor}
        lines.append("event: ping")
        lines.append(f"data: {json.dumps(ping, ensure_ascii=True)}")
        lines.append("")

    body = "\n".join(lines) + "\n"
    headers = {
        **cors,
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }

    return func.HttpResponse(
        body,
        status_code=200,
        mimetype="text/event-stream",
        headers=headers,
    )
