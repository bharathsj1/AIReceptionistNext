import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

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
  const [showPassword, setShowPassword] = useState(false);
  const passwordValid = (() => {
    if (!password) return false;
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSymbol = /[^A-Za-z0-9]/.test(password);
    return password.length >= 8 && hasLower && hasUpper && hasNumber && hasSymbol;
  })();
  const emailValid = (() => {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  })();
  const showPasswordStatus = password.length > 0;
  const showEmailStatus = email.length > 0;
  const handleSubmit = (event) => {
    event.preventDefault();
    if (!passwordValid) return;
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
                  className={showEmailStatus && !emailValid ? "is-invalid" : ""}
                  required
                />
              </label>
              <label className="signup-label">
                Password
                <div className="password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Create Password"
                    value={password}
                    onChange={(e) => onPasswordChange(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
              </label>
              <p
                className={`password-hint ${showPasswordStatus ? (passwordValid ? "is-valid" : "is-invalid") : ""}`.trim()}
              >
                Use 8+ chars with uppercase, lowercase, number, and symbol.
              </p>
              <p className="tiny">
                By signing up you agree to our <a href="#">Terms</a> and{" "}
                <a href="#">Privacy Policy</a>.
              </p>
              <button className="primary full" type="submit" disabled={loading || !passwordValid}>
                {loading ? "Creating..." : "Create Account"}
              </button>
            </form>
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
          <div className="hint-row">
              <span className="login-hint-text">Already have an account? </span>
              <button type="button" className="text-link login-hint-text" onClick={onBackToLogin}>
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
