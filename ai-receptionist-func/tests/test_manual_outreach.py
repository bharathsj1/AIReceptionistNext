import json
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch
from uuid import uuid4

import azure.functions as func
import requests
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from services import manual_outreach as manual
from services import outreach_service as outreach
from shared.db import Base, PhoneNumber, Client, OutreachCampaign, OutreachLead, OutreachSuppression, OutreachCallEvent
from test_outreach import ACTOR, SETTINGS, SID, load_endpoints

endpoints = load_endpoints()
NOW = datetime(2026, 10, 16, 11, tzinfo=timezone.utc)


class ManualOutreachTests(unittest.TestCase):
    def setUp(self):
        agent = patch("services.outreach_agents.sync_agent", return_value="00000000-0000-4000-8000-000000000001")
        agent.start(); self.addCleanup(agent.stop)
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
        self.body = {"request_id": str(uuid4()), "phone": "020 7946 0018", "restaurant_name": "The Willow Kitchen",
            "benefits": "Confirmed company benefits.", "caller_id": "+442079460000",
            "notification_email": "team@example.com"}
        uv = Mock()
        uv.json.return_value = {"callId": "uv-manual-call", "joinUrl": "wss://api.ultravox.ai/join/test"}
        self.client = Mock()
        self.client.calls.create.return_value.sid = SID
        self.provider_patch = patch.object(outreach, "twilio_client", return_value=self.client)
        self.post_patch = patch.object(outreach.requests, "post", return_value=uv)
        self.provider_patch.start()
        self.post = self.post_patch.start()

    def tearDown(self):
        self.post_patch.stop()
        self.provider_patch.stop()
        self.db.close()
        self.engine.dispose()
        self.environment.stop()

    def start(self, **updates):
        return manual.start_manual_call(self.db, 1, {**self.body, **updates}, now=NOW)

    def request(self, method="POST", body=None):
        return func.HttpRequest(method, "https://example.com/api/outreach/manual-calls", params={},
            body=json.dumps(self.body if body is None else body).encode())

    def test_manual_entry_calls_only_the_entered_number_and_saves_history(self):
        campaign, lead, created = self.start()
        self.assertTrue(created)
        self.assertEqual(lead.phone, "+442079460018")
        self.assertEqual(lead.status, "queued-provider")
        self.assertEqual(lead.twilio_call_sid, SID)
        self.assertEqual(lead.ultravox_call_id, "uv-manual-call")
        self.assertIsNotNone(lead.started_at)
        self.assertTrue(campaign.name.startswith("Manual call ·"))
        self.assertEqual((campaign.start_hour, campaign.end_hour), (0, 24))
        self.assertEqual(self.db.query(OutreachLead).count(), 1)
        self.assertEqual(self.client.calls.create.call_args.kwargs["to"], lead.phone)
        self.assertIn("Confirmed company benefits.", self.post.call_args.kwargs["json"]["templateContext"]["outreach_context"])
        events = self.db.query(OutreachCallEvent).filter_by(lead_id=lead.id).all()
        self.assertIn("manual_requested", [event.event for event in events])

    def test_same_request_survives_session_restart_without_redial(self):
        campaign, lead, _ = self.start()
        original_ids = campaign.id, lead.id
        self.db.close()
        self.db = self.Session()
        with patch.object(outreach, "configuration_errors", return_value=["Provider unavailable"]):
            campaign, lead, created = self.start()
        self.assertFalse(created)
        self.assertEqual((campaign.id, lead.id), original_ids)
        self.assertEqual(self.post.call_count, 1)
        self.assertEqual(self.client.calls.create.call_count, 1)

    def test_agent_prompt_call_has_a_snapshot_without_stale_website_or_pitch_overrides(self):
        body = {**self.body, "use_agent_prompt": True, "agent_prompt_version": "current-version", "benefits": "Obsolete website pitch"}
        with patch("services.outreach_agents.read_prompt", return_value={"prompt": "Current Ultravox script", "version": "current-version"}) as read:
            campaign, lead, created = manual.start_manual_call(self.db, 1, body, actor=ACTOR)
            self.assertTrue(created)
            self.assertEqual(campaign.benefits, "Current Ultravox script")
            self.assertEqual(lead.contact["prompt_source"], "agent")
            context = self.post.call_args.kwargs["json"]["templateContext"]["outreach_context"]
            self.assertNotIn("Obsolete website pitch", context)
            self.assertNotIn("Current Ultravox script", context)
            self.assertIn("save_outreach_result", context)
            self.assertIn("The Willow Kitchen", context)
            self.assertIn("saved Ultravox agent prompt", context)
            self.assertFalse(manual.start_manual_call(self.db, 1, body, actor=ACTOR)[2])
            read.assert_called_once()
        self.client.calls.create.assert_called_once()

    def test_changed_agent_prompt_blocks_before_a_call_or_wallet_reservation(self):
        body = {**self.body, "use_agent_prompt": True, "agent_prompt_version": "older-version"}
        with patch("services.outreach_agents.read_prompt", return_value={"prompt": "Latest script", "version": "new-version"}), \
                patch("services.outreach_billing.reserve_call") as reserve:
            with self.assertRaisesRegex(manual.ManualCallConflict, "changed in Ultravox"):
                manual.start_manual_call(self.db, 1, body, actor=ACTOR)
            reserve.assert_not_called()
        self.client.calls.create.assert_not_called(); self.post.assert_not_called()
        self.assertEqual(self.db.query(OutreachCampaign).count(), 0)

    def test_manual_api_defaults_recipient_to_signed_in_manager(self):
        from dataclasses import replace
        actor = replace(ACTOR, email="manager@example.com", scope="client_user", role="manager", client_user_id="7")
        start = manual.start_manual_call
        with patch.object(endpoints, "actor_for", return_value=actor), patch.object(endpoints, "SessionLocal", self.Session), \
             patch.object(endpoints, "start_manual_call", side_effect=lambda db, client_id, body, **kwargs: start(db, client_id, body, now=NOW, **kwargs)):
            result = endpoints.outreach_manual_call(self.request(body={**self.body, "notification_email": ""}))
        self.assertEqual(result.status_code, 201)
        campaign = self.db.get(OutreachCampaign, json.loads(result.get_body())["campaign_id"])
        self.assertEqual(campaign.notification_email, "manager@example.com")

    def test_reusing_request_for_a_different_number_is_rejected(self):
        self.start()
        with self.assertRaises(manual.ManualCallConflict):
            self.start(phone="02079460019")
        self.assertEqual(self.client.calls.create.call_count, 1)

    def test_bad_inputs_never_contact_providers(self):
        for updates in ({"request_id": "bad"}, {"phone": "+14165550123"}, {"phone": "09012345678"},
                        {"restaurant_name": ""}, {"restaurant_name": "x" * 151}, {"benefits": ""},
                        {"notification_email": "bad"}, {"caller_id": "+442079460099"}):
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                self.start(**updates)
        self.assertEqual(self.db.query(OutreachLead).count(), 0)
        self.post.assert_not_called()

    def test_caller_id_cannot_be_borrowed_from_another_tenant(self):
        with self.assertRaises(ValueError):
            manual.start_manual_call(self.db, 2, self.body, now=NOW)
        self.post.assert_not_called()

    def test_opted_out_number_is_not_dialled(self):
        self.db.add(OutreachSuppression(client_id=1, phone="+442079460018"))
        self.db.commit()
        with self.assertRaisesRegex(manual.ManualCallConflict, "opted out"):
            self.start()
        self.post.assert_not_called()

    def test_missing_configuration_does_not_create_or_launch_call(self):
        with patch.object(outreach, "configuration_errors", return_value=["Configure provider"]):
            with self.assertRaises(manual.ManualCallConflict):
                self.start()
        self.assertEqual(self.db.query(OutreachCampaign).count(), 0)
        self.post.assert_not_called()

    def test_manual_calls_allow_evenings_weekends_and_winter_hours(self):
        times = (datetime(2026, 10, 16, 22, tzinfo=timezone.utc),
                 datetime(2026, 10, 17, 11, tzinfo=timezone.utc),
                 datetime(2026, 10, 18, 0, tzinfo=timezone.utc),
                 datetime(2026, 12, 6, 1, tzinfo=timezone.utc))
        for index, now in enumerate(times):
            with self.subTest(now=now):
                self.post.return_value.json.return_value = {"callId": f"uv-manual-{index}", "joinUrl": "wss://api.ultravox.ai/join/test"}
                self.client.calls.create.return_value.sid = "CA" + str(index + 2).zfill(32)
                _, lead, created = manual.start_manual_call(self.db, 1,
                    {**self.body, "request_id": str(uuid4()), "phone": f"020794600{18 + index}"}, now=now)
                self.assertTrue(created)
                self.assertEqual(lead.status, "queued-provider")
        self.assertEqual(self.client.calls.create.call_count, len(times))

    def test_new_request_cannot_redial_active_or_uncertain_call(self):
        _, lead, _ = self.start()
        for status in ("ringing", "in-progress", "needs_review"):
            lead.status = status
            self.db.commit()
            with self.subTest(status=status), self.assertRaises(manual.ManualCallConflict):
                self.start(request_id=str(uuid4()))
        self.assertEqual(self.client.calls.create.call_count, 1)

    def test_provider_timeout_is_saved_for_review_and_replay_does_not_retry(self):
        self.post.side_effect = requests.Timeout()
        with self.assertLogs(outreach.logger, level="ERROR"):
            _, lead, _ = self.start()
        self.assertEqual(lead.status, "needs_review")
        _, replay, created = self.start()
        self.assertFalse(created)
        self.assertEqual(replay.id, lead.id)
        self.assertEqual(self.post.call_count, 1)
        self.client.calls.create.assert_not_called()

    def test_existing_campaign_contacts_are_not_started(self):
        existing = outreach.create_campaign(self.db, 1, {"name": "Existing draft", "benefits": "Existing pitch",
            "notification_email": "team@example.com", "caller_id": self.body["caller_id"],
            "csv_text": "phone,restaurant_name,automated_call_consent,consent_evidence\n02079460019,Other,yes,evidence\n"})[0]
        self.start()
        self.db.refresh(existing)
        self.assertEqual(existing.status, "draft")
        self.assertEqual(self.db.query(OutreachLead).filter_by(campaign_id=existing.id).one().status, "queued")
        self.assertEqual(self.client.calls.create.call_count, 1)

    def test_api_requires_session_and_options_never_dials(self):
        self.assertEqual(endpoints.outreach_manual_call(self.request()).status_code, 401)
        self.assertEqual(endpoints.outreach_manual_call(self.request("OPTIONS")).status_code, 200)
        self.post.assert_not_called()

    def test_api_returns_same_record_on_replay_and_visible_in_history(self):
        start = manual.start_manual_call
        with patch.object(endpoints, "actor_for", return_value=ACTOR), patch.object(endpoints, "SessionLocal", self.Session), \
             patch.object(endpoints, "start_manual_call", side_effect=lambda db, client_id, body, **kwargs: start(db, client_id, body, now=NOW, **kwargs)):
            first = endpoints.outreach_manual_call(self.request())
            second = endpoints.outreach_manual_call(self.request())
            self.assertEqual((first.status_code, second.status_code), (201, 200))
            call_id = json.loads(first.get_body())["call"]["id"]
            self.assertEqual(json.loads(second.get_body())["call"]["id"], call_id)
            self.assertEqual(first.headers["Cache-Control"], "no-store")
            history = json.loads(endpoints.outreach_calls(func.HttpRequest("GET", "https://example.com/api/outreach/calls", params={}, body=b"")).get_body())
            self.assertEqual(history["items"][0]["id"], call_id)
            self.assertEqual(history["total"], 1)
        self.assertEqual(self.client.calls.create.call_count, 1)

    def test_api_returns_validation_and_conflict_errors(self):
        with patch.object(endpoints, "actor_for", return_value=ACTOR), patch.object(endpoints, "SessionLocal", self.Session):
            self.assertEqual(endpoints.outreach_manual_call(self.request(body={**self.body, "phone": "bad"})).status_code, 400)
            with patch.object(outreach, "configuration_errors", return_value=["Unavailable"]):
                self.assertEqual(endpoints.outreach_manual_call(self.request()).status_code, 409)
        self.post.assert_not_called()
