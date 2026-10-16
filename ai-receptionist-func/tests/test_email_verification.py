from endpoint_imports import function_app_module
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

import azure.functions as func
import requests
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from services import email_verification as service
from shared.db import Base, Client, OutreachEmailVerification
from test_outreach import ACTOR, SETTINGS

NOW = datetime(2026, 10, 16, 12)
REAL_SEND_EMAIL = service.send_verification_email


def load_endpoints():
    fake = types.ModuleType("function_app"); fake.app = func.FunctionApp()
    spec = importlib.util.spec_from_file_location("verification_test_endpoints", Path(__file__).resolve().parents[1] / "email_verification_endpoints.py")
    module = importlib.util.module_from_spec(spec)
    with function_app_module(fake):
        spec.loader.exec_module(module)
    return module


endpoints = load_endpoints()


class EmailVerificationTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, SETTINGS); self.environment.start()
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{self.directory.name}/test.db", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.db.add_all([Client(id=1, email="owner@example.com", website_url="https://example.com"),
                         Client(id=2, email="other@example.com", website_url="https://example.com")]); self.db.commit()
        self.actor = replace(ACTOR, user_id="1")
        self.manager = replace(ACTOR, email="manager@example.com", role="manager", scope="client_user", client_user_id="7")
        self.smtp_patch = patch.object(service, "get_smtp_settings", return_value={}); self.smtp_patch.start()
        self.mail_patch = patch.object(service, "send_verification_email"); self.mail = self.mail_patch.start()
        self.random_patch = patch.object(service.secrets, "randbelow", return_value=123456); self.random_patch.start()

    def tearDown(self):
        self.random_patch.stop(); self.mail_patch.stop(); self.smtp_patch.stop(); self.environment.stop()
        self.db.close(); self.engine.dispose(); self.directory.cleanup()

    def send(self, actor=None, now=NOW):
        return service.send_code(self.db, actor or self.actor, now=now)

    def verify(self, code="123456", actor=None, now=NOW):
        return service.verify_code(self.db, actor or self.actor, code, now=now)

    def api(self, handler, body=None, actor=None, method="POST", raw=None):
        req = func.HttpRequest(method, "https://example.com/api/outreach/email-verification/send",
            params={}, body=raw if raw is not None else json.dumps(body or {}).encode())
        with patch.object(endpoints, "actor_for", return_value=actor), patch.object(endpoints, "SessionLocal", self.Session):
            return handler(req)

    def test_status_does_not_send_or_create_challenge(self):
        status = service.status_payload(self.db, self.manager, NOW)
        self.assertEqual(status["email"], "manager@example.com")
        self.assertFalse(status["is_email_verified"])
        self.assertEqual(self.db.query(OutreachEmailVerification).count(), 0)
        self.mail.assert_not_called()

    def test_single_use_code_hash_and_verification_survive_restart(self):
        status = self.send()
        state = self.db.get(OutreachEmailVerification, service.identity(self.actor))
        self.assertNotIn("123456", json.dumps(status))
        self.assertNotEqual(state.code_hash, "123456")
        self.assertEqual(state.expires_at, NOW + timedelta(minutes=10))
        self.db.close(); self.db = self.Session()
        self.assertTrue(self.verify()["is_email_verified"])
        self.db.close(); self.db = self.Session()
        self.assertTrue(service.status_payload(self.db, self.actor, NOW)["is_email_verified"])
        with self.assertRaises(service.VerificationError): self.verify()
        with self.assertRaises(service.VerificationError): self.send()
        self.assertIsNone(self.db.get(OutreachEmailVerification, service.identity(self.actor)).code_hash)
        self.mail.assert_called_once_with("owner@example.com", "123456")

    def test_expired_code_and_five_attempt_limit(self):
        self.send()
        for code in ["bad", "000000", "１２３４５６", "111111", "222222"]:
            with self.assertRaises(service.VerificationError): self.verify(code)
        with self.assertRaises(service.VerificationError) as error: self.verify()
        self.assertEqual(error.exception.status, 429)
        self.send(now=NOW + timedelta(seconds=61))
        with self.assertRaises(service.VerificationError): self.verify(now=NOW + timedelta(seconds=661))

    def test_resend_invalidates_previous_code_and_resets_failed_attempts(self):
        self.send()
        with self.assertRaises(service.VerificationError): self.verify("999999")
        with patch.object(service.secrets, "randbelow", return_value=654321): self.send(now=NOW + timedelta(seconds=61))
        with self.assertRaises(service.VerificationError): self.verify("123456", now=NOW + timedelta(seconds=61))
        self.assertTrue(self.verify("654321", now=NOW + timedelta(seconds=61))["is_email_verified"])

    def test_cooldown_and_three_send_limit_include_failed_sends(self):
        self.send()
        with self.assertRaises(service.VerificationError) as error: self.send()
        self.assertEqual(error.exception.retry_after, 60)
        self.send(now=NOW + timedelta(seconds=61)); self.send(now=NOW + timedelta(seconds=122))
        with self.assertRaises(service.VerificationError) as error: self.send(now=NOW + timedelta(seconds=183))
        self.assertEqual(error.exception.status, 429)
        self.send(now=NOW + timedelta(seconds=600))
        self.assertEqual(self.db.get(OutreachEmailVerification, service.identity(self.actor)).send_count, 1)

    def test_other_user_tenant_or_changed_email_cannot_use_code(self):
        self.send()
        for actor in [self.manager, replace(self.actor, client_id=2), replace(self.actor, email="changed@example.com")]:
            with self.subTest(actor=actor), self.assertRaises(service.VerificationError): self.verify(actor=actor)
            self.assertFalse(service.status_payload(self.db, actor, NOW)["is_email_verified"])
        with self.assertRaises(service.VerificationError): service.send_code(self.db, self.actor, email="foreign@example.com", now=NOW)
        self.mail.assert_called_once()

    def test_unknown_delivery_outcome_is_not_retried_or_accepted_as_verified(self):
        self.mail.side_effect = requests.Timeout("private provider detail")
        with self.assertRaises(service.VerificationError) as error: self.send()
        self.assertNotIn("private provider detail", str(error.exception))
        self.assertEqual(self.db.get(OutreachEmailVerification, service.identity(self.actor)).status, "failed")
        with self.assertRaises(service.VerificationError): self.verify()
        with self.assertRaises(service.VerificationError): self.send()
        self.mail.assert_called_once()

    def test_missing_mail_or_signing_configuration_cannot_send(self):
        for settings in [{"SENDGRID_API_KEY": ""}, {"AUTH_SESSION_SECRET": "", "APP_SESSION_SECRET": "", "JWT_SECRET": "", "SECRET_KEY": "", "WEBSITE_AUTH_ENCRYPTION_KEY": ""}]:
            with patch.dict(os.environ, settings), self.assertRaises(service.VerificationError): self.send()
        self.mail.assert_not_called()

    def test_simultaneous_sends_send_one_email_and_simultaneous_verifies_use_code_once(self):
        def send():
            with self.Session() as db:
                try: service.send_code(db, self.actor, now=NOW); return True
                except service.VerificationError: return False
        with ThreadPoolExecutor(max_workers=2) as pool: self.assertEqual(sorted(pool.map(lambda _: send(), range(2))), [False, True])
        self.mail.assert_called_once()
        def verify():
            with self.Session() as db:
                try: service.verify_code(db, self.actor, "123456", now=NOW); return True
                except service.VerificationError: return False
        with ThreadPoolExecutor(max_workers=2) as pool: self.assertEqual(sorted(pool.map(lambda _: verify(), range(2))), [False, True])

    def test_endpoints_require_session_reject_spoofed_email_and_do_not_expose_code(self):
        for handler in [endpoints.email_verification_status, endpoints.email_verification_send, endpoints.email_verification_verify]:
            self.assertEqual(self.api(handler, actor=None).status_code, 401)
            self.assertEqual(self.api(handler, actor=None, method="OPTIONS").status_code, 200)
        response = self.api(endpoints.email_verification_send, {"email": "foreign@example.com"}, self.actor)
        self.assertEqual(response.status_code, 400)
        response = self.api(endpoints.email_verification_send, actor=self.actor)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("123456", response.get_body().decode())
        response = self.api(endpoints.email_verification_send, actor=self.actor)
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)
        response = self.api(endpoints.email_verification_verify, {"code": "123456"}, self.manager)
        self.assertEqual(response.status_code, 400)
        response = self.api(endpoints.email_verification_verify, {"code": "123456"}, self.actor)
        self.assertTrue(json.loads(response.get_body())["is_email_verified"])

    def test_endpoint_rejects_invalid_or_oversized_json(self):
        for raw, status in [(b"[]", 400), (b"{", 400), (b"x" * 4097, 413)]:
            self.assertEqual(self.api(endpoints.email_verification_send, actor=self.actor, raw=raw).status_code, status)
        self.mail.assert_not_called()

    def test_delivery_uses_existing_smtp_with_tls(self):
        with patch.object(service, "get_smtp_settings", return_value={"host": "smtp.example.com", "port": 587,
            "username": "support@vedoraeats.com", "password": "test-smtp"}), patch.object(service.smtplib, "SMTP") as smtp:
            with patch.object(service.requests, "post") as post:
                REAL_SEND_EMAIL("owner@example.com", "123456")
            smtp.return_value.__enter__.return_value.starttls.assert_called_once()
            smtp.return_value.__enter__.return_value.send_message.assert_called_once()
            post.assert_not_called()

    def test_delivery_falls_back_to_sendgrid_and_checks_acceptance(self):
        with patch.object(service.requests, "post", return_value=Mock(status_code=202)) as post:
            REAL_SEND_EMAIL("owner@example.com", "123456")
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["personalizations"][0]["to"][0]["email"], "owner@example.com")
        self.assertIn("123456", payload["content"][0]["value"])
        with patch.object(service.requests, "post", return_value=Mock(status_code=403)), self.assertRaises(service.VerificationError):
            REAL_SEND_EMAIL("owner@example.com", "123456")
