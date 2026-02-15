import React from "react";
import ElectricBorder from "./ElectricBorder";

const packages = [
  {
    id: "bronze",
    name: "Bronze",
    baseAmount: 500,
    baseCurrency: "CAD",
    description: "Launch your AI receptionist with core voice + transcript access.",
    features: [
      "500 minutes per month",
      "Real-time voice + live transcripts",
      "Basic analytics & call summaries",
      "Email support during business hours"
    ],
    accent: "from-amber-500/90 to-orange-500/80"
  },
  {
    id: "silver",
    name: "Silver",
    baseAmount: 600,
    baseCurrency: "CAD",
    description: "Add richer controls, smarter hand-offs, and priority support.",
    features: [
      "700 minutes per month",
      "Smart Email Manager",
      "Smart hand-off workflows & call routing",
      "Priority email + chat support",
      "Custom greetings and warm transfers"
    ],
    accent: "from-indigo-500/90 to-blue-500/80"
  },
  {
    id: "gold",
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

export default function PricingPackages({
  onSelectPackage,
  paymentBasePath = "/payment",
  showCrawlSuccess = false,
  geoCountryCode,
  fxRates = {},
  centered = false,
  showCommonCtaWhenCentered = true,
  commonCtaPlanId = "gold"
}) {
  const currencyForCountry = (code) => {
    if (!code) return "USD";
    if (code === "CA") return "CAD";
    if (code === "GB" || code === "UK") return "GBP";
    return "USD";
  };

  const convertAmount = (amount, fromCurrency, toCurrency, fxRates) => {
    if (fromCurrency === toCurrency) return amount;
    // fxRates are USD base: rate = units of target per USD.
    const toPerUsd = fxRates?.[toCurrency] || null;
    const fromPerUsd = fxRates?.[fromCurrency] || null;

    if (!toPerUsd || !fromPerUsd) return amount; // fallback to original

    // amount_in_fromCurrency -> USD -> toCurrency
    const amountInUsd = amount / fromPerUsd;
    return amountInUsd * toPerUsd;
  };

  const formatPrice = (amount, fromCurrency, toCurrency, fxRates) => {
    const converted = convertAmount(amount, fromCurrency, toCurrency, fxRates);
    return `${new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: toCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(converted)}/mo`;
  };

  const getDisplayPackages = (geoCountryCode, fxRates) => {
    const currency = currencyForCountry((geoCountryCode || "").toUpperCase());
    return packages.map((pkg) =>
      pkg.baseAmount
        ? { ...pkg, price: formatPrice(pkg.baseAmount, pkg.baseCurrency || "CAD", currency, fxRates) }
        : pkg
    );
  };

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

  const displayPackages = getDisplayPackages(geoCountryCode, fxRates);
  const nameClass = "text-sm font-semibold uppercase tracking-[0.16em] text-slate-200/80";
  const priceClass = centered ? "" : "mt-1 text-2xl font-semibold text-white";
  const descClass = centered
    ? "relative mt-3 text-[16px] md:text-lg text-slate-100/90 leading-snug font-bold"
    : "relative mt-3 text-sm text-slate-100/85 md:text-base leading-snug";

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_16px_70px_rgba(15,23,42,0.35)] backdrop-blur md:p-8 screen-panel">
      <div className="pointer-events-none absolute -left-20 top-0 h-48 w-48 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />

      <div
        className={`relative flex flex-col gap-1.5 ${centered ? "text-center items-center" : "text-left"}`}
      >
        {showCrawlSuccess && (
          <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-200/60 bg-emerald-400/15 px-4 py-2 text-sm font-semibold text-emerald-100 shadow">
            <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(74,222,128,0.25)]" />
            Hurray! We’ve got all the data we need for your AI receptionist.
          </div>
        )}
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

      <div className="relative mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 justify-items-center">
        {displayPackages.map((pkg) => {
          const isGold = pkg.id === "gold";
          const card = (
            <div
              key={pkg.id}
              className={`group relative flex w-full flex-col overflow-hidden rounded-2xl border ${
                isGold ? "border-transparent bg-white/5 shadow-2xl" : "border-white/10 bg-white/5 shadow-lg"
              } p-5 transition duration-200 hover:-translate-y-1 hover:shadow-2xl`}
              style={centered ? { textAlign: "left", alignItems: "flex-start" } : undefined}
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${pkg.accent} ${
                  isGold ? "opacity-20" : "opacity-0"
                } transition group-hover:opacity-20`}
              />
              <div className={`relative flex w-full ${centered ? "flex-col items-start gap-2" : "items-center justify-between"}`}>
                <div className={centered ? "flex flex-col items-start" : ""}>
                  <p className={nameClass}>{pkg.name}</p>
                  {priceClass && pkg.price ? <p className={priceClass}>{pkg.price}</p> : null}
                </div>
                {isGold && (
                  <span className="popular-badge">
                    Popular
                  </span>
                )}
              </div>

              <p className={descClass}>{pkg.description}</p>

              <ul
                className={`relative mt-4 space-y-2 text-sm text-slate-50/90 ${centered ? "w-full text-left" : ""}`}
              >
                {pkg.features.map((feature) => (
                  <li
                    key={feature}
                    className={`flex gap-2 ${centered ? "items-start justify-start" : "items-start"}`}
                  >
                    <span className="mt-[6px] h-2 w-2 rounded-full bg-white/70" aria-hidden />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {!centered && (
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
              )}
            </div>
          );

          if (!isGold) return card;

          return (
            <ElectricBorder
              key={pkg.id}
              color="#d3c200"
              speed={1}
              chaos={0.05}
              thickness={1.6}
              borderRadius={18}
              className="gold-electric-wrapper"
              style={{ padding: 12 }}
            >
              {card}
            </ElectricBorder>
          );
        })}
      </div>
      {centered && showCommonCtaWhenCentered && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500"
            onClick={() => handleSelect(commonCtaPlanId || displayPackages?.[0]?.id || "gold")}
          >
            Get started
          </button>
        </div>
      )}
    </section>
  );
}
