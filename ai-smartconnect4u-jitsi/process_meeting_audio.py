from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

import azure.functions as func

from function_app import app
from shared_code import openai_client, storage_blobs, storage_queue, storage_tables

logger = logging.getLogger(__name__)

_QUEUE_NAME = os.getenv("PROCESSING_QUEUE_NAME", "meeting-audio-jobs")


def _utc_iso(dt: datetime | None = None) -> str:
    dt = dt or datetime.utcnow().replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


@app.function_name(name="ProcessMeetingAudio")
@app.queue_trigger(
    arg_name="msg",
    queue_name=_QUEUE_NAME,
    connection="AzureWebJobsStorage",
)
def process_meeting_audio(msg: func.QueueMessage) -> None:
    raw = msg.get_body().decode("utf-8") if msg else "{}"
    payload = storage_queue.parse_queue_message(raw)
    tenant_id = payload.get("tenantId")
    meeting_id = payload.get("meetingId")
    blob_name = payload.get("blobName")
    job_id = payload.get("jobId") or msg.id if msg else None

    if not tenant_id or not meeting_id or not blob_name:
        logger.error("Queue message missing required fields: %s", raw)
        return

    def _fail(message: str, exc: Exception | None = None) -> None:
        logger.error("Processing failed for meeting %s: %s", meeting_id, message)
        if exc:
            logger.exception(exc)
        try:
            storage_tables.set_meeting_status(
                tenant_id,
                meeting_id,
                "failed",
                lastError=message,
                latestJobId=job_id,
            )
        except Exception as inner_exc:  # pylint: disable=broad-except
            logger.warning("Unable to mark meeting failed: %s", inner_exc)

    transcript_blob_name = None
    try:
        audio_bytes = storage_blobs.download_blob(storage_blobs.temp_container_name(), blob_name)
    except Exception as exc:  # pylint: disable=broad-except
        _fail(f"could not download audio blob {blob_name}", exc)
        storage_blobs.delete_blob(storage_blobs.temp_container_name(), blob_name)
        return

    try:
        transcript_text, language, duration = openai_client.transcribe_audio(audio_bytes, filename=payload.get("filename"))
        summary = openai_client.summarize_transcript(transcript_text)
        tasks = summary.get("actionItems") if isinstance(summary, dict) else None

        if transcript_text and len(transcript_text) > 12000:
            transcript_blob_name = storage_blobs.upload_artifact_text(
                tenant_id=tenant_id,
                meeting_id=meeting_id,
                text=transcript_text,
                suffix="txt",
            )
            transcript_to_store = None
        else:
            transcript_to_store = transcript_text

        storage_tables.save_artifacts(
            tenant_id=tenant_id,
            meeting_id=meeting_id,
            transcript_text=transcript_to_store,
            transcript_blob_name=transcript_blob_name,
            summary_json=summary,
            tasks_json=tasks,
            language=language,
            duration_seconds=duration,
            processed_at=_utc_iso(),
            tasks_updated_at=_utc_iso(),
        )

        storage_tables.set_meeting_status(
            tenant_id,
            meeting_id,
            "ready",
            processedAt=_utc_iso(),
            latestJobId=job_id,
            lastError=None,
        )
    except Exception as exc:  # pylint: disable=broad-except
        _fail(str(exc), exc)
    finally:
        try:
            storage_blobs.delete_blob(storage_blobs.temp_container_name(), blob_name)
        except Exception:  # pylint: disable=broad-except
            pass
