import json
import logging

import azure.functions as func
from repository.tasks_repo import list_tasks
from schemas.tasks_schema import normalize_status_filter
from shared.db import SessionLocal
from tasks_shared import find_client_and_user

logger = logging.getLogger(__name__)


def handle_tasks_list(req: func.HttpRequest, cors: dict) -> func.HttpResponse:
    email = req.params.get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    status_param = req.params.get("status")
    search = req.params.get("search")

    try:
        status = normalize_status_filter(status_param)
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "invalid status filter"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

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
        tasks = list_tasks(db, str(client.id), status=status, search=search)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to list tasks: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to fetch tasks", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()

    return func.HttpResponse(
        json.dumps({"tasks": tasks}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )
