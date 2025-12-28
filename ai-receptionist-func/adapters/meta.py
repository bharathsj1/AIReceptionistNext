import logging
from typing import Any, Dict, List, Optional, Tuple

import requests

GRAPH_BASE = "https://graph.facebook.com/v21.0"
logger = logging.getLogger(__name__)


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
            return None, container_resp.text
        container_id = (container_resp.json() or {}).get("id")
        if not container_id:
            return None, "Instagram did not return container id"
        publish_resp = requests.post(
            f"{GRAPH_BASE}/{ig_user_id}/media_publish",
            params={"access_token": access_token},
            data={"creation_id": container_id},
            timeout=15,
        )
        if publish_resp.status_code >= 300:
            return None, publish_resp.text
        post_id = (publish_resp.json() or {}).get("id")
        return post_id, None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)
