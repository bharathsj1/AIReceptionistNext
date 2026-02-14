export default function AboutScreen() {
  return (
    <section className="screen-panel page-shell reveal-section">
      <div className="hero">
        <p className="eyebrow">About us</p>
        <h1 className="text-4xl font-semibold text-white">
          We build AI co-pilots that keep your customer conversations running 24/7
        </h1>
        <p className="lead max-w-3xl">
          SmartConnect4u unifies voice, email, and social messaging with AI assistance. We help teams answer faster,
          schedule smarter, and never miss a lead—whether it arrives by phone, inbox, or chat.
        </p>
      </div>

      <div className="grid cols-3 gap-4 about-grid">
        <div className="card glass">
          <h3>What we do</h3>
          <p>
            AI receptionists, smart email management, and social automation that plug into your stack. From answering
            calls to drafting replies and booking meetings, we keep every channel responsive and on-brand.
          </p>
        </div>
        <div className="card glass">
          <h3>Our vision</h3>
          <p>
            To make every business instantly reachable and reliably helpful—without adding headcount. AI should feel like
            a trusted teammate, not a black box.
          </p>
        </div>
        <div className="card glass">
          <h3>How we work</h3>
          <p>
            Human-in-the-loop by design, with transparent controls, audit trails, and configurable handoffs. We integrate
            with the tools you already use, and keep people in charge.
          </p>
        </div>
      </div>

      <div className="grid cols-3 gap-4 about-grid">
        <div className="card glass">
          <h3>Channels we power</h3>
          <p>Voice, SMS, email, WhatsApp, and web chat—covered with unified AI and live-agent routing.</p>
        </div>
        <div className="card glass">
          <h3>Availability</h3>
          <p>24/7 responsiveness with SLAs you set, plus live agent escalation when customers need a human.</p>
        </div>
        <div className="card glass">
          <h3>Security &amp; privacy</h3>
          <p>Data encrypted at rest and in transit, role-based access, and privacy-first defaults.</p>
        </div>
      </div>

      <div className="pill-links" style={{ marginTop: "18px" }}>
        <a className="pill" href="/receptionist.html">AI Receptionist</a>
        <a className="pill" href="/email-manager.html">Smart Email Manager</a>
        <a className="pill" href="/social-manager.html">Social Media Manager</a>
        <a className="pill" href="/contact.html">Talk to sales</a>
      </div>
    </section>
  );
}
