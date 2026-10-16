"""Verification endpoints scoped exclusively to the signed-in email identity."""
import azure.functions as func
from function_app import app
from outreach_endpoints import actor_for, body_for, response
from services.email_verification import status_payload, send_code, verify_code, VerificationError
from services.outreach_smtp import settings_payload, save_settings, MailConfigurationError
from shared.db import SessionLocal


def handle(req, operation):
    if req.method == "OPTIONS":
        return response(req, {})
    actor = actor_for(req)
    if not actor:
        return response(req, {"error": "Sign in to verify your email"}, 401)
    db = SessionLocal()
    try:
        if operation == "settings":
            if req.method == "GET":
                return response(req, settings_payload(db, actor))
            if len(req.get_body()) > 8192:
                return response(req, {"error": "Request is too large"}, 413)
            return response(req, save_settings(db, actor, body_for(req)))
        if operation == "status":
            return response(req, status_payload(db, actor))
        if len(req.get_body()) > 4096:
            return response(req, {"error": "Request is too large"}, 413)
        body = body_for(req)
        if operation == "send":
            payload = send_code(db, actor, email=body.get("email"))
        else:
            payload = verify_code(db, actor, body.get("code"), email=body.get("email"))
        return response(req, payload)
    except MailConfigurationError as exc:
        db.rollback()
        return response(req, {"error": str(exc)}, exc.status)
    except VerificationError as exc:
        db.rollback()
        result = response(req, {"error": str(exc), "resend_after_seconds": exc.retry_after}, exc.status)
        if exc.retry_after:
            result.headers["Retry-After"] = str(exc.retry_after)
        return result
    except (ValueError, TypeError):
        db.rollback()
        return response(req, {"error": "Provide a valid verification request"}, 400)
    finally:
        db.close()


@app.route(route="outreach/email-verification", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_verification_status(req):
    return handle(req, "status")


@app.route(route="outreach/email-verification/send", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_verification_send(req):
    return handle(req, "send")


@app.route(route="outreach/email-verification/verify", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_verification_verify(req):
    return handle(req, "verify")


@app.route(route="outreach/email-verification/settings", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_verification_settings(req):
    return handle(req, "settings")
