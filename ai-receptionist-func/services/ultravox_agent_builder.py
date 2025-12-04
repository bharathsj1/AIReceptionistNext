import re
from typing import Dict, Optional


def _sanitize_name(name: str) -> str:
    """
    Make a name API-safe: letters/numbers/underscore/hyphen, max 64 chars.
    Mirrors the sample Ultravox payload from the docs.
    """
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "_", name or "")
    cleaned = cleaned.strip("_")[:64]
    return cleaned or "agent"


def build_ultravox_agent_payload(
    business_name: str,
    website_url: str,
    summary: str,
    agent_name_override: Optional[str] = None,
    system_prompt_override: Optional[str] = None,
) -> Dict:
    """
    Build the Ultravox agent payload exactly as shown in the docs example.
    """
    base_name = agent_name_override or business_name or "agent"
    safe_name = _sanitize_name(base_name)

    system_prompt = system_prompt_override or (
        "You are Anna, a friendly customer support agent for Acme Inc. "
        "You are talking to {{customerName}}. Help with questions about our "
        "products and services. If you cannot answer, offer to transfer to a human."
    )

    return {
        "name": safe_name,
        "callTemplate": {
            "systemPrompt": system_prompt,
            "voice": "Jessica",
            "temperature": 0.4,
            "recordingEnabled": True,
            "firstSpeakerSettings": {
                "agent": {
                    "text": "Hello! This is Anna from Acme customer support. How can I help you today?"
                }
            },
            "selectedTools": [],
        },
    }
