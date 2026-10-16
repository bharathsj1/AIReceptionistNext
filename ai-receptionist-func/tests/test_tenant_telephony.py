import importlib.util
import json
import os
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import urlencode
from uuid import uuid4

import azure.functions as func
import requests
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from twilio.base.exceptions import TwilioRestException
from twilio.request_validator import RequestValidator
from services import tenant_telephony as service
from services import outreach_service as outreach
from shared.db import Base, Client, PhoneNumber, CallerNumber, TenantPhoneNumber, NumberPurchase, OutreachSms
from test_outreach import SETTINGS, ACTOR


def load_module(name, filename):
    fake = types.ModuleType('function_app'); fake.app = func.FunctionApp()
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / filename)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'function_app': fake}): spec.loader.exec_module(module)
    return module


endpoints = load_module('number_test_endpoints', 'number_endpoints.py')
legacy_voice = load_module('number_test_legacy_voice', 'voice_endpoints.py')
legacy_onboarding = load_module('number_test_legacy_onboarding', 'onboarding_endpoints.py')
PHONE, SECOND, BUY = '+442079460000', '+442079460019', '+447495957011'
SMS_SID = 'SM' + '1' * 32


def provider_number(phone=BUY, sid=None, account=None, friendly=''):
    return SimpleNamespace(phone_number=phone, sid=sid or 'PN' + '3' * 32,
        account_sid=account or SETTINGS['TWILIO_ACCOUNT_SID'], capabilities={'voice': True, 'sms': True},
        friendly_name=friendly, address_requirements='none')


class TenantTelephonyTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, SETTINGS); self.environment.start()
        self.engine = create_engine('sqlite:///:memory:'); Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine); self.db = self.Session()
        self.db.add_all([Client(id=1, email='owner@example.com', website_url='https://example.com'),
            Client(id=2, email='other@example.com', website_url='https://example.com'),
            Client(id=3, email=service.RESERVED_OWNER, website_url='https://example.com')])
        self.db.commit()
        service.register_number(self.db, 1, provider_number(PHONE, 'PN' + '1' * 32), 'local')
        service.register_number(self.db, 2, provider_number(SECOND, 'PN' + '2' * 32), 'local'); self.db.commit()
        self.provider = Mock()
        self.provider.pricing.v1.phone_numbers.countries.return_value.fetch.return_value = SimpleNamespace(
            price_unit='GBP', phone_number_prices=[{'number_type': 'mobile', 'current_price': '1.89'}])
        self.provider.available_phone_numbers.return_value.mobile.list.return_value = [provider_number()]
        self.provider.incoming_phone_numbers.create.return_value = provider_number()
        self.provider.incoming_phone_numbers.list.return_value = []
        self.provider.messages.create.return_value = SimpleNamespace(sid=SMS_SID, status='queued', error_message=None)
        self.provider_patch = patch.object(service, 'twilio_client', return_value=self.provider); self.provider_patch.start()
        self.purchase = {'request_id': str(uuid4()), 'phone_number': BUY, 'number_type': 'mobile',
            'monthly_price': '1.89', 'currency': 'GBP', 'confirm_purchase': True}
        self.sms = {'request_id': str(uuid4()), 'from_number': PHONE, 'to_number': '+447495957010', 'body': 'Test message'}

    def tearDown(self):
        self.provider_patch.stop(); self.environment.stop(); self.db.close(); self.engine.dispose()

    def api(self, handler, method='GET', body=None, params=None, routes=None, actor=ACTOR):
        req = func.HttpRequest(method, 'https://example.com/api/outreach/numbers', params=params or {},
            route_params=routes or {}, body=json.dumps(body).encode() if body is not None else b'')
        with patch.object(endpoints, 'actor_for', return_value=actor), patch.object(endpoints, 'SessionLocal', self.Session): response = handler(req)
        return response.status_code, json.loads(response.get_body())

    def test_numbers_and_callers_are_exclusively_tenant_owned(self):
        self.assertEqual([n.phone_number for n in service.own_numbers(self.db, 1)], [PHONE])
        self.assertEqual(outreach.caller_numbers(self.db, 1), [PHONE])
        self.assertEqual(outreach.caller_numbers(self.db, 2), [SECOND])
        self.assertEqual(service.own_numbers(self.db, 3), [])

    def test_shared_legacy_caller_rows_cannot_grant_foreign_or_reserved_numbers(self):
        self.db.add(CallerNumber(client_id=2, phone_number=PHONE, is_active=True))
        self.db.add(PhoneNumber(client_id=2, twilio_phone_number=service.RESERVED_PHONE, twilio_sid=service.RESERVED_SID, is_active=True)); self.db.commit()
        self.assertNotIn(PHONE, outreach.caller_numbers(self.db, 2))
        self.assertNotIn(service.RESERVED_PHONE, outreach.caller_numbers(self.db, 2))
        with self.assertRaises(ValueError): service.require_number(self.db, 2, service.RESERVED_PHONE, 'sms')
        service.ensure_reserved_number(self.db, 2); self.provider.incoming_phone_numbers.assert_not_called()

    def test_reserved_import_verifies_provider_and_assigns_only_named_owner(self):
        self.provider.incoming_phone_numbers.return_value.fetch.return_value = provider_number(service.RESERVED_PHONE, service.RESERVED_SID)
        service.ensure_reserved_number(self.db, 3); service.ensure_reserved_number(self.db, 3)
        self.assertEqual([n.phone_number for n in service.own_numbers(self.db, 3)], [service.RESERVED_PHONE])
        self.provider.incoming_phone_numbers.return_value.fetch.assert_called_once()
        with self.assertRaises(ValueError): service.require_number(self.db, 1, service.RESERVED_PHONE, 'voice')

    def test_reserved_import_rejects_wrong_resource_or_provider_account(self):
        for item in [provider_number(service.RESERVED_PHONE),
                     provider_number(service.RESERVED_PHONE, service.RESERVED_SID, 'AC' + '9' * 32)]:
            self.provider.incoming_phone_numbers.return_value.fetch.return_value = item
            with self.subTest(sid=item.sid), self.assertRaises(service.TelephonyConflict):
                service.ensure_reserved_number(self.db, 3)
        self.assertEqual(service.own_numbers(self.db, 3), [])

    def test_reserved_import_requires_provider_configuration(self):
        with patch.dict(os.environ, {'TWILIO_ACCOUNT_SID': ''}):
            service.ensure_reserved_number(self.db, 3)
        self.provider.incoming_phone_numbers.assert_not_called()

    def test_registration_cannot_transfer_ownership_or_import_foreign_provider_number(self):
        for client_id, item in [(2, provider_number(PHONE)), (1, provider_number(account='AC' + '9' * 32)), (1, provider_number(service.RESERVED_PHONE))]:
            with self.subTest(client=client_id), self.assertRaises(service.TelephonyConflict): service.register_number(self.db, client_id, item)
        self.assertEqual(self.db.query(TenantPhoneNumber).count(), 2)

    def test_search_requires_both_capabilities_and_excludes_all_owned_numbers(self):
        self.provider.available_phone_numbers.return_value.mobile.list.return_value = [provider_number(), provider_number(PHONE), provider_number(service.RESERVED_PHONE)]
        data = service.available_numbers(self.db, 1)
        self.assertEqual([n['phone_number'] for n in data['items']], [BUY])
        self.assertEqual(data['items'][0]['monthly_price'], '1.89')
        args = self.provider.available_phone_numbers.return_value.mobile.list.call_args.kwargs
        self.assertTrue(args['sms_enabled']); self.assertTrue(args['voice_enabled'])

    def test_available_number_sms_capability_uses_provider_uppercase_spelling(self):
        item = provider_number(); item.capabilities = {'voice': True, 'SMS': True, 'MMS': False}
        self.provider.available_phone_numbers.return_value.mobile.list.return_value = [item]
        self.assertEqual(service.available_numbers(self.db, 1)['items'][0]['phone_number'], BUY)
        self.assertEqual(service.purchase_number(self.db, 1, self.purchase).status, 'completed')

    def test_local_sms_sends_without_callback_and_can_poll_provider(self):
        with patch.dict(os.environ, {'API_PUBLIC_BASE_URL': 'http://localhost:7071'}):
            row = service.send_sms(self.db, 1, self.sms)
        self.assertNotIn('status_callback', self.provider.messages.create.call_args.kwargs)
        self.provider.messages.return_value.fetch.return_value = SimpleNamespace(from_=PHONE, to=row.to_number,
            sid=SMS_SID, status='delivered', error_message=None)
        self.assertEqual(service.refresh_sms(self.db, row).status, 'delivered')

    def test_purchase_requires_explicit_confirmation_and_unchanged_price(self):
        for changes in [{'confirm_purchase': False}, {'monthly_price': '0'}, {'currency': 'USD'}, {'number_type': 'toll_free'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError): service.purchase_number(self.db, 1, {**self.purchase, **changes})
        self.provider.incoming_phone_numbers.create.assert_not_called()

    def test_unavailable_or_single_capability_numbers_are_not_purchased(self):
        for caps in ({'voice': True, 'sms': False}, {'voice': False, 'sms': True}):
            item = provider_number(); item.capabilities = caps
            self.provider.available_phone_numbers.return_value.mobile.list.return_value = [item]
            with self.assertRaises(service.TelephonyConflict): service.purchase_number(self.db, 1, self.purchase)
        self.provider.incoming_phone_numbers.create.assert_not_called()

    def test_purchase_persists_assignment_and_replay_survives_restart(self):
        row = service.purchase_number(self.db, 1, self.purchase); row_id = row.id
        self.assertEqual(row.status, 'completed'); self.assertIn(BUY, outreach.caller_numbers(self.db, 1)); self.assertNotIn(BUY, outreach.caller_numbers(self.db, 2))
        self.db.close(); self.db = self.Session()
        self.assertEqual(service.purchase_number(self.db, 1, self.purchase).id, row_id)
        self.provider.incoming_phone_numbers.create.assert_called_once()

    def test_existing_request_and_owned_number_cannot_be_reassigned(self):
        service.purchase_number(self.db, 1, self.purchase)
        with self.assertRaises(service.TelephonyConflict): service.purchase_number(self.db, 1, {**self.purchase, 'phone_number': '+447495957012'})
        with self.assertRaises(service.TelephonyConflict): service.purchase_number(self.db, 2, {**self.purchase, 'request_id': str(uuid4())})
        self.provider.incoming_phone_numbers.create.assert_called_once()

    def test_purchase_timeout_reconciles_only_its_provider_tag_without_rebuying(self):
        self.provider.incoming_phone_numbers.create.side_effect = requests.Timeout()
        row = service.purchase_number(self.db, 1, self.purchase); self.assertEqual(row.status, 'needs_review')
        self.provider.incoming_phone_numbers.list.return_value = [provider_number(friendly='Another customer')]
        self.assertEqual(service.purchase_number(self.db, 1, self.purchase).status, 'needs_review')
        self.assertIsNone(self.db.query(TenantPhoneNumber).filter_by(phone_number=BUY).first())
        self.provider.incoming_phone_numbers.list.return_value = [provider_number(friendly=f'Outreach purchase {row.id}')]
        self.assertEqual(service.purchase_number(self.db, 1, self.purchase).status, 'completed')
        self.provider.incoming_phone_numbers.create.assert_called_once()

    def test_rejected_purchase_has_no_assigned_number(self):
        self.provider.incoming_phone_numbers.create.side_effect = TwilioRestException(400, '/test', msg='Bundle required', code=21649)
        row = service.purchase_number(self.db, 1, self.purchase)
        self.assertEqual(row.status, 'failed'); self.assertIn('21649', row.error)
        self.assertIsNone(self.db.query(TenantPhoneNumber).filter_by(phone_number=BUY).first())

    def test_regulatory_bundle_uses_customer_configuration_not_shared_defaults(self):
        settings = {'owner@example.com': {'bundle_sid': 'BU' + '1' * 32}, 'other@example.com': {'address_sid': 'AD' + '2' * 32}}
        with patch.dict(os.environ, {'OUTREACH_NUMBER_REGULATORY_SETTINGS': json.dumps(settings), 'TWILIO_BUNDLE_SID': 'BU' + '9' * 32}): service.purchase_number(self.db, 1, self.purchase)
        args = self.provider.incoming_phone_numbers.create.call_args.kwargs
        self.assertEqual(args['bundle_sid'], 'BU' + '1' * 32); self.assertNotIn('address_sid', args)

    def test_sms_rejects_foreign_inactive_or_non_sms_sender_before_provider_access(self):
        with self.assertRaises(ValueError): service.send_sms(self.db, 2, self.sms)
        row = self.db.query(TenantPhoneNumber).filter_by(phone_number=PHONE).one()
        row.sms_enabled = False; self.db.commit()
        with self.assertRaises(ValueError): service.send_sms(self.db, 1, self.sms)
        row.sms_enabled, row.is_active = True, False; self.db.commit()
        with self.assertRaises(ValueError): service.send_sms(self.db, 1, self.sms)
        self.provider.messages.create.assert_not_called()

    def test_sms_is_durable_and_replayed_without_sending_again(self):
        row = service.send_sms(self.db, 1, self.sms); row_id = row.id
        self.assertEqual(row.status, 'queued'); self.assertIn(row.id, self.provider.messages.create.call_args.kwargs['status_callback'])
        self.db.close(); self.db = self.Session()
        self.assertEqual(service.send_sms(self.db, 1, self.sms).id, row_id)
        with self.assertRaises(service.TelephonyConflict): service.send_sms(self.db, 1, {**self.sms, 'body': 'Changed'})
        self.provider.messages.create.assert_called_once()

    def test_sms_timeout_does_not_retry(self):
        self.provider.messages.create.side_effect = requests.Timeout()
        row = service.send_sms(self.db, 1, self.sms); self.assertEqual(row.status, 'needs_review')
        service.send_sms(self.db, 1, self.sms); self.provider.messages.create.assert_called_once()

    def test_sms_status_never_regresses_or_switches_provider_reference(self):
        row = service.send_sms(self.db, 1, self.sms)
        service.apply_sms_status(self.db, row, SMS_SID, 'delivered'); service.apply_sms_status(self.db, row, SMS_SID, 'queued')
        self.assertEqual(row.status, 'delivered')
        with self.assertRaises(ValueError): service.apply_sms_status(self.db, row, 'SM' + '2' * 32, 'sent')

    def test_api_requires_session_ignores_email_claim_and_preflight_does_not_purchase(self):
        self.assertEqual(self.api(endpoints.account_numbers, actor=None, params={'email': service.RESERVED_OWNER})[0], 401)
        self.assertEqual([n['phone_number'] for n in self.api(endpoints.account_numbers, params={'email': service.RESERVED_OWNER})[1]['items']], [PHONE])
        self.assertEqual(self.api(endpoints.purchase_account_number, method='OPTIONS', actor=None)[0], 200)
        self.provider.incoming_phone_numbers.create.assert_not_called()

    def test_cross_tenant_messages_and_purchases_are_hidden_and_buying_requires_owner(self):
        row = service.purchase_number(self.db, 1, self.purchase)
        other = SimpleNamespace(client_id=2, role='admin', scope='primary_user')
        self.assertEqual(self.api(endpoints.account_number_purchase, routes={'purchase_id': row.id}, actor=other)[0], 404)
        member = SimpleNamespace(client_id=1, role='manager', scope='client_user')
        self.assertEqual(self.api(endpoints.purchase_account_number, method='POST', body=self.purchase, actor=member)[0], 403)
        sms = service.send_sms(self.db, 1, self.sms)
        self.assertEqual(self.api(endpoints.account_message, routes={'message_id': sms.id}, actor=other)[0], 404)
        self.assertEqual(self.api(endpoints.account_messages, actor=other)[1]['items'], [])
        self.provider.messages.return_value.fetch.assert_not_called()

    def test_unresolved_purchase_can_be_found_after_refresh_only_by_its_account(self):
        self.provider.incoming_phone_numbers.create.side_effect = requests.Timeout()
        purchase = service.purchase_number(self.db, 1, self.purchase)
        mine = self.api(endpoints.account_number_purchases)[1]['items']
        self.assertEqual(mine[0]['id'], purchase.id)
        other = SimpleNamespace(client_id=2, role='admin', scope='primary_user')
        self.assertEqual(self.api(endpoints.account_number_purchases, actor=other)[1]['items'], [])

    def test_callback_requires_signature_account_and_matching_numbers(self):
        row = service.send_sms(self.db, 1, self.sms); path = f'/api/outreach/messages/{row.id}/status'
        form = {'AccountSid': SETTINGS['TWILIO_ACCOUNT_SID'], 'MessageSid': SMS_SID, 'MessageStatus': 'delivered', 'From': PHONE, 'To': row.to_number}
        def callback(values, signed=True):
            signature = RequestValidator(SETTINGS['TWILIO_AUTH_TOKEN']).compute_signature('https://example.com' + path, values) if signed else 'bad'
            req = func.HttpRequest('POST', 'http://backend' + path, params={}, route_params={'message_id': row.id}, headers={'X-Twilio-Signature': signature}, body=urlencode(values).encode())
            with patch.object(endpoints, 'SessionLocal', self.Session): return endpoints.account_message_status(req)
        self.assertEqual(callback(form, False).status_code, 403)
        self.assertEqual(callback({**form, 'From': SECOND}).status_code, 403)
        self.assertEqual(callback({**form, 'AccountSid': 'AC' + '9' * 32}).status_code, 403)
        self.assertEqual(callback(form).status_code, 200); self.db.refresh(row); self.assertEqual(row.status, 'delivered')

    def test_legacy_shared_routes_are_retired(self):
        req = func.HttpRequest('POST', 'https://example.com/api/test', params={'email': service.RESERVED_OWNER}, body=b'{}')
        for handler in (legacy_voice.voice_token, legacy_voice.voice_outbound, legacy_voice.call_history, legacy_onboarding.clients_assign_number, legacy_onboarding.clients_provision, legacy_onboarding.twilio_available_numbers): self.assertEqual(handler(req).status_code, 410)
        self.provider.incoming_phone_numbers.create.assert_not_called()
