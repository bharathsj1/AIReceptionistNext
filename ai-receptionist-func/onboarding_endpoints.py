import hashlib
import ipaddress
import json
import logging
import random
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import azure.functions as func
import httpx
from twilio.rest import Client as TwilioClient
from function_app import app

from auth_endpoints import _generate_reset_token  # pylint: disable=protected-access
from crawler_endpoints import crawl_site
from services.ultravox_service import (
    create_ultravox_agent,
    create_ultravox_call,
    ensure_tasks_tool,
    list_ultravox_agents,
    update_ultravox_agent_prompt,
)
from services.call_service import upsert_call, attach_ultravox_call, update_call_status
from shared.config import get_public_api_base, get_required_setting, get_setting, get_smtp_settings
from shared.db import Client, PhoneNumber, SessionLocal, Subscription, User, init_db
from services.prompt_registry_service import resolve_prompt_for_call
from utils.cors import build_cors_headers

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


def _is_valid_url(website_url: str | None) -> bool:
    if not website_url or not isinstance(website_url, str):
        return False
    parsed = urlparse(website_url)
    return bool(parsed.scheme and parsed.netloc)


def _build_manual_summary(body: dict) -> Tuple[str, str]:
    name_guess = (
        body.get("business_name")
        or body.get("businessName")
        or body.get("name")
        or body.get("email")
        or "Manual Business"
    )
    summary_lines = [
        body.get("business_summary"),
        body.get("business_services"),
        body.get("business_hours"),
        body.get("business_location"),
        body.get("business_notes"),
        body.get("business_phone"),
        body.get("business_email"),
    ]
    filtered = [line for line in summary_lines if isinstance(line, str) and line.strip()]
    return name_guess, "\n".join(filtered)


def _build_summary_from_client(client: Client, user: User | None) -> Tuple[str, str]:
    payload = {
        "business_name": client.business_name or (user.business_name if user else None),
        "name": client.name or client.business_name or (user.business_name if user else None),
        "email": client.email,
        "business_phone": client.business_phone or (user.business_number if user else None),
        "business_email": client.email,
        "business_notes": client.notes,
        "business_summary": client.website_data,
        "business_location": None,
        "business_services": None,
        "business_hours": None,
    }
    return _build_manual_summary(payload)


def _dynamic_prompts_enabled() -> bool:
    flag = str(get_setting("ENABLE_DYNAMIC_PROMPTS", "") or "").strip().lower()
    return flag in {"1", "true", "yes", "on"}


def _normalize_ip(raw: str | None) -> Optional[str]:
    if not raw:
        return None
    candidate = raw.strip()
    if not candidate:
        return None
    if "," in candidate:
        candidate = candidate.split(",")[0].strip()
    if candidate.startswith("[") and "]" in candidate:
        candidate = candidate[1:candidate.index("]")]
    if candidate.count(":") == 1 and "." in candidate:
        candidate = candidate.split(":")[0].strip()
    try:
        ipaddress.ip_address(candidate)
        return candidate
    except ValueError:
        return None


def _extract_client_ip(req: func.HttpRequest) -> Optional[str]:
    header_keys = [
        "x-forwarded-for",
        "x-original-forwarded-for",
        "x-original-for",
        "x-arr-clientip",
        "x-appservice-clientip",
        "x-azure-clientip",
        "x-client-ip",
        "x-real-ip",
        "cf-connecting-ip",
        "true-client-ip",
    ]
    for key in header_keys:
        value = req.headers.get(key)
        ip = _normalize_ip(value)
        if ip:
            return ip
    return None


def _country_from_headers(req: func.HttpRequest) -> Optional[str]:
    header_keys = [
        "cf-ipcountry",
        "x-country-code",
        "x-geo-country",
        "x-azure-country",
        "x-appservice-country",
    ]
    for key in header_keys:
        value = req.headers.get(key)
        if value and isinstance(value, str):
            code = value.strip().upper()
            if len(code) == 2:
                return code
    return None


def _lookup_country_from_ip(ip_address: str) -> Optional[str]:
    try:
        ip_obj = ipaddress.ip_address(ip_address)
        if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_reserved:
            return None
    except ValueError:
        return None
    url_template = get_setting("IP_GEOLOCATION_URL") or "https://ipapi.co/{ip}/json/"
    url = url_template.format(ip=ip_address)
    try:
        resp = httpx.get(url, timeout=2.5)
        if resp.status_code >= 300:
            return None
        payload = resp.json() if resp.text else {}
        code = (payload.get("country_code") or payload.get("country") or "").strip().upper()
        if len(code) == 2:
            return code
    except Exception:  # pylint: disable=broad-except
        return None
    return None


def _resolve_country(req: func.HttpRequest, body: dict | None) -> str:
    return _resolve_country_info(req, body)[0]


def _resolve_country_info(req: func.HttpRequest, body: dict | None) -> tuple[str, str, Optional[str]]:
    fallback = (get_setting("TWILIO_DEFAULT_COUNTRY") or "US").upper()
    if isinstance(body, dict):
        explicit = body.get("country") or body.get("country_code") or body.get("countryCode")
        if isinstance(explicit, str) and explicit.strip():
            return explicit.strip().upper(), "explicit", None
    header_country = _country_from_headers(req)
    if header_country:
        return header_country, "header", None
    ip_addr = _extract_client_ip(req)
    if ip_addr:
        resolved = _lookup_country_from_ip(ip_addr)
        if resolved:
            return resolved, "ip", ip_addr
    return fallback, "default", ip_addr


def _has_active_receptionist_subscription(db, email: str) -> bool:
    now = datetime.utcnow()
    active_statuses = {"active", "trialing"}
    subscription = (
        db.query(Subscription)
        .filter(Subscription.email == email)
        .filter(Subscription.status.in_(active_statuses))
        .order_by(Subscription.updated_at.desc())
        .first()
    )
    if not subscription:
        return False
    if subscription.current_period_end and subscription.current_period_end < now:
        return False
    tool = (subscription.tool or "").lower()
    return tool in {"", "ai_receptionist"}


def _sample_twilio_numbers(items: list, sample_size: int) -> list:
    if len(items) <= sample_size:
        return items
    return random.sample(items, sample_size)


def _list_available_twilio_numbers(
    twilio_client: TwilioClient, country: str, sample_size: int = 5
) -> list[dict]:
    available = twilio_client.available_phone_numbers(country).local.list(voice_enabled=True, limit=25)
    if not available:
        return []
    chosen = _sample_twilio_numbers(available, sample_size)
    payload = []
    for number in chosen:
        payload.append(
            {
                "phone_number": getattr(number, "phone_number", None),
                "friendly_name": getattr(number, "friendly_name", None),
                "locality": getattr(number, "locality", None),
                "region": getattr(number, "region", None),
                "iso_country": getattr(number, "iso_country", None),
                "lata": getattr(number, "lata", None),
            }
        )
    return payload


def _reuse_existing_twilio_number() -> bool:
    flag = str(get_setting("TWILIO_REUSE_EXISTING_NUMBER", "") or "").strip().lower()
    return flag in {"1", "true", "yes", "on"}


def _select_existing_twilio_number(
    twilio_client: TwilioClient,
    country: str,
    phone_number: Optional[str] = None,
):
    existing_numbers = twilio_client.incoming_phone_numbers.list(limit=50)
    if not existing_numbers:
        return None
    if phone_number:
        for number in existing_numbers:
            if getattr(number, "phone_number", None) == phone_number:
                return number
    normalized_country = (country or "").upper()
    for number in existing_numbers:
        iso_country = (getattr(number, "iso_country", "") or "").upper()
        if iso_country and iso_country == normalized_country:
            return number
    return existing_numbers[0]


def purchase_twilio_number(
    twilio_client: TwilioClient,
    webhook_base: str,
    country: str,
    phone_number: Optional[str] = None,
) -> Dict[str, str]:
    """
    Buy a Twilio number and configure its voice webhook.
    On trial accounts (only one number allowed), reuses the existing number if purchase fails.
    In development, reuse an existing number (matching country when possible) instead of buying.
    """
    webhook_url = _build_twilio_voice_webhook(webhook_base)
    if _reuse_existing_twilio_number():
        existing = _select_existing_twilio_number(twilio_client, country, phone_number)
        if not existing:
            raise RuntimeError(
                "TWILIO_REUSE_EXISTING_NUMBER is enabled but no existing Twilio numbers were found"
            )
        existing.update(voice_url=webhook_url, voice_method="POST")
        return {"phone_number": existing.phone_number, "sid": existing.sid}

    chosen_number = phone_number
    if not chosen_number:
        available = twilio_client.available_phone_numbers(country).local.list(voice_enabled=True, limit=1)
        if not available:
            raise RuntimeError(f"No Twilio numbers available for purchase in {country}")
        chosen_number = available[0].phone_number

    try:
        purchased = twilio_client.incoming_phone_numbers.create(
            phone_number=chosen_number,
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


@app.function_name(name="TwilioAvailableNumbers")
@app.route(route="twilio/available-numbers", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def twilio_available_numbers(req: func.HttpRequest) -> func.HttpResponse:
    """
    List available Twilio numbers for the requester's country (IP-based).
    """
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    country_param = req.params.get("country")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "Missing required field: email"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        if not _has_active_receptionist_subscription(db, email):
            return func.HttpResponse(
                json.dumps({"error": "Active subscription required to browse Twilio numbers."}),
                status_code=402,
                mimetype="application/json",
                headers=cors,
            )

        client_record: Client | None = db.query(Client).filter_by(email=email).one_or_none()
        assigned_number = None
        if client_record:
            phone_record = (
                db.query(PhoneNumber)
                .filter_by(client_id=client_record.id, is_active=True)
                .one_or_none()
            )
            if phone_record:
                assigned_number = phone_record.twilio_phone_number

        payload = {"email": email}
        if country_param:
            payload["country"] = country_param
        country, source, ip_addr = _resolve_country_info(req, payload)
        twilio_client = get_twilio_client()
        numbers = _list_available_twilio_numbers(twilio_client, country, sample_size=5)
        return func.HttpResponse(
            json.dumps(
                {
                    "country": country,
                    "assigned_number": assigned_number,
                    "numbers": numbers,
                    "country_source": source,
                    "detected_ip": ip_addr,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to list Twilio numbers: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to list Twilio numbers", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


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
@app.route(route="ultravox/agents", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def ultravox_agents(req: func.HttpRequest) -> func.HttpResponse:
    """List available Ultravox agents (simple helper endpoint)."""
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    limit_param = req.params.get("limit")
    try:
        limit = int(limit_param) if limit_param else 20
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid 'limit' parameter"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    try:
        agents = list_ultravox_agents(limit=limit)
        return func.HttpResponse(
            json.dumps({"agents": agents}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to list Ultravox agents: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to list Ultravox agents", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )


@app.function_name(name="ClientsProvision")
@app.route(route="clients/provision", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def clients_provision(req: func.HttpRequest) -> func.HttpResponse:
    """
    Provision a client: crawl website, create Ultravox agent, buy Twilio number, and persist records.
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None

    email = body.get("email") if isinstance(body, dict) else None
    selected_twilio_number = None
    if isinstance(body, dict):
        selected_twilio_number = (
            body.get("selected_twilio_number")
            or body.get("selectedTwilioNumber")
            or body.get("twilio_number")
            or body.get("twilioNumber")
        )
    website_url = body.get("website_url") if isinstance(body, dict) else None
    system_prompt = body.get("system_prompt") if isinstance(body, dict) else None
    voice = body.get("voice") if isinstance(body, dict) else None
    selected_twilio_number = None
    if isinstance(body, dict):
        selected_twilio_number = (
            body.get("selected_twilio_number")
            or body.get("selectedTwilioNumber")
            or body.get("twilio_number")
            or body.get("twilioNumber")
        )
    greeting = None
    if isinstance(body, dict):
        greeting = (
            body.get("welcome_message")
            or body.get("greeting")
            or body.get("welcomeMessage")
            or body.get("first_speaker_text")
        )

    if not email:
        return func.HttpResponse(
            json.dumps({"error": "Missing required field: email"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        has_valid_url = _is_valid_url(website_url) and website_url != "manual-entry"
        if not has_valid_url:
            website_url = "manual-entry"
            name_guess, summary = _build_manual_summary(body if isinstance(body, dict) else {})
        else:
            name_guess, summary = get_site_summary(website_url)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Failed to crawl site: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": f"Failed to crawl site: {exc}"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
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
                    voice_override=voice if isinstance(voice, str) and voice.strip() else None,
                    greeting_override=greeting if isinstance(greeting, str) and greeting.strip() else None,
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
                    headers=cors,
                )
            client_record.ultravox_agent_id = agent_id

        if client_record.ultravox_agent_id:
            try:
                base = get_public_api_base()
                ensure_tasks_tool(
                    client_record.ultravox_agent_id,
                    base,
                    str(client_record.id),
                )
            except Exception as exc:  # pylint: disable=broad-except
                logger.warning(
                    "Ultravox create_task tool attach failed for agent %s: %s",
                    client_record.ultravox_agent_id,
                    exc,
                )

        phone_record: PhoneNumber = (
            db.query(PhoneNumber).filter_by(client_id=client_record.id, is_active=True).one_or_none()
        )
        if not phone_record:
            if not _has_active_receptionist_subscription(db, email):
                return func.HttpResponse(
                    json.dumps({"error": "Active subscription required to purchase a Twilio number."}),
                    status_code=402,
                    mimetype="application/json",
                    headers=cors,
                )
            try:
                twilio_client = get_twilio_client()
                default_country = _resolve_country(req, body if isinstance(body, dict) else None)
                webhook_base = get_required_setting("TWILIO_INBOUND_WEBHOOK_PUBLIC_URL")
                purchased = purchase_twilio_number(
                    twilio_client, webhook_base, default_country, selected_twilio_number
                )
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
                    headers=cors,
                )

            # If the purchased number already exists, reuse the active record instead of inserting a duplicate.
            existing_number = (
                db.query(PhoneNumber)
                .filter_by(twilio_phone_number=purchased["phone_number"], is_active=True)
                .one_or_none()
            ) or db.query(PhoneNumber).filter_by(twilio_phone_number=purchased["phone_number"]).one_or_none()
            if existing_number:
                phone_record = existing_number
                phone_record.client_id = client_record.id
                phone_record.is_active = True
                phone_record.twilio_sid = purchased["sid"]
            else:
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
        return func.HttpResponse(json.dumps(response_payload), status_code=200, mimetype="application/json", headers=cors)
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Provisioning failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Provisioning failed"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="ClientsAssignNumber")
@app.route(route="clients/assign-number", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def clients_assign_number(req: func.HttpRequest) -> func.HttpResponse:
    """
    Assign a Twilio number and ensure an Ultravox agent for an existing client.
    Business details are sourced from the database to avoid recrawling.
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None

    email = body.get("email") if isinstance(body, dict) else None
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "Missing required field: email"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        client_record: Client = db.query(Client).filter_by(email=email).one_or_none()
        if not client_record:
            return func.HttpResponse(
                json.dumps({"error": "Client not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        user = db.query(User).filter_by(email=email).one_or_none()
        client_record.user_id = user.id if user else client_record.user_id

        if not client_record.ultravox_agent_id:
            agent_name, summary = _build_summary_from_client(client_record, user)
            agent_id = create_ultravox_agent(
                agent_name or email,
                client_record.website_url or "manual-entry",
                summary,
            )
            client_record.ultravox_agent_id = agent_id

        if client_record.ultravox_agent_id:
            try:
                base = get_public_api_base()
                ensure_tasks_tool(
                    client_record.ultravox_agent_id,
                    base,
                    str(client_record.id),
                )
            except Exception as exc:  # pylint: disable=broad-except
                logger.warning(
                    "Ultravox create_task tool attach failed for agent %s: %s",
                    client_record.ultravox_agent_id,
                    exc,
                )

        phone_record: PhoneNumber = (
            db.query(PhoneNumber).filter_by(client_id=client_record.id, is_active=True).one_or_none()
        )
        if not phone_record:
            if not _has_active_receptionist_subscription(db, email):
                return func.HttpResponse(
                    json.dumps({"error": "Active subscription required to purchase a Twilio number."}),
                    status_code=402,
                    mimetype="application/json",
                    headers=cors,
                )
            try:
                twilio_client = get_twilio_client()
                default_country = _resolve_country(req, body if isinstance(body, dict) else None)
                webhook_base = get_required_setting("TWILIO_INBOUND_WEBHOOK_PUBLIC_URL")
                purchased = purchase_twilio_number(
                    twilio_client, webhook_base, default_country, selected_twilio_number
                )
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
                    headers=cors,
                )

            existing_number = (
                db.query(PhoneNumber)
                .filter_by(twilio_phone_number=purchased["phone_number"], is_active=True)
                .one_or_none()
            ) or db.query(PhoneNumber).filter_by(twilio_phone_number=purchased["phone_number"]).one_or_none()
            if existing_number:
                phone_record = existing_number
                phone_record.client_id = client_record.id
                phone_record.is_active = True
                phone_record.twilio_sid = purchased["sid"]
            else:
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
            "email": client_record.email,
            "website_url": client_record.website_url,
            "ultravox_agent_id": client_record.ultravox_agent_id,
            "agent_id": client_record.ultravox_agent_id,
            "phone_number": phone_record.twilio_phone_number if phone_record else None,
            "twilio_sid": phone_record.twilio_sid if phone_record else None,
        }
        return func.HttpResponse(json.dumps(response_payload), status_code=200, mimetype="application/json", headers=cors)
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Assign number failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to assign AI number"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="TwilioIncoming")
@app.route(route="twilio/incoming", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def twilio_incoming(req: func.HttpRequest) -> func.HttpResponse:
    """
    Handle inbound Twilio webhook and connect caller to Ultravox via Twilio Streams.
    TODO: add Twilio signature validation.
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        raw_body = req.get_body().decode("utf-8")
    except Exception:  # pylint: disable=broad-except
        raw_body = ""

    logger.info("TwilioIncoming invoked. Headers=%s RawBody=%s", dict(req.headers), raw_body)

    params = parse_qs(raw_body)
    query_params = req.params or {}

    def _first_non_empty(keys):
        for key in keys:
            val = params.get(key, [None])[0]
            if val:
                return val
            qp = query_params.get(key)
            if qp:
                return qp
            header_val = req.headers.get(key)
            if header_val:
                return header_val
        return None

    # Twilio can send To/From for PSTN and Called/Caller for client calls; normalize them.
    to_number = _first_non_empty(["To", "Called"])
    from_number = _first_non_empty(["From", "Caller"])
    call_sid = _first_non_empty(["CallSid", "X-Twilio-CallSid", "X_TWILIO_CALLSID"])

    logger.info(
        "TwilioIncoming normalized params. CallSid=%s To=%s From=%s RawParams=%s",
        call_sid,
        to_number,
        from_number,
        params,
    )

    if not to_number:
        logger.error("TwilioIncoming: missing 'To' or 'Called' in request body: %s", params)
        return func.HttpResponse(
            '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Configuration error: no destination number was provided.</Say></Response>',
            status_code=200,
            mimetype="text/xml",
            headers=cors,
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
                headers=cors,
            )

        client_record: Client = db.query(Client).filter_by(id=phone_record.client_id).one()
        if call_sid:
            upsert_call(
                db,
                call_sid,
                caller_number=from_number,
                ai_phone_number=to_number,
                status="initiated",
                selected_agent_id=client_record.ultravox_agent_id,
            )
            db.commit()
        if not client_record.ultravox_agent_id:
            logger.error(
                "TwilioIncoming: missing Ultravox agent id for client_id=%s To=%s", client_record.id, to_number
            )
            return func.HttpResponse(
                json.dumps({"error": "Client is missing an Ultravox agent"}),
                status_code=500,
                mimetype="application/json",
                headers=cors,
            )

        prompt_metadata: Dict[str, str] = {}
        if _dynamic_prompts_enabled() and client_record.business_sub_type:
            try:
                prompt = resolve_prompt_for_call(
                    db,
                    client_id=client_record.id,
                    category=client_record.business_category,
                    sub_type=client_record.business_sub_type,
                )
                if prompt and prompt.prompt_text:
                    update_ultravox_agent_prompt(client_record.ultravox_agent_id, prompt.prompt_text)
                    prompt_metadata = {
                        "promptId": str(prompt.id),
                        "promptVersion": str(prompt.version),
                        "promptTaskType": str(prompt.task_type or ""),
                    }
            except Exception as exc:  # pylint: disable=broad-except
                logger.warning("Dynamic prompt lookup failed: %s", exc)

        call_metadata = None
        if call_sid:
            call_metadata = {
                "twilioCallSid": call_sid,
                "aiPhoneNumber": to_number,
                "selectedAgentId": client_record.ultravox_agent_id,
            }
        if prompt_metadata:
            call_metadata = call_metadata or {}
            call_metadata.update(prompt_metadata)

        try:
            join_url, ultravox_call_id = create_ultravox_call(
                client_record.ultravox_agent_id,
                caller_number=from_number or "",
                metadata=call_metadata,
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.error("Failed to create Ultravox call: %s", exc)
            twiml = (
                '<?xml version="1.0" encoding="UTF-8"?>'
                "<Response>"
                "<Say voice=\"alice\">Sorry, we are having trouble connecting your call right now.</Say>"
                "</Response>"
            )
            return func.HttpResponse(twiml, status_code=200, mimetype="text/xml", headers=cors)

        if call_sid:
            attach_ultravox_call(db, call_sid, ultravox_call_id)
            call = upsert_call(
                db,
                call_sid,
                caller_number=from_number,
                ai_phone_number=to_number,
                status="in_progress",
                selected_agent_id=client_record.ultravox_agent_id,
            )
            update_call_status(db, call, "in_progress")
            db.commit()

        logger.info(
            "TwilioIncoming success. CallSid=%s UltravoxCallId=%s To=%s From=%s client_id=%s agent_id=%s join_url=%s",
            call_sid,
            ultravox_call_id,
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
        return func.HttpResponse(twiml, status_code=200, mimetype="text/xml", headers=cors)
    finally:
        db.close()
