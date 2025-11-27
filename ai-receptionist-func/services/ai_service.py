from utils.helpers import normalize_message


def get_dummy_ai_response(message: str) -> str:
    normalized = normalize_message(message)
    return f"AI (dummy): I received your message: '{normalized}'"
