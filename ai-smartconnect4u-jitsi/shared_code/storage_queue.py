from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime
from typing import Any, Dict

from azure.storage.queue import QueueServiceClient

logger = logging.getLogger(__name__)

_QUEUE_NAME = os.getenv("PROCESSING_QUEUE_NAME", "meeting-audio-jobs")
_QUEUE_SERVICE: QueueServiceClient | None = None


class QueueConfigError(RuntimeError):
    pass


def _connection_string() -> str:
    conn = os.getenv("AZURE_STORAGE_CONNECTION_STRING") or os.getenv("AzureWebJobsStorage")
    if not conn:
        raise QueueConfigError("AZURE_STORAGE_CONNECTION_STRING (or AzureWebJobsStorage) is required")
    return conn


def _service() -> QueueServiceClient:
    global _QUEUE_SERVICE
    if _QUEUE_SERVICE is None:
        _QUEUE_SERVICE = QueueServiceClient.from_connection_string(_connection_string())
    return _QUEUE_SERVICE


def _queue_client():
    client = _service().get_queue_client(_QUEUE_NAME)
    try:
        client.create_queue()
    except Exception:  # pylint: disable=broad-except
        pass
    return client


def enqueue_processing_job(
    *,
    tenant_id: str,
    user_id: str,
    meeting_id: str,
    blob_name: str,
    content_type: str | None,
    filename: str | None,
    job_id: str | None = None,
) -> str:
    job = {
        "jobId": job_id or str(uuid.uuid4()),
        "tenantId": tenant_id,
        "userId": user_id,
        "meetingId": meeting_id,
        "blobName": blob_name,
        "contentType": content_type,
        "filename": filename,
        "createdAt": datetime.utcnow().isoformat(),
    }
    payload = json.dumps(job)
    _queue_client().send_message(payload)
    return job["jobId"]


def parse_queue_message(raw: str) -> Dict[str, Any]:
    try:
        return json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
