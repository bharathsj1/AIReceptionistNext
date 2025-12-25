import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function LoginScreen({
  loginEmail,
  loginPassword,
  status,
  responseMessage,
  responseLink,
  onLoginSubmit,
  onEmailChange,
  onPasswordChange,
  onCreateAccount,
  onForgotPassword
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="signup-card-wrap screen-panel narrow">
      <section className="login-layout login-layout-compact">
        <div className="form-card login-card">
          <div className="login-grid">
            <div className="login-left">
              <div>
                <p className="eyebrow">Welcome back</p>
                <h2>Login to AI Receptionist</h2>
                <p className="lead narrow">
                  Access your concierge dashboard and manage your reception flows.
                </p>
              </div>
              <form className="url-form" onSubmit={onLoginSubmit}>
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  type="email"
                  placeholder="you@example.com"
                  value={loginEmail}
                  onChange={(event) => onEmailChange(event.target.value)}
                  required
                />
                <label htmlFor="login-password">Password</label>
                <div className="password-field">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
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
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>
                <button className="primary full" type="submit" disabled={status === "loading"}>
                  {status === "loading" ? "Signing in..." : "Login"}
                </button>
              </form>
              <div className="link-row">
                <button className="text-link" type="button" onClick={onForgotPassword}>
                  Forgot password?
                </button>
                <button className="text-link" type="button" onClick={onCreateAccount}>
                  Create an account
                </button>
              </div>
              {responseMessage && (
                <div className={`status ${status}`}>
                  <div>{responseMessage}</div>
                  {responseLink && (
                    <a href={responseLink} target="_blank" rel="noreferrer">
                      Reset your password
                    </a>
                  )}
                </div>
              )}
            </div>
            <aside className="login-aside">
              <p className="eyebrow">How it works</p>
              <h3>AI Reception, on autopilot</h3>
              <ul>
                <li>Drop your website URL, we ingest your content in seconds.</li>
                <li>Generate conversational prompts tailored to your brand.</li>
                <li>Route real leads via voice, chat, or hand-offs to your team.</li>
              </ul>
              <p className="hint">New here? Hit Create an account to start with your URL.</p>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}
