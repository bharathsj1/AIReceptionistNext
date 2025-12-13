import React, { useEffect, useMemo, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

const plans = {
  bronze: {
    name: "Bronze",
    price: "$500/mo",
    description: "Launch your AI receptionist with core voice + transcript access.",
    features: [
      "Unlimited calls",
      "Real-time voice + live transcripts",
      "Basic analytics & summaries",
      "Email support during business hours"
    ]
  },
  silver: {
    name: "Silver",
    price: "$600/mo",
    description: "Add richer controls, smarter hand-offs, and priority support.",
    features: [
      "Unlimited calls",
      "Smart hand-off workflows & routing",
      "Priority email + chat support",
      "Custom greetings and warm transfers"
    ]
  },
  gold: {
    name: "Gold",
    price: "$700/mo",
    description: "Full concierge experience with advanced automation and QA.",
    features: [
      "Unlimited calls",
      "Advanced analytics & QA reviews",
      "Dedicated success manager",
      "Integration hooks for CRM & calendar"
    ]
  },
  custom: {
    name: "Custom",
    price: "Let’s talk",
    description: "White-glove setup, tailored routing, and enterprise controls.",
    features: [
      "Unlimited calls",
      "Multi-location routing & IVR trees",
      "Onboarding workshops & QA playbooks",
      "Security reviews and SSO options"
    ]
  }
};

export default function PaymentScreen({ planId, onBack, onSubmit, initialEmail = "" }) {
  const [clientSecret, setClientSecret] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [intentType, setIntentType] = useState("payment");
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState(null);
  const [cardName, setCardName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [processing, setProcessing] = useState(false);

  const plan = useMemo(() => {
    if (planId && plans[planId]) return plans[planId];
    return plans.gold;
  }, [planId]);

  const stripePromise = loadStripe(
    import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ||
      "pk_test_51SccVdGX99jB26LURq7OeFpXSa0qTSlzEf0bbSrznJgK0Z0lgJDltaJ6iVErFEvUEcABDPYm6F42V8QfVdpF0P1200htKKQ7Oo"
  );

  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  useEffect(() => {
    if (!email) {
      setClientSecret("");
      return;
    }
    const controller = new AbortController();
    const createSubscription = async () => {
      setIntentLoading(true);
      setIntentError(null);
      try {
        const res = await fetch("/api/payments/create-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId: planId || "gold", email }),
          signal: controller.signal
        });
        const data = await res.json();
        if (!res.ok || !data?.clientSecret) {
          throw new Error(data?.error || "Failed to create subscription");
        }
        setClientSecret(data.clientSecret);
        setSubscriptionId(data.subscriptionId);
        setCustomerId(data.customerId);
        setIntentType(data.intentType || "payment");
      } catch (err) {
        if (controller.signal.aborted) return;
        setIntentError(
          err instanceof Error ? err.message : "Could not start payment. Please try again."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIntentLoading(false);
        }
      }
    };
    createSubscription();
    return () => controller.abort();
  }, [planId, email]);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_20px_90px_rgba(15,23,42,0.35)] backdrop-blur md:p-10 screen-panel">
      <div className="pointer-events-none absolute -left-20 top-0 h-48 w-48 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />

      <div className="relative mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">
            Checkout
          </p>
          <h2 className="text-3xl font-semibold text-white md:text-4xl">
            Secure your AI Receptionist
          </h2>
          <p className="text-sm text-slate-200/80">
            Review your plan and enter payment details to get started.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          ← Back
        </button>
      </div>

          <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-5 shadow-inner">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200/80">
                    {plan.name} plan
                  </p>
                  <p className="mt-1 text-3xl font-semibold text-white">{plan.price}</p>
                </div>
                <span className="rounded-full bg-amber-300/90 px-3 py-1 text-xs font-semibold text-amber-950 shadow-sm">
                  Plan summary
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-100/85">
                {plan.description} — Monthly, no commitments. Cancel anytime.
              </p>
          <ul className="mt-4 space-y-2 text-sm text-slate-50/90">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <span className="mt-[6px] h-2 w-2 rounded-full bg-white/70" aria-hidden />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-100/80">
            <p className="font-semibold text-white">What happens next?</p>
            <p className="mt-1">
              We’ll activate your AI receptionist, share onboarding steps, and tailor call flows to your
              business. You can change or upgrade anytime.
            </p>
          </div>
        </div>

        {clientSecret ? (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: { theme: "stripe" },
              paymentMethodOrder: ["card"]
            }}
          >
            <PaymentForm
              email={email}
              setEmail={setEmail}
              cardName={cardName}
              setCardName={setCardName}
              onSubmit={onSubmit}
              planId={planId}
              processing={processing}
              setProcessing={setProcessing}
        intentError={intentError}
        subscriptionId={subscriptionId}
        customerId={customerId}
        intentType={intentType}
      />
          </Elements>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white p-5 shadow-lg">
            <p className="text-sm font-semibold text-slate-900">Payment details</p>
            <p className="text-xs text-slate-500">Enter your email to start checkout.</p>
            <div className="mt-4 grid grid-cols-1 gap-4">
              <label className="text-sm font-semibold text-slate-800">
                Email for receipt
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                  placeholder="you@example.com"
                />
              </label>
              <label className="text-sm font-semibold text-slate-800">
                Name on card
                <input
                  type="text"
                  required
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                  placeholder="Full name"
                />
              </label>
            </div>
            {intentError && <p className="mt-3 text-sm text-red-600">{intentError}</p>}
            <div className="mt-3 text-xs text-slate-500">
              {intentLoading ? "Connecting to Stripe..." : "We’ll start checkout once email is provided."}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function PaymentForm({
  email,
  setEmail,
  cardName,
  setCardName,
  onSubmit,
  planId,
  processing,
  setProcessing,
  intentError,
  subscriptionId,
  customerId,
  intentType
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);
    setError(null);
    let submitError;
    if (intentType === "setup") {
      const result = await stripe.confirmSetup({
        elements,
        confirmParams: {
          payment_method_data: {
            billing_details: {
              name: cardName || undefined,
              email: email || undefined
            }
          }
        },
        redirect: "if_required"
      });
      submitError = result.error;
    } else {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          receipt_email: email || undefined,
          payment_method_data: {
            billing_details: {
              name: cardName || undefined,
              email: email || undefined
            }
          }
        },
        redirect: "if_required"
      });
      submitError = result.error;
    }

    if (submitError) {
      setError(submitError.message || "Payment failed. Please try again.");
      setProcessing(false);
      return;
    }

    let receiptUrl = null;
    let invoiceUrl = null;

    if (subscriptionId) {
      try {
        const res = await fetch("/api/payments/confirm-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscriptionId, email, planId, customerId })
        });
        const confirmData = await res.json().catch(() => ({}));
        receiptUrl = confirmData?.receipt_url || confirmData?.invoice_pdf || null;
        invoiceUrl = confirmData?.invoice_url || confirmData?.hosted_invoice_url || null;
      } catch (confirmErr) {
        console.error("Failed to confirm subscription status", confirmErr);
      }
    }

    setProcessing(false);
    if (onSubmit) {
      onSubmit({
        planId: planId || "gold",
        email,
        cardName,
        subscriptionId,
        customerId,
        receiptUrl,
        invoiceUrl
      });
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-white/10 bg-white p-5 shadow-lg"
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Payment details</p>
          <p className="text-xs text-slate-500">All transactions are encrypted and secure.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-6 w-10 rounded bg-slate-100" aria-hidden />
          <span className="h-6 w-10 rounded bg-slate-100" aria-hidden />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <label className="text-sm font-semibold text-slate-800">
          Email for receipt
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
            placeholder="you@example.com"
          />
        </label>

        <label className="text-sm font-semibold text-slate-800">
          Name on card
          <input
            type="text"
            required
            value={cardName}
            onChange={(e) => setCardName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
            placeholder="Full name"
          />
        </label>

        <div className="rounded-lg border border-slate-200 p-3">
          <PaymentElement />
        </div>
      </div>

      {intentError && <p className="mt-3 text-sm text-red-600">{intentError}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={!stripe || processing}
        className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-70"
      >
        {processing ? "Processing..." : "Confirm and pay"}
      </button>

      <p className="mt-3 text-xs text-slate-500">
        Monthly billing, no commitments. Cancel anytime.
      </p>
    </form>
  );
}
