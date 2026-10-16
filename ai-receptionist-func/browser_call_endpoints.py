"""Signed user setup/hangup and signed Twilio browser call hooks."""
import os
from urllib.parse import parse_qs

import azure.functions as func
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import VoiceResponse

from function_app import app
from outreach_endpoints import actor_for, body_for, response
from services import browser_calling as browser
from services.outreach_billing import BillingError
from shared.config import get_public_api_base
from shared.db import SessionLocal


def user_action(req, operation):
    if req.method == "OPTIONS": return response(req, {})
    actor = actor_for(req)
    if not actor: return response(req, {"error": "Sign in to manage this call"}, 401)
    db = SessionLocal()
    try:
        if len(req.get_body()) > 4096: return response(req, {"error": "Request is too large"}, 413)
        body = body_for(req)
        return response(req, browser.configure(db, actor, body) if operation == "setup" else browser.stop(db, actor, req.route_params.get("lead_id")))
    except BillingError as exc:
        db.rollback(); return response(req, {"error": str(exc)}, exc.status)
    except (ValueError, TypeError):
        db.rollback(); return response(req, {"error": "Invalid browser call request"}, 400)
    except Exception:
        db.rollback(); return response(req, {"error": "The call operation could not be confirmed. Check call history before retrying."}, 503)
    finally: db.close()


@app.route(route="outreach/browser/setup", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def browser_setup(req): return user_action(req, "setup")


@app.route(route="outreach/browser/calls/{lead_id}/stop", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def browser_stop(req): return user_action(req, "stop")


def provider_hook(req, operation):
    try:
        if len(req.get_body()) > 16384: raise ValueError("Request too large")
        parsed = parse_qs(req.get_body().decode("utf-8"), keep_blank_values=True)
        if any(len(values) != 1 for values in parsed.values()): raise ValueError("Duplicate callback fields")
        values = {key: items[0] for key, items in parsed.items()}
    except (ValueError, UnicodeError): return response(req, {"error": "Invalid callback"}, 400)
    token, signature = os.getenv("TWILIO_AUTH_TOKEN", ""), req.headers.get("X-Twilio-Signature", "")
    url = f"{get_public_api_base()}/api/outreach/browser/{operation}"
    if not token or not signature or values.get("AccountSid") != os.getenv("TWILIO_ACCOUNT_SID") or not RequestValidator(token).validate(url, values, signature):
        return response(req, {"error": "Invalid Twilio signature or account"}, 403)
    db = SessionLocal()
    try:
        if operation == "voice": result = browser.voice_twiml(db, values)
        else:
            (browser.finish if operation == "finish" else browser.parent_status)(db, values)
            hangup = VoiceResponse(); hangup.hangup(); result = str(hangup)
        return func.HttpResponse(result, mimetype="text/xml", headers={"Cache-Control": "no-store"})
    except ValueError:
        db.rollback()
        result = VoiceResponse(); result.hangup()
        return func.HttpResponse(str(result), mimetype="text/xml")
    finally: db.close()


@app.route(route="outreach/browser/voice", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def browser_voice(req): return provider_hook(req, "voice")


@app.route(route="outreach/browser/finish", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def browser_finish(req): return provider_hook(req, "finish")


@app.route(route="outreach/browser/status", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def browser_status(req): return provider_hook(req, "status")
