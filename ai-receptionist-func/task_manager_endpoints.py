import json
import logging
from datetime import datetime, timedelta
from typing import Optional

import azure.functions as func
from sqlalchemy import func as sa_func

from function_app import app
from shared.db import Client, ClientUser, SessionLocal, TaskManagerItem, User
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


def _normalize_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def _find_client_and_user(db, email: str) -> tuple[Optional[Client], Optional[User]]:
    normalized = _normalize_email(email)
    user = (
        db.query(User)
        .filter(sa_func.lower(sa_func.trim(User.email)) == normalized)
        .order_by(User.id.asc())
        .first()
    )
    client = (
        db.query(Client)
        .filter(sa_func.lower(sa_func.trim(Client.email)) == normalized)
        .order_by(Client.id.asc())
        .first()
    )
    client_user = (
        db.query(ClientUser)
        .filter(sa_func.lower(sa_func.trim(ClientUser.email)) == normalized)
        .order_by(ClientUser.id.asc())
        .first()
    )
    if not client and client_user:
        client = db.query(Client).filter_by(id=client_user.client_id).one_or_none()
    if not client and user:
        client = db.query(Client).filter_by(user_id=user.id).one_or_none()
    if client and not user and client.user_id:
        user = db.query(User).filter_by(id=client.user_id).one_or_none()
    return client, user


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=None)
    except ValueError:
        return None


def _item_to_dict(item: TaskManagerItem) -> dict:
    return {
        "id": item.id,
        "clientId": item.client_id,
        "userId": item.user_id,
        "sourceType": item.source_type,
        "sourceId": item.source_id,
        "title": item.title,
        "description": item.description,
        "start": item.start_time.isoformat() if item.start_time else None,
        "end": item.end_time.isoformat() if item.end_time else None,
        "status": item.status,
        "createdAt": item.created_at.isoformat() if item.created_at else None,
        "updatedAt": item.updated_at.isoformat() if item.updated_at else None,
    }


@app.function_name(name="TaskManager")
@app.route(route="task-manager", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def task_manager(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if req.method == "GET":
        email = req.params.get("email")
        if not email:
            return func.HttpResponse(
                json.dumps({"error": "email is required"}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        start_raw = req.params.get("from") or req.params.get("start")
        end_raw = req.params.get("to") or req.params.get("end")
        start_dt = _parse_iso(start_raw)
        end_dt = _parse_iso(end_raw)

        db = SessionLocal()
        try:
            client, _ = _find_client_and_user(db, email)
            if not client:
                return func.HttpResponse(
                    json.dumps({"error": "Client not found"}),
                    status_code=404,
                    mimetype="application/json",
                    headers=cors,
                )

            query = db.query(TaskManagerItem).filter(TaskManagerItem.client_id == client.id)
            if start_dt and end_dt:
                query = query.filter(
                    TaskManagerItem.start_time < end_dt, TaskManagerItem.end_time > start_dt
                )
            elif start_dt:
                query = query.filter(TaskManagerItem.end_time >= start_dt)
            elif end_dt:
                query = query.filter(TaskManagerItem.start_time <= end_dt)
            items = query.order_by(TaskManagerItem.start_time.asc()).limit(500).all()
            payload = [_item_to_dict(item) for item in items]
            return func.HttpResponse(
                json.dumps({"items": payload}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Failed to list task manager items: %s", exc)
            return func.HttpResponse(
                json.dumps({"error": "Failed to load task manager items", "details": str(exc)}),
                status_code=500,
                mimetype="application/json",
                headers=cors,
            )
        finally:
            db.close()

    try:
        body = req.get_json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        body = {}

    email = body.get("email")
    title = body.get("title")
    start_raw = body.get("start") or body.get("start_time")
    end_raw = body.get("end") or body.get("end_time")
    if not email or not title or not start_raw:
        return func.HttpResponse(
            json.dumps({"error": "email, title, and start are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    start_dt = _parse_iso(start_raw)
    end_dt = _parse_iso(end_raw) if end_raw else None
    if not start_dt:
        return func.HttpResponse(
            json.dumps({"error": "Invalid start date"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    if not end_dt:
        end_dt = start_dt + timedelta(hours=1)
    if end_dt <= start_dt:
        return func.HttpResponse(
            json.dumps({"error": "End time must be after start time"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        client, user = _find_client_and_user(db, email)
        if not client:
            return func.HttpResponse(
                json.dumps({"error": "Client not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        item = TaskManagerItem(
            client_id=client.id,
            user_id=user.id if user else None,
            source_type=body.get("sourceType") or body.get("source_type"),
            source_id=body.get("sourceId") or body.get("source_id"),
            title=str(title).strip(),
            description=body.get("description"),
            start_time=start_dt,
            end_time=end_dt,
            status=body.get("status") or "scheduled",
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        return func.HttpResponse(
            json.dumps({"item": _item_to_dict(item)}),
            status_code=201,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Failed to create task manager item: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to create task manager item", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="TaskManagerUpdate")
@app.route(route="task-manager/{item_id}", methods=["PUT", "DELETE", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def task_manager_update(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["PUT", "DELETE", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    item_id = req.route_params.get("item_id")
    try:
        item_id_int = int(item_id)
    except (TypeError, ValueError):
        item_id_int = None
    if not item_id_int:
        return func.HttpResponse(
            json.dumps({"error": "Invalid item id"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        if req.method == "DELETE":
            email = req.params.get("email")
            if not email:
                return func.HttpResponse(
                    json.dumps({"error": "email is required"}),
                    status_code=400,
                    mimetype="application/json",
                    headers=cors,
                )

            client, _ = _find_client_and_user(db, email)
            if not client:
                return func.HttpResponse(
                    json.dumps({"error": "Client not found"}),
                    status_code=404,
                    mimetype="application/json",
                    headers=cors,
                )

            item = (
                db.query(TaskManagerItem)
                .filter(TaskManagerItem.id == item_id_int, TaskManagerItem.client_id == client.id)
                .one_or_none()
            )
            if not item:
                return func.HttpResponse(
                    json.dumps({"error": "Task manager item not found"}),
                    status_code=404,
                    mimetype="application/json",
                    headers=cors,
                )

            db.delete(item)
            db.commit()
            return func.HttpResponse(
                json.dumps({"ok": True}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

        if req.method != "PUT":
            return func.HttpResponse(
                json.dumps({"error": "Unsupported method"}),
                status_code=405,
                mimetype="application/json",
                headers=cors,
            )

        try:
            body = req.get_json()
        except ValueError:
            body = None
        if not isinstance(body, dict):
            body = {}

        email = body.get("email")
        if not email:
            return func.HttpResponse(
                json.dumps({"error": "email is required"}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        start_dt = _parse_iso(body.get("start") or body.get("start_time"))
        end_dt = _parse_iso(body.get("end") or body.get("end_time"))

        client, _ = _find_client_and_user(db, email)
        if not client:
            return func.HttpResponse(
                json.dumps({"error": "Client not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        item = (
            db.query(TaskManagerItem)
            .filter(TaskManagerItem.id == item_id_int, TaskManagerItem.client_id == client.id)
            .one_or_none()
        )
        if not item:
            return func.HttpResponse(
                json.dumps({"error": "Task manager item not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        if isinstance(body.get("title"), str) and body.get("title").strip():
            item.title = body.get("title").strip()
        if "description" in body:
            item.description = body.get("description")
        if start_dt:
            item.start_time = start_dt
        if end_dt:
            item.end_time = end_dt
        if start_dt and end_dt and end_dt <= start_dt:
            return func.HttpResponse(
                json.dumps({"error": "End time must be after start time"}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )
        if isinstance(body.get("status"), str) and body.get("status").strip():
            item.status = body.get("status").strip()

        db.add(item)
        db.commit()
        return func.HttpResponse(
            json.dumps({"item": _item_to_dict(item)}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Failed to update task manager item: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to update task manager item", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()
