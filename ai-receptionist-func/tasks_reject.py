import json
import logging
from datetime import datetime

import azure.functions as func

from function_app import app
from repository.tasks_repo import get_task, task_to_dict, update_task_status
from services.email_service import send_task_status_email
from services.task_events_store import publish_task_event
from shared.db import SessionLocal
from tasks_shared import disabled_response, find_client_and_user, parse_json_body, tasks_enabled
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


@app.function_name(name="TasksReject")
@app.route(route="tasks/{id}/reject", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def tasks_reject(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if not tasks_enabled():
        return disabled_response(cors)

    task_id = req.route_params.get("id")
    body = parse_json_body(req)
    email = req.params.get("email") or body.get("email")
    reason = body.get("reason") if isinstance(body, dict) else None
    if reason is not None:
        reason = str(reason).strip() or None

    if not email or not task_id:
        return func.HttpResponse(
            json.dumps({"error": "email and id are required"}),
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
        task = get_task(db, str(client.id), str(task_id))
        if not task:
            return func.HttpResponse(
                json.dumps({"error": "Task not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        business_name = client.business_name or client.name
        update_task_status(
            db,
            task,
            "REJECTED",
            decision_at=datetime.utcnow(),
            decision_reason=reason,
        )
        db.commit()
        task_dict = task_to_dict(task)
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Failed to reject task: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to reject task", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()

    try:
        publish_task_event(task_dict.get("clientId"), "task.status_changed", task_dict)
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Failed to publish task event: %s", exc)

    customer_email = task_dict.get("customerEmail")
    if customer_email:
        send_task_status_email(
            to_email=customer_email,
            decision="rejected",
            business_name=business_name,
            task=task_dict,
            reason=reason,
        )

    return func.HttpResponse(
        json.dumps({"ok": True}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )
