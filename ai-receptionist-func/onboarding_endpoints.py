import hashlib
import json
import logging
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta
from typing import Dict, Tuple
from urllib.parse import parse_qs, urlparse

import azure.functions as func
from twilio.rest import Client as TwilioClient
from function_app import app

from auth_endpoints import _generate_reset_token  # pylint: disable=protected-access
from crawler_endpoints import crawl_site
from services.ultravox_service import create_ultravox_agent, create_ultravox_call, list_ultravox_agents
from shared.config import get_required_setting, get_setting, get_smtp_settings
from shared.db import Client, PhoneNumber, SessionLocal, User, init_db

logger = logging.getLogger(__name__)

# Ensure tables exist on cold start
init_db()


def get_site_summary(website_url: str, max_pages: int = 3) -> Tuple[str, str]:
    """Crawl the site and return (name_guess, summary_text)."""
    pages = crawl_site(website_url, max_pages=max_pages)
    if not pages:
        raise ValueError("No crawlable pages found for the website.")

    name_guess = pages[0].get("title") or urlparse(website_url).netloc
    contents = [page.get("content") for page in pages if page.get("content")]
    summary = "\n\n".join(contents)
    return name_guess, summary


def purchase_twilio_number(twilio_client: TwilioClient, webhook_base: str, country: str) -> Dict[str, str]:
    """
    Buy a Twilio number and configure its voice webhook.
    On trial accounts (only one number allowed), reuses the existing number if purchase fails.
    """
    webhook_url = _build_twilio_voice_webhook(webhook_base)
    available = twilio_client.available_phone_numbers(country).local.list(voice_enabled=True, limit=1)
    if not available:
        raise RuntimeError(f"No Twilio numbers available for purchase in {country}")

    chosen = available[0]
    try:
        purchased = twilio_client.incoming_phone_numbers.create(
            phone_number=chosen.phone_number,
            voice_url=webhook_url,
            voice_method="POST",
        )
        return {"phone_number": purchased.phone_number, "sid": purchased.sid}
    except Exception as exc:  # pylint: disable=broad-except
        error_text = str(exc)
        # Trial restriction hit: try to reuse the existing active number.
        existing_numbers = twilio_client.incoming_phone_numbers.list(limit=1)
        if not existing_numbers:
            raise RuntimeError("Twilio trial account has no existing number to reuse") from exc
        existing = existing_numbers[0]
        # Ensure webhook is configured to our function endpoint.
        existing.update(voice_url=webhook_url, voice_method="POST")
        return {"phone_number": existing.phone_number, "sid": existing.sid}


def _build_twilio_voice_webhook(webhook_base: str) -> str:
    """
    Normalize the Twilio voice webhook URL to end with /api/twilio/incoming exactly once.
    Prevents accidental duplication like .../api/twilio/incoming/api/twilio/incoming.
    """
    base = (webhook_base or "").rstrip("/")
    suffix = "/api/twilio/incoming"
    if base.endswith(suffix):
        base = base[: -len(suffix)]
    return base.rstrip("/") + suffix


def get_twilio_client() -> TwilioClient:
    """Instantiate a Twilio REST client from environment variables."""
    account_sid = get_required_setting("TWILIO_ACCOUNT_SID")
    auth_token = get_required_setting("TWILIO_AUTH_TOKEN")
    return TwilioClient(account_sid, auth_token)


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return f"{salt}${hashed}"


def _ensure_user_with_temp_password(db, email: str) -> Tuple[User, str | None]:
    """
    Find or create a user for the given email.
    Always issue a fresh temporary password and update the hash,
    so it can be shared with the user for login.
    """
    user = db.query(User).filter_by(email=email).one_or_none()
    temp_password = secrets.token_urlsafe(10)
    hashed = _hash_password(temp_password)
    if user:
        user.password_hash = hashed
        return user, temp_password
    # New user
    user = User(email=email, password_hash=hashed)
    db.add(user)
    db.flush()
    return user, temp_password


def _send_temp_password_email(email: str, temp_password: str, phone_number: str | None, website_url: str | None) -> bool:
    """
    Send a simple email with the temporary password.
    Returns True on success, False on failure.
    """
    smtp = get_smtp_settings()
    if not smtp.get("host") or not smtp.get("username") or not smtp.get("password"):
        logger.warning("SMTP not configured; skipping temp password email.")
        return False

    subject = "Your AI Receptionist account is ready"
    phone_line = f"Your AI number: {phone_number}" if phone_number else "Your AI number will follow shortly."
    body = (
        f"Hi,\n\n"
        f"Your AI receptionist has been provisioned for {website_url or 'your site'}.\n"
        f"Temporary password: {temp_password}\n"
        f"{phone_line}\n\n"
        "Use this password to sign in and complete setup. Please change it after logging in.\n\n"
        "Thanks,\nAI Receptionist Team\n"
    )
    message = f"From: {smtp['from_email']}\r\nTo: {email}\r\nSubject: {subject}\r\n\r\n{body}"

    host = smtp["host"]
    use_tls = smtp.get("use_tls", True)
    use_ssl = smtp.get("use_ssl", False)
    port = smtp.get("port")

    # Choose sensible defaults if no port provided.
    if port is None:
        port = 465 if use_ssl else (587 if use_tls else 25)

    def _send():
        if use_ssl:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context) as server:
                code, capabilities = server.ehlo()
                logger.debug("SMTP EHLO (SSL) response code: %s, capabilities: %s", code, capabilities)
                if smtp.get("username") and not server.has_extn("auth"):
                    raise RuntimeError("SMTP AUTH not supported on this endpoint/port.")
                if smtp.get("username"):
                    server.login(smtp["username"], smtp["password"])
                server.sendmail(smtp["from_email"], [email], message.encode("utf-8"))
        else:
            context = ssl.create_default_context() if use_tls else None
            with smtplib.SMTP(host, port) as server:
                code, capabilities = server.ehlo()
                logger.debug("SMTP EHLO response code: %s, capabilities: %s", code, capabilities)
                if use_tls:
                    server.starttls(context=context)
                    code_tls, capabilities_tls = server.ehlo()
                    logger.debug("SMTP EHLO after STARTTLS code: %s, capabilities: %s", code_tls, capabilities_tls)
                if smtp.get("username") and not server.has_extn("auth"):
                    raise RuntimeError("SMTP AUTH not supported on this endpoint/port.")
                if smtp.get("username"):
                    server.login(smtp["username"], smtp["password"])
                server.sendmail(smtp["from_email"], [email], message.encode("utf-8"))

    try:
        _send()
        return True
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("First attempt to send temp password email failed: %s", exc)
        try:
            _send()  # Retry once in case of transient disconnects.
            return True
        except Exception as exc2:  # pylint: disable=broad-except
            logger.error("Failed to send temp password email after retry: %s", exc2)
            return False


@app.function_name(name="UltravoxAgents")
@app.route(route="ultravox/agents", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def ultravox_agents(req: func.HttpRequest) -> func.HttpResponse:
    """List available Ultravox agents (simple helper endpoint)."""
    limit_param = req.params.get("limit")
    try:
        limit = int(limit_param) if limit_param else 20
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid 'limit' parameter"}),
            status_code=400,
            mimetype="application/json",
        )

    try:
        agents = list_ultravox_agents(limit=limit)
        return func.HttpResponse(
            json.dumps({"agents": agents}),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to list Ultravox agents: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to list Ultravox agents", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
        )


@app.function_name(name="ClientsProvision")
@app.route(route="clients/provision", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def clients_provision(req: func.HttpRequest) -> func.HttpResponse:
    """
    Provision a client: crawl website, create Ultravox agent, buy Twilio number, and persist records.
    """
    try:
        body = req.get_json()
    except ValueError:
        body = None

    email = body.get("email") if isinstance(body, dict) else None
    website_url = body.get("website_url") if isinstance(body, dict) else None
    system_prompt = body.get("system_prompt") if isinstance(body, dict) else None

    if not email or not website_url:
        return func.HttpResponse(
            json.dumps({"error": "Missing required fields: email, website_url"}),
            status_code=400,
            mimetype="application/json",
        )

    db = SessionLocal()
    try:
        name_guess, summary = get_site_summary(website_url)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to crawl site: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": f"Failed to crawl site: {exc}"}),
            status_code=500,
            mimetype="application/json",
        )

    try:
        client_record: Client = db.query(Client).filter_by(email=email).one_or_none()
        if client_record:
            client_record.website_url = website_url
            if name_guess:
                client_record.name = name_guess
        else:
            client_record = Client(email=email, website_url=website_url, name=name_guess)
            db.add(client_record)
            db.flush()

        # Link to an existing user if present; do not create new accounts here.
        user = db.query(User).filter_by(email=email).one_or_none()
        client_record.user_id = user.id if user else client_record.user_id

        if not client_record.ultravox_agent_id:
            agent_name = name_guess or email
            try:
                # Payload builder includes overrides when provided.
                agent_id = create_ultravox_agent(
                    agent_name,
                    website_url,
                    summary,
                    system_prompt_override=system_prompt if isinstance(system_prompt, str) else None,
                )
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("Ultravox agent creation failed: %s", exc)
                return func.HttpResponse(
                    json.dumps(
                        {
                            "error": "Failed to create Ultravox agent",
                            "details": str(exc),
                        }
                    ),
                    status_code=500,
                    mimetype="application/json",
                )
            client_record.ultravox_agent_id = agent_id

        phone_record: PhoneNumber = (
            db.query(PhoneNumber).filter_by(client_id=client_record.id, is_active=True).one_or_none()
        )
        if not phone_record:
            try:
                twilio_client = get_twilio_client()
                default_country = get_setting("TWILIO_DEFAULT_COUNTRY") or "US"
                webhook_base = get_required_setting("TWILIO_INBOUND_WEBHOOK_PUBLIC_URL")
                purchased = purchase_twilio_number(twilio_client, webhook_base, default_country)
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("Twilio number purchase failed: %s", exc)
                return func.HttpResponse(
                    json.dumps(
                        {
                            "error": "Failed to purchase Twilio number",
                            "details": str(exc),
                        }
                    ),
                    status_code=500,
                    mimetype="application/json",
                )

            phone_record = PhoneNumber(
                client_id=client_record.id,
                twilio_phone_number=purchased["phone_number"],
                twilio_sid=purchased["sid"],
                is_active=True,
            )
            db.add(phone_record)

        db.commit()

        response_payload = {
            "client_id": client_record.id,
            "name": client_record.name,
            "email": client_record.email,
            "website_url": client_record.website_url,
            "ultravox_agent_id": client_record.ultravox_agent_id,
            "phone_number": phone_record.twilio_phone_number,
            "twilio_sid": phone_record.twilio_sid,
        }
        return func.HttpResponse(json.dumps(response_payload), status_code=200, mimetype="application/json")
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Provisioning failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Provisioning failed"}),
            status_code=500,
            mimetype="application/json",
        )
    finally:
        db.close()


@app.function_name(name="TwilioIncoming")
@app.route(route="twilio/incoming", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def twilio_incoming(req: func.HttpRequest) -> func.HttpResponse:
    """
    Handle inbound Twilio webhook and connect caller to Ultravox via Twilio Streams.
    TODO: add Twilio signature validation.
    """
    try:
        raw_body = req.get_body().decode("utf-8")
    except Exception:  # pylint: disable=broad-except
        raw_body = ""

    logger.info("TwilioIncoming invoked. Headers=%s RawBody=%s", dict(req.headers), raw_body)

    params = parse_qs(raw_body)

    def _first_non_empty(keys):
        for key in keys:
            val = params.get(key, [None])[0]
            if val:
                return val
        return None

    # Twilio can send To/From for PSTN and Called/Caller for client calls; normalize them.
    to_number = _first_non_empty(["To", "Called"])
    from_number = _first_non_empty(["From", "Caller"])

    logger.info("TwilioIncoming normalized params. To=%s From=%s RawParams=%s", to_number, from_number, params)

    if not to_number:
        logger.error("TwilioIncoming: missing 'To' or 'Called' in request body: %s", params)
        return func.HttpResponse(
            '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Configuration error: no destination number was provided.</Say></Response>',
            status_code=200,
            mimetype="text/xml",
        )

    db = SessionLocal()
    try:
        phone_record: PhoneNumber = (
            db.query(PhoneNumber).filter_by(twilio_phone_number=to_number, is_active=True).one_or_none()
        )
        if not phone_record:
            logger.error("TwilioIncoming: no phone record for To=%s", to_number)
            return func.HttpResponse(
                json.dumps({"error": "No client found for this number"}),
                status_code=404,
                mimetype="application/json",
            )

        client_record: Client = db.query(Client).filter_by(id=phone_record.client_id).one()
        if not client_record.ultravox_agent_id:
            logger.error(
                "TwilioIncoming: missing Ultravox agent id for client_id=%s To=%s", client_record.id, to_number
            )
            return func.HttpResponse(
                json.dumps({"error": "Client is missing an Ultravox agent"}),
                status_code=500,
                mimetype="application/json",
            )

        try:
            join_url = create_ultravox_call(client_record.ultravox_agent_id, caller_number=from_number or "")
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Failed to create Ultravox call: %s", exc)
            return func.HttpResponse(
                json.dumps({"error": "Failed to create Ultravox call"}),
                status_code=500,
                mimetype="application/json",
            )

        logger.info(
            "TwilioIncoming success. To=%s From=%s client_id=%s agent_id=%s join_url=%s",
            to_number,
            from_number,
            client_record.id,
            client_record.ultravox_agent_id,
            join_url,
        )

        twiml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            "<Response>"
            "<Connect>"
            f'<Stream url="{join_url}"/>'
            "</Connect>"
            "</Response>"
        )
        return func.HttpResponse(twiml, status_code=200, mimetype="text/xml")
    finally:
        db.close()
