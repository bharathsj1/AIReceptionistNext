"""Expose public media through this backend without publishing the storage API."""
from urllib.parse import quote, unquote, urlsplit

from shared.config import get_public_api_base

PUBLIC_PREFIX = "/api/storage/public/"


def blob_reference(url):
    parsed = urlsplit(str(url or ""))
    path = unquote(parsed.path)
    if path.startswith(PUBLIC_PREFIX):
        path = path[len(PUBLIC_PREFIX):]
    elif parsed.hostname in {"azurite", "localhost", "127.0.0.1"} and parsed.port == 10000:
        path = path.lstrip("/").split("/", 1)[-1]  # Emulator account prefix.
    else:
        path = path.lstrip("/")
    parts = path.split("/", 1)
    return tuple(parts) if len(parts) == 2 else (None, None)


def public_blob_url(url):
    if not url:
        return url
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    if host.endswith(".azurewebsites.net") and parsed.path.startswith("/api/social/media/"):
        return f"{get_public_api_base()}{parsed.path}"
    emulator = host in {"azurite", "localhost", "127.0.0.1"} and parsed.port == 10000
    if not emulator and not host.endswith(".blob.core.windows.net"):
        return url
    container, blob_name = blob_reference(url)
    if not container or not blob_name:
        return url
    return f"{get_public_api_base()}{PUBLIC_PREFIX}{quote(container, safe='')}/{quote(blob_name, safe='/')}"
