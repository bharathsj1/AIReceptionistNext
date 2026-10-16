"""Encrypted platform SMTP configuration and safe delivery diagnostics."""
import base64
import hashlib
import json
import logging
import re
import smtplib
import ssl
from contextlib import contextmanager
from datetime import datetime

from cryptography.fernet import Fernet

from crm_shared import _auth_session_secret
from shared.config import get_smtp_settings
from shared.db import OutreachEmailSetting

logger = logging.getLogger(__name__)


class MailConfigurationError(ValueError):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


def cipher():
    secret = _auth_session_secret()
    if not secret:
        raise MailConfigurationError("Email secret storage is not configured")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("outreach-email:" + secret).encode()).digest()))


def smtp_settings(db=None):
    if db is not None:
        row = db.get(OutreachEmailSetting, "smtp")
        if row:
            try:
                return json.loads(cipher().decrypt(row.encrypted_value.encode()).decode())
            except Exception:
                # Never silently switch to unrelated deployment credentials.
                raise MailConfigurationError("Saved email settings could not be read. Ask the platform administrator to save them again.") from None
    return get_smtp_settings()


def delivery_available(db=None):
    try:
        settings = smtp_settings(db)
        return bool(settings.get("host") and (not settings.get("username") or settings.get("password")))
    except MailConfigurationError:
        return False


def send_message(message, db=None):
    settings = smtp_settings(db)
    if not settings.get("host") or (settings.get("username") and not settings.get("password")):
        raise MailConfigurationError("Configure SMTP in Calling setup → Email delivery settings")
    if db is not None and db.get(OutreachEmailSetting, "smtp"):
        message.replace_header("From", settings["from_email"])
    with smtp_connection(settings) as server:
        refused = server.send_message(message)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)


def failure_status(exc):
    """Retry explicit SMTP rejections only; an unknown DATA outcome needs review."""
    if isinstance(exc, smtplib.SMTPResponseException):
        return "retry" if 400 <= exc.smtp_code < 500 else "failed"
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        codes = [value[0] for value in exc.recipients.values()]
        return "retry" if codes and all(400 <= code < 500 for code in codes) else "failed"
    if isinstance(exc, (MailConfigurationError, smtplib.SMTPNotSupportedError, ValueError)):
        return "failed"
    return "needs_review"


@contextmanager
def smtp_connection(settings):
    port = settings.get("port") or 587
    context = ssl.create_default_context()
    implicit_tls = port == 465 or settings.get("use_ssl", False)
    server = (smtplib.SMTP_SSL(settings["host"], port, timeout=10, context=context) if implicit_tls
              else smtplib.SMTP(settings["host"], port, timeout=10))
    try:
        if not implicit_tls and settings.get("use_tls", True):
            server.starttls(context=context)
        if settings.get("username"):
            server.login(settings["username"], settings["password"])
        yield server
    finally:
        # QUIT may fail after DATA was accepted; that does not undo delivery.
        try:
            server.quit()
        except (OSError, smtplib.SMTPException):
            server.close()


def failure_message(exc):
    if isinstance(exc, MailConfigurationError):
        return str(exc)
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "The email provider rejected the SMTP login. The platform administrator must update the email username or app password in Email delivery settings."
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return "The email provider rejected the sender address. The platform administrator must authorize support@vedoraeats.com with the email provider."
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "The email provider rejected the recipient address. Check your account email or contact support."
    if isinstance(exc, (ssl.SSLError, smtplib.SMTPNotSupportedError)):
        return "A secure connection to the email provider failed. The platform administrator must check the SMTP host, port and TLS settings."
    if isinstance(exc, (OSError, smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected)):
        return "The email provider could not be reached. The platform administrator must check the SMTP connection. Try again in a minute."
    return "Could not confirm delivery of the code. Wait a minute before requesting a new one."


def log_failure(exc):
    # Provider exception text can contain credentials, addresses or message data.
    logger.warning("Verification email failed: category=%s smtp_status=%s", type(exc).__name__,
                   getattr(exc, "smtp_code", None))


def require_admin(actor):
    from services.outreach_billing import is_platform_admin
    if not is_platform_admin(actor):
        raise MailConfigurationError("Platform administrator access required", 403)


def settings_payload(db, actor):
    require_admin(actor)
    try:
        settings = smtp_settings(db)
    except MailConfigurationError:
        settings = {}
    return {"host": settings.get("host") or "", "port": settings.get("port") or 587,
            "username": settings.get("username") or "", "password_configured": bool(settings.get("password")),
            "saved": bool(db.get(OutreachEmailSetting, "smtp")), "sender": "support@vedoraeats.com"}


def save_settings(db, actor, body):
    require_admin(actor)
    host = str(body.get("host") or "").strip().lower()
    username = str(body.get("username") or "").strip()
    password = body.get("password")
    port = body.get("port")
    if not re.fullmatch(r"(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}", host):
        raise MailConfigurationError("Enter the SMTP hostname, without a URL or path", 400)
    if isinstance(port, bool) or str(port) not in {"465", "587"}:
        raise MailConfigurationError("Use SMTP port 465 (SSL) or 587 (STARTTLS)", 400)
    if not username or len(username) > 254 or any(c in username for c in "\r\n"):
        raise MailConfigurationError("Enter your SMTP username", 400)
    if password is None:
        previous = smtp_settings(db)
        if previous.get("host") != host or previous.get("username") != username:
            raise MailConfigurationError("Enter the password for this email provider", 400)
        password = previous.get("password")
    if not isinstance(password, str) or not password or len(password) > 4096:
        raise MailConfigurationError("Enter your SMTP password or provider app password", 400)
    settings = {"host": host, "port": int(port), "username": username, "password": password,
                "from_email": "support@vedoraeats.com", "use_tls": True, "use_ssl": int(port) == 465}
    encrypted = cipher().encrypt(json.dumps(settings).encode()).decode()
    try:
        # Validate login and sender only. No recipient or email is submitted.
        with smtp_connection(settings) as server:
            code, detail = server.mail(settings["from_email"])
            if code != 250:
                raise smtplib.SMTPSenderRefused(code, detail, settings["from_email"])
            server.rset()
    except Exception as exc:
        log_failure(exc)
        raise MailConfigurationError(failure_message(exc)) from None
    row = db.get(OutreachEmailSetting, "smtp")
    if row is None:
        row = OutreachEmailSetting(id="smtp", encrypted_value=encrypted)
        db.add(row)
    row.encrypted_value = encrypted
    row.updated_at = datetime.utcnow()
    db.commit()
    return {**settings_payload(db, actor), "connection_verified": True}
