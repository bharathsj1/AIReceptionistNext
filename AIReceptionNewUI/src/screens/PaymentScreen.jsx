import React, { useEffect, useMemo, useState } from "react";
import {
  Elements,
  CardElement,
  useElements,
  useStripe
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import API_URLS from "../config/urls.js";

const FALLBACK_API_BASE = (
  import.meta.env.VITE_FALLBACK_API_BASE || "https://aireceptionist-func.azurewebsites.net/api"
).replace(/\/$/, "");

const parseResponseBody = async (res) => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const looksLikeHtml = (value) =>
  typeof value === "string" && /<!doctype|<html/i.test(value.slice(0, 200));

const buildFallbackUrl = (url) => {
  if (typeof url !== "string") return null;
  if (/^https?:\/\//i.test(url)) return null;
  if (!url.startsWith("/api/")) return null;
  return `${FALLBACK_API_BASE}${url.slice(4)}`;
};

const fetchJsonWithFallback = async (url, options = {}) => {
  const requestOptions = {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) }
  };
  const res = await fetch(url, requestOptions);
  const data = await parseResponseBody(res);
  const fallbackUrl = buildFallbackUrl(url);

  if (fallbackUrl && looksLikeHtml(data?.raw)) {
    const retryRes = await fetch(fallbackUrl, requestOptions);
    const retryData = await parseResponseBody(retryRes);
    return { res: retryRes, data: retryData };
  }

  return { res, data };
};

const plans = {
  bronze: {
    name: "Bronze",
    baseAmount: 500,
    baseCurrency: "CAD",
    description: "Launch your AI receptionist with core voice + transcript access.",
    features: [
      "500 minutes per month",
      "Real-time voice + live transcripts",
      "Basic analytics & summaries",
      "Email support during business hours"
    ]
  },
  silver: {
    name: "Silver",
    baseAmount: 600,
    baseCurrency: "CAD",
    description: "Add richer controls, smarter hand-offs, and priority support.",
    features: [
      "700 minutes per month",
      "Smart Email Manager",
      "Smart hand-off workflows & routing",
      "Priority email + chat support",
      "Custom greetings and warm transfers"
    ]
  },
  gold: {
    name: "Gold",
    baseAmount: 700,
    baseCurrency: "CAD",
    description: "Full concierge experience with advanced automation and QA.",
    features: [
      "1000 minutes per month",
      "Advanced analytics & QA reviews",
      "Dedicated success manager",
      "Integration hooks for CRM & calendar",
      "Social media manager",
      "Includes everything from Silver package"
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
const TOOL_LABELS = {
  ai_receptionist: "AI Receptionist",
  email_manager: "Email Manager",
  social_media_manager: "Social Media Manager"
};

export default function PaymentScreen({
  planId,
  toolId = "ai_receptionist",
  onBack,
  onSubmit,
  initialEmail = "",
  geoCountryCode,
  fxRates = {}
}) {
  const [clientSecret, setClientSecret] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [intentType, setIntentType] = useState("payment");
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentError, setIntentError] = useState(null);
  const [cardName, setCardName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [processing, setProcessing] = useState(false);
  const [billingMonths, setBillingMonths] = useState(3);
  const [postalCode, setPostalCode] = useState("");

  const currencyForCountry = (code) => {
    if (!code) return "USD";
    const upper = code.toUpperCase();
    if (upper === "CA") return "CAD";
    if (upper === "GB" || upper === "UK") return "GBP";
    return "USD";
  };

  const convertAmount = (amount, fromCurrency, toCurrency) => {
    if (!amount) return amount;
    if (fromCurrency === toCurrency) return amount;
    const toPerUsd = fxRates?.[toCurrency] || null;
    const fromPerUsd = fxRates?.[fromCurrency] || null;
    if (!toPerUsd || !fromPerUsd) return amount;
    const usd = amount / fromPerUsd;
    return usd * toPerUsd;
  };

  const formatPrice = (amount, currency) => {
    if (!amount) return "Let’s talk";
    return `${new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount)}/mo`;
  };

  const plan = useMemo(() => {
    const selected = planId && plans[planId] ? plans[planId] : plans.gold;
    if (selected.price) return selected; // custom plan
    const currency = currencyForCountry(geoCountryCode || "US");
    const converted = convertAmount(selected.baseAmount, selected.baseCurrency || "CAD", currency);
    return {
      ...selected,
      price: formatPrice(converted, currency),
      unitAmount: converted,
      currency
    };
  }, [planId, geoCountryCode, fxRates]);

  const totalDue = useMemo(() => {
    if (!plan.unitAmount) return plan.price;
    return formatPrice(plan.unitAmount * billingMonths, plan.currency || "USD");
  }, [plan.unitAmount, plan.currency, billingMonths, plan.price]);
  const toolLabel = TOOL_LABELS[toolId] || "AI workspace";

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
        const { res, data } = await fetchJsonWithFallback(API_URLS.paymentsCreateSubscription, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId: planId || "gold", toolId, email, billingMonths }),
          signal: controller.signal
        });
        if (!res.ok || !data?.clientSecret) {
          const message =
            data?.error ||
            data?.message ||
            (looksLikeHtml(data?.raw)
              ? "Payments API returned an HTML page instead of JSON. Check /api routing."
              : null) ||
            "Failed to create subscription";
          throw new Error(message);
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
  }, [planId, email, toolId]);

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
            Secure your {toolLabel}
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
              We’ll activate your {toolLabel.toLowerCase()}, share onboarding steps, and tailor call flows to your
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
              toolId={toolId}
              processing={processing}
              setProcessing={setProcessing}
        intentError={intentError}
        subscriptionId={subscriptionId}
        customerId={customerId}
        intentType={intentType}
        billingMonths={billingMonths}
        setBillingMonths={setBillingMonths}
        planCurrency={plan.currency}
        planUnitAmount={plan.unitAmount}
        totalDue={totalDue}
        clientSecret={clientSecret}
        postalCode={postalCode}
        setPostalCode={setPostalCode}
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
  toolId,
  processing,
  setProcessing,
  intentError,
  subscriptionId,
  customerId,
  intentType,
  billingMonths,
  setBillingMonths,
  planCurrency,
  planUnitAmount,
  totalDue,
  clientSecret,
  postalCode,
  setPostalCode
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements || !acceptedTerms) return;
    if (!postalCode.trim()) {
      setError("Please enter your ZIP / Postal code.");
      return;
    }

    setProcessing(true);
    setError(null);
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setError("Unable to load card input. Please refresh and try again.");
      setProcessing(false);
      return;
    }
    let submitError;
    if (intentType === "setup") {
      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            name: cardName || undefined,
            email: email || undefined,
            address: { postal_code: postalCode || undefined }
          }
        }
      });
      submitError = result.error;
    } else {
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            name: cardName || undefined,
            email: email || undefined,
            address: { postal_code: postalCode || undefined }
          }
        },
        receipt_email: email || undefined
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
        const { data: confirmData } = await fetchJsonWithFallback(API_URLS.paymentsConfirmSubscription, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscriptionId,
            email,
            planId,
            toolId,
            customerId,
            billingMonths,
            postalCode
          })
        });
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
        toolId,
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
          Billing period (pay upfront)
          <select
            value={billingMonths}
            onChange={(e) => setBillingMonths(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
          >
            <option value={2}>2 months upfront</option>
            <option value={3}>3 months upfront</option>
            <option value={6}>6 months upfront</option>
            <option value={12}>1 year upfront</option>
          </select>
        </label>

        <label className="text-sm font-semibold text-slate-800">
          Email for receipt
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!acceptedTerms}
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
            disabled={!acceptedTerms}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
            placeholder="Full name"
          />
        </label>

        <label className="text-sm font-semibold text-slate-800">
          ZIP / Postal code
          <input
            type="text"
            required
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            disabled={!acceptedTerms}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
            placeholder="e.g., 94107 or W1A 1AA"
            autoComplete="postal-code"
          />
        </label>

        <div className="relative rounded-lg border border-slate-200 p-3">
          {!acceptedTerms && (
            <div
              className="absolute inset-0 z-10 rounded-lg bg-white/70 backdrop-blur-sm cursor-not-allowed"
              aria-hidden="true"
            />
          )}
          <CardElement
            options={{
              hidePostalCode: true,
              style: {
                base: {
                  fontSize: "16px",
                  color: "#0f172a",
                  "::placeholder": { color: "#94a3b8" }
                }
              }
            }}
          />
        </div>

        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-1 h-4 w-4 cursor-pointer"
          />
          <span>
            I agree to the{" "}
            <a
              href="/terms.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 underline"
            >
              SmartConnect4u Terms &amp; Conditions
            </a>
            .
          </span>
        </label>
      </div>

      {intentError && <p className="mt-3 text-sm text-red-600">{intentError}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {planUnitAmount ? (
        <p className="mt-2 text-sm font-semibold text-slate-800">
          Due today: <span className="text-indigo-700">{totalDue}</span>
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!stripe || processing || !acceptedTerms}
        className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-70"
      >
        {processing ? "Processing..." : acceptedTerms ? "Confirm and pay" : "Accept terms to continue"}
      </button>

      <p className="mt-3 text-xs text-slate-500">
        Monthly billing, no commitments. Cancel anytime.
      </p>
    </form>
  );
}
