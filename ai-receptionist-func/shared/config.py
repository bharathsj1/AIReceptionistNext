import os
from typing import Optional


def get_setting(name: str, default: Optional[str] = None) -> Optional[str]:
    """Return an environment setting with an optional default."""
    return os.getenv(name, default)


def get_required_setting(name: str) -> str:
    """Return a required environment setting or raise a ValueError."""
    value = os.getenv(name)
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def get_database_url() -> str:
    """
    Return the database URL for SQLAlchemy.
    Defaults to a local SQLite file for development if not provided.
    """
    return os.getenv("DATABASE_URL") or os.getenv("POSTGRES_CONNECTION_STRING") or "sqlite:///./data/app.db"


def get_google_oauth_settings() -> dict:
    """
    Centralized helper for Google OAuth env vars.
    """
    raw_scopes = os.getenv(
        "GOOGLE_SCOPES",
        "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
    )
    scopes = {scope.strip() for scope in raw_scopes.split() if scope.strip()}
    # Ensure write-capable calendar scope is always requested.
    scopes.update(
        {
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/gmail.modify",
            "https://www.googleapis.com/auth/gmail.send",
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/contacts.readonly",
            "https://www.googleapis.com/auth/contacts.other.readonly",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
        }
    )
    return {
        "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
        "redirect_uri": os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:5173"),
        "scopes": " ".join(sorted(scopes)),
    }


def get_outlook_oauth_settings() -> dict:
    """
    Centralized helper for Microsoft OAuth env vars.
    """
    raw_scopes = os.getenv(
        "OUTLOOK_SCOPES",
        "offline_access https://graph.microsoft.com/Contacts.Read https://graph.microsoft.com/User.Read",
    )
    scopes = {scope.strip() for scope in raw_scopes.split() if scope.strip()}
    scopes.update({"offline_access", "https://graph.microsoft.com/Contacts.Read", "https://graph.microsoft.com/User.Read"})
    return {
        "client_id": os.getenv("OUTLOOK_CLIENT_ID", ""),
        "client_secret": os.getenv("OUTLOOK_CLIENT_SECRET", ""),
        "redirect_uri": os.getenv("OUTLOOK_REDIRECT_URI", "http://localhost:5173"),
        "scopes": " ".join(sorted(scopes)),
        "tenant": os.getenv("OUTLOOK_TENANT", "common"),
    }


def get_public_api_base() -> str:
    """
    Base URL for webhooks to call back into this API (no trailing slash).
    Priority:
    1) API_PUBLIC_BASE_URL
    2) WEBSITE_HOSTNAME (Azure App Service/Functions)
    3) local Functions host (localhost)
    """
    explicit_base = (os.getenv("API_PUBLIC_BASE_URL") or "").strip()
    if explicit_base:
        return explicit_base.rstrip("/")

    website_hostname = (os.getenv("WEBSITE_HOSTNAME") or "").strip()
    if website_hostname:
        return f"https://{website_hostname}".rstrip("/")

    return "http://localhost:7071"


def get_smtp_settings() -> dict:
    """
    SMTP settings for transactional email (temp password, etc).
    Values are optional; caller should decide whether to require them.
    """
    return {
        "host": os.getenv("SMTP_HOST"),
        "port": int(os.getenv("SMTP_PORT", "587")) if os.getenv("SMTP_PORT") else None,
        "username": os.getenv("SMTP_USERNAME"),
        "password": os.getenv("SMTP_PASSWORD"),
        "from_email": os.getenv("SMTP_FROM_EMAIL") or os.getenv("SMTP_USERNAME"),
        "use_tls": os.getenv("SMTP_USE_TLS", "true").lower() != "false",
        "use_ssl": os.getenv("SMTP_USE_SSL", "false").lower() == "true",
    }
