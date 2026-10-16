import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

import azure.functions as func

from crm_shared import _auth_session_secret, issue_auth_session_token, _verify_auth_session_token
from services.public_storage import blob_reference, public_blob_url

ROOT = Path(__file__).resolve().parents[2]


def load_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fake_app = types.ModuleType("function_app")
fake_app.app = func.FunctionApp()
with patch.dict(sys.modules, {"function_app": fake_app}):
    endpoints = load_file("test_storage_endpoints", ROOT / "ai-receptionist-func/storage_endpoints.py")
configuration = load_file("test_configure_docker", ROOT / "scripts/configure_docker.py")


class DockerMigrationTests(unittest.TestCase):
    def test_docker_secrets_are_persistent_and_existing_values_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / ".env.docker"
            configuration.prepare(destination)
            first = destination.read_text()
            configuration.prepare(destination)
            self.assertEqual(destination.read_text(), first)
            values = dict(line.split("=", 1) for line in first.splitlines() if line and not line.startswith("#") and "=" in line)
            self.assertTrue(all(len(values[key]) >= 32 for key in configuration.SECRET_NAMES))
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            destination.write_text("AUTH_SESSION_SECRET=existing-test-secret\nSOCIAL_TOKEN_ENC_KEY=existing-test-encryption-key\n")
            configuration.prepare(destination)
            self.assertIn("AUTH_SESSION_SECRET=existing-test-secret\n", destination.read_text())
            self.assertIn("SOCIAL_TOKEN_ENC_KEY=existing-test-encryption-key\n", destination.read_text())

    def test_storage_credentials_are_not_session_signing_keys(self):
        with patch.dict(os.environ, {"AZURE_STORAGE_CONNECTION_STRING": "public-emulator-credentials"}, clear=True):
            self.assertEqual(_auth_session_secret(), "")

    def test_session_survives_restart_with_same_key_and_rejects_another_deployment(self):
        with patch.dict(os.environ, {"AUTH_SESSION_SECRET": "test-persistent-signing-key"}):
            token, _ = issue_auth_session_token("owner@example.com", client_id=1)
            self.assertEqual(_verify_auth_session_token(token)["email"], "owner@example.com")
            with patch.dict(os.environ, {"AUTH_SESSION_SECRET": "other-deployment-signing-key"}):
                self.assertIsNone(_verify_auth_session_token(token))
            self.assertIsNotNone(_verify_auth_session_token(token))

    def test_emulator_media_urls_use_deployment_origin_without_exposing_storage_host(self):
        with patch.dict(os.environ, {"API_PUBLIC_BASE_URL": "https://aireceptionist.vedoraeats.com"}):
            original = "http://azurite:10000/localdev/social-media/uploads/example.png"
            public = public_blob_url(original)
            self.assertEqual(public, "https://aireceptionist.vedoraeats.com/api/storage/public/social-media/uploads/example.png")
            self.assertEqual(blob_reference(public), ("social-media", "uploads/example.png"))
            self.assertEqual(blob_reference(original), ("social-media", "uploads/example.png"))
            self.assertIsNone(public_blob_url(None))

    def test_public_storage_does_not_expose_private_meeting_audio_or_path_traversal(self):
        for container, path in [("meeting-audio-temp", "private.wav"), ("employee-photos", "../secret"), ("social-media", "uploads/%2e%2e/secret")]:
            req = func.HttpRequest("GET", "http://localhost/api/storage/public", headers={}, params={},
                                   route_params={"container": container, "blob_path": path}, body=b"")
            with patch.object(endpoints, "BlobServiceClient") as sdk:
                self.assertEqual(endpoints.public_storage_file(req).status_code, 404)
                sdk.from_connection_string.assert_not_called()

    def test_migrated_media_metadata_never_falls_back_to_cloud_hosts(self):
        with patch.dict(os.environ, {"API_PUBLIC_BASE_URL": "https://aireceptionist.vedoraeats.com"}):
            legacy = public_blob_url("https://old-account.blob.core.windows.net/social-media/uploads/example.png?old-sas=discarded")
            self.assertEqual(legacy, "https://aireceptionist.vedoraeats.com/api/storage/public/social-media/uploads/example.png")
            legacy_upload = public_blob_url("https://retired.azurewebsites.net/api/social/media/example.png")
            self.assertEqual(legacy_upload, "https://aireceptionist.vedoraeats.com/api/social/media/example.png")

    def test_public_storage_returns_media_and_head_does_not_download(self):
        client = Mock()
        client.get_blob_properties.return_value = types.SimpleNamespace(size=8, etag="test-etag",
            content_settings=types.SimpleNamespace(content_type="image/png"))
        client.download_blob.return_value.readall.return_value = b"test-png"
        service = Mock()
        service.get_blob_client.return_value = client
        for method in ["HEAD", "GET"]:
            req = func.HttpRequest(method, "http://localhost/api/storage/public", headers={}, params={},
                route_params={"container": "employee-photos", "blob_path": "example.png"}, body=b"")
            with patch.dict(os.environ, {"AZURE_STORAGE_CONNECTION_STRING": "emulator-test-connection"}), patch.object(
                    endpoints.BlobServiceClient, "from_connection_string", return_value=service):
                response = endpoints.public_storage_file(req)
                self.assertEqual(response.status_code, 200)
                if method == "HEAD":
                    client.download_blob.assert_not_called()
                else:
                    self.assertEqual(response.get_body(), b"test-png")
                    self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

    def test_public_base_does_not_fall_back_to_retired_host_environment(self):
        from shared.config import get_public_api_base
        with patch.dict(os.environ, {"WEBSITE_HOSTNAME": "retired.example.invalid"}, clear=True):
            self.assertEqual(get_public_api_base(), "http://localhost:7071")


if __name__ == "__main__":
    unittest.main()
