import logging
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

GRAPH_BASE = "https://graph.facebook.com/v21.0"
logger = logging.getLogger(__name__)


def _response_json(resp: requests.Response) -> Dict[str, Any]:
    try:
        data = resp.json()
        return data if isinstance(data, dict) else {}
    except Exception:  # pylint: disable=broad-except
        return {}


def _graph_error_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    error = payload.get("error")
    return error if isinstance(error, dict) else {}


def _format_graph_error(resp: requests.Response, fallback: str) -> str:
    payload = _response_json(resp)
    error = _graph_error_payload(payload)
    if error:
        message = error.get("message") or fallback
        code = error.get("code")
        subcode = error.get("error_subcode")
        pieces = [str(message)]
        if code is not None:
            pieces.append(f"code={code}")
        if subcode is not None:
            pieces.append(f"subcode={subcode}")
        return " | ".join(pieces)
    return resp.text or fallback


def _is_media_not_ready_error(payload: Dict[str, Any], raw_text: str = "") -> bool:
    error = _graph_error_payload(payload)
    if not error:
        return "media is not ready" in (raw_text or "").lower()
    code = str(error.get("code") or "")
    subcode = str(error.get("error_subcode") or "")
    message = str(error.get("message") or "").lower()
    user_msg = str(error.get("error_user_msg") or "").lower()
    if code == "9007" and subcode == "2207027":
        return True
    return "media is not ready" in message or "not ready to be published" in user_msg


def build_auth_url(client_id: str, redirect_uri: str, scopes: List[str], state: str) -> str:
    scope_str = ",".join(scopes)
    return (
        "https://www.facebook.com/v21.0/dialog/oauth"
        f"?client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&state={state}"
        f"&scope={scope_str}"
    )


def exchange_code_for_token(
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    code: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    try:
        resp = requests.get(
            f"{GRAPH_BASE}/oauth/access_token",
            params={
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "code": code,
            },
            timeout=10,
        )
        if resp.status_code >= 300:
            return None, resp.text
        return resp.json(), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def list_accounts(user_access_token: str) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    try:
        resp = requests.get(
            f"{GRAPH_BASE}/me/accounts",
            params={
                "fields": "id,name,access_token,instagram_business_account{id,username}",
                "access_token": user_access_token,
            },
            timeout=10,
        )
        if resp.status_code >= 300:
            return [], resp.text
        data = resp.json()
        return data.get("data") or [], None
    except Exception as exc:  # pylint: disable=broad-except
        return [], str(exc)


def get_page_instagram_business_account(
    page_id: str,
    access_token: str,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    try:
        resp = requests.get(
            f"{GRAPH_BASE}/{page_id}",
            params={
                "fields": "instagram_business_account{id,username}",
                "access_token": access_token,
            },
            timeout=10,
        )
        if resp.status_code >= 300:
            return None, resp.text
        data = resp.json() or {}
        return data.get("instagram_business_account"), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def list_conversations(
    account_id: str,
    access_token: str,
    *,
    limit: int = 25,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    normalized_limit = max(1, min(int(limit or 25), 100))
    field_attempts = [
        # Broad set (works for many FB/IG configurations).
        "id,updated_time,participants.limit(25){id,name,username},messages.limit(10){id,created_time,message,from}",
        # Some IG accounts reject username in participants.
        "id,updated_time,participants.limit(25){id,name},messages.limit(10){id,created_time,message,from}",
        # Minimal fallback.
        "id,updated_time,messages.limit(10){id,created_time,message,from}",
    ]
    last_error: Optional[str] = None
    for fields in field_attempts:
        try:
            resp = requests.get(
                f"{GRAPH_BASE}/{account_id}/conversations",
                params={
                    "fields": fields,
                    "limit": normalized_limit,
                    "access_token": access_token,
                },
                timeout=12,
            )
            if resp.status_code >= 300:
                last_error = resp.text
                continue
            data = resp.json()
            return data.get("data") or [], None
        except Exception as exc:  # pylint: disable=broad-except
            last_error = str(exc)
            continue
    return [], last_error or "Unable to list conversations"


def get_conversation_detail(
    conversation_id: str,
    access_token: str,
    *,
    message_limit: int = 10,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    normalized_limit = max(1, min(int(message_limit or 10), 50))
    field_attempts = [
        f"id,updated_time,participants.limit(25){{id,name,username}},messages.limit({normalized_limit}){{id,created_time,message,from}}",
        f"id,updated_time,participants.limit(25){{id,name}},messages.limit({normalized_limit}){{id,created_time,message,from}}",
        f"id,updated_time,messages.limit({normalized_limit}){{id,created_time,message,from}}",
    ]
    last_error: Optional[str] = None
    for fields in field_attempts:
        try:
            resp = requests.get(
                f"{GRAPH_BASE}/{conversation_id}",
                params={
                    "fields": fields,
                    "access_token": access_token,
                },
                timeout=12,
            )
            if resp.status_code >= 300:
                last_error = resp.text
                continue
            return resp.json() or {}, None
        except Exception as exc:  # pylint: disable=broad-except
            last_error = str(exc)
            continue
    return None, last_error or "Unable to read conversation detail"


def subscribe_app(
    account_id: str,
    access_token: str,
    *,
    subscribed_fields: Optional[List[str]] = None,
) -> Optional[str]:
    try:
        fields = subscribed_fields or [
            "messages",
            "messaging_postbacks",
            "messaging_optins",
            "message_deliveries",
            "message_reads",
            "feed",
            "mention",
        ]
        resp = requests.post(
            f"{GRAPH_BASE}/{account_id}/subscribed_apps",
            params={"access_token": access_token},
            data={"subscribed_fields": ",".join(fields)},
            timeout=10,
        )
        if resp.status_code >= 300:
            return resp.text
        return None
    except Exception as exc:  # pylint: disable=broad-except
        return str(exc)


def send_message(
    channel: str,
    access_token: str,
    sender_id: str,
    recipient_id: str,
    text: str,
) -> Tuple[Optional[str], Optional[str]]:
    try:
        resp = requests.post(
            f"{GRAPH_BASE}/{sender_id}/messages",
            params={"access_token": access_token},
            json={
                "messaging_type": "RESPONSE",
                "recipient": {"id": recipient_id},
                "message": {"text": text},
            },
            timeout=10,
        )
        if resp.status_code >= 300:
            return None, resp.text
        data = resp.json()
        message_id = data.get("message_id") or data.get("id")
        if not message_id:
            return None, f"{channel} send did not return message id"
        return message_id, None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def publish_facebook_post(
    page_id: str,
    access_token: str,
    caption: str,
    media_url: Optional[str],
) -> Tuple[Optional[str], Optional[str]]:
    try:
        if media_url:
            resp = requests.post(
                f"{GRAPH_BASE}/{page_id}/photos",
                params={"access_token": access_token},
                data={"url": media_url, "caption": caption},
                timeout=15,
            )
        else:
            resp = requests.post(
                f"{GRAPH_BASE}/{page_id}/feed",
                params={"access_token": access_token},
                data={"message": caption},
                timeout=10,
            )
        if resp.status_code >= 300:
            return None, resp.text
        data = resp.json()
        post_id = data.get("post_id") or data.get("id")
        return post_id, None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def publish_instagram_post(
    ig_user_id: str,
    access_token: str,
    caption: str,
    media_url: str,
) -> Tuple[Optional[str], Optional[str]]:
    if not media_url:
        return None, "Instagram publishing requires media_url"
    try:
        container_resp = requests.post(
            f"{GRAPH_BASE}/{ig_user_id}/media",
            params={"access_token": access_token},
            data={"image_url": media_url, "caption": caption},
            timeout=15,
        )
        if container_resp.status_code >= 300:
            return None, _format_graph_error(container_resp, "Instagram media container creation failed")
        container_id = (container_resp.json() or {}).get("id")
        if not container_id:
            return None, "Instagram did not return container id"

        # Guard against transient "media not ready" by waiting for processing and retrying publish.
        # This avoids surfacing raw OAuthException 9007 / subcode 2207027 to end users.
        for _ in range(8):
            status_resp = requests.get(
                f"{GRAPH_BASE}/{container_id}",
                params={
                    "fields": "status_code,status",
                    "access_token": access_token,
                },
                timeout=10,
            )
            if status_resp.status_code < 300:
                status_payload = _response_json(status_resp)
                status = str(
                    status_payload.get("status_code")
                    or status_payload.get("status")
                    or ""
                ).upper()
                if status in {"FINISHED", "PUBLISHED"}:
                    break
                if status in {"ERROR", "EXPIRED"}:
                    return None, f"Instagram media processing failed (status={status})"
            time.sleep(2)

        retry_delays = [0, 2, 3, 5, 8, 13]
        last_error = "Instagram publish failed"
        for delay in retry_delays:
            if delay:
                time.sleep(delay)
            publish_resp = requests.post(
                f"{GRAPH_BASE}/{ig_user_id}/media_publish",
                params={"access_token": access_token},
                data={"creation_id": container_id},
                timeout=15,
            )
            if publish_resp.status_code < 300:
                post_id = (_response_json(publish_resp) or {}).get("id")
                return post_id, None

            publish_payload = _response_json(publish_resp)
            last_error = _format_graph_error(publish_resp, "Instagram publish failed")
            if _is_media_not_ready_error(publish_payload, publish_resp.text):
                logger.info(
                    "Instagram media not ready yet (ig_user_id=%s, container_id=%s). Retrying.",
                    ig_user_id,
                    container_id,
                )
                continue
            return None, last_error

        return None, (
            "Instagram media is still processing. Please wait a moment and retry publish."
            f" Details: {last_error}"
        )
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)
