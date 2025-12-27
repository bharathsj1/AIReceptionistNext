import base64
import json
import logging
import time
from collections import OrderedDict, deque
from datetime import datetime, timedelta
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, Tuple

import azure.functions as func
import httpx
import requests
from bs4 import BeautifulSoup

from function_app import app
from shared.config import get_google_oauth_settings, get_required_setting, get_setting
from shared.db import SessionLocal, User, GoogleToken
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)

MAX_LIST_RESULTS = 50
DEFAULT_LIST_RESULTS = 20
DEFAULT_LABELS = ["INBOX"]


def _int_setting(name: str, default: int) -> int:
    raw = get_setting(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


EMAIL_BODY_MAX_CHARS = _int_setting("EMAIL_BODY_MAX_CHARS", 8000)
AI_CACHE_TTL_SECONDS = _int_setting("EMAIL_AI_CACHE_TTL_SECONDS", 900)
AI_CACHE_MAX_ITEMS = _int_setting("EMAIL_AI_CACHE_MAX_ITEMS", 500)
AI_RATE_LIMIT_WINDOW_SECONDS = _int_setting("EMAIL_AI_RATE_LIMIT_WINDOW_SECONDS", 60)
AI_RATE_LIMIT_MAX = _int_setting("EMAIL_AI_RATE_LIMIT_MAX", 25)
EMAIL_THREAD_CONTEXT_MAX = _int_setting("EMAIL_THREAD_CONTEXT_MAX", 3)

EMAIL_TAGS = [
    "Sales Lead",
    "Support",
    "Invoice",
    "Internal",
    "Updates",
    "Marketing",
    "Spam/Low Priority",
]
EMAIL_SENTIMENTS = ["Angry", "Neutral", "Happy", "Concerned"]
EMAIL_PRIORITY_LABELS = ["Urgent", "Important", "Normal", "Low"]
EMAIL_VIP_SENDERS = [
    sender.strip().lower()
    for sender in (get_setting("EMAIL_VIP_SENDERS", "") or "").split(",")
    if sender.strip()
]


class LRUCache:
    def __init__(self, max_items: int, ttl_seconds: int) -> None:
        self.max_items = max_items
        self.ttl_seconds = ttl_seconds
        self._data: OrderedDict[str, tuple[dict, float]] = OrderedDict()

    def get(self, key: str) -> Optional[dict]:
        if key not in self._data:
            return None
        value, timestamp = self._data.get(key) or (None, None)
        if timestamp is None:
            return None
        if self.ttl_seconds and (time.time() - timestamp) > self.ttl_seconds:
            self._data.pop(key, None)
            return None
        self._data.move_to_end(key)
        return value

    def set(self, key: str, value: dict) -> None:
        self._data[key] = (value, time.time())
        self._data.move_to_end(key)
        while len(self._data) > self.max_items:
            self._data.popitem(last=False)


class SimpleRateLimiter:
    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._buckets: dict[str, deque] = {}

    def allow(self, key: str) -> tuple[bool, int]:
        now = time.time()
        window_start = now - self.window_seconds
        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = deque()
            self._buckets[key] = bucket
        while bucket and bucket[0] < window_start:
            bucket.popleft()
        if len(bucket) >= self.max_requests:
            retry_after = int(self.window_seconds - (now - bucket[0]))
            return False, max(retry_after, 1)
        bucket.append(now)
        return True, 0


AI_RESPONSE_CACHE = LRUCache(AI_CACHE_MAX_ITEMS, AI_CACHE_TTL_SECONDS)
AI_RATE_LIMITER = SimpleRateLimiter(AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_SECONDS)


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


def _get_user(db: SessionLocal, email: Optional[str], user_id: Optional[str]) -> Optional[User]:
    if email:
        return db.query(User).filter_by(email=email).one_or_none()
    if user_id:
        try:
            return db.query(User).filter_by(id=int(user_id)).one_or_none()
        except ValueError:
            return None
    return None


def _get_google_token(db: SessionLocal, user: User) -> Optional[GoogleToken]:
    return (
        db.query(GoogleToken)
        .filter_by(user_id=user.id)
        .order_by(GoogleToken.created_at.desc())
        .first()
    )


def _ensure_access_token(db: SessionLocal, token: GoogleToken) -> Tuple[Optional[str], Optional[str]]:
    access_token = token.access_token
    now = datetime.utcnow()
    if token.expires_at and token.expires_at <= now and token.refresh_token:
        refreshed, refresh_error = _refresh_google_token(token.refresh_token)
        if refresh_error or not refreshed:
            return None, refresh_error or "Token refresh failed"
        access_token = refreshed.get("access_token") or access_token
        token.access_token = access_token
        token.expires_at = (
            datetime.utcnow() + timedelta(seconds=int(refreshed.get("expires_in")))
            if refreshed.get("expires_in")
            else None
        )
        db.commit()
    return access_token, None


def _get_client_ip(req: func.HttpRequest) -> str:
    forwarded = req.headers.get("x-forwarded-for") or req.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return (
        req.headers.get("x-client-ip")
        or req.headers.get("X-Client-IP")
        or req.headers.get("x-real-ip")
        or req.headers.get("X-Real-IP")
        or "unknown"
    )


def _rate_limit_key(req: func.HttpRequest, user: User) -> str:
    return f"{user.id}:{_get_client_ip(req)}"


def _check_ai_rate_limit(req: func.HttpRequest, user: User) -> tuple[bool, int]:
    return AI_RATE_LIMITER.allow(_rate_limit_key(req, user))


def _trim_text(text: Optional[str], max_chars: int) -> str:
    trimmed = (text or "").strip()
    if len(trimmed) <= max_chars:
        return trimmed
    return trimmed[:max_chars].rsplit(" ", 1)[0].rstrip() + "..."


PRIORITY_KEYWORDS = {
    "urgent": 25,
    "asap": 20,
    "refund": 20,
    "chargeback": 25,
    "past due": 18,
    "overdue": 18,
    "late payment": 16,
    "invoice": 10,
    "payment": 8,
    "cancel": 15,
    "termination": 18,
    "downtime": 20,
    "outage": 22,
    "escalate": 20,
    "complaint": 15,
    "legal": 25,
    "breach": 25,
}
TIME_SENSITIVE_KEYWORDS = ["today", "tomorrow", "eod", "end of day", "deadline", "by eow"]


def _priority_keyword_boost(text: str) -> int:
    lowered = (text or "").lower()
    score = 0
    for keyword, points in PRIORITY_KEYWORDS.items():
        if keyword in lowered:
            score += points
    if any(keyword in lowered for keyword in TIME_SENSITIVE_KEYWORDS):
        score += 10
    return score


def _vip_sender_boost(sender: str) -> int:
    lowered = (sender or "").lower()
    if not EMAIL_VIP_SENDERS or not lowered:
        return 0
    for vip in EMAIL_VIP_SENDERS:
        if vip and (vip in lowered):
            return 15
    return 0


def _priority_label(score: int) -> str:
    if score >= 85:
        return "Urgent"
    if score >= 70:
        return "Important"
    if score >= 40:
        return "Normal"
    return "Low"


def _gmail_list_messages(
    access_token: str,
    max_results: int,
    label_ids: list[str],
    query: Optional[str],
    page_token: Optional[str],
) -> Tuple[Optional[dict], Optional[str]]:
    params: dict = {"maxResults": max_results, "labelIds": label_ids or DEFAULT_LABELS}
    if query:
        params["q"] = query
    if page_token:
        params["pageToken"] = page_token
    try:
        resp = requests.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
            params=params,
        )
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _gmail_get_message(access_token: str, message_id: str, format_value: str) -> Tuple[Optional[dict], Optional[str]]:
    params: dict = {"format": format_value}
    if format_value == "metadata":
        params["metadataHeaders"] = [
            "From",
            "To",
            "Cc",
            "Bcc",
            "Subject",
            "Date",
            "Message-ID",
            "In-Reply-To",
            "References",
        ]
    try:
        resp = requests.get(
            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
            params=params,
        )
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _gmail_get_thread(access_token: str, thread_id: str) -> Tuple[Optional[dict], Optional[str]]:
    params: dict = {
        "format": "metadata",
        "metadataHeaders": [
            "From",
            "To",
            "Cc",
            "Bcc",
            "Subject",
            "Date",
            "Message-ID",
            "In-Reply-To",
            "References",
        ],
    }
    try:
        resp = requests.get(
            f"https://gmail.googleapis.com/gmail/v1/users/me/threads/{thread_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
            params=params,
        )
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _header_map(payload: dict) -> dict:
    headers = payload.get("headers", []) if isinstance(payload, dict) else []
    mapped = {}
    for header in headers:
        name = str(header.get("name", "")).lower()
        value = header.get("value")
        if name and value is not None and name not in mapped:
            mapped[name] = value
    return mapped


def _decode_body(data: Optional[str]) -> str:
    if not data:
        return ""
    padded = data + "=" * (-len(data) % 4)
    try:
        return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")
    except Exception:  # pylint: disable=broad-except
        return ""


def _b64url_to_b64(data: Optional[str]) -> str:
    if not data:
        return ""
    padded = data + "=" * (-len(data) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded)
        return base64.b64encode(decoded).decode("utf-8")
    except Exception:  # pylint: disable=broad-except
        return ""


def _extract_text_from_payload(payload: dict) -> str:
    texts: dict[str, list[str]] = {"text/plain": [], "text/html": []}

    def walk(part: dict) -> None:
        mime_type = str(part.get("mimeType", "")).lower()
        body = part.get("body") or {}
        data = body.get("data")
        if data and mime_type in {"text/plain", "text/html"}:
            decoded = _decode_body(data).strip()
            if decoded:
                texts[mime_type].append(decoded)
        for child in part.get("parts") or []:
            if isinstance(child, dict):
                walk(child)

    if isinstance(payload, dict):
        walk(payload)

    plain = "\n\n".join(texts["text/plain"]).strip()
    if plain:
        return plain
    html = "\n\n".join(texts["text/html"]).strip()
    if html:
        soup = BeautifulSoup(html, "html.parser")
        return soup.get_text(separator="\n").strip()
    return ""


def _extract_html_from_payload(payload: dict) -> str:
    html_parts: list[str] = []

    def walk(part: dict) -> None:
        mime_type = str(part.get("mimeType", "")).lower()
        body = part.get("body") or {}
        data = body.get("data")
        if data and mime_type == "text/html":
            decoded = _decode_body(data).strip()
            if decoded:
                html_parts.append(decoded)
        for child in part.get("parts") or []:
            if isinstance(child, dict):
                walk(child)

    if isinstance(payload, dict):
        walk(payload)

    return "\n\n".join(html_parts).strip()


def _sanitize_html(raw_html: str) -> str:
    if not raw_html:
        return ""
    soup = BeautifulSoup(raw_html, "html.parser")
    for tag in soup(["script", "style", "iframe", "object", "embed", "link", "meta"]):
        tag.decompose()
    for tag in soup.find_all(True):
        attrs = dict(tag.attrs)
        for attr in list(attrs.keys()):
            if attr.lower().startswith("on"):
                del tag.attrs[attr]
                continue
            if attr.lower() in {"href", "src"}:
                value = tag.attrs.get(attr)
                if isinstance(value, list):
                    value = value[0] if value else ""
                if isinstance(value, str) and value.strip().lower().startswith("javascript:"):
                    del tag.attrs[attr]
    return str(soup)


def _build_thread_context(thread: Optional[dict]) -> str:
    if not isinstance(thread, dict):
        return ""
    messages = thread.get("messages") or []
    if not messages:
        return ""
    sorted_messages = sorted(messages, key=lambda msg: int(msg.get("internalDate") or 0))
    tail = sorted_messages[-EMAIL_THREAD_CONTEXT_MAX:]
    lines = []
    for msg in tail:
        payload = msg.get("payload") or {}
        headers = _header_map(payload)
        snippet = _trim_text(msg.get("snippet") or "", 400)
        lines.append(
            "\n".join(
                [
                    f"- From: {headers.get('from') or 'unknown'}",
                    f"  Date: {headers.get('date') or 'unknown'}",
                    f"  Subject: {headers.get('subject') or 'unknown'}",
                    f"  Snippet: {snippet or 'none'}",
                ]
            )
        )
    return "\n".join(lines).strip()


def _build_email_context(
    subject: Optional[str],
    sender: Optional[str],
    date: Optional[str],
    snippet: Optional[str],
    body: Optional[str],
    thread_context: Optional[str],
) -> str:
    trimmed_snippet = _trim_text(snippet, 1000)
    trimmed_body = _trim_text(body, 2000) if body else ""
    parts = [
        f"Subject: {subject or 'unknown'}",
        f"From: {sender or 'unknown'}",
        f"Date: {date or 'unknown'}",
        f"Snippet: {trimmed_snippet or 'none'}",
        f"Body: {trimmed_body or 'none'}",
    ]
    if thread_context:
        parts.append(f"Thread context:\n{thread_context}")
    return "\n".join(parts)


def _normalize_tags(tags: Optional[list]) -> list[str]:
    if not isinstance(tags, list):
        return []
    normalized: list[str] = []
    for tag in tags:
        if not tag:
            continue
        raw = str(tag).strip()
        if not raw:
            continue
        lowered = raw.lower()
        if lowered in {"spam", "low priority", "low"}:
            raw = "Spam/Low Priority"
        for allowed in EMAIL_TAGS:
            if lowered == allowed.lower():
                raw = allowed
        if raw in EMAIL_TAGS and raw not in normalized:
            normalized.append(raw)
    return normalized


def _normalize_sentiment(sentiment: Optional[str]) -> str:
    if not sentiment:
        return "Neutral"
    lowered = str(sentiment).strip().lower()
    for allowed in EMAIL_SENTIMENTS:
        if lowered == allowed.lower():
            return allowed
    return "Neutral"


def _normalize_priority_label(label: Optional[str], score: int) -> str:
    if label:
        lowered = str(label).strip().lower()
        for allowed in EMAIL_PRIORITY_LABELS:
            if lowered == allowed.lower():
                return allowed
    return _priority_label(score)


def _normalize_priority_score(score: Optional[float]) -> int:
    try:
        value = int(float(score or 0))
    except (TypeError, ValueError):
        value = 0
    return max(0, min(100, value))


def _apply_priority_boost(score: int, subject: str, sender: str, snippet: str, body: str) -> int:
    base_text = " ".join(filter(None, [subject, sender, snippet, body]))
    boost = _priority_keyword_boost(base_text) + _vip_sender_boost(sender)
    return max(0, min(100, score + boost))


def _parse_json_response(content: str) -> dict:
    if not content:
        raise RuntimeError("OpenAI returned empty response")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError("OpenAI returned non-JSON response") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("OpenAI returned invalid JSON payload")
    return parsed


def _call_openai_json(messages: list[dict], max_tokens: int = 450, temperature: float = 0.2) -> dict:
    api_key = get_required_setting("OPENAI_API_KEY")
    base_url = get_setting("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model = get_setting("OPENAI_EMAIL_MODEL") or get_setting("OPENAI_MODEL", "gpt-4.1-mini")
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    url = f"{base_url.rstrip('/')}/chat/completions"

    timeout = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=None)
    last_error: Optional[str] = None
    for attempt in range(3):
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(url, headers=headers, json=payload)
        except httpx.ReadTimeout as exc:
            last_error = "OpenAI API read timeout"
            logger.error("OpenAI request timed out: %s", exc)
            continue
        except httpx.RequestError as exc:
            last_error = f"OpenAI request failed: {exc}"
            logger.error("OpenAI request failed: %s", exc)
            continue

        if resp.status_code >= 300:
            last_error = f"OpenAI API error {resp.status_code}: {resp.text}"
            logger.error("OpenAI request failed: %s - %s", resp.status_code, resp.text)
            continue

        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        try:
            return _parse_json_response(content)
        except RuntimeError as exc:
            last_error = str(exc)
            logger.error("OpenAI JSON parse failed: %s", exc)
            continue

    raise RuntimeError(last_error or "OpenAI request failed")


def _collect_attachments(payload: dict) -> list[dict]:
    attachments: list[dict] = []

    def walk(part: dict) -> None:
        body = part.get("body") or {}
        attachment_id = body.get("attachmentId")
        mime_type = part.get("mimeType") or ""
        filename = part.get("filename") or ""
        headers = _header_map(part)
        content_id = headers.get("content-id")
        inline_data = body.get("data")
        if attachment_id or inline_data:
            attachments.append(
                {
                    "id": attachment_id,
                    "filename": filename,
                    "mimeType": mime_type,
                    "size": body.get("size"),
                    "contentId": content_id.strip("<>") if isinstance(content_id, str) else None,
                    "isInline": bool(content_id),
                    "data": _b64url_to_b64(inline_data) if inline_data and content_id else None,
                }
            )
        for child in part.get("parts") or []:
            if isinstance(child, dict):
                walk(child)

    if isinstance(payload, dict):
        walk(payload)

    return attachments


def _gmail_get_attachment(access_token: str, message_id: str, attachment_id: str) -> Tuple[Optional[dict], Optional[str]]:
    try:
        resp = requests.get(
            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}/attachments/{attachment_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _build_summary_prompt(
    subject: Optional[str],
    sender: Optional[str],
    date: Optional[str],
    snippet: str,
    body: str,
    thread_context: Optional[str] = None,
) -> str:
    trimmed_body = (body or "").strip()
    if len(trimmed_body) > EMAIL_BODY_MAX_CHARS:
        trimmed_body = trimmed_body[:EMAIL_BODY_MAX_CHARS].rsplit(" ", 1)[0].rstrip() + "..."
    trimmed_snippet = (snippet or "").strip()[:1000]
    thread_section = f"\nThread context:\n{thread_context.strip()}\n" if thread_context else ""
    return (
        "Summarize the email for a busy professional.\n\n"
        f"Subject: {subject or 'unknown'}\n"
        f"From: {sender or 'unknown'}\n"
        f"Date: {date or 'unknown'}\n"
        f"Snippet: {trimmed_snippet or 'none'}\n\n"
        f"Body:\n{trimmed_body or 'no body content'}\n\n"
        f"{thread_section}"
        "Return a concise summary (2-4 sentences). If there are action items, add a final sentence starting with "
        "\"Action items:\" followed by a comma-separated list. If none, end with \"Action items: none.\""
    )


def _build_classify_prompt(context: str) -> str:
    return (
        "Classify this email. Use only the allowed labels and return JSON only.\n"
        f"Tags: {', '.join(EMAIL_TAGS)}\n"
        f"Sentiment: {', '.join(EMAIL_SENTIMENTS)}\n"
        f"Priority labels: {', '.join(EMAIL_PRIORITY_LABELS)}\n"
        "Return JSON with keys: tags (array), priorityScore (0-100), priorityLabel, sentiment.\n\n"
        f"{context}"
    )


def _build_actions_prompt(context: str) -> str:
    return (
        "Extract action items from the email. Return JSON only.\n"
        "Return JSON with key actionItems as an array of objects with keys: title, dueDate (optional), owner (optional), confidence (0-1).\n"
        "If there are no action items, return actionItems as an empty array.\n\n"
        f"{context}"
    )


def _build_reply_variants_prompt(context: str, tone: str, intent: str, draft: str) -> str:
    intent_line = "Draft a follow-up email that politely checks in without assuming a response." if intent == "follow_up" else "Draft a reply to the email."
    trimmed_draft = _trim_text(draft, 1200) if draft else ""
    draft_section = f"Current draft (optional):\n{trimmed_draft}\n\n" if trimmed_draft else ""
    return (
        f"{intent_line}\n"
        f"Tone: {tone}\n"
        "Return JSON only with key variants as an array of exactly 3 objects.\n"
        "Each variant must include keys: tone, text. text should be the email body only.\n\n"
        f"{draft_section}{context}"
    )


def _get_thread_context(access_token: Optional[str], thread_id: Optional[str]) -> str:
    if not access_token or not thread_id:
        return ""
    thread, thread_error = _gmail_get_thread(access_token, thread_id)
    if thread_error or not thread:
        return ""
    return _build_thread_context(thread)


def _extract_request_context(body: dict) -> tuple[str, str, str, str, str, str]:
    headers = body.get("headers") if isinstance(body.get("headers"), dict) else {}
    subject = body.get("subject") or headers.get("subject") or ""
    sender = body.get("from") or headers.get("from") or ""
    date = body.get("date") or headers.get("date") or ""
    snippet = body.get("snippet") or ""
    body_text = (
        body.get("optional_body")
        or body.get("optionalBodyIfAlreadyAvailable")
        or body.get("optionalBody")
        or ""
    )
    thread_id = body.get("thread_id") or body.get("threadId") or ""
    return subject, sender, date, snippet, body_text, thread_id


def _summarize_email(
    subject: Optional[str],
    sender: Optional[str],
    date: Optional[str],
    snippet: str,
    body: str,
    thread_context: Optional[str] = None,
) -> str:
    api_key = get_required_setting("OPENAI_API_KEY")
    base_url = get_setting("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model = get_setting("OPENAI_EMAIL_MODEL") or get_setting("OPENAI_MODEL", "gpt-4.1-mini")
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You summarize emails clearly and concisely. Do not include any sensitive data beyond what is in the email.",
            },
            {
                "role": "user",
                "content": _build_summary_prompt(subject, sender, date, snippet, body, thread_context),
            },
        ],
        "temperature": 0.3,
        "max_tokens": 350,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    url = f"{base_url.rstrip('/')}/chat/completions"

    timeout = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=None)
    last_error: Optional[str] = None
    for attempt in range(3):
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(url, headers=headers, json=payload)
        except httpx.ReadTimeout as exc:
            last_error = "OpenAI API read timeout"
            logger.error("OpenAI email summary timed out: %s", exc)
            continue
        except httpx.RequestError as exc:
            last_error = f"OpenAI request failed: {exc}"
            logger.error("OpenAI email summary request failed: %s", exc)
            continue

        if resp.status_code >= 300:
            last_error = f"OpenAI API error {resp.status_code}: {resp.text}"
            logger.error("OpenAI email summary failed: %s - %s", resp.status_code, resp.text)
            continue

        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        if not content:
            last_error = "OpenAI returned empty summary"
            continue
        return content

    raise RuntimeError(last_error or "OpenAI summary failed")


def _gmail_list_labels(access_token: str) -> Tuple[Optional[dict], Optional[str]]:
    try:
        resp = requests.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/labels",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if resp.status_code != 200:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _gmail_batch_modify(
    access_token: str,
    message_ids: list[str],
    add_label_ids: Optional[list[str]] = None,
    remove_label_ids: Optional[list[str]] = None,
) -> Optional[str]:
    payload: dict = {"ids": message_ids}
    if add_label_ids:
        payload["addLabelIds"] = add_label_ids
    if remove_label_ids:
        payload["removeLabelIds"] = remove_label_ids
    try:
        resp = requests.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
            json=payload,
        )
        if resp.status_code not in {200, 204}:
            return resp.text
        return None
    except Exception as exc:  # pylint: disable=broad-except
        return str(exc)


def _gmail_trash_message(access_token: str, message_id: str) -> Optional[str]:
    try:
        resp = requests.post(
            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}/trash",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if resp.status_code != 200:
            return resp.text
        return None
    except Exception as exc:  # pylint: disable=broad-except
        return str(exc)


def _gmail_delete_message(access_token: str, message_id: str) -> Optional[str]:
    try:
        resp = requests.delete(
            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if resp.status_code not in {200, 204}:
            return resp.text
        return None
    except Exception as exc:  # pylint: disable=broad-except
        return str(exc)


def _build_rfc2822_message(
    sender: Optional[str],
    to_value: str,
    subject: str,
    body: str,
    cc_value: Optional[str] = None,
    bcc_value: Optional[str] = None,
    in_reply_to: Optional[str] = None,
    references: Optional[str] = None,
) -> str:
    headers = []
    if sender:
        headers.append(f"From: {sender}")
    headers.append(f"To: {to_value}")
    if cc_value:
        headers.append(f"Cc: {cc_value}")
    if bcc_value:
        headers.append(f"Bcc: {bcc_value}")
    headers.append(f"Subject: {subject}")
    if in_reply_to:
        headers.append(f"In-Reply-To: {in_reply_to}")
    if references:
        headers.append(f"References: {references}")
    headers.append("MIME-Version: 1.0")
    headers.append("Content-Type: text/plain; charset=utf-8")
    raw = "\r\n".join(headers) + "\r\n\r\n" + body
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")


def _build_raw_message(
    sender: Optional[str],
    to_value: str,
    subject: str,
    body: str,
    cc_value: Optional[str] = None,
    bcc_value: Optional[str] = None,
    in_reply_to: Optional[str] = None,
    references: Optional[str] = None,
    attachments: Optional[list[dict]] = None,
) -> str:
    attachments = attachments or []
    if attachments:
        msg = MIMEMultipart()
        msg.attach(MIMEText(body or "", "plain", "utf-8"))
        for attachment in attachments:
            data = attachment.get("data")
            if not data:
                continue
            mime_type = attachment.get("mime_type") or "application/octet-stream"
            filename = attachment.get("filename") or "attachment"
            if "/" in mime_type:
                main_type, sub_type = mime_type.split("/", 1)
            else:
                main_type, sub_type = "application", "octet-stream"
            try:
                decoded = base64.b64decode(data)
            except Exception:  # pylint: disable=broad-except
                continue
            part = MIMEBase(main_type, sub_type)
            part.set_payload(decoded)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
            msg.attach(part)
    else:
        msg = MIMEText(body or "", "plain", "utf-8")

    if sender:
        msg["From"] = sender
    msg["To"] = to_value
    if cc_value:
        msg["Cc"] = cc_value
    if bcc_value:
        msg["Bcc"] = bcc_value
    if subject:
        msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references

    raw_bytes = msg.as_bytes()
    return base64.urlsafe_b64encode(raw_bytes).decode("utf-8")


def _normalize_address(value: Optional[object]) -> str:
    if not value:
        return ""
    if isinstance(value, list):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return str(value).strip()


def _normalize_ids(value: Optional[object]) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()]


def _build_reply_prompt(
    subject: Optional[str],
    sender: Optional[str],
    date: Optional[str],
    body: str,
    draft: Optional[str] = None,
) -> str:
    trimmed_body = (body or "").strip()
    if len(trimmed_body) > EMAIL_BODY_MAX_CHARS:
        trimmed_body = trimmed_body[:EMAIL_BODY_MAX_CHARS].rsplit(" ", 1)[0].rstrip() + "..."
    trimmed_draft = (draft or "").strip()
    if len(trimmed_draft) > 2000:
        trimmed_draft = trimmed_draft[:2000].rsplit(" ", 1)[0].rstrip() + "..."
    return (
        "Draft a professional, concise reply to the email below.\n"
        "Keep it polite, helpful, and action-oriented. Do not include a subject line.\n"
        "If a draft reply is provided, refine and improve it without losing key details.\n\n"
        "If there is a clear question, answer it. If there is a request, acknowledge and respond.\n\n"
        f"From: {sender or 'unknown'}\n"
        f"Date: {date or 'unknown'}\n"
        f"Subject: {subject or 'unknown'}\n\n"
        f"Current draft reply (optional):\n{trimmed_draft or 'none'}\n\n"
        f"Email body:\n{trimmed_body or 'no body content'}\n\n"
        "Return only the reply body text."
    )


def _generate_reply(
    subject: Optional[str],
    sender: Optional[str],
    date: Optional[str],
    body: str,
    draft: Optional[str] = None,
) -> str:
    api_key = get_required_setting("OPENAI_API_KEY")
    base_url = get_setting("OPENAI_BASE_URL", "https://api.openai.com/v1")
    model = get_setting("OPENAI_EMAIL_MODEL") or get_setting("OPENAI_MODEL", "gpt-4.1-mini")
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You write concise, professional email replies.",
            },
            {"role": "user", "content": _build_reply_prompt(subject, sender, date, body, draft)},
        ],
        "temperature": 0.4,
        "max_tokens": 400,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    url = f"{base_url.rstrip('/')}/chat/completions"

    timeout = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=None)
    last_error: Optional[str] = None
    for attempt in range(3):
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(url, headers=headers, json=payload)
        except httpx.ReadTimeout as exc:
            last_error = "OpenAI API read timeout"
            logger.error("OpenAI reply draft timed out: %s", exc)
            continue
        except httpx.RequestError as exc:
            last_error = f"OpenAI request failed: {exc}"
            logger.error("OpenAI reply draft request failed: %s", exc)
            continue

        if resp.status_code >= 300:
            last_error = f"OpenAI API error {resp.status_code}: {resp.text}"
            logger.error("OpenAI reply draft failed: %s - %s", resp.status_code, resp.text)
            continue

        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        if not content:
            last_error = "OpenAI returned empty reply"
            continue
        return content

    raise RuntimeError(last_error or "OpenAI reply draft failed")


@app.function_name(name="EmailMessages")
@app.route(route="email/messages", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_messages(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id") or req.params.get("userId")
    max_results_param = req.params.get("max_results") or req.params.get("maxResults")
    query = req.params.get("q")
    page_token = req.params.get("page_token") or req.params.get("pageToken")
    labels_raw = req.params.get("label_ids") or req.params.get("labelIds")
    label_ids = (
        [label.strip() for label in labels_raw.split(",") if label.strip()]
        if labels_raw
        else DEFAULT_LABELS
    )
    if not label_ids:
        label_ids = DEFAULT_LABELS

    max_results = DEFAULT_LIST_RESULTS
    if max_results_param:
        try:
            max_results = min(int(max_results_param), MAX_LIST_RESULTS)
        except ValueError:
            max_results = DEFAULT_LIST_RESULTS

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

        allowed, retry_after = _check_ai_rate_limit(req, user)
        if not allowed:
            return func.HttpResponse(
                json.dumps({"error": "Rate limit exceeded", "retry_after": retry_after}),
                status_code=429,
                mimetype="application/json",
                headers=cors,
            )

        token = _get_google_token(db, user)
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token, token_error = _ensure_access_token(db, token)
        if token_error or not access_token:
            return func.HttpResponse(
                json.dumps({"error": "Unable to refresh token", "details": token_error}),
                status_code=401,
                mimetype="application/json",
                headers=cors,
            )

        message_list, list_error = _gmail_list_messages(access_token, max_results, label_ids, query, page_token)
        if list_error or message_list is None:
            return func.HttpResponse(
                json.dumps({"error": "Failed to fetch messages", "details": list_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        messages = []
        for entry in message_list.get("messages", []) or []:
            message_id = entry.get("id")
            if not message_id:
                continue
            details, detail_error = _gmail_get_message(access_token, message_id, "metadata")
            if detail_error or not details:
                logger.warning("Failed to fetch message metadata for %s: %s", message_id, detail_error)
                continue
            payload = details.get("payload") or {}
            headers = _header_map(payload)
            messages.append(
                {
                    "id": details.get("id"),
                    "threadId": details.get("threadId"),
                    "labelIds": details.get("labelIds"),
                    "snippet": details.get("snippet"),
                    "from": headers.get("from"),
                    "to": headers.get("to"),
                    "subject": headers.get("subject"),
                    "date": headers.get("date"),
                    "cc": headers.get("cc"),
                    "bcc": headers.get("bcc"),
                    "messageIdHeader": headers.get("message-id"),
                    "inReplyTo": headers.get("in-reply-to"),
                    "references": headers.get("references"),
                    "internalDate": details.get("internalDate"),
                    "sizeEstimate": details.get("sizeEstimate"),
                }
            )

        return func.HttpResponse(
            json.dumps(
                {
                    "messages": messages,
                    "resultSizeEstimate": message_list.get("resultSizeEstimate"),
                    "nextPageToken": message_list.get("nextPageToken"),
                    "user": user.email,
                    "account_email": token.google_account_email,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email list failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email list failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="EmailSummary")
@app.route(route="email/summary", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_summary(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    body = body or {}

    email = body.get("email")
    user_id = body.get("user_id") or body.get("userId")
    message_id = body.get("message_id") or body.get("messageId")

    if not message_id or not (email or user_id):
        return func.HttpResponse(
            json.dumps({"error": "message_id and user identifier are required"}),
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

        token = _get_google_token(db, user)
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token, token_error = _ensure_access_token(db, token)
        if token_error or not access_token:
            return func.HttpResponse(
                json.dumps({"error": "Unable to refresh token", "details": token_error}),
                status_code=401,
                mimetype="application/json",
                headers=cors,
            )

        cache_key = f"summary:{message_id}"
        cached = AI_RESPONSE_CACHE.get(cache_key)
        if cached:
            payload = {
                "message_id": message_id,
                **cached,
                "account_email": token.google_account_email,
                "user": user.email,
                "cached": True,
            }
            return func.HttpResponse(
                json.dumps(payload),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

        details, detail_error = _gmail_get_message(access_token, message_id, "full")
        if detail_error or not details:
            return func.HttpResponse(
                json.dumps({"error": "Failed to fetch message", "details": detail_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        payload = details.get("payload") or {}
        headers = _header_map(payload)
        snippet = details.get("snippet") or ""
        body_text = _extract_text_from_payload(payload)
        if not body_text:
            body_text = snippet

        thread_context = _get_thread_context(access_token, details.get("threadId"))
        summary = _summarize_email(
            headers.get("subject"),
            headers.get("from"),
            headers.get("date"),
            snippet,
            body_text,
            thread_context,
        )

        cache_payload = {
            "threadId": details.get("threadId"),
            "from": headers.get("from"),
            "to": headers.get("to"),
            "subject": headers.get("subject"),
            "date": headers.get("date"),
            "summary": summary,
        }
        AI_RESPONSE_CACHE.set(cache_key, cache_payload)

        return func.HttpResponse(
            json.dumps(
                {
                    "message_id": details.get("id"),
                    **cache_payload,
                    "account_email": token.google_account_email,
                    "user": user.email,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email summary failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email summary failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="EmailClassify")
@app.route(route="email/classify", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_classify(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    body = body or {}

    email = body.get("email")
    user_id = body.get("user_id") or body.get("userId")
    message_id = body.get("message_id") or body.get("messageId")

    if not message_id or not (email or user_id):
        return func.HttpResponse(
            json.dumps({"error": "message_id and user identifier are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    subject, sender, date, snippet, body_text, thread_id = _extract_request_context(body)
    cache_key = f"classify:{message_id}"

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

        allowed, retry_after = _check_ai_rate_limit(req, user)
        if not allowed:
            return func.HttpResponse(
                json.dumps({"error": "Rate limit exceeded", "retry_after": retry_after}),
                status_code=429,
                mimetype="application/json",
                headers=cors,
            )

        cached = AI_RESPONSE_CACHE.get(cache_key)
        if cached:
            payload = {
                "message_id": message_id,
                **cached,
                "user": user.email,
                "cached": True,
            }
            return func.HttpResponse(
                json.dumps(payload),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

        access_token = None
        token = _get_google_token(db, user)
        if token:
            access_token, _ = _ensure_access_token(db, token)
        thread_context = _get_thread_context(access_token, thread_id)
        context = _build_email_context(subject, sender, date, snippet, body_text, thread_context)

        messages = [
            {
                "role": "system",
                "content": "You are an email triage assistant. Return JSON only.",
            },
            {"role": "user", "content": _build_classify_prompt(context)},
        ]
        result = _call_openai_json(messages, max_tokens=220, temperature=0.2)

        tags = _normalize_tags(result.get("tags"))
        if not tags:
            tags = ["Updates"]
        base_score = _normalize_priority_score(result.get("priorityScore"))
        boosted_score = _apply_priority_boost(base_score, subject, sender, snippet, body_text)
        priority_label = _normalize_priority_label(result.get("priorityLabel"), boosted_score)
        sentiment = _normalize_sentiment(result.get("sentiment"))

        cache_payload = {
            "threadId": thread_id or None,
            "tags": tags,
            "priorityScore": boosted_score,
            "priorityLabel": priority_label,
            "sentiment": sentiment,
        }
        AI_RESPONSE_CACHE.set(cache_key, cache_payload)

        return func.HttpResponse(
            json.dumps(
                {
                    "message_id": message_id,
                    **cache_payload,
                    "account_email": token.google_account_email if token else None,
                    "user": user.email,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email classify failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email classify failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="EmailActions")
@app.route(route="email/actions", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_actions(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    body = body or {}

    email = body.get("email")
    user_id = body.get("user_id") or body.get("userId")
    message_id = body.get("message_id") or body.get("messageId")

    if not message_id or not (email or user_id):
        return func.HttpResponse(
            json.dumps({"error": "message_id and user identifier are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    subject, sender, date, snippet, body_text, thread_id = _extract_request_context(body)
    cache_key = f"actions:{message_id}"

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

        allowed, retry_after = _check_ai_rate_limit(req, user)
        if not allowed:
            return func.HttpResponse(
                json.dumps({"error": "Rate limit exceeded", "retry_after": retry_after}),
                status_code=429,
                mimetype="application/json",
                headers=cors,
            )

        cached = AI_RESPONSE_CACHE.get(cache_key)
        if cached:
            payload = {
                "message_id": message_id,
                **cached,
                "user": user.email,
                "cached": True,
            }
            return func.HttpResponse(
                json.dumps(payload),
                status_code=200,
                mimetype="application/json",
                headers=cors,
            )

        access_token = None
        token = _get_google_token(db, user)
        if token:
            access_token, _ = _ensure_access_token(db, token)
        thread_context = _get_thread_context(access_token, thread_id)
        context = _build_email_context(subject, sender, date, snippet, body_text, thread_context)

        messages = [
            {
                "role": "system",
                "content": "You extract action items from emails. Return JSON only.",
            },
            {"role": "user", "content": _build_actions_prompt(context)},
        ]
        result = _call_openai_json(messages, max_tokens=320, temperature=0.2)
        items = result.get("actionItems") if isinstance(result, dict) else []

        normalized_items = []
        if isinstance(items, list):
            for item in items:
                if not isinstance(item, dict):
                    continue
                title = str(item.get("title") or "").strip()
                if not title:
                    continue
                due_date = item.get("dueDate") or item.get("due_date") or None
                owner = item.get("owner") or item.get("assignee") or None
                try:
                    confidence = float(item.get("confidence") or 0.5)
                except (TypeError, ValueError):
                    confidence = 0.5
                confidence = max(0.0, min(1.0, confidence))
                normalized_items.append(
                    {
                        "title": title,
                        "dueDate": str(due_date).strip() if due_date else None,
                        "owner": str(owner).strip() if owner else None,
                        "confidence": confidence,
                    }
                )

        cache_payload = {"threadId": thread_id or None, "actionItems": normalized_items}
        AI_RESPONSE_CACHE.set(cache_key, cache_payload)

        return func.HttpResponse(
            json.dumps(
                {
                    "message_id": message_id,
                    **cache_payload,
                    "account_email": token.google_account_email if token else None,
                    "user": user.email,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email action extraction failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email action extraction failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="EmailReplyVariants")
@app.route(route="email/reply-variants", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_reply_variants(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    body = body or {}

    email = body.get("email")
    user_id = body.get("user_id") or body.get("userId")
    message_id = body.get("message_id") or body.get("messageId")

    if not message_id or not (email or user_id):
        return func.HttpResponse(
            json.dumps({"error": "message_id and user identifier are required"}),
            status_code=400,
            mimetype="application/json",
            headers=cors,
        )

    subject, sender, date, snippet, body_text, thread_id = _extract_request_context(body)
    tone = str(body.get("tone") or "Professional").strip() or "Professional"
    intent = str(body.get("intent") or "reply").strip().lower()
    if intent not in {"reply", "follow_up"}:
        intent = "reply"
    current_draft = body.get("current_draft") or body.get("currentDraft") or ""
    cache_key = f"reply-variants:{message_id}:{tone}:{intent}"
    allow_cache = not bool(current_draft)

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

        allowed, retry_after = _check_ai_rate_limit(req, user)
        if not allowed:
            return func.HttpResponse(
                json.dumps({"error": "Rate limit exceeded", "retry_after": retry_after}),
                status_code=429,
                mimetype="application/json",
                headers=cors,
            )

        if allow_cache:
            cached = AI_RESPONSE_CACHE.get(cache_key)
            if cached:
                payload = {
                    "message_id": message_id,
                    **cached,
                    "user": user.email,
                    "cached": True,
                }
                return func.HttpResponse(
                    json.dumps(payload),
                    status_code=200,
                    mimetype="application/json",
                    headers=cors,
                )

        access_token = None
        token = _get_google_token(db, user)
        if token:
            access_token, _ = _ensure_access_token(db, token)
        thread_context = _get_thread_context(access_token, thread_id)
        context = _build_email_context(subject, sender, date, snippet, body_text, thread_context)

        messages = [
            {
                "role": "system",
                "content": "You draft concise, helpful email replies. Return JSON only.",
            },
            {"role": "user", "content": _build_reply_variants_prompt(context, tone, intent, current_draft)},
        ]
        result = _call_openai_json(messages, max_tokens=500, temperature=0.4)
        variants = result.get("variants") if isinstance(result, dict) else []

        normalized_variants = []
        if isinstance(variants, list):
            for item in variants:
                if not isinstance(item, dict):
                    continue
                text = str(item.get("text") or "").strip()
                if not text:
                    continue
                normalized_variants.append(
                    {
                        "tone": str(item.get("tone") or tone).strip() or tone,
                        "text": text,
                    }
                )

        if not normalized_variants:
            raise RuntimeError("OpenAI returned empty reply variants")

        cache_payload = {"threadId": thread_id or None, "tone": tone, "intent": intent, "variants": normalized_variants}
        if allow_cache:
            AI_RESPONSE_CACHE.set(cache_key, cache_payload)

        return func.HttpResponse(
            json.dumps(
                {
                    "message_id": message_id,
                    **cache_payload,
                    "account_email": token.google_account_email if token else None,
                    "user": user.email,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email reply variants failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email reply variants failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="EmailMessage")
@app.route(route="email/message", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_message(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id") or req.params.get("userId")
    message_id = req.params.get("message_id") or req.params.get("messageId")

    if not message_id or not (email or user_id):
        return func.HttpResponse(
            json.dumps({"error": "message_id and user identifier are required"}),
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

        token = _get_google_token(db, user)
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token, token_error = _ensure_access_token(db, token)
        if token_error or not access_token:
            return func.HttpResponse(
                json.dumps({"error": "Unable to refresh token", "details": token_error}),
                status_code=401,
                mimetype="application/json",
                headers=cors,
            )

        details, detail_error = _gmail_get_message(access_token, message_id, "full")
        if detail_error or not details:
            return func.HttpResponse(
                json.dumps({"error": "Failed to fetch message", "details": detail_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        payload = details.get("payload") or {}
        headers = _header_map(payload)
        snippet = details.get("snippet") or ""
        body_text = _extract_text_from_payload(payload)
        if not body_text:
            body_text = snippet
        raw_html = _extract_html_from_payload(payload)
        sanitized_html = _sanitize_html(raw_html) if raw_html else ""
        attachments = _collect_attachments(payload)

        return func.HttpResponse(
            json.dumps(
                {
                    "id": details.get("id"),
                    "threadId": details.get("threadId"),
                    "labelIds": details.get("labelIds"),
                    "snippet": snippet,
                    "from": headers.get("from"),
                    "to": headers.get("to"),
                    "cc": headers.get("cc"),
                    "bcc": headers.get("bcc"),
                    "subject": headers.get("subject"),
                    "date": headers.get("date"),
                    "internalDate": details.get("internalDate"),
                    "body": body_text,
                    "html": sanitized_html,
                    "attachments": attachments,
                    "account_email": token.google_account_email,
                    "user": user.email,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email message fetch failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email message fetch failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="EmailAttachment")
@app.route(route="email/attachment", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_attachment(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id") or req.params.get("userId")
    message_id = req.params.get("message_id") or req.params.get("messageId")
    attachment_id = req.params.get("attachment_id") or req.params.get("attachmentId")

    if not message_id or not attachment_id or not (email or user_id):
        return func.HttpResponse(
            json.dumps({"error": "message_id, attachment_id, and user identifier are required"}),
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

        token = _get_google_token(db, user)
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token, token_error = _ensure_access_token(db, token)
        if token_error or not access_token:
            return func.HttpResponse(
                json.dumps({"error": "Unable to refresh token", "details": token_error}),
                status_code=401,
                mimetype="application/json",
                headers=cors,
            )

        attachment, attach_error = _gmail_get_attachment(access_token, message_id, attachment_id)
        if attach_error or not attachment:
            return func.HttpResponse(
                json.dumps({"error": "Failed to fetch attachment", "details": attach_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        data = _b64url_to_b64(attachment.get("data")) if attachment.get("data") else ""

        return func.HttpResponse(
            json.dumps(
                {
                    "attachment_id": attachment_id,
                    "message_id": message_id,
                    "data": data,
                    "size": attachment.get("size"),
                    "account_email": token.google_account_email,
                    "user": user.email,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email attachment fetch failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email attachment fetch failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="EmailReplyDraft")
@app.route(route="email/reply-draft", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_reply_draft(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    body = body or {}

    email = body.get("email")
    user_id = body.get("user_id") or body.get("userId")
    message_id = body.get("message_id") or body.get("messageId")
    draft_reply = body.get("draft") or body.get("current_draft") or body.get("currentDraft")

    if not message_id or not (email or user_id):
        return func.HttpResponse(
            json.dumps({"error": "message_id and user identifier are required"}),
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

        token = _get_google_token(db, user)
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token, token_error = _ensure_access_token(db, token)
        if token_error or not access_token:
            return func.HttpResponse(
                json.dumps({"error": "Unable to refresh token", "details": token_error}),
                status_code=401,
                mimetype="application/json",
                headers=cors,
            )

        details, detail_error = _gmail_get_message(access_token, message_id, "full")
        if detail_error or not details:
            return func.HttpResponse(
                json.dumps({"error": "Failed to fetch message", "details": detail_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        payload = details.get("payload") or {}
        headers = _header_map(payload)
        body_text = _extract_text_from_payload(payload)
        if not body_text:
            body_text = details.get("snippet") or ""

        reply_text = _generate_reply(
            headers.get("subject"),
            headers.get("from"),
            headers.get("date"),
            body_text,
            draft_reply,
        )

        return func.HttpResponse(
            json.dumps(
                {
                    "message_id": details.get("id"),
                    "threadId": details.get("threadId"),
                    "reply": reply_text,
                    "account_email": token.google_account_email,
                    "user": user.email,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email reply draft failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email reply draft failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="EmailLabels")
@app.route(route="email/labels", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_labels(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["GET", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    email = req.params.get("email")
    user_id = req.params.get("user_id") or req.params.get("userId")

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

        token = _get_google_token(db, user)
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token, token_error = _ensure_access_token(db, token)
        if token_error or not access_token:
            return func.HttpResponse(
                json.dumps({"error": "Unable to refresh token", "details": token_error}),
                status_code=401,
                mimetype="application/json",
                headers=cors,
            )

        labels, label_error = _gmail_list_labels(access_token)
        if label_error or labels is None:
            return func.HttpResponse(
                json.dumps({"error": "Failed to fetch labels", "details": label_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        return func.HttpResponse(
            json.dumps(
                {
                    "labels": labels.get("labels", []),
                    "user": user.email,
                    "account_email": token.google_account_email,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email labels failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email labels failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="EmailModify")
@app.route(route="email/modify", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_modify(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    body = body or {}

    email = body.get("email")
    user_id = body.get("user_id") or body.get("userId")
    message_ids = _normalize_ids(body.get("message_ids") or body.get("messageIds") or body.get("ids"))
    add_label_ids = _normalize_ids(body.get("add_label_ids") or body.get("addLabelIds"))
    remove_label_ids = _normalize_ids(body.get("remove_label_ids") or body.get("removeLabelIds"))

    if not message_ids or not (email or user_id):
        return func.HttpResponse(
            json.dumps({"error": "message_ids and user identifier are required"}),
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

        token = _get_google_token(db, user)
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token, token_error = _ensure_access_token(db, token)
        if token_error or not access_token:
            return func.HttpResponse(
                json.dumps({"error": "Unable to refresh token", "details": token_error}),
                status_code=401,
                mimetype="application/json",
                headers=cors,
            )

        modify_error = _gmail_batch_modify(access_token, message_ids, add_label_ids, remove_label_ids)
        if modify_error:
            return func.HttpResponse(
                json.dumps({"error": "Failed to modify messages", "details": modify_error}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        return func.HttpResponse(
            json.dumps({"updated": len(message_ids), "account_email": token.google_account_email, "user": user.email}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email modify failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email modify failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="EmailTrash")
@app.route(route="email/trash", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_trash(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    body = body or {}

    email = body.get("email")
    user_id = body.get("user_id") or body.get("userId")
    message_ids = _normalize_ids(body.get("message_ids") or body.get("messageIds") or body.get("ids"))

    if not message_ids or not (email or user_id):
        return func.HttpResponse(
            json.dumps({"error": "message_ids and user identifier are required"}),
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

        token = _get_google_token(db, user)
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token, token_error = _ensure_access_token(db, token)
        if token_error or not access_token:
            return func.HttpResponse(
                json.dumps({"error": "Unable to refresh token", "details": token_error}),
                status_code=401,
                mimetype="application/json",
                headers=cors,
            )

        errors = []
        for message_id in message_ids:
            error = _gmail_trash_message(access_token, message_id)
            if error:
                errors.append({"id": message_id, "error": error})

        if errors:
            return func.HttpResponse(
                json.dumps({"error": "Failed to trash some messages", "details": errors}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        return func.HttpResponse(
            json.dumps({"trashed": len(message_ids), "account_email": token.google_account_email, "user": user.email}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email trash failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email trash failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="EmailDelete")
@app.route(route="email/delete", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_delete(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    body = body or {}

    email = body.get("email")
    user_id = body.get("user_id") or body.get("userId")
    message_ids = _normalize_ids(body.get("message_ids") or body.get("messageIds") or body.get("ids"))

    if not message_ids or not (email or user_id):
        return func.HttpResponse(
            json.dumps({"error": "message_ids and user identifier are required"}),
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

        token = _get_google_token(db, user)
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token, token_error = _ensure_access_token(db, token)
        if token_error or not access_token:
            return func.HttpResponse(
                json.dumps({"error": "Unable to refresh token", "details": token_error}),
                status_code=401,
                mimetype="application/json",
                headers=cors,
            )

        errors = []
        for message_id in message_ids:
            error = _gmail_delete_message(access_token, message_id)
            if error:
                errors.append({"id": message_id, "error": error})

        if errors:
            return func.HttpResponse(
                json.dumps({"error": "Failed to delete some messages", "details": errors}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )

        return func.HttpResponse(
            json.dumps({"deleted": len(message_ids), "account_email": token.google_account_email, "user": user.email}),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email delete failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email delete failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()


@app.function_name(name="EmailSend")
@app.route(route="email/send", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def email_send(req: func.HttpRequest) -> func.HttpResponse:
    cors = build_cors_headers(req, ["POST", "OPTIONS"])
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=204, headers=cors)

    try:
        body = req.get_json()
    except ValueError:
        body = None
    body = body or {}

    email = body.get("email")
    user_id = body.get("user_id") or body.get("userId")
    to_value = _normalize_address(body.get("to"))
    subject = str(body.get("subject") or "")
    message_body = str(body.get("body") or "")
    cc_value = _normalize_address(body.get("cc"))
    bcc_value = _normalize_address(body.get("bcc"))
    thread_id = body.get("thread_id") or body.get("threadId")
    in_reply_to = body.get("in_reply_to") or body.get("inReplyTo")
    references = body.get("references")
    attachments = body.get("attachments") or []

    if not (email or user_id) or not to_value or not message_body:
        return func.HttpResponse(
            json.dumps({"error": "email, to, and body are required"}),
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

        token = _get_google_token(db, user)
        if not token:
            return func.HttpResponse(
                json.dumps({"error": "No Google account connected"}),
                status_code=404,
                mimetype="application/json",
                headers=cors,
            )

        access_token, token_error = _ensure_access_token(db, token)
        if token_error or not access_token:
            return func.HttpResponse(
                json.dumps({"error": "Unable to refresh token", "details": token_error}),
                status_code=401,
                mimetype="application/json",
                headers=cors,
            )

        sender = _normalize_address(body.get("from")) or token.google_account_email or user.email
        raw_message = _build_raw_message(
            sender,
            to_value,
            subject,
            message_body,
            cc_value=cc_value,
            bcc_value=bcc_value,
            in_reply_to=in_reply_to,
            references=references,
            attachments=attachments,
        )
        payload = {"raw": raw_message}
        if thread_id:
            payload["threadId"] = thread_id

        resp = requests.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
            json=payload,
        )
        if resp.status_code != 200:
            return func.HttpResponse(
                json.dumps({"error": "Failed to send email", "details": resp.text}),
                status_code=400,
                mimetype="application/json",
                headers=cors,
            )
        data = resp.json() if resp.text else {}
        return func.HttpResponse(
            json.dumps(
                {
                    "message_id": data.get("id"),
                    "threadId": data.get("threadId"),
                    "labelIds": data.get("labelIds"),
                    "account_email": token.google_account_email,
                    "user": user.email,
                }
            ),
            status_code=200,
            mimetype="application/json",
            headers=cors,
        )
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("Email send failed: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Email send failed", "details": str(exc)}),
            status_code=500,
            mimetype="application/json",
            headers=cors,
        )
    finally:
        db.close()
