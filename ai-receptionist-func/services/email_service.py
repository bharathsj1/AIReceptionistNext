from __future__ import annotations

import json
import logging
import os
from typing import Optional, Tuple

import requests

logger = logging.getLogger(__name__)


def _sendgrid_enabled() -> bool:
    return bool(os.getenv("SENDGRID_API_KEY"))


def _from_email() -> str:
    return os.getenv("FROM_EMAIL") or "no-reply@yourdomain"


def _build_task_email(
    *,
    decision: str,
    business_name: Optional[str],
    task: dict,
    reason: Optional[str] = None,
) -> Tuple[str, str, str]:
    safe_business = business_name or "our team"
    task_title = task.get("title") or "Your request"
    summary = task.get("summary") or ""
    reference = task.get("id") or ""
    customer_name = task.get("customerName")
    greeting = f"Hi {customer_name}," if customer_name else "Hi,"

    if decision == "accepted":
        subject = "Your request has been accepted"
        headline = "Accepted"
        status_line = f"{safe_business} has accepted your request."
        footer_line = "We'll reach out soon with the next steps."
    else:
        subject = "Your request has been rejected"
        headline = "Not accepted"
        status_line = f"{safe_business} could not accept your request at this time."
        footer_line = "Feel free to reply to this email or contact the business directly."

    reason_block = ""
    if reason:
        reason_block = f"<p style=\"margin:0 0 16px; color:#0f172a;\"><strong>Reason:</strong> {reason}</p>"

    html = f"""
<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>{subject}</title>
  </head>
  <body style=\"margin:0; padding:0; background:#f1f5f9; font-family:Arial, sans-serif; color:#0f172a;\">
    <table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"padding:32px 12px;\">
      <tr>
        <td align=\"center\">
          <table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:560px; background:#ffffff; border-radius:16px; padding:28px;\">
            <tr>
              <td>
                <p style=\"margin:0 0 6px; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:#64748b;\">AI Receptionist</p>
                <h1 style=\"margin:0 0 12px; font-size:22px; color:#0f172a;\">{headline}</h1>
                <p style=\"margin:0 0 16px; color:#0f172a;\">{greeting}</p>
                <p style=\"margin:0 0 16px; color:#0f172a;\">{status_line}</p>
                {reason_block}
                <div style=\"padding:16px; background:#f8fafc; border-radius:12px; border:1px solid #e2e8f0;\">
                  <p style=\"margin:0 0 8px; font-weight:600; color:#0f172a;\">{task_title}</p>
                  <p style=\"margin:0; color:#475569;\">{summary}</p>
                </div>
                <p style=\"margin:16px 0 0; color:#475569; font-size:13px;\">Reference: <strong>{reference}</strong></p>
                <p style=\"margin:16px 0 0; color:#475569;\">{footer_line}</p>
              </td>
            </tr>
          </table>
          <p style=\"margin:16px 0 0; font-size:11px; color:#94a3b8;\">Sent by {safe_business}</p>
        </td>
      </tr>
    </table>
  </body>
</html>
"""

    text_lines = [greeting, "", status_line]
    if reason:
        text_lines.append(f"Reason: {reason}")
    text_lines.extend([
        "",
        task_title,
        summary,
        f"Reference: {reference}",
        "",
        footer_line,
    ])
    text = "\n".join(line for line in text_lines if line is not None)
    return subject, html, text


def send_task_status_email(
    *,
    to_email: str,
    decision: str,
    business_name: Optional[str],
    task: dict,
    reason: Optional[str] = None,
) -> bool:
    if not to_email:
        return False
    subject, html, text = _build_task_email(
        decision=decision,
        business_name=business_name,
        task=task,
        reason=reason,
    )

    payload = {
        "personalizations": [{"to": [{"email": to_email}], "subject": subject}],
        "from": {"email": _from_email()},
        "content": [
            {"type": "text/plain", "value": text},
            {"type": "text/html", "value": html},
        ],
    }

    if not _sendgrid_enabled():
        logger.info("SendGrid disabled; email payload: %s", json.dumps(payload, ensure_ascii=True))
        return True

    api_key = os.getenv("SENDGRID_API_KEY")
    try:
        resp = requests.post(
            "https://api.sendgrid.com/v3/mail/send",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=10,
        )
        if resp.status_code >= 300:
            logger.warning("SendGrid send failed: %s %s", resp.status_code, resp.text)
            return False
        return True
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("SendGrid request failed: %s", exc)
        return False
