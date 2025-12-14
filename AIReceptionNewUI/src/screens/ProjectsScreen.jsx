import UltravoxDemo from "../components/UltravoxDemo";

const services = {
  receptionist: {
    title: "AI Receptionist",
    eyebrow: "Solutions",
    summary: "Handle voice calls, capture leads, and route intelligently with Ultravox.",
    body: <UltravoxDemo />,
    cta: "Try live voice demo"
  },
  "social-manager": {
    title: "AI Social Media Manager",
    eyebrow: "Solutions",
    summary: "Plan, draft, and schedule posts across channels with AI-assisted workflows.",
    body: (
      <p className="hint">
        Automated content planning, brand-safe copy suggestions, and multi-channel scheduling with approval flows.
      </p>
    ),
    cta: "Talk to us"
  },
  "email-manager": {
    title: "Email Manager",
    eyebrow: "Solutions",
    summary: "Automate replies, triage inboxes, and keep SLAs on track.",
    body: (
      <p className="hint">
        Smart routing, suggested replies, and CRM syncing to keep your inbox clean and customers informed.
      </p>
    ),
    cta: "Talk to us"
  },
  "crm-lead-manager": {
    title: "CRM & Lead Manager",
    eyebrow: "Solutions",
    summary: "Qualify, score, and nurture leads automatically with clear handoffs.",
    body: (
      <p className="hint">
        Lead enrichment, scoring, and automated follow-ups that keep sales focused on the best opportunities.
      </p>
    ),
    cta: "Talk to us"
  }
};

const impactStats = [
  { label: "Response speed", value: "+60%", note: "Faster answers after launch" },
  { label: "Bookings secured", value: "99.9%", note: "Appointment success rate" },
  { label: "Missed calls", value: "0", note: "No work missed this week" },
  { label: "Lead capture", value: "3.2x", note: "More conversations routed to staff" }
];

const impactTrend = [
  { label: "Week 1", value: 48 },
  { label: "Week 2", value: 55 },
  { label: "Week 3", value: 61 },
  { label: "Week 4", value: 64 },
  { label: "Week 5", value: 68 },
  { label: "Week 6", value: 72 }
];

export default function ProjectsScreen({ serviceSlug = "receptionist", onStartSignup }) {
  const service = services[serviceSlug] || services.receptionist;
  return (
    <section className="screen-panel projects-shell reveal-section">
      <div className="projects-hero">
        <div>
          <p className="eyebrow">{service.eyebrow}</p>
          <h1 className="hero-title large">{service.title}</h1>
          <p className="lead narrow" style={{ marginTop: 6 }}>
            {service.summary}
          </p>
        </div>
      </div>

      <div className="projects-grid">
        {serviceSlug === "receptionist" && (
          <div className="project-card hero-callout">
            <div>
              <p className="eyebrow">SmartConnect4u</p>
              <h2 className="hero-callout-title">
                SmartConnect4u helps you turn missed calls into revenue, 24/7
              </h2>
              <p className="lead narrow">
                SmartConnect4u answers every inbound call, captures critical details, and turns conversations into qualified opportunities.
              </p>
            </div>
          </div>
        )}
        <div className="project-card">
          <div className="project-header">
            <div>
              <p className="eyebrow">{service.title}</p>
              <h3>{service.cta}</h3>
            </div>
          </div>
          <div className="project-body">
            {service.body}
          </div>
          <div className="project-actions">
            {serviceSlug === "receptionist" ? (
              <button className="login-cta hero-centered-cta hero-main-cta" type="button" onClick={onStartSignup}>
                <span>Try now</span>
                <span aria-hidden>↗</span>
              </button>
            ) : (
              <button className="primary small" type="button" onClick={onStartSignup}>
                <span>Get started</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {serviceSlug === "receptionist" && (
        <div className="onboarding-steps">
          <header className="steps-header">
            <div>
              <h2>Up and Running in Minutes</h2>
              <p className="lead narrow">No tech skills needed. No complicated setup.</p>
            </div>
          </header>
          <div className="steps-grid">
            {[
              {
                number: "01",
                title: "Share Your Website",
                body:
                  "We’ll learn about your business and automatically set everything up for you. You can review, edit, or add any info you want your AI Receptionist to know.",
                accent: "#3b82f6"
              },
              {
                number: "02",
                title: "Choose How It Answers Calls",
                body:
                  "Decide when your AI Receptionist picks up — all the time, when you’re busy, or after hours. Or use the dedicated business number you get given.",
                accent: "#f97316"
              },
              {
                number: "03",
                title: "You’re Live!",
                body:
                  "Your AI Receptionist is live and ready to answer calls. From now on, you’ll never miss a customer — or a new job — again.",
                accent: "#10b981"
              }
            ].map((step) => (
              <div className="step-card" key={step.number}>
                <div className="step-number" style={{ backgroundColor: step.accent + "22", color: step.accent }}>
                  {step.number}
                </div>
                <h3>{step.title}</h3>
                <p className="hint">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {serviceSlug === "receptionist" && (
        <div className="project-impact">
          <div className="project-impact-header">
            <p className="eyebrow">Dashboard preview</p>
            <h2>See the impact your AI Receptionist delivers</h2>
            <p className="lead narrow">
              Sample performance snapshot showing business growth after rollout.
            </p>
          </div>
          <div className="project-card impact-card">
            <div className="impact-grid">
              <div className="impact-stats">
                {impactStats.map((stat) => (
                  <div className="impact-stat" key={stat.label}>
                    <div className="stat-top">
                      <p className="hint">{stat.label}</p>
                      <span className="stat-value">{stat.value}</span>
                    </div>
                    <p className="hint">{stat.note}</p>
                  </div>
                ))}
              </div>
              <div className="impact-chart">
                <div className="chart-title">
                  <span>6-week uplift</span>
                  <span className="pill subtle">AI vs before</span>
                </div>
                <div className="chart-bars">
                  {impactTrend.map((item) => (
                    <div className="bar-row" key={item.label}>
                      <span className="bar-label">{item.label}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${item.value}%` }} />
                      </div>
                      <span className="bar-value">{item.value}%</span>
                    </div>
                  ))}
                </div>
                <div className="chart-footnotes">
                  <span>• 99.9% appointment booking success rate recorded.</span>
                  <span>• Zero missed work with AI handling off-hours calls.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
