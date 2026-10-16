"""Server-side GBP quotes. Customer prices are twice provider costs."""
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from xml.etree import ElementTree

import requests

_cache = {}
_lock = threading.Lock()


class PricingError(ValueError):
    pass


def decimal_price(value, allow_zero=False):
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise PricingError("Provider pricing is unavailable") from None
    if not amount.is_finite() or amount < 0 or (amount == 0 and not allow_zero):
        raise PricingError("Provider pricing is unavailable")
    return amount


def pence(value):
    return int((decimal_price(value, True) * 100).to_integral_value(rounding=ROUND_CEILING))


def cached(key, fetch):
    key = (os.getenv("TWILIO_ACCOUNT_SID", ""), key)
    with _lock:
        entry = _cache.get(key)
        if entry and entry[0] > time.monotonic(): return entry[1]
    value = fetch()
    with _lock: _cache[key] = (time.monotonic() + 300, value)
    return value


def gbp_conversion(currency):
    currency = str(currency).upper()
    if currency == "GBP": return Decimal(1)
    def fetch():
        override = os.getenv(f"OUTREACH_{currency}_GBP_RATE", "").strip()
        if override: return decimal_price(override)
        response = requests.get("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", timeout=10)
        response.raise_for_status()
        root = ElementTree.fromstring(response.content)
        rates = {node.attrib["currency"]: decimal_price(node.attrib["rate"]) for node in root.iter() if "currency" in node.attrib}
        dates = [node.attrib["time"] for node in root.iter() if "time" in node.attrib]
        if not dates or datetime.strptime(dates[0], "%Y-%m-%d") < datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7):
            raise PricingError("Currency pricing is stale. Try again later.")
        if currency not in rates or "GBP" not in rates: raise PricingError("Currency conversion is unavailable")
        return rates["GBP"] / rates[currency]
    try: return cached(("fx", currency), fetch)
    except PricingError: raise
    except Exception: raise PricingError("Currency pricing is unavailable. No funds have been spent.") from None


def number_price(provider, number_type, admin=False):
    from services.tenant_telephony import monthly_prices
    prices, currency = monthly_prices(provider)
    if number_type not in prices: raise PricingError("Number pricing is unavailable")
    base = decimal_price(prices[number_type])
    rate = gbp_conversion(currency)
    amount = pence(base * rate * (1 if admin else 2))
    return {"monthly_price": str(Decimal(amount) / 100), "currency": "GBP", "amount_pence": amount,
        "provider_price": str(base), "provider_currency": currency, "fx_rate": str(rate),
        "multiplier": 1 if admin else 2}


def call_price(phone, caller):
    from services.outreach_service import twilio_client
    def fetch():
        item = twilio_client().pricing.v2.voice.numbers(phone).fetch(origination_number=caller)
        prices = item.outbound_call_prices or []
        applicable = [p for p in prices if "ALL" in p.get("origination_prefixes", []) or any(caller.lstrip('+').startswith(prefix.lstrip('+')) for prefix in p.get("origination_prefixes", []))]
        if not applicable: raise PricingError("The destination has no supported call price")
        twilio = max(decimal_price(p.get("current_price")) for p in applicable) * gbp_conversion(item.price_unit)
        uv_currency = os.getenv("OUTREACH_ULTRAVOX_COST_CURRENCY", "USD")
        uv = decimal_price(os.getenv("OUTREACH_ULTRAVOX_COST_PER_MINUTE", "0.05"), True) * gbp_conversion(uv_currency)
        mode = os.getenv("OUTREACH_CALL_MARKUP_MODE", "combined")
        if mode not in {"combined", "twilio_only"}: raise PricingError("Call pricing needs administrator configuration")
        total = 2 * (twilio + uv) if mode == "combined" else 2 * twilio
        return {"rate_gbp": str(total), "twilio_gbp": str(twilio), "ultravox_gbp": str(uv),
            "markup_mode": mode, "multiplier": 2, "currency": "GBP", "billing_unit": "started_minute"}
    try: return cached(("call", phone, caller, os.getenv("OUTREACH_CALL_MARKUP_MODE", "combined")), fetch)
    except PricingError: raise
    except Exception: raise PricingError("Call pricing could not be verified. Try again before dialling.") from None
