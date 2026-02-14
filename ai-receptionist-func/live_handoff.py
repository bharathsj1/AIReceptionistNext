from __future__ import annotations

import json
import os
import re
import logging
from typing import Any, Dict, List

import azure.functions as func
import requests

from function_app import app
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _format_conversation(conversation: List[Dict[str, Any]]) -> str:
    lines = []
    for msg in conversation[-15:]:
        role = msg.get("role") or "?"
        content = msg.get("content") or ""
        lines.append(f"- {role}: {content}")
    return "\n".join(lines)


@app.function_name(name="LiveHandoff")
@app.route(route="live-handoff", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def live_handoff(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        data = req.get_json()
    except ValueError:
        data = {}

    name = _text(data.get("name")) or "Unknown"
    email = _text(data.get("email"))
    company = _text(data.get("company"))
    message = _text(data.get("message"))
    conversation = data.get("conversation") or []

    if not email:
        match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", message)
        if match:
            email = match.group(0)

    webhook = os.getenv("SLACK_WEBHOOK_URL")
    if not webhook:
        logger.error("SLACK_WEBHOOK_URL not configured")
        return func.HttpResponse(
            json.dumps({"error": "server_not_configured"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )

    text_lines = [
        "*Live agent handoff requested*",
        f"• Name: {name}",
        f"• Email: {email or 'Unknown'}",
        f"• Company: {company or 'Unknown'}",
        f"• Last message: {message or '(none)'}",
    ]
    convo_block = _format_conversation(conversation)
    if convo_block:
        text_lines.append("")
        text_lines.append("*Recent conversation:*")
        text_lines.append(convo_block)

    payload = {"text": "\n".join(text_lines)}

    try:
        resp = requests.post(webhook, json=payload, timeout=6)
        resp.raise_for_status()
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to post to Slack: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "handoff_failed"}),
            status_code=502,
            mimetype="application/json",
            headers=cors,
        )

    return func.HttpResponse(
        json.dumps({"status": "ok"}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )
