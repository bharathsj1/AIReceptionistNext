"""Financial boundary tests: all Stripe, Twilio and Ultravox I/O is mocked."""
from endpoint_imports import function_app_module
import importlib.util
import json
import hashlib
import hmac
import time
import os
import sys
import types
import tempfile
from concurrent.futures import ThreadPoolExecutor
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

import azure.functions as func
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from services import outreach_billing as billing, outreach_payments as payments, outreach_pricing as pricing
from services import outreach_service as calls, manual_outreach as manual, tenant_telephony as numbers
from shared.db import (Base, Client, PhoneNumber, OutreachCampaign, OutreachLead, OutreachSuppression,
    OutreachWallet, OutreachWalletEntry, OutreachPaymentOrder, OutreachCallQuote, OutreachCampaignBilling,
    OutreachCallCharge, OutreachBillingSetting, NumberPurchase, TenantPhoneNumber)
from test_outreach import SETTINGS, ACTOR, SID


def endpoint_module():
    fake = types.ModuleType('function_app'); fake.app = func.FunctionApp()
    spec = importlib.util.spec_from_file_location('billing_test_endpoints', Path(__file__).resolve().parents[1] / 'billing_endpoints.py')
    module = importlib.util.module_from_spec(spec)
    with function_app_module(fake): spec.loader.exec_module(module)
    return module


api = endpoint_module()
CALLER, DEST, BUY = '+442079460000', '+442079460018', '+447495957011'
RATE = {'rate_gbp': '0.12', 'twilio_gbp': '0.02', 'ultravox_gbp': '0.04', 'currency': 'GBP', 'markup_mode': 'combined'}
ADMIN = replace(ACTOR, client_id=3, email=billing.PLATFORM_ADMIN_EMAIL)
REAL_CALL_PRICE = pricing.call_price


class OutreachBillingTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {**SETTINGS, 'STRIPE_SECRET_KEY': 'sk_live_unit',
            'OUTREACH_STRIPE_WEBHOOK_SECRET': 'whsec_unit', 'OUTREACH_USD_GBP_RATE': '0.75',
            'PUBLIC_APP_URL': 'https://example.com', 'OUTREACH_CALL_MARKUP_MODE': 'combined'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.engine = create_engine('sqlite:///:memory:'); Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine); self.db = self.Session()
        self.addCleanup(self.engine.dispose); self.addCleanup(self.db.close)
        self.db.add_all([Client(id=1, email=ACTOR.email, website_url='https://example.com'),
            Client(id=2, email='other@example.com', website_url='https://example.com'),
            Client(id=3, email=ADMIN.email, website_url='https://example.com'),
            PhoneNumber(client_id=1, twilio_phone_number=CALLER, twilio_sid='PN'+'1'*32, is_active=True)])
        self.db.commit()
        self.provider = Mock()
        item = SimpleNamespace(phone_number=BUY, sid='PN'+'3'*32, account_sid=SETTINGS['TWILIO_ACCOUNT_SID'],
            capabilities={'voice': True, 'sms': True}, address_requirements='none', friendly_name='')
        self.provider.pricing.v1.phone_numbers.countries.return_value.fetch.return_value = SimpleNamespace(
            price_unit='GBP', phone_number_prices=[{'number_type':'mobile','current_price':'1.8895'}])
        self.provider.available_phone_numbers.return_value.mobile.list.return_value = [item]
        self.provider.incoming_phone_numbers.create.return_value = item
        self.provider.incoming_phone_numbers.list.return_value = []
        self.provider.calls.create.return_value.sid = SID
        self.stub(numbers, 'twilio_client', return_value=self.provider)
        self.stub(calls, 'twilio_client', return_value=self.provider)
        self.stub(pricing, 'call_price', return_value=RATE.copy())
        self.post = self.stub(calls.requests, 'post')
        self.post.return_value.json.return_value = {'callId':'uv-unit', 'joinUrl':'wss://example.com/join'}
        self.checkout = self.stub(payments.stripe.checkout.Session, 'create', return_value={'id':'cs_unit', 'url':'https://checkout.stripe.com/c/pay/unit'})
        self.session_get = self.stub(payments.stripe.checkout.Session, 'retrieve')
        self.intent_get = self.stub(payments.stripe.PaymentIntent, 'retrieve', return_value={'id':'pi_unit','status':'succeeded','currency':'gbp','amount_received':2500,'latest_charge':'ch_unit'})
        self.charge_get = self.stub(payments.stripe.Charge, 'retrieve', return_value={'id':'ch_unit','payment_intent':'pi_unit','amount':2500,'currency':'gbp','amount_refunded':0,'disputed':False})
        self.sub_get = self.stub(payments.stripe.Subscription, 'retrieve')
        self.invoice_get = self.stub(payments.stripe.Invoice, 'retrieve')
        self.sub_cancel = self.stub(payments.stripe.Subscription, 'cancel', return_value={'status':'canceled'})
        self.sub_modify = self.stub(payments.stripe.Subscription, 'modify', return_value={})
        self.refund = self.stub(payments.stripe.Refund, 'create', return_value={'id':'re_unit','status':'succeeded'})
        self.webhook_create = self.stub(payments.stripe.WebhookEndpoint, 'create', return_value={'id':'we_unit','secret':'whsec_created'})
        for mocked in [self.checkout,self.intent_get,self.charge_get,self.refund,self.webhook_create]:
            mocked.return_value=payments.stripe.StripeObject.construct_from(mocked.return_value,None)
        pricing._cache.clear()

    def stub(self, obj, name, **kwargs):
        p = patch.object(obj, name, **kwargs); result = p.start(); self.addCleanup(p.stop); return result

    def topup(self):
        return payments.topup_checkout(self.db, ACTOR, {'request_id':str(uuid4()),'amount_pence':2500})

    def paid_session(self, order, **updates):
        session = {'id':order.stripe_session_id,'metadata':{'purpose':payments.PURPOSE,'order_id':order.id,
            'client_id':str(order.client_id),'kind':order.kind},'currency':'gbp','amount_total':order.amount_pence,
            'mode':'payment' if order.kind=='topup' else 'subscription','status':'complete','payment_status':'paid',
            'payment_intent':'pi_unit','subscription':'sub_unit','customer':'cus_unit'}
        session.update(updates); self.session_get.return_value = session
        self.sub_get.return_value = {'id':'sub_unit','metadata':session['metadata'],'status':'active',
            'current_period_end':int((datetime.utcnow()+timedelta(days=30)).timestamp()),'latest_invoice':'in_unit'}
        self.invoice_get.return_value = {'id':'in_unit','status':'paid','amount_paid':order.amount_pence,
            'currency':'gbp','subscription':'sub_unit','payment_intent':'pi_number'}
        for mocked in [self.session_get,self.sub_get,self.invoice_get]:
            mocked.return_value=payments.stripe.StripeObject.construct_from(mocked.return_value,None)
        return session

    def rental(self):
        body={'request_id':str(uuid4()),'phone_number':BUY,'number_type':'mobile',
            'monthly_price':'3.78','currency':'GBP','confirm_purchase':True}
        payload=payments.number_checkout(self.db,ACTOR,body)
        return self.db.get(OutreachPaymentOrder,payload['id']),body

    def campaign(self, balance=0, admin=False):
        actor=ADMIN if admin else ACTOR
        campaign=OutreachCampaign(id=str(uuid4()),client_id=actor.client_id,name='Test',benefits='Confirmed offer',
            notification_email=actor.email,caller_id=CALLER,status='running',start_hour=9,end_hour=20)
        self.db.add(campaign); self.db.flush()
        lead=OutreachLead(id=str(uuid4()),campaign_id=campaign.id,position=0,phone=DEST,restaurant_name='Test',status='queued',contact={})
        self.db.add(lead); self.db.commit()
        if balance: billing.credit_wallet(self.db,actor.client_id,balance,str(uuid4()))
        quote=OutreachCallQuote(id=str(uuid4()),client_id=actor.client_id,actor_email=actor.email,phone=DEST,
            caller_id=CALLER,rate_gbp='0.12',details=RATE,expires_at=datetime.utcnow()+timedelta(minutes=5))
        self.db.add(quote); self.db.commit()
        return campaign,lead,quote,actor

    def request(self, handler, actor=ACTOR, body=None, routes=None, method='GET'):
        req=func.HttpRequest(method,'https://example.com/api/outreach/billing',params={},route_params=routes or {},
            body=json.dumps(body or {}).encode())
        with patch.object(api,'actor_for',return_value=actor),patch.object(api,'SessionLocal',self.Session):
            response=handler(req)
        return response.status_code,json.loads(response.get_body())

    def test_only_named_signed_primary_user_is_platform_admin(self):
        self.assertFalse(billing.is_platform_admin(ACTOR))  # A workspace owner also has role=admin.
        self.assertTrue(billing.is_platform_admin(ADMIN))
        self.assertFalse(billing.is_platform_admin(replace(ADMIN,scope='client_user')))
        self.assertFalse(billing.is_platform_admin(replace(ACTOR,email='bharath.sj1@gmail.com.evil')))
        self.assertEqual(self.request(api.billing_admin_overview)[0],403)
        self.assertEqual(self.request(api.billing_summary,actor=None)[0],401)

    def test_new_wallet_is_zero_and_customer_never_sees_provider_balance(self):
        result=billing.billing_payload(self.db,ACTOR)
        self.assertEqual(result['wallet']['available_pence'],0)
        self.assertIsNone(result['provider_balance'])
        self.provider.balance.fetch.assert_not_called()

    def test_checkout_alone_or_browser_return_never_credits_wallet(self):
        order=self.topup(); self.paid_session(order,payment_status='unpaid',status='open')
        payments.process_order(self.db,order)
        self.assertEqual(billing.wallet_payload(self.db,1)['balance_pence'],0)
        self.assertEqual(order.status,'checkout_open')
        self.provider.incoming_phone_numbers.create.assert_not_called()

    def test_paid_topup_is_credited_once_across_duplicate_events_and_reload(self):
        order=self.topup(); self.paid_session(order)
        for _ in range(3): payments.fulfill_order(self.db,order)
        self.assertEqual(billing.wallet_payload(self.db,1)['balance_pence'],2500)
        self.assertEqual(self.db.query(OutreachWalletEntry).filter_by(kind='topup').count(),1)

    def test_wrong_amount_currency_tenant_mode_or_metadata_cannot_credit(self):
        order=self.topup()
        for updates in ({'amount_total':1},{'currency':'usd'},{'mode':'subscription'},
                {'metadata':{'purpose':payments.PURPOSE,'order_id':order.id,'client_id':'2','kind':'topup'}}):
            self.paid_session(order,**updates)
            with self.assertRaises(billing.BillingError): payments.fulfill_order(self.db,order)
        self.assertEqual(billing.wallet_payload(self.db,1)['balance_pence'],0)

    def test_zero_payment_required_is_not_a_paid_topup(self):
        order=self.topup();self.paid_session(order,payment_status='no_payment_required')
        payments.fulfill_order(self.db,order)
        self.intent_get.assert_not_called()
        self.assertEqual(billing.wallet_payload(self.db,1)['balance_pence'],0)

    def test_refund_before_completed_event_cannot_grant_refunded_funds(self):
        order=self.topup();self.paid_session(order)
        self.charge_get.return_value['amount_refunded']=2500
        payments.fulfill_order(self.db,order)
        self.assertEqual(billing.wallet_payload(self.db,1)['balance_pence'],0)
        self.assertEqual(order.refunded_pence,2500)

    def test_partial_refunds_are_cumulative_and_cannot_repeat(self):
        order=self.topup();self.paid_session(order);payments.fulfill_order(self.db,order)
        for total in [500,500,250,1000]:
            payments.reverse_topup(self.db,order,{'id':'ch_unit','amount_refunded':total})
        self.assertEqual(billing.wallet_payload(self.db,1)['balance_pence'],1500)
        self.assertEqual(sum(e.amount_pence for e in self.db.query(OutreachWalletEntry).all()),1500)

    def test_dispute_is_resolved_from_provider_charge_and_freezes_wallet(self):
        order=self.topup();self.paid_session(order);payments.fulfill_order(self.db,order)
        payments.handle_webhook(self.db,{'type':'charge.dispute.created','livemode':True,'data':{'object':{'id':'dp_unit','charge':'ch_unit'}}})
        self.assertTrue(billing.wallet_payload(self.db,1)['frozen'])

    def test_unsigned_webhook_and_wrong_live_mode_are_rejected(self):
        req=func.HttpRequest('POST','https://example.com/api/outreach/billing/stripe-webhook',params={},body=b'{}')
        with patch.object(api,'SessionLocal',self.Session):
            self.assertEqual(api.billing_stripe_webhook(req).status_code,400)
        with self.assertRaises(billing.BillingError): payments.handle_webhook(self.db,{'type':'checkout.session.completed','livemode':False,'data':{'object':{}}})

    def test_checkout_is_server_scoped_idempotent_and_exact_gbp_amount(self):
        body={'request_id':str(uuid4()),'amount_pence':1000}
        first=payments.topup_checkout(self.db,ACTOR,body);second=payments.topup_checkout(self.db,ACTOR,body)
        self.assertEqual(first.id,second.id);self.checkout.assert_called_once()
        kwargs=self.checkout.call_args.kwargs
        self.assertEqual(kwargs['line_items'][0]['price_data']['unit_amount'],1000)
        self.assertEqual(kwargs['line_items'][0]['price_data']['currency'],'gbp')
        self.assertTrue(kwargs['success_url'].startswith('https://example.com/dashboard?billing_order='))
        with self.assertRaises(billing.BillingError): payments.topup_checkout(self.db,ACTOR,{**body,'amount_pence':5000})

    def test_uncertain_checkout_resumes_same_stripe_idempotency_key(self):
        self.checkout.side_effect=TimeoutError()
        body={'request_id':str(uuid4()),'amount_pence':2500}
        with self.assertRaises(billing.BillingError): payments.topup_checkout(self.db,ACTOR,body)
        order=self.db.query(OutreachPaymentOrder).one();self.assertEqual(order.status,'checkout_review')
        key=self.checkout.call_args.kwargs['idempotency_key']
        self.checkout.side_effect=None
        order.stripe_session_id="cs_unit"; self.paid_session(order,payment_status="unpaid",status="open"); order.stripe_session_id=None
        payments.process_order(self.db,order)
        self.assertEqual(self.checkout.call_args.kwargs['idempotency_key'],key)
        self.assertEqual(self.db.query(OutreachPaymentOrder).count(),1)

    def test_customer_number_price_is_double_provider_and_requires_paid_stripe(self):
        data=payments.available_numbers(self.db,ACTOR,'mobile','')
        self.assertEqual(data['items'][0]['monthly_price'],'3.78')
        order,_=self.rental();self.assertEqual(order.amount_pence,378)
        self.paid_session(order,payment_status='unpaid',status='open');payments.process_order(self.db,order)
        self.provider.incoming_phone_numbers.create.assert_not_called()
        with self.assertRaises(billing.BillingError): numbers.purchase_number(self.db,1,{'phone_number':BUY})

    def test_paid_number_is_provisioned_once_and_licensed_to_only_paying_tenant(self):
        order,body=self.rental();self.paid_session(order)
        payments.fulfill_order(self.db,order);payments.fulfill_order(self.db,order)
        self.assertEqual(order.status,'completed');self.provider.incoming_phone_numbers.create.assert_called_once()
        self.assertTrue(payments.number_entitled(self.db,1,BUY));self.assertFalse(payments.number_entitled(self.db,2,BUY))
        self.assertEqual(numbers.own_numbers(self.db,1)[0].phone_number,BUY)
        self.assertEqual(self.checkout.call_args.kwargs['mode'],'subscription')

    def test_failed_paid_number_cancels_subscription_and_refunds(self):
        order,_=self.rental();self.paid_session(order)
        self.provider.available_phone_numbers.return_value.mobile.list.return_value=[]
        payments.fulfill_order(self.db,order)
        self.assertEqual(order.status,'refunded');self.sub_cancel.assert_called_once();self.refund.assert_called_once()
        self.assertEqual(self.refund.call_args.kwargs['amount'],378)
        self.provider.incoming_phone_numbers.create.assert_not_called()

    def test_uncertain_number_purchase_is_reconciled_never_repeated_or_refunded(self):
        order,_=self.rental();self.paid_session(order)
        self.provider.incoming_phone_numbers.create.side_effect=TimeoutError()
        payments.fulfill_order(self.db,order);payments.fulfill_order(self.db,order)
        self.assertEqual(order.status,'needs_review');self.provider.incoming_phone_numbers.create.assert_called_once()
        self.refund.assert_not_called()

    def test_refund_retry_accepts_subscription_already_cancelled(self):
        order,_=self.rental();order.stripe_subscription_id='sub_unit';order.stripe_payment_intent_id='pi_unit';self.db.commit()
        self.sub_get.return_value={'id':'sub_unit','status':'canceled'}
        payments.refund_number_order(self.db,order)
        self.sub_cancel.assert_not_called();self.assertEqual(order.status,'refunded')

    def test_expired_rental_release_retries_after_stripe_network_failure(self):
        order,_=self.rental();self.paid_session(order);payments.fulfill_order(self.db,order)
        order.paid_until=datetime.utcnow()-timedelta(seconds=1);self.db.commit()
        self.sub_get.return_value['status']='past_due'
        self.sub_cancel.side_effect=TimeoutError()
        with self.assertRaises(TimeoutError): payments.process_order(self.db,order)
        self.assertEqual(order.status,'release_pending');self.assertFalse(payments.number_entitled(self.db,1,BUY))
        self.sub_cancel.side_effect=None;payments.process_order(self.db,order)
        self.assertEqual(order.status,'cancelled');self.provider.incoming_phone_numbers.return_value.delete.assert_called_once()

    def test_cancellation_keeps_paid_period_and_cannot_access_other_tenant(self):
        order,_=self.rental();self.paid_session(order);payments.fulfill_order(self.db,order)
        with self.assertRaises(billing.BillingError): payments.cancel_number(self.db,replace(ACTOR,client_id=2),order.id,True)
        payments.cancel_number(self.db,ACTOR,order.id,True)
        self.assertTrue(order.cancel_requested);self.assertTrue(payments.number_entitled(self.db,1,BUY))
        self.provider.incoming_phone_numbers.return_value.delete.assert_not_called()

    def test_zero_balance_blocks_manual_call_and_background_worker_before_provider(self):
        campaign,lead,quote,actor=self.campaign()
        with self.assertRaises(billing.BillingError): billing.bind_campaign(self.db,campaign.id,actor,quote.id,DEST,CALLER)
        self.db.add(OutreachCampaignBilling(campaign_id=campaign.id,client_id=1,actor_email=actor.email,admin_exempt=False,max_rate_gbp='0.12'));self.db.commit()
        calls.launch_call(self.db,campaign,lead)
        self.assertEqual(campaign.status,'paused');self.assertIn('credits',lead.error)
        self.post.assert_not_called();self.provider.calls.create.assert_not_called()
        with patch.object(payments,'number_entitled',return_value=True),self.assertRaises(billing.BillingError):
            manual.start_manual_call(self.db,1,{'request_id':str(uuid4()),'phone':DEST,'restaurant_name':'Test',
                'benefits':'Confirmed benefits','notification_email':ACTOR.email,'caller_id':CALLER,'quote_id':quote.id},
                now=datetime(2026,10,16,11,tzinfo=timezone.utc),actor=ACTOR)
        self.db.rollback();self.post.assert_not_called()

    def test_quote_is_bound_to_signed_identity_destination_caller_and_expiry(self):
        campaign,lead,quote,actor=self.campaign(balance=100)
        for bad in [replace(actor,client_id=2),replace(actor,email='manager@example.com')]:
            with self.assertRaises(billing.BillingError): billing.bind_campaign(self.db,campaign.id,bad,quote.id,DEST,CALLER)
        with self.assertRaises(billing.BillingError): billing.bind_campaign(self.db,campaign.id,actor,quote.id,BUY,CALLER)
        quote.expires_at=datetime.utcnow()-timedelta(seconds=1);self.db.commit()
        with self.assertRaises(billing.BillingError): billing.bind_campaign(self.db,campaign.id,actor,quote.id,DEST,CALLER)

    def test_wallet_reservation_caps_call_and_settlement_debits_once_releases_unused(self):
        campaign,lead,quote,actor=self.campaign(balance=100)
        billing.bind_campaign(self.db,campaign.id,actor,quote.id,DEST,CALLER)
        calls.launch_call(self.db,campaign,lead)
        self.assertEqual(self.provider.calls.create.call_args.kwargs['time_limit'],480)
        self.assertEqual(self.post.call_args.kwargs['json']['maxDuration'],'480s')
        self.assertEqual(billing.wallet_payload(self.db,1)['reserved_pence'],96)
        for _ in range(2): calls.apply_call_status(self.db,lead,SID,'completed',duration=61)
        self.assertEqual(billing.wallet_payload(self.db,1)['balance_pence'],76)
        self.assertEqual(billing.wallet_payload(self.db,1)['reserved_pence'],0)
        self.assertEqual(self.db.query(OutreachWalletEntry).filter_by(kind='call').count(),1)

    def test_two_calls_cannot_reserve_same_funds_and_unknown_duration_keeps_hold(self):
        campaign,lead,quote,actor=self.campaign(balance=12)
        billing.bind_campaign(self.db,campaign.id,actor,quote.id,DEST,CALLER)
        first=billing.reserve_call(self.db,campaign,lead);self.assertEqual(first.max_duration_seconds,60)
        other=OutreachLead(id=str(uuid4()),campaign_id=campaign.id,position=1,phone=BUY,restaurant_name='Other',status='queued',contact={})
        self.db.add(other);self.db.commit()
        with self.assertRaises(billing.BillingError): billing.reserve_call(self.db,campaign,other)
        billing.settle_call(self.db,lead.id,None)
        self.assertEqual(billing.wallet_payload(self.db,1)['reserved_pence'],12)
        billing.settle_call(self.db,lead.id,0)
        self.assertEqual(billing.wallet_payload(self.db,1)['available_pence'],12)

    def test_higher_destination_price_pauses_without_taking_funds(self):
        campaign,lead,quote,actor=self.campaign(balance=100)
        billing.bind_campaign(self.db,campaign.id,actor,quote.id,DEST,CALLER)
        pricing.call_price.return_value={**RATE,'rate_gbp':'0.13'}
        calls.launch_call(self.db,campaign,lead)
        self.assertEqual(campaign.status,'paused');self.assertEqual(billing.wallet_payload(self.db,1)['reserved_pence'],0)
        self.post.assert_not_called()

    def test_only_platform_admin_can_call_without_wallet_and_forged_body_does_not_help(self):
        campaign,lead,quote,actor=self.campaign(admin=True)
        billing.bind_campaign(self.db,campaign.id,actor,None,DEST,CALLER)
        calls.launch_call(self.db,campaign,lead)
        self.provider.calls.create.assert_called_once();self.assertTrue(self.db.get(OutreachCallCharge,lead.id).admin_exempt)
        pricing.call_price.assert_not_called()
        billing.settle_call(self.db,lead.id,60);self.assertEqual(self.db.query(OutreachWalletEntry).count(),0)
        self.assertEqual(self.request(api.billing_connect_stripe,body={'email':ADMIN.email,'role':'admin'},method='POST')[0],403)

    def test_opt_out_does_not_hold_credits(self):
        campaign,lead,quote,actor=self.campaign(balance=100)
        billing.bind_campaign(self.db,campaign.id,actor,quote.id,DEST,CALLER)
        self.db.add(OutreachSuppression(client_id=1,phone=DEST));self.db.commit()
        calls.launch_call(self.db,campaign,lead)
        self.assertIsNone(self.db.get(OutreachCallCharge,lead.id));self.post.assert_not_called()

    def test_other_tenant_cannot_check_or_fulfill_private_payment(self):
        order=self.topup();self.paid_session(order)
        self.assertEqual(self.request(api.billing_order,actor=replace(ACTOR,client_id=2),routes={'order_id':order.id})[0],404)
        self.session_get.assert_not_called()

    def test_admin_connect_encrypts_secret_and_repeated_connect_does_not_register_again(self):
        with patch.dict(os.environ,{'OUTREACH_STRIPE_WEBHOOK_SECRET':''}):
            payments.connect_stripe(self.db,ADMIN);payments.connect_stripe(self.db,ADMIN)
            saved=self.db.get(OutreachBillingSetting,'stripe_webhook')
            self.assertNotIn('whsec_created',saved.encrypted_value)
            self.assertEqual(billing.webhook_secret(self.db),'whsec_created');self.webhook_create.assert_called_once()

    def test_number_pricing_is_decimal_and_rounded_up_only_at_penny(self):
        quote=pricing.number_price(self.provider,'mobile')
        self.assertEqual(quote['monthly_price'],'3.78')
        self.assertEqual(pricing.pence(Decimal('0.000001')),1)
        for invalid in ['NaN','Infinity','-1','missing']:
            with self.assertRaises(pricing.PricingError):pricing.decimal_price(invalid)


    def test_concurrent_calls_cannot_overspend_shared_wallet(self):
        with tempfile.TemporaryDirectory() as directory:
            engine=create_engine(f'sqlite:///{directory}/wallet.db',connect_args={'check_same_thread':False,'timeout':20})
            Base.metadata.create_all(engine);Session=sessionmaker(bind=engine)
            with Session() as db:
                db.add(Client(id=1,email=ACTOR.email,website_url='https://example.com'));db.flush()
                db.add(OutreachWallet(client_id=1,balance_pence=120,reserved_pence=0))
                campaign=OutreachCampaign(id='campaign',client_id=1,name='Concurrent',benefits='Offer',notification_email=ACTOR.email,caller_id=CALLER)
                db.add(campaign);db.flush()
                db.add(OutreachCampaignBilling(campaign_id='campaign',client_id=1,actor_email=ACTOR.email,admin_exempt=False,max_rate_gbp='0.12'))
                db.add_all([OutreachLead(id=str(n),campaign_id='campaign',position=n,phone=DEST if n==0 else BUY,restaurant_name='Test',status='queued',contact={}) for n in range(2)])
                db.commit()
            def reserve(n):
                with Session() as db:
                    try: return billing.reserve_call(db,db.get(OutreachCampaign,'campaign'),db.get(OutreachLead,str(n))).reserved_pence
                    except billing.BillingError: return 0
            with ThreadPoolExecutor(max_workers=2) as executor: holds=list(executor.map(reserve,range(2)))
            with Session() as db:
                self.assertEqual(sum(holds),120)
                self.assertEqual(db.get(OutreachWallet,1).reserved_pence,120)
                self.assertEqual(db.query(OutreachCallCharge).count(),1)
            engine.dispose()

    def test_concurrent_duplicate_topups_credit_once(self):
        with tempfile.TemporaryDirectory() as directory:
            engine=create_engine(f'sqlite:///{directory}/wallet.db',connect_args={'check_same_thread':False,'timeout':20})
            Base.metadata.create_all(engine);Session=sessionmaker(bind=engine)
            with Session() as db:
                db.add(Client(id=1,email=ACTOR.email,website_url='https://example.com'));db.commit();billing.wallet(db,1)
            def credit(_):
                with Session() as db: return billing.credit_wallet(db,1,2500,'same-paid-order')
            with ThreadPoolExecutor(max_workers=2) as executor: results=list(executor.map(credit,range(2)))
            with Session() as db:
                self.assertEqual(sum(results),1);self.assertEqual(db.get(OutreachWallet,1).balance_pence,2500)
                self.assertEqual(db.query(OutreachWalletEntry).count(),1)
            engine.dispose()

    def test_live_route_pricing_applies_combined_or_twilio_only_policy(self):
        self.provider.pricing.v2.voice.numbers.return_value.fetch.return_value=SimpleNamespace(
            price_unit='GBP',outbound_call_prices=[{'origination_prefixes':['ALL'],'current_price':'0.02'}])
        pricing._cache.clear()
        with patch.dict(os.environ,{'OUTREACH_CALL_MARKUP_MODE':'combined'}):
            self.assertEqual(Decimal(REAL_CALL_PRICE(DEST,CALLER)['rate_gbp']),Decimal('0.115'))
        with patch.dict(os.environ,{'OUTREACH_CALL_MARKUP_MODE':'twilio_only'}):
            self.assertEqual(Decimal(REAL_CALL_PRICE(DEST,CALLER)['rate_gbp']),Decimal('0.04'))
        self.provider.pricing.v2.voice.numbers.return_value.fetch.assert_called_with(origination_number=CALLER)

    def test_stale_fx_is_rejected_without_making_up_a_price(self):
        response=Mock(content=b'<rates><Cube time="2020-01-01"><Cube currency="USD" rate="1.1"/><Cube currency="GBP" rate="0.85"/><Cube currency="CAD" rate="1.5"/></Cube></rates>')
        with patch.object(pricing.requests,'get',return_value=response),patch.dict(os.environ,{'OUTREACH_CAD_GBP_RATE':''}):
            with self.assertRaises(pricing.PricingError):pricing.gbp_conversion('CAD')

    def test_missing_callback_blocks_checkout_without_any_provider_mutation(self):
        with patch.dict(os.environ,{'OUTREACH_STRIPE_WEBHOOK_SECRET':''}):
            with self.assertRaises(billing.BillingError):self.topup()
            with self.assertRaises(billing.BillingError):self.rental()
        self.checkout.assert_not_called();self.provider.incoming_phone_numbers.create.assert_not_called()



    def test_signed_paid_webhook_fulfills_once_through_http_boundary(self):
        order=self.topup();self.paid_session(order)
        event={'id':'evt_unit','object':'event','type':'checkout.session.completed','livemode':True,'data':{'object':{'id':order.stripe_session_id,'object':'checkout.session'}}}
        payload=json.dumps(event).encode();timestamp=int(time.time())
        signature=hmac.new(b'whsec_unit',str(timestamp).encode()+b'.'+payload,hashlib.sha256).hexdigest()
        req=func.HttpRequest('POST','https://example.com/api/outreach/billing/stripe-webhook',params={},
            headers={'Stripe-Signature':f't={timestamp},v1={signature}'},body=payload)
        with patch.object(api,'SessionLocal',self.Session):
            self.assertEqual(api.billing_stripe_webhook(req).status_code,200)
            self.assertEqual(api.billing_stripe_webhook(req).status_code,200)
        self.db.expire_all();self.assertEqual(billing.wallet_payload(self.db,1)['balance_pence'],2500)
        self.assertEqual(self.db.query(OutreachWalletEntry).count(),1)

    def test_adding_wallet_tables_preserves_existing_campaign_and_call_data(self):
        campaign,lead,quote,actor=self.campaign()
        campaign_id,lead_id=campaign.id,lead.id
        OutreachWalletEntry.__table__.drop(self.engine)
        OutreachWallet.__table__.drop(self.engine)
        Base.metadata.create_all(self.engine)
        self.db.expire_all()
        self.assertEqual(self.db.get(OutreachLead,lead_id).phone,DEST)
        self.assertEqual(self.db.get(OutreachCampaign,campaign_id).name,'Test')
        self.assertEqual(billing.wallet_payload(self.db,1)['balance_pence'],0)



    def test_adding_balance_then_resuming_clears_previous_insufficient_credit_error(self):
        campaign,lead,quote,actor=self.campaign()
        self.db.add(OutreachCampaignBilling(campaign_id=campaign.id,client_id=1,actor_email=actor.email,admin_exempt=False,max_rate_gbp='0.12'));self.db.commit()
        calls.launch_call(self.db,campaign,lead)
        self.assertEqual(campaign.status,'paused');self.assertIn('credits',lead.error)
        billing.credit_wallet(self.db,1,100,'paid-after-pause')
        billing.bind_campaign(self.db,campaign.id,actor,quote.id,DEST,CALLER)
        campaign.status='running';self.db.commit()
        calls.launch_call(self.db,campaign,lead)
        self.assertEqual(lead.status,'queued-provider');self.assertIsNone(lead.error)
        self.provider.calls.create.assert_called_once()



    def stripe_setup(self):
        key='sk_live_'+('z'*32)
        account={'id':'acct_verified','charges_enabled':True,'business_profile':{'name':'VedoraEats'}}
        mocked=self.stub(payments.stripe.Account,'retrieve',return_value=payments.stripe.StripeObject.construct_from(account,None))
        return key,mocked

    def test_only_signed_platform_admin_can_validate_or_save_stripe_key(self):
        key,provider=self.stripe_setup()
        for actor in [ACTOR,replace(ADMIN,scope='client_user')]:
            self.assertEqual(self.request(api.billing_configure_stripe_key,actor=actor,method='POST',body={'secret_key':key})[0],403)
        provider.assert_not_called()
        self.assertIsNone(self.db.get(OutreachBillingSetting,'stripe_api_key'))

    def test_stripe_key_validation_is_read_only_and_does_not_echo_secret(self):
        key,provider=self.stripe_setup()
        with patch.dict(os.environ,{'STRIPE_SECRET_KEY':'','OUTREACH_STRIPE_WEBHOOK_SECRET':''}):
            result=payments.configure_stripe_key(self.db,ADMIN,{'secret_key':key})
            self.assertEqual(result['business_name'],'VedoraEats');self.assertEqual(result['mode'],'live')
            self.assertFalse(result['saved']);self.assertNotIn(key,json.dumps(result))
            self.assertIsNone(self.db.get(OutreachBillingSetting,'stripe_api_key'))
            self.assertFalse(billing.billing_ready(self.db))
        self.checkout.assert_not_called();self.webhook_create.assert_not_called()

    def test_confirmed_key_is_encrypted_and_used_after_database_session_restart(self):
        key,provider=self.stripe_setup()
        with patch.dict(os.environ,{'STRIPE_SECRET_KEY':'','OUTREACH_STRIPE_WEBHOOK_SECRET':''}):
            result=payments.configure_stripe_key(self.db,ADMIN,{'secret_key':key,'confirm_account':True,'account_id':'acct_verified'})
            self.assertTrue(result['saved'])
            row=self.db.get(OutreachBillingSetting,'stripe_api_key');self.assertNotIn(key,row.encrypted_value)
            self.assertEqual(row.provider_reference,'acct_verified');self.db.close();self.db=self.Session()
            self.assertEqual(payments.options(self.db)['api_key'],key)
            self.assertFalse(billing.billing_ready(self.db))
            payments.connect_stripe(self.db,ADMIN)
            self.assertEqual(self.webhook_create.call_args.kwargs['api_key'],key)
            self.assertTrue(billing.billing_ready(self.db))
            summary=billing.billing_payload(self.db,ACTOR)
            self.assertNotIn(key,json.dumps(summary));self.assertNotIn('whsec_created',json.dumps(summary))
            # Both checkout and signed-event mode checks use the persisted key.
            topup=self.topup();self.assertEqual(self.checkout.call_args.kwargs['api_key'],key)
            payments.handle_webhook(self.db,{'type':'checkout.session.completed','livemode':True,'data':{'object':{'id':'unrelated'}}})

    def test_wrong_account_confirmation_never_saves_key(self):
        key,provider=self.stripe_setup()
        with patch.dict(os.environ,{'STRIPE_SECRET_KEY':'','OUTREACH_STRIPE_WEBHOOK_SECRET':''}):
            with self.assertRaises(billing.BillingError):
                payments.configure_stripe_key(self.db,ADMIN,{'secret_key':key,'confirm_account':True,'account_id':'acct_wrong'})
            self.assertIsNone(self.db.get(OutreachBillingSetting,'stripe_api_key'))

    def test_invalid_key_or_disabled_live_account_is_rejected_without_secret_leaks(self):
        key,provider=self.stripe_setup()
        with patch.dict(os.environ,{'STRIPE_SECRET_KEY':'','OUTREACH_STRIPE_WEBHOOK_SECRET':''}):
            for invalid in ['pk_live_'+('x'*32),'bad','sk_live_short',key+'\n']:
                with self.assertRaises(billing.BillingError): payments.configure_stripe_key(self.db,ADMIN,{'secret_key':invalid})
            provider.assert_not_called()
            provider.side_effect=Exception('provider message containing '+key)
            with self.assertRaises(billing.BillingError) as error:payments.configure_stripe_key(self.db,ADMIN,{'secret_key':key})
            self.assertNotIn(key,str(error.exception))
            provider.side_effect=None;provider.return_value['charges_enabled']=False
            with self.assertRaises(billing.BillingError):payments.configure_stripe_key(self.db,ADMIN,{'secret_key':key})
            self.assertIsNone(self.db.get(OutreachBillingSetting,'stripe_api_key'))

    def test_existing_billing_cannot_be_redirected_to_another_stripe_account(self):
        key,provider=self.stripe_setup()
        with self.assertRaises(billing.BillingError):payments.configure_stripe_key(self.db,ADMIN,{'secret_key':key})
        provider.assert_not_called()
        self.topup()
        with patch.dict(os.environ,{'STRIPE_SECRET_KEY':'','OUTREACH_STRIPE_WEBHOOK_SECRET':''}):
            with self.assertRaises(billing.BillingError):payments.configure_stripe_key(self.db,ADMIN,{'secret_key':key})
        provider.assert_not_called()

    def test_missing_key_cannot_leave_a_partial_webhook_setup(self):
        with patch.dict(os.environ,{'STRIPE_SECRET_KEY':'','OUTREACH_STRIPE_WEBHOOK_SECRET':''}):
            with self.assertRaises(billing.BillingError):payments.connect_stripe(self.db,ADMIN)
            self.assertIsNone(self.db.get(OutreachBillingSetting,'stripe_webhook'))
        self.webhook_create.assert_not_called()



    def test_publishable_key_is_saved_with_the_secret_and_must_match_mode(self):
        key,provider=self.stripe_setup()
        with patch.dict(os.environ,{'STRIPE_SECRET_KEY':'','OUTREACH_STRIPE_WEBHOOK_SECRET':''}):
            with self.assertRaises(billing.BillingError):payments.configure_stripe_key(self.db,ADMIN,{'secret_key':key,'publishable_key':'pk_test_'+('x'*32)})
            provider.assert_not_called()
            publishable='pk_live_'+('x'*32)
            result=payments.configure_stripe_key(self.db,ADMIN,{'secret_key':key,'publishable_key':publishable,'confirm_account':True,'account_id':'acct_verified'})
            self.assertTrue(result['saved']);self.assertEqual(billing.stored_secret(self.db,'stripe_publishable_key'),publishable)
            self.assertNotIn(publishable,json.dumps(result))



    def test_test_payments_never_credit_wallet_or_purchase_real_twilio_number(self):
        with patch.dict(os.environ,{'STRIPE_SECRET_KEY':'sk_test_unit'}):
            topup=self.topup();self.paid_session(topup);payments.fulfill_order(self.db,topup)
            self.assertEqual(topup.status,'test_completed')
            self.assertEqual(billing.wallet_payload(self.db,1)['balance_pence'],0)
            self.assertEqual(self.db.query(OutreachWalletEntry).count(),0)
            self.checkout.return_value['id']='cs_test_number'
            rental,_=self.rental();self.paid_session(rental);payments.fulfill_order(self.db,rental)
            self.assertEqual(rental.status,'test_completed')
            self.provider.incoming_phone_numbers.create.assert_not_called()
            self.assertFalse(payments.number_entitled(self.db,1,BUY))

    def test_test_mode_blocks_customer_call_even_if_old_wallet_has_credits(self):
        campaign,lead,quote,actor=self.campaign(balance=100)
        billing.bind_campaign(self.db,campaign.id,actor,quote.id,DEST,CALLER)
        with patch.dict(os.environ,{'STRIPE_SECRET_KEY':'sk_test_unit'}):
            with self.assertRaises(billing.BillingError):billing.bind_campaign(self.db,campaign.id,actor,quote.id,DEST,CALLER)
            calls.launch_call(self.db,campaign,lead)
        self.assertEqual(campaign.status,'paused');self.post.assert_not_called()
        self.provider.calls.create.assert_not_called()
        self.assertEqual(billing.wallet_payload(self.db,1)['reserved_pence'],0)



    def test_unused_deployment_default_can_be_selected_over_before_billing_starts(self):
        key,provider=self.stripe_setup()
        with patch.dict(os.environ,{'STRIPE_SECRET_KEY':'sk_live_unused_deployment_default','OUTREACH_STRIPE_WEBHOOK_SECRET':''}):
            result=payments.configure_stripe_key(self.db,ADMIN,{'secret_key':key,'confirm_account':True,'account_id':'acct_verified'})
            self.assertTrue(result['saved']);self.assertEqual(billing.stripe_api_key(self.db),key)
            payments.connect_stripe(self.db,ADMIN)
            self.assertEqual(self.webhook_create.call_args.kwargs['api_key'],key)

    def test_setup_lock_prevents_key_and_webhook_configuration_racing(self):
        key,provider=self.stripe_setup()
        with patch.dict(os.environ,{'STRIPE_SECRET_KEY':'','OUTREACH_STRIPE_WEBHOOK_SECRET':''}):
            with payments.setup_lock(self.db):
                with self.assertRaises(billing.BillingError):payments.configure_stripe_key(self.db,ADMIN,{'secret_key':key,'confirm_account':True,'account_id':'acct_verified'})
                with self.assertRaises(billing.BillingError):payments.connect_stripe(self.db,ADMIN)
            self.assertIsNone(self.db.get(OutreachBillingSetting,'stripe_api_key'))
            self.assertIsNone(self.db.get(OutreachBillingSetting,'stripe_webhook'))
        self.webhook_create.assert_not_called()


if __name__ == '__main__': unittest.main()
