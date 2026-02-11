from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional, Tuple
from email.parser import BytesParser
from email.policy import default as default_policy

import azure.functions as func

from function_app import app
from shared_code.auth_context import AuthContext, AuthError, require_auth
from shared_code.cors import build_cors_headers
from shared_code import storage_tables
from shared_code import storage_blobs
from shared_code import storage_queue
from shared_code import openai_client

logger = logging.getLogger(__name__)
_user_uploads: dict = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _json_body(req: func.HttpRequest) -> Dict[str, Any]:
    try:
        return req.get_json()
    except ValueError:
        return {}


def _json_response(payload: dict, status: int, cors: dict) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(payload),
        status_code=status,
        mimetype="application/json",
        headers=cors,
    )


def _not_found(cors: dict) -> func.HttpResponse:
    return _json_response({"error": "not_found"}, 404, cors)


def _forbidden(cors: dict, message: str = "forbidden") -> func.HttpResponse:
    return _json_response({"error": message}, 403, cors)


def _parse_meeting_body(body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": body.get("title") or body.get("name") or "",
        "publicJoin": bool(body.get("publicJoin") or body.get("public") or False),
        "scheduledFor": body.get("scheduledFor") or body.get("scheduled_for") or None,
        "metadata": body.get("metadata") if isinstance(body.get("metadata"), dict) else None,
    }


def _extract_audio(req: func.HttpRequest) -> Tuple[Optional[bytes], Optional[str], Optional[str]]:
    """
    Support multipart/form-data (field name 'audio') and raw binary uploads.
    Returns (audio_bytes, filename, content_type)
    """
    content_type_header = req.headers.get("content-type") or req.headers.get("Content-Type") or ""
    body = req.get_body() or b""

    # Multipart form-data
    if "multipart/form-data" in content_type_header.lower() and body:
        try:
            parser = BytesParser(policy=default_policy)
            msg = parser.parsebytes(b"Content-Type: " + content_type_header.encode() + b"\r\n\r\n" + body)
            for part in msg.iter_parts():
                if part.get_content_disposition() == "form-data":
                    name = part.get_param("name", header="content-disposition")
                    if name == "audio":
                        filename = part.get_filename()
                        content_type = part.get_content_type()
                        data = part.get_payload(decode=True)
                        if data:
                            return data, filename, content_type
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Failed to parse multipart audio: %s", exc)

    # Raw body fallback
    if body:
        return body, None, req.headers.get("content-type")

    return None, None, None


def _meeting_for_public(entity: Dict[str, Any], include_private: bool = False) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "meetingId": entity.get("meetingId") or entity.get("RowKey"),
        "joinUrl": entity.get("joinUrl"),
        "jitsiRoomName": entity.get("jitsiRoomName"),
        "title": entity.get("title"),
        "status": entity.get("status"),
        "publicJoin": bool(entity.get("publicJoin", False)),
        "scheduledFor": entity.get("scheduledFor"),
        "lastUpdatedAt": entity.get("lastUpdatedAt"),
    }

    if include_private:
        payload["createdAt"] = entity.get("createdAt")
        payload["createdByUserId"] = entity.get("createdByUserId")
        metadata = entity.get("metadataJson")
        if metadata:
            try:
                payload["metadata"] = json.loads(metadata)
            except Exception:  # pylint: disable=broad-except
                payload["metadata"] = metadata

    return payload


def _load_transcript_text(artifacts: Dict[str, Any]) -> Optional[str]:
    transcript = artifacts.get("transcriptText")
    if transcript:
        return transcript
    blob_name = artifacts.get("transcriptBlobName")
    if blob_name:
        try:
            data = storage_blobs.download_blob(storage_blobs.artifacts_container_name(), blob_name)
            return data.decode("utf-8")
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Failed to download transcript blob %s: %s", blob_name, exc)
    return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.function_name(name="Meetings")
@app.route(route="meetings", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def meetings(req: func.HttpRequest) -> func.HttpResponse:
    """Combined handler to avoid route conflicts for GET and POST /meetings.

    GET: Public/unauthenticated allowed with tenantId parameter.
    POST: Auth required (same as before).
    """

    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    # ------------------------
    # GET /meetings (public)
    # ------------------------
    if req.method == "GET":
        tenant_id = (
            req.params.get("tenantId")
            or req.params.get("tenant_id")
            or req.params.get("clientId")
            or req.params.get("client_id")
        )
        include_private = False

        # Auth present? use it and include private fields for that tenant.
        try:
            auth_ctx = require_auth(req, cors)
            if not isinstance(auth_ctx, func.HttpResponse):
                tenant_id = tenant_id or auth_ctx.tenant_id
                include_private = True
        except Exception:
            auth_ctx = None

        try:
            if tenant_id:
                meetings = storage_tables.list_meetings(tenant_id=tenant_id, limit=50)
            else:
                meetings = storage_tables.list_public_meetings(limit=50)
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Failed to list meetings: %s", exc)
            return _json_response({"error": "failed_to_list", "details": str(exc)}, 500, cors)

        payload = [_meeting_for_public(m, include_private=include_private) for m in meetings]
        return _json_response({"meetings": payload}, 200, cors)

    # ------------------------
    # POST /meetings (auth)
    # ------------------------
    auth = require_auth(req, cors)
    if isinstance(auth, func.HttpResponse):
        return auth

    body = _json_body(req)
    parsed = _parse_meeting_body(body)

    try:
        meeting = storage_tables.create_meeting(
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            title=parsed.get("title"),
            scheduled_for=parsed.get("scheduledFor"),
            public_join=parsed.get("publicJoin", False),
            metadata=parsed.get("metadata"),
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to create meeting: %s", exc)
        return _json_response({"error": "failed_to_create", "details": str(exc)}, 500, cors)

    return _json_response(
        {
            "meetingId": meeting.get("meetingId"),
            "joinUrl": meeting.get("joinUrl"),
            "jitsiRoomName": meeting.get("jitsiRoomName"),
            "status": meeting.get("status"),
        },
        201,
        cors,
    )


@app.function_name(name="GetMeeting")
@app.route(route="meetings/{meetingId}", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def get_meeting(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    meeting_id = req.route_params.get("meetingId")
    auth_ctx: AuthContext | None = None
    tenant_id_param = (
        req.params.get("tenantId")
        or req.params.get("tenant_id")
        or req.params.get("clientId")
        or req.params.get("client_id")
    )
    try:
        auth_result = require_auth(req, cors)
        if not isinstance(auth_result, func.HttpResponse):
            auth_ctx = auth_result  # optional if tenant not provided for public join
    except Exception:
        auth_ctx = None

    meeting = None
    tenant_id = auth_ctx.tenant_id if auth_ctx else tenant_id_param

    if tenant_id:
        meeting = storage_tables.get_meeting(tenant_id, meeting_id)
    if meeting is None:
        found = storage_tables.find_meeting_by_id(meeting_id)
        if found:
            tenant_id, meeting = found

    if not meeting:
        return _not_found(cors)

    public_join = bool(meeting.get("publicJoin", False))
    if not public_join:
        if not auth_ctx:
            return _forbidden(cors, "tenant_mismatch_or_unauthorized")
        if tenant_id and tenant_id != auth_ctx.tenant_id:
            return _forbidden(cors, "tenant_mismatch_or_unauthorized")

    payload = _meeting_for_public(
        meeting,
        include_private=bool(auth_ctx and (tenant_id == auth_ctx.tenant_id)),
    )
    return _json_response(payload, 200, cors)


@app.function_name(name="UploadMeetingAudio")
@app.route(route="meetings/{meetingId}/audio", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def upload_meeting_audio(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    auth = require_auth(req, cors)
    if isinstance(auth, func.HttpResponse):
        return auth

    meeting_id = req.route_params.get("meetingId")
    meeting = storage_tables.get_meeting(auth.tenant_id, meeting_id)
    if not meeting:
        return _not_found(cors)

    # simple per-user rate limit: 3 uploads / 10 minutes
    now = datetime.utcnow().timestamp()
    window_seconds = 600
    max_uploads = 3
    _user_uploads.setdefault(auth.user_id, [])
    recent = [t for t in _user_uploads[auth.user_id] if now - t < window_seconds]
    if len(recent) >= max_uploads:
        return _json_response({"error": "rate_limited"}, 429, cors)

    audio_bytes, filename, content_type = _extract_audio(req)
    if filename is None:
        filename = "audio-upload"

    if not audio_bytes:
        return _json_response({"error": "audio file is required"}, 400, cors)

    try:
        blob_name = storage_blobs.upload_temp_audio(
            tenant_id=auth.tenant_id,
            meeting_id=meeting_id,
            filename=filename or "audio.wav",
            data=audio_bytes,
            content_type=content_type,
        )
        _user_uploads[auth.user_id] = recent + [now]
        job_id = storage_queue.enqueue_processing_job(
            tenant_id=auth.tenant_id,
            user_id=auth.user_id,
            meeting_id=meeting_id,
            blob_name=blob_name,
            content_type=content_type,
            filename=filename,
        )
        storage_tables.set_meeting_status(
            auth.tenant_id,
            meeting_id,
            "processing",
            audioBlobName=blob_name,
            latestJobId=job_id,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to enqueue audio for meeting %s: %s", meeting_id, exc)
        return _json_response({"error": "failed_to_enqueue", "details": str(exc)}, 500, cors)

    return _json_response({"jobId": job_id, "status": "processing"}, 202, cors)


@app.function_name(name="GetMeetingArtifacts")
@app.route(route="meetings/{meetingId}/artifacts", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def get_meeting_artifacts(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    auth = require_auth(req, cors)
    if isinstance(auth, func.HttpResponse):
        return auth

    meeting_id = req.route_params.get("meetingId")
    meeting = storage_tables.get_meeting(auth.tenant_id, meeting_id)
    if not meeting:
        return _not_found(cors)

    status = meeting.get("status")
    if status and status not in {"ready", "failed"}:
        return _json_response({"status": status}, 202, cors)

    artifacts = storage_tables.get_artifacts(auth.tenant_id, meeting_id)
    if not artifacts:
        return _json_response({"transcript": None, "summary": None, "tasks": None, "status": status or "created"}, 200, cors)

    transcript_text = _load_transcript_text(artifacts)
    summary_raw = artifacts.get("summaryJson")
    tasks_raw = artifacts.get("tasksJson")

    summary = None
    tasks = None
    if summary_raw:
        try:
            summary = summary_raw if isinstance(summary_raw, dict) else json.loads(summary_raw)
        except Exception:  # pylint: disable=broad-except
            summary = summary_raw
    if tasks_raw:
        try:
            tasks = tasks_raw if isinstance(tasks_raw, dict) else json.loads(tasks_raw)
        except Exception:  # pylint: disable=broad-except
            tasks = tasks_raw

    payload = {
        "transcript": transcript_text,
        "transcriptBlob": artifacts.get("transcriptBlobName"),
        "summary": summary,
        "tasks": tasks,
        "status": meeting.get("status"),
        "processedAt": artifacts.get("processedAt"),
        "language": artifacts.get("language"),
        "durationSeconds": artifacts.get("durationSeconds"),
    }
    return _json_response(payload, 200, cors)


@app.function_name(name="SummarizeMeeting")
@app.route(route="meetings/{meetingId}/summarize", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def summarize_meeting(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    auth = require_auth(req, cors)
    if isinstance(auth, func.HttpResponse):
        return auth

    meeting_id = req.route_params.get("meetingId")
    meeting = storage_tables.get_meeting(auth.tenant_id, meeting_id)
    if not meeting:
        return _not_found(cors)

    artifacts = storage_tables.get_artifacts(auth.tenant_id, meeting_id)
    if not artifacts:
        return _json_response({"error": "no_transcript"}, 400, cors)

    transcript_text = _load_transcript_text(artifacts)
    if not transcript_text:
        return _json_response({"error": "transcript_missing"}, 400, cors)

    try:
        summary = openai_client.summarize_transcript(transcript_text)
        incoming_tasks = summary.get("actionItems") if isinstance(summary, dict) else None
        existing_tasks_raw = artifacts.get("tasksJson")
        merged_tasks = incoming_tasks
        if existing_tasks_raw and isinstance(incoming_tasks, list):
            try:
                parsed_existing = existing_tasks_raw if isinstance(existing_tasks_raw, list) else json.loads(existing_tasks_raw)
            except Exception:  # pylint: disable=broad-except
                parsed_existing = []
            if isinstance(parsed_existing, list):
                merged_tasks = []
                for task in incoming_tasks:
                    match = next(
                        (
                            t
                            for t in parsed_existing
                            if str(t.get("task", "")).strip().lower() == str(task.get("task", "")).strip().lower()
                        ),
                        None,
                    )
                    merged = dict(task)
                    if match and match.get("done") is not None:
                        merged["done"] = match.get("done")
                    merged_tasks.append(merged)
        tasks = merged_tasks
        storage_tables.save_artifacts(
            tenant_id=auth.tenant_id,
            meeting_id=meeting_id,
            transcript_text=transcript_text,
            transcript_blob_name=artifacts.get("transcriptBlobName"),
            summary_json=summary,
            tasks_json=tasks,
            tasks_updated_at=datetime.utcnow().isoformat(),
        )
        storage_tables.set_meeting_status(auth.tenant_id, meeting_id, "ready")
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Resummarize failed for meeting %s: %s", meeting_id, exc)
        return _json_response({"error": "summarize_failed", "details": str(exc)}, 500, cors)

    return _json_response({"summary": summary, "tasks": tasks}, 200, cors)


@app.function_name(name="SaveMeetingTasks")
@app.route(route="meetings/{meetingId}/tasks", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def save_meeting_tasks(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    auth = require_auth(req, cors)
    if isinstance(auth, func.HttpResponse):
        return auth

    meeting_id = req.route_params.get("meetingId")
    meeting = storage_tables.get_meeting(auth.tenant_id, meeting_id)
    if not meeting:
        return _not_found(cors)

    body = _json_body(req)
    tasks = body.get("tasks") or body.get("tasksJson") or body

    try:
        storage_tables.save_artifacts(
            tenant_id=auth.tenant_id,
            meeting_id=meeting_id,
            transcript_text=None,
            transcript_blob_name=None,
            summary_json=None,
            tasks_json=tasks,
            tasks_updated_at=datetime.utcnow().isoformat(),
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to save tasks for meeting %s: %s", meeting_id, exc)
        return _json_response({"error": "failed_to_save_tasks", "details": str(exc)}, 500, cors)

    return _json_response({"ok": True, "tasks": tasks}, 200, cors)
