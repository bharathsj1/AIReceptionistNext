import UltravoxDemo from "../components/UltravoxDemo";

const emailManagerSteps = [
  {
    title: "Connect your inbox",
    copy: "Securely link Gmail or Outlook and let us pull in every active thread.",
    img: "/media/email-step-connect.svg",
    alt: "Screenshot showing an email inbox connection setup."
  },
  {
    title: "Triage and label",
    copy: "We categorize by priority, intent, and SLA so nothing slips through.",
    img: "/media/email-step-triage.svg",
    alt: "Screenshot showing inbox triage with tags."
  },
  {
    title: "Draft smart replies",
    copy: "AI suggests responses with full context, ready for one-click approval.",
    img: "/media/email-step-draft.svg",
    alt: "Screenshot showing AI drafted replies."
  },
  {
    title: "Track outcomes",
    copy: "We log resolutions, surface follow-ups, and keep the team aligned.",
    img: "/media/email-step-track.svg",
    alt: "Screenshot showing resolution tracking and status updates."
  }
];

const socialManagerSteps = [
  {
    title: "Connect channels",
    copy: "Link Facebook, Instagram, and LinkedIn so we can manage every feed.",
    img: "/media/social-step-connect.svg",
    alt: "Screenshot showing social channel connections."
  },
  {
    title: "Plan content",
    copy: "Build a calendar with weekly themes, campaigns, and launch moments.",
    img: "/media/social-step-plan.svg",
    alt: "Screenshot showing a social content calendar plan."
  },
  {
    title: "Draft and approve",
    copy: "Generate captions, hashtags, and creatives ready for your review.",
    img: "/media/social-step-draft.svg",
    alt: "Screenshot showing drafted social posts."
  },
  {
    title: "Insights and follow-up",
    copy: "Track reach, engagement, and next actions from one place.",
    img: "/media/social-step-insights.svg",
    alt: "Screenshot showing social performance insights."
  }
];

const EmailManagerExplainer = ({ steps }) => (
  <div className="email-manager-explainer">
    <div className="email-explainer-head">
      <div>
        <p className="eyebrow">Email Manager Flow</p>
        <h4 className="email-explainer-title">We organize, reply, and close the loop.</h4>
        <p className="hint">A simple four-step system that keeps customers informed and teams focused.</p>
      </div>
      <div className="email-explainer-badges">
        <span className="email-explainer-badge">Live triage</span>
        <span className="email-explainer-badge">AI replies</span>
        <span className="email-explainer-badge">SLA tracking</span>
      </div>
    </div>
    <div className="email-explainer-summary">
      <p>
        Summary: Your inbox stays clean, replies go out faster, and your team always knows what needs attention.
        Replace this copy with your preferred summary when ready.
      </p>
    </div>
    <div className="email-step-grid">
      {steps.map((step, index) => (
        <div key={step.title} className="email-step-card" style={{ "--step-delay": `${index * 0.2}s` }}>
          <div className="email-step-head">
            <span className="email-step-index">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <p className="email-step-title">{step.title}</p>
              <p className="email-step-copy">{step.copy}</p>
            </div>
          </div>
          <div className="email-step-media">
            <img src={step.img} alt={step.alt} loading="lazy" />
            <div className="email-step-scan" aria-hidden="true" />
            <div className="email-step-glow" aria-hidden="true" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const SocialManagerExplainer = ({ steps }) => (
  <div className="social-manager-explainer">
    <div className="social-explainer-head">
      <div>
        <p className="eyebrow">Social Manager Flow</p>
        <h4 className="social-explainer-title">We plan, publish, and learn.</h4>
        <p className="hint">A simple loop that keeps your brand consistent and your team in sync.</p>
      </div>
      <div className="social-explainer-badges">
        <span className="social-explainer-badge">Content calendar</span>
        <span className="social-explainer-badge">Auto drafts</span>
        <span className="social-explainer-badge">Performance</span>
      </div>
    </div>
    <div className="social-step-grid">
      {steps.map((step, index) => (
        <div key={step.title} className="social-step-card" style={{ "--step-delay": `${index * 0.2}s` }}>
          <div className="social-step-head">
            <span className="social-step-index">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <p className="social-step-title">{step.title}</p>
              <p className="social-step-copy">{step.copy}</p>
            </div>
          </div>
          <div className="social-step-media">
            <img src={step.img} alt={step.alt} loading="lazy" />
            <div className="social-step-scan" aria-hidden="true" />
            <div className="social-step-glow" aria-hidden="true" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

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
    body: <SocialManagerExplainer steps={socialManagerSteps} />,
    cta: "Talk to us"
  },
  "email-manager": {
    title: "Email Manager",
    eyebrow: "Solutions",
    summary: "Automate replies, triage inboxes, and keep SLAs on track.",
    body: <EmailManagerExplainer steps={emailManagerSteps} />,
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
