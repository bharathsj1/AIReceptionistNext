import logging
import os
import re

import azure.functions as func
from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import BlobServiceClient

from function_app import app

logger = logging.getLogger(__name__)


@app.route(route="storage/public/{container}/{*blob_path}", methods=["GET", "HEAD"], auth_level=func.AuthLevel.ANONYMOUS)
def public_storage_file(req):
    # Only intentionally public photo/social containers are readable. No raw storage API,
    # shared keys, SAS query strings, container listing or write methods are exposed.
    allowed = {os.getenv("BLOB_CONTAINER_PHOTOS", "employee-photos"), os.getenv("SOCIAL_MEDIA_CONTAINER", "social-media")}
    container = req.route_params.get("container", "")
    path = req.route_params.get("blob_path", "")
    if container not in allowed or not re.fullmatch(r"[A-Za-z0-9_./-]{1,2048}", path) or any(part in {".", ".."} for part in path.split("/")):
        return func.HttpResponse("Not found", status_code=404)
    connection = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not connection:
        return func.HttpResponse("Storage unavailable", status_code=503)
    try:
        client = BlobServiceClient.from_connection_string(connection).get_blob_client(container=container, blob=path)
        properties = client.get_blob_properties()
        headers = {"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff",
                   "Content-Security-Policy": "sandbox; default-src 'none'",
                   "Content-Length": str(properties.size), "ETag": str(properties.etag)}
        if req.method == "HEAD":
            return func.HttpResponse(status_code=200, headers=headers, mimetype=properties.content_settings.content_type or "application/octet-stream")
        return func.HttpResponse(client.download_blob().readall(), status_code=200, headers=headers,
                                 mimetype=properties.content_settings.content_type or "application/octet-stream")
    except ResourceNotFoundError:
        return func.HttpResponse("Not found", status_code=404)
    except Exception:
        logger.exception("Public media read failed")
        return func.HttpResponse("Storage unavailable", status_code=502)
