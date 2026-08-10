import os
from typing import Iterable

import azure.functions as func


def _allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS") or os.getenv("CORS") or "*"
    origins = [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]
    return origins or ["*"]


def build_cors_headers(req: func.HttpRequest, allowed_methods: Iterable[str]) -> dict:
    origin = req.headers.get("origin") or req.headers.get("Origin") or ""
    allowed = _allowed_origins()
    allow_origin = "*"
    if "*" not in allowed:
        normalized = origin.rstrip("/")
        allow_origin = normalized if normalized in allowed else allowed[0]

    requested_headers = req.headers.get("Access-Control-Request-Headers", "")
    allowed_headers = "Content-Type, Authorization"
    if requested_headers:
        allowed_headers = f"{allowed_headers}, {requested_headers}"

    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Methods": ", ".join(sorted({method.upper() for method in allowed_methods})),
        "Access-Control-Allow-Headers": allowed_headers,
    }
