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

    next_cursor = events[-1].get("cursor") if events else cursor

    return func.HttpResponse(
        json.dumps({"events": events, "cursor": next_cursor}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )
