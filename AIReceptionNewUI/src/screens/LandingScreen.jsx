import ThreeHero from "../components/ThreeHero";
// PricingPackages removed from home screen

export default function LandingScreen({ onTry, onLogin, onSelectPlan, onShowService }) {
  return (
    <>
      <div className="nav-card screen-panel sticky-nav">
        <div className="nav-left">
          <div className="brand">
            <img src="/logo.png" alt="SmartConnect4u" className="brand-logo" />
            <span className="brand-name">SmartConnect4u</span>
          </div>
          <div className="nav-links">
            <button className="nav-link">Our purpose</button>
            <button className="nav-link">What we do</button>
            <button className="nav-link">How we work</button>
            <div className="nav-item-with-sub">
              <button className="nav-link" type="button">Services</button>
              <div className="nav-submenu">
                <button className="nav-subitem" type="button" onClick={() => onShowService("receptionist")}>AI Receptionist</button>
                <button className="nav-subitem" type="button" onClick={() => onShowService("social-manager")}>AI Social Media Manager</button>
                <button className="nav-subitem" type="button" onClick={() => onShowService("email-manager")}>Email Manager</button>
                <button className="nav-subitem" type="button" onClick={() => onShowService("crm-lead-manager")}>CRM &amp; Lead Manager</button>
              </div>
            </div>
            <button className="nav-link">Blog</button>
          </div>
        </div>
        <div className="nav-actions">
          <button className="login-cta" onClick={onLogin}>
            <span aria-hidden>→</span>
            <span>Login</span>
          </button>
        </div>
      </div>

      <section className="content content-landing hero hero-split hero-centered reveal-section">
        <div className="hero-copy hero-centered-copy">
          <h1 className="hero-title large">
            <span className="hero-highlight">AI</span> that feels human.
          </h1>
        </div>
        <div className="hero-visual hero-blob hero-centered-visual" aria-hidden="true">
          <ThreeHero />
        </div>
        <p className="lead narrow" style={{ margin: "8px 0 0" }}>
          Smart AI systems built to grow your business while you focus on what matters.
        </p>
        <button className="login-cta hero-centered-cta hero-main-cta" onClick={() => onShowService("receptionist")}>
          <span>Let’s create value together</span>
          <span aria-hidden>↗</span>
        </button>
      </section>

      <section className="content content-landing reveal-section capability-shell">
        <div className="cap-nav">
          {[
            { id: "capabilities", label: "Capabilities" },
            { id: "performance", label: "Performance" },
            { id: "integrations", label: "Integrations" },
            { id: "technology", label: "Technology" },
            { id: "ai-team", label: "AI Team" },
            { id: "pricing", label: "Pricing" }
          ].map((item, idx) => (
            <a key={item.id} className="cap-link" href={`#${item.id}`}>
              <span className="cap-index">{String(idx + 1).padStart(2, "0")}</span> {item.label}
            </a>
          ))}
        </div>

        <div className="cap-content">
          {[
            {
              id: "capabilities",
              title: "Resolve complex queries on every channel",
              body:
                "Handle even the most complex customer questions with continuous improvement loops, so every query is answered accurately and consistently.",
              cta: "Explore all capabilities"
            },
            {
              id: "performance",
              title: "Measured outcomes you can trust",
              body:
                "Track response quality, speed, and satisfaction with transparent analytics that surface what to improve next.",
              cta: "View performance metrics"
            },
            {
              id: "integrations",
              title: "Connects to your stack in minutes",
              body:
                "Plug into your CRM, ticketing, phone, and chat systems with secure, low-lift integrations that keep teams in sync.",
              cta: "See integrations"
            },
            {
              id: "technology",
              title: "Enterprise-grade AI guardrails",
              body:
                "Stay compliant with configurable policies, safe outputs, and auditing so you can ship AI confidently.",
              cta: "Review safeguards"
            },
            {
              id: "ai-team",
              title: "Your AI team on speed dial",
              body:
                "Work with specialists who tune prompts, evaluate outputs, and continuously improve performance for your business.",
              cta: "Meet the team"
            },
            {
              id: "pricing",
              title: "Pricing that scales with you",
              body:
                "Start fast and scale usage as you grow with clear plans and ROI tracking so you always see the value.",
              cta: "Check pricing"
            }
          ].map((section, idx) => (
            <article key={section.id} id={section.id} className="cap-card">
              <div className="cap-card-head">
                <span className="cap-dot" aria-hidden />
                <span className="cap-card-label">{section.id.replace("-", " ").toUpperCase()}</span>
              </div>
              <h2>{section.title}</h2>
              <p className="lead narrow" style={{ marginTop: 10 }}>{section.body}</p>
              <div className="cap-foot">
                <span className="cap-step">{String(idx + 1).padStart(2, "0")}</span>
                <button className="ghost small" type="button">{section.cta}</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Package plans removed from home screen */}
    </>
  );
}
