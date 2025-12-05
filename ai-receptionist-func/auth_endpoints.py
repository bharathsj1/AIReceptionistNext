import json
import logging
import secrets
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Tuple

import azure.functions as func
import requests
from function_app import app
from shared.config import get_google_oauth_settings
from shared.db import SessionLocal, User, Client, GoogleToken

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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.function_name(name="AuthSignup")
@app.route(route="auth/signup", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_signup(req: func.HttpRequest) -> func.HttpResponse:
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
        )

    db = SessionLocal()
    try:
        existing = db.query(User).filter_by(email=email).one_or_none()
        if existing:
            return func.HttpResponse(
                json.dumps({"error": "User already exists"}),
                status_code=409,
                mimetype="application/json",
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
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Signup failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Signup failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
        )
    finally:
        db.close()


@app.function_name(name="AuthLogin")
@app.route(route="auth/login", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_login(req: func.HttpRequest) -> func.HttpResponse:
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
        )

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).one_or_none()
        if not user or not _verify_password(password, user.password_hash):
            return func.HttpResponse(
                json.dumps({"error": "Invalid credentials"}),
                status_code=401,
                mimetype="application/json",
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
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Login failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Login failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
        )
    finally:
        db.close()


@app.function_name(name="AuthForgotPassword")
@app.route(route="auth/forgot-password", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_forgot_password(req: func.HttpRequest) -> func.HttpResponse:
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
        )

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).one_or_none()
        if not user:
            return func.HttpResponse(
                json.dumps({"message": "If the account exists, a reset link will be sent."}),
                status_code=200,
                mimetype="application/json",
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
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Forgot password failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Forgot password failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
        )
    finally:
        db.close()


@app.function_name(name="AuthResetPassword")
@app.route(route="auth/reset-password", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_reset_password(req: func.HttpRequest) -> func.HttpResponse:
    try:
        body = req.get_json()
    except ValueError:
        body = None
    token = (body or {}).get("token")
    new_password = (body or {}).get("new_password")
    if not token or not new_password:
        return func.HttpResponse(
            json.dumps({"error": "token and new_password are required"}),
            status_code=400,
            mimetype="application/json",
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
            )

        user.password_hash = _hash_password(new_password)
        user.reset_token = None
        user.reset_token_expires = None
        db.commit()

        return func.HttpResponse(
            json.dumps({"message": "Password reset successful"}),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Reset password failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Reset password failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
        )
    finally:
        db.close()


@app.function_name(name="GoogleAuthUrl")
@app.route(route="auth/google/url", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def auth_google_url(req: func.HttpRequest) -> func.HttpResponse:  # pylint: disable=unused-argument
    settings = get_google_oauth_settings()
    if not settings["client_id"] or not settings["client_secret"]:
        return func.HttpResponse(
            json.dumps({"error": "Google OAuth env vars missing"}),
            status_code=500,
            mimetype="application/json",
        )
    state = secrets.token_urlsafe(16)
    url = _build_google_auth_url(state)
    return func.HttpResponse(
        json.dumps({"auth_url": url, "state": state}),
        status_code=200,
        mimetype="application/json",
    )


@app.function_name(name="GoogleAuthCallback")
@app.route(
    route="auth/google/callback",
    methods=["GET", "POST"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def auth_google_callback(req: func.HttpRequest) -> func.HttpResponse:
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
        )

    token_data, token_error = _exchange_code_for_tokens(code)
    if token_error or not token_data:
        return func.HttpResponse(
            json.dumps({"error": "Failed to exchange code", "details": token_error}),
            status_code=400,
            mimetype="application/json",
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
        )

    email = profile.get("email")
    name = profile.get("name") or email
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=email).one_or_none()
        if not user:
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

        payload = {
            "user_id": user.id,
            "email": user.email,
            "state": state,
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
            return func.HttpResponse(html, status_code=200, mimetype="text/html")

        return func.HttpResponse(
            json.dumps(payload),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Google auth callback failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Google auth failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
        )
    finally:
        db.close()


@app.function_name(name="CalendarEvents")
@app.route(route="calendar/events", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def calendar_events(req: func.HttpRequest) -> func.HttpResponse:
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
                )
            access_token = refreshed.get("access_token") or access_token
            token.access_token = access_token
            token.expires_at = (
                datetime.utcnow() + timedelta(seconds=int(refreshed.get("expires_in")))
                if refreshed.get("expires_in")
                else None
            )
            db.commit()

        events, events_error = _get_calendar_events(access_token, max_results=max_results)
        if events_error or not events:
            return func.HttpResponse(
                json.dumps({"error": "Failed to fetch calendar", "details": events_error}),
                status_code=400,
                mimetype="application/json",
            )

        return func.HttpResponse(
            json.dumps({"events": events.get("items", []), "summary": events.get("summary"), "user": user.email}),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Calendar events failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Calendar fetch failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
        )
    finally:
        db.close()
