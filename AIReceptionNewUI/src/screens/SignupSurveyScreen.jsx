"use client";

export default function SignupSurveyScreen({
  name,
  role,
  useCase,
  referral,
  onRoleChange,
  onUseCaseChange,
  onReferralChange,
  onContinue
}) {
  const roles = ["Founder / Owner", "Operations", "Marketing", "Sales", "Support", "Other"];
  const useCases = ["AI Receptionist", "Lead capture", "Support triage", "Booking / scheduling", "Other"];
  const referrals = ["Search engine", "Friend/colleague", "Social media", "Partner/agency", "Other"];

  return (
    <section className="survey-layout screen-panel">
      <div className="survey-left">
        <div className="brand-row">
          <div className="brand-dot" />
          <span className="brand-name">SmartConnect4u</span>
        </div>
        <h3 className="mt-4">🎉 Welcome{ name ? `, ${name}` : ""}! Help us create the best experience for you.</h3>
        <p className="lead text-slate-900">
          We're excited to have you here! Please select the options that represent you best so we can tailor
          SmartConnect4u to your needs.
        </p>

        <div className="survey-field">
          <label>What is your role?</label>
          <select value={role} onChange={(e) => onRoleChange(e.target.value)}>
            <option value="">Select an option</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="survey-field">
          <label>What is your main use case with SmartConnect4u?</label>
          <select value={useCase} onChange={(e) => onUseCaseChange(e.target.value)}>
            <option value="">Select an option</option>
            {useCases.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="survey-field">
          <label>How did you hear about us?</label>
          <select value={referral} onChange={(e) => onReferralChange(e.target.value)}>
            <option value="">Select an option</option>
            {referrals.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="survey-continue"
          onClick={onContinue}
          disabled={!role || !useCase || !referral}
        >
          Continue →
        </button>
      </div>

      <div className="survey-right">
        <div className="pulse-circle" aria-hidden />
      </div>
    </section>
  );
}
