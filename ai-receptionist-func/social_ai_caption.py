import json
import logging
from typing import Optional

import azure.functions as func
import httpx

from function_app import app
from shared.config import get_required_setting, get_setting
from utils.cors import build_cors_headers

logger = logging.getLogger(__name__)


def _call_openai_caption(seed: str) -> str:
  """
  Call OpenAI to generate a short social caption with hashtags.
  """
  api_key = get_required_setting("OPENAI_API_KEY")
  base_url = get_setting("OPENAI_BASE_URL", "https://api.openai.com/v1")
  model = get_setting("OPENAI_MODEL", "gpt-4.1-mini")
  messages = [
    {
      "role": "system",
      "content": (
        "You write concise social media captions. Keep it 1-2 sentences max. "
        "Add 4-8 relevant hashtags. Output plain text only."
      ),
    },
    {
      "role": "user",
      "content": f'Caption seed: "{seed}"\nCreate a caption that matches this seed and include hashtags.',
    },
  ]

  payload = {"model": model, "messages": messages, "temperature": 0.5, "max_tokens": 180}
  headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
  url = f"{base_url.rstrip('/')}/chat/completions"
  timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=None)

  with httpx.Client(timeout=timeout) as client:
    resp = client.post(url, headers=headers, json=payload)
  if resp.status_code >= 300:
    logger.error("Caption generation failed: %s - %s", resp.status_code, resp.text)
    raise RuntimeError(f"OpenAI error {resp.status_code}: {resp.text}")

  data = resp.json()
  content: Optional[str] = (
    data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
  )
  if not content:
    logger.error("Empty caption returned from OpenAI. Full response: %s", json.dumps(data))
    raise RuntimeError("OpenAI returned an empty caption")
  return content


@app.function_name(name="SocialAICaption")
@app.route(route="social/ai/caption", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def social_ai_caption(req: func.HttpRequest) -> func.HttpResponse:
  cors = build_cors_headers(req, ["POST", "OPTIONS"])
  if req.method == "OPTIONS":
    return func.HttpResponse("", status_code=204, headers=cors)

  try:
    body = req.get_json()
  except ValueError:
    body = None
  payload = body or {}

  text = (payload.get("text") or "").strip()
  if not text:
    return func.HttpResponse(
      json.dumps({"error": "text is required"}),
      status_code=400,
      mimetype="application/json",
      headers=cors,
    )

  try:
    caption = _call_openai_caption(text)
    return func.HttpResponse(
      json.dumps({"caption": caption}),
      status_code=200,
      mimetype="application/json",
      headers=cors,
    )
  except Exception as exc:  # pylint: disable=broad-except
    logger.error("Social AI caption failed: %s", exc)
    return func.HttpResponse(
      json.dumps({"error": "Failed to generate caption", "details": str(exc)}),
      status_code=500,
      mimetype="application/json",
      headers=cors,
    )
