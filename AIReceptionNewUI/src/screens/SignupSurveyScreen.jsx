"use client";

export default function SignupSurveyScreen({
  name,
  role,
  useCase,
  referral,
  onRoleChange,
  onUseCaseChange,
  onReferralChange,
  onContinue,
}) {
  const roles = [
    "Founder / Owner",
    "Operations",
    "Marketing",
    "Sales",
    "Support",
    "Other",
  ];
  const useCases = [
    "AI Receptionist",
    "Lead capture",
    "Support triage",
    "Booking / scheduling",
    "Other",
  ];
  const referrals = [
    "Search engine",
    "Friend/colleague",
    "Social media",
    "Partner/agency",
    "Other",
  ];

  return (
    <section className="survey-layout screen-panel">
      <div className="survey-left">
        <div className="brand-row">
          <div className="brand-dot" />
          <span className="brand-name">SmartConnect4u</span>
        </div>
        <h3 className="mt-4">
          Make yourself at home{name ? `, ${name}` : ""}.
        </h3>
        <p className="lead text-slate-900">
          A few quick details help us shape your workspace around the way you
          work.
        </p>

        <div className="survey-field">
          <label htmlFor="setup-role">What is your role?</label>
          <select
            id="setup-role"
            value={role}
            onChange={(e) => onRoleChange(e.target.value)}
          >
            <option value="">Select an option</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="survey-field">
          <label htmlFor="setup-use-case">
            What would you like a hand with?
          </label>
          <select
            id="setup-use-case"
            value={useCase}
            onChange={(e) => onUseCaseChange(e.target.value)}
          >
            <option value="">Select an option</option>
            {useCases.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="survey-field">
          <label htmlFor="setup-referral">How did you hear about us?</label>
          <select
            id="setup-referral"
            value={referral}
            onChange={(e) => onReferralChange(e.target.value)}
          >
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
        <p className="eyebrow">YOUR WORKSPACE, YOUR WAY</p>
        <h3>Start with what matters to you.</h3>
        <p className="lead">
          Calls, messages, follow-ups, or all of the above. Your workspace
          brings them together.
        </p>
        <ul>
          <li>Connect your customer conversations</li>
          <li>Give every follow-up a clear next step</li>
          <li>Keep your team working together</li>
        </ul>
      </div>
    </section>
  );
}
