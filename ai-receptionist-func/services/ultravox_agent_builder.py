import re
from typing import Dict, Optional
from urllib.parse import urlparse


def _derive_business_name(business_name: str, website_url: str) -> str:
    """
    Derive a simple business name from provided name or domain.
    Avoids adding protocol/query/port noise.
    """
    if business_name:
        name = business_name.strip()
        if name:
            return name

    parsed = urlparse(website_url or "")
    host = parsed.netloc or website_url
    if host.startswith("www."):
        host = host[4:]
    host = host.split(":")[0]
    # Convert "my-business.co.uk" -> "my business"
    host = re.sub(r"[-_]", " ", host)
    return host.strip() or "Your Business"


def _sanitize_agent_name(name: str) -> str:
    """
    Ultravox agent `name` must match ^[a-zA-Z0-9_-]{1,64}$.
    Convert spaces/punctuation to dashes, strip invalid chars, and cap length.
    """
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", name)
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-_")
    if not cleaned:
        cleaned = "AI-Receptionist"
    return cleaned[:64]


def _is_bolton_properties(business_name: str, website_url: str) -> bool:
    """
    Check if this is the Bolton Properties demo client.
    Explicit special-case to provide a richer prompt for demos.
    """
    name = business_name.lower()
    url = (website_url or "").lower()
    return "boltonproperties.co.uk" in url or "bolton properties" in name


def build_ultravox_agent_payload(
    business_name: str, website_url: str, summary: str, agent_name_override: Optional[str] = None
) -> Dict:
    """
    Build the Ultravox agent payload with a generic receptionist prompt,
    and a special tailored prompt for Bolton Properties (demo client).
    """
    name = _derive_business_name(business_name, website_url)

    generic_prompt = (
        f"You are the AI phone receptionist for {name}. "
        "Answer calls warmly and professionally. Introduce yourself and mention you are answering on behalf "
        f"of {name}. Collect the caller's name, phone number, and the reason for the call. "
        "If scheduling or basic questions are possible, help courteously. "
        "Summarize the key details and promise a prompt follow-up when you cannot complete the request."
    )

    if _is_bolton_properties(name, website_url):
        # Demo/test client: Bolton Properties gets a richer, estate-agent specific prompt.
        system_prompt = (
            "You are the warm, professional phone receptionist for Bolton Properties, an award-winning independent "
            "estate and lettings agency based in Farnworth, Bolton, serving Bolton and nearby areas. "
            "Quickly identify if the caller is a buyer, seller, tenant, or landlord. "
            "For sellers or landlords: capture their name, property address, best contact details, and whether they want a free valuation "
            "or market appraisal for sales or lettings. "
            "For buyers or tenants: capture what type of property they're looking for (buy or rent), price range, bedrooms, and preferred areas. "
            "Offer to arrange a follow-up from the human team rather than promising specific valuations or legal advice. "
            "Mention their friendly, personable, and highly professional service—they never do the minimum. "
            "Note that they cover property sales and lettings across Bolton and surrounding areas. "
            "They offer free valuations and market appraisals for both sales and lettings. "
            "They are award-winning (ESTAS Estate Agent of the Year People Awards 2017; branch manager Chris Baron placed in the UK top five; "
            "branch shortlisted for regional awards). "
            "Keep the tone locally knowledgeable, warm, and concise while ensuring key details are collected."
        )
    else:
        system_prompt = generic_prompt

    knowledge_text = "Here is some information about the business based on their website:\n\n" + (summary or "")
    desired_agent_name = agent_name_override or f"{name} AI Receptionist"
    agent_name = _sanitize_agent_name(desired_agent_name)

    return {
        "name": agent_name,
        "description": f"AI phone receptionist for {name}.",
        "systemPrompt": system_prompt,
        "knowledge": [{"type": "text", "content": knowledge_text}],
    }
