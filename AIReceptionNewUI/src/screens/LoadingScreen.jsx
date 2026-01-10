export default function LoadingScreen({ status, loadingPhase, loadingSteps, responseMessage }) {
  return (
    <section className="progress-card screen-panel">
      <div className="progress-header">
        <p className="eyebrow">AI Reception</p>
        <h2>
          {status === "loading" && loadingPhase === "crawl"
            ? "Sending to AI Reception"
            : status === "loading" && loadingPhase === "provision"
            ? "Finalizing your AI reception setup"
            : status === "success"
            ? "All website data loaded fine"
            : "Unable to complete request"}
        </h2>
        <p className="lead narrow">
          {status === "loading" && loadingPhase === "crawl"
            ? "We are dispatching your URL and preparing the crawl."
            : status === "loading" && loadingPhase === "provision"
            ? "Generating your S4U-v3 prompt and provisioning the client."
            : status === "success"
            ? "Your site was ingested successfully. You can send another URL anytime."
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
        <div className={`status ${status}`}>
          {responseMessage}
        </div>
      )}

    </section>
  );
}
