from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from typing import Any, Dict

_TOKEN_ALLOWED = re.compile(r"[^A-Za-z0-9_-]+")
_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")

_PUBLIC_FIELDS = [
    "fullName",
    "jobTitle",
    "department",
    "companyName",
    "workPhone",
    "mobilePhone",
    "whatsappPhone",
    "email",
    "website",
    "address",
    "mapUrl",
    "linkedInUrl",
    "photoUrl",
]


def _clamp_secret_length(length: int | None) -> int:
    try:
        value = int(length or 24)
    except (TypeError, ValueError):
        value = 24
    return max(24, min(32, value))


def _new_urlsafe_secret(length: int) -> str:
    # token_urlsafe() is cryptographically random and URL-safe by design.
    # We still remove any unexpected chars and trim to exact length.
    while True:
        candidate = secrets.token_urlsafe(48)
        cleaned = _TOKEN_ALLOWED.sub("", candidate)
        if len(cleaned) >= length:
            return cleaned[:length]


def generate_token(length: int = 24) -> str:
    return _new_urlsafe_secret(_clamp_secret_length(length))


def generate_key(length: int = 24) -> str:
    return _new_urlsafe_secret(_clamp_secret_length(length))


def sha256_hex(value: str) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(str(a or ""), str(b or ""))


def normalize_phone_e164(phone: str | None) -> str:
    raw = str(phone or "").strip()
    if not raw:
        return ""
    cleaned = re.sub(r"[^\d+]", "", raw)
    if cleaned.startswith("00"):
        cleaned = f"+{cleaned[2:]}"
    if cleaned.startswith("+"):
        return f"+{re.sub(r'[^0-9]', '', cleaned)}"
    # Best-effort: preserve already-global numbers and normalize others.
    digits = re.sub(r"\D", "", cleaned)
    if not digits:
        return ""
    return f"+{digits}"


def digits_only(phone: str | None) -> str:
    return re.sub(r"\D", "", str(phone or ""))


def sanitize_public_card(entity: Dict[str, Any] | None) -> Dict[str, str]:
    entity = entity or {}
    return {field: str(entity.get(field) or "") for field in _PUBLIC_FIELDS}


def _vcard_escape(value: str) -> str:
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace(";", r"\;")
        .replace(",", r"\,")
        .replace("\r\n", r"\n")
        .replace("\n", r"\n")
    )


def _split_name(full_name: str) -> tuple[str, str]:
    parts = [part for part in str(full_name or "").strip().split(" ") if part]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return "", parts[0]
    return " ".join(parts[1:]), parts[0]


def build_vcard(card: Dict[str, Any]) -> str:
    full_name = str(card.get("fullName") or "").strip()
    if not full_name:
        full_name = "Contact"
    last_name, first_name = _split_name(full_name)

    lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        f"N:{_vcard_escape(last_name)};{_vcard_escape(first_name)};;;",
        f"FN:{_vcard_escape(full_name)}",
    ]

    company = str(card.get("companyName") or "").strip()
    if company:
        lines.append(f"ORG:{_vcard_escape(company)}")

    title = str(card.get("jobTitle") or "").strip()
    if title:
        lines.append(f"TITLE:{_vcard_escape(title)}")

    work_phone = normalize_phone_e164(card.get("workPhone"))
    if work_phone:
        lines.append(f"TEL;TYPE=WORK,VOICE:{work_phone}")

    mobile_phone = normalize_phone_e164(card.get("mobilePhone"))
    if mobile_phone:
        lines.append(f"TEL;TYPE=CELL,VOICE:{mobile_phone}")

    email = str(card.get("email") or "").strip()
    if email:
        lines.append(f"EMAIL;TYPE=WORK:{_vcard_escape(email)}")

    website = str(card.get("website") or "").strip()
    if website:
        lines.append(f"URL:{_vcard_escape(website)}")

    address = str(card.get("address") or "").strip()
    if address:
        lines.append(f"ADR;TYPE=WORK:;;{_vcard_escape(address)};;;;")

    lines.append("END:VCARD")
    return "\r\n".join(lines) + "\r\n"


def safe_filename(name: str | None) -> str:
    cleaned = _SAFE_FILENAME.sub("_", str(name or "").strip())
    cleaned = cleaned.strip("._")
    return cleaned or "contact"
