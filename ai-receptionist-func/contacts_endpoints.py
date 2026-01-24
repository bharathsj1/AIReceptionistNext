import json
import logging
from datetime import datetime, timedelta
from typing import Optional, Tuple

from sqlalchemy.orm import Session

import azure.functions as func
import requests

from function_app import app
from repository.contacts_repo import contact_to_dict, delete_contact, list_contacts, upsert_contact
from shared.config import get_google_oauth_settings, get_outlook_oauth_settings
from shared.db import SessionLocal, User, Client, GoogleToken, OutlookToken
from tasks_shared import parse_json_body
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)

DEFAULT_CONTACT_LIMIT = 200
DEFAULT_IMPORT_LIMIT = 500


def _get_user(db: Session, email: Optional[str], user_id: Optional[str]) -> Optional[User]:
    if email:
        return db.query(User).filter_by(email=email).one_or_none()
    if user_id:
        try:
            return db.query(User).filter_by(id=int(user_id)).one_or_none()
        except ValueError:
            return None
    return None


def _get_client_id(db: Session, user: Optional[User], email: Optional[str]) -> Optional[int]:
    if user and user.id:
        client = db.query(Client).filter_by(user_id=user.id).one_or_none()
        if client:
            return client.id
    if email:
        client = db.query(Client).filter_by(email=email).one_or_none()
        if client:
            return client.id
    return None


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


def _ensure_google_access_token(db: Session, token: GoogleToken) -> Tuple[Optional[str], Optional[str]]:
    if not token:
        return None, "Missing Google token"
    now = datetime.utcnow()
    if token.expires_at and token.expires_at > now + timedelta(seconds=60):
        return token.access_token, None
    if not token.refresh_token:
        return token.access_token, None
    refreshed, error = _refresh_google_token(token.refresh_token)
    if error or not refreshed:
        return None, error
    token.access_token = refreshed.get("access_token") or token.access_token
    expires_in = refreshed.get("expires_in")
    if expires_in:
        token.expires_at = now + timedelta(seconds=int(expires_in))
    db.add(token)
    db.commit()
    return token.access_token, None


def _refresh_outlook_token(refresh_token: str) -> Tuple[Optional[dict], Optional[str]]:
    settings = get_outlook_oauth_settings()
    payload = {
        "client_id": settings["client_id"],
        "client_secret": settings["client_secret"],
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "scope": settings["scopes"],
    }
    token_url = f"https://login.microsoftonline.com/{settings['tenant']}/oauth2/v2.0/token"
    try:
        resp = requests.post(token_url, data=payload, timeout=10)
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _ensure_outlook_access_token(db: Session, token: OutlookToken) -> Tuple[Optional[str], Optional[str]]:
    if not token:
        return None, "Missing Outlook token"
    now = datetime.utcnow()
    if token.expires_at and token.expires_at > now + timedelta(seconds=60):
        return token.access_token, None
    if not token.refresh_token:
        return token.access_token, None
    refreshed, error = _refresh_outlook_token(token.refresh_token)
    if error or not refreshed:
        return None, error
    token.access_token = refreshed.get("access_token") or token.access_token
    token.refresh_token = refreshed.get("refresh_token") or token.refresh_token
    expires_in = refreshed.get("expires_in")
    if expires_in:
        token.expires_at = now + timedelta(seconds=int(expires_in))
    token.scope = refreshed.get("scope") or token.scope
    token.token_type = refreshed.get("token_type") or token.token_type
    db.add(token)
    db.commit()
    return token.access_token, None


def _import_google_contacts(
    db: Session,
    *,
    user: User,
    client_id: Optional[int],
    limit: int,
) -> Tuple[int, Optional[str]]:
    token = (
        db.query(GoogleToken)
        .filter_by(user_id=user.id)
        .order_by(GoogleToken.created_at.desc())
        .first()
    )
    if not token:
        return 0, "No Google account connected"
    access_token, error = _ensure_google_access_token(db, token)
    if error or not access_token:
        return 0, error or "Unable to refresh token"

    imported = 0
    page_token = None
    while True:
        page_size = min(max(limit - imported, 1), 500)
        if page_size <= 0:
            break
        params = {
            "personFields": "names,emailAddresses,phoneNumbers",
            "pageSize": page_size,
            "sortOrder": "FIRST_NAME_ASCENDING",
        }
        if page_token:
            params["pageToken"] = page_token
        resp = requests.get(
            "https://people.googleapis.com/v1/people/me/connections",
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
            timeout=12,
        )
        if resp.status_code != 200:
            return imported, resp.text
        payload = resp.json() if resp.text else {}
        for person in payload.get("connections", []) or []:
            if imported >= limit:
                break
            resource_name = person.get("resourceName")
            names = person.get("names") or []
            emails = person.get("emailAddresses") or []
            phones = person.get("phoneNumbers") or []
            name = names[0].get("displayName") if names else None
            email = emails[0].get("value") if emails else None
            phone = phones[0].get("value") if phones else None
            if not (name or email or phone):
                continue
            upsert_contact(
                db,
                user_id=user.id,
                client_id=client_id,
                name=name,
                email=email,
                phone=phone,
                source="gmail",
                source_ref=resource_name,
                tags=["gmail_import"],
            )
            imported += 1
        page_token = payload.get("nextPageToken")
        if not page_token or imported >= limit:
            break
    return imported, None


def _import_outlook_contacts(
    db: Session,
    *,
    user: User,
    client_id: Optional[int],
    limit: int,
) -> Tuple[int, Optional[str]]:
    token = (
        db.query(OutlookToken)
        .filter_by(user_id=user.id)
        .order_by(OutlookToken.created_at.desc())
        .first()
    )
    if not token:
        return 0, "No Outlook account connected"
    access_token, error = _ensure_outlook_access_token(db, token)
    if error or not access_token:
        return 0, error or "Unable to refresh token"

    imported = 0
    next_url = "https://graph.microsoft.com/v1.0/me/contacts?$select=id,displayName,emailAddresses,businessPhones,mobilePhone,homePhones&$top=200"
    while next_url and imported < limit:
        resp = requests.get(
            next_url,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=12,
        )
        if resp.status_code != 200:
            return imported, resp.text
        payload = resp.json() if resp.text else {}
        for contact in payload.get("value", []) or []:
            if imported >= limit:
                break
            contact_id = contact.get("id")
            name = contact.get("displayName")
            emails = contact.get("emailAddresses") or []
            email = emails[0].get("address") if emails else None
            phone = (
                contact.get("mobilePhone")
                or (contact.get("businessPhones") or [None])[0]
                or (contact.get("homePhones") or [None])[0]
            )
            if not (name or email or phone):
                continue
            upsert_contact(
                db,
                user_id=user.id,
                client_id=client_id,
                name=name,
                email=email,
                phone=phone,
                source="outlook",
                source_ref=contact_id,
                tags=["outlook_import"],
            )
            imported += 1
        next_url = payload.get("@odata.nextLink")
    return imported, None


@app.function_name(name="Contacts")
@app.route(route="contacts", methods=["GET", "POST", "DELETE", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def contacts(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "POST", "DELETE", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    if req.method == "GET":
        email = req.params.get("email")
        user_id = req.params.get("user_id") or req.params.get("userId")
        source = req.params.get("source")
        search = req.params.get("search") or req.params.get("q")
        tag = req.params.get("tag")
        limit_raw = req.params.get("limit")
        try:
            limit = int(limit_raw) if limit_raw else DEFAULT_CONTACT_LIMIT
        except ValueError:
            limit = DEFAULT_CONTACT_LIMIT

        db = SessionLocal()
        try:
            user = _get_user(db, email, user_id)
            if not user:
                return func.HttpResponse(
                    json.dumps({"error": "User not found"}),
                    status_code=404,
                    mimetype="application/json",
                    headers=cors,
                )
            items = list_contacts(
                db,
                user_id=user.id,
                source=source,
                search=search,
                tag=tag,
                limit=limit,
            )
            return func.HttpResponse(
                json.dumps({"contacts": items, "count": len(items)}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )
        finally:
            db.close()

    payload = parse_json_body(req)
    email = payload.get("email")
    user_id = payload.get("user_id") or payload.get("userId")

    db = SessionLocal()
    try:
        user = _get_user(db, email, user_id)
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        client_id = _get_client_id(db, user, email)
        if req.method == "DELETE":
            contact_id = payload.get("id") or payload.get("contactId")
            if not contact_id:
                return func.HttpResponse(
                    json.dumps({"error": "Contact id required"}),
                    status_code=400,
                    mimetype="application/json",
                    headers=cors,
                )
            deleted = delete_contact(db, user_id=user.id, contact_id=int(contact_id))
            db.commit()
            return func.HttpResponse(
                json.dumps({"deleted": bool(deleted)}),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

        contact = upsert_contact(
            db,
            user_id=user.id,
            client_id=client_id,
            name=payload.get("name"),
            email=payload.get("contactEmail") or payload.get("emailAddress") or payload.get("email"),
            phone=payload.get("contactPhone") or payload.get("phone"),
            source=payload.get("source") or "manual",
            source_ref=payload.get("sourceRef"),
            tags=payload.get("tags") or [],
            metadata=payload.get("metadata") or {},
        )
        db.commit()
        return func.HttpResponse(
            json.dumps({"contact": contact_to_dict(contact) if contact else None}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Contacts endpoint failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Contacts operation failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="ContactsImport")
@app.route(route="contacts/import", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def contacts_import(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    payload = parse_json_body(req)
    email = payload.get("email")
    user_id = payload.get("user_id") or payload.get("userId")
    source = str(payload.get("source") or "").strip().lower()
    limit_raw = payload.get("limit")
    try:
        limit = int(limit_raw) if limit_raw else DEFAULT_IMPORT_LIMIT
    except ValueError:
        limit = DEFAULT_IMPORT_LIMIT

    if source not in {"gmail", "outlook"}:
        return func.HttpResponse(
            json.dumps({"error": "Invalid source; use gmail or outlook."}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    db = SessionLocal()
    try:
        user = _get_user(db, email, user_id)
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        client_id = _get_client_id(db, user, email)
        if source == "gmail":
            count, error = _import_google_contacts(db, user=user, client_id=client_id, limit=limit)
        else:
            count, error = _import_outlook_contacts(db, user=user, client_id=client_id, limit=limit)
        if error:
            return func.HttpResponse(
                json.dumps({"error": "Import failed", "details": error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )
        db.commit()
        return func.HttpResponse(
            json.dumps({"imported": count}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        db.rollback()
        logger.error("Contacts import failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Contacts import failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="ContactsSuggest")
@app.route(route="contacts/suggest", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def contacts_suggest(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id") or req.params.get("userId")
    query = (req.params.get("q") or req.params.get("search") or "").strip()
    limit_raw = req.params.get("limit")
    try:
        limit = int(limit_raw) if limit_raw else 8
    except ValueError:
        limit = 8

    db = SessionLocal()
    try:
        user = _get_user(db, email, user_id)
        if not user:
            return func.HttpResponse(
                json.dumps({"error": "User not found"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )
        items = list_contacts(db, user_id=user.id, search=query, limit=limit)
        return func.HttpResponse(
            json.dumps({"contacts": items}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()
