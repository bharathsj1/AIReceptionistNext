import json
import logging
from typing import Any, Dict, Optional

import httpx

from shared.config import get_required_setting, get_setting
from shared.prompt_registry import compute_source_data_hash

logger = logging.getLogger(__name__)

MAX_KNOWLEDGE_CHARS = 12000


TASK_TYPES = {
    "ORDER",
    "BOOKING",
    "QUOTE_REQUEST",
    "SUPPORT_TICKET",
    "LEAD",
    "MESSAGE",
}


def normalize_task_type(task_type: Optional[str]) -> Optional[str]:
    if not task_type:
        return None
    normalized = str(task_type).strip().upper()
    return normalized if normalized in TASK_TYPES else None


def infer_task_type(category: Optional[str], sub_type: Optional[str]) -> Optional[str]:
    category = (category or "").lower()
    sub_type = (sub_type or "").lower()
    if any(key in sub_type for key in ("booking", "reservation", "hotel", "spa", "clinic")):
        return "BOOKING"
    if any(key in sub_type for key in ("repair", "service", "garage", "hvac", "plumbing")):
        return "QUOTE_REQUEST"
    if any(key in category for key in ("health", "hospitality", "fitness")):
        return "BOOKING"
    if any(key in category for key in ("professional", "real estate", "home")):
        return "LEAD"
    return "LEAD"


def normalize_business_profile(raw: Optional[Dict[str, Any]]) -> Dict[str, str]:
    if not raw or not isinstance(raw, dict):
        return {}
    def _get(key: str) -> str:
        value = raw.get(key)
        return str(value).strip() if value is not None else ""
    return {
        "business_name": _get("business_name") or _get("businessName") or _get("name"),
        "business_summary": _get("business_summary") or _get("businessSummary"),
        "business_location": _get("business_location") or _get("location"),
        "business_hours": _get("business_hours") or _get("hours"),
        "business_openings": _get("business_openings") or _get("openings"),
        "business_services": _get("business_services") or _get("services"),
        "business_notes": _get("business_notes") or _get("notes"),
        "contact_email": _get("contact_email") or _get("businessEmail") or _get("contactEmail"),
        "contact_phone": _get("contact_phone") or _get("businessPhone") or _get("contactNumber"),
    }


def build_knowledge_text(knowledge_text: Optional[str], business_profile: Optional[Dict[str, Any]]) -> str:
    if isinstance(knowledge_text, str) and knowledge_text.strip():
        return knowledge_text.strip()[:MAX_KNOWLEDGE_CHARS]
    profile = normalize_business_profile(business_profile)
    lines = [
        f"Business name: {profile.get('business_name', '')}",
        f"Summary: {profile.get('business_summary', '')}",
        f"Location: {profile.get('business_location', '')}",
        f"Hours: {profile.get('business_hours', '')}",
        f"Openings: {profile.get('business_openings', '')}",
        f"Services: {profile.get('business_services', '')}",
        f"Notes: {profile.get('business_notes', '')}",
        f"Contact email: {profile.get('contact_email', '')}",
        f"Contact phone: {profile.get('contact_phone', '')}",
    ]
    merged = "\n".join([line for line in lines if line.split(": ")[-1]])
    return merged.strip()[:MAX_KNOWLEDGE_CHARS]


def build_openai_prompt_request(
    *,
    category: Optional[str],
    sub_type: Optional[str],
    task_type: Optional[str],
    business_profile: Dict[str, Any],
    knowledge_text: str,
) -> Dict[str, Any]:
    profile_json = json.dumps(business_profile, indent=2, ensure_ascii=True)
    instructions = (
        "You are an Ultravox voice agent prompt generator. "
        "Output only the final system prompt text. "
        "No markdown, no JSON, no commentary, no bullet characters."
    )
    developer_rules = (
        "Rules:\n"
        "- Produce a single Ultravox system prompt string only.\n"
        "- Do not include any private customer PII; only business info and public knowledge.\n"
        "- Keep the prompt concise, voice-friendly, and structured for call handling.\n"
        "- Include guidance for booking, FAQs, call routing, and after-hours handling.\n"
        "- Include escalation policy and how to capture caller contact details.\n"
        "- Mention business hours if provided, otherwise ask the caller.\n"
        "- Use natural spoken style; avoid lists or markdown in the output.\n"
    )
    example_flows = (
        "Example call flow (adapt as needed):\n"
        "1) Greet warmly and ask how you can help.\n"
        "2) Clarify intent and confirm service.\n"
        "3) If booking: gather date/time preference, name, phone, email.\n"
        "4) Confirm details, share next steps, and close politely.\n"
    )

    user_content = (
        f"Category: {category or ''}\n"
        f"Sub-type: {sub_type or ''}\n"
        f"Task type: {task_type or ''}\n\n"
        "Business profile JSON:\n"
        f"{profile_json}\n\n"
        "Knowledge text (edited crawl/KB content):\n"
        f"{knowledge_text}\n\n"
        f"{example_flows}"
    )

    return {
        "model": get_setting("OPENAI_MODEL", "gpt-4.1-mini"),
        "messages": [
            {"role": "system", "content": instructions},
            {"role": "developer", "content": developer_rules},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.4,
        "max_tokens": 1600,
    }


def call_openai_for_prompt(payload: Dict[str, Any]) -> str:
    api_key = get_required_setting("OPENAI_API_KEY")
    base_url = get_setting("OPENAI_BASE_URL", "https://api.openai.com/v1")
    url = f"{base_url.rstrip('/')}/chat/completions"

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    timeout = httpx.Timeout(connect=10.0, read=80.0, write=10.0, pool=None)

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, headers=headers, json=payload)
    except httpx.ReadTimeout as exc:
        logger.error("OpenAI request timed out while reading response: %s", exc)
        raise RuntimeError("OpenAI API read timeout") from exc
    except httpx.RequestError as exc:
        logger.error("OpenAI request failed: %s", exc)
        raise RuntimeError(f"OpenAI request failed: {exc}") from exc

    if resp.status_code >= 300:
        logger.error("OpenAI prompt generation failed: %s - %s", resp.status_code, resp.text)
        raise RuntimeError(f"OpenAI API error {resp.status_code}: {resp.text}")

    data = resp.json()
    content = (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    if not content:
        logger.error("OpenAI returned empty content. Full response: %s", json.dumps(data))
        raise RuntimeError("OpenAI returned an empty prompt")
    return content


def compute_source_hash_for_prompt(
    *,
    category: Optional[str],
    sub_type: Optional[str],
    task_type: Optional[str],
    business_profile: Optional[Dict[str, Any]],
    knowledge_text: Optional[str],
) -> str:
    normalized_profile = normalize_business_profile(business_profile)
    normalized_knowledge = build_knowledge_text(knowledge_text, normalized_profile)
    return compute_source_data_hash(category, sub_type, task_type, normalized_profile, normalized_knowledge)


def prepare_prompt_inputs(
    *,
    category: Optional[str],
    sub_type: Optional[str],
    task_type: Optional[str],
    business_profile: Optional[Dict[str, Any]],
    knowledge_text: Optional[str],
) -> tuple[Optional[str], Dict[str, str], str, str]:
    normalized_task = normalize_task_type(task_type) or infer_task_type(category, sub_type)
    normalized_profile = normalize_business_profile(business_profile)
    normalized_knowledge = build_knowledge_text(knowledge_text, normalized_profile)
    source_hash = compute_source_data_hash(
        category,
        sub_type,
        normalized_task,
        normalized_profile,
        normalized_knowledge,
    )
    return normalized_task, normalized_profile, normalized_knowledge, source_hash
