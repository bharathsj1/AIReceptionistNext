def is_non_empty_string(value: str | None) -> bool:
    return isinstance(value, str) and value.strip() != ""
