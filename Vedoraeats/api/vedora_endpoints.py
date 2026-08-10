import json
import logging
import re
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage

import azure.functions as func

from function_app import app
from shared.config import get_setting, get_smtp_settings
from shared.db import SessionLocal, VedoraLead
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ADMIN_EMAIL_DEFAULT = "support@vedoraeats.com"


def _clean(value, max_length=500):
    return str(value or "").strip()[:max_length]


def _parse_json_body(req: func.HttpRequest) -> dict:
    try:
        body = req.get_json()
    except ValueError:
        body = None
    return body or {}


def _json_response(payload, status_code, cors):
    return func.HttpResponse(
        json.dumps(payload),
        status_code=status_code,
        mimetype="application/json",
        headers=cors,
    )


def _valid_email(email):
    return bool(EMAIL_PATTERN.fullmatch(email or ""))


def _send_admin_email(subject, lines):
    smtp = get_smtp_settings()
    host = smtp.get("host")
    username = smtp.get("username")
    password = smtp.get("password")
    from_email = smtp.get("from_email")
    port = smtp.get("port")
    use_tls = smtp.get("use_tls", True)
    use_ssl = smtp.get("use_ssl", False)
    to_email = get_setting("VEDORA_ADMIN_EMAIL") or ADMIN_EMAIL_DEFAULT

    if not (host and from_email and to_email and port):
        logger.info("SMTP not configured for Vedora lead notification; lead stored without email notification.")
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.set_content("\n".join(lines))

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
        logger.warning("Failed to send Vedora lead notification: %s", exc)
        return False


def _store_lead(fields):
    db = SessionLocal()
    try:
        lead = VedoraLead(**fields)
        db.add(lead)
        db.commit()
        db.refresh(lead)
        return lead
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _mark_email_sent(lead_id):
    db = SessionLocal()
    try:
        lead = db.query(VedoraLead).filter_by(id=lead_id).one_or_none()
        if lead:
            lead.email_sent = True
            db.commit()
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.warning("Unable to mark Vedora lead %s email_sent: %s", lead_id, exc)
    finally:
        db.close()


@app.function_name(name="VedoraWaitlist")
@app.route(route="vedora/waitlist", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def vedora_waitlist(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    payload = _parse_json_body(req)
    first_name = _clean(payload.get("first_name") or payload.get("firstName"), 120)
    email = _clean(payload.get("email"), 254).lower()
    city = _clean(payload.get("city"), 140)
    interest_type = _clean(payload.get("interest_type") or payload.get("interestType") or "Customer", 80)

    if not first_name or not email or not city or not interest_type:
        return _json_response({"error": "first_name, email, city, and interest_type are required"}, 400, cors)

    if not _valid_email(email):
        return _json_response({"error": "Please provide a valid email address."}, 400, cors)

    try:
        lead = _store_lead(
            {
                "submission_type": "waitlist",
                "first_name": first_name,
                "email": email,
                "city": city,
                "interest_type": interest_type,
                "source": "vedora_landing",
                "metadata_json": {"user_agent": req.headers.get("User-Agent", "")[:400]},
            }
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to store Vedora waitlist submission: %s", exc)
        return _json_response({"error": "Unable to join the waitlist right now. Please try again later."}, 500, cors)

    now_iso = datetime.now(timezone.utc).isoformat()
    email_sent = _send_admin_email(
        "New Vedora waitlist signup",
        [
            "New Vedora waitlist signup received.",
            "",
            f"Submitted at (UTC): {now_iso}",
            f"Name: {first_name}",
            f"Email: {email}",
            f"City: {city}",
            f"Interested as: {interest_type}",
        ],
    )
    if email_sent:
        _mark_email_sent(lead.id)

    return _json_response({"ok": True, "id": lead.id, "email_sent": email_sent}, 200, cors)


@app.function_name(name="VedoraRestaurantInterest")
@app.route(route="vedora/restaurant-interest", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def vedora_restaurant_interest(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    payload = _parse_json_body(req)
    restaurant_name = _clean(payload.get("restaurant_name") or payload.get("restaurantName"), 180)
    contact_name = _clean(payload.get("contact_name") or payload.get("contactName"), 160)
    email = _clean(payload.get("email"), 254).lower()
    phone = _clean(payload.get("phone"), 80)
    city = _clean(payload.get("city"), 140)
    restaurant_website = _clean(payload.get("restaurant_website") or payload.get("website"), 320)
    restaurant_type = _clean(payload.get("restaurant_type") or payload.get("restaurantType"), 180)
    message = _clean(payload.get("message"), 3000)

    if not restaurant_name or not contact_name or not email or not city or not restaurant_type:
        return _json_response(
            {"error": "restaurant_name, contact_name, email, city, and restaurant_type are required"},
            400,
            cors,
        )

    if not _valid_email(email):
        return _json_response({"error": "Please provide a valid email address."}, 400, cors)

    try:
        lead = _store_lead(
            {
                "submission_type": "restaurant_interest",
                "email": email,
                "city": city,
                "interest_type": "Restaurant",
                "restaurant_name": restaurant_name,
                "contact_name": contact_name,
                "phone": phone,
                "restaurant_website": restaurant_website,
                "restaurant_type": restaurant_type,
                "message": message,
                "source": "vedora_landing",
                "metadata_json": {"user_agent": req.headers.get("User-Agent", "")[:400]},
            }
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to store Vedora restaurant interest submission: %s", exc)
        return _json_response({"error": "Unable to send partner interest right now. Please try again later."}, 500, cors)

    now_iso = datetime.now(timezone.utc).isoformat()
    email_sent = _send_admin_email(
        "New Vedora restaurant partner interest",
        [
            "New Vedora restaurant partner interest received.",
            "",
            f"Submitted at (UTC): {now_iso}",
            f"Restaurant: {restaurant_name}",
            f"Contact: {contact_name}",
            f"Email: {email}",
            f"Phone: {phone or '-'}",
            f"City: {city}",
            f"Website: {restaurant_website or '-'}",
            f"Type: {restaurant_type}",
            "",
            "Message:",
            message or "-",
        ],
    )
    if email_sent:
        _mark_email_sent(lead.id)

    return _json_response({"ok": True, "id": lead.id, "email_sent": email_sent}, 200, cors)
