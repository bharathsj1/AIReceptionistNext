from __future__ import annotations

from datetime import datetime, time
from typing import Iterable, Optional

DAY_KEYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


def weekday_key(dt: datetime) -> str:
    return DAY_KEYS[dt.weekday()]


def parse_hhmm(value: str | None) -> Optional[time]:
    raw = str(value or "").strip()
    if not raw:
        return None
    parts = raw.split(":")
    if len(parts) != 2:
        return None
    try:
        hh = int(parts[0])
        mm = int(parts[1])
    except (TypeError, ValueError):
        return None
    if hh < 0 or hh > 23 or mm < 0 or mm > 59:
        return None
    return time(hour=hh, minute=mm)


def _time_in_range(current: time, start: time, end: time) -> bool:
    # Handles overnight windows such as 22:00 -> 06:00.
    if start < end:
        return start <= current < end
    return current >= start or current < end


def _range_matches(local_dt: datetime, range_item: dict) -> bool:
    start = parse_hhmm(range_item.get("start"))
    end = parse_hhmm(range_item.get("end"))
    if not start or not end:
        return False
    return _time_in_range(local_dt.timetz().replace(tzinfo=None), start, end)


def rule_matches(local_dt: datetime, rule: dict) -> bool:
    days = [str(item).strip().upper() for item in (rule.get("days") or []) if str(item).strip()]
    if days and weekday_key(local_dt) not in days:
        return False
    ranges = rule.get("timeRanges") or []
    if not isinstance(ranges, list) or not ranges:
        return False
    for item in ranges:
        if isinstance(item, dict) and _range_matches(local_dt, item):
            return True
    return False


def sort_rules(rules: Iterable[dict]) -> list[dict]:
    indexed = []
    for idx, rule in enumerate(rules or []):
        if not isinstance(rule, dict):
            continue
        try:
            priority = int(rule.get("priority"))
        except (TypeError, ValueError):
            priority = 9999
        indexed.append((priority, idx, rule))
    indexed.sort(key=lambda item: (item[0], item[1]))
    return [item[2] for item in indexed]


def match_rule(local_dt: datetime, rules: Iterable[dict]) -> Optional[dict]:
    for rule in sort_rules(rules):
        if rule_matches(local_dt, rule):
            return rule
    return None
