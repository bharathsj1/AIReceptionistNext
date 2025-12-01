import json
import logging
import uuid
from typing import Dict, Tuple
from urllib.parse import parse_qs, urlparse

import azure.functions as func
import httpx
from twilio.rest import Client as TwilioClient
from function_app import app

from crawler_endpoints import crawl_site
from services.ultravox_agent_builder import build_ultravox_agent_payload
from shared.config import get_required_setting, get_setting
from shared.db import Client, PhoneNumber, SessionLocal, init_db

ULTRAVOX_BASE_URL = "https://api.ultravox.ai/api"

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


def create_ultravox_agent(business_name: str, website_url: str, summary: str) -> str:
    """Create an Ultravox agent and return its ID. Retries with a unique suffix if the name already exists."""
    api_key = get_required_setting("ULTRAVOX_API_KEY")
    payload = build_ultravox_agent_payload("Test", website_url, summary)

    headers = {
        "X-API-Key": api_key,
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=20) as client:
        response = client.post(f"{ULTRAVOX_BASE_URL}/agents", headers=headers, json=payload)
        if response.status_code == 400 and "already exists" in response.text.lower():
            # Add a short suffix to avoid name collisions while keeping within 64 chars.
            suffix = uuid.uuid4().hex[:6]
            payload = build_ultravox_agent_payload(
                business_name,
                website_url,
                summary,
                agent_name_override=f"{business_name} AI Receptionist-{suffix}",
            )
            response = client.post(f"{ULTRAVOX_BASE_URL}/agents", headers=headers, json=payload)

    if response.status_code >= 300:
        logger.error(
            "Ultravox agent creation failed: %s - %s",
            response.status_code,
            response.text,
        )
        raise RuntimeError(f"Ultravox agent creation failed ({response.status_code}): {response.text}")

    data = response.json()
    agent_id = data.get("id") or data.get("agentId") or data.get("agent_id") or data.get("agent", {}).get("id")
    if not agent_id:
        logger.error("Ultravox agent creation response missing id: %s", response.text)
        raise RuntimeError(f"Ultravox agent creation returned no id: {response.text}")
    return agent_id


def create_ultravox_call(agent_id: str, caller_number: str) -> str:
    """Create an Ultravox call and return joinUrl."""
    api_key = get_required_setting("ULTRAVOX_API_KEY")
    headers = {
        "X-API-Key": api_key,
        "Content-Type": "application/json",
    }
    payload = {
        "medium": {"twilio": {}},
        "firstSpeakerSettings": {"agent": {}},
        "templateContext": {"user": {"phone_number": caller_number}},
    }

    with httpx.Client(timeout=20) as client:
        response = client.post(f"{ULTRAVOX_BASE_URL}/agents/{agent_id}/calls", headers=headers, json=payload)
    if response.status_code >= 300:
        logger.error("Ultravox call creation failed: %s - %s", response.status_code, response.text)
        raise RuntimeError("Failed to create Ultravox call")

    data = response.json()
    join_url = data.get("joinUrl") or data.get("join_url")
    if not join_url:
        logger.error("Ultravox call response missing joinUrl: %s", data)
        raise RuntimeError("Ultravox call response missing joinUrl")
    return join_url


def purchase_twilio_number(twilio_client: TwilioClient, webhook_base: str, country: str) -> Dict[str, str]:
    """Buy a Twilio number and configure its voice webhook."""
    available = twilio_client.available_phone_numbers(country).local.list(voice_enabled=True, limit=1)
    if not available:
        raise RuntimeError(f"No Twilio numbers available for purchase in {country}")

    chosen = available[0]
    webhook_url = webhook_base.rstrip("/") + "/api/twilio/incoming"
    purchased = twilio_client.incoming_phone_numbers.create(
        phone_number=chosen.phone_number,
        voice_url=webhook_url,
        voice_method="POST",
    )
    return {"phone_number": purchased.phone_number, "sid": purchased.sid}


def get_twilio_client() -> TwilioClient:
    """Instantiate a Twilio REST client from environment variables."""
    account_sid = get_required_setting("TWILIO_ACCOUNT_SID")
    auth_token = get_required_setting("TWILIO_AUTH_TOKEN")
    return TwilioClient(account_sid, auth_token)


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

        if not client_record.ultravox_agent_id:
            agent_name = name_guess or email
            try:
                # Payload builder includes a tailored Bolton Properties demo prompt when applicable.
                agent_id = create_ultravox_agent(agent_name, website_url, summary)
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

    params = parse_qs(raw_body)
    to_number = params.get("To", [None])[0]
    from_number = params.get("From", [None])[0]

    if not to_number:
        return func.HttpResponse(
            json.dumps({"error": "Missing 'To' number"}),
            status_code=400,
            mimetype="application/json",
        )

    db = SessionLocal()
    try:
        phone_record: PhoneNumber = (
            db.query(PhoneNumber).filter_by(twilio_phone_number=to_number, is_active=True).one_or_none()
        )
        if not phone_record:
            return func.HttpResponse(
                json.dumps({"error": "No client found for this number"}),
                status_code=404,
                mimetype="application/json",
            )

        client_record: Client = db.query(Client).filter_by(id=phone_record.client_id).one()
        if not client_record.ultravox_agent_id:
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
