from endpoint_imports import function_app_module
import importlib.util
import json
import os
import smtplib
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import urlencode

import azure.functions as func
import requests
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from twilio.request_validator import RequestValidator

from crm_shared import CRMActor, issue_auth_session_token
from services import outreach_service as service
from services import outreach_smtp as smtp_delivery
from shared.db import Base, PhoneNumber, Client, OutreachCampaign, OutreachLead, OutreachSuppression, OutreachCallEvent, OutreachEmailSetting

HEADER = "phone,restaurant_name,automated_call_consent,consent_evidence,city\n"
CSV = HEADER + '020 7946 0018,"The Bistro, London",yes,Owner opted in to VedoraEats automated calls on 2026-10-01,London\n'
SETTINGS = {"TWILIO_ACCOUNT_SID": "AC" + "1" * 32, "TWILIO_AUTH_TOKEN": "test-twilio-token",
            "ULTRAVOX_API_KEY": "test-ultravox", "OUTREACH_TOOL_SECRET": "test-tool-secret",
            "AUTH_SESSION_SECRET": "test-session-secret", "SMTP_HOST": "smtp.example.com",
            "SMTP_PORT": "587", "SMTP_USERNAME": "support@vedoraeats.com", "SMTP_PASSWORD": "test-smtp",
            "FROM_EMAIL": "team@example.com", "API_PUBLIC_BASE_URL": "https://example.com"}
ACTOR = CRMActor("1", 1, "owner@example.com", "admin", "primary_user", None, None)
SID = "CA" + "1" * 32


def load_endpoints():
    fake = types.ModuleType("function_app")
    fake.app = func.FunctionApp()
    spec = importlib.util.spec_from_file_location("outreach_test_endpoints", Path(__file__).resolve().parents[1] / "outreach_endpoints.py")
    module = importlib.util.module_from_spec(spec)
    with function_app_module(fake):
        spec.loader.exec_module(module)
    return module


endpoints = load_endpoints()


class OutreachTests(unittest.TestCase):
    def setUp(self):
        # These tests isolate call lifecycle behavior; billing guards have their own suite.
        for target, kwargs in [("services.outreach_payments.number_entitled", {"return_value": True}),
                ("services.outreach_billing.bind_campaign", {}),
                ("services.outreach_billing.reserve_call", {"return_value": type("Reservation", (), {"max_duration_seconds": 600})()})]:
            stub = patch(target, **kwargs); stub.start(); self.addCleanup(stub.stop)
        self.environment = patch.dict(os.environ, SETTINGS)
        self.environment.start()
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.db.add_all([Client(id=1, email="owner@example.com", website_url="https://example.com"),
                         Client(id=2, email="other@example.com", website_url="https://example.com"),
                         PhoneNumber(client_id=1, twilio_phone_number="+442079460000", twilio_sid="PN" + "1" * 32, is_active=True)])
        self.db.commit()
        self.body = {"name": "VedoraEats", "benefits": "Verified benefits supplied by the business.",
                     "notification_email": "partnerships@example.com", "caller_id": "+442079460000", "csv_text": CSV}

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.environment.stop()

    def campaign(self, csv_text=CSV):
        return service.create_campaign(self.db, 1, {**self.body, "csv_text": csv_text})[0]

    def lead(self, campaign, status="in-progress"):
        lead = self.db.query(OutreachLead).filter_by(campaign_id=campaign.id).first()
        lead.status, lead.started_at = status, datetime(2026, 10, 15, 11)
        self.db.commit()
        return lead

    def result(self, **overrides):
        return {"outcome": "interested", "summary": "Owner wants a partnership discussion.",
                "owner_name": "Alex", "owner_email": "alex@example.com", "follow_up_permission": True, **overrides}

    def request(self, method="GET", path="campaigns", body=None, route_params=None, headers=None):
        return func.HttpRequest(method, f"https://example.com/api/outreach/{path}", headers=headers or {}, params={},
            route_params=route_params or {}, body=json.dumps(body).encode() if body is not None else b"")

    def test_uk_normalization_and_restricted_destinations(self):
        for number in ["020 7946 0018", "+44 20 7946 0018", "00442079460018"]:
            self.assertEqual(service.normalize_uk_phone(number), "+442079460018")
        for number in ["+14165550123", "+449012345678", "07012345678", "+441481700000", "+447624123456", "07911123456", "02079460018 ext 2", "abc", "++442079460018"]:
            with self.subTest(number=number), self.assertRaises(ValueError):
                service.normalize_uk_phone(number)

    def test_csv_quotes_bom_duplicates_and_invalid_rows(self):
        rows, errors = service.parse_contacts("\ufeff" + CSV + "00442079460018,Duplicate,yes,evidence,London\n+14165550123,Overseas,yes,evidence,NY\n")
        self.assertEqual(rows[0]["restaurant_name"], "The Bistro, London")
        self.assertEqual(len(rows), 1)
        self.assertEqual([error["row"] for error in errors], [3, 4])

    def test_minimal_csv_without_consent_fields_can_be_called(self):
        campaign = self.campaign("phone,restaurant_name\n02079460018,Bistro\n")
        lead = self.db.query(OutreachLead).filter_by(campaign_id=campaign.id).one()
        self.assertEqual(lead.status, "queued")
        self.assertIsNone(lead.consent_evidence)
        campaign.status = "running"
        self.db.commit()
        with patch.object(service, "twilio_client") as provider, patch.object(service.requests, "post") as post:
            post.return_value.json.return_value = {"callId": "uv-test", "joinUrl": "wss://example.com/join"}
            provider.return_value.calls.create.return_value.sid = SID
            service.launch_call(self.db, campaign, lead)
            provider.return_value.calls.create.assert_called_once()
            post.assert_called_once()

    def test_malformed_headers_and_csv_limits(self):
        for csv_text in ["phone,name\n02079460018,Bistro", HEADER + '"unfinished', CSV + "x" * service.MAX_CSV_BYTES]:
            with self.subTest(csv=csv_text[:30]), self.assertRaises(ValueError):
                service.parse_contacts(csv_text)

    def test_caller_id_must_belong_to_tenant(self):
        with self.assertRaises(ValueError):
            service.create_campaign(self.db, 2, self.body)

    def test_invalid_notification_email_is_rejected(self):
        with self.assertRaises(ValueError):
            service.create_campaign(self.db, 1, {**self.body, "notification_email": "bad\nemail@example.com"})

    def test_legacy_calling_hours_no_longer_restrict_new_or_existing_campaigns(self):
        campaign, _ = service.create_campaign(self.db, 1, {**self.body, "start_hour": 20, "end_hour": 9})
        self.assertEqual((campaign.start_hour, campaign.end_hour), (0, 24))
        campaign.start_hour, campaign.end_hour = 10, 17
        self.db.commit()
        payload = service.campaign_payload(self.db, campaign)
        self.assertEqual((payload["start_hour"], payload["end_hour"]), (0, 24))

    def test_summary_email_uses_support_sender_and_saved_campaign_recipient(self):
        campaign = service.create_campaign(self.db, 1, {**self.body, "notification_email": "recipient@example.com"})[0]
        lead = self.lead(campaign)
        with patch.dict(os.environ, {"FROM_EMAIL": ""}), patch.object(smtp_delivery.smtplib, "SMTP") as smtp, patch.object(service.requests, "post") as post:
            smtp.return_value.send_message.return_value = {}
            service.send_lead_email(campaign, lead, db=self.db)
        message = smtp.return_value.send_message.call_args.args[0]
        self.assertEqual(message["From"], "support@vedoraeats.com")
        self.assertEqual(message["To"], "recipient@example.com")
        self.assertIn(lead.restaurant_name, message.get_content())
        post.assert_not_called()

    def test_config_exposes_email_defaults_for_signed_in_account_only(self):
        from dataclasses import replace
        actor = replace(ACTOR, email="manager@example.com", scope="client_user", client_user_id="7", role="manager")
        with patch.object(endpoints, "actor_for", return_value=actor), patch.object(endpoints, "SessionLocal", self.Session), patch.dict(os.environ, {"FROM_EMAIL": ""}):
            response = endpoints.outreach_config(self.request(path="config"))
        payload = json.loads(response.get_body())
        self.assertEqual(payload["from_email"], "support@vedoraeats.com")
        self.assertEqual(payload["notification_email"], "manager@example.com")

    def test_new_campaign_defaults_to_signed_in_user_not_account_owner(self):
        from dataclasses import replace
        actor = replace(ACTOR, email="manager@example.com", scope="client_user", client_user_id="7", role="manager")
        with patch.object(endpoints, "actor_for", return_value=actor), patch.object(endpoints, "SessionLocal", self.Session):
            response = endpoints.outreach_campaigns(self.request("POST", body={**self.body, "notification_email": ""}))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(json.loads(response.get_body())["campaign"]["notification_email"], "manager@example.com")

    def test_smtp_is_required_but_sendgrid_is_not(self):
        with patch.dict(os.environ, {"FROM_EMAIL": "", "SENDGRID_API_KEY": ""}):
            self.assertEqual(service.configuration_errors(self.db), [])
        with patch.object(smtp_delivery, "get_smtp_settings", return_value={}):
            self.assertEqual(service.configuration_errors(self.db), ["Configure SMTP in Calling setup → Email delivery settings"])
        with patch.dict(os.environ, {"FROM_EMAIL": "bad\nemail@example.com"}):
            self.assertIn("Configure a valid FROM_EMAIL", service.configuration_errors(self.db))

    def test_saved_smtp_supplies_readiness_and_summary_delivery_without_environment_credentials(self):
        settings = {"host": "smtppro.zoho.eu", "port": 465, "username": "support@vedoraeats.com",
                    "password": "private-smtp-password", "from_email": "support@vedoraeats.com", "use_ssl": True}
        self.db.add(OutreachEmailSetting(id="smtp", encrypted_value=smtp_delivery.cipher().encrypt(json.dumps(settings).encode()).decode()))
        self.db.commit()
        campaign = self.campaign()
        lead = self.lead(campaign, "completed")
        service.save_result(self.db, lead, self.result())
        with patch.object(smtp_delivery, "get_smtp_settings", return_value={}), patch.dict(os.environ, {"SENDGRID_API_KEY": ""}), patch.object(smtp_delivery.smtplib, "SMTP_SSL") as smtp:
            smtp.return_value.send_message.return_value = {}
            self.assertEqual(service.configuration_errors(self.db), [])
            service.process_notifications(self.db, datetime.utcnow())
            service.process_notifications(self.db, datetime.utcnow())
            smtp.assert_called_once()
            smtp.return_value.login.assert_called_once_with("support@vedoraeats.com", "private-smtp-password")
            message = smtp.return_value.send_message.call_args.args[0]
            self.assertEqual(message["From"], "support@vedoraeats.com")
            self.assertEqual(message["To"], campaign.notification_email)
            self.assertIn("Owner wants a partnership discussion.", message.get_content())
            self.assertEqual(lead.notification_status, "sent")
            self.assertIsNotNone(lead.notification_sent_at)

    def test_smtp_permanent_rejection_and_disconnect_are_not_automatically_retried(self):
        for exc, expected in [(smtplib.SMTPAuthenticationError(535, b"private-password"), "failed"),
                              (smtplib.SMTPRecipientsRefused({"owner@example.com": (550, b"private-password")}), "failed"),
                              (smtplib.SMTPServerDisconnected("private-password"), "needs_review")]:
            lead = self.lead(self.campaign(), "completed")
            service.save_result(self.db, lead, self.result())
            with patch.object(service, "send_lead_email", side_effect=exc) as send, self.assertLogs(service.logger, level="ERROR") as logs:
                service.process_notifications(self.db, datetime.utcnow())
                service.process_notifications(self.db, datetime.utcnow())
                send.assert_called_once()
            self.assertEqual(lead.notification_status, expected)
            self.assertIsNone(lead.notification_sent_at)
            self.assertNotIn("private-password", " ".join(logs.output))

    def test_smtp_temporary_rejections_stop_after_five_attempts(self):
        lead = self.lead(self.campaign(), "completed")
        service.save_result(self.db, lead, self.result())
        lead.notification_attempts = 4
        self.db.commit()
        with patch.object(service, "send_lead_email", side_effect=smtplib.SMTPDataError(451, b"Try later")), self.assertLogs(service.logger, level="ERROR"):
            service.process_notifications(self.db, datetime.utcnow())
        self.assertEqual(lead.notification_attempts, 5)
        self.assertEqual(lead.notification_status, "failed")

    def test_consent_and_suppression_rechecked_at_launch(self):
        campaign = self.campaign()
        lead = self.db.query(OutreachLead).filter_by(campaign_id=campaign.id).one()
        self.db.add(OutreachSuppression(client_id=1, phone=lead.phone))
        self.db.commit()
        with patch.object(service.requests, "post") as post:
            service.launch_call(self.db, campaign, lead)
            post.assert_not_called()

    def test_twilio_stream_call_payload_and_no_duplicate_launch(self):
        campaign = self.campaign()
        campaign.status = "running"
        self.db.commit()
        lead = self.db.query(OutreachLead).filter_by(campaign_id=campaign.id).one()
        uv = Mock()
        uv.json.return_value = {"callId": "uv-call", "joinUrl": "wss://api.ultravox.ai/join/test"}
        client = Mock()
        client.calls.create.return_value.sid = SID
        with patch.object(service.requests, "post", return_value=uv) as post, patch.object(service, "twilio_client", return_value=client):
            service.launch_call(self.db, campaign, lead)
            service.launch_call(self.db, campaign, lead)
            self.assertEqual(post.call_count, 1)
            self.assertEqual(client.calls.create.call_count, 1)
            args = client.calls.create.call_args.kwargs
            self.assertEqual(args["to"], "+442079460018")
            self.assertIn('<Connect><Stream url="wss://api.ultravox.ai/join/test"', args["twiml"])
            self.assertEqual(args["time_limit"], 600)
            payload = post.call_args.kwargs["json"]
            self.assertEqual(payload["firstSpeakerSettings"], {"user": {}})
            self.assertIn("AI assistant", payload["systemPrompt"])
            self.assertEqual(lead.status, "queued-provider")
            self.assertEqual(payload["retentionPolicy"], "retain")
            events = self.db.query(OutreachCallEvent).filter_by(lead_id=lead.id).order_by(OutreachCallEvent.id).all()
            self.assertEqual([event.event for event in events], ["preparing", "voice_session_created", "call_accepted"])

    def test_timeout_pauses_without_redial(self):
        campaign = self.campaign()
        campaign.status = "running"
        self.db.commit()
        lead = self.db.query(OutreachLead).filter_by(campaign_id=campaign.id).one()
        uv = Mock()
        uv.json.return_value = {"callId": "uv-call", "joinUrl": "wss://api.ultravox.ai/join/test"}
        client = Mock()
        client.calls.create.side_effect = requests.Timeout("Timed out")
        with patch.object(service.requests, "post", return_value=uv), patch.object(service, "twilio_client", return_value=client), self.assertLogs(service.logger, level="ERROR"):
            service.launch_call(self.db, campaign, lead)
        self.assertEqual(lead.status, "needs_review")
        self.assertEqual(campaign.status, "paused")
        with patch.object(service, "launch_call") as launch:
            service.process_campaign(self.db, campaign, datetime(2026, 10, 15, 12))
            launch.assert_not_called()

    def test_late_and_duplicate_callbacks_cannot_regress_terminal_status(self):
        lead = self.lead(self.campaign())
        service.apply_call_status(self.db, lead, SID, "ringing", 1)
        service.apply_call_status(self.db, lead, SID, "completed", 3)
        service.apply_call_status(self.db, lead, SID, "in-progress", 2)
        service.apply_call_status(self.db, lead, SID, "ringing", 4)
        self.assertEqual(lead.status, "completed")
        self.assertEqual(lead.callback_sequence, 3)
        self.assertIsNotNone(lead.ended_at)

    def test_another_call_sid_is_rejected(self):
        lead = self.lead(self.campaign())
        service.apply_call_status(self.db, lead, SID, "in-progress", 1)
        with self.assertRaises(ValueError):
            service.apply_call_status(self.db, lead, "CA" + "2" * 32, "completed", 3)

    def test_interested_owner_needs_explicit_followup_permission(self):
        lead = self.lead(self.campaign())
        service.save_result(self.db, lead, self.result(follow_up_permission=False))
        self.assertEqual(lead.notification_status, "none")
        service.save_result(self.db, lead, self.result())
        self.assertEqual(lead.notification_status, "pending")
        with self.assertRaises(ValueError):
            service.save_result(self.db, lead, self.result(follow_up_permission="true"))

    def test_optout_suppresses_all_campaigns_but_not_other_tenants(self):
        campaign = self.campaign()
        lead = self.lead(campaign)
        second = self.campaign()
        service.save_result(self.db, lead, self.result(outcome="do_not_call", follow_up_permission=False))
        service.save_result(self.db, lead, self.result(outcome="do_not_call", follow_up_permission=False))
        self.assertEqual(self.db.query(OutreachLead).filter_by(campaign_id=second.id).one().status, "skipped")
        self.assertEqual(self.db.query(OutreachSuppression).count(), 1)
        self.assertIsNone(self.db.get(OutreachSuppression, (2, lead.phone)))
        third = self.campaign()
        self.assertEqual(self.db.query(OutreachLead).filter_by(campaign_id=third.id).one().status, "skipped")
        service.save_result(self.db, lead, self.result())
        self.assertEqual(lead.result["outcome"], "do_not_call")

    def test_email_waits_for_call_end_and_retries_do_not_resend(self):
        campaign = self.campaign()
        lead = self.lead(campaign)
        service.save_result(self.db, lead, self.result())
        with patch.object(service, "send_lead_email") as send:
            service.process_notifications(self.db, datetime.utcnow())
            send.assert_not_called()
            service.apply_call_status(self.db, lead, SID, "completed", 3)
            service.process_notifications(self.db, datetime.utcnow())
            service.save_result(self.db, lead, self.result())
            service.process_notifications(self.db, datetime.utcnow())
            self.assertEqual(send.call_count, 1)
        self.assertEqual(lead.notification_status, "sent")

    def test_email_timeout_requires_review_and_never_claims_sent(self):
        lead = self.lead(self.campaign(), "completed")
        service.save_result(self.db, lead, self.result())
        with patch.object(service, "send_lead_email", side_effect=requests.Timeout), self.assertLogs(service.logger, level="ERROR"):
            service.process_notifications(self.db, datetime.utcnow())
        self.assertEqual(lead.notification_status, "needs_review")
        self.assertIsNone(lead.notification_sent_at)
        service.save_result(self.db, lead, self.result())
        self.assertEqual(lead.notification_status, "needs_review")

    def test_duplicate_tool_delivery_cannot_reset_email_in_flight(self):
        lead = self.lead(self.campaign(), "completed")
        service.save_result(self.db, lead, self.result())
        lead.notification_status = "sending"
        self.db.commit()
        service.save_result(self.db, lead, self.result(summary="Owner confirmed callback preference."))
        self.assertEqual(lead.notification_status, "sending")

    def test_email_rate_limit_uses_backoff(self):
        lead = self.lead(self.campaign(), "completed")
        service.save_result(self.db, lead, self.result())
        now = datetime.utcnow()
        with patch.object(service, "send_lead_email", side_effect=smtplib.SMTPDataError(451, b"Try later")) as send:
            service.process_notifications(self.db, now)
            service.process_notifications(self.db, now)
            self.assertEqual(send.call_count, 1)
        self.assertEqual(lead.notification_status, "retry")
        self.assertGreater(lead.notification_next_at, now)

    def test_worker_runs_evenings_and_weekends_but_keeps_one_active_call(self):
        for now in (datetime(2026, 10, 16, 22), datetime(2026, 10, 17, 11),
                    datetime(2026, 10, 18, 0), datetime(2026, 12, 6, 1)):
            with self.subTest(now=now):
                campaign = self.campaign(CSV + "02079460019,Second,yes,evidence,London\n")
                campaign.status, campaign.start_hour, campaign.end_hour = "running", 10, 17
                self.db.commit()
                with patch.object(service, "launch_call") as launch:
                    service.process_campaign(self.db, campaign, now)
                    self.assertEqual(launch.call_count, 1)
                    first = launch.call_args.args[2]
                    self.assertEqual(first.position, 0)
                    first.status, first.started_at = "ringing", now
                    self.db.commit()
                    service.process_campaign(self.db, campaign, now + timedelta(minutes=1))
                    self.assertEqual(launch.call_count, 1)

    def test_worker_recovers_stale_intent_without_redial(self):
        campaign = self.campaign()
        campaign.status = "running"
        lead = self.lead(campaign, "preparing")
        with patch.object(service, "launch_call") as launch:
            service.process_campaign(self.db, campaign, datetime(2026, 10, 15, 11, 10))
            launch.assert_not_called()
        self.assertEqual(lead.status, "needs_review")
        self.assertEqual(campaign.status, "paused")

    def test_api_requires_signed_session_not_email_claim(self):
        req = self.request(headers={"x-user-email": "owner@example.com"})
        self.assertEqual(endpoints.outreach_campaigns(req).status_code, 401)
        token, _ = issue_auth_session_token(email="owner@example.com", scope="primary_user", client_id=1)
        with patch("crm_shared.SessionLocal", self.Session):
            actor = endpoints.actor_for(self.request(headers={"Authorization": f"Bearer {token}"}))
            self.assertEqual(actor.client_id, 1)

    def test_api_hides_other_tenant_campaign(self):
        campaign = self.campaign()
        other = CRMActor("2", 2, "other@example.com", "admin", "primary_user", None, None)
        with patch.object(endpoints, "actor_for", return_value=other), patch.object(endpoints, "SessionLocal", self.Session):
            req = self.request(path=f"campaigns/{campaign.id}", route_params={"campaign_id": campaign.id})
            self.assertEqual(endpoints.outreach_campaign(req).status_code, 404)

    def test_api_webhook_signature_works_behind_proxy_and_rejects_forgery(self):
        lead = self.lead(self.campaign())
        form = {"AccountSid": SETTINGS["TWILIO_ACCOUNT_SID"], "CallSid": SID, "CallStatus": "completed", "SequenceNumber": "3",
                "To": lead.phone, "From": self.body["caller_id"]}
        path = f"/api/outreach/leads/{lead.id}/status"
        signature = RequestValidator(SETTINGS["TWILIO_AUTH_TOKEN"]).compute_signature("https://example.com" + path, form)
        req = func.HttpRequest("POST", "http://backend" + path, headers={"X-Twilio-Signature": signature}, params={},
                               route_params={"lead_id": lead.id}, body=urlencode(form).encode())
        with patch.object(endpoints, "SessionLocal", self.Session):
            self.assertEqual(endpoints.outreach_status(req).status_code, 200)
        self.db.refresh(lead)
        self.assertEqual(lead.status, "completed")
        req = func.HttpRequest("POST", "http://backend" + path, headers={"X-Twilio-Signature": "forged"}, params={},
                               route_params={"lead_id": lead.id}, body=urlencode(form).encode())
        self.assertEqual(endpoints.outreach_status(req).status_code, 403)

    def test_tool_token_is_scoped_to_contact(self):
        lead = self.lead(self.campaign())
        req = self.request("POST", path=f"leads/{lead.id}/result", body=self.result(), route_params={"lead_id": lead.id},
                           headers={"X-Outreach-Token": service.tool_token("other-lead")})
        self.assertEqual(endpoints.outreach_result(req).status_code, 403)
        req = self.request("POST", path=f"leads/{lead.id}/result", body=self.result(), route_params={"lead_id": lead.id},
                           headers={"X-Outreach-Token": service.tool_token(lead.id)})
        with patch.object(endpoints, "SessionLocal", self.Session):
            self.assertEqual(endpoints.outreach_result(req).status_code, 200)

    def test_start_is_blocked_by_missing_provider_config(self):
        campaign = self.campaign()
        with patch.object(endpoints, "actor_for", return_value=ACTOR), patch.object(endpoints, "SessionLocal", self.Session), patch.dict(os.environ, {"ULTRAVOX_API_KEY": ""}):
            req = self.request("POST", body={"action": "start"}, route_params={"campaign_id": campaign.id})
            self.assertEqual(endpoints.outreach_campaign(req).status_code, 409)

    def test_review_skips_without_redial_and_is_tenant_scoped(self):
        lead = self.lead(self.campaign(), "needs_review")
        with patch.object(endpoints, "actor_for", return_value=ACTOR), patch.object(endpoints, "SessionLocal", self.Session):
            req = self.request("POST", body={"confirmed_no_active_call": True}, route_params={"lead_id": lead.id})
            self.assertEqual(endpoints.outreach_review(req).status_code, 200)
        self.db.refresh(lead)
        self.assertEqual(lead.status, "canceled")


if __name__ == "__main__":
    unittest.main()
