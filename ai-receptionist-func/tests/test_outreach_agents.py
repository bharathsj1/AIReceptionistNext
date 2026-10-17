"""Tenant agent provisioning, prompt context, retries and authenticated onboarding."""
import importlib.util
import json
import os
import types
import unittest
from datetime import datetime
from dataclasses import replace
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch, Mock

import azure.functions as func
import requests
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from endpoint_imports import function_app_module
from crm_shared import issue_auth_session_token
from services import outreach_agents as agents, outreach_service as calls
from shared.db import Base, Client, User, OutreachAgent, OutreachBillingSetting, OutreachLead
from test_outreach import SETTINGS, ACTOR, CSV, load_endpoints

api = load_endpoints()
fake = types.ModuleType("function_app"); fake.app = func.FunctionApp()
spec = importlib.util.spec_from_file_location("agent_business_endpoints", Path(__file__).resolve().parents[1] / "auth_endpoints.py")
business_api = importlib.util.module_from_spec(spec)
with function_app_module(fake): spec.loader.exec_module(business_api)


class OutreachAgentTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, SETTINGS); env.start(); self.addCleanup(env.stop)
        self.engine = create_engine("sqlite:///:memory:"); Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine); self.db = self.Session()
        self.addCleanup(self.engine.dispose); self.addCleanup(self.db.close)
        self.db.add_all([Client(id=i, email=email, business_name=name, website_url="https://example.com",
            website_data=json.dumps({"business_profile":{"business_summary":summary,"business_services":"Delivery"},"knowledge_text":"Website facts","unrelated_secret":"do-not-share"}))
            for i,email,name,summary in [(1,ACTOR.email,"Willow","Willow services"),
                (2,"other@example.com","Willow","Other company facts"),(3,agents.ADMIN_EMAIL,"VedoraEats","Vedora benefits")]])
        self.db.add(User(email=ACTOR.email,password_hash="not-a-real-password")); self.db.commit()
        self.remote = {agents.ADMIN_AGENT_ID:{"agentId":agents.ADMIN_AGENT_ID,"name":"Existing agent","callTemplate":{"systemPrompt":"Previous prompt","voice":"existing-voice","selectedTools":[{"toolName":"old_booking_tool"}]}}}
        self.created = 0
        self.provider = patch.object(agents.requests,"request",side_effect=self.provider_request).start()
        self.addCleanup(patch.stopall)
        patch.object(business_api,"_trigger_prompt_generation_async").start()

    def provider_request(self, method, url, **kwargs):
        response = Mock()
        path = url.removeprefix("https://api.ultravox.ai/api")
        if path == "/agents" and method == "GET":
            result = {"results":[a for a in self.remote.values() if a["name"] == kwargs["params"]["search"]],"next":None}
        elif path == "/agents" and method == "POST":
            self.created += 1
            result = {"agentId":str(uuid4()), **kwargs["json"]}; self.remote[result["agentId"]]=result
        elif method == "GET": result = self.remote[path.split("/")[-1]]
        elif method == "PATCH":
            result = self.remote[path.split("/")[-1]]; result.update(kwargs["json"])
        else: self.fail("Unexpected provider request")
        response.json.return_value = result
        return response

    def save_request(self, email=ACTOR.email, signed=True, scope="primary_user", **body):
        token,_=issue_auth_session_token(ACTOR.email, scope=scope)
        return func.HttpRequest("POST","https://example.com/api/clients/business-details",params={},
            headers={"Authorization":"Bearer "+token} if signed else {},
            body=json.dumps({"email":email,"businessName":"Willow","businessPhone":"+442079460000",**body}).encode())

    def test_admin_agent_is_exclusive_and_preserves_its_voice_settings(self):
        agent_id = agents.sync_agent(self.db,3)
        self.assertEqual(agent_id,agents.ADMIN_AGENT_ID); self.assertEqual(self.created,0)
        template = self.remote[agent_id]["callTemplate"]
        self.assertEqual(template["voice"],"existing-voice")
        self.assertIn("VedoraEats",template["systemPrompt"])
        self.assertIn("{{{outreach_context}}}",template["systemPrompt"])
        self.assertEqual(template["contextSchema"]["required"],["outreach_context"])
        normal = agents.sync_agent(self.db,1)
        self.assertNotEqual(normal,agents.ADMIN_AGENT_ID)

    def test_identical_company_names_create_separate_agents_and_repeated_sync_reuses_them(self):
        first,second = agents.sync_agent(self.db,1),agents.sync_agent(self.db,2)
        self.assertNotEqual(first,second); self.assertEqual(self.created,2)
        before = self.provider.call_count
        self.assertEqual(agents.sync_agent(self.db,1),first)
        self.assertEqual(self.provider.call_count,before)
        prompt = self.remote[first]["callTemplate"]["systemPrompt"]
        self.assertIn("Willow services",prompt); self.assertNotIn("Other company facts",prompt)
        self.assertNotIn("do-not-share",prompt)

    def test_profile_change_updates_existing_agent_and_queues_new_facts(self):
        agent_id = agents.sync_agent(self.db,1)
        client = self.db.get(Client,1); client.website_data=json.dumps({"business_profile":{"business_summary":"New approved offer"}}); self.db.commit()
        row = agents.queue_agent(self.db,client); self.assertEqual(row.status,"pending")
        self.assertEqual(agents.sync_agent(self.db,1),agent_id); self.assertEqual(self.created,1)
        self.assertIn("New approved offer",self.remote[agent_id]["callTemplate"]["systemPrompt"])

    def test_lost_create_response_is_reconciled_without_creating_a_second_agent(self):
        original = self.provider.side_effect
        def lost_response(method,url,**kwargs):
            result=original(method,url,**kwargs)
            if method=="POST": raise requests.Timeout("private upstream details")
            return result
        self.provider.side_effect=lost_response
        with self.assertRaises(agents.AgentError): agents.sync_agent(self.db,1)
        self.assertEqual(self.db.get(OutreachAgent,1).status,"retry_pending")
        self.provider.side_effect=original
        self.assertIsNotNone(agents.sync_agent(self.db,1)); self.assertEqual(self.created,1)

    def test_concurrent_setup_lock_prevents_duplicate_provider_mutation(self):
        agents.queue_agent(self.db,self.db.get(Client,1))
        self.db.add(OutreachBillingSetting(id="outreach_agent_lock:1",status="locked",created_at=datetime.utcnow())); self.db.commit()
        with self.assertRaises(ValueError): agents.sync_agent(self.db,1)
        self.provider.assert_not_called()

    def test_profile_saved_during_provider_sync_stays_pending_until_new_facts_are_synced(self):
        original=self.provider.side_effect
        def updated_profile(method,url,**kwargs):
            response=original(method,url,**kwargs)
            if method=="POST":
                client=self.db.get(Client,1)
                client.website_data=json.dumps({"business_profile":{"business_summary":"Later confirmed offer"}})
                self.db.commit(); agents.queue_agent(self.db,client)
            return response
        self.provider.side_effect=updated_profile
        agent_id=agents.sync_agent(self.db,1)
        row=self.db.get(OutreachAgent,1)
        self.assertEqual(row.status,"pending"); self.assertNotEqual(row.source_hash,row.synced_hash)
        self.provider.side_effect=original
        self.assertEqual(agents.sync_agent(self.db,1),agent_id)
        self.assertEqual(row.status,"ready")
        self.assertIn("Later confirmed offer",self.remote[agent_id]["callTemplate"]["systemPrompt"])

    def test_agent_failure_pauses_before_call_creation_or_wallet_reservation(self):
        response=requests.Response(); response.status_code=401
        with patch.object(calls,"caller_numbers",return_value=["+442079460000"]),patch("services.outreach_billing.bind_campaign"):
            campaign,_=calls.create_campaign(self.db,1,{"name":"Pitch","benefits":"Approved pitch","notification_email":ACTOR.email,"caller_id":"+442079460000","csv_text":CSV})
        campaign.status="running"; self.db.commit()
        lead=self.db.query(OutreachLead).filter_by(campaign_id=campaign.id).one()
        self.provider.side_effect=requests.HTTPError("secret provider body",response=response)
        with patch("services.outreach_billing.reserve_call") as reserve,patch.object(calls.requests,"post") as post,patch.object(calls,"twilio_client") as twilio:
            calls.launch_call(self.db,campaign,lead)
        self.assertEqual(campaign.status,"paused"); self.assertEqual(lead.status,"queued")
        self.assertIn("HTTP 401",lead.error); self.assertNotIn("secret",lead.error)
        reserve.assert_not_called(); post.assert_not_called(); twilio.assert_not_called()

    def test_save_website_requires_signed_matching_owner_and_retains_crawled_knowledge(self):
        for req,status in [(self.save_request(signed=False),401),(self.save_request(email="other@example.com"),403),(self.save_request(scope="client_user"),403)]:
            with patch.object(business_api,"SessionLocal",self.Session): result=business_api.client_business_details(req)
            self.assertEqual(result.status_code,status)
        self.assertEqual(self.db.query(OutreachAgent).count(),0)
        req=self.save_request(websiteData={"pages":[{"content":"Real crawled business details"}]})
        with patch.object(business_api,"SessionLocal",self.Session): result=business_api.client_business_details(req)
        self.assertEqual(result.status_code,200)
        self.db.expire_all(); client=self.db.get(Client,1)
        self.assertIn("Real crawled business details",client.website_data)
        self.assertEqual(agents.agent_payload(self.db.get(OutreachAgent,1))["status"],"pending")
        self.provider.assert_not_called()

    def test_initial_signup_session_without_client_id_can_save_its_own_profile(self):
        self.db.delete(self.db.get(Client,1)); self.db.commit()
        req=self.save_request(websiteData={"businessSummary":"Company offer"})
        with patch.object(business_api,"SessionLocal",self.Session): result=business_api.client_business_details(req)
        self.assertEqual(result.status_code,201)

    def test_agent_endpoint_cannot_assign_a_client_supplied_or_other_tenant_agent(self):
        req=func.HttpRequest("POST","https://example.com/api/outreach/agent",params={},body=json.dumps({"agent_id":agents.ADMIN_AGENT_ID,"client_id":3}).encode())
        with patch.object(api,"actor_for",return_value=ACTOR),patch.object(api,"SessionLocal",self.Session): result=api.outreach_agent_sync(req)
        self.assertEqual(result.status_code,200)
        self.db.expire_all(); self.assertNotEqual(self.db.get(OutreachAgent,1).agent_id,agents.ADMIN_AGENT_ID)
        self.assertIsNone(self.db.get(OutreachAgent,3))

    def test_calls_use_saved_agent_and_tenant_context_with_per_call_result_tools(self):
        with patch.object(calls,"caller_numbers",return_value=["+442079460000"]),patch("services.outreach_billing.bind_campaign"),patch("services.outreach_billing.reserve_call",return_value=types.SimpleNamespace(max_duration_seconds=600)):
            campaign,_=calls.create_campaign(self.db,1,{"name":"Pitch","benefits":"Approved pitch","notification_email":ACTOR.email,"caller_id":"+442079460000","csv_text":"phone,restaurant_name\n02079460018,The Bistro\n"})
            campaign.status="running"; self.db.commit()
            lead=self.db.query(OutreachLead).filter_by(campaign_id=campaign.id).one()
            with patch.object(calls.requests,"post") as post,patch.object(calls,"twilio_client") as twilio:
                post.return_value.json.return_value={"callId":"uv-unit","joinUrl":"wss://example.com/join"}
                twilio.return_value.calls.create.return_value.sid="CA"+"1"*32
                calls.launch_call(self.db,campaign,lead)
            agent_id=self.db.get(OutreachAgent,1).agent_id
            self.assertTrue(post.call_args.args[0].endswith(f"/agents/{agent_id}/calls"))
            payload=post.call_args.kwargs["json"]
            self.assertNotIn("systemPrompt",payload)
            self.assertNotIn("retentionPolicy",payload)
            prompt=payload["templateContext"]["outreach_context"]
            self.assertIn("Willow services",prompt); self.assertIn("Approved pitch",prompt)
            self.assertNotIn("VedoraEats",prompt); self.assertNotIn("Other company facts",prompt)
            self.assertTrue(payload["toolOverrides"]["removeAll"])
            self.assertEqual(payload["toolOverrides"]["add"][0]["temporaryTool"]["modelToolName"],"save_outreach_result")

    def test_prompt_reads_live_ultravox_text_and_adopts_external_edits(self):
        agent_id = agents.sync_agent(self.db, 1)
        self.remote[agent_id]["callTemplate"]["systemPrompt"] = "Latest provider-side offer"
        payload = agents.read_prompt(self.db, 1)
        self.assertEqual(payload["prompt"], "Latest provider-side offer")
        self.assertEqual(payload["agent_id"], agent_id)
        self.assertNotIn("Willow services", payload["prompt"])
        self.assertEqual(agents.prompt_setting(self.db, 1).status, "custom")
        self.assertNotIn("api", payload)

    def test_prompt_save_round_trip_preserves_voice_tools_and_runtime_schema(self):
        agent_id = agents.sync_agent(self.db, 3)
        original = agents.read_prompt(self.db, 3)
        saved = agents.save_prompt(self.db, 3, "Approved VedoraEats pitch", original["version"])
        self.assertEqual(saved["prompt"], "Approved VedoraEats pitch")
        self.assertEqual(agents.read_prompt(self.db, 3), saved)
        self.assertNotEqual(original["version"], saved["version"])
        template = self.remote[agent_id]["callTemplate"]
        self.assertEqual(template["voice"], "existing-voice")
        self.assertEqual(template["selectedTools"], [{"toolName": "old_booking_tool"}])
        self.assertIn("{{{outreach_context}}}", template["systemPrompt"])
        self.assertIn("outreach_context", template["contextSchema"]["required"])
        self.assertEqual(agents.prompt_setting(self.db, 3).status, "custom")

    def test_website_sync_and_force_sync_preserve_owner_prompt(self):
        agent_id = agents.sync_agent(self.db, 1)
        loaded = agents.read_prompt(self.db, 1)
        agents.save_prompt(self.db, 1, "Owner's edited pitch", loaded["version"])
        client = self.db.get(Client, 1)
        client.website_data = json.dumps({"business_profile": {"business_summary": "New crawled facts"}})
        self.db.commit(); agents.queue_agent(self.db, client)
        agents.sync_agent(self.db, 1, force=True)
        self.assertEqual(self.remote[agent_id]["callTemplate"]["systemPrompt"], "Owner's edited pitch" + agents.RUNTIME_SUFFIX)

    def test_provider_edits_survive_profile_sync_without_loading_editor_first(self):
        agent_id = agents.sync_agent(self.db, 1)
        self.remote[agent_id]["callTemplate"]["systemPrompt"] = "Externally updated agent"
        client = self.db.get(Client, 1); client.business_name = "New website name"; self.db.commit()
        agents.sync_agent(self.db, 1)
        self.assertEqual(agents.read_prompt(self.db, 1)["prompt"], "Externally updated agent")

    def test_stale_editor_cannot_overwrite_newer_ultravox_prompt(self):
        agent_id = agents.sync_agent(self.db, 1)
        loaded = agents.read_prompt(self.db, 1)
        self.remote[agent_id]["callTemplate"]["systemPrompt"] = "Newer upstream edit"
        self.provider.reset_mock()
        with self.assertRaises(agents.PromptConflict):
            agents.save_prompt(self.db, 1, "Old editor draft", loaded["version"])
        self.assertFalse(any(call.args[0] == "PATCH" for call in self.provider.call_args_list))
        self.assertEqual(self.remote[agent_id]["callTemplate"]["systemPrompt"], "Newer upstream edit")

    def test_lost_save_response_is_recovered_without_regenerating_website_prompt(self):
        agent_id = agents.sync_agent(self.db, 1)
        loaded = agents.read_prompt(self.db, 1)
        original = self.provider.side_effect
        def lost_save(method, url, **kwargs):
            response = original(method, url, **kwargs)
            if method == "PATCH": raise requests.Timeout("private provider detail")
            return response
        self.provider.side_effect = lost_save
        with self.assertRaises(agents.AgentError): agents.save_prompt(self.db, 1, "Saved despite timeout", loaded["version"])
        self.provider.side_effect = original
        agents.sync_agent(self.db, 1, force=True)
        self.assertEqual(agents.read_prompt(self.db, 1)["prompt"], "Saved despite timeout")

    def test_runtime_context_addition_does_not_stale_the_visible_prompt_version(self):
        agent_id = agents.sync_agent(self.db, 1)
        self.remote[agent_id]["callTemplate"]["systemPrompt"] = "Provider custom pitch"
        loaded = agents.read_prompt(self.db, 1)
        agents.sync_agent(self.db, 1)
        self.assertEqual(loaded, agents.read_prompt(self.db, 1))
        self.assertIn("{{{outreach_context}}}", self.remote[agent_id]["callTemplate"]["systemPrompt"])

    def test_prompt_endpoints_require_matching_signed_company_owner(self):
        agents.sync_agent(self.db, 1)
        req = func.HttpRequest("GET", "https://example.com/api/outreach/agent/prompt", params={}, body=b"")
        for actor, expected in [(None, 401), (replace(ACTOR, scope="client_user"), 403), (replace(ACTOR, client_id=2), 403)]:
            with patch.object(api, "actor_for", return_value=actor), patch.object(api, "SessionLocal", self.Session):
                self.assertEqual(api.outreach_agent_prompt(req).status_code, expected)
        with patch.object(api, "actor_for", return_value=ACTOR), patch.object(api, "SessionLocal", self.Session):
            data = json.loads(api.outreach_agent_prompt(req).get_body())
            save = func.HttpRequest("POST", req.url, params={}, body=json.dumps({"prompt": "Tenant one only", "version": data["version"], "client_id": 3, "agent_id": agents.ADMIN_AGENT_ID}).encode())
            self.assertEqual(api.outreach_agent_prompt(save).status_code, 200)
        self.assertEqual(agents.read_prompt(self.db, 1)["prompt"], "Tenant one only")
        self.assertEqual(self.remote[agents.ADMIN_AGENT_ID]["callTemplate"]["systemPrompt"], "Previous prompt")

    def test_invalid_prompts_never_mutate_provider_and_bad_legacy_assignment_is_rejected(self):
        agents.sync_agent(self.db, 1)
        loaded = agents.read_prompt(self.db, 1)
        for prompt in [None, " ", "a" * 63901, "bad\x00prompt"]:
            with self.assertRaises(ValueError): agents.save_prompt(self.db, 1, prompt, loaded["version"])
        self.db.get(OutreachAgent, 1).agent_id = agents.ADMIN_AGENT_ID; self.db.commit()
        self.provider.reset_mock()
        with self.assertRaises(agents.AgentError): agents.read_prompt(self.db, 1)
        self.provider.assert_not_called()
