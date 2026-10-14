import React from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";

const packages = [
  {
    id: "bronze",
    name: "Bronze",
    baseAmount: 500,
    baseCurrency: "CAD",
    description:
      "Launch your AI receptionist with core voice + transcript access.",
    features: [
      "500 minutes per month",
      "Real-time voice + live transcripts",
      "Basic analytics & call summaries",
      "Email support during business hours",
    ],
    accent: "from-amber-500/90 to-orange-500/80",
  },
  {
    id: "silver",
    name: "Silver",
    baseAmount: 600,
    baseCurrency: "CAD",
    description:
      "Add richer controls, smarter hand-offs, and priority support.",
    features: [
      "700 minutes per month",
      "Smart Email Manager",
      "Smart hand-off workflows & call routing",
      "Priority email + chat support",
      "Custom greetings and warm transfers",
    ],
    accent: "from-indigo-500/90 to-blue-500/80",
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
      "Includes everything from Silver package",
    ],
    accent: "from-emerald-500/90 to-teal-500/80",
  },
  {
    id: "custom",
    name: "Custom",
    price: "Let’s talk",
    description:
      "White-glove setup, tailored routing, and enterprise controls.",
    features: [
      "Unlimited calls & custom SLAs",
      "Multi-location routing & IVR trees",
      "Onboarding workshops & QA playbooks",
      "Security reviews and SSO options",
    ],
    accent: "from-slate-800/90 to-slate-900/85",
  },
];

export default function PricingPackages({
  onSelectPackage,
  paymentBasePath = "/payment",
  showCrawlSuccess = false,
  geoCountryCode,
  fxRates = {},
  centered = false,
  showCommonCtaWhenCentered = true,
  commonCtaPlanId = "gold",
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
      maximumFractionDigits: 0,
    }).format(converted)}/mo`;
  };

  const getDisplayPackages = (geoCountryCode, fxRates) => {
    const currency = currencyForCountry((geoCountryCode || "").toUpperCase());
    return packages.map((pkg) =>
      pkg.baseAmount
        ? {
            ...pkg,
            price: formatPrice(
              pkg.baseAmount,
              pkg.baseCurrency || "CAD",
              currency,
              fxRates,
            ),
          }
        : pkg,
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
  return (
    <section className="pricing-section">
      <div className="pricing-heading">
        {showCrawlSuccess && (
          <p className="setup-success">
            <Check size={16} /> Your business knowledge is ready. Choose your
            next step.
          </p>
        )}
        <p className="eyebrow">A PLAN FOR YOUR NEXT CHAPTER</p>
        <h2>
          Start with what you need.
          <br />
          Grow from there.
        </h2>
        <p>Choose the right support for your business, with room to do more.</p>
      </div>
      <div className="pricing-grid">
        {displayPackages.map((pkg) => (
          <article
            key={pkg.id}
            className={`pricing-card ${pkg.id === "gold" ? "pricing-card-featured" : ""}`}
          >
            <div className="pricing-card-top">
              <span>{pkg.name}</span>
              {pkg.id === "gold" && (
                <span className="pricing-recommended">
                  <Sparkles size={12} /> Popular
                </span>
              )}
            </div>
            <strong className="pricing-price">{pkg.price}</strong>
            <p>{pkg.description}</p>
            <a
              className={`sc-button ${pkg.id === "gold" ? "sc-button-primary" : "sc-button-secondary"}`}
              href={`${paymentBasePath}?plan=${pkg.id}`}
              onClick={(event) => {
                event.preventDefault();
                handleSelect(pkg.id);
              }}
            >
              Choose {pkg.name.toLowerCase()} <ArrowRight size={15} />
            </a>
            <div className="pricing-divider" />
            <ul>
              {pkg.features.map((feature) => (
                <li key={feature}>
                  <Check size={15} />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      {centered && showCommonCtaWhenCentered && (
        <div className="pricing-common-cta">
          <button
            className="sc-button sc-button-primary"
            onClick={() =>
              handleSelect(
                commonCtaPlanId || displayPackages?.[0]?.id || "gold",
              )
            }
          >
            Get started <ArrowRight size={16} />
          </button>
        </div>
      )}
    </section>
  );
}
