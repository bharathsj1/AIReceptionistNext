"use client";

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
  return (
    <section className="business-layout">
      <div className="business-left">
        <div className="brand-row">
          <div className="brand-dot" />
          <span className="brand-name" style={{ color: "#0b1224" }}>SmartConnect4u</span>
          <div className="stepper">
            <span style={{ color: "#0b1224" }}>Step 1/4</span>
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
            <span className="flag">🇬🇧</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
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
