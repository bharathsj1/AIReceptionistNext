"""Signed account-owned number management and SMS routes."""
import os
from urllib.parse import parse_qs

import azure.functions as func
from twilio.request_validator import RequestValidator

from function_app import app
from outreach_endpoints import actor_for, body_for, response
from services import tenant_telephony as telephony
from shared.config import get_public_api_base
from shared.db import SessionLocal, NumberPurchase, OutreachSms


def handle(req, action, owner_only=False):
    if req.method == 'OPTIONS':
        return response(req, {})
    actor = actor_for(req)
    if not actor:
        return response(req, {'error': 'Sign in to manage your account numbers and messages'}, 401)
    if owner_only and (actor.scope != 'primary_user' or actor.role != 'admin'):
        return response(req, {'error': 'Only the account owner can purchase numbers'}, 403)
    db = SessionLocal()
    try:
        return action(db, actor)
    except telephony.TelephonyConflict as exc:
        db.rollback()
        return response(req, {'error': str(exc)}, 409)
    except (ValueError, TypeError) as exc:
        db.rollback()
        return response(req, {'error': str(exc)}, 400)
    except Exception:
        db.rollback()
        return response(req, {'error': 'Twilio is unavailable. Try checking the existing request before repeating an action.'}, 502)
    finally:
        db.close()


@app.route(route='outreach/numbers', methods=['GET', 'OPTIONS'], auth_level=func.AuthLevel.ANONYMOUS)
def account_numbers(req):
    def action(db, actor):
        telephony.ensure_reserved_number(db, actor.client_id)
        return response(req, {'items': [telephony.number_payload(n) for n in telephony.own_numbers(db, actor.client_id)]})
    return handle(req, action)


@app.route(route='outreach/numbers/available', methods=['GET', 'OPTIONS'], auth_level=func.AuthLevel.ANONYMOUS)
def available_account_numbers(req):
    return handle(req, lambda db, actor: response(req, telephony.available_numbers(db, actor.client_id,
        req.params.get('number_type', 'mobile'), req.params.get('contains', ''))), owner_only=True)


@app.route(route='outreach/numbers/purchase', methods=['POST', 'OPTIONS'], auth_level=func.AuthLevel.ANONYMOUS)
def purchase_account_number(req):
    return handle(req, lambda db, actor: response(req,
        {'purchase': telephony.purchase_payload(telephony.purchase_number(db, actor.client_id, body_for(req)))}), owner_only=True)


@app.route(route='outreach/numbers/purchases/{purchase_id}', methods=['GET', 'OPTIONS'], auth_level=func.AuthLevel.ANONYMOUS)
def account_number_purchase(req):
    def action(db, actor):
        row = db.query(NumberPurchase).filter_by(id=req.route_params.get('purchase_id'), client_id=actor.client_id).first()
        if not row:
            return response(req, {'error': 'Purchase not found'}, 404)
        return response(req, {'purchase': telephony.purchase_payload(telephony.reconcile_purchase(db, row))})
    return handle(req, action, owner_only=True)


@app.route(route='outreach/numbers/purchases', methods=['GET', 'OPTIONS'], auth_level=func.AuthLevel.ANONYMOUS)
def account_number_purchases(req):
    return handle(req, lambda db, actor: response(req, {'items': [telephony.purchase_payload(row) for row in
        db.query(NumberPurchase).filter_by(client_id=actor.client_id).filter(NumberPurchase.status != 'completed')
        .order_by(NumberPurchase.created_at.desc()).limit(20).all()]}))


@app.route(route='outreach/messages', methods=['GET', 'POST', 'OPTIONS'], auth_level=func.AuthLevel.ANONYMOUS)
def account_messages(req):
    def action(db, actor):
        if req.method == 'POST':
            return response(req, {'message': telephony.sms_payload(telephony.send_sms(db, actor.client_id, body_for(req)))})
        rows = db.query(OutreachSms).filter_by(client_id=actor.client_id).order_by(OutreachSms.created_at.desc()).limit(50).all()
        return response(req, {'items': [telephony.sms_payload(row) for row in rows]})
    return handle(req, action)


@app.route(route='outreach/messages/{message_id}', methods=['GET', 'OPTIONS'], auth_level=func.AuthLevel.ANONYMOUS)
def account_message(req):
    def action(db, actor):
        row = db.query(OutreachSms).filter_by(id=req.route_params.get('message_id'), client_id=actor.client_id).first()
        if not row:
            return response(req, {'error': 'Message not found'}, 404)
        return response(req, {'message': telephony.sms_payload(telephony.refresh_sms(db, row))})
    return handle(req, action)


@app.route(route='outreach/messages/{message_id}/status', methods=['POST'], auth_level=func.AuthLevel.ANONYMOUS)
def account_message_status(req):
    try:
        if len(req.get_body()) > 16384:
            raise ValueError('Callback is too large')
        parsed = parse_qs(req.get_body().decode('utf-8'), keep_blank_values=True)
        if any(len(values) != 1 for values in parsed.values()):
            raise ValueError('Duplicate callback fields')
        form = {key: values[0] for key, values in parsed.items()}
    except (ValueError, UnicodeDecodeError):
        return response(req, {'error': 'Invalid message callback'}, 400)
    url = f"{get_public_api_base()}/api/outreach/messages/{req.route_params.get('message_id')}/status"
    token = os.getenv('TWILIO_AUTH_TOKEN')
    if not token or not RequestValidator(token).validate(url, form, req.headers.get('X-Twilio-Signature', '')):
        return response(req, {'error': 'Invalid Twilio signature'}, 403)
    if form.get('AccountSid') != os.getenv('TWILIO_ACCOUNT_SID'):
        return response(req, {'error': 'Provider account mismatch'}, 403)
    db = SessionLocal()
    try:
        row = db.get(OutreachSms, req.route_params.get('message_id'))
        if not row:
            return response(req, {'error': 'Message not found'}, 404)
        if form.get('From') != row.from_number or form.get('To') != row.to_number:
            return response(req, {'error': 'Message numbers do not match'}, 403)
        telephony.apply_sms_status(db, row, form.get('MessageSid'), form.get('MessageStatus'), form.get('ErrorCode'))
        return response(req, {'ok': True})
    except ValueError as exc:
        db.rollback()
        return response(req, {'error': str(exc)}, 400)
    finally:
        db.close()
