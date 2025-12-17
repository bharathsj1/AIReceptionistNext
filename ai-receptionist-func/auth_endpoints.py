import json
import logging
import secrets
import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from zoneinfo import ZoneInfo
from urllib.parse import parse_qs

import azure.functions as func
import requests
from function_app import app
from shared.config import get_google_oauth_settings, get_public_api_base, get_setting
from shared.db import SessionLocal, User, Client, GoogleToken
from utils.cors import build_cors_headers
from services.ultravox_service import (
    create_ultravox_webhook,
    ensure_booking_tool,
    get_ultravox_agent,
    list_ultravox_tools,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return f"{salt}${hashed}"


def _verify_password(password: str, stored: str) -> bool:
    if "$" not in stored:
        return False
    salt, hashed = stored.split("$", 1)
    check = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return secrets.compare_digest(check, hashed)


def _generate_reset_token() -> str:
    return secrets.token_urlsafe(32)


def _ensure_utc(dt: datetime) -> datetime:
    """
    Ensure datetimes have an explicit UTC timezone so Google Calendar accepts them.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _build_event_id(raw_id: Optional[str]) -> Optional[str]:
    """
    Build a Google Calendar event id suitable for idempotency.
    Rules: 5-1024 chars, letters/numbers/underscore only. We drop dashes and other chars to avoid "Invalid resource id".
    """
    if not raw_id:
        return None
    # Remove everything except alphanumerics/underscore to avoid Google 400.
    safe = re.sub(r"[^a-zA-Z0-9_]", "", str(raw_id)).lower()
    safe = safe.lstrip("_")
    if safe and not re.match(r"^[a-zA-Z0-9]", safe):
        safe = f"a{safe}"
    if len(safe) < 5:
        safe = (safe + "00000")[:5]
    if len(safe) > 1024:
        safe = safe[:1024]
    if not re.match(r"^[a-zA-Z0-9_]{5,1024}$", safe):
        return None
    return safe


def _parse_dt_with_london_default(value: str) -> datetime:
    """
    Parse an ISO timestamp; if no timezone, assume Europe/London, then convert to UTC.
    """
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        try:
            dt = dt.replace(tzinfo=ZoneInfo("Europe/London"))
        except Exception:  # pylint: disable=broad-except
            dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _extract_time_fields(payload: dict) -> Tuple[Optional[str], Optional[str], Optional[int], Optional[int]]:
    """
    Extract start/end/duration/buffer from known top-level or nested shapes.
    Accepts variants such as startTime/start_time and nested booking/appointment objects.
    """
    contexts = []
    if isinstance(payload, dict):
        contexts.append(payload)
        for key in ("call", "booking", "appointment"):
            child = payload.get(key)
            if isinstance(child, dict):
                contexts.append(child)
                for sub_key in ("booking", "appointment", "slot"):
                    sub_child = child.get(sub_key)
                    if isinstance(sub_child, dict):
                        contexts.append(sub_child)

    def first(*keys):
        for ctx in contexts:
            for key in keys:
                if key in ctx and ctx.get(key):
                    return ctx.get(key)
        return None

    start_iso = first(
        "start",
        "startTime",
        "start_time",
        "start_time_iso",
        "startTimeIso",
        "requestedStart",
        "requested_start",
    )
    end_iso = first(
        "end",
        "endTime",
        "end_time",
        "end_time_iso",
        "endTimeIso",
        "requestedEnd",
        "requested_end",
    )
    duration = first("duration_minutes", "durationMinutes", "duration")
    buffer = first("buffer_minutes", "bufferMinutes", "buffer")
    return start_iso, end_iso, duration, buffer


def _build_google_auth_url(state: str) -> str:
    settings = get_google_oauth_settings()
    scope = settings["scopes"]
    redirect_uri = settings["redirect_uri"]
    client_id = settings["client_id"]
    base = "https://accounts.google.com/o/oauth2/v2/auth"
    return (
        f"{base}?response_type=code"
        f"&client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&scope={scope}"
        f"&access_type=offline"
        f"&include_granted_scopes=true"
        f"&prompt=consent"
        f"&state={state}"
    )


def _exchange_code_for_tokens(code: str) -> Tuple[Optional[dict], Optional[str]]:
    settings = get_google_oauth_settings()
    payload = {
        "code": code,
        "client_id": settings["client_id"],
        "client_secret": settings["client_secret"],
        "redirect_uri": settings["redirect_uri"],
        "grant_type": "authorization_code",
    }
    try:
        resp = requests.post("https://oauth2.googleapis.com/token", data=payload, timeout=10)
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _refresh_google_token(refresh_token: str) -> Tuple[Optional[dict], Optional[str]]:
    settings = get_google_oauth_settings()
    payload = {
        "refresh_token": refresh_token,
        "client_id": settings["client_id"],
        "client_secret": settings["client_secret"],
        "grant_type": "refresh_token",
    }
    try:
        resp = requests.post("https://oauth2.googleapis.com/token", data=payload, timeout=10)
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _get_google_userinfo(access_token: str) -> Tuple[Optional[dict], Optional[str]]:
    try:
        resp = requests.get(
            "https://www.googleapis.com/oauth2/v1/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
            params={"alt": "json"},
        )
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _get_calendar_events(access_token: str, max_results: int = 5) -> Tuple[Optional[dict], Optional[str]]:
    try:
        resp = requests.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
            params={
                "maxResults": max_results,
                "orderBy": "startTime",
                "singleEvents": "true",
                "timeMin": datetime.utcnow().isoformat() + "Z",
            },
        )
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _freebusy(access_token: str, start_iso: str, end_iso: str) -> Tuple[Optional[dict], Optional[str]]:
    """
    Check primary calendar free/busy between start and end (ISO 8601).
    """
    payload = {
        "timeMin": start_iso,
        "timeMax": end_iso,
        "items": [{"id": "primary"}],
    }
    try:
        resp = requests.post(
            "https://www.googleapis.com/calendar/v3/freeBusy",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=payload,
            timeout=10,
        )
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _create_calendar_event(
    access_token: str,
    summary: str,
    start_iso: str,
    end_iso: str,
    description: Optional[str] = None,
    attendees: Optional[list] = None,
    event_id: Optional[str] = None,
    time_zone: Optional[str] = None,
) -> Tuple[Optional[dict], Optional[str]]:
    payload = {
        "summary": summary,
        "start": {"dateTime": start_iso},
        "end": {"dateTime": end_iso},
    }
    if time_zone:
        payload["start"]["timeZone"] = time_zone
        payload["end"]["timeZone"] = time_zone
    if description:
        payload["description"] = description
    if attendees:
        payload["attendees"] = attendees
    if event_id:
        payload["id"] = event_id

    try:
        resp = requests.post(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=payload,
            timeout=10,
        )
        if resp.status_code == 409:
            # Duplicate event id; treat as already created.
            return {"duplicate": True, "id": event_id}, None
        if resp.status_code >= 300:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _ensure_ultravox_booking_tool_for_user(email: str, db):
    """
    Ensure the Ultravox HTTP tool for booking is created and attached to the user's agent.
    Best-effort; failures are logged and do not block auth.
    """
    try:
        client = db.query(Client).filter_by(email=email).one_or_none()
        if not client or not client.ultravox_agent_id:
            return

        base = get_public_api_base()
        tool_id, created, attached = ensure_booking_tool(client.ultravox_agent_id, base)
        logger.info(
            "Ultravox booking tool ensure: agent=%s tool_id=%s created=%s attached=%s",
            client.ultravox_agent_id,
            tool_id,
            created,
            attached,
        )
        # Keep the legacy call.ended webhook as non-blocking telemetry; avoid duplicates.
        try:
            from services.ultravox_service import list_ultravox_webhooks  # lazy import to avoid cycles

            existing_hooks = list_ultravox_webhooks()
            destination = f"{base}/api/calendar/book"
            scoped = [
                hook
                for hook in existing_hooks
                if (hook.get("url") or "").rstrip("/") == destination
                and hook.get("agentId") == client.ultravox_agent_id
                and "call.ended" in (hook.get("events") or [])
            ]
            if scoped:
                logger.info("Ultravox call.ended webhook already exists for agent %s", client.ultravox_agent_id)
            else:
                scope = {"type": "AGENT", "value": client.ultravox_agent_id}
                create_ultravox_webhook(destination, ["call.ended"], scope=scope)
        except Exception as exc:  # pylint: disable=broad-except
            logger.info("Ultravox call.ended webhook skipped: %s", exc)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Ultravox booking tool ensure failed for %s: %s", email, exc)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.function_name(name="AuthSignup")
@app.route(route="auth/signup", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_signup(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    email = (body or {}).get("email")
    password = (body or {}).get("password")
    if not email or not password:
        return func.HttpResponse(
            json.dumps({"error": "email and password are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        existing = db.query(User).filter_by(email=email).one_or_none()
        if existing:
            return func.HttpResponse(
                json.dumps({"error": "User already exists"}),
                status_code=409,
                mimetype="application/json",
                headers=cors,
            )

        user = User(email=email, password_hash=_hash_password(password))
        db.add(user)
        db.flush()

        # Link to client if exists
        client = db.query(Client).filter_by(email=email).one_or_none()
        if client:
            client.user_id = user.id

        db.commit()
        return func.HttpResponse(
            json.dumps({"user_id": user.id, "email": user.email}),
            status_code=201,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Signup failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Signup failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="AuthLogin")
@app.route(route="auth/login", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_login(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    email = (body or {}).get("email")
    password = (body or {}).get("password")
    if not email or not password:
        return func.HttpResponse(
            json.dumps({"error": "email and password are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).one_or_none()
        if not user or not _verify_password(password, user.password_hash):
            return func.HttpResponse(
                json.dumps({"error": "Invalid credentials"}),
                status_code=401,
                mimetype="application/json",
                headers=cors,
            )
        client = db.query(Client).filter_by(email=email).one_or_none()
        return func.HttpResponse(
            json.dumps(
                {
                    "user_id": user.id,
                    "email": user.email,
                    "client_id": client.id if client else None,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Login failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Login failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="AuthEmailExists")
@app.route(route="auth/email-exists", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_email_exists(req: func.HttpRequest) -> func.HttpResponse:
    """
    Check if a user with the given email already exists.
    Query param: ?email=<email>
    """
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    db = SessionLocal()
    try:
        existing = db.query(User).filter_by(email=email).one_or_none()
        return func.HttpResponse(
            json.dumps({"exists": existing is not None}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="ClientBusinessDetails")
@app.route(route="clients/business-details", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def client_business_details(req: func.HttpRequest) -> func.HttpResponse:
    """
    Create or update a client with business name/phone after signup.
    Payload: { email, businessName, businessPhone, websiteUrl? }
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    email = (body or {}).get("email")
    business_name = (body or {}).get("businessName")
    business_phone = (body or {}).get("businessPhone")
    website_url = (body or {}).get("websiteUrl") or "pending"

    if not email or not business_name or not business_phone:
        return func.HttpResponse(
            json.dumps({"error": "email, businessName, and businessPhone are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).one_or_none()
        if user:
            user.business_name = business_name
            user.business_number = business_phone
            db.flush()
        client = db.query(Client).filter_by(email=email).one_or_none()
        if client:
            client.business_name = business_name
            client.business_phone = business_phone
            client.name = business_name
            client.user_id = user.id if user else client.user_id
            db.commit()
            return func.HttpResponse(
                json.dumps({"client_id": client.id, "email": client.email}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

        client = Client(
            email=email,
            website_url=website_url,
            name=business_name,
            business_name=business_name,
            business_phone=business_phone,
            user_id=user.id if user else None,
        )
        db.add(client)
        db.commit()
        return func.HttpResponse(
            json.dumps({"client_id": client.id, "email": client.email}),
            status_code=201,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Failed to save client details: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to save client details", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="UserByEmail")
@app.route(route="auth/user-by-email", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def user_by_email(req: func.HttpRequest) -> func.HttpResponse:
    """Return user fields including business name/number."""
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).one_or_none()
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        payload = {
            "user_id": user.id,
            "email": user.email,
            "business_name": user.business_name,
            "business_number": user.business_number,
        }
        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()

@app.function_name(name="ClientByEmail")
@app.route(route="clients/by-email", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def client_by_email(req: func.HttpRequest) -> func.HttpResponse:
    """Return client profile by email, including business fields."""
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    db = SessionLocal()
    try:
        client = db.query(Client).filter_by(email=email).one_or_none()
        if not client:
            return func.HttpResponse(
                json.dumps({"error": "not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        user = None
        if client.user_id:
            user = db.query(User).filter_by(id=client.user_id).one_or_none()
        payload = {
            "client_id": client.id,
            "email": client.email,
            "business_name": client.business_name,
            "business_phone": client.business_phone,
            "website_url": client.website_url,
            "user_id": client.user_id,
            "user_business_name": user.business_name if user else None,
            "user_business_number": user.business_number if user else None,
        }
        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="AuthForgotPassword")
@app.route(route="auth/forgot-password", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_forgot_password(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    email = (body or {}).get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).one_or_none()
        if not user:
            return func.HttpResponse(
                json.dumps({"message": "If the account exists, a reset link will be sent."}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )
        token = _generate_reset_token()
        user.reset_token = token
        user.reset_token_expires = datetime.utcnow() + timedelta(hours=1)
        db.commit()

        # In a real system, send email here. For now, return the link for manual testing.
        reset_link = f"{req.url.replace('/auth/forgot-password', '/auth/reset-password')}?token={token}"
        return func.HttpResponse(
            json.dumps({"message": "Reset link generated", "reset_link": reset_link}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Forgot password failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Forgot password failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="AuthResetPassword")
@app.route(route="auth/reset-password", methods=["POST", "GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_reset_password(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if req.method == "GET":
        token = req.params.get("token")
        if not token:
            return func.HttpResponse(
                "Token is required to reset your password.",
                status_code=400,
                mimetype="text/plain",
                headers=cors,
            )
        html = f"""
        <!doctype html>
        <html>
        <head><title>Reset Password</title></head>
        <body>
            <h2>Reset your password</h2>
            <form method="POST" action="">
                <input type="hidden" name="token" value="{token}">
                <label for="new_password">New password</label>
                <input id="new_password" type="password" name="new_password" required>
                <button type="submit">Reset password</button>
            </form>
        </body>
        </html>
        """
        return func.HttpResponse(html, status_code=200, mimetype="text/html", headers=cors)

    token = None
    new_password = None
    try:
        body = req.get_json()
        token = (body or {}).get("token")
        new_password = (body or {}).get("new_password")
    except ValueError:
        try:
            form_data = parse_qs(req.get_body().decode("utf-8"))
            token = (form_data.get("token") or [None])[0]
            new_password = (form_data.get("new_password") or [None])[0]
        except Exception:  # pylint: disable=broad-except
            token = None
            new_password = None
    if not token or not new_password:
        return func.HttpResponse(
            json.dumps({"error": "token and new_password are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = (
            db.query(User)
            .filter(User.reset_token == token, User.reset_token_expires >= datetime.utcnow())
            .one_or_none()
        )
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "Invalid or expired token"}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        user.password_hash = _hash_password(new_password)
        user.reset_token = None
        user.reset_token_expires = None
        db.commit()

        return func.HttpResponse(
            json.dumps({"message": "Password reset successful"}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Reset password failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Reset password failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="GoogleAuthUrl")
@app.route(route="auth/google/url", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_google_url(req: func.HttpRequest) -> func.HttpResponse:  # pylint: disable=unused-argument
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    settings = get_google_oauth_settings()
    if not settings["client_id"] or not settings["client_secret"]:
        return func.HttpResponse(
            json.dumps({"error": "Google OAuth env vars missing"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    state = secrets.token_urlsafe(16)
    url = _build_google_auth_url(state)
    return func.HttpResponse(
        json.dumps({"auth_url": url, "state": state}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )


@app.function_name(name="GoogleAuthCallback")
@app.route(
    route="auth/google/callback",
    methods=["GET", "POST", "OPTIONS"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def auth_google_callback(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    code = req.params.get("code") or None
    state = req.params.get("state")
    if not code:
        try:
            body = req.get_json()
            code = code or (body or {}).get("code")
            state = state or (body or {}).get("state")
        except ValueError:
            code = code or None
    if not code:
        return func.HttpResponse(
            json.dumps({"error": "Missing code"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    token_data, token_error = _exchange_code_for_tokens(code)
    if token_error or not token_data:
        return func.HttpResponse(
            json.dumps({"error": "Failed to exchange code", "details": token_error}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in")
    token_type = token_data.get("token_type")
    id_token = token_data.get("id_token")
    scope = token_data.get("scope")

    profile, profile_error = _get_google_userinfo(access_token)
    if profile_error or not profile:
        return func.HttpResponse(
            json.dumps({"error": "Failed to fetch user profile", "details": profile_error}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    email = profile.get("email")
    name = profile.get("name") or email
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).one_or_none()
        is_new_user = False
        if not user:
            is_new_user = True
            temp_password = secrets.token_urlsafe(12)
            user = User(email=email, password_hash=_hash_password(temp_password))
            db.add(user)
            db.flush()

        google_token = (
            db.query(GoogleToken)
            .filter_by(user_id=user.id)
            .order_by(GoogleToken.created_at.desc())
            .first()
        )
        expires_at = (
            datetime.utcnow() + timedelta(seconds=int(expires_in))
            if expires_in
            else None
        )
        if google_token:
            google_token.access_token = access_token
            google_token.refresh_token = refresh_token or google_token.refresh_token
            google_token.scope = scope
            google_token.token_type = token_type
            google_token.expires_at = expires_at
            google_token.id_token = id_token.encode("utf-8") if isinstance(id_token, str) else id_token
        else:
            google_token = GoogleToken(
                user_id=user.id,
                access_token=access_token,
                refresh_token=refresh_token,
                scope=scope,
                token_type=token_type,
                expires_at=expires_at,
                id_token=id_token.encode("utf-8") if isinstance(id_token, str) else id_token,
            )
            db.add(google_token)

        # Link any pending client record
        client = db.query(Client).filter_by(email=email).one_or_none()
        if client:
            client.user_id = user.id
            client.name = client.name or name
        db.commit()

        # Ensure Ultravox booking tool is present/attached (best-effort)
        _ensure_ultravox_booking_tool_for_user(email, db)

        payload = {
            "user_id": user.id,
            "email": user.email,
            "state": state,
            "is_new_user": is_new_user,
            "token": {
                "expires_at": expires_at.isoformat() if expires_at else None,
                "has_refresh": bool(refresh_token),
                "scope": scope,
            },
            "profile": {"name": name},
        }
        # If Google hits this endpoint directly, show simple HTML for the SPA to read.
        if req.method == "GET":
            html = (
                "<script>"
                "window.opener && window.opener.postMessage("  # type: ignore
                + json.dumps(payload)
                + ', "*");'
                "window.close();"
                "</script>"
                "<p>Google connected. You can close this tab.</p>"
            )
            return func.HttpResponse(html, status_code=200, mimetype="text/html", headers=cors)

        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Google auth callback failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Google auth failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="CalendarEvents")
@app.route(route="calendar/events", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def calendar_events(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id")
    max_results_param = req.params.get("max_results")
    max_results = 5
    if max_results_param:
        try:
            max_results = min(int(max_results_param), 20)
        except ValueError:
            max_results = 5

    db = SessionLocal()
    try:
        user = None
        if email:
            user = db.query(User).filter_by(email=email).one_or_none()
        elif user_id:
            user = db.query(User).filter_by(id=int(user_id)).one_or_none()
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        token = (
            db.query(GoogleToken)
            .filter_by(user_id=user.id)
            .order_by(GoogleToken.created_at.desc())
            .first()
        )
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token = token.access_token
        now = datetime.utcnow()
        if token.expires_at and token.expires_at <= now and token.refresh_token:
            refreshed, refresh_error = _refresh_google_token(token.refresh_token)
            if refresh_error or not refreshed:
                return func.HttpResponse(
                    json.dumps({"error": "Unable to refresh token", "details": refresh_error}),
                    status_code=401,
                    mimetype="application/json",
                    headers=cors,
                )
            access_token = refreshed.get("access_token") or access_token
            token.access_token = access_token
            token.expires_at = (
                datetime.utcnow() + timedelta(seconds=int(refreshed.get("expires_in")))
                if refreshed.get("expires_in")
                else None
            )
            db.commit()

        # Ensure Ultravox booking tool is present/attached (best-effort)
        _ensure_ultravox_booking_tool_for_user(email, db)

        events, events_error = _get_calendar_events(access_token, max_results=max_results)
        if events_error or not events:
            return func.HttpResponse(
                json.dumps({"error": "Failed to fetch calendar", "details": events_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        return func.HttpResponse(
            json.dumps({"events": events.get("items", []), "summary": events.get("summary"), "user": user.email}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Calendar events failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Calendar fetch failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="CalendarBook")
@app.route(route="calendar/book", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def calendar_book(req: func.HttpRequest) -> func.HttpResponse:
    """
    Create an event on the user's primary Google Calendar if the slot is free.
    Body: { email?, agentId?, call.agent.id?, start, end?, duration_minutes?, buffer_minutes?, title?, description?, callerName?, callerEmail?, callerPhone? }
    If email is missing but agentId is provided, we resolve the client's email from the Ultravox agent id.
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    # Parse raw body once to avoid Kestrel "Unexpected end of request content".
    try:
        raw = req.get_body() or b""
        # Log the incoming payload for diagnostics (truncated to avoid oversized logs).
        try:
            logger.info("CalendarBook raw body (%s bytes): %s", len(raw), raw[:5000].decode("utf-8", "ignore"))
        except Exception:  # pylint: disable=broad-except
            logger.info("CalendarBook raw body length: %s bytes", len(raw))
        body = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:  # pylint: disable=broad-except
        logger.warning("CalendarBook invalid JSON body")
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    if not isinstance(body, dict):
        body = {}

    logger.info("CalendarBook parsed body keys: %s", list(body.keys()))

    extracted_start, extracted_end, extracted_duration, extracted_buffer = _extract_time_fields(body)

    email = body.get("email")
    agent_id = (
        body.get("agentId")
        or body.get("agent_id")
        or (body.get("agent") or {}).get("id")
        or (body.get("call") or {}).get("agentId")
        or (body.get("call") or {}).get("agent_id")
        or ((body.get("call") or {}).get("agent") or {}).get("id")
    )
    if isinstance(agent_id, dict):
        agent_id = (
            agent_id.get("value")
            or agent_id.get("agentId")
            or agent_id.get("agent_id")
            or agent_id.get("id")
        )

    start_iso = body.get("start")
    end_iso = body.get("end")
    duration_minutes = body.get("duration_minutes") or 30
    buffer_minutes = body.get("buffer_minutes") or 5
    title = body.get("title") or "Phone appointment with AI Receptionist"
    description = body.get("description")
    caller_name = body.get("callerName") or body.get("caller_name")
    caller_email = body.get("callerEmail") or body.get("caller_email")
    caller_phone = body.get("callerPhone") or body.get("caller_phone")
    call_id = (
        body.get("callId")
        or (body.get("call") or {}).get("callId")
        or body.get("call_id")
        or (body.get("call") or {}).get("call_id")
    )

    logger.info(
        "CalendarBook resolved identifiers: email=%s agent_id=%s call_id=%s start=%s end=%s duration=%s buffer=%s",
        email,
        agent_id,
        call_id,
        extracted_start,
        extracted_end,
        extracted_duration or duration_minutes,
        extracted_buffer or buffer_minutes,
    )

    start_iso = (
        extracted_start
        or body.get("start")
        or body.get("start_iso")
        or body.get("start_time")
        or body.get("start_time_iso")
    )
    end_iso = extracted_end or body.get("end") or body.get("end_iso") or body.get("end_time") or body.get("end_time_iso")
    duration_minutes = extracted_duration or body.get("duration_minutes") or body.get("duration") or 30
    buffer_minutes = extracted_buffer or body.get("buffer_minutes") or body.get("buffer") or 5

    if (body.get("event") or "").lower() == "call.ended" and not start_iso:
        logger.info("CalendarBook skipping call.ended webhook without start time (noop).")
        return func.HttpResponse(
            json.dumps({"message": "No booking created; call.ended payload missing start"}),
            status_code=202,
            mimetype="application/json",
            headers=cors,
        )
    caller_lines = []
    if caller_name:
        caller_lines.append(f"Caller: {caller_name}")
    if caller_email:
        caller_lines.append(f"Email: {caller_email}")
    if caller_phone:
        caller_lines.append(f"Phone: {caller_phone}")
    caller_lines.append(f"Duration: {duration_minutes} min")
    caller_lines.append(f"Buffer: {buffer_minutes} min")
    if caller_lines:
        extra = "\n".join(caller_lines)
        description = f"{description or ''}\n\n{extra}".strip()

    try:
        duration_minutes = int(duration_minutes)
    except Exception:
        duration_minutes = 30
    try:
        buffer_minutes = int(buffer_minutes)
    except Exception:
        buffer_minutes = 5

    db = SessionLocal()
    try:
        user = None
        if email:
            user = db.query(User).filter_by(email=email).one_or_none()
        if not user and agent_id:
            client = db.query(Client).filter_by(ultravox_agent_id=agent_id).one_or_none()
            if client:
                email = client.email
                user = db.query(User).filter_by(email=email).one_or_none()

        logger.info("CalendarBook user lookup: email=%s user_found=%s", email, bool(user))
        if not email or not user:
            logger.warning("CalendarBook user not found for email=%s agent_id=%s", email, agent_id)
            return func.HttpResponse(
                json.dumps({"error": "User not found", "hint": "Provide email or agentId"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        token = (
            db.query(GoogleToken)
            .filter_by(user_id=user.id)
            .order_by(GoogleToken.created_at.desc())
            .first()
        )
        logger.info("CalendarBook token lookup for user_id=%s found=%s", user.id, bool(token))
        if not token:
            logger.warning("CalendarBook no Google token for user_id=%s", user.id)
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token = token.access_token
        now = datetime.utcnow()
        if token.expires_at and token.expires_at <= now and token.refresh_token:
            logger.info("CalendarBook token expired, attempting refresh for user_id=%s", user.id)
            refreshed, refresh_error = _refresh_google_token(token.refresh_token)
            if refresh_error or not refreshed:
                logger.error("CalendarBook refresh failed: %s", refresh_error)
                return func.HttpResponse(
                    json.dumps({"error": "Unable to refresh token", "details": refresh_error}),
                    status_code=401,
                    mimetype="application/json",
                    headers=cors,
                )
            access_token = refreshed.get("access_token") or access_token
            token.access_token = access_token
            token.expires_at = (
                datetime.utcnow() + timedelta(seconds=int(refreshed.get("expires_in")))
                if refreshed.get("expires_in")
                else None
            )
            db.commit()

        if not start_iso:
            logger.warning("CalendarBook missing start; refusing to auto-schedule without a requested slot")
            return func.HttpResponse(
                json.dumps({"error": "Missing start time", "hint": "Provide start in ISO 8601 (e.g., 2025-12-17T15:00:00Z)"}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )
        try:
            start_dt = _parse_dt_with_london_default(start_iso)
        except Exception:  # pylint: disable=broad-except
            logger.warning("CalendarBook invalid start format: %s", start_iso)
            return func.HttpResponse(
                json.dumps({"error": "Invalid start time format", "value": start_iso}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )
        if end_iso:
            try:
                end_dt = _parse_dt_with_london_default(end_iso)
            except Exception:  # pylint: disable=broad-except
                logger.warning("CalendarBook invalid end format: %s", end_iso)
                return func.HttpResponse(
                    json.dumps({"error": "Invalid end time format", "value": end_iso}),
                    status_code=400,
                    mimetype="application/json",
                    headers=cors,
                )
        else:
            end_dt = start_dt + timedelta(minutes=duration_minutes)
        end_dt = _ensure_utc(end_dt)

        buffered_end = (
            _ensure_utc(end_dt + timedelta(minutes=buffer_minutes)) if buffer_minutes else end_dt
        )

        start_london = start_dt.astimezone(ZoneInfo("Europe/London"))
        end_london = end_dt.astimezone(ZoneInfo("Europe/London"))
        start_for_google = start_london.isoformat()
        end_for_google = end_london.isoformat()

        logger.info(
            "CalendarBook resolved timing: start=%s end=%s buffered_end=%s duration=%s buffer=%s",
            start_dt.isoformat(),
            end_dt.isoformat(),
            buffered_end.isoformat(),
            duration_minutes,
            buffer_minutes,
        )

        fb, fb_error = _freebusy(
            access_token,
            start_dt.isoformat(),
            buffered_end.isoformat(),
        )
        logger.info("CalendarBook free/busy response: error=%s busy_entries=%s", fb_error, (fb or {}).get("calendars", {}))
        if fb_error or not fb:
            logger.warning("CalendarBook free/busy failure: %s", fb_error)
            return func.HttpResponse(
                json.dumps({"error": "Unable to check availability", "details": fb_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        busy = fb.get("calendars", {}).get("primary", {}).get("busy", [])
        if busy:
            logger.warning("CalendarBook slot busy: %s", busy)
            return func.HttpResponse(
                json.dumps({"error": "Slot is busy", "busy": busy}),
                status_code=409,
                mimetype="application/json",
                headers=cors,
            )

        attendees = []
        if caller_email:
            attendees.append({"email": caller_email})
        # Use call_id as event_id to get idempotency (Google returns 409 on duplicate).
        event_id = _build_event_id(call_id)

        event_error = None
        event = None
        tried_id = False

        if event_id:
            tried_id = True
            logger.info("CalendarBook creating event with id=%s attendees=%s", event_id, attendees)
            event, event_error = _create_calendar_event(
                access_token,
                title,
                start_for_google,
                end_for_google,
                description=description,
                attendees=attendees or None,
                event_id=event_id,
                time_zone="Europe/London",
            )

        # If no event_id was provided, or the id attempt failed, try once without id.
        if not event and not event_error and not tried_id:
            logger.info("CalendarBook creating event without explicit id (call_id missing)")
            event, event_error = _create_calendar_event(
                access_token,
                title,
                start_for_google,
                end_for_google,
                description=description,
                attendees=attendees or None,
                event_id=None,
                time_zone="Europe/London",
            )

        # If invalid id or other creation error, retry once without event_id.
        if (event_error or not event) and tried_id:
            if event_error and "Invalid resource id" in str(event_error):
                logger.info("Retrying calendar create without event_id (invalid id: %s)", event_id)
                event, event_error = _create_calendar_event(
                    access_token,
                    title,
                    start_for_google,
                    end_for_google,
                    description=description,
                    attendees=attendees or None,
                    event_id=None,
                    time_zone="Europe/London",
                )

        if event_error or not event:
            logger.error(
                "CalendarBook event creation failed: event_error=%s event_id_used=%s tried_id=%s",
                event_error,
                event_id,
                tried_id,
            )
            return func.HttpResponse(
                json.dumps(
                    {
                        "error": "Failed to create event",
                        "details": event_error,
                        "event_id_used": event_id if tried_id else None,
                    }
                ),
                status_code=500,
                mimetype="application/json",
                headers=cors,
            )

        logger.info(
            "CalendarBook event created: id=%s status=%s idempotent_id=%s",
            (event or {}).get("id"),
            (event or {}).get("status"),
            event_id,
        )
        return func.HttpResponse(
            json.dumps(
                {
                    "event": event,
                    "idempotent_event_id": event_id,
                    "resolved": {
                        "start": start_dt.isoformat(),
                        "end": end_dt.isoformat(),
                        "duration_minutes": duration_minutes,
                        "buffer_minutes": buffer_minutes,
                        "title": title,
                        "description": description,
                    },
                }
            ),
            status_code=201,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.exception("Calendar book failed")
        return func.HttpResponse(
            json.dumps({"error": "Calendar booking failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="UltravoxDebugTools")
@app.route(route="ultravox/debug-tools", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def ultravox_debug_tools(req: func.HttpRequest) -> func.HttpResponse:
    """
    Debug helper to list Ultravox tools and agent attachments (guarded by ENABLE_ULTRAVOX_DEBUG flag).
    """
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if (get_setting("ENABLE_ULTRAVOX_DEBUG") or "").lower() not in ("1", "true", "yes", "on"):
        return func.HttpResponse(
            json.dumps({"error": "Debug endpoint disabled"}),
            status_code=404,
            mimetype="application/json",
            headers=cors,
        )

    agent_id = req.params.get("agentId") or req.params.get("agent_id")
    if not agent_id:
        return func.HttpResponse(
            json.dumps({"error": "agentId is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    try:
        agent = get_ultravox_agent(agent_id)
        selected = (agent.get("callTemplate") or {}).get("selectedTools") or []
        tools = list_ultravox_tools()
        attached = [
            tool
            for tool in tools
            if (tool.get("id") or tool.get("toolId") or tool.get("tool_id")) in selected
        ]
        payload = {
            "agentId": agent_id,
            "selectedTools": selected,
            "attachedTools": attached,
            "availableTools": tools,
        }
        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Ultravox debug tools failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to list Ultravox tools"}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )


@app.function_name(name="UltravoxEnsureBookingTool")
@app.route(route="ultravox/ensure-tool", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def ultravox_ensure_booking_tool(req: func.HttpRequest) -> func.HttpResponse:
    """
    Force ensure/attach the calendar_book tool for an agent (guarded by ENABLE_ULTRAVOX_DEBUG).
    Body or params: { agentId? , email? }
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if (get_setting("ENABLE_ULTRAVOX_DEBUG") or "").lower() not in ("1", "true", "yes", "on"):
        return func.HttpResponse(
            json.dumps({"error": "Debug endpoint disabled"}),
            status_code=404,
            mimetype="application/json",
            headers=cors,
        )

    try:
        body = req.get_json()
    except ValueError:
        body = {}
    agent_id = (body or {}).get("agentId") or req.params.get("agentId") or (body or {}).get("agent_id")
    email = (body or {}).get("email") or req.params.get("email")

    db = SessionLocal()
    try:
        if not agent_id and email:
            client = db.query(Client).filter_by(email=email).one_or_none()
            agent_id = client.ultravox_agent_id if client else None
        if not agent_id:
            return func.HttpResponse(
                json.dumps({"error": "agentId or email is required"}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        base = get_public_api_base()
        tool_id, created, attached = ensure_booking_tool(agent_id, base)
        agent = get_ultravox_agent(agent_id)
        call_template = agent.get("callTemplate") or {}
        selected = call_template.get("selectedTools") or []
        return func.HttpResponse(
            json.dumps(
                {
                    "agentId": agent_id,
                    "tool_id": tool_id,
                    "created": created,
                    "attached": attached,
                    "selectedTools": selected,
                    "callTemplate": call_template,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Ultravox ensure tool failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to ensure tool", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="GoogleDisconnect")
@app.route(route="auth/google/disconnect", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def google_disconnect(req: func.HttpRequest) -> func.HttpResponse:
    """
    Delete stored Google tokens for a user to disconnect calendar access.
    Body or params: { email }
    """
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = {}
    email = (body or {}).get("email") or req.params.get("email")
    if not email:
        return func.HttpResponse(
            json.dumps({"error": "email is required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).one_or_none()
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        db.query(GoogleToken).filter_by(user_id=user.id).delete()
        db.commit()
        return func.HttpResponse(
            json.dumps({"message": "Google disconnected"}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Google disconnect failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to disconnect Google", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()
