import logging
from typing import Any, Dict, Optional, Tuple

import requests

GRAPH_BASE = "https://graph.facebook.com/v21.0"
logger = logging.getLogger(__name__)


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
