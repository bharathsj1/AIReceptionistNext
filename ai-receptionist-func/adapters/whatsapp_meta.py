import logging
from typing import Any, Dict, List, Optional, Tuple

import requests

GRAPH_BASE = "https://graph.facebook.com/v21.0"
logger = logging.getLogger(__name__)


def build_auth_url(
    client_id: str,
    redirect_uri: str,
    scopes: List[str],
    state: str,
    config_id: Optional[str] = None,
) -> str:
    scope_str = ",".join(scopes)
    url = (
        "https://www.facebook.com/v21.0/dialog/oauth"
        f"?client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&state={state}"
        f"&scope={scope_str}"
        "&response_type=code"
    )
    if config_id:
        url += f"&config_id={config_id}&override_default_response_type=true"
    return url


def list_business_accounts(access_token: str) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    try:
        resp = requests.get(
            f"{GRAPH_BASE}/me/whatsapp_business_accounts",
            params={"access_token": access_token, "fields": "id,name"},
            timeout=10,
        )
        if resp.status_code >= 300:
            return [], resp.text
        data: Dict[str, Any] = resp.json() or {}
        return data.get("data") or [], None
    except Exception as exc:  # pylint: disable=broad-except
        return [], str(exc)


def list_phone_numbers(waba_id: str, access_token: str) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    try:
        resp = requests.get(
            f"{GRAPH_BASE}/{waba_id}/phone_numbers",
            params={
                "access_token": access_token,
                "fields": "id,display_phone_number,verified_name,quality_rating",
            },
            timeout=10,
        )
        if resp.status_code >= 300:
            return [], resp.text
        data: Dict[str, Any] = resp.json() or {}
        return data.get("data") or [], None
    except Exception as exc:  # pylint: disable=broad-except
        return [], str(exc)


def send_message(
    phone_number_id: str,
    access_token: str,
    to_number: str,
    text: str,
) -> Tuple[Optional[str], Optional[str]]:
    try:
        resp = requests.post(
            f"{GRAPH_BASE}/{phone_number_id}/messages",
            headers={"Authorization": f"Bearer {access_token}"},
            json={
                "messaging_product": "whatsapp",
                "to": to_number,
                "type": "text",
                "text": {"body": text},
            },
            timeout=10,
        )
        if resp.status_code >= 300:
            return None, resp.text
        data: Dict[str, Any] = resp.json() or {}
        messages = data.get("messages") or []
        message_id = messages[0].get("id") if messages else None
        return message_id, None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)
