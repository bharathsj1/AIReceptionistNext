import os
from typing import Optional


def get_setting(name: str, default: Optional[str] = None) -> Optional[str]:
    return os.getenv(name, default)


def get_database_url() -> str:
    return os.getenv("DATABASE_URL") or "sqlite:///./data/vedora.db"


def get_smtp_settings() -> dict:
    return {
        "host": os.getenv("SMTP_HOST"),
        "port": int(os.getenv("SMTP_PORT", "587")) if os.getenv("SMTP_PORT") else None,
        "username": os.getenv("SMTP_USERNAME"),
        "password": os.getenv("SMTP_PASSWORD"),
        "from_email": os.getenv("SMTP_FROM_EMAIL") or os.getenv("SMTP_USERNAME"),
        "use_tls": os.getenv("SMTP_USE_TLS", "true").lower() != "false",
        "use_ssl": os.getenv("SMTP_USE_SSL", "false").lower() == "true",
    }
