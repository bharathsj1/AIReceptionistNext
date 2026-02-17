import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from services.call_routing_rules import match_rule
from services.call_routing_store import normalize_e164


class CallRoutingRulesTests(unittest.TestCase):
    def test_rule_priority_matching(self):
        rules = [
            {
                "name": "Fallback",
                "days": ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
                "timeRanges": [{"start": "00:00", "end": "23:59"}],
                "action": {"type": "FORWARD"},
                "priority": 50,
            },
            {
                "name": "Business hours",
                "days": ["MON", "TUE", "WED", "THU", "FRI"],
                "timeRanges": [{"start": "09:00", "end": "17:00"}],
                "action": {"type": "ULTRAVOX"},
                "priority": 10,
            },
        ]
        local_dt = datetime(2026, 2, 17, 10, 15, tzinfo=ZoneInfo("Europe/London"))
        matched = match_rule(local_dt, rules)
        self.assertIsNotNone(matched)
        self.assertEqual(matched["name"], "Business hours")

    def test_timezone_and_dst_matching(self):
        rules = [
            {
                "name": "Open",
                "days": ["SUN"],
                "timeRanges": [{"start": "09:00", "end": "12:00"}],
                "action": {"type": "ULTRAVOX"},
                "priority": 1,
            }
        ]
        # UK DST starts on March 29, 2026. 10:30 local should still match.
        local_dt = datetime(2026, 3, 29, 10, 30, tzinfo=ZoneInfo("Europe/London"))
        matched = match_rule(local_dt, rules)
        self.assertIsNotNone(matched)
        self.assertEqual(matched["name"], "Open")

    def test_phone_normalization_to_e164(self):
        self.assertEqual(normalize_e164("+44 7700 900123"), "+447700900123")
        self.assertEqual(normalize_e164("0044 7700 900123"), "+447700900123")
        self.assertEqual(normalize_e164("(202) 555-0148"), "+2025550148")


if __name__ == "__main__":
    unittest.main()
