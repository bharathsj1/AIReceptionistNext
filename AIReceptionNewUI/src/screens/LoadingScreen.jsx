export default function LoadingScreen({
  status,
  loadingPhase,
  loadingSteps,
  responseMessage,
}) {
  return (
    <section className="progress-card screen-panel">
      <div className="progress-header">
        <p className="eyebrow">COMPANY OUTREACH</p>
        <h2>
          {status === "loading" && loadingPhase === "crawl"
            ? "Getting to know your business"
            : status === "loading" && loadingPhase === "provision"
              ? "Preparing your company brief"
              : status === "success"
                ? "Your business knowledge is ready"
                : "Unable to complete request"}
        </h2>
        <p className="lead narrow">
          {status === "loading" && loadingPhase === "crawl"
            ? "We’re finding the details that will help your AI introduce your company."
            : status === "loading" && loadingPhase === "provision"
              ? "Saving your company details and preparing your calling workspace."
              : status === "success"
                ? "Your website details are ready to review. You can update them as your business grows."
                : responseMessage || "Please try again with a valid URL."}
        </p>
      </div>

      {status === "loading" && (
        <div className="loading-block">
          <div className="loader large">
            <span />
            <span />
            <span />
          </div>
          <ul className="loading-steps">
            {(loadingSteps[loadingPhase] || []).map((step, index) => (
              <li key={step}>
                <div className="bar">
                  <div
                    className="bar-fill"
                    style={{ animationDelay: `${index * 160}ms` }}
                  />
                </div>
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status !== "loading" && responseMessage && (
        <div className={`status ${status}`}>{responseMessage}</div>
      )}
    </section>
  );
}
