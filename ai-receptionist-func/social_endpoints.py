import base64
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import azure.functions as func
import httpx
from sqlalchemy.exc import IntegrityError, OperationalError

from adapters import meta as meta_adapter
from adapters import whatsapp_meta as whatsapp_adapter
from adapters import x as x_adapter
from function_app import app
from shared.config import get_public_api_base, get_required_setting, get_setting
from shared.db import (
    Client,
    SessionLocal,
    SocialConnection,
    SocialConversation,
    SocialMessage,
    SocialPostDraft,
    SocialScheduledPost,
    User,
)
from utils.cors import build_cors_headers
from utils.token_crypto import decrypt_token, encrypt_token

logger = logging.getLogger(__name__)

PLATFORM_META = "meta"
PLATFORM_WHATSAPP_META = "whatsapp_meta"
PLATFORM_WHATSAPP_TWILIO = "whatsapp_twilio"
PLATFORM_X = "x"

CHANNEL_FACEBOOK = "facebook"
CHANNEL_INSTAGRAM = "instagram"

_TRUTHY = {"1", "true", "yes", "y", "on"}


def _social_scheduler_disabled() -> bool:
    raw = get_setting("DISABLE_SOCIAL_SCHEDULER")
    if raw is None:
        return False
    return str(raw).strip().lower() in _TRUTHY


def _utcnow() -> datetime:
    return datetime.utcnow()


def _dt_to_iso(value: Optional[datetime]) -> Optional[str]:
    if not value:
        return None
    try:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc).isoformat()
        return value.astimezone(timezone.utc).isoformat()
    except Exception:  # pylint: disable=broad-except
        return value.isoformat()


def _parse_timestamp(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        try:
            if raw > 10_000_000_000:  # ms
                return datetime.fromtimestamp(raw / 1000, tz=timezone.utc).replace(tzinfo=None)
            return datetime.fromtimestamp(raw, tz=timezone.utc).replace(tzinfo=None)
        except Exception:  # pylint: disable=broad-except
            return None
    if isinstance(raw, str):
        try:
            if raw.isdigit():
                return _parse_timestamp(int(raw))
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        except Exception:  # pylint: disable=broad-except
            return None
    return None


def _encode_state(payload: dict) -> str:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _decode_state(state: Optional[str]) -> Optional[dict]:
    if not state:
        return None
    try:
        padded = state + "=" * (-len(state) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("utf-8"))
        return json.loads(raw.decode("utf-8"))
    except Exception:  # pylint: disable=broad-except
        return None


def _get_user_and_client(db, email: Optional[str], user_id: Optional[str]) -> tuple[Optional[User], Optional[Client]]:
    user = None
    if email:
        user = db.query(User).filter_by(email=email).one_or_none()
    elif user_id:
        try:
            user = db.query(User).filter_by(id=int(user_id)).one_or_none()
        except ValueError:
            user = None

    client = None
    if user and user.id:
        client = db.query(Client).filter_by(user_id=user.id).one_or_none()
    if not client and email:
        client = db.query(Client).filter_by(email=email).one_or_none()
    return user, client


def _require_business(db, email: Optional[str], user_id: Optional[str]) -> tuple[Optional[User], Optional[Client], Optional[str]]:
    user, client = _get_user_and_client(db, email, user_id)
    if not client:
        return user, None, "Business not found"
    return user, client, None


def _safe_metadata(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:  # pylint: disable=broad-except
            return {}
    return {}


def _upsert_connection(
    db,
    *,
    business_id: int,
    platform: str,
    external_account_id: str,
    display_name: Optional[str],
    access_token: str,
    refresh_token: Optional[str] = None,
    scopes: Optional[str] = None,
    token_expires_at: Optional[datetime] = None,
    metadata: Optional[dict] = None,
) -> SocialConnection:
    record = (
        db.query(SocialConnection)
        .filter_by(business_id=business_id, platform=platform, external_account_id=external_account_id)
        .one_or_none()
    )
    enc_access = encrypt_token(access_token)
    enc_refresh = encrypt_token(refresh_token) if refresh_token else None
    if record:
        record.display_name = display_name
        record.access_token_enc = enc_access
        record.refresh_token_enc = enc_refresh
        record.scopes = scopes
        record.token_expires_at = token_expires_at
        record.metadata_json = metadata or record.metadata_json
        record.status = "connected"
        record.updated_at = _utcnow()
        return record
    record = SocialConnection(
        business_id=business_id,
        platform=platform,
        external_account_id=external_account_id,
        display_name=display_name,
        access_token_enc=enc_access,
        refresh_token_enc=enc_refresh,
        token_expires_at=token_expires_at,
        scopes=scopes,
        metadata_json=metadata,
        status="connected",
    )
    db.add(record)
    return record


def _get_connection_token(connection: SocialConnection) -> str:
    return decrypt_token(connection.access_token_enc)


def _upsert_conversation(
    db,
    *,
    business_id: int,
    platform: str,
    connection_id: int,
    external_conversation_id: str,
    participant_handle: Optional[str],
    participant_name: Optional[str],
    last_message_text: Optional[str],
    last_message_at: Optional[datetime],
) -> SocialConversation:
    record = (
        db.query(SocialConversation)
        .filter_by(platform=platform, external_conversation_id=external_conversation_id)
        .one_or_none()
    )
    if record:
        record.business_id = business_id
        record.connection_id = connection_id
        record.participant_handle = participant_handle or record.participant_handle
        record.participant_name = participant_name or record.participant_name
        record.last_message_text = last_message_text or record.last_message_text
        record.last_message_at = last_message_at or record.last_message_at
        record.updated_at = _utcnow()
        return record
    record = SocialConversation(
        business_id=business_id,
        platform=platform,
        connection_id=connection_id,
        external_conversation_id=external_conversation_id,
        participant_handle=participant_handle,
        participant_name=participant_name,
        last_message_text=last_message_text,
        last_message_at=last_message_at,
    )
    db.add(record)
    return record


def _store_message(
    db,
    *,
    conversation_id: int,
    platform: str,
    external_message_id: str,
    direction: str,
    sender_type: str,
    text: Optional[str],
    attachments: Optional[dict],
    message_ts: Optional[datetime],
) -> bool:
    if not external_message_id:
        return False
    existing = (
        db.query(SocialMessage)
        .filter_by(platform=platform, external_message_id=external_message_id)
        .one_or_none()
    )
    if existing:
        return False
    record = SocialMessage(
        conversation_id=conversation_id,
        platform=platform,
        external_message_id=external_message_id,
        direction=direction,
        sender_type=sender_type,
        text=text,
        attachments_json=attachments,
        message_ts=message_ts,
        created_at=_utcnow(),
    )
    try:
        with db.begin_nested():
            db.add(record)
            db.flush()
    except IntegrityError:
        return False
    return True


def _normalize_meta_channel(connection: SocialConnection) -> str:
    metadata = _safe_metadata(connection.metadata_json)
    if metadata.get("meta_type") == "instagram_business" or metadata.get("ig") is True:
        return CHANNEL_INSTAGRAM
    return CHANNEL_FACEBOOK


def _fetch_conversations(db, business_id: int, limit: int, cursor: Optional[datetime]) -> list[SocialConversation]:
    query = db.query(SocialConversation).filter_by(business_id=business_id)
    if cursor:
        query = query.filter(SocialConversation.last_message_at < cursor)
    return (
        query.order_by(SocialConversation.last_message_at.desc())
        .limit(limit)
        .all()
    )


@app.function_name(name="MetaAuthUrl")
@app.route(route="social/meta/auth-url", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def meta_auth_url(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id") or req.params.get("userId")
    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        meta_app_id = get_required_setting("META_APP_ID")
        redirect_base = get_setting("PUBLIC_APP_URL") or get_public_api_base()
        redirect_uri = f"{redirect_base.rstrip('/')}/api/social/meta/callback"
        scopes = [
            "pages_show_list",
            "pages_messaging",
            "instagram_basic",
            "instagram_manage_messages",
        ]
        state = _encode_state(
            {
                "nonce": secrets.token_urlsafe(16),
                "business_id": client.id,
                "email": email,
                "user_id": user_id,
            }
        )
        url = meta_adapter.build_auth_url(meta_app_id, redirect_uri, scopes, state)
        return func.HttpResponse(
            json.dumps({"auth_url": url}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Meta auth url failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to build auth url", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="MetaAuthCallback")
@app.route(route="social/meta/callback", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def meta_auth_callback(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    code = req.params.get("code")
    state = req.params.get("state")
    if not code:
        try:
            body = req.get_json()
            code = code or (body or {}).get("code")
            state = state or (body or {}).get("state")
        except ValueError:
            code = code or None

    if not code:
        error_code = req.params.get("error_code")
        error_reason = req.params.get("error_reason")
        error_message = req.params.get("error_message") or req.params.get("error_description")
        if error_code or error_reason or error_message:
            return func.HttpResponse(
                json.dumps(
                    {
                        "error": "Meta authorization failed",
                        "error_code": error_code,
                        "error_reason": error_reason,
                        "error_message": error_message,
                    }
                ),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )
        return func.HttpResponse(
            json.dumps({"error": "Missing code"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    state_payload = _decode_state(state)
    business_id = (state_payload or {}).get("business_id")
    if not business_id:
        return func.HttpResponse(
            json.dumps({"error": "Missing business context"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    meta_app_id = get_required_setting("META_APP_ID")
    meta_app_secret = get_required_setting("META_APP_SECRET")
    redirect_base = get_setting("PUBLIC_APP_URL") or get_public_api_base()
    redirect_uri = f"{redirect_base.rstrip('/')}/api/social/meta/callback"

    token_data, token_error = meta_adapter.exchange_code_for_token(
        meta_app_id, meta_app_secret, redirect_uri, code
    )
    if token_error or not token_data:
        return func.HttpResponse(
            json.dumps({"error": "Token exchange failed", "details": token_error}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    user_access_token = token_data.get("access_token")
    if not user_access_token:
        return func.HttpResponse(
            json.dumps({"error": "Missing user access token"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    pages, pages_error = meta_adapter.list_accounts(user_access_token)
    if pages_error:
        return func.HttpResponse(
            json.dumps({"error": "Failed to list pages", "details": pages_error}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    expires_in = token_data.get("expires_in")
    token_expires_at = None
    if expires_in:
        try:
            token_expires_at = _utcnow() + timedelta(seconds=int(expires_in))
        except (TypeError, ValueError):
            token_expires_at = None

    db = SessionLocal()
    try:
        connected = 0
        ig_connected = 0
        for page in pages:
            page_id = str(page.get("id") or "")
            page_token = page.get("access_token")
            if not page_id or not page_token:
                continue
            page_name = page.get("name") or f"Page {page_id}"
            metadata = {"meta_type": "facebook_page"}
            ig_account = page.get("instagram_business_account") or {}
            ig_id = ig_account.get("id")
            ig_username = ig_account.get("username")
            if ig_id:
                metadata["ig_user_id"] = ig_id
                metadata["ig_username"] = ig_username
            _upsert_connection(
                db,
                business_id=int(business_id),
                platform=PLATFORM_META,
                external_account_id=page_id,
                display_name=page_name,
                access_token=page_token,
                scopes=token_data.get("scope"),
                token_expires_at=token_expires_at,
                metadata=metadata,
            )
            connected += 1
            if ig_id:
                ig_metadata = {
                    "meta_type": "instagram_business",
                    "page_id": page_id,
                    "ig_username": ig_username,
                }
                _upsert_connection(
                    db,
                    business_id=int(business_id),
                    platform=PLATFORM_META,
                    external_account_id=str(ig_id),
                    display_name=ig_username or f"Instagram {ig_id}",
                    access_token=page_token,
                    scopes=token_data.get("scope"),
                    token_expires_at=token_expires_at,
                    metadata=ig_metadata,
                )
                ig_connected += 1

        db.commit()
        payload = {"status": "connected", "pages": connected, "instagram": ig_connected}
        if req.method == "GET":
            html = (
                "<script>"
                "window.opener && window.opener.postMessage("
                + json.dumps(payload)
                + ', "*");'
                "window.close();"
                "</script>"
                "<p>Meta connection saved. You can close this tab.</p>"
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
        logger.error("Meta callback failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Meta callback failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="WhatsAppAuthUrl")
@app.route(route="social/whatsapp/auth-url", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def whatsapp_auth_url(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id") or req.params.get("userId")
    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        meta_app_id = get_required_setting("META_APP_ID")
        redirect_base = get_setting("PUBLIC_APP_URL") or get_public_api_base()
        redirect_uri = f"{redirect_base.rstrip('/')}/api/social/whatsapp/callback"
        scopes = [
            "whatsapp_business_management",
            "whatsapp_business_messaging",
            "business_management",
        ]
        state = _encode_state(
            {
                "nonce": secrets.token_urlsafe(16),
                "business_id": client.id,
                "email": email,
                "user_id": user_id,
            }
        )
        config_id = get_setting("META_WHATSAPP_CONFIG_ID")
        url = whatsapp_adapter.build_auth_url(meta_app_id, redirect_uri, scopes, state, config_id)
        return func.HttpResponse(
            json.dumps({"auth_url": url}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("WhatsApp auth url failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Failed to build WhatsApp auth url", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="WhatsAppAuthCallback")
@app.route(route="social/whatsapp/callback", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def whatsapp_auth_callback(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    code = req.params.get("code")
    state = req.params.get("state")
    if not code:
        try:
            body = req.get_json()
            code = code or (body or {}).get("code")
            state = state or (body or {}).get("state")
        except ValueError:
            code = code or None

    if not code:
        error_code = req.params.get("error_code")
        error_reason = req.params.get("error_reason")
        error_message = req.params.get("error_message") or req.params.get("error_description")
        if error_code or error_reason or error_message:
            return func.HttpResponse(
                json.dumps(
                    {
                        "error": "WhatsApp authorization failed",
                        "error_code": error_code,
                        "error_reason": error_reason,
                        "error_message": error_message,
                    }
                ),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )
        return func.HttpResponse(
            json.dumps({"error": "Missing code"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    state_payload = _decode_state(state)
    business_id = (state_payload or {}).get("business_id")
    if not business_id:
        return func.HttpResponse(
            json.dumps({"error": "Missing business context"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    meta_app_id = get_required_setting("META_APP_ID")
    meta_app_secret = get_required_setting("META_APP_SECRET")
    redirect_base = get_setting("PUBLIC_APP_URL") or get_public_api_base()
    redirect_uri = f"{redirect_base.rstrip('/')}/api/social/whatsapp/callback"

    token_data, token_error = meta_adapter.exchange_code_for_token(
        meta_app_id, meta_app_secret, redirect_uri, code
    )
    if token_error or not token_data:
        return func.HttpResponse(
            json.dumps({"error": "Token exchange failed", "details": token_error}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    user_access_token = token_data.get("access_token")
    if not user_access_token:
        return func.HttpResponse(
            json.dumps({"error": "Missing user access token"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    wabas, waba_error = whatsapp_adapter.list_business_accounts(user_access_token)
    if waba_error:
        if "whatsapp_business_accounts" in waba_error and "nonexisting field" in waba_error:
            businesses, businesses_error = whatsapp_adapter.list_businesses(user_access_token)
            if businesses_error:
                return func.HttpResponse(
                    json.dumps(
                        {"error": "Failed to list Meta businesses", "details": businesses_error}
                    ),
                    status_code=400,
                    mimetype="application/json",
                    headers=cors,
                )
            wabas = []
            for biz in businesses:
                biz_id = str(biz.get("id") or "")
                if not biz_id:
                    continue
                biz_wabas, biz_error = whatsapp_adapter.list_owned_whatsapp_business_accounts(
                    biz_id, user_access_token
                )
                if biz_error:
                    logger.warning("WhatsApp owned WABA lookup failed for %s: %s", biz_id, biz_error)
                    continue
                wabas.extend(biz_wabas)
        else:
            return func.HttpResponse(
                json.dumps({"error": "Failed to list WhatsApp business accounts", "details": waba_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

    expires_in = token_data.get("expires_in")
    token_expires_at = None
    if expires_in:
        try:
            token_expires_at = _utcnow() + timedelta(seconds=int(expires_in))
        except (TypeError, ValueError):
            token_expires_at = None

    db = SessionLocal()
    try:
        connected = 0
        for waba in wabas:
            waba_id = str(waba.get("id") or "")
            if not waba_id:
                continue
            waba_name = waba.get("name") or f"WABA {waba_id}"
            phone_numbers, phone_error = whatsapp_adapter.list_phone_numbers(waba_id, user_access_token)
            if phone_error:
                logger.warning("WhatsApp phone numbers failed for %s: %s", waba_id, phone_error)
                continue
            for phone in phone_numbers:
                phone_id = str(phone.get("id") or "")
                if not phone_id:
                    continue
                display_number = phone.get("display_phone_number")
                verified_name = phone.get("verified_name")
                metadata = {
                    "waba_id": waba_id,
                    "waba_name": waba_name,
                    "display_phone_number": display_number,
                    "verified_name": verified_name,
                    "quality_rating": phone.get("quality_rating"),
                }
                display_name = verified_name or display_number or f"WhatsApp {phone_id}"
                _upsert_connection(
                    db,
                    business_id=int(business_id),
                    platform=PLATFORM_WHATSAPP_META,
                    external_account_id=phone_id,
                    display_name=display_name,
                    access_token=user_access_token,
                    scopes=token_data.get("scope"),
                    token_expires_at=token_expires_at,
                    metadata=metadata,
                )
                connected += 1

        if connected == 0:
            return func.HttpResponse(
                json.dumps({"error": "No WhatsApp phone numbers found for this account."}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        db.commit()
        payload = {"status": "connected", "connections": connected}
        if req.method == "GET":
            html = (
                "<script>"
                "window.opener && window.opener.postMessage("
                + json.dumps(payload)
                + ', "*");'
                "window.close();"
                "</script>"
                "<p>WhatsApp connection saved. You can close this tab.</p>"
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
        logger.error("WhatsApp callback failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "WhatsApp callback failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="SocialConnections")
@app.route(route="social/connections", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_connections(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id") or req.params.get("userId")
    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        connections = (
            db.query(SocialConnection)
            .filter_by(business_id=client.id)
            .order_by(SocialConnection.updated_at.desc())
            .all()
        )
        payload = [
            {
                "id": conn.id,
                "business_id": conn.business_id,
                "platform": conn.platform,
                "external_account_id": conn.external_account_id,
                "display_name": conn.display_name,
                "status": conn.status,
                "metadata": _safe_metadata(conn.metadata_json),
                "created_at": _dt_to_iso(conn.created_at),
                "updated_at": _dt_to_iso(conn.updated_at),
            }
            for conn in connections
        ]
        return func.HttpResponse(
            json.dumps({"connections": payload}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="SocialDisconnect")
@app.route(route="social/connections/disconnect", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_disconnect(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None

    email = (body or {}).get("email")
    user_id = (body or {}).get("user_id") or (body or {}).get("userId")
    connection_id = (body or {}).get("connection_id") or (body or {}).get("connectionId")
    platform = (body or {}).get("platform")
    external_account_id = (body or {}).get("external_account_id")

    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        query = db.query(SocialConnection).filter_by(business_id=client.id)
        if connection_id:
            query = query.filter_by(id=int(connection_id))
        elif platform and external_account_id:
            query = query.filter_by(platform=platform, external_account_id=external_account_id)
        else:
            return func.HttpResponse(
                json.dumps({"error": "connection_id or platform + external_account_id required"}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )
        record = query.one_or_none()
        if not record:
            return func.HttpResponse(
                json.dumps({"error": "Connection not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        record.status = "revoked"
        record.updated_at = _utcnow()
        db.commit()
        return func.HttpResponse(
            json.dumps({"status": "revoked", "connection_id": record.id}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="WhatsAppManualConnect")
@app.route(route="social/whatsapp/connect-manual", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def whatsapp_manual_connect(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None

    email = (body or {}).get("email")
    user_id = (body or {}).get("user_id") or (body or {}).get("userId")
    phone_number_id = (body or {}).get("phone_number_id") or (body or {}).get("phoneNumberId")
    waba_id = (body or {}).get("waba_id") or (body or {}).get("wabaId")
    permanent_token = (body or {}).get("permanent_token") or (body or {}).get("permanentToken")

    if not phone_number_id or not permanent_token:
        return func.HttpResponse(
            json.dumps({"error": "phone_number_id and permanent_token are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        metadata = {"waba_id": waba_id} if waba_id else {}
        _upsert_connection(
            db,
            business_id=client.id,
            platform=PLATFORM_WHATSAPP_META,
            external_account_id=str(phone_number_id),
            display_name=f"WhatsApp {phone_number_id}",
            access_token=permanent_token,
            metadata=metadata,
        )
        db.commit()
        return func.HttpResponse(
            json.dumps({"status": "connected"}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("WhatsApp manual connect failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "WhatsApp connect failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="WhatsAppSendMessage")
@app.route(route="social/whatsapp/send", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def whatsapp_send_message(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None

    email = (body or {}).get("email")
    user_id = (body or {}).get("user_id") or (body or {}).get("userId")
    text = (body or {}).get("text")
    to_number = (body or {}).get("to")
    connection_id = (body or {}).get("connection_id") or (body or {}).get("connectionId")
    phone_number_id = (body or {}).get("phone_number_id") or (body or {}).get("phoneNumberId")

    if not text or not to_number:
        return func.HttpResponse(
            json.dumps({"error": "to and text are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        connection = None
        if connection_id:
            try:
                connection = (
                    db.query(SocialConnection)
                    .filter_by(id=int(connection_id), business_id=client.id, platform=PLATFORM_WHATSAPP_META)
                    .one_or_none()
                )
            except ValueError:
                connection = None
        elif phone_number_id:
            connection = (
                db.query(SocialConnection)
                .filter_by(
                    business_id=client.id,
                    platform=PLATFORM_WHATSAPP_META,
                    external_account_id=str(phone_number_id),
                )
                .one_or_none()
            )
        else:
            connection = (
                db.query(SocialConnection)
                .filter_by(business_id=client.id, platform=PLATFORM_WHATSAPP_META)
                .order_by(SocialConnection.updated_at.desc())
                .first()
            )

        if not connection:
            return func.HttpResponse(
                json.dumps({"error": "WhatsApp connection not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token = _get_connection_token(connection)
        external_id, error_message = whatsapp_adapter.send_message(
            connection.external_account_id,
            access_token,
            str(to_number),
            text,
        )
        if error_message:
            return func.HttpResponse(
                json.dumps({"error": "Send failed", "details": error_message}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        message_ts = _utcnow()
        conversation = _upsert_conversation(
            db,
            business_id=client.id,
            platform=PLATFORM_WHATSAPP_META,
            connection_id=connection.id,
            external_conversation_id=str(to_number),
            participant_handle=str(to_number),
            participant_name=None,
            last_message_text=text,
            last_message_at=message_ts,
        )
        db.flush()
        _store_message(
            db,
            conversation_id=conversation.id,
            platform=PLATFORM_WHATSAPP_META,
            external_message_id=str(external_id),
            direction="outbound",
            sender_type="business",
            text=text,
            attachments=None,
            message_ts=message_ts,
        )
        db.commit()

        return func.HttpResponse(
            json.dumps(
                {
                    "status": "sent",
                    "message_id": external_id,
                    "conversation_id": conversation.id,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("WhatsApp send failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "WhatsApp send failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="MetaWebhook")
@app.route(route="social/meta/webhook", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def meta_webhook(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if req.method == "GET":
        mode = req.params.get("hub.mode")
        token = req.params.get("hub.verify_token")
        challenge = req.params.get("hub.challenge")
        verify_token = get_setting("META_VERIFY_TOKEN")
        if mode == "subscribe" and token and verify_token and token == verify_token:
            return func.HttpResponse(challenge or "", status_code=200, headers=cors)
        return func.HttpResponse("Forbidden", status_code=403, headers=cors)

    try:
        payload = req.get_json()
    except ValueError:
        payload = None
    if not payload:
        return func.HttpResponse("Invalid payload", status_code=400, headers=cors)

    db = SessionLocal()
    try:
        for entry in payload.get("entry", []):
            entry_id = str(entry.get("id") or "")
            if not entry_id:
                continue
            connection = (
                db.query(SocialConnection)
                .filter_by(platform=PLATFORM_META, external_account_id=entry_id)
                .one_or_none()
            )
            if not connection:
                continue
            platform = _normalize_meta_channel(connection)
            business_id = connection.business_id

            for messaging in entry.get("messaging", []) or []:
                sender_id = messaging.get("sender", {}).get("id")
                recipient_id = messaging.get("recipient", {}).get("id")
                message = messaging.get("message") or {}
                text = message.get("text")
                message_id = message.get("mid") or message.get("id")
                timestamp = _parse_timestamp(messaging.get("timestamp") or message.get("timestamp"))
                direction = "outbound" if message.get("is_echo") else "inbound"
                sender_type = "business" if direction == "outbound" else "customer"
                participant_id = recipient_id if direction == "outbound" else sender_id
                if not participant_id or not message_id:
                    continue
                conversation = _upsert_conversation(
                    db,
                    business_id=business_id,
                    platform=platform,
                    connection_id=connection.id,
                    external_conversation_id=str(participant_id),
                    participant_handle=str(participant_id),
                    participant_name=None,
                    last_message_text=text,
                    last_message_at=timestamp,
                )
                db.flush()
                _store_message(
                    db,
                    conversation_id=conversation.id,
                    platform=platform,
                    external_message_id=str(message_id),
                    direction=direction,
                    sender_type=sender_type,
                    text=text,
                    attachments={"raw": message.get("attachments")} if message.get("attachments") else None,
                    message_ts=timestamp,
                )

            for change in entry.get("changes", []) or []:
                value = change.get("value") or {}
                field = change.get("field") or ""
                comment_id = value.get("comment_id") or value.get("id")
                message_text = value.get("message") or value.get("text")
                if not comment_id or not message_text:
                    continue
                if field not in {"comments", "feed", "instagram"}:
                    continue
                from_info = value.get("from") or {}
                from_id = from_info.get("id") or value.get("from_id")
                from_name = from_info.get("name") or value.get("from_name")
                timestamp = _parse_timestamp(value.get("created_time") or value.get("timestamp"))
                external_conv_id = f"comment:{comment_id}"
                conversation = _upsert_conversation(
                    db,
                    business_id=business_id,
                    platform=platform,
                    connection_id=connection.id,
                    external_conversation_id=external_conv_id,
                    participant_handle=str(from_id) if from_id else None,
                    participant_name=from_name,
                    last_message_text=message_text,
                    last_message_at=timestamp,
                )
                db.flush()
                _store_message(
                    db,
                    conversation_id=conversation.id,
                    platform=platform,
                    external_message_id=str(comment_id),
                    direction="inbound",
                    sender_type="customer",
                    text=message_text,
                    attachments=None,
                    message_ts=timestamp,
                )

        db.commit()
        return func.HttpResponse("OK", status_code=200, headers=cors)
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Meta webhook failed: %s", exc)
        return func.HttpResponse("Webhook error", status_code=500, headers=cors)
    finally:
        db.close()


@app.function_name(name="WhatsAppWebhook")
@app.route(route="social/whatsapp/webhook", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def whatsapp_webhook(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if req.method == "GET":
        mode = req.params.get("hub.mode")
        token = req.params.get("hub.verify_token")
        challenge = req.params.get("hub.challenge")
        verify_token = get_setting("META_VERIFY_TOKEN")
        if mode == "subscribe" and token and verify_token and token == verify_token:
            return func.HttpResponse(challenge or "", status_code=200, headers=cors)
        return func.HttpResponse("Forbidden", status_code=403, headers=cors)

    try:
        payload = req.get_json()
    except ValueError:
        payload = None
    if not payload:
        return func.HttpResponse("Invalid payload", status_code=400, headers=cors)

    db = SessionLocal()
    try:
        for entry in payload.get("entry", []) or []:
            for change in entry.get("changes", []) or []:
                value = change.get("value") or {}
                metadata = value.get("metadata") or {}
                phone_number_id = metadata.get("phone_number_id")
                if not phone_number_id:
                    continue
                connection = (
                    db.query(SocialConnection)
                    .filter_by(platform=PLATFORM_WHATSAPP_META, external_account_id=str(phone_number_id))
                    .one_or_none()
                )
                if not connection:
                    continue
                business_id = connection.business_id
                contacts = value.get("contacts") or []
                contact_names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in contacts}

                for msg in value.get("messages", []) or []:
                    msg_id = msg.get("id")
                    from_id = msg.get("from")
                    msg_ts = _parse_timestamp(msg.get("timestamp"))
                    msg_type = msg.get("type")
                    text = None
                    attachments = None
                    if msg_type == "text":
                        text = (msg.get("text") or {}).get("body")
                    else:
                        attachments = {"type": msg_type, "payload": msg.get(msg_type)}
                        text = (msg.get("text") or {}).get("body") if msg.get("text") else None

                    if not msg_id or not from_id:
                        continue
                    participant_name = contact_names.get(from_id)
                    conversation = _upsert_conversation(
                        db,
                        business_id=business_id,
                        platform=PLATFORM_WHATSAPP_META,
                        connection_id=connection.id,
                        external_conversation_id=str(from_id),
                        participant_handle=str(from_id),
                        participant_name=participant_name,
                        last_message_text=text,
                        last_message_at=msg_ts,
                    )
                    db.flush()
                    _store_message(
                        db,
                        conversation_id=conversation.id,
                        platform=PLATFORM_WHATSAPP_META,
                        external_message_id=str(msg_id),
                        direction="inbound",
                        sender_type="customer",
                        text=text,
                        attachments=attachments,
                        message_ts=msg_ts,
                    )

        db.commit()
        return func.HttpResponse("OK", status_code=200, headers=cors)
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("WhatsApp webhook failed: %s", exc)
        return func.HttpResponse("Webhook error", status_code=500, headers=cors)
    finally:
        db.close()


@app.function_name(name="SocialInboxConversations")
@app.route(route="social/inbox/conversations", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_inbox_conversations(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id") or req.params.get("userId")
    limit_param = req.params.get("limit")
    cursor = req.params.get("cursor")

    try:
        limit = min(int(limit_param), 100) if limit_param else 30
    except ValueError:
        limit = 30

    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        cursor_dt = _parse_timestamp(cursor) if cursor else None
        conversations = _fetch_conversations(db, client.id, limit, cursor_dt)
        connection_ids = {conv.connection_id for conv in conversations}
        connection_map = {}
        if connection_ids:
            connection_map = {
                conn.id: conn
                for conn in db.query(SocialConnection)
                .filter(SocialConnection.id.in_(connection_ids))
                .all()
            }
        payload = []
        for conv in conversations:
            conn = connection_map.get(conv.connection_id)
            payload.append(
                {
                    "id": conv.id,
                    "platform": conv.platform,
                    "connection_id": conv.connection_id,
                    "connection_name": conn.display_name if conn else None,
                    "connection_platform": conn.platform if conn else None,
                    "external_conversation_id": conv.external_conversation_id,
                    "participant_handle": conv.participant_handle,
                    "participant_name": conv.participant_name,
                    "last_message_text": conv.last_message_text,
                    "last_message_at": _dt_to_iso(conv.last_message_at),
                }
            )
        next_cursor = _dt_to_iso(conversations[-1].last_message_at) if conversations else None
        return func.HttpResponse(
            json.dumps({"conversations": payload, "next_cursor": next_cursor}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="SocialInboxMessages")
@app.route(route="social/inbox/conversations/{conversation_id}/messages", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_inbox_messages(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    conversation_id = req.route_params.get("conversation_id")
    email = req.params.get("email")
    user_id = req.params.get("user_id") or req.params.get("userId")
    if not conversation_id:
        return func.HttpResponse(
            json.dumps({"error": "conversation_id required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        convo = (
            db.query(SocialConversation)
            .filter_by(id=int(conversation_id), business_id=client.id)
            .one_or_none()
        )
        if not convo:
            return func.HttpResponse(
                json.dumps({"error": "Conversation not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        messages = (
            db.query(SocialMessage)
            .filter_by(conversation_id=convo.id)
            .order_by(SocialMessage.message_ts.asc())
            .all()
        )
        payload = [
            {
                "id": msg.id,
                "platform": msg.platform,
                "direction": msg.direction,
                "sender_type": msg.sender_type,
                "text": msg.text,
                "attachments": msg.attachments_json,
                "message_ts": _dt_to_iso(msg.message_ts),
            }
            for msg in messages
        ]
        return func.HttpResponse(
            json.dumps({"messages": payload, "conversation": {"id": convo.id, "platform": convo.platform}}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="SocialInboxReply")
@app.route(route="social/inbox/conversations/{conversation_id}/reply", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_inbox_reply(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    conversation_id = req.route_params.get("conversation_id")
    if not conversation_id:
        return func.HttpResponse(
            json.dumps({"error": "conversation_id required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )
    try:
        body = req.get_json()
    except ValueError:
        body = None

    text = (body or {}).get("text")
    email = (body or {}).get("email")
    user_id = (body or {}).get("user_id") or (body or {}).get("userId")

    if not text:
        return func.HttpResponse(
            json.dumps({"error": "text required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        convo = (
            db.query(SocialConversation)
            .filter_by(id=int(conversation_id), business_id=client.id)
            .one_or_none()
        )
        if not convo:
            return func.HttpResponse(
                json.dumps({"error": "Conversation not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        connection = db.query(SocialConnection).filter_by(id=convo.connection_id).one_or_none()
        if not connection:
            return func.HttpResponse(
                json.dumps({"error": "Connection not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        access_token = _get_connection_token(connection)
        external_id = None
        error_message = None
        if convo.platform == PLATFORM_WHATSAPP_META:
            external_id, error_message = whatsapp_adapter.send_message(
                connection.external_account_id,
                access_token,
                convo.external_conversation_id,
                text,
            )
        elif convo.platform == CHANNEL_INSTAGRAM:
            external_id, error_message = meta_adapter.send_message(
                CHANNEL_INSTAGRAM,
                access_token,
                connection.external_account_id,
                convo.external_conversation_id,
                text,
            )
        elif convo.platform == CHANNEL_FACEBOOK:
            external_id, error_message = meta_adapter.send_message(
                CHANNEL_FACEBOOK,
                access_token,
                connection.external_account_id,
                convo.external_conversation_id,
                text,
            )
        elif convo.platform == PLATFORM_X:
            external_id, error_message = x_adapter.send_message()
        else:
            error_message = f"Unsupported platform {convo.platform}"

        if error_message:
            return func.HttpResponse(
                json.dumps({"error": "Send failed", "details": error_message}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        message_ts = _utcnow()
        _store_message(
            db,
            conversation_id=convo.id,
            platform=convo.platform,
            external_message_id=str(external_id),
            direction="outbound",
            sender_type="business",
            text=text,
            attachments=None,
            message_ts=message_ts,
        )
        convo.last_message_text = text
        convo.last_message_at = message_ts
        convo.updated_at = _utcnow()
        db.commit()
        return func.HttpResponse(
            json.dumps({"status": "sent", "external_message_id": external_id}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Reply failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Reply failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


def _build_suggestion_prompt(business: Client, messages: list[SocialMessage]) -> str:
    profile_lines = []
    if business.business_name or business.name:
        profile_lines.append(f"Business name: {business.business_name or business.name}")
    if business.business_phone:
        profile_lines.append(f"Phone: {business.business_phone}")
    if business.website_url:
        profile_lines.append(f"Website: {business.website_url}")
    if business.website_data:
        profile_lines.append(f"Business notes: {business.website_data[:1200]}")
    profile_block = "\n".join(profile_lines) if profile_lines else "Business profile not available."

    history_lines = []
    for msg in messages:
        direction = "Customer" if msg.direction == "inbound" else "Business"
        text = msg.text or ""
        history_lines.append(f"{direction}: {text}")
    history_block = "\n".join(history_lines)
    return (
        "You are a customer support agent drafting a reply for social media inbox.\n"
        "Rules:\n"
        "- Never claim actions were completed unless explicitly stated.\n"
        "- Ask a short clarifying question if needed.\n"
        "- Keep replies concise (1-3 sentences).\n\n"
        f"{profile_block}\n\nConversation:\n{history_block}\n\nDraft a reply:"
    )


def _fallback_suggestion(messages: list[SocialMessage]) -> str:
    last_inbound = next((m for m in reversed(messages) if m.direction == "inbound"), None)
    base = "Thanks for reaching out! "
    if last_inbound and last_inbound.text:
        return base + "Could you share a little more detail so we can help?"
    return base + "How can we help today?"


@app.function_name(name="SocialSuggestReply")
@app.route(route="social/ai/suggest-reply", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_suggest_reply(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    email = (body or {}).get("email")
    user_id = (body or {}).get("user_id") or (body or {}).get("userId")
    conversation_id = (body or {}).get("conversation_id") or (body or {}).get("conversationId")
    if not conversation_id:
        return func.HttpResponse(
            json.dumps({"error": "conversation_id required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        convo = (
            db.query(SocialConversation)
            .filter_by(id=int(conversation_id), business_id=client.id)
            .one_or_none()
        )
        if not convo:
            return func.HttpResponse(
                json.dumps({"error": "Conversation not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        messages = (
            db.query(SocialMessage)
            .filter_by(conversation_id=convo.id)
            .order_by(SocialMessage.message_ts.desc())
            .limit(10)
            .all()
        )
        messages = list(reversed(messages))
        api_key = get_setting("OPENAI_API_KEY")
        if not api_key:
            suggestion = _fallback_suggestion(messages)
            return func.HttpResponse(
                json.dumps({"suggestion": suggestion}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )
        prompt = _build_suggestion_prompt(client, messages)
        base_url = get_setting("OPENAI_BASE_URL", "https://api.openai.com/v1")
        model = get_setting("OPENAI_SOCIAL_MODEL") or get_setting("OPENAI_MODEL", "gpt-4.1-mini")
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": "You draft helpful, concise social replies."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.4,
            "max_tokens": 180,
        }
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        url = f"{base_url.rstrip('/')}/chat/completions"
        timeout = httpx.Timeout(connect=10.0, read=45.0, write=10.0, pool=None)
        with httpx.Client(timeout=timeout) as client_http:
            resp = client_http.post(url, headers=headers, json=payload)
        if resp.status_code >= 300:
            raise RuntimeError(f"OpenAI error {resp.status_code}")
        data = resp.json()
        suggestion = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        if not suggestion:
            suggestion = _fallback_suggestion(messages)
        return func.HttpResponse(
            json.dumps({"suggestion": suggestion}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Suggest reply failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Suggestion failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="SocialDrafts")
@app.route(route="social/posts/drafts", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_post_drafts(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id") or req.params.get("userId")
    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        drafts = (
            db.query(SocialPostDraft)
            .filter_by(business_id=client.id)
            .order_by(SocialPostDraft.updated_at.desc())
            .all()
        )
        payload = [
            {
                "id": draft.id,
                "caption": draft.caption,
                "media_urls": draft.media_urls_json or [],
                "created_at": _dt_to_iso(draft.created_at),
                "updated_at": _dt_to_iso(draft.updated_at),
            }
            for draft in drafts
        ]
        return func.HttpResponse(
            json.dumps({"drafts": payload}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="SocialDraftCreate")
@app.route(route="social/posts/draft", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_post_draft_create(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    email = (body or {}).get("email")
    user_id = (body or {}).get("user_id") or (body or {}).get("userId")
    caption = (body or {}).get("caption") or ""
    media_urls = (body or {}).get("media_urls") or (body or {}).get("mediaUrls") or []
    if isinstance(media_urls, str):
        media_urls = [media_urls]

    db = SessionLocal()
    try:
        user, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        draft = SocialPostDraft(
            business_id=client.id,
            caption=caption,
            media_urls_json=[str(url) for url in media_urls if url],
            created_by_user_id=user.id,
        )
        db.add(draft)
        db.commit()
        return func.HttpResponse(
            json.dumps({"id": draft.id}),
            status_code=201,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Create draft failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Create draft failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="SocialDraftUpdate")
@app.route(route="social/posts/draft/{draft_id}", methods=["PUT", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_post_draft_update(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["PUT", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    draft_id = req.route_params.get("draft_id")
    try:
        body = req.get_json()
    except ValueError:
        body = None
    email = (body or {}).get("email")
    user_id = (body or {}).get("user_id") or (body or {}).get("userId")
    caption = (body or {}).get("caption")
    media_urls = (body or {}).get("media_urls") or (body or {}).get("mediaUrls")

    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        draft = (
            db.query(SocialPostDraft)
            .filter_by(id=int(draft_id), business_id=client.id)
            .one_or_none()
        )
        if not draft:
            return func.HttpResponse(
                json.dumps({"error": "Draft not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        if caption is not None:
            draft.caption = caption
        if media_urls is not None:
            if isinstance(media_urls, str):
                media_urls = [media_urls]
            draft.media_urls_json = [str(url) for url in media_urls if url]
        draft.updated_at = _utcnow()
        db.commit()
        return func.HttpResponse(
            json.dumps({"status": "updated"}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


def _publish_targets(
    *,
    db,
    business_id: int,
    draft: SocialPostDraft,
    targets: dict,
) -> tuple[dict, Optional[str]]:
    results: dict = {}
    errors: list[str] = []

    if targets.get("facebook_page_id"):
        page_id = str(targets.get("facebook_page_id"))
        connection = (
            db.query(SocialConnection)
            .filter_by(business_id=business_id, platform=PLATFORM_META, external_account_id=page_id)
            .one_or_none()
        )
        if not connection:
            errors.append(f"Facebook page {page_id} not connected")
        else:
            access_token = _get_connection_token(connection)
            media_url = (draft.media_urls_json or [None])[0]
            post_id, error = meta_adapter.publish_facebook_post(
                page_id, access_token, draft.caption or "", media_url
            )
            if error:
                errors.append(error)
            else:
                results["facebook_page_id"] = page_id
                results["facebook_post_id"] = post_id

    if targets.get("instagram_user_id"):
        ig_id = str(targets.get("instagram_user_id"))
        connection = (
            db.query(SocialConnection)
            .filter_by(business_id=business_id, platform=PLATFORM_META, external_account_id=ig_id)
            .one_or_none()
        )
        if not connection:
            errors.append(f"Instagram account {ig_id} not connected")
        else:
            access_token = _get_connection_token(connection)
            media_url = (draft.media_urls_json or [None])[0]
            if not media_url:
                errors.append("Instagram publishing requires media URL")
                return results, "; ".join(errors)
            post_id, error = meta_adapter.publish_instagram_post(
                ig_id, access_token, draft.caption or "", media_url or ""
            )
            if error:
                errors.append(error)
            else:
                results["instagram_user_id"] = ig_id
                results["instagram_post_id"] = post_id

    if errors:
        return results, "; ".join(errors)
    return results, None


@app.function_name(name="SocialPublishNow")
@app.route(route="social/posts/publish", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_publish_now(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None

    email = (body or {}).get("email")
    user_id = (body or {}).get("user_id") or (body or {}).get("userId")
    draft_id = (body or {}).get("draft_id") or (body or {}).get("draftId")
    targets = (body or {}).get("targets") or {}
    if not draft_id:
        return func.HttpResponse(
            json.dumps({"error": "draft_id required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        draft = (
            db.query(SocialPostDraft)
            .filter_by(id=int(draft_id), business_id=client.id)
            .one_or_none()
        )
        if not draft:
            return func.HttpResponse(
                json.dumps({"error": "Draft not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        results, error_message = _publish_targets(
            db=db, business_id=client.id, draft=draft, targets=targets
        )
        status = "published" if not error_message else "failed"
        scheduled = SocialScheduledPost(
            business_id=client.id,
            draft_id=draft.id,
            platform_targets_json=targets,
            scheduled_for=_utcnow(),
            status=status,
            external_post_ids_json=results or None,
            last_error=error_message,
        )
        db.add(scheduled)
        db.commit()
        if error_message:
            return func.HttpResponse(
                json.dumps({"error": "Publish failed", "details": error_message, "results": results}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )
        return func.HttpResponse(
            json.dumps({"status": "published", "results": results}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Publish failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Publish failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="SocialSchedulePost")
@app.route(route="social/posts/schedule", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_schedule_post(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None

    email = (body or {}).get("email")
    user_id = (body or {}).get("user_id") or (body or {}).get("userId")
    draft_id = (body or {}).get("draft_id") or (body or {}).get("draftId")
    targets = (body or {}).get("targets") or {}
    scheduled_for = (body or {}).get("scheduled_for") or (body or {}).get("scheduledFor")
    scheduled_dt = _parse_timestamp(scheduled_for)
    if not draft_id or not scheduled_dt:
        return func.HttpResponse(
            json.dumps({"error": "draft_id and scheduled_for required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        draft = (
            db.query(SocialPostDraft)
            .filter_by(id=int(draft_id), business_id=client.id)
            .one_or_none()
        )
        if not draft:
            return func.HttpResponse(
                json.dumps({"error": "Draft not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        scheduled = SocialScheduledPost(
            business_id=client.id,
            draft_id=draft.id,
            platform_targets_json=targets,
            scheduled_for=scheduled_dt,
            status="scheduled",
        )
        db.add(scheduled)
        db.commit()
        return func.HttpResponse(
            json.dumps({"status": "scheduled", "id": scheduled.id}),
            status_code=201,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Schedule failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Schedule failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="SocialScheduledPosts")
@app.route(route="social/posts/scheduled", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_scheduled_posts(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id") or req.params.get("userId")
    db = SessionLocal()
    try:
        _, client, error = _require_business(db, email, user_id)
        if error:
            return func.HttpResponse(
                json.dumps({"error": error}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        posts = (
            db.query(SocialScheduledPost)
            .filter_by(business_id=client.id)
            .order_by(SocialScheduledPost.scheduled_for.desc())
            .all()
        )
        payload = [
            {
                "id": post.id,
                "draft_id": post.draft_id,
                "scheduled_for": _dt_to_iso(post.scheduled_for),
                "status": post.status,
                "targets": post.platform_targets_json,
                "external_post_ids": post.external_post_ids_json,
                "last_error": post.last_error,
            }
            for post in posts
        ]
        return func.HttpResponse(
            json.dumps({"scheduled_posts": payload}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


def _fetch_due_posts(db, limit: int = 5) -> list[SocialScheduledPost]:
    now = _utcnow()
    query = (
        db.query(SocialScheduledPost)
        .filter(SocialScheduledPost.status == "scheduled")
        .filter(SocialScheduledPost.scheduled_for <= now)
        .order_by(SocialScheduledPost.scheduled_for.asc())
    )
    if db.bind.dialect.name != "sqlite":
        query = query.with_for_update(skip_locked=True)
    posts = query.limit(limit).all()
    for post in posts:
        post.status = "publishing"
        post.updated_at = _utcnow()
    return posts


@app.function_name(name="SocialScheduler")
@app.timer_trigger(schedule="0 */1 * * * *", arg_name="timer", run_on_startup=False, use_monitor=True)
def social_scheduler(timer: func.TimerRequest) -> None:
    if _social_scheduler_disabled():
        logger.info("SocialScheduler disabled by DISABLE_SOCIAL_SCHEDULER")
        return
    db = SessionLocal()
    try:
        due_posts = _fetch_due_posts(db)
        if not due_posts:
            db.commit()
            return
        db.commit()
    except OperationalError as exc:
        db.rollback()
        logger.warning("Scheduler DB error: %s", exc)
        return
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Scheduler fetch failed: %s", exc)
        return
    finally:
        db.close()

    for post in due_posts:
        db = SessionLocal()
        try:
            scheduled = db.query(SocialScheduledPost).filter_by(id=post.id).one_or_none()
            if not scheduled or scheduled.status != "publishing":
                db.close()
                continue
            draft = db.query(SocialPostDraft).filter_by(id=scheduled.draft_id).one_or_none()
            if not draft:
                scheduled.status = "failed"
                scheduled.last_error = "Draft missing"
                db.commit()
                db.close()
                continue
            results, error_message = _publish_targets(
                db=db,
                business_id=scheduled.business_id,
                draft=draft,
                targets=scheduled.platform_targets_json or {},
            )
            if error_message:
                scheduled.status = "failed"
                scheduled.last_error = error_message
            else:
                scheduled.status = "published"
                scheduled.external_post_ids_json = results
            scheduled.updated_at = _utcnow()
            db.commit()
        except Exception as exc:  # pylint: disable=broad-except
            db.rollback()
            logger.error("Scheduler publish failed: %s", exc)
            try:
                scheduled = db.query(SocialScheduledPost).filter_by(id=post.id).one_or_none()
                if scheduled:
                    scheduled.status = "failed"
                    scheduled.last_error = str(exc)
                    scheduled.updated_at = _utcnow()
                    db.commit()
            except Exception:  # pylint: disable=broad-except
                db.rollback()
        finally:
            db.close()


@app.function_name(name="XScaffold")
@app.route(route="social/x/connect", methods=["GET", "POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_x_scaffold(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)
    return func.HttpResponse(
        json.dumps({"status": "coming_soon"}),
        status_code=200,
        mimetype="application/json",
        headers=cors,
    )
