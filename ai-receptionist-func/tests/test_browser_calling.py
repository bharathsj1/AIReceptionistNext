"""Browser call authorization, provider routing, callback replay and wallet boundaries."""
import importlib.util
import json
import os
import types
import unittest
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode
from uuid import uuid4
from unittest.mock import Mock, patch

import azure.functions as func
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from twilio.request_validator import RequestValidator

from endpoint_imports import function_app_module
from services import browser_calling as browser, manual_outreach as manual, outreach_service as calls
from services import outreach_billing as billing, outreach_pricing as pricing
from services.outreach_history import call_payload
from shared.db import Base, Client, PhoneNumber, OutreachBillingSetting, OutreachBrowserCall, OutreachCallCharge, OutreachWallet, OutreachCampaign
from test_outreach import SETTINGS, ACTOR
REAL_CALL_PRICE = pricing.call_price

fake = types.ModuleType("function_app"); fake.app = func.FunctionApp()
spec = importlib.util.spec_from_file_location("browser_test_endpoints", Path(__file__).resolve().parents[1] / "browser_call_endpoints.py")
api = importlib.util.module_from_spec(spec)
with function_app_module(fake): spec.loader.exec_module(api)

CALLER, DEST = "+442079460000", "+442079460018"
PARENT, CHILD = "CA" + "2" * 32, "CA" + "3" * 32
NORMAL_PRICE = {"rate_gbp": "0.046", "twilio_gbp": "0.02", "browser_gbp": "0.003", "ultravox_gbp": "0", "call_type": "normal"}


class BrowserCallingTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {**SETTINGS, "STRIPE_SECRET_KEY": "sk_live_unit", "OUTREACH_USD_GBP_RATE": "0.75"})
        env.start(); self.addCleanup(env.stop)
        self.engine = create_engine("sqlite:///:memory:"); Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine); self.db = self.Session()
        self.addCleanup(self.engine.dispose); self.addCleanup(self.db.close)
        self.db.add_all([Client(id=1, email=ACTOR.email, website_url="https://example.com"), Client(id=2, email="other@example.com", website_url="https://example.com"),
            PhoneNumber(client_id=1, twilio_phone_number=CALLER, twilio_sid="PN" + "1" * 32, is_active=True)])
        config = {"account_sid": SETTINGS["TWILIO_ACCOUNT_SID"], "api_key": "SK" + "4" * 32, "api_secret": "test-existing-secret-value-32-bytes", "app_sid": "AP" + "5" * 32}
        self.db.add(OutreachBillingSetting(id="twilio_browser_voice", status="configured", encrypted_value=billing.encryption().encrypt(json.dumps(config).encode()).decode()))
        self.db.commit()
        billing.credit_wallet(self.db, 1, 1000, "funds")
        self.provider = Mock()
        self.stub(calls, "twilio_client", return_value=self.provider)
        self.price = self.stub(pricing, "call_price", return_value=NORMAL_PRICE)
        self.http = self.stub(calls.requests, "post")
        self.stub("services.outreach_payments", "number_entitled", return_value=True)

    def stub(self, obj, attribute, **kwargs):
        patcher = patch(obj + "." + attribute, **kwargs) if isinstance(obj, str) else patch.object(obj, attribute, **kwargs)
        result = patcher.start(); self.addCleanup(patcher.stop); return result

    def body(self, **updates):
        quote = billing.create_call_quote(self.db, ACTOR, DEST, CALLER, "normal")
        return {"request_id": str(uuid4()), "phone": DEST, "restaurant_name": "Test restaurant", "call_type": "normal", "caller_id": CALLER, "quote_id": quote["id"], **updates}

    def start(self, body=None):
        return manual.start_manual_call(self.db, 1, body or self.body(), actor=ACTOR)

    def values(self, lead):
        return {"AccountSid": SETTINGS["TWILIO_ACCOUNT_SID"], "CallSid": PARENT, "From": "client:" + browser.identity(lead.id), "LeadId": lead.id}

    def test_normal_call_needs_no_ai_configuration_or_pitch_and_never_calls_ultravox(self):
        with patch.dict(os.environ, {"ULTRAVOX_API_KEY": "", "OUTREACH_TOOL_SECRET": "", "SMTP_HOST": "", "SMTP_PASSWORD": ""}):
            campaign, lead, _ = self.start()
        self.assertEqual(lead.status, "preparing")
        self.assertIsNone(lead.ultravox_call_id)
        self.assertEqual(campaign.benefits, "")
        self.assertEqual(call_payload(lead, campaign)["call_type"], "normal")
        self.assertEqual(call_payload(lead, campaign)["transcript_status"], "not_applicable")
        self.http.assert_not_called(); self.provider.calls.create.assert_not_called()
        self.assertIsNotNone(browser.connection_payload(self.db, ACTOR, lead))

    def test_twiml_uses_saved_destination_ignores_client_numbers_and_consumes_attempt_once(self):
        _, lead, _ = self.start()
        xml = browser.voice_twiml(self.db, {**self.values(lead), "To": "+14165550123"})
        self.assertIn(DEST, xml); self.assertNotIn("+14165550123", xml)
        self.assertIn("<Dial", xml); self.assertNotIn("Stream", xml)
        self.provider.calls(PARENT).update.assert_called_once_with(time_limit=600)
        with self.assertRaises(ValueError): browser.voice_twiml(self.db, self.values(lead))
        self.provider.calls(PARENT).update.assert_called_once()

    def test_wrong_identity_cannot_dial_or_retrieve_other_initiators_token(self):
        _, lead, _ = self.start()
        with self.assertRaises(ValueError): browser.voice_twiml(self.db, {**self.values(lead), "From": "client:other"})
        with self.assertRaises(billing.BillingError): browser.connection_payload(self.db, replace(ACTOR, email="other@example.com"), lead)
        self.provider.calls.assert_not_called()

    def test_replay_preserves_attempt_and_mode_cannot_be_changed(self):
        body = self.body(); _, lead, _ = self.start(body)
        self.assertFalse(self.start(body)[2])
        with self.assertRaises(manual.ManualCallConflict): self.start({**body, "call_type": "ai", "benefits": "AI pitch", "notification_email": ACTOR.email})
        self.assertEqual(self.db.query(OutreachBrowserCall).count(), 1)
        self.http.assert_not_called()

    def test_ai_quote_cannot_authorize_normal_call(self):
        body = self.body()
        from shared.db import OutreachCallQuote
        quote = self.db.get(OutreachCallQuote, body["quote_id"])
        quote.details = {**quote.details, "call_type": "ai"}; self.db.commit()
        with self.assertRaises(billing.BillingError): self.start(body)
        self.db.rollback()
        self.provider.calls.assert_not_called()

    def test_both_legs_settle_exactly_once_using_their_own_started_minutes(self):
        _, lead, _ = self.start()
        browser.voice_twiml(self.db, self.values(lead))
        calls.apply_call_status(self.db, lead, CHILD, "completed", duration=65)
        self.assertEqual(self.db.get(OutreachCallCharge, lead.id).status, "reserved")
        values = {"CallSid": PARENT, "CallStatus": "completed", "CallDuration": "130"}
        browser.parent_status(self.db, values); browser.parent_status(self.db, values)
        row = self.db.get(OutreachCallCharge, lead.id)
        self.assertEqual(row.charged_pence, 10)
        self.assertEqual(row.duration_seconds, 65)
        self.assertEqual(self.db.get(OutreachWallet, 1).balance_pence, 990)
        self.assertEqual(self.db.get(OutreachWallet, 1).reserved_pence, 0)

    def test_unused_microphone_session_expires_without_dialling_or_spending(self):
        campaign, lead, _ = self.start()
        row = self.db.get(OutreachBrowserCall, lead.id)
        browser.reconcile(self.db, row, now=row.expires_at + timedelta(seconds=1))
        browser.reconcile(self.db, row)
        self.assertEqual(lead.status, "canceled")
        self.assertEqual(self.db.get(OutreachWallet, 1).balance_pence, 1000)
        self.assertEqual(self.db.get(OutreachWallet, 1).reserved_pence, 0)
        self.provider.calls.assert_not_called(); self.http.assert_not_called()

    def test_worker_never_launches_ai_for_pending_normal_call(self):
        campaign, _, _ = self.start()
        with patch.object(calls, "launch_call") as launch:
            calls.process_campaign(self.db, campaign, datetime.utcnow())
        launch.assert_not_called(); self.http.assert_not_called()

    def test_insufficient_credits_and_invalid_modes_cannot_start_browser_call(self):
        self.db.get(OutreachWallet, 1).balance_pence = 0; self.db.commit()
        with self.assertRaises(billing.BillingError): self.start()
        self.db.rollback()
        with self.assertRaises(ValueError): self.start({**self.body(), "call_type": "unknown"})
        self.provider.calls.assert_not_called()

    def test_stop_is_tenant_scoped_and_releases_only_unused_session(self):
        _, lead, _ = self.start()
        with self.assertRaises(billing.BillingError): browser.stop(self.db, replace(ACTOR, client_id=2), lead.id)
        browser.stop(self.db, ACTOR, lead.id)
        self.assertEqual(self.db.get(OutreachCallCharge, lead.id).charged_pence, 0)

    def test_signed_webhook_rejects_missing_signature_wrong_account_and_duplicate_fields(self):
        _, lead, _ = self.start()
        values = self.values(lead)
        for update, signed, expected in [({}, False, 403), ({"AccountSid": "AC" + "9" * 32}, True, 403), ({}, True, 200)]:
            form = {**values, **update}; url = "https://example.com/api/outreach/browser/voice"
            signature = RequestValidator(SETTINGS["TWILIO_AUTH_TOKEN"]).compute_signature(url, form) if signed else ""
            req = func.HttpRequest("POST", url, params={}, headers={"X-Twilio-Signature": signature}, body=urlencode(form).encode())
            with patch.object(api, "SessionLocal", self.Session): result = api.browser_voice(req)
            self.assertEqual(result.status_code, expected)
        req = func.HttpRequest("POST", url, params={}, body=b"CallSid=a&CallSid=b")
        self.assertEqual(api.browser_voice(req).status_code, 400)

    def test_normal_price_excludes_ultravox_and_includes_browser_leg(self):
        self.provider.pricing.v2.voice.numbers.return_value.fetch.return_value = types.SimpleNamespace(price_unit="GBP", outbound_call_prices=[{"origination_prefixes": ["ALL"], "current_price": "0.02"}])
        pricing._cache.clear()
        result = REAL_CALL_PRICE(DEST, CALLER, "normal")
        self.assertEqual(result["ultravox_gbp"], "0")
        self.assertEqual(result["rate_gbp"], "0.04600")

    def test_token_is_short_lived_outgoing_only_and_bound_to_this_attempt(self):
        import jwt
        _, lead, _ = self.start()
        token = browser.connection_payload(self.db, ACTOR, lead)["token"]
        decoded = jwt.decode(token, "test-existing-secret-value-32-bytes", algorithms=["HS256"], options={"verify_aud": False})
        self.assertEqual(decoded["grants"]["identity"], browser.identity(lead.id))
        self.assertFalse(decoded["grants"]["voice"].get("incoming", {}).get("allow", False))
        self.assertLessEqual(decoded["exp"] - decoded["nbf"], 120)
        with self.assertRaises(billing.BillingError): browser.connection_payload(self.db, replace(ACTOR, client_id=2), lead)

    def test_budget_limit_failure_never_returns_destination_dial(self):
        _, lead, _ = self.start()
        self.provider.calls(PARENT).update.side_effect = RuntimeError("private provider detail")
        with self.assertRaisesRegex(ValueError, "no destination was dialled"):
            browser.voice_twiml(self.db, self.values(lead))
        self.assertEqual(self.db.get(OutreachBrowserCall, lead.id).child_duration, 0)
        self.assertEqual(self.db.get(OutreachCallCharge, lead.id).status, "reserved")

    def test_browser_setup_is_admin_only_and_reuses_existing_key_in_encrypted_storage(self):
        self.db.delete(self.db.get(OutreachBillingSetting, "twilio_browser_voice")); self.db.commit()
        body = {"api_key": "SK" + "4" * 32, "api_secret": "existing-provider-secret-32-characters"}
        with self.assertRaises(billing.BillingError): browser.configure(self.db, ACTOR, body)
        self.provider.applications.list.return_value = []
        application = self.provider.applications.create.return_value
        application.sid, application.voice_url, application.status_callback = "AP" + "5" * 32, "https://example.com/api/outreach/browser/voice", "https://example.com/api/outreach/browser/status"
        with patch.object(browser, "Client") as client:
            result = browser.configure(self.db, replace(ACTOR, email=billing.PLATFORM_ADMIN_EMAIL), body)
            client.return_value.applications.list.assert_called_once_with(limit=1)
        self.assertEqual(result, {"ready": True})
        self.assertNotIn(body["api_secret"], self.db.get(OutreachBillingSetting, "twilio_browser_voice").encrypted_value)
        self.assertEqual(browser.settings(self.db)["api_key"], body["api_key"])
        self.provider.applications.create.assert_called_once()

    def test_parent_reconciliation_recovers_missing_child_and_parent_callbacks(self):
        campaign, lead, _ = self.start()
        browser.voice_twiml(self.db, self.values(lead))
        self.provider.calls(PARENT).fetch.return_value = types.SimpleNamespace(from_="client:" + browser.identity(lead.id), status="completed", duration="130")
        self.provider.calls.list.return_value = [types.SimpleNamespace(sid=CHILD, to=DEST, from_=CALLER, status="completed", duration="65")]
        browser.reconcile(self.db, self.db.get(OutreachBrowserCall, lead.id))
        self.assertEqual(lead.status, "completed")
        self.assertEqual(campaign.status, "completed")
        self.assertEqual(self.db.get(OutreachCallCharge, lead.id).charged_pence, 10)
