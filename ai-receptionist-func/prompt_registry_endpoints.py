import json
import logging
from typing import Any, Dict, Optional

import azure.functions as func

from function_app import app
from shared.db import Client, SessionLocal, User
from shared.prompt_registry import get_active_prompt, list_prompt_versions, set_active_version
from services.prompt_generation_service import (
    prepare_prompt_inputs,
    normalize_business_profile,
    build_knowledge_text,
)
from services.prompt_registry_service import generate_prompt_record
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


def _authorize_client_access(db, client_id: int, email: Optional[str]) -> tuple[Optional[Client], Optional[str]]:
    if not email:
        return None, "email is required"
    client = db.query(Client).filter_by(id=client_id).one_or_none()
    if not client:
        return None, "client not found"
    if client.email == email:
        return client, None
    user = db.query(User).filter_by(email=email).one_or_none()
    if user and client.user_id == user.id:
        return client, None
    return None, "unauthorized"


def _parse_json(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _normalize_task_param(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    lowered = str(value).strip().lower()
    if not lowered or lowered in {"null", "none"}:
        return None
    return str(value).strip()


def _build_prompt_inputs_from_client(client: Client) -> tuple[Dict[str, str], str]:
    website_data = _parse_json(client.website_data)
    raw_profile = website_data.get("business_profile") if isinstance(website_data.get("business_profile"), dict) else website_data
    profile = normalize_business_profile(raw_profile or {})
    if client.business_name and not profile.get("business_name"):
        profile["business_name"] = client.business_name
    if client.business_phone and not profile.get("contact_phone"):
        profile["contact_phone"] = client.business_phone
    knowledge_text = (
        website_data.get("knowledgeText")
        or website_data.get("knowledge_text")
        or website_data.get("raw_website_data")
    )
    normalized_knowledge = build_knowledge_text(knowledge_text, profile)
    return profile, normalized_knowledge


@app.function_name(name="PromptGenerate")
@app.route(route="prompts/generate", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def prompts_generate(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    payload = body or {}

    client_id = payload.get("clientId")
    category = payload.get("category")
    sub_type = payload.get("subType")
    task_type = _normalize_task_param(payload.get("taskType"))
    business_profile = payload.get("businessProfile")
    knowledge_text = payload.get("knowledgeText")
    email = payload.get("email")

    if not client_id or not sub_type:
        return func.HttpResponse(
            json.dumps({"error": "clientId and subType are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        client, auth_error = _authorize_client_access(db, int(client_id), email)
        if auth_error:
            return func.HttpResponse(
                json.dumps({"error": auth_error}),
                status_code=403,
                mimetype="application/json",
                headers=cors,
            )

        created_by = f"user:{email}" if email else "system"
        record, _ = generate_prompt_record(
            db,
            client_id=client.id,
            category=category,
            sub_type=sub_type,
            task_type=task_type,
            business_profile=business_profile,
            knowledge_text=knowledge_text,
            created_by=created_by,
        )
        db.commit()

        return func.HttpResponse(
            json.dumps(
                {
                    "ok": True,
                    "promptId": record.id if record else None,
                    "version": record.version if record else None,
                    "promptText": record.prompt_text if record else None,
                    "sourceDataHash": record.source_data_hash if record else None,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Prompt generation failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Prompt generation failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="PromptActive")
@app.route(route="prompts/active", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def prompts_active(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    client_id = req.params.get("clientId")
    sub_type = req.params.get("subType")
    task_type = _normalize_task_param(req.params.get("taskType"))
    email = req.params.get("email")
    include_text = (req.params.get("includeText") or "").lower() == "true"
    include_status = (req.params.get("includeStatus") or "").lower() == "true"

    if not client_id or not sub_type:
        return func.HttpResponse(
            json.dumps({"error": "clientId and subType are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        client, auth_error = _authorize_client_access(db, int(client_id), email)
        if auth_error:
            return func.HttpResponse(
                json.dumps({"error": auth_error}),
                status_code=403,
                mimetype="application/json",
                headers=cors,
            )

        prompt = get_active_prompt(db, client.id, sub_type, task_type)
        if not prompt:
            return func.HttpResponse(
                json.dumps({"ok": True, "prompt": None}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

        response = {
            "id": prompt.id,
            "clientId": prompt.client_id,
            "category": prompt.category,
            "subType": prompt.sub_type,
            "taskType": prompt.task_type,
            "version": prompt.version,
            "isActive": prompt.is_active,
            "promptHash": prompt.prompt_hash,
            "sourceDataHash": prompt.source_data_hash,
            "createdAt": prompt.created_at.isoformat() if prompt.created_at else None,
            "updatedAt": prompt.updated_at.isoformat() if prompt.updated_at else None,
        }
        if include_text:
            response["promptText"] = prompt.prompt_text
        if include_status:
            profile, knowledge = _build_prompt_inputs_from_client(client)
            normalized_task = task_type or prompt.task_type
            _, _, _, source_hash = prepare_prompt_inputs(
                category=prompt.category,
                sub_type=prompt.sub_type,
                task_type=normalized_task,
                business_profile=profile,
                knowledge_text=knowledge,
            )
            response["status"] = "up_to_date" if source_hash == prompt.source_data_hash else "needs_regen"
        return func.HttpResponse(
            json.dumps({"ok": True, "prompt": response}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="PromptHistory")
@app.route(route="prompts/history", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def prompts_history(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    client_id = req.params.get("clientId")
    sub_type = req.params.get("subType")
    task_type = _normalize_task_param(req.params.get("taskType"))
    email = req.params.get("email")

    if not client_id or not sub_type:
        return func.HttpResponse(
            json.dumps({"error": "clientId and subType are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        client, auth_error = _authorize_client_access(db, int(client_id), email)
        if auth_error:
            return func.HttpResponse(
                json.dumps({"error": auth_error}),
                status_code=403,
                mimetype="application/json",
                headers=cors,
            )

        prompts = list_prompt_versions(db, client.id, sub_type, task_type)
        payload = [
            {
                "id": prompt.id,
                "clientId": prompt.client_id,
                "category": prompt.category,
                "subType": prompt.sub_type,
                "taskType": prompt.task_type,
                "version": prompt.version,
                "isActive": prompt.is_active,
                "promptHash": prompt.prompt_hash,
                "sourceDataHash": prompt.source_data_hash,
                "createdAt": prompt.created_at.isoformat() if prompt.created_at else None,
                "updatedAt": prompt.updated_at.isoformat() if prompt.updated_at else None,
            }
            for prompt in prompts
        ]
        return func.HttpResponse(
            json.dumps({"ok": True, "prompts": payload}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="PromptActivate")
@app.route(route="prompts/activate", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def prompts_activate(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    payload = body or {}

    client_id = payload.get("clientId")
    sub_type = payload.get("subType")
    task_type = _normalize_task_param(payload.get("taskType"))
    version = payload.get("version")
    email = payload.get("email")

    if not client_id or not sub_type or version is None:
        return func.HttpResponse(
            json.dumps({"error": "clientId, subType, and version are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        _, auth_error = _authorize_client_access(db, int(client_id), email)
        if auth_error:
            return func.HttpResponse(
                json.dumps({"error": auth_error}),
                status_code=403,
                mimetype="application/json",
                headers=cors,
            )

        record = set_active_version(db, int(client_id), sub_type, task_type, int(version))
        if not record:
            return func.HttpResponse(
                json.dumps({"error": "version not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        db.commit()
        return func.HttpResponse(
            json.dumps({"ok": True, "promptId": record.id, "version": record.version}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Prompt activation failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Prompt activation failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()
