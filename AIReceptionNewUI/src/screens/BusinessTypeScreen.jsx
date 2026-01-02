import { useEffect, useMemo, useState } from "react";
import {
  businessCategories,
  getPreviewBullets,
  getSubTypesForCategory
} from "../lib/businessTypes";

const CUSTOM_OPTION = "Other (Custom)";

export default function BusinessTypeScreen({
  businessName,
  category,
  subType,
  customType,
  onBusinessNameChange,
  onCategoryChange,
  onSubTypeChange,
  onCustomTypeChange,
  onContinue,
  onBack,
  onSkip,
  loading = false,
  error = ""
}) {
  const [fieldErrors, setFieldErrors] = useState({});

  const showCustomField = category === CUSTOM_OPTION || subType === CUSTOM_OPTION;

  const subTypeOptions = useMemo(() => getSubTypesForCategory(category), [category]);

  const previewBullets = useMemo(() => getPreviewBullets(category), [category]);

  useEffect(() => {
    onSubTypeChange("");
    onCustomTypeChange("");
    setFieldErrors((prev) => {
      if (!prev.subType && !prev.customType) return prev;
      return { ...prev, subType: "", customType: "" };
    });
  }, [category, onCustomTypeChange, onSubTypeChange]);

  useEffect(() => {
    if (!showCustomField && customType) {
      onCustomTypeChange("");
      setFieldErrors((prev) => {
        if (!prev.customType) return prev;
        return { ...prev, customType: "" };
      });
    }
  }, [customType, onCustomTypeChange, showCustomField]);

  const clearFieldError = (field) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateFields = () => {
    const nextErrors = {};
    if (!category) nextErrors.category = "Please select a category.";
    if (!subType) nextErrors.subType = "Please select a sub-type.";
    if (showCustomField) {
      const trimmed = (customType || "").trim();
      if (trimmed.length < 2 || trimmed.length > 60) {
        nextErrors.customType = "Custom type must be 2-60 characters.";
      }
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleContinue = () => {
    if (!validateFields()) return;
    onContinue?.({
      category,
      subType,
      customType: showCustomField ? (customType || "").trim() : "",
      businessName: (businessName || "").trim()
    });
  };

  return (
    <section className="business-layout screen-panel business-type-layout">
      <div className="business-left">
        <div className="brand-row">
          <div className="brand-dot" />
          <span className="brand-name">SmartConnect4u</span>
          <div className="stepper">
            <span>Step 2/4</span>
            <div className="progress">
              <div className="progress-bar" />
            </div>
          </div>
        </div>

        <h3 className="mt-2">Tell us about your business</h3>
        <p className="lead">
          We'll tailor your AI receptionist scripts, voice, and booking flow.
        </p>

        <div className="business-field">
          <label htmlFor="business-category">Business Category</label>
          <select
            id="business-category"
            value={category}
            onChange={(event) => {
              onCategoryChange(event.target.value);
              clearFieldError("category");
            }}
            aria-invalid={Boolean(fieldErrors.category)}
          >
            <option value="">Select a category</option>
            {businessCategories.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {fieldErrors.category ? (
            <div className="field-error">{fieldErrors.category}</div>
          ) : null}
        </div>

        <div className="business-field">
          <label htmlFor="business-subtype">Business Sub-Type</label>
          <select
            id="business-subtype"
            value={subType}
            onChange={(event) => {
              onSubTypeChange(event.target.value);
              clearFieldError("subType");
            }}
            disabled={!category}
            aria-invalid={Boolean(fieldErrors.subType)}
          >
            <option value="">Select a sub-type</option>
            {subTypeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {!subTypeOptions.length && category ? (
            <div className="field-hint">No matches. Try a different search.</div>
          ) : null}
          {fieldErrors.subType ? (
            <div className="field-error">{fieldErrors.subType}</div>
          ) : null}
        </div>

        {showCustomField ? (
          <div className="business-field">
            <label htmlFor="custom-type">Custom business type</label>
            <input
              id="custom-type"
              type="text"
              value={customType}
              onChange={(event) => {
                onCustomTypeChange(event.target.value);
                clearFieldError("customType");
              }}
              placeholder="Describe your business"
              aria-invalid={Boolean(fieldErrors.customType)}
            />
            {fieldErrors.customType ? (
              <div className="field-error">{fieldErrors.customType}</div>
            ) : null}
          </div>
        ) : null}

        <div className="business-field">
          <label htmlFor="business-name">Business Name (Optional)</label>
          <input
            id="business-name"
            type="text"
            value={businessName}
            onChange={(event) => onBusinessNameChange(event.target.value)}
            placeholder="Your business name"
          />
        </div>

        <div className="business-actions">
          <button type="button" className="ghost" onClick={onBack} disabled={loading}>
            ← Back
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleContinue}
            disabled={loading}
          >
            {loading ? "Saving..." : "Continue"}
          </button>
          <button type="button" className="ghost" onClick={onSkip} disabled={loading}>
            Skip for now
          </button>
        </div>

        {error ? <div className="form-error">{error}</div> : null}
      </div>

      <div className="business-right">
        <div className="business-preview-card">
          <div>
            <div className="business-preview-title">What we'll configure</div>
            <div className="business-preview-subtitle">
              {category ? `Based on ${category}` : "Based on your selection"}
            </div>
          </div>
          <ul className="business-preview-list">
            {previewBullets.map((item) => (
              <li key={item} className="business-preview-item">
                <span className="business-preview-dot" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
