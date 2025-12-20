import "./CapabilitiesSection.css";

const cards = [
  {
    id: "ai-chat",
    title: "AI-Powered Receptionist",
    description: "Answer calls like a human, book calendar appointments, and send follow-ups—so you never miss a lead.",
    icon: "M12 7a5 5 0 1 0 0 10h4l3 3v-3h1a3 3 0 0 0 3-3V10a5 5 0 0 0-5-5H12Z"
  },
  {
    id: "collaboration",
    title: "Collaboration Tools",
    description: "AI tools enhance teamwork through automated and scalable collaboration.",
    icon: "M12 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-7 9a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v2H8a3 3 0 0 1-3-3Zm14 0a3 3 0 0 0-3-3h-2a3 3 0 0 0-3 3v2h2a3 3 0 0 0 3-3Z"
  },
  {
    id: "notifications",
    title: "Automated Notifications",
    description: "Stay on top of tasks with AI-driven reminders and alerts—no manual effort needed.",
    icon: "M12 6a4 4 0 0 1 4 4v2.6l1.2 2.4a1 1 0 0 1-.9 1.4H7.7a1 1 0 0 1-.9-1.4L8 12.6V10a4 4 0 0 1 4-4Zm0 14a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 20Z"
  },
  {
    id: "performance",
    title: "High-Performance Solutions",
    description: "Fast, reliable AI systems built for efficient data processing and integration.",
    icon: "M13 4 5 12l8 8 8-8-8-8Zm0 4.6L19.4 12 13 15.4 6.6 12 13 8.6Z"
  },
  {
    id: "customisation",
    title: "Global Customisation",
    description: "Fully customize AI workflows to fit your specific business needs.",
    icon: "M12 5a7 7 0 1 0 7 7 7 7 0 0 0-7-7Zm0 3a1 1 0 0 1 1 1v2.2l1.8 1.1a1 1 0 0 1-1 1.7l-2.3-1.4a1 1 0 0 1-.5-.9V9a1 1 0 0 1 1-1Z"
  },
  {
    id: "integration",
    title: "Data Integration",
    description: "Unify data sources for real-time insights and smarter decisions with AI integration.",
    icon: "M7 7h10v4H7V7Zm0 6h10v4H7v-4Zm-2-3h2v4H5v-4Zm12 0h2v4h-2v-4Z"
  }
];

const CapabilityCard = ({ title, description, icon, variant }) => (
  <article className={`cap-card ${variant || ""}`.trim()}>
    <div className="cap-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={icon} />
      </svg>
    </div>
    <h3>{title}</h3>
    <p>{description}</p>
  </article>
);

export default function CapabilitiesSection() {
  return (
    <section className="cap-section">
      <div className="cap-container">
        <div className="cap-header">
          <span className="cap-pill">Function</span>
          <h2>The Future is Happening Now</h2>
          <p>
            Our AI tools continuously adapt to reduce business workloads, elevate customer
            satisfaction through advanced machine learning, and bring in more business.
          </p>
        </div>

        <div className="cap-grid">
          <CapabilityCard
            title={cards[0].title}
            description={cards[0].description}
            icon={cards[0].icon}
          />
          <CapabilityCard
            title={cards[1].title}
            description={cards[1].description}
            icon={cards[1].icon}
            variant="cap-card--featured"
          />
          <CapabilityCard
            title={cards[2].title}
            description={cards[2].description}
            icon={cards[2].icon}
          />
          <CapabilityCard
            title={cards[3].title}
            description={cards[3].description}
            icon={cards[3].icon}
          />
          <CapabilityCard
            title={cards[4].title}
            description={cards[4].description}
            icon={cards[4].icon}
          />
          <CapabilityCard
            title={cards[5].title}
            description={cards[5].description}
            icon={cards[5].icon}
          />
        </div>
      </div>
    </section>
  );
}
