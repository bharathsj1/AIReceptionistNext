import React from "react";

const cards = [
  { title: "Insights", subtitle: "", desc: "Conversion rate with AI Agents", stat: "81%", statLabel: "" },
  { title: "Overview", subtitle: "", desc: "", stat: "65%", statLabel: "Wait time reduction" },
  {
    title: "Teamwork",
    subtitle: "Collaboration",
    desc: "Work together seamlessly",
    large: true,
    dots: true,
    aiLogos: ["OpenAI", "Google", "Canva AI"],
    aiCaption: "Powered by leading AI technologies"
  },
  { title: "Efficiency", subtitle: "Automation", desc: "Streamline workflows", stat: "+95%", statLabel: "More leads with SmartConnect4u rewards", wide: true },
  { title: "Connectivity", subtitle: "Integration", desc: "Connect favorite tools" },
  { title: "Protection", subtitle: "Security", desc: "Enterprise-grade protection" }
];

export default function MagicBento() {
  return (
    <section className="magic-bento-section">
      <div className="magic-bento-grid">
        {cards.map((card, idx) => (
          <article
            key={idx}
            className={`magic-bento-card ${card.large ? "magic-bento-card--large" : ""} ${
              card.wide ? "magic-bento-card--wide" : ""
            }`}
          >
            <div className="magic-bento-top">
              <span className="magic-bento-title">{card.title}</span>
              {card.dots && <span className="magic-bento-dots" aria-hidden />}
            </div>
            <div className="magic-bento-bottom">
              {card.stat && (
                <div className="magic-bento-stat">
                  <span className="magic-bento-stat-number">{card.stat}</span>
                  <span className="magic-bento-stat-label">{card.statLabel}</span>
                </div>
              )}
              <div className="magic-bento-subtitle">{card.subtitle}</div>
              <p className="magic-bento-desc">{card.desc}</p>
              {card.aiLogos && (
                <div className="magic-bento-ai">
                  <span className="magic-bento-ai-caption">{card.aiCaption}</span>
                  <div className="magic-bento-logos">
                    {card.aiLogos.map((logo) => (
                      <span key={logo} className="magic-bento-logo-chip">
                        {logo}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="magic-bento-ambient" aria-hidden />
    </section>
  );
}
