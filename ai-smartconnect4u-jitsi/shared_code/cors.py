from __future__ import annotations

import os
from typing import Dict, Iterable, List, Set

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
        cleaned = origin.strip()
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


def _is_local_origin(origin: str | None) -> bool:
    if not origin:
        return False
    return origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1")


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
    allow_all = "*" in ALLOWED_ORIGINS
    origin_allowed = allow_all or (origin and origin in ALLOWED_ORIGINS)
    if not origin_allowed and ALLOW_LOCALHOST and _is_local_origin(origin):
        origin_allowed = True

    if origin_allowed:
        headers.update(
            {
                "Access-Control-Allow-Origin": origin if (ALLOW_CREDENTIALS and origin) else ("*" if allow_all else (origin or "*")),
                "Access-Control-Allow-Methods": ", ".join(methods_list),
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Expose-Headers": "X-Conversation-Id",
            }
        )
        if ALLOW_CREDENTIALS:
            headers["Access-Control-Allow-Credentials"] = "true"
    return headers
