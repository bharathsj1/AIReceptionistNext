import base64
import json
import logging
import mimetypes
import re
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage

import azure.functions as func

from function_app import app
from shared.config import get_smtp_settings
from tasks_shared import parse_json_body
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)

ADMIN_CAREERS_EMAIL = "admin@smartconnect4u.com"
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_CV_BYTES = 8 * 1024 * 1024
ALLOWED_CV_EXTENSIONS = {"pdf", "doc", "docx", "txt", "rtf"}


def _normalize_filename(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip())
    return safe.strip("._") or "resume"


def _decode_cv_file(filename: str, content_base64: str) -> tuple[bytes | None, str | None]:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in ALLOWED_CV_EXTENSIONS:
        return None, "Unsupported CV format. Use PDF, DOC, DOCX, TXT, or RTF."

    raw_input = str(content_base64 or "").strip()
    if not raw_input:
        return None, "CV file content is required."

    if "," in raw_input and raw_input.lower().startswith("data:"):
        raw_input = raw_input.split(",", 1)[1]

    try:
        decoded = base64.b64decode(raw_input, validate=True)
    except Exception:  # pylint: disable=broad-except
        return None, "Invalid CV file encoding."

    if not decoded:
        return None, "CV file is empty."

    if len(decoded) > MAX_CV_BYTES:
        return None, "CV file is too large. Maximum size is 8 MB."

    return decoded, None


def _send_career_email(
    *,
    name: str,
    email: str,
    phone: str,
    location: str,
    job_title: str,
    cover_letter: str,
    file_name: str,
    file_bytes: bytes,
) -> bool:
    smtp = get_smtp_settings()
    host = smtp.get("host")
    username = smtp.get("username")
    password = smtp.get("password")
    from_email = smtp.get("from_email")
    port = smtp.get("port")
    use_tls = smtp.get("use_tls", True)
    use_ssl = smtp.get("use_ssl", False)

    if not (host and from_email and port):
        logger.warning("SMTP not configured for careers; host=%s from_email=%s port=%s", host, from_email, port)
        return False

    now_iso = datetime.now(timezone.utc).isoformat()
    subject = f"Career Application - {job_title} - {name}"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = ADMIN_CAREERS_EMAIL
    msg["Reply-To"] = email
    msg.set_content(
        "\n".join(
            [
                "New career application received.",
                "",
                f"Submitted at (UTC): {now_iso}",
                f"Name: {name}",
                f"Email: {email}",
                f"Phone: {phone or '-'}",
                f"Location: {location or '-'}",
                f"Role: {job_title}",
                "",
                "Cover Letter:",
                cover_letter or "-",
            ]
        )
    )

    mime_type, _ = mimetypes.guess_type(file_name)
    if mime_type and "/" in mime_type:
        maintype, subtype = mime_type.split("/", 1)
    else:
        maintype, subtype = "application", "octet-stream"
    msg.add_attachment(file_bytes, maintype=maintype, subtype=subtype, filename=file_name)

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
        logger.error("Failed to send careers email: %s", exc)
        return False


@app.function_name(name="CareersApply")
@app.route(route="careers/apply", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def careers_apply(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    payload = parse_json_body(req)
    name = str(payload.get("name") or "").strip()
    email = str(payload.get("email") or "").strip()
    phone = str(payload.get("phone") or "").strip()
    location = str(payload.get("location") or "").strip()
    job_title = str(payload.get("job_title") or "").strip()
    cover_letter = str(payload.get("cover_letter") or "").strip()
    cv_file_name = _normalize_filename(str(payload.get("cv_file_name") or "resume.pdf"))
    cv_file_base64 = str(payload.get("cv_file_base64") or "").strip()

    if not name or not email or not job_title or not cv_file_base64:
        return func.HttpResponse(
            json.dumps({"error": "name, email, job_title, and cv file are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    if not EMAIL_PATTERN.fullmatch(email):
        return func.HttpResponse(
            json.dumps({"error": "Please provide a valid email address."}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    cv_bytes, cv_error = _decode_cv_file(cv_file_name, cv_file_base64)
    if cv_error:
        return func.HttpResponse(
            json.dumps({"error": cv_error}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    sent = _send_career_email(
        name=name,
        email=email,
        phone=phone,
        location=location,
        job_title=job_title,
        cover_letter=cover_letter,
        file_name=cv_file_name,
        file_bytes=cv_bytes or b"",
    )
    if not sent:
        return func.HttpResponse(
            json.dumps({"error": "Unable to submit your application right now. Please try again later."}),
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
