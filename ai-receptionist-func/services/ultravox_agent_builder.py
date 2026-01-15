import re
from typing import Dict, Optional

MAX_SUMMARY_CHARS = 4000


def _sanitize_name(name: str) -> str:
    """
    Make a name API-safe: letters/numbers/underscore/hyphen, max 64 chars.
    Mirrors the sample Ultravox payload from the docs.
    """
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "_", name or "")
    cleaned = cleaned.strip("_")[:64]
    return cleaned or "agent"


def _build_default_system_prompt(
    business_name: str,
    website_url: str,
    summary: str,
) -> str:
    name = business_name.strip() if isinstance(business_name, str) and business_name.strip() else "this business"
    safe_summary = summary.strip() if isinstance(summary, str) else ""
    if safe_summary:
        safe_summary = safe_summary[:MAX_SUMMARY_CHARS]
    details_lines = []
    if isinstance(website_url, str) and website_url.strip():
        details_lines.append(f"Website: {website_url.strip()}")
    if safe_summary:
        details_lines.append(f"Business details:\n{safe_summary}")
    details_block = "\n".join(details_lines).strip()
    details_text = f"\n\n{details_block}" if details_block else ""
    return (
        f"You are a friendly AI receptionist for {name}. "
        "Use the business details below to answer calls accurately and specifically. "
        "If a detail is missing or unclear, ask the caller or offer to take a message. "
        "Never invent facts. Capture caller name, phone, and email when appropriate."
        f"{details_text}"
    )


def build_ultravox_agent_payload(
    business_name: str,
    website_url: str,
    summary: str,
    agent_name_override: Optional[str] = None,
    system_prompt_override: Optional[str] = None,
    voice_override: Optional[str] = None,
    greeting_override: Optional[str] = None,
) -> Dict:
    """
    Build the Ultravox agent payload exactly as shown in the docs example.
    """
    base_name = agent_name_override or business_name or "agent"
    safe_name = _sanitize_name(base_name)

    system_prompt = system_prompt_override or _build_default_system_prompt(
        business_name,
        website_url,
        summary,
    )
    display_name = business_name.strip() if isinstance(business_name, str) and business_name.strip() else "the business"
    greeting_text = greeting_override or (
        f"Hello! Thanks for calling {display_name}. How can I help you today?"
    )

    return {
        "name": safe_name,
        "callTemplate": {
            "systemPrompt": system_prompt,
            "voice": voice_override or "Jessica",
            "temperature": 0.4,
            "recordingEnabled": True,
            "firstSpeakerSettings": {
                "agent": {
                    "text": greeting_text
                }
            },
            "selectedTools": [],
        },
    }
