import { useState } from "react";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import AuthStory from "../components/AuthStory";

export default function CreateAccountScreen({
  name,
  email,
  password,
  checkoutPlanSummary,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onBackToLogin,
  loading = false,
  error = "",
}) {
  const [showPassword, setShowPassword] = useState(false);
  const rules = [
    ["8+ characters", password.length >= 8],
    ["Upper & lowercase", /[a-z]/.test(password) && /[A-Z]/.test(password)],
    ["A number", /\d/.test(password)],
    ["A symbol", /[^A-Za-z0-9]/.test(password)],
  ];
  const passwordValid = rules.every(([, valid]) => valid);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const handleSubmit = (event) => {
    event.preventDefault();
    if (!passwordValid) return;
    onSubmit({ name, email, password });
  };
  return (
    <section className="auth-layout">
      <div className="auth-form-panel">
        <span className="auth-kicker">
          <Sparkles size={15} /> A FRESH START FOR YOUR BUSINESS
        </span>
        <h1>
          Your next chapter
          <br />
          starts here.
        </h1>
        <p className="auth-description">
          Create your account. We’ll guide you through the rest.
        </p>
        <form
          className="url-form auth-form"
          onSubmit={handleSubmit}
          aria-busy={loading}
        >
          <label htmlFor="signup-name">Your full name</label>
          <input
            id="signup-name"
            autoComplete="name"
            placeholder="Alex Morgan"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            required
          />
          <label htmlFor="signup-email">Work email</label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            placeholder="you@yourbusiness.com"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            className={email.length > 0 && !emailValid ? "is-invalid" : ""}
            required
          />
          <label htmlFor="signup-password">Create a password</label>
          <div className="password-field">
            <input
              id="signup-password"
              autoComplete="new-password"
              type={showPassword ? "text" : "password"}
              placeholder="Make it a strong one"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              aria-describedby="password-rules"
              required
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <ul className="password-rules" id="password-rules">
            {rules.map(([label, valid]) => (
              <li key={label} className={valid ? "is-valid" : ""}>
                <Check size={12} />
                {label}
              </li>
            ))}
          </ul>
          {error && (
            <p className="status error" role="alert">
              {error}
            </p>
          )}
          <button
            className="sc-button sc-button-primary full"
            type="submit"
            disabled={loading || !passwordValid}
          >
            {loading ? <LoaderCircle className="spin" size={17} /> : null}
            {loading ? "Creating your account…" : "Create my account"}
            {!loading && <ArrowRight size={17} />}
          </button>
          <p className="auth-terms">
            By creating an account, you agree to our{" "}
            <a href="/terms.html" target="_blank" rel="noreferrer">
              Terms
            </a>{" "}
            and{" "}
            <a href="/privacy.html" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>
            .
          </p>
        </form>
        <p className="auth-switch">
          Already part of the team?{" "}
          <button className="text-link" type="button" onClick={onBackToLogin}>
            Sign in ↗
          </button>
        </p>
      </div>
      <AuthStory checkoutPlanSummary={checkoutPlanSummary} />
    </section>
  );
}
