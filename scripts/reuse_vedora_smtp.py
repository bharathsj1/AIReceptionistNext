"""Reuse the website's SMTP credentials on the same Docker host, without printing them.

Run with Python 3 on the Docker host. Only SMTP settings are read from the source;
the source container is never modified. No secrets are written to temporary files
or passed as command-line arguments. The destination validates TLS, authentication
and the sender before replacing its encrypted verification-email configuration.
"""
import argparse
import json
import subprocess
import sys


SOURCE_CODE = """
import json
from app.core.config import get_settings
s = get_settings()
print(json.dumps({
    'host': s.smtp_host, 'port': s.smtp_port,
    'username': s.smtp_username, 'password': s.smtp_password,
    'from_email': s.smtp_from_email,
}))
"""

DESTINATION_CODE = """
import json, smtplib, sys
from datetime import datetime
from shared.db import SessionLocal, OutreachEmailSetting
from services.outreach_smtp import cipher, smtp_connection

try:
    settings = json.load(sys.stdin)
    # This transfer is intentionally limited to the existing Vedora support sender.
    if str(settings.get('from_email') or '').strip().lower() != 'support@vedoraeats.com':
        raise ValueError('Unexpected sender')
    settings['from_email'] = 'support@vedoraeats.com'
    if not all(settings.get(k) for k in ('host', 'username', 'password')):
        raise ValueError('Incomplete SMTP credentials')
    port = int(settings.get('port') or 587)
    if port not in (465, 587):
        raise ValueError('TLS port required')
    settings.update(port=port, use_tls=True, use_ssl=port == 465)
    encrypted = cipher().encrypt(json.dumps(settings).encode()).decode()
    with smtp_connection(settings) as server:
        status, detail = server.mail(settings['from_email'])
        if status != 250:
            raise smtplib.SMTPSenderRefused(status, detail, settings['from_email'])
        server.rset()
    with SessionLocal() as db:
        row = db.get(OutreachEmailSetting, 'smtp')
        if row is None:
            row = OutreachEmailSetting(id='smtp', encrypted_value=encrypted)
            db.add(row)
        row.encrypted_value = encrypted
        row.updated_at = datetime.utcnow()
        db.commit()
    print(json.dumps({'saved': True, 'connection_verified': True}))
except Exception as exc:
    # Never include exception text: SMTP responses can contain private data.
    print(json.dumps({'saved': False, 'category': type(exc).__name__}))
    sys.exit(1)
"""


def transfer(source="vedora-sandbox-api", destination="aireceptionist-backend-1", run=subprocess.run):
    try:
        result = run(["docker", "exec", source, "python", "-c", SOURCE_CODE],
                     capture_output=True, timeout=30, check=False)
        if result.returncode:
            print("Could not read website SMTP settings. No settings were changed.", file=sys.stderr)
            return 1
        settings = json.loads(result.stdout)
        expected = {"host", "port", "username", "password", "from_email"}
        if not isinstance(settings, dict) or set(settings) != expected:
            raise ValueError("Unexpected SMTP configuration")
        result = run(["docker", "exec", "-i", "-w", "/home/site/wwwroot", destination,
                      "python", "-c", DESTINATION_CODE], input=json.dumps(settings).encode(),
                     capture_output=True, timeout=60, check=False)
        # Destination output is deliberately not echoed, including on failure.
        if result.returncode:
            print("SMTP validation or saving failed. Check the website's support sender, SMTP login and TLS settings. No success was confirmed.", file=sys.stderr)
            return 1
        status = json.loads(result.stdout)
        if status != {"saved": True, "connection_verified": True}:
            raise ValueError("No save confirmation")
        print("Website SMTP settings copied to Outreach encrypted storage. Login and sender accepted. Request a verification code from Calling setup.")
        return 0
    except (OSError, ValueError, subprocess.SubprocessError):
        print("SMTP transfer could not be confirmed. No credentials were printed. Check Docker access and the two container names.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-container", default="vedora-sandbox-api")
    parser.add_argument("--destination-container", default="aireceptionist-backend-1")
    args = parser.parse_args()
    sys.exit(transfer(args.source_container, args.destination_container))
