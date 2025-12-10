import React from "react";

const packages = [
  {
    id: "bronze",
    name: "Bronze",
    price: "$500/mo",
    description: "Launch your AI receptionist with core voice + transcript access.",
    features: [
      "Unlimited calls",
      "Real-time voice + live transcripts",
      "Basic analytics & call summaries",
      "Email support during business hours"
    ],
    accent: "from-amber-500/90 to-orange-500/80"
  },
  {
    id: "silver",
    name: "Silver",
    price: "$600/mo",
    description: "Add richer controls, smarter hand-offs, and priority support.",
    features: [
      "Unlimited calls",
      "Smart hand-off workflows & call routing",
      "Priority email + chat support",
      "Custom greetings and warm transfers"
    ],
    accent: "from-indigo-500/90 to-blue-500/80"
  },
  {
    id: "gold",
    name: "Gold",
    price: "$700/mo",
    description: "Full concierge experience with advanced automation and QA.",
    features: [
      "Unlimited calls",
      "Advanced analytics & QA reviews",
      "Dedicated success manager",
      "Integration hooks for CRM & calendar"
    ],
    accent: "from-emerald-500/90 to-teal-500/80"
  },
  {
    id: "custom",
    name: "Custom",
    price: "Let’s talk",
    description: "White-glove setup, tailored routing, and enterprise controls.",
    features: [
      "Unlimited calls & custom SLAs",
      "Multi-location routing & IVR trees",
      "Onboarding workshops & QA playbooks",
      "Security reviews and SSO options"
    ],
    accent: "from-slate-800/90 to-slate-900/85"
  }
];

export default function PricingPackages({ onSelectPackage, paymentBasePath = "/payment" }) {
  const handleSelect = (id) => {
    if (onSelectPackage) {
      onSelectPackage(id);
      return;
    }
    if (typeof window !== "undefined") {
      const url = `${paymentBasePath}?plan=${encodeURIComponent(id)}`;
      window.location.assign(url);
    }
  };

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_20px_90px_rgba(15,23,42,0.35)] backdrop-blur md:p-10">
      <div className="pointer-events-none absolute -left-20 top-0 h-48 w-48 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />

      <div className="relative flex flex-col gap-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">
          Plans
        </p>
        <h2 className="text-3xl font-semibold text-white md:text-4xl">
          Choose the concierge fit for you
        </h2>
        <p className="text-sm text-slate-200/80 md:text-base">
          Flexible options to spin up, scale, or go fully bespoke with our AI receptionists. Monthly, no commitments—cancel anytime.
        </p>
      </div>

      <div className="relative mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {packages.map((pkg) => (
          (() => {
            const isGold = pkg.id === "gold";
            return (
          <div
            key={pkg.id}
            className={`group relative flex flex-col overflow-hidden rounded-2xl border ${
              isGold ? "border-amber-200/70 bg-white/10 shadow-2xl ring-2 ring-amber-300/50" : "border-white/10 bg-white/5 shadow-lg"
            } p-5 transition duration-200 hover:-translate-y-1 hover:shadow-2xl`}
          >
            <div
              className={`absolute inset-0 bg-gradient-to-br ${pkg.accent} ${
                isGold ? "opacity-20" : "opacity-0"
              } transition group-hover:opacity-20`}
            />
            <div className="relative flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-200/80">
                  {pkg.name}
                </p>
                <p className="mt-2 text-3xl font-semibold text-white">{pkg.price}</p>
              </div>
              {pkg.id === "gold" && (
                <span className="rounded-full bg-amber-300/90 px-3 py-1 text-xs font-semibold text-amber-950 shadow-sm">
                  Popular
                </span>
              )}
            </div>

            <p className="relative mt-3 text-sm text-slate-100/85">{pkg.description}</p>

            <ul className="relative mt-4 space-y-2 text-sm text-slate-50/90">
              {pkg.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span className="mt-[6px] h-2 w-2 rounded-full bg-white/70" aria-hidden />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <a
              href={`${paymentBasePath}?plan=${pkg.id}`}
              onClick={(e) => {
                e.preventDefault();
                handleSelect(pkg.id);
              }}
              className={`relative mt-6 inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                isGold
                  ? "bg-amber-300 text-amber-950 focus-visible:ring-amber-400"
                  : "bg-white text-slate-900 focus-visible:ring-indigo-500"
              }`}
            >
              Get started
            </a>
          </div>
            );
          })()
        ))}
      </div>
    </section>
  );
}
