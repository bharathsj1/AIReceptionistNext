import React, { useMemo, useState } from "react";

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

export default function PaymentScreen({ planId, onBack, onSubmit }) {
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [email, setEmail] = useState("");

  const plan = useMemo(() => {
    if (planId && plans[planId]) return plans[planId];
    return plans.gold;
  }, [planId]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (onSubmit) {
      onSubmit({
        planId: planId || "gold",
        cardName,
        cardNumber,
        expiry,
        cvc,
        email
      });
    }
  };

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_20px_90px_rgba(15,23,42,0.35)] backdrop-blur md:p-10">
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

            <label className="text-sm font-semibold text-slate-800">
              Card number
              <input
                type="text"
                required
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                placeholder="1234 5678 9012 3456"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-semibold text-slate-800">
                Expiry
                <input
                  type="text"
                  required
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                  placeholder="MM/YY"
                />
              </label>
              <label className="text-sm font-semibold text-slate-800">
                CVC
                <input
                  type="text"
                  required
                  value={cvc}
                  onChange={(e) => setCvc(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                  placeholder="123"
                />
              </label>
            </div>
          </div>

          <button
            type="submit"
            className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            Confirm and pay
          </button>

          <p className="mt-3 text-xs text-slate-500">
            By confirming, you agree to our terms of service and privacy policy.
          </p>
        </form>
      </div>
    </section>
  );
}
