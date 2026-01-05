import json
import logging

import azure.functions as func

from function_app import app
from repository.tasks_repo import delete_task, get_task, task_to_dict
from services.task_events_store import publish_task_event
from shared.db import SessionLocal
from tasks_shared import (
    disabled_response,
    find_client_and_user,
    parse_json_body,
    tasks_enabled,
)
from tasks_stream import tasks_stream as tasks_stream_handler
from tasks_changes import tasks_changes as tasks_changes_handler
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


@app.function_name(name="TasksDetail")
@app.route(
    route="tasks/{id}",
    methods=["GET", "DELETE", "OPTIONS"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def tasks_detail(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "DELETE", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if not tasks_enabled():
        return disabled_response(cors)

    task_id = req.route_params.get("id")
    action = "delete" if req.method == "DELETE" else "fetch"
    if req.method == "GET":
        if task_id == "stream":
            return tasks_stream_handler(req)
        if task_id == "changes":
            return tasks_changes_handler(req)

    body = parse_json_body(req) if req.method == "DELETE" else {}
    email = req.params.get("email") or body.get("email")
    if not email or not task_id:
        return func.HttpResponse(
            json.dumps({"error": "email and id are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    task_payload = None
    try:
        client, _ = find_client_and_user(db, email)
        if not client:
            return func.HttpResponse(
                json.dumps({"error": "Client not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        task = get_task(db, str(client.id), str(task_id))
        if not task:
            return func.HttpResponse(
                json.dumps({"error": "Task not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        task_payload = task_to_dict(task)
        if req.method == "DELETE":
            delete_task(db, task)
            db.commit()
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Failed to %s task: %s", action, exc)
        return func.HttpResponse(
            json.dumps({"error": f"Failed to {action} task", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()

    if req.method == "DELETE":
        try:
            publish_task_event(task_payload.get("clientId"), "task.deleted", task_payload)
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Failed to publish task delete event: %s", exc)

        return func.HttpResponse(
            json.dumps({"ok": True}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )

    return func.HttpResponse(
        json.dumps({"task": task_payload}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )
