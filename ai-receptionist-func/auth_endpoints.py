import json
import logging
import secrets
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Tuple
from urllib.parse import parse_qs

import azure.functions as func
import requests
from function_app import app
from shared.config import get_google_oauth_settings, get_public_api_base
from shared.db import SessionLocal, User, Client, GoogleToken
from utils.cors import build_cors_headers
from services.ultravox_service import create_ultravox_webhook

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
) -> Tuple[Optional[dict], Optional[str]]:
    payload = {
        "summary": summary,
        "start": {"dateTime": start_iso},
        "end": {"dateTime": end_iso},
    }
    if description:
        payload["description"] = description
    if attendees:
        payload["attendees"] = attendees

    try:
        resp = requests.post(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=payload,
            timeout=10,
        )
        if resp.status_code >= 300:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _maybe_create_ultravox_webhook_for_user(email: str, db):
    """
    After Google connect, auto-create an Ultravox webhook (End Call) scoped to the user's agent.
    Best-effort; failures are logged and do not block auth.
    """
    try:
        client = db.query(Client).filter_by(email=email).one_or_none()
        if not client or not client.ultravox_agent_id:
            return

        base = get_public_api_base()
        destination = f"{base}/api/calendar/book"
        scope = {"type": "AGENT", "value": client.ultravox_agent_id}
        # Per docs: events take dotted format.
        create_ultravox_webhook(destination, ["call.ended"], scope=scope)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Auto Ultravox webhook creation failed for %s: %s", email, exc)


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

        # Auto-create Ultravox webhook for end-call booking (best-effort)
        _maybe_create_ultravox_webhook_for_user(email, db)

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

        # Auto-create Ultravox webhook for end-call booking (best-effort)
        _maybe_create_ultravox_webhook_for_user(email, db)

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

    try:
        body = req.get_json()
        print(body)
    except ValueError:
        body = None
    if not isinstance(body, dict):
        body = {}

    email = body.get("email")
    agent_id = (
        body.get("agentId")
        or body.get("agent_id")
        or (body.get("agent") or {}).get("id")
        or (body.get("call") or {}).get("agentId")
        or (body.get("call") or {}).get("agent_id")
        or ((body.get("call") or {}).get("agent") or {}).get("id")
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

    caller_lines = []
    if caller_name:
        caller_lines.append(f"Caller: {caller_name}")
    if caller_email:
        caller_lines.append(f"Email: {caller_email}")
    if caller_phone:
        caller_lines.append(f"Phone: {caller_phone}")
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

        if not email or not user:
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

        if not start_iso:
            start_dt = datetime.utcnow() + timedelta(minutes=15)
        else:
            start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        if end_iso:
            end_dt = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
        else:
            end_dt = start_dt + timedelta(minutes=duration_minutes)

        buffered_end = end_dt + timedelta(minutes=buffer_minutes) if buffer_minutes else end_dt

        fb, fb_error = _freebusy(
            access_token,
            start_dt.isoformat(),
            buffered_end.isoformat(),
        )
        if fb_error or not fb:
            return func.HttpResponse(
                json.dumps({"error": "Unable to check availability", "details": fb_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        busy = fb.get("calendars", {}).get("primary", {}).get("busy", [])
        if busy:
            return func.HttpResponse(
                json.dumps({"error": "Slot is busy", "busy": busy}),
                status_code=409,
                mimetype="application/json",
                headers=cors,
            )

        attendees = []
        if caller_email:
            attendees.append({"email": caller_email})
        event, event_error = _create_calendar_event(
            access_token,
            title,
            start_dt.isoformat(),
            end_dt.isoformat(),
            description=description,
            attendees=attendees or None,
        )
        if event_error or not event:
            return func.HttpResponse(
                json.dumps({"error": "Failed to create event", "details": event_error}),
                status_code=500,
                mimetype="application/json",
                headers=cors,
            )

        return func.HttpResponse(
            json.dumps({"event": event}),
            status_code=201,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Calendar book failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Calendar booking failed", "details": str(exc)}),
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
