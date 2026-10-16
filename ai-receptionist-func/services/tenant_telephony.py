"""Exclusive account-owned Twilio numbers, durable purchases and single SMS sends."""
import json
import logging
import os
import re
from decimal import Decimal, InvalidOperation
from uuid import UUID, uuid5, NAMESPACE_URL

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from twilio.base.exceptions import TwilioRestException

from services.outreach_service import twilio_client, normalize_uk_phone
from services.outreach_history import iso
from shared.config import get_public_api_base
from shared.db import Client, PhoneNumber, TenantPhoneNumber, NumberPurchase, OutreachSms, OutreachSuppression

logger = logging.getLogger(__name__)
RESERVED_PHONE = '+447861937466'
RESERVED_OWNER = 'bharath.sj1@gmail.com'
RESERVED_SID = 'PNc4cdbbe58f3b6a52c573f048046213c2'


class TelephonyConflict(ValueError):
    pass


def request_key(client_id, kind, value):
    try:
        token = str(UUID(str(value)))
    except ValueError as exc:
        raise ValueError('A valid request_id UUID is required') from exc
    return str(uuid5(NAMESPACE_URL, f'vedora:{kind}:{client_id}:{token}'))


def account_email(db, client_id):
    client = db.get(Client, client_id)
    return str(client.email if client else '').strip().lower()


def reserved_allowed(db, client_id, phone):
    return phone != RESERVED_PHONE or account_email(db, client_id) == RESERVED_OWNER


def number_payload(row):
    return {'sid': row.sid, 'phone_number': row.phone_number, 'voice_enabled': row.voice_enabled,
            'sms_enabled': row.sms_enabled, 'number_type': row.number_type, 'is_active': row.is_active}


def capabilities(provider):
    # AvailablePhoneNumbers uses "SMS"/"MMS"; purchased number resources use
    # lowercase names. Normalize both provider representations before checking.
    return {str(key).lower(): value is True for key, value in (provider.capabilities or {}).items()}


def own_numbers(db, client_id):
    return [row for row in db.query(TenantPhoneNumber).filter_by(client_id=client_id, is_active=True,
        account_sid=os.getenv('TWILIO_ACCOUNT_SID', '')).order_by(TenantPhoneNumber.created_at).all()
        if reserved_allowed(db, client_id, row.phone_number)]


def require_number(db, client_id, phone, capability):
    row = db.query(TenantPhoneNumber).filter_by(client_id=client_id, phone_number=phone,
        is_active=True, account_sid=os.getenv('TWILIO_ACCOUNT_SID', '')).first()
    if not row or not reserved_allowed(db, client_id, phone):
        raise ValueError('Choose a number purchased for your account')
    if not getattr(row, f'{capability}_enabled'):
        raise ValueError(f'This number does not support {capability.upper()}')
    return row


def register_number(db, client_id, provider, number_type='mobile'):
    phone, sid = provider.phone_number, provider.sid
    if not reserved_allowed(db, client_id, phone):
        raise TelephonyConflict('This number belongs to a different account')
    existing = db.query(TenantPhoneNumber).filter_by(phone_number=phone).first()
    legacy = db.query(PhoneNumber).filter_by(twilio_phone_number=phone).first()
    if (existing and existing.client_id != client_id) or (legacy and legacy.client_id != client_id):
        raise TelephonyConflict('This number is already assigned to another account')
    if existing and existing.sid != sid:
        raise TelephonyConflict('This number’s provider reference changed; administrator review is required')
    if provider.account_sid != os.getenv('TWILIO_ACCOUNT_SID'):
        raise TelephonyConflict('Twilio returned a number from another provider account')
    supported = capabilities(provider)
    row = existing or TenantPhoneNumber(sid=sid, client_id=client_id, phone_number=phone,
        account_sid=provider.account_sid, number_type=number_type)
    row.voice_enabled = supported.get('voice', False)
    row.sms_enabled = supported.get('sms', False)
    row.is_active = True
    db.add(row)
    if not legacy:
        db.add(PhoneNumber(client_id=client_id, twilio_phone_number=phone, twilio_sid=sid, is_active=True))
    else:
        legacy.twilio_sid, legacy.is_active = sid, True
    db.flush()
    return row


def ensure_reserved_number(db, client_id):
    # This explicitly approved import never lists or reuses general account inventory.
    if account_email(db, client_id) != RESERVED_OWNER or not os.getenv('TWILIO_ACCOUNT_SID'):
        return
    existing = db.query(TenantPhoneNumber).filter_by(phone_number=RESERVED_PHONE).first()
    if existing:
        if existing.client_id != client_id:
            raise TelephonyConflict('Reserved number ownership needs administrator review')
        return
    provider = twilio_client().incoming_phone_numbers(RESERVED_SID).fetch()
    if provider.phone_number != RESERVED_PHONE or provider.sid != RESERVED_SID:
        raise TelephonyConflict('Reserved Twilio number does not match its approved assignment')
    register_number(db, client_id, provider)
    db.commit()


def monthly_prices(provider):
    pricing = provider.pricing.v1.phone_numbers.countries('GB').fetch()
    if not pricing.price_unit or not pricing.phone_number_prices:
        raise TelephonyConflict('Number pricing is unavailable; purchasing is disabled')
    return {p['number_type']: str(p['current_price']) for p in pricing.phone_number_prices}, pricing.price_unit.upper()


def available_numbers(db, client_id, number_type='mobile', contains=''):
    if number_type not in {'mobile', 'local'}:
        raise ValueError('Choose mobile or local UK numbers')
    if contains and not re.fullmatch(r'[0-9]{2,10}', contains):
        raise ValueError('Search using 2–10 digits')
    provider = twilio_client()
    prices, currency = monthly_prices(provider)
    if number_type not in prices:
        raise TelephonyConflict('Pricing for this number type is unavailable')
    options = {'sms_enabled': True, 'voice_enabled': True, 'limit': 10}
    if contains:
        options['contains'] = contains
    items = getattr(provider.available_phone_numbers('GB'), number_type).list(**options)
    assigned = {row.phone_number for row in db.query(TenantPhoneNumber).all()}
    assigned.update(row.twilio_phone_number for row in db.query(PhoneNumber).all())
    return {'items': [{'phone_number': item.phone_number, 'number_type': number_type,
        'monthly_price': prices[number_type], 'currency': currency,
        'address_requirements': item.address_requirements,
        'voice_enabled': True, 'sms_enabled': True} for item in items
        if item.phone_number not in assigned and item.phone_number != RESERVED_PHONE
        and capabilities(item).get('voice') and capabilities(item).get('sms')]}


def purchase_payload(row):
    return {'id': row.id, 'phone_number': row.phone_number, 'status': row.status,
        'monthly_price': row.monthly_price, 'currency': row.currency, 'error': row.error}


def regulatory_settings(db, client_id):
    # Regulatory identities belong to individual customers, never a shared global default.
    raw = json.loads(os.getenv('OUTREACH_NUMBER_REGULATORY_SETTINGS', '{}'))
    values = raw.get(account_email(db, client_id), {})
    result = {}
    for key, prefix in [('address_sid', 'AD'), ('bundle_sid', 'BU')]:
        value = values.get(key)
        if value:
            if not re.fullmatch(prefix + r'[0-9a-fA-F]{32}', value):
                raise ValueError('The account regulatory configuration needs administrator review')
            result[key] = value
    return result


def reconcile_purchase(db, row):
    if row.status not in {'purchasing', 'needs_review'}:
        return row
    # A timeout may have purchased the number. Only this operation's provider tag
    # can prove ownership; never adopt an unrelated existing Twilio number.
    matches = twilio_client().incoming_phone_numbers.list(phone_number=row.phone_number, limit=2)
    for item in matches:
        if item.phone_number == row.phone_number and item.friendly_name == f'Outreach purchase {row.id}':
            register_number(db, row.client_id, item, row.number_type)
            row.status, row.number_sid, row.error = 'completed', item.sid, None
            db.commit()
            break
    return row


def purchase_number(db, client_id, body):
    key = request_key(client_id, 'number', body.get('request_id'))
    phone = normalize_uk_phone(body.get('phone_number'))
    kind = body.get('number_type')
    if kind not in {'mobile', 'local'} or body.get('confirm_purchase') is not True:
        raise ValueError('Select a number type and confirm its monthly purchase charge')
    expected_price, currency = str(body.get('monthly_price', '')), str(body.get('currency', '')).upper()
    existing = db.get(NumberPurchase, key)
    if existing:
        if (existing.phone_number, existing.number_type, existing.monthly_price, existing.currency) != (phone, kind, expected_price, currency):
            raise TelephonyConflict('This request already belongs to a different purchase')
        return reconcile_purchase(db, existing)
    if phone == RESERVED_PHONE or db.query(TenantPhoneNumber).filter_by(phone_number=phone).first() or db.query(PhoneNumber).filter_by(twilio_phone_number=phone).first():
        raise TelephonyConflict('This number is already owned; choose an available number')
    provider = twilio_client()
    prices, actual_currency = monthly_prices(provider)
    try:
        same_price = kind in prices and Decimal(expected_price) == Decimal(prices[kind])
    except InvalidOperation:
        same_price = False
    if not same_price or currency != actual_currency:
        raise TelephonyConflict('The monthly price has changed. Search again and review the new quote.')
    available = getattr(provider.available_phone_numbers('GB'), kind).list(contains=phone, sms_enabled=True, voice_enabled=True, limit=10)
    if not any(item.phone_number == phone and capabilities(item).get('sms') and capabilities(item).get('voice') for item in available):
        raise TelephonyConflict('This number is no longer available with both calls and SMS')
    kwargs = regulatory_settings(db, client_id)
    row = NumberPurchase(id=key, client_id=client_id, phone_number=phone, number_type=kind,
        monthly_price=expected_price, currency=currency, status='purchasing')
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return purchase_number(db, client_id, body)
    try:
        purchased = provider.incoming_phone_numbers.create(phone_number=phone,
            friendly_name=f'Outreach purchase {key}', **kwargs)
        if purchased.phone_number != phone:
            raise TelephonyConflict('Provider number differs from the selected number; administrator review required')
        register_number(db, client_id, purchased, kind)
        row.number_sid, row.status = purchased.sid, 'completed'
        db.commit()
    except TwilioRestException as exc:
        db.rollback()
        row = db.get(NumberPurchase, key)
        if row.status == 'completed':
            return row
        row.status = 'failed' if exc.status and 400 <= exc.status < 500 else 'needs_review'
        row.error = f'Twilio rejected the purchase (code {exc.code}). Check number availability and this account’s approved regulatory bundle/address.' if row.status == 'failed' else 'Purchase outcome is uncertain. Check its status before buying another number.'
        db.commit()
    except Exception:
        db.rollback()
        row = db.get(NumberPurchase, key)
        if row.status == 'completed':
            return row
        row.status, row.error = 'needs_review', 'Purchase outcome is uncertain. Check its status before buying another number.'
        db.commit()
        logger.warning('Number purchase %s needs review', key)
    return row


def sms_payload(row):
    return {'id': row.id, 'from_number': row.from_number, 'to_number': row.to_number,
        'body': row.body, 'status': row.status, 'error': row.error, 'created_at': iso(row.created_at)}


SMS_STATES = {'queued': 0, 'accepted': 0, 'sending': 1, 'sent': 2, 'delivered': 3, 'undelivered': 3, 'failed': 3}


def apply_sms_status(db, row, sid, status, error=None):
    if status not in SMS_STATES or not sid or (row.message_sid and row.message_sid != sid):
        raise ValueError('Message status does not match this attempt')
    eligible = ['preparing', 'needs_review'] + [state for state, rank in SMS_STATES.items()
        if rank < 3 and rank <= SMS_STATES[status]]
    db.query(OutreachSms).filter(OutreachSms.id == row.id, OutreachSms.status.in_(eligible),
        or_(OutreachSms.message_sid.is_(None), OutreachSms.message_sid == sid)).update(
            {'message_sid': sid, 'status': status, 'error': str(error)[:500] if error else None},
            synchronize_session=False)
    db.commit()
    db.refresh(row)


def refresh_sms(db, row):
    if row.message_sid and row.status not in {'delivered', 'undelivered', 'failed'}:
        item = twilio_client().messages(row.message_sid).fetch()
        if item.from_ != row.from_number or item.to != row.to_number:
            raise TelephonyConflict('Provider message does not match this account record')
        apply_sms_status(db, row, item.sid, item.status, item.error_message)
    return row


def send_sms(db, client_id, body):
    key = request_key(client_id, 'sms', body.get('request_id'))
    sender = str(body.get('from_number') or '').strip()
    recipient = normalize_uk_phone(body.get('to_number'))
    text = body.get('body')
    if not isinstance(text, str) or not text.strip() or len(text) > 1600:
        raise ValueError('Enter a message of 1–1,600 characters')
    existing = db.get(OutreachSms, key)
    if existing:
        if (existing.from_number, existing.to_number, existing.body) != (sender, recipient, text):
            raise TelephonyConflict('This request already belongs to another message')
        return existing
    require_number(db, client_id, sender, 'sms')
    if db.get(OutreachSuppression, (client_id, recipient)):
        raise TelephonyConflict('This recipient opted out of outreach')
    base = get_public_api_base()
    row = OutreachSms(id=key, client_id=client_id, from_number=sender, to_number=recipient, body=text, status='preparing')
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return send_sms(db, client_id, body)
    try:
        callback = {'status_callback': f'{base}/api/outreach/messages/{key}/status'} if base.startswith('https://') else {}
        message = twilio_client().messages.create(from_=sender, to=recipient, body=text, **callback)
        db.refresh(row)  # A signed callback can arrive before the create response.
        apply_sms_status(db, row, message.sid, message.status, message.error_message)
    except TwilioRestException as exc:
        db.rollback()
        db.refresh(row)
        if not row.message_sid:
            row.status = 'failed' if exc.status and 400 <= exc.status < 500 else 'needs_review'
            row.error = f'Twilio rejected the message (code {exc.code})' if row.status == 'failed' else 'Message outcome is uncertain. Check status before sending again.'
            db.commit()
    except Exception:
        db.rollback()
        db.refresh(row)
        if not row.message_sid:
            row.status, row.error = 'needs_review', 'Message outcome is uncertain. Check status before sending again.'
            db.commit()
    return row
