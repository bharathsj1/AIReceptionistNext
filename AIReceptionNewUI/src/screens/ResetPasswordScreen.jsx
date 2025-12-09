export default function ResetPasswordScreen({
  status,
  responseMessage,
  onSubmit,
  onBackToLogin
}) {
  let formRef = null;

  const handleSubmit = (event) => {
    event.preventDefault();
    const formData = new FormData(formRef);
    const newPassword = formData.get("newPassword");
    const confirmPassword = formData.get("confirmPassword");

    if (!newPassword || newPassword.length < 8) {
      alert("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      alert("Passwords do not match.");
      return;
    }
    onSubmit(newPassword);
  };

  return (
    <section className="login-layout">
      <div className="form-card login-card">
        <div>
          <p className="eyebrow">Change password</p>
          <h2>Set a new password</h2>
          <p className="lead narrow">
            Keep your account secure with a fresh password. You’ll use this to sign in next time.
          </p>
        </div>
        <form
          className="url-form"
          onSubmit={handleSubmit}
          ref={(ref) => {
            formRef = ref;
          }}
        >
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            placeholder="Choose a strong password"
            minLength={8}
            required
          />
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            placeholder="Re-enter your password"
            minLength={8}
            required
          />
          <button className="primary full" type="submit" disabled={status === "loading"}>
            {status === "loading" ? "Saving..." : "Update password"}
          </button>
        </form>
        <div className="link-row">
          <button className="text-link" type="button" onClick={onBackToLogin}>
            ← Back to login
          </button>
        </div>
        {responseMessage && <div className={`status ${status}`}>{responseMessage}</div>}
      </div>
      <aside className="login-aside">
        <p className="eyebrow">Security tip</p>
        <h3>Use a unique password</h3>
        <ul>
          <li>At least 8 characters with a mix of letters and numbers.</li>
          <li>Keep it unique to your AI Receptionist account.</li>
          <li>Store it somewhere safe or use a password manager.</li>
        </ul>
        <p className="hint">You can change this anytime from your account settings.</p>
      </aside>
    </section>
  );
}
