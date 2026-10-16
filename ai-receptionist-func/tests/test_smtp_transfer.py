"""The host transfer never exposes source or destination output containing secrets."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock


spec = importlib.util.spec_from_file_location("smtp_transfer", Path(__file__).resolve().parents[2] / "scripts/reuse_vedora_smtp.py")
transfer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transfer)


class SmtpTransferTests(unittest.TestCase):
    def call(self, run):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = transfer.transfer(run=run)
        self.assertNotIn("private-password", out.getvalue() + err.getvalue())
        return status, out.getvalue(), err.getvalue()

    def settings(self):
        return {"host": "smtp.example.com", "port": 465, "username": "support@vedoraeats.com",
                "password": "private-password", "from_email": "support@vedoraeats.com"}

    def test_only_smtp_settings_are_transferred_on_stdin(self):
        run = Mock(side_effect=[subprocess.CompletedProcess([], 0, json.dumps(self.settings()).encode()),
            subprocess.CompletedProcess([], 0, b'{"saved": true, "connection_verified": true}')])
        status, out, _ = self.call(run)
        self.assertEqual(status, 0)
        self.assertIn("encrypted storage", out)
        args, kwargs = run.call_args
        self.assertNotIn("private-password", str(args))
        self.assertEqual(json.loads(kwargs["input"]), self.settings())
        self.assertEqual(run.call_args_list[0].args[0][0:3], ["docker", "exec", "vedora-sandbox-api"])

    def test_source_failure_does_not_attempt_destination_or_print_output(self):
        run = Mock(return_value=subprocess.CompletedProcess([], 1, b"private-password", b"private-password"))
        self.assertEqual(self.call(run)[0], 1)
        self.assertEqual(run.call_count, 1)

    def test_destination_failure_and_bad_confirmation_do_not_report_success_or_expose_output(self):
        for result in [subprocess.CompletedProcess([], 1, b"private-password", b"private-password"),
                       subprocess.CompletedProcess([], 0, b'{"saved": false}')]:
            run = Mock(side_effect=[subprocess.CompletedProcess([], 0, json.dumps(self.settings()).encode()), result])
            status, out, _ = self.call(run)
            self.assertEqual(status, 1)
            self.assertNotIn("settings copied", out)

    def test_malformed_source_or_timeout_never_echo_provider_output(self):
        for value in [subprocess.CompletedProcess([], 0, b'private-password'),
                      subprocess.CompletedProcess([], 0, b'{"password": "private-password"}'),
                      subprocess.TimeoutExpired(["docker"], 30, output=b"private-password")]:
            run = Mock(side_effect=[value])
            self.assertEqual(self.call(run)[0], 1)
            self.assertEqual(run.call_count, 1)
