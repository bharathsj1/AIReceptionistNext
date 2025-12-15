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
    return {
        "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
        "redirect_uri": os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:5173"),
        "scopes": os.getenv(
            "GOOGLE_SCOPES",
            "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
        ),
    }


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
