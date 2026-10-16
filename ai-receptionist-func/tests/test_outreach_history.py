"""Conversation retention, transcript completeness and tenant isolation."""
import json
import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

import azure.functions as func
import requests
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from services import outreach_history as history
from services import outreach_service as service
from shared import db as database
from shared.db import Base, Client, CallerNumber, OutreachCallEvent, OutreachCampaign, OutreachConversation, OutreachLead
from test_outreach import ACTOR, CSV, SETTINGS, SID, endpoints


class OutreachHistoryTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, SETTINGS)
        self.environment.start()
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.db.add_all([Client(id=1, email="owner@example.com", website_url="https://example.com"),
                         Client(id=2, email="other@example.com", website_url="https://example.com"),
                         CallerNumber(client_id=1, phone_number="+442079460000", is_active=True)])
        self.db.commit()
        self.now = datetime(2026, 10, 16, 12)
        self.body = {"name": "Partnerships", "benefits": "Verified offer", "notification_email": "team@example.com",
                     "caller_id": "+442079460000", "csv_text": CSV}

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.environment.stop()

    def call(self, client_id=1, status="completed", started_at=None, **kwargs):
        campaign = service.create_campaign(self.db, 1, self.body)[0]
        campaign.client_id = client_id
        lead = self.db.query(OutreachLead).filter_by(campaign_id=campaign.id).one()
        lead.status, lead.started_at = status, started_at or self.now - timedelta(minutes=10)
        lead.ended_at = self.now - timedelta(minutes=5) if status in history.TERMINAL else None
        lead.ultravox_call_id = "uv-" + lead.id
        for key, value in kwargs.items():
            setattr(lead, key, value)
        self.db.commit()
        return lead, campaign

    def request(self, route_params=None, params=None, method="GET"):
        return func.HttpRequest(method, "https://example.com/api/outreach/calls", headers={},
            params=params or {}, route_params=route_params or {}, body=b"")

    def api(self, handler, *, actor=ACTOR, params=None, route_params=None):
        with patch.object(endpoints, "actor_for", return_value=actor), patch.object(endpoints, "SessionLocal", self.Session):
            result = handler(self.request(params=params, route_params=route_params))
        return result.status_code, json.loads(result.get_body())

    def messages(self):
        return [{"role": "MESSAGE_ROLE_USER", "text": "Hello, I am the owner.", "callStageId": "stage-1", "callStageMessageIndex": 0,
                 "wallClockTimespan": {"start": "0.25s", "end": "2s"}},
                {"role": "MESSAGE_ROLE_AGENT", "text": "May I explain our offer?", "callStageId": "stage-1", "callStageMessageIndex": 1,
                 "wallClockTimespan": {"start": "2.5s", "end": "4s"}}]

    def provider(self):
        return {"joined": "2026-10-16T11:50:00Z", "ended": "2026-10-16T11:55:00Z", "endReason": "hangup"}, history.normalize_messages(self.messages())

    def test_history_lists_all_campaigns_and_only_own_attempts(self):
        first, _ = self.call()
        second, _ = self.call(started_at=self.now - timedelta(minutes=3), status="no-answer")
        hidden, _ = self.call(client_id=2)
        service.create_campaign(self.db, 1, self.body)  # An uncalled contact is not a call.
        status, payload = self.api(endpoints.outreach_calls)
        self.assertEqual(status, 200)
        self.assertEqual(payload["total"], 2)
        self.assertEqual([call["id"] for call in payload["items"]], [second.id, first.id])
        self.assertNotIn(hidden.id, str(payload))
        self.assertEqual(payload["items"][0]["started_at"], "2026-10-16T11:57:00Z")
        self.assertNotIn("messages", str(payload))

    def test_history_pagination_filters_and_counts_are_consistent(self):
        lead, campaign = self.call(result={"outcome": "interested", "owner_name": "Alex", "owner_email": "alex@example.com"})
        self.call(status="no-answer")
        record = history.ensure_conversation(self.db, lead)
        record.message_count, record.status = 2, "ready"
        self.db.commit()
        status, payload = self.api(endpoints.outreach_calls, params={"campaign_id": campaign.id, "outcome": "interested", "q": "ALEX"})
        self.assertEqual(status, 200)
        self.assertEqual(payload["stats"], {"total": 1, "completed": 1, "interested": 1, "with_transcript": 1})
        status, payload = self.api(endpoints.outreach_calls, params={"page_size": "1", "page": "2"})
        self.assertEqual(payload["total"], 2)
        self.assertEqual(len(payload["items"]), 1)
        _, payload = self.api(endpoints.outreach_calls, params={"status": "no-answer", "outcome": "uncaptured"})
        self.assertEqual(payload["total"], 1)
        _, payload = self.api(endpoints.outreach_calls, params={"q": "%"})
        self.assertEqual(payload["total"], 0)

    def test_london_date_filter_uses_dst_and_inclusive_end_day(self):
        before, _ = self.call(started_at=datetime(2026, 7, 8, 22, 59))
        inside, _ = self.call(started_at=datetime(2026, 7, 8, 23, 1))
        after, _ = self.call(started_at=datetime(2026, 7, 9, 23, 0))
        _, payload = self.api(endpoints.outreach_calls, params={"from": "2026-07-09", "to": "2026-07-09"})
        self.assertEqual([item["id"] for item in payload["items"]], [inside.id])
        for params in [{"page": "0"}, {"page_size": "101"}, {"page": "x"}, {"from": "not-a-date"},
                       {"from": "2026-11-01", "to": "2026-10-01"}, {"status": "invented"}, {"outcome": "made-up"}]:
            with self.subTest(params=params):
                self.assertEqual(self.api(endpoints.outreach_calls, params=params)[0], 400)

    def test_conversation_requires_session_and_hides_other_tenant(self):
        lead, _ = self.call(client_id=2)
        with patch.object(endpoints, "sync_conversation") as provider:
            self.assertEqual(self.api(endpoints.outreach_conversation, actor=None, route_params={"lead_id": lead.id})[0], 401)
            self.assertEqual(self.api(endpoints.outreach_conversation, route_params={"lead_id": lead.id})[0], 404)
            provider.assert_not_called()
        self.assertEqual(self.api(endpoints.outreach_calls, actor=None)[0], 401)

    def test_normalization_keeps_spoken_turns_order_and_filters_tool_secrets(self):
        raw = self.messages()[::-1] + [{"role": "MESSAGE_ROLE_SYSTEM", "text": "Secret instructions"},
            {"role": "MESSAGE_ROLE_TOOL_RESULT", "text": "Private tool payload"},
            {"role": "MESSAGE_ROLE_AGENT", "text": "tool request", "toolName": "save_outreach_result"}]
        messages = history.normalize_messages(raw + self.messages())
        self.assertEqual(len(messages), 2)
        self.assertEqual([message["speaker"] for message in messages], ["contact", "ai"])
        self.assertEqual(messages[0]["offset_seconds"], 0.25)
        self.assertNotIn("Secret", str(messages))
        self.assertEqual(len(history.normalize_messages([{"role": "user", "text": "yes"}] * 2)), 2)

    def test_all_message_pages_and_stages_are_requested_without_following_next_hosts(self):
        responses = [Mock(status_code=200), Mock(status_code=200), Mock(status_code=200)]
        responses[0].json.return_value = self.provider()[0]
        responses[1].json.return_value = {"results": self.messages()[:1], "next": "https://untrusted.example/messages?cursor=page-two"}
        responses[2].json.return_value = {"results": self.messages()[1:], "next": None}
        with patch.object(history.requests, "get", side_effect=responses) as get:
            _, messages = history.fetch_provider_conversation("provider-call")
        self.assertEqual(len(messages), 2)
        self.assertTrue(all(call.args[0].startswith("https://api.ultravox.ai/api/calls/provider-call") for call in get.call_args_list))
        self.assertEqual(get.call_args_list[1].kwargs["params"]["mode"], "in_call")
        self.assertEqual(get.call_args_list[2].kwargs["params"]["cursor"], "page-two")
        self.assertFalse(get.call_args_list[2].kwargs["allow_redirects"])

    def test_repeated_cursor_is_an_error_instead_of_silent_truncation(self):
        detail = Mock(status_code=200); detail.json.return_value = self.provider()[0]
        page = Mock(status_code=200); page.json.return_value = {"results": self.messages(), "next": "?cursor=repeat"}
        with patch.object(history.requests, "get", side_effect=[detail, page, page]):
            with self.assertRaisesRegex(ValueError, "repeated"):
                history.fetch_provider_conversation("provider-call")

    def test_final_transcript_persists_and_survives_provider_outage_and_new_session(self):
        lead, _ = self.call()
        with patch.object(history, "fetch_provider_conversation", return_value=self.provider()):
            record = history.sync_conversation(self.db, lead, now=self.now)
        self.assertTrue(record.is_final)
        self.assertEqual(record.duration_seconds, 300)
        lead_id = lead.id
        self.db.close()
        self.db = self.Session()
        with patch.object(history, "fetch_provider_conversation") as fetch:
            record = history.sync_conversation(self.db, self.db.get(OutreachLead, lead_id), force=True, now=self.now + timedelta(hours=2))
            fetch.assert_not_called()
        self.assertEqual(record.messages[0]["text"], "Hello, I am the owner.")
        self.assertEqual(record.message_count, 2)

    def test_partial_and_transient_failure_keep_saved_text_and_are_retryable(self):
        lead, _ = self.call(status="in-progress")
        metadata, messages = self.provider(); metadata["ended"] = None
        with patch.object(history, "fetch_provider_conversation", return_value=(metadata, messages)):
            record = history.sync_conversation(self.db, lead, now=self.now)
        self.assertFalse(record.is_final)
        self.assertEqual(record.status, "partial")
        with self.assertLogs(history.logger, level="WARNING"), patch.object(history, "fetch_provider_conversation", side_effect=requests.Timeout()):
            record = history.sync_conversation(self.db, lead, force=True, now=self.now + timedelta(minutes=1))
        self.assertEqual(record.messages, messages)
        self.assertIn("preserved", record.error)
        self.assertIsNotNone(record.next_sync_at)
        with patch.object(history, "fetch_provider_conversation", return_value=self.provider()):
            record = history.sync_conversation(self.db, lead, force=True, now=self.now + timedelta(minutes=2))
        self.assertTrue(record.is_final)
        self.assertIsNone(record.error)

    def test_shortened_provider_response_does_not_overwrite_partial_transcript(self):
        lead, _ = self.call()
        record = history.ensure_conversation(self.db, lead)
        record.messages = self.provider()[1]; record.message_count = 2
        self.db.commit()
        with self.assertLogs(history.logger, level="WARNING"), patch.object(history, "fetch_provider_conversation", return_value=(self.provider()[0], [])):
            record = history.sync_conversation(self.db, lead, now=self.now)
        self.assertEqual(record.message_count, 2)
        self.assertFalse(record.is_final)
        self.assertIn("preserved", record.error)

    def test_no_answer_is_logged_without_inventing_transcript(self):
        lead, _ = self.call(status="no-answer", ultravox_call_id=None)
        with patch.object(history, "fetch_provider_conversation") as provider:
            status, payload = self.api(endpoints.outreach_conversation, route_params={"lead_id": lead.id})
            provider.assert_not_called()
        self.assertEqual(status, 200)
        self.assertEqual(payload["call"]["status"], "no-answer")
        self.assertEqual(payload["transcript"]["status"], "unavailable")
        self.assertEqual(payload["transcript"]["messages"], [])

    def test_provider_lag_does_not_finalize_empty_transcript_immediately(self):
        lead, _ = self.call()
        with patch.object(history, "fetch_provider_conversation", return_value=(self.provider()[0], [])):
            first = history.sync_conversation(self.db, lead, now=self.now)
            self.assertFalse(first.is_final)
            history.sync_conversation(self.db, lead, force=True, now=self.now + timedelta(minutes=1))
            record = history.sync_conversation(self.db, lead, force=True, now=self.now + timedelta(minutes=2))
        self.assertTrue(record.is_final)
        self.assertEqual(record.status, "empty")

    def test_background_worker_backfills_completed_campaigns_and_throttles_refresh(self):
        lead, campaign = self.call()
        campaign.status = "completed"; self.db.commit()
        with patch.object(history, "fetch_provider_conversation", return_value=self.provider()) as fetch, patch.object(history, "datetime", wraps=datetime) as clock:
            clock.utcnow.return_value = self.now
            history.sync_pending_conversations(self.db)
            self.assertEqual(fetch.call_count, 1)
        self.assertTrue(self.db.get(OutreachConversation, lead.id).is_final)
        other, _ = self.call(status="in-progress")
        details, messages = self.provider(); details["ended"] = None
        with patch.object(history, "fetch_provider_conversation", return_value=(details, messages)) as fetch:
            history.sync_conversation(self.db, other, now=self.now)
            history.sync_conversation(self.db, other, force=True, now=self.now + timedelta(seconds=5))
            self.assertEqual(fetch.call_count, 1)

    def test_timeline_status_callbacks_are_idempotent_and_call_duration_is_saved(self):
        lead, _ = self.call(status="initiated")
        service.apply_call_status(self.db, lead, SID, "ringing", 1)
        service.apply_call_status(self.db, lead, SID, "in-progress", 2)
        service.save_result(self.db, lead, {"outcome": "interested", "summary": "Wants details", "follow_up_permission": True})
        service.apply_call_status(self.db, lead, SID, "completed", 3, duration=45)
        service.apply_call_status(self.db, lead, SID, "completed", 3, duration=1)
        service.apply_call_status(self.db, lead, SID, "ringing", 4)
        events = self.db.query(OutreachCallEvent).filter_by(lead_id=lead.id).order_by(OutreachCallEvent.id).all()
        self.assertEqual([event.event for event in events], ["ringing", "in-progress", "result_saved", "completed"])
        self.assertEqual(self.db.get(OutreachConversation, lead.id).duration_seconds, 45)

    def test_final_empty_transcript_can_be_explicitly_rechecked(self):
        lead, _ = self.call()
        record = history.ensure_conversation(self.db, lead)
        record.status, record.is_final = "empty", True
        self.db.commit()
        with patch.object(history, "fetch_provider_conversation", return_value=self.provider()) as fetch:
            history.sync_conversation(self.db, lead, now=self.now)
            fetch.assert_not_called()
            record = history.sync_conversation(self.db, lead, force=True, now=self.now)
        self.assertEqual(record.status, "ready")
        self.assertEqual(record.message_count, 2)

    def test_conversation_endpoint_returns_durable_text_and_disables_response_caching(self):
        lead, _ = self.call()
        record = history.ensure_conversation(self.db, lead)
        record.messages, record.message_count, record.is_final, record.status = self.provider()[1], 2, True, "ready"
        self.db.commit()
        with patch.object(endpoints, "actor_for", return_value=ACTOR), patch.object(endpoints, "SessionLocal", self.Session), patch.object(history, "fetch_provider_conversation") as fetch:
            result = endpoints.outreach_conversation(self.request(route_params={"lead_id": lead.id}))
            fetch.assert_not_called()
        payload = json.loads(result.get_body())
        self.assertEqual(result.headers["Cache-Control"], "no-store")
        self.assertEqual(payload["transcript"]["messages"][0]["speaker"], "contact")
        self.assertEqual(payload["call"]["campaign_name"], "Partnerships")

    def test_existing_docker_database_gets_history_tables_without_losing_calls(self):
        lead, _ = self.call()
        lead_id = lead.id
        OutreachCallEvent.__table__.drop(self.engine)
        OutreachConversation.__table__.drop(self.engine)
        with patch.object(database, "engine", self.engine):
            database.init_db()
        self.assertIn("outreach_conversations", inspect(self.engine).get_table_names())
        self.assertIn("outreach_call_events", inspect(self.engine).get_table_names())
        self.assertEqual(self.db.get(OutreachLead, lead_id).status, "completed")


if __name__ == "__main__":
    unittest.main()
