import base64
import hashlib
import os
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

TOKEN_PREFIX = "v1:"


def _derive_key() -> bytes:
    raw = os.getenv("SOCIAL_TOKEN_ENC_KEY")
    if not raw:
        raise ValueError("Missing required environment variable: SOCIAL_TOKEN_ENC_KEY")

    raw_bytes: Optional[bytes] = None
    try:
        padded = raw + "=" * (-len(raw) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("utf-8"))
        if len(decoded) in (16, 24, 32):
            raw_bytes = decoded
    except Exception:
        raw_bytes = None

    if not raw_bytes:
        raw_bytes = hashlib.sha256(raw.encode("utf-8")).digest()

    if len(raw_bytes) not in (16, 24, 32):
        raise ValueError("Invalid SOCIAL_TOKEN_ENC_KEY length")
    return raw_bytes


def encrypt_token(token: str) -> str:
    if token is None:
        raise ValueError("token is required")
    key = _derive_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, token.encode("utf-8"), None)
    payload = base64.urlsafe_b64encode(nonce + ciphertext).decode("utf-8").rstrip("=")
    return f"{TOKEN_PREFIX}{payload}"


def decrypt_token(token: str) -> str:
    if token is None:
        raise ValueError("token is required")
    raw = str(token)
    if raw.startswith(TOKEN_PREFIX):
        raw = raw[len(TOKEN_PREFIX):]
    padded = raw + "=" * (-len(raw) % 4)
    try:
        blob = base64.urlsafe_b64decode(padded.encode("utf-8"))
    except Exception as exc:
        raise ValueError("Invalid token encoding") from exc
    if len(blob) < 13:
        raise ValueError("Invalid token payload")
    nonce = blob[:12]
    ciphertext = blob[12:]
    aesgcm = AESGCM(_derive_key())
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return plaintext.decode("utf-8")
