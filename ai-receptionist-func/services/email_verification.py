"""Signed-account email verification, following the restaurant portal's OTP flow."""
import hmac
import math
import os
import re
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta
from email.message import EmailMessage

import requests
from sqlalchemy import case, or_
from sqlalchemy.exc import IntegrityError

from crm_shared import _auth_session_secret
from shared.config import get_smtp_settings
from shared.db import OutreachEmailVerification
from services.outreach_service import outreach_from_email, valid_email

TTL_SECONDS = 600
RESEND_SECONDS = 60
SEND_LIMIT = 3
ATTEMPT_LIMIT = 5


class VerificationError(ValueError):
    def __init__(self, message, status=400, retry_after=0):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


def identity(actor, email=None):
    address = str(actor.email or "").strip().lower()
    if not valid_email(address) or (email is not None and str(email).strip().lower() != address):
        raise VerificationError("Verify the email address of your signed-in account")
    subject = f"{actor.scope}:{actor.user_id or actor.client_user_id or address}"
    return actor.client_id, subject, address


def delivery_available():
    smtp = get_smtp_settings()
    smtp_ready = bool(smtp.get("host") and (not smtp.get("username") or smtp.get("password")))
    return bool(valid_email(outreach_from_email()) and (smtp_ready or os.getenv("SENDGRID_API_KEY")))


def status_payload(db, actor, now=None):
    now = now or datetime.utcnow()
    key = identity(actor)
    state = db.get(OutreachEmailVerification, key)
    retry_at = (state.next_send_at or now) if state else now
    if state and state.send_count >= SEND_LIMIT:
        retry_at = max(retry_at, state.window_started_at + timedelta(seconds=TTL_SECONDS))
    return {"email": key[2], "is_email_verified": bool(state and state.verified_at),
        "verified_at": state.verified_at.isoformat() + "Z" if state and state.verified_at else None,
        "challenge_pending": bool(state and state.status == "sent" and state.expires_at > now and state.failed_attempts < ATTEMPT_LIMIT),
        "resend_after_seconds": max(0, math.ceil((retry_at - now).total_seconds())),
        "delivery_configured": delivery_available()}


def hash_code(key, salt, code):
    secret = _auth_session_secret()
    if not secret:
        raise VerificationError("Email verification signing is not configured", 503)
    payload = f"outreach-email:{key[0]}:{key[1]}:{key[2]}:{salt}:{code}"
    return hmac.digest(secret.encode(), payload.encode(), "sha256").hex()


def send_verification_email(email, code):
    message = EmailMessage()
    message["From"] = outreach_from_email()
    message["To"] = email
    message["Subject"] = "Your Vedora Outreach verification code"
    message.set_content(f"Your verification code is:\n\n{code}\n\nThis code expires in 10 minutes.\n"
                        "If you did not request this code, you can ignore this email.")
    smtp = get_smtp_settings()
    if smtp.get("host") and (not smtp.get("username") or smtp.get("password")):
        port = smtp.get("port") or 587
        context = ssl.create_default_context()
        if port == 465:
            connection = smtplib.SMTP_SSL(smtp["host"], port, timeout=10, context=context)
        else:
            connection = smtplib.SMTP(smtp["host"], port, timeout=10)
        with connection as server:
            if port != 465 and smtp.get("use_tls", True):
                server.starttls(context=context)
            if smtp.get("username"):
                server.login(smtp["username"], smtp["password"])
            server.send_message(message)
        return
    response = requests.post("https://api.sendgrid.com/v3/mail/send", timeout=15,
        headers={"Authorization": f"Bearer {os.environ['SENDGRID_API_KEY']}"},
        json={"personalizations": [{"to": [{"email": email}]}], "from": {"email": outreach_from_email()},
            "subject": str(message["Subject"]), "content": [{"type": "text/plain", "value": message.get_content()}]})
    if response.status_code != 202:
        raise VerificationError("Email provider did not accept the verification email", 503)


def send_code(db, actor, email=None, now=None):
    now = now or datetime.utcnow()
    key = identity(actor, email)
    if not delivery_available():
        raise VerificationError("Email delivery is not configured. Configure SMTP or SendGrid to send verification codes.", 503)
    code, salt = f"{secrets.randbelow(1_000_000):06d}", secrets.token_hex(16)
    digest = hash_code(key, salt, code)
    if not db.get(OutreachEmailVerification, key):
        db.add(OutreachEmailVerification(client_id=key[0], subject=key[1], email=key[2], window_started_at=now))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # Another process created the same account state.
    reset_window = OutreachEmailVerification.window_started_at <= now - timedelta(seconds=TTL_SECONDS)
    state_query = db.query(OutreachEmailVerification).filter_by(client_id=key[0], subject=key[1], email=key[2])
    claimed = state_query.filter(OutreachEmailVerification.verified_at.is_(None),
        or_(OutreachEmailVerification.next_send_at.is_(None), OutreachEmailVerification.next_send_at <= now),
        or_(reset_window, OutreachEmailVerification.send_count < SEND_LIMIT)).update({
            "code_hash": digest, "code_salt": salt, "expires_at": now + timedelta(seconds=TTL_SECONDS),
            "status": "sending", "failed_attempts": 0,
            "window_started_at": case((reset_window, now), else_=OutreachEmailVerification.window_started_at),
            "send_count": case((reset_window, 1), else_=OutreachEmailVerification.send_count + 1),
            "next_send_at": now + timedelta(seconds=RESEND_SECONDS)}, synchronize_session=False)
    db.commit()  # Persist rate-limit and code intent before contacting the provider.
    if not claimed:
        db.expire_all()
        state = db.get(OutreachEmailVerification, key)
        if state.verified_at:
            raise VerificationError("Your email is already verified", 409)
        retry_at = state.next_send_at or now
        if state.send_count >= SEND_LIMIT:
            retry_at = max(retry_at, state.window_started_at + timedelta(seconds=TTL_SECONDS))
        raise VerificationError("Please wait before requesting another verification code", 429,
                                max(1, math.ceil((retry_at - now).total_seconds())))
    try:
        send_verification_email(key[2], code)
    except Exception:
        db.rollback()
        state_query.filter_by(code_hash=digest, status="sending").update({"status": "failed"}, synchronize_session=False)
        db.commit()
        raise VerificationError("Could not confirm delivery of the code. Wait a minute before requesting a new one.", 503, RESEND_SECONDS) from None
    state_query.filter_by(code_hash=digest, status="sending").update({"status": "sent"}, synchronize_session=False)
    db.commit()
    db.expire_all()
    return status_payload(db, actor, now)


def verify_code(db, actor, code, email=None, now=None):
    now = now or datetime.utcnow()
    key = identity(actor, email)
    db.expire_all()
    state = db.get(OutreachEmailVerification, key)
    if not state or state.status != "sent" or not state.expires_at or state.expires_at <= now:
        raise VerificationError("Invalid or expired verification code")
    if state.failed_attempts >= ATTEMPT_LIMIT:
        raise VerificationError("Too many attempts. Request a new verification code.", 429)
    matches = isinstance(code, str) and bool(re.fullmatch(r"[0-9]{6}", code)) and hmac.compare_digest(
        hash_code(key, state.code_salt, code), state.code_hash)
    updates = {"failed_attempts": OutreachEmailVerification.failed_attempts + 1}
    if matches:
        updates.update(verified_at=now, status="verified", code_hash=None, code_salt=None, expires_at=None)
    changed = db.query(OutreachEmailVerification).filter_by(client_id=key[0], subject=key[1], email=key[2],
        code_hash=state.code_hash, status="sent").filter(OutreachEmailVerification.expires_at > now,
        OutreachEmailVerification.failed_attempts < ATTEMPT_LIMIT).update(updates, synchronize_session=False)
    db.commit()
    if not changed or not matches:
        raise VerificationError("Invalid or expired verification code")
    db.expire_all()
    return status_payload(db, actor, now)
