"use client";

import { useEffect, useState } from "react";

export default function BusinessDetailsScreen({
  userName,
  name,
  phone,
  geoCountryCode,
  onNameChange,
  onPhoneChange,
  onContinue,
  onBack,
  loading = false,
  error = "",
  localSetup = false,
}) {
  const welcomeName = userName || "there";
  const [country, setCountry] = useState("GB");
  const [localPhone, setLocalPhone] = useState("");
  const countryOptions = [
    { value: "GB", label: "🇬🇧", dialCode: "+44" },
    { value: "CA", label: "🇨🇦", dialCode: "+1" },
    { value: "US", label: "🇺🇸", dialCode: "+1" },
  ];
  const selectedCountry =
    countryOptions.find((option) => option.value === country) ||
    countryOptions[0];

  useEffect(() => {
    const normalized = (phone || "").trim();
    if (!normalized) {
      setLocalPhone("");
      return;
    }
    if (normalized.startsWith("+44")) {
      setCountry("GB");
      setLocalPhone(normalized.replace(/^\+44\s*/, ""));
      return;
    }
    if (normalized.startsWith("+1")) {
      // +1 is shared by US and CA; prefer geo hint if available.
      const fallback =
        geoCountryCode && ["US", "CA"].includes(geoCountryCode)
          ? geoCountryCode
          : "CA";
      setCountry(fallback);
      setLocalPhone(normalized.replace(/^\+1\s*/, ""));
      return;
    }
    setLocalPhone(normalized);
  }, [phone, geoCountryCode]);

  useEffect(() => {
    if (phone) return; // respect existing input
    const geo = (geoCountryCode || "").toUpperCase();
    const match = countryOptions.find((opt) => opt.value === geo);
    if (match) {
      setCountry(match.value);
      onPhoneChange(`${match.dialCode}${localPhone}`);
    }
  }, [geoCountryCode]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="business-layout screen-panel">
      <div className="business-left">
        <div className="brand-row">
          <div className="brand-dot" />
          <span className="brand-name">Vedora Outreach</span>
          <div className="stepper">
            <span>{localSetup ? "Business details" : "Step 1/4"}</span>
            <div className="progress">
              <div className="progress-bar" />
            </div>
          </div>
        </div>

        <h3 className="mt-4">Let’s make it yours, {welcomeName}.</h3>
        <p className="lead">
          Tell us who you are and how customers can reach you. We’ll use these
          details to personalise your workspace.
        </p>

        <div className="business-field">
          <label htmlFor="setup-business-name">
            What’s your business name?
          </label>
          <input
            id="setup-business-name"
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g., Acme Inc"
          />
          <div className="char-count">{name?.length || 0}/100</div>
        </div>

        <div className="business-field">
          <label htmlFor="setup-business-phone">
            What’s your phone number?
          </label>
          <div className="phone-input">
            <select
              className="country-select"
              value={country}
              onChange={(event) => {
                const next = event.target.value;
                const nextCountry =
                  countryOptions.find((option) => option.value === next) ||
                  countryOptions[0];
                setCountry(nextCountry.value);
                onPhoneChange(`${nextCountry.dialCode}${localPhone}`);
              }}
              aria-label="Country code"
            >
              {countryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} {option.dialCode}
                </option>
              ))}
            </select>
            <input
              id="setup-business-phone"
              autoComplete="tel-national"
              type="tel"
              value={localPhone}
              onChange={(e) => {
                const nextValue = e.target.value;
                setLocalPhone(nextValue);
                onPhoneChange(`${selectedCountry.dialCode}${nextValue}`);
              }}
              placeholder="+1 234 567 8900"
            />
          </div>
        </div>

        <div className="business-actions">
          <button type="button" className="ghost" onClick={onBack}>
            ← Back
          </button>
          <button
            type="button"
            className="primary"
            onClick={onContinue}
            disabled={loading || !name || !phone}
          >
            {loading ? "Saving..." : "Let's Go →"}
          </button>
        </div>
        {error ? <div className="form-error">{error}</div> : null}
      </div>

      <div className="business-right">
        <div className="business-card">
          <div className="mini-brand">
            <div className="mini-dot" />
          </div>
          <div className="biz-name">{name || "Your business"}</div>
          <div className="biz-phone">{phone || "Phone number"}</div>
          <div className="ghost-line" />
          <div className="ghost-line short" />
          <div className="ghost-line" />
          <div className="ghost-line short" />
        </div>
      </div>
    </section>
  );
}
