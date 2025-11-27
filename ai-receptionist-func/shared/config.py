import os
from typing import Optional


def get_setting(name: str, default: Optional[str] = None) -> Optional[str]:
    return os.getenv(name, default)
