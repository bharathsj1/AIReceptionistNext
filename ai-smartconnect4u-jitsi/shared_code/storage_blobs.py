from __future__ import annotations

import io
import logging
import os
import uuid
from typing import Optional

from azure.storage.blob import BlobServiceClient, ContentSettings

logger = logging.getLogger(__name__)

_AUDIO_CONTAINER = os.getenv("TEMP_AUDIO_CONTAINER", "meeting-audio-temp")
_ARTIFACTS_CONTAINER = os.getenv("MEETING_ARTIFACTS_CONTAINER", "meeting-artifacts")

_BLOB_SERVICE: BlobServiceClient | None = None


class BlobConfigError(RuntimeError):
    pass


def _connection_string() -> str:
    conn = os.getenv("AZURE_STORAGE_CONNECTION_STRING") or os.getenv("AzureWebJobsStorage")
    if not conn:
        raise BlobConfigError("AZURE_STORAGE_CONNECTION_STRING (or AzureWebJobsStorage) is required")
    return conn


def _service() -> BlobServiceClient:
    global _BLOB_SERVICE
    if _BLOB_SERVICE is None:
        _BLOB_SERVICE = BlobServiceClient.from_connection_string(_connection_string())
    return _BLOB_SERVICE


def _container_client(name: str):
    client = _service().get_container_client(name)
    try:
        client.create_container()
    except Exception:  # pylint: disable=broad-except
        pass
    return client


def upload_temp_audio(*, tenant_id: str, meeting_id: str, filename: str, data: bytes, content_type: Optional[str]) -> str:
    container = _container_client(_AUDIO_CONTAINER)
    safe_name = filename or "audio.wav"
    blob_name = f"{tenant_id}/{meeting_id}/{uuid.uuid4().hex}-{safe_name}"
    content_settings = ContentSettings(content_type=content_type or "application/octet-stream")
    container.upload_blob(name=blob_name, data=data, content_settings=content_settings, overwrite=True)
    return blob_name


def download_blob(container: str, blob_name: str) -> bytes:
    blob_client = _service().get_blob_client(container=container, blob=blob_name)
    downloader = blob_client.download_blob()
    return downloader.readall()


def upload_artifact_text(*, tenant_id: str, meeting_id: str, text: str, suffix: str = "txt") -> str:
    container = _container_client(_ARTIFACTS_CONTAINER)
    blob_name = f"{tenant_id}/{meeting_id}/transcript.{suffix}"
    data = text.encode("utf-8")
    container.upload_blob(name=blob_name, data=io.BytesIO(data), overwrite=True, content_settings=ContentSettings(content_type="text/plain"))
    return blob_name


def delete_blob(container: str, blob_name: str) -> None:
    try:
        _service().get_blob_client(container=container, blob=blob_name).delete_blob()
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("delete_blob failed for %s/%s: %s", container, blob_name, exc)


def temp_container_name() -> str:
    return _AUDIO_CONTAINER


def artifacts_container_name() -> str:
    return _ARTIFACTS_CONTAINER
