export default function CreateAccountScreen({
  name,
  email,
  password,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onBackToLogin,
  loading = false,
  error = ""
}) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit({ name, email, password });
  };

  return (
    <section className="signup-card-wrap screen-panel narrow">
      <div className="signup-modern-card">
        <div className="signup-grid">
          <div className="signup-left">
            <h2>Create your free account</h2>
            <p className="lead text-slate-900">Run your business on autopilot with SmartConnect4u.</p>

            <form className="signup-form" onSubmit={handleSubmit}>
              <label className="signup-label">
                Full Name
                <input
                  type="text"
                  placeholder="e.g. John Smith"
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  required
                />
              </label>
              <label className="signup-label">
                Work Email
                <input
                  type="email"
                  placeholder="e.g. alex@example.com"
                  value={email}
                  onChange={(e) => onEmailChange(e.target.value)}
                  required
                />
              </label>
              <label className="signup-label">
                Password
                <input
                  type="password"
                  placeholder="Create Password"
                  value={password}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  required
                />
              </label>
              <p className="tiny">
                By signing up you agree to our <a href="#">Terms</a> and{" "}
                <a href="#">Privacy Policy</a>.
              </p>
              <button className="primary full" type="submit">
                {loading ? "Creating..." : "Create Account"}
              </button>
            </form>
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            <div className="hint-row">
              <span className="text-slate-900">Already have an account? </span>
              <button type="button" className="text-link text-slate-900" onClick={onBackToLogin}>
                Log in
              </button>
            </div>
          </div>

          <div className="signup-right">
            <div className="signup-highlight">
              <p className="eyebrow">SmartConnect4u, on autopilot</p>
              <h4>Your voice concierge, ready in minutes.</h4>
              <ul>
                <li>Answer calls 24/7 with natural voice.</li>
                <li>Capture leads, book meetings, and route VIPs.</li>
                <li>Syncs with your calendar and CRM out of the box.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
