import json
import logging

import azure.functions as func

from function_app import app
from repository.tasks_repo import create_task, task_to_dict
from schemas.tasks_schema import validate_task_create
from services.task_events_store import publish_task_event
from shared.db import SessionLocal
from tasks_list import handle_tasks_list
from tasks_shared import disabled_response, parse_json_body, tasks_enabled, verify_tasks_secret
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


@app.function_name(name="TasksCreate")
@app.route(route="tasks", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def tasks(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if not tasks_enabled():
        return disabled_response(cors)

    if req.method == "GET":
        return handle_tasks_list(req, cors)

    if not verify_tasks_secret(req):
        return func.HttpResponse(
            json.dumps({"error": "unauthorized"}),
            status_code=401,
            mimetype="application/json",
            headers=cors,
        )

    payload = parse_json_body(req)
    try:
        normalized = validate_task_create(payload)
    except ValueError as exc:
        return func.HttpResponse(
            json.dumps({"error": str(exc)}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        task = create_task(db, normalized)
        db.commit()
        task_dict = task_to_dict(task)
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Failed to create task: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to create task", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()

    try:
        publish_task_event(task_dict.get("clientId"), "task.created", task_dict)
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Failed to publish task event: %s", exc)

    return func.HttpResponse(
        json.dumps({"ok": True, "task": task_dict}),
        status_code=201,
        mimetype="application/json",
        headers=cors,
    )
