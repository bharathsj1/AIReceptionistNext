import { useState } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import AuthStory from "../components/AuthStory";

export default function LoginScreen({
  loginEmail,
  loginPassword,
  checkoutPlanSummary,
  status,
  responseMessage,
  responseLink,
  onLoginSubmit,
  onEmailChange,
  onPasswordChange,
  onCreateAccount,
  onForgotPassword,
}) {
  const [showPassword, setShowPassword] = useState(false);
  const busy = status === "loading";
  return (
    <section className="auth-layout">
      <div className="auth-form-panel">
        <span className="auth-kicker">
          <LockKeyhole size={15} /> YOUR WORKSPACE, WAITING FOR YOU
        </span>
        <h1>
          Good to have
          <br />
          you back.
        </h1>
        <p className="auth-description">
          Sign in and pick up where you left off.
        </p>
        <form
          className="url-form auth-form"
          onSubmit={onLoginSubmit}
          aria-busy={busy}
        >
          <label htmlFor="login-email">Work email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            placeholder="you@yourbusiness.com"
            value={loginEmail}
            onChange={(event) => onEmailChange(event.target.value)}
            required
          />
          <div className="auth-label-row">
            <label htmlFor="login-password">Password</label>
            <button
              className="text-link"
              type="button"
              onClick={onForgotPassword}
            >
              Forgot password?
            </button>
          </div>
          <div className="password-field">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={loginPassword}
              onChange={(event) => onPasswordChange(event.target.value)}
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
          {responseMessage && (
            <div
              role={status === "error" ? "alert" : "status"}
              className={`status ${status}`}
            >
              <span>{responseMessage}</span>
              {responseLink && (
                <a href={responseLink} target="_blank" rel="noreferrer">
                  Reset your password
                </a>
              )}
            </div>
          )}
          <button
            className="sc-button sc-button-primary full"
            type="submit"
            disabled={busy}
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : null}
            {busy ? "Signing you in…" : "Open my workspace"}
            {!busy && <ArrowRight size={17} />}
          </button>
        </form>
        <p className="auth-switch">
          New to SmartConnect4u?{" "}
          <button type="button" className="text-link" onClick={onCreateAccount}>
            Create an account <ArrowUp />
          </button>
        </p>
        <p className="auth-security">
          <LockKeyhole size={13} /> Your business details stay in your
          workspace.
        </p>
      </div>
      <AuthStory checkoutPlanSummary={checkoutPlanSummary} />
    </section>
  );
}
function ArrowUp() {
  return <span aria-hidden="true">↗</span>;
}
