import json
import logging
import secrets
import hashlib
from datetime import datetime, timedelta

import azure.functions as func
from function_app import app
from shared.db import SessionLocal, User, Client

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
