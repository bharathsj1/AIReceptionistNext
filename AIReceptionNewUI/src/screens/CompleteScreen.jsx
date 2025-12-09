export default function CompleteScreen({
  status,
  responseMessage,
  responseLink,
  provisionData,
  email,
  onGoHome,
  onGoToDashboard
}) {
  return (
    <section className="progress-card">
      <div className="progress-header">
        <p className="eyebrow">All set</p>
        <h2>
          {status === "success"
            ? "Congratulations! Your AI receptionist is live."
            : "We could not finish setup"}
        </h2>
        <p className="lead narrow">
          {status === "success"
            ? `Linked to ${email || "your email"}.`
            : responseMessage || "Please try again or adjust your inputs."}
        </p>
      </div>
      {status === "success" && (
        <div className="celebrate">
          <div className="light-beam" aria-hidden="true" />
          <div className="orb one" aria-hidden="true" />
          <div className="orb two" aria-hidden="true" />
          <div className="ribbon left" aria-hidden="true" />
          <div className="ribbon right" aria-hidden="true" />
          <div className="ready-card">
            <p className="eyebrow">AI receptionist ready</p>
            <h3>{provisionData?.name || "Your AI Reception"}</h3>
            <p className="lead">
              You can start connecting callers and visitors.
            </p>
            {provisionData?.phone_number && (
              <div className="big-number">{provisionData.phone_number}</div>
            )}
            {provisionData?.temp_password && (
              <div className="credential">
                <span className="label">Temp password</span>
                <span className="value">{provisionData.temp_password}</span>
              </div>
            )}
            <div className="badge">
              {responseMessage || "Your AI receptionist is ready!"}
            </div>
          </div>
          <div className="button-row ready-actions">
            <button className="ghost small" type="button" onClick={onGoHome}>
              ← Back to home
            </button>
            <button className="primary" type="button" onClick={onGoToDashboard}>
              Go to dashboard
            </button>
          </div>
        </div>
      )}
      {status !== "success" && responseMessage && (
        <div className={`status ${status}`}>
          <div>{responseMessage}</div>
          {responseLink && (
            <a href={responseLink} target="_blank" rel="noreferrer">
              Reset your password
            </a>
          )}
        </div>
      )}
    </section>
  );
}
