import json
import logging
import smtplib
import ssl
from email.message import EmailMessage
from typing import Optional

import azure.functions as func

from function_app import app
from tasks_shared import parse_json_body
from utils.cors import build_cors_headers
from shared.config import get_smtp_settings

logger = logging.getLogger(__name__)


def _send_contact_email(*, name: str, email: str, message: str, support_email: str) -> bool:
    smtp = get_smtp_settings()
    host = smtp.get("host")
    username = smtp.get("username")
    password = smtp.get("password")
    from_email = smtp.get("from_email")
    port = smtp.get("port")
    use_tls = smtp.get("use_tls", True)
    use_ssl = smtp.get("use_ssl", False)

    if not (host and from_email and support_email and port):
        logger.warning("SMTP not configured; host=%s from_email=%s port=%s", host, from_email, port)
        return False

    msg = EmailMessage()
    msg["Subject"] = "New contact form submission"
    msg["From"] = from_email
    msg["To"] = support_email
    msg.set_content(f"Name: {name}\nEmail: {email}\n\nMessage:\n{message}")

    try:
        if use_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context) as server:
                if username and password:
                    server.login(username, password)
                server.send_message(msg)
                return True
        with smtplib.SMTP(host, port) as server:
            if use_tls:
                server.starttls(context=ssl.create_default_context())
            if username and password:
                server.login(username, password)
            server.send_message(msg)
            return True
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to send contact email: %s", exc)
        return False


@app.function_name(name="ContactMessage")
@app.route(route="contact-message", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def contact_message(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    payload = parse_json_body(req)
    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip()
    message = (payload.get("message") or "").strip()
    if not name or not email or not message:
        return func.HttpResponse(
            json.dumps({"error": "name, email, and message are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    sent = _send_contact_email(
        name=name,
        email=email,
        message=message,
        support_email="support@smartconnect4u.com",
    )
    if not sent:
        return func.HttpResponse(
            json.dumps({"error": "Unable to send message. Please try again later."}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )

    return func.HttpResponse(
        json.dumps({"ok": True}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )
