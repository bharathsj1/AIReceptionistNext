from __future__ import annotations

import os
from urllib.parse import urlparse
from typing import Dict, Iterable, List, Set, Tuple

import azure.functions as func


def _raw_origins() -> str:
    return (
        os.getenv("ALLOWED_ORIGINS")
        or os.getenv("CORS")
        or os.getenv("CORS_ORIGIN")
        or os.getenv("CORS_ALLOWED_ORIGINS")
        or "http://localhost:5173"
    )


def _parse_origins(raw: str) -> List[str]:
    origins: List[str] = []
    for origin in raw.split(","):
        cleaned = origin.strip().rstrip("/")
        if not cleaned:
            continue
        if cleaned == "*":
            return ["*"]
        origins.append(cleaned)
    return origins


def _env_flag(names: Iterable[str], default: bool = False) -> bool:
    truthy = {"1", "true", "yes", "y"}
    falsy = {"0", "false", "no", "n"}
    for name in names:
        raw = os.getenv(name)
        if raw is None:
            continue
        lowered = raw.lower()
        if lowered in truthy:
            return True
        if lowered in falsy:
            return False
    return default


RAW_ALLOWED_ORIGINS = _raw_origins()
ALLOWED_ORIGINS = _parse_origins(RAW_ALLOWED_ORIGINS)
ALLOW_CREDENTIALS = _env_flag(
    ["CORS_ALLOW_CREDENTIALS", "CORS_ALLOW_CREDENTIAL", "CORS_CREDENTIALS", "CORSCredentials"]
)
ALLOW_LOCALHOST = _env_flag(["CORS_ALLOW_LOCALHOST", "ALLOW_LOCALHOST_CORS"], default=True)
DEFAULT_ALLOWED_HEADERS = [
    "Content-Type",
    "Authorization",
    "x-client-id",
    "x-tenant-id",
    "x-tenantid",
    "x-user-id",
    "x-user-email",
]


def _is_local_origin(origin: str | None) -> bool:
    _, host, _ = _split_origin(origin or "", default_scheme="https")
    if not host:
        return False
    return host in {"localhost", "127.0.0.1"}


def _split_origin(value: str, *, default_scheme: str | None = None) -> Tuple[str | None, str | None, int | None]:
    text = str(value or "").strip()
    if not text:
        return None, None, None

    candidate = text.rstrip("/")
    has_scheme = "://" in candidate
    if not has_scheme and default_scheme:
        candidate = f"{default_scheme}://{candidate}"

    parsed = urlparse(candidate)
    scheme = (parsed.scheme or "").lower()
    host = (parsed.hostname or "").lower()
    if not host:
        return None, None, None

    try:
        port = parsed.port
    except ValueError:
        return None, None, None

    return (scheme if has_scheme else None), host, port


def _normalized_port(scheme: str | None, port: int | None) -> int | None:
    if port is not None:
        return port
    if scheme == "https":
        return 443
    if scheme == "http":
        return 80
    return None


def _origin_matches(origin: str | None, allowed_origin: str) -> bool:
    if not origin or not allowed_origin:
        return False
    if allowed_origin == "*":
        return True

    origin_scheme, origin_host, origin_port = _split_origin(origin, default_scheme="https")
    if not origin_host:
        return False

    allowed_has_scheme = "://" in allowed_origin
    allowed_scheme, allowed_host, allowed_port = _split_origin(
        allowed_origin,
        default_scheme=None if allowed_has_scheme else "https",
    )
    if not allowed_host:
        return False

    if allowed_has_scheme and allowed_scheme and origin_scheme and origin_scheme != allowed_scheme:
        return False
    if allowed_port is not None:
        if _normalized_port(origin_scheme, origin_port) != _normalized_port(allowed_scheme, allowed_port):
            return False

    if allowed_host.startswith("*."):
        suffix = allowed_host[2:]
        return origin_host == suffix or origin_host.endswith(f".{suffix}")
    return origin_host == allowed_host


def _origin_in_allow_list(origin: str | None) -> bool:
    if not origin:
        return False
    return any(_origin_matches(origin, allowed_origin) for allowed_origin in ALLOWED_ORIGINS)


def _local_only_origins(origins: Iterable[str]) -> bool:
    cleaned = [origin for origin in origins if origin and origin != "*"]
    if not cleaned:
        return False
    return all(_is_local_origin(origin) for origin in cleaned)


def _allow_headers(req: func.HttpRequest) -> str:
    requested = req.headers.get("Access-Control-Request-Headers", "")
    merged: Dict[str, str] = {}

    for name in DEFAULT_ALLOWED_HEADERS:
        cleaned = name.strip()
        if cleaned:
            merged[cleaned.lower()] = cleaned

    for name in requested.split(","):
        cleaned = name.strip()
        if cleaned:
            merged.setdefault(cleaned.lower(), cleaned)

    return ", ".join(merged.values())


def build_cors_headers(req: func.HttpRequest, allowed_methods: Iterable[str]) -> Dict[str, str]:
    origin = req.headers.get("origin") or req.headers.get("Origin")
    seen: Set[str] = set()
    methods_list: List[str] = []
    for method in allowed_methods:
        normalized = method.strip().upper()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        methods_list.append(normalized)
    if "OPTIONS" not in seen:
        methods_list.append("OPTIONS")

    headers: Dict[str, str] = {"Vary": "Origin"}
    allow_all = "*" in ALLOWED_ORIGINS or not ALLOWED_ORIGINS or _local_only_origins(ALLOWED_ORIGINS)
    origin_allowed = allow_all or _origin_in_allow_list(origin)
    if not origin_allowed and ALLOW_LOCALHOST and _is_local_origin(origin):
        origin_allowed = True

    if origin_allowed:
        headers.update(
            {
                "Access-Control-Allow-Origin": origin if (ALLOW_CREDENTIALS and origin) else ("*" if allow_all else (origin or "*")),
                "Access-Control-Allow-Methods": ", ".join(methods_list),
                "Access-Control-Allow-Headers": _allow_headers(req),
                "Access-Control-Expose-Headers": "X-Conversation-Id",
            }
        )
        if ALLOW_CREDENTIALS:
            headers["Access-Control-Allow-Credentials"] = "true"
    return headers
