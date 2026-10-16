"""Signed-user billing APIs and a strictly signed Stripe fulfillment callback."""
import json

import azure.functions as func
import stripe

from function_app import app
from outreach_endpoints import actor_for, body_for, response
from services import outreach_billing as billing, outreach_payments as payments
from services.outreach_pricing import PricingError
from shared.db import SessionLocal, OutreachPaymentOrder, OutreachCampaign, OutreachLead, OutreachCallCharge


def handle(req, action):
    if req.method == "OPTIONS": return response(req, {})
    actor = actor_for(req)
    if not actor: return response(req, {"error": "Sign in to manage billing"}, 401)
    db = SessionLocal()
    try: return response(req, action(db, actor))
    except billing.BillingError as exc:
        db.rollback(); return response(req, {"error": str(exc)}, exc.status)
    except (PricingError, ValueError, TypeError) as exc:
        db.rollback(); return response(req, {"error": str(exc)}, 400)
    except Exception:
        db.rollback()
        return response(req, {"error": "Billing provider is unavailable. Check the existing payment before trying again."}, 502)
    finally: db.close()


@app.route(route="outreach/billing", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def billing_summary(req):
    def action(db, actor):
        result = billing.billing_payload(db, actor)
        result["call_reservations"] = [{"lead_id": row.lead_id, "reserved_pence": row.reserved_pence,
            "charged_pence": row.charged_pence, "rate_gbp": row.rate_gbp,
            "duration_seconds": row.duration_seconds, "max_duration_seconds": row.max_duration_seconds,
            "status": row.status, "admin_exempt": row.admin_exempt} for row in
            db.query(OutreachCallCharge).filter_by(client_id=actor.client_id).order_by(OutreachCallCharge.created_at.desc()).limit(30).all()]
        return result
    return handle(req, action)


@app.route(route="outreach/billing/topups", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def billing_topup(req):
    return handle(req, lambda db, actor: {"order": payments.order_payload(payments.topup_checkout(db, actor, body_for(req)))})


@app.route(route="outreach/billing/orders/{order_id}", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def billing_order(req):
    def action(db, actor):
        order = db.query(OutreachPaymentOrder).filter_by(id=req.route_params.get("order_id"), client_id=actor.client_id).first()
        if not order: raise billing.BillingError("Payment not found", 404)
        return {"order": payments.order_payload(payments.process_order(db, order))}
    return handle(req, action)


@app.route(route="outreach/billing/call-quotes", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def billing_call_quote(req):
    def action(db, actor):
        body = body_for(req)
        return {"quote": billing.create_call_quote(db, actor, body.get("phone"), body.get("caller_id"))}
    return handle(req, action)


@app.route(route="outreach/billing/campaigns/{campaign_id}/quote", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def billing_campaign_quote(req):
    def action(db, actor):
        campaign = db.query(OutreachCampaign).filter_by(id=req.route_params.get("campaign_id"), client_id=actor.client_id).first()
        if not campaign: raise billing.BillingError("Campaign not found", 404)
        lead = db.query(OutreachLead).filter_by(campaign_id=campaign.id, status="queued").order_by(OutreachLead.position).first()
        if not lead: raise billing.BillingError("No queued contact is available to price")
        return {"quote": billing.create_call_quote(db, actor, lead.phone, campaign.caller_id)}
    return handle(req, action)


@app.route(route="outreach/billing/numbers/{order_id}/cancel", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def billing_cancel_number(req):
    return handle(req, lambda db, actor: {"order": payments.order_payload(payments.cancel_number(db, actor,
        req.route_params.get("order_id"), body_for(req).get("confirm_cancel")))})


@app.route(route="outreach/billing/admin/connect-stripe", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def billing_connect_stripe(req):
    return handle(req, payments.connect_stripe)


@app.route(route="outreach/billing/admin/stripe-key", methods=["POST", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def billing_configure_stripe_key(req):
    return handle(req, lambda db, actor: {"account": payments.configure_stripe_key(db, actor, body_for(req))})


@app.route(route="outreach/billing/admin/overview", methods=["GET", "OPTIONS"], auth_level=func.AuthLevel.ANONYMOUS)
def billing_admin_overview(req):
    def action(db, actor):
        if not billing.is_platform_admin(actor): raise billing.BillingError("Platform administrator access required", 403)
        orders = db.query(OutreachPaymentOrder).filter(OutreachPaymentOrder.status.in_([
            "needs_review", "refund_pending", "checkout_review", "provisioning", "release_pending"])).order_by(OutreachPaymentOrder.created_at).limit(100).all()
        return {"orders": [{**payments.order_payload(row), "client_id": row.client_id, "customer_email": row.actor_email} for row in orders]}
    return handle(req, action)


@app.route(route="outreach/billing/stripe-webhook", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def billing_stripe_webhook(req):
    if len(req.get_body()) > 1024 * 1024: return response(req, {"error": "Webhook is too large"}, 413)
    db = SessionLocal()
    try:
        secret = billing.webhook_secret(db)
        if not secret: return response(req, {"error": "Stripe callback is not configured"}, 503)
        try:
            event = stripe.Webhook.construct_event(req.get_body(), req.headers.get("Stripe-Signature", ""), secret)
        except Exception:
            return response(req, {"error": "Invalid Stripe signature"}, 400)
        payments.handle_webhook(db, event)
        return response(req, {"received": True})
    except billing.BillingError as exc:
        db.rollback(); return response(req, {"error": str(exc)}, exc.status)
    except Exception:
        db.rollback(); return response(req, {"error": "Payment reconciliation is pending; retry the event"}, 500)
    finally: db.close()
