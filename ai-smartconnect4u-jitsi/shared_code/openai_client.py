from __future__ import annotations

import io
import json
import logging
import os
from typing import Dict, Tuple

from openai import OpenAI

logger = logging.getLogger(__name__)

_API_KEY = os.getenv("OPENAI_API_KEY")
_MODEL_TRANSCRIBE = os.getenv("OPENAI_MODEL_TRANSCRIBE", "whisper-1")
_MODEL_SUMMARIZE = os.getenv("OPENAI_MODEL_SUMMARIZE", "gpt-4o-mini")


def _client() -> OpenAI:
    if not _API_KEY:
        raise RuntimeError("OPENAI_API_KEY is required")
    return OpenAI(api_key=_API_KEY)


def transcribe_audio(audio_bytes: bytes, filename: str | None = None) -> Tuple[str, str | None, float | None]:
    name = filename or "audio.wav"
    with io.BytesIO(audio_bytes) as buffer:
        buffer.name = name
        resp = _client().audio.transcriptions.create(
            model=_MODEL_TRANSCRIBE,
            file=buffer,
            response_format="verbose_json",
        )
    text = getattr(resp, "text", None) or resp.get("text") if isinstance(resp, dict) else None
    if not text:
        raise RuntimeError("Transcription returned empty result")
    language = getattr(resp, "language", None) if not isinstance(resp, dict) else resp.get("language")
    duration = getattr(resp, "duration", None) if not isinstance(resp, dict) else resp.get("duration")
    return text, language, duration


def summarize_transcript(transcript: str) -> Dict:
    if not transcript:
        raise ValueError("transcript is required")
    system_prompt = (
        "You are an assistant that produces concise JSON meeting summaries. "
        "Return exactly the JSON object with the fields requested."
    )
    user_prompt = (
        "Summarize the following transcript. Limit summary to 10 bullet lines (each starts with '-').\n"  # noqa: E501
        "Required JSON keys: title (string), summary (string bullet list), decisions (string[]), "
        "actionItems (array of {task, owner, dueDate}), followUps (string[]).\n"
        f"Transcript:\n{transcript}"
    )
    def _run(prompt: str) -> Dict:
        resp = _client().chat.completions.create(
            model=_MODEL_SUMMARIZE,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        return json.loads(resp.choices[0].message.content if resp.choices else "{}")

    try:
        parsed = _run(user_prompt)
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("First summarize attempt failed (%s); retrying with repair prompt", exc)
        repair_prompt = (
            "Repair the JSON to match the required schema exactly. If content is missing, infer briefly.\n"
            f"Original transcript:\n{transcript}"
        )
        parsed = _run(repair_prompt)

    # enforce keys and bullet formatting
    parsed.setdefault("title", "Meeting Summary")
    parsed.setdefault("summary", "")
    parsed.setdefault("decisions", [])
    parsed.setdefault("actionItems", [])
    parsed.setdefault("followUps", [])

    if isinstance(parsed.get("summary"), str):
        lines = [line.strip() for line in parsed["summary"].splitlines() if line.strip()]
        parsed["summary"] = "\n".join([line if line.startswith("-") else f"- {line}" for line in lines])

    # Normalize actionItems structure
    normalized_items = []
    for item in parsed.get("actionItems") or []:
        if isinstance(item, dict):
            normalized_items.append(
                {
                    "task": str(item.get("task") or item.get("title") or "").strip(),
                    "owner": item.get("owner"),
                    "dueDate": item.get("dueDate") or item.get("due") or None,
                }
            )
        else:
            normalized_items.append({"task": str(item), "owner": None, "dueDate": None})
    parsed["actionItems"] = normalized_items

    # decisions/followUps ensure list of strings
    parsed["decisions"] = [str(d).strip() for d in parsed.get("decisions") or [] if str(d).strip()]
    parsed["followUps"] = [str(f).strip() for f in parsed.get("followUps") or [] if str(f).strip()]

    return parsed
