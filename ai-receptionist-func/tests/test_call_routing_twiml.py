import os
import unittest

os.environ.setdefault("UNIT_TESTING", "1")

from call_routing_endpoints import _build_ai_callback_twiml, _build_dial_twiml, _build_voicemail_twiml


class CallRoutingTwiMLTests(unittest.TestCase):
    def test_dial_twiml_contains_whisper_and_answer_on_bridge(self):
        twiml = _build_dial_twiml(
            parent_call_sid="CA123",
            targets=[{"to": "+447700900123", "label": "Primary", "priority": 1}],
            timeout_seconds=20,
            summary="Caller asked for support handoff",
            action_url="https://example.com/api/twilio/voice/forward-next",
        )
        self.assertIn("<Dial", twiml)
        self.assertIn('answerOnBridge="true"', twiml)
        self.assertIn("<Number", twiml)
        self.assertIn("twilio/voice/whisper", twiml)
        self.assertIn("+447700900123", twiml)

    def test_voicemail_twiml_contains_record(self):
        twiml = _build_voicemail_twiml()
        self.assertIn("<Record", twiml)
        self.assertIn("maxLength", twiml)

    def test_ai_callback_twiml_contains_gather(self):
        twiml = _build_ai_callback_twiml()
        self.assertIn("<Gather", twiml)
        self.assertIn("callback-capture", twiml)


if __name__ == "__main__":
    unittest.main()
