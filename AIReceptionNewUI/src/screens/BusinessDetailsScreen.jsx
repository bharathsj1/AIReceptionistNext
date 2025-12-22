"use client";

import { useEffect, useState } from "react";

export default function BusinessDetailsScreen({
  userName,
  name,
  phone,
  onNameChange,
  onPhoneChange,
  onContinue,
  onBack,
  loading = false,
  error = ""
}) {
  const welcomeName = userName || "there";
  const [country, setCountry] = useState("UK");
  const [localPhone, setLocalPhone] = useState("");
  const countryOptions = [
    { value: "UK", label: "🇬🇧", dialCode: "+44" },
    { value: "CA", label: "🇨🇦", dialCode: "+1" }
  ];
  const selectedCountry = countryOptions.find((option) => option.value === country) || countryOptions[0];

  useEffect(() => {
    const normalized = (phone || "").trim();
    if (!normalized) {
      setLocalPhone("");
      return;
    }
    if (normalized.startsWith("+44")) {
      setCountry("UK");
      setLocalPhone(normalized.replace(/^\+44\s*/, ""));
      return;
    }
    if (normalized.startsWith("+1")) {
      setCountry("CA");
      setLocalPhone(normalized.replace(/^\+1\s*/, ""));
      return;
    }
    setLocalPhone(normalized);
  }, [phone]);
  return (
    <section className="business-layout screen-panel">
      <div className="business-left">
        <div className="brand-row">
          <div className="brand-dot" />
          <span className="brand-name">SmartConnect4u</span>
          <div className="stepper">
            <span>Step 1/4</span>
            <div className="progress">
              <div className="progress-bar" />
            </div>
          </div>
        </div>

        <h3 className="mt-4">🎉 Welcome aboard, {welcomeName}!</h3>
        <p className="lead">
          We're excited to have you here. To kick things off, share your business name and phone number so
          we can set up your workspace.
        </p>

        <div className="business-field">
          <label>What's your business name?</label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g., Acme Inc"
          />
          <div className="char-count">{name?.length || 0}/100</div>
        </div>

        <div className="business-field">
          <label>What's your phone number?</label>
          <div className="phone-input">
            <select
              className="country-select"
              value={country}
              onChange={(event) => {
                const next = event.target.value;
                const nextCountry =
                  countryOptions.find((option) => option.value === next) || countryOptions[0];
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
