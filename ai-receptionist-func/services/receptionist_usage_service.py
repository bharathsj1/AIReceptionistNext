import calendar
import math
from datetime import datetime
from typing import Iterable

from sqlalchemy import and_, func as sa_func, or_

from shared.db import Call, Client, ClientUser, PhoneNumber, Subscription, User

PLAN_MINUTE_LIMITS = {
    "bronze": 500,
    "silver": 700,
    "gold": 1000,
}

ACTIVE_SUBSCRIPTION_STATUSES = {"active", "trialing"}


def _normalize_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def collect_subscription_emails_for_client(
    db,
    client: Client | None,
    include_email: str | None = None,
) -> set[str]:
    emails: set[str] = set()
    if include_email:
        normalized = _normalize_email(include_email)
        if normalized:
            emails.add(normalized)
    if not client:
        return emails

    if client.email:
        normalized = _normalize_email(client.email)
        if normalized:
            emails.add(normalized)

    if client.user_id:
        owner = db.query(User).filter(User.id == client.user_id).one_or_none()
        if owner and owner.email:
            normalized = _normalize_email(owner.email)
            if normalized:
                emails.add(normalized)

    members = (
        db.query(ClientUser.email)
        .filter(ClientUser.client_id == client.id)
        .filter(
            or_(
                ClientUser.is_active.is_(True),
                ClientUser.is_active.is_(None),
            )
        )
        .filter(sa_func.lower(sa_func.coalesce(ClientUser.status, "active")) != "disabled")
        .all()
    )
    for row in members:
        member_email = _normalize_email(row[0] if row else "")
        if member_email:
            emails.add(member_email)

    return emails


def _add_months(value: datetime, months: int) -> datetime:
    month_index = (value.month - 1) + int(months)
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def _start_of_day(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def compute_billing_cycle_window(anchor: datetime, now: datetime | None = None) -> tuple[datetime, datetime]:
    # Month cycles are date-to-date, not time-to-time.
    anchor_date = _start_of_day(anchor)
    reference = _start_of_day(now or datetime.utcnow())

    if anchor_date > reference:
        start = anchor_date
        return start, _add_months(start, 1)

    months = (reference.year - anchor_date.year) * 12 + (reference.month - anchor_date.month)
    start = _add_months(anchor_date, months)
    if start > reference:
        months -= 1
        start = _add_months(anchor_date, months)

    end = _add_months(start, 1)
    while end <= reference:
        start = end
        end = _add_months(start, 1)
    return start, end


def billable_minutes_from_seconds(seconds: float | int | None) -> int:
    if seconds is None:
        return 0
    try:
        total_seconds = float(seconds)
    except (TypeError, ValueError):
        return 0
    if total_seconds <= 0:
        return 0
    return int(math.ceil(total_seconds / 60.0))


def _resolve_active_receptionist_subscription(db, subscription_emails: Iterable[str]) -> Subscription | None:
    normalized_emails = []
    for item in subscription_emails or []:
        normalized = _normalize_email(item)
        if normalized:
            normalized_emails.append(normalized)
    if not normalized_emails:
        return None
    return (
        db.query(Subscription)
        .filter(sa_func.lower(sa_func.trim(Subscription.email)).in_(normalized_emails))
        .filter(sa_func.lower(sa_func.coalesce(Subscription.status, "")).in_(list(ACTIVE_SUBSCRIPTION_STATUSES)))
        .order_by(Subscription.updated_at.desc(), Subscription.created_at.desc())
        .first()
    )


def _call_duration_seconds(call: Call) -> float:
    if not call.started_at or not call.ended_at:
        return 0
    return max(0.0, (call.ended_at - call.started_at).total_seconds())


def build_receptionist_usage_summary(
    db,
    client: Client | None,
    subscription_emails: Iterable[str],
    now: datetime | None = None,
) -> dict | None:
    if not client:
        return None

    subscription = _resolve_active_receptionist_subscription(db, subscription_emails)
    if not subscription:
        return None

    plan_key = str(subscription.plan_id or "").strip().lower()
    included_minutes = PLAN_MINUTE_LIMITS.get(plan_key)
    anchor = subscription.created_at or subscription.updated_at or (now or datetime.utcnow())
    cycle_start, cycle_end = compute_billing_cycle_window(anchor, now=now)

    numbers = [
        row[0]
        for row in db.query(PhoneNumber.twilio_phone_number)
        .filter(PhoneNumber.client_id == client.id, PhoneNumber.is_active.is_(True))
        .all()
        if row and row[0]
    ]

    used_minutes = 0
    if numbers:
        calls = (
            db.query(Call)
            .filter(Call.ai_phone_number.in_(numbers))
            .filter(
                or_(
                    and_(
                        Call.started_at.isnot(None),
                        Call.started_at >= cycle_start,
                        Call.started_at < cycle_end,
                    ),
                    and_(
                        Call.started_at.is_(None),
                        Call.created_at >= cycle_start,
                        Call.created_at < cycle_end,
                    ),
                )
            )
            .all()
        )
        used_minutes = sum(billable_minutes_from_seconds(_call_duration_seconds(call)) for call in calls)

    remaining_minutes = None
    if included_minutes is not None:
        remaining_minutes = max(0, included_minutes - used_minutes)

    return {
        "planId": subscription.plan_id,
        "status": subscription.status,
        "includedMinutes": included_minutes,
        "usedMinutes": used_minutes,
        "remainingMinutes": remaining_minutes,
        "isLimitedPlan": included_minutes is not None,
        "limitReached": bool(included_minutes is not None and remaining_minutes <= 0),
        "cycleStart": cycle_start.isoformat(),
        "cycleEnd": cycle_end.isoformat(),
        "cycleStartDate": cycle_start.date().isoformat(),
        "cycleEndDate": cycle_end.date().isoformat(),
        "subscriptionStart": anchor.isoformat(),
    }
