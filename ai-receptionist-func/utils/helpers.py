def normalize_message(text: str | None) -> str:
    if text is None:
        return ""
    return text.strip()
