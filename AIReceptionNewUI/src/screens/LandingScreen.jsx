import ThreeHero from "../components/ThreeHero";
import PricingPackages from "../components/PricingPackages";
import UltravoxDemo from "../components/UltravoxDemo";

export default function LandingScreen({ onTry, onLogin, onSelectPlan }) {
  return (
    <>
      <div className="nav-card screen-panel sticky-nav">
        <div className="nav-left">
          <div className="brand">
            <span className="brand-mark">AI</span>
            <span className="brand-name">Receptionist</span>
          </div>
          <div className="nav-links">
            <button className="nav-link">Our purpose</button>
            <button className="nav-link">What we do</button>
            <button className="nav-link">How we work</button>
            <button className="nav-link">Projects</button>
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

      <section className="hero hero-split hero-centered screen-panel reveal-section">
        <div className="hero-visual hero-blob hero-centered-visual" aria-hidden="true">
          <ThreeHero />
        </div>
        <div className="hero-copy hero-centered-copy">
          <p className="eyebrow">AI support suite</p>
          <h1 className="hero-title large">
            We transform technology by creating added value for your business.
          </h1>
        </div>
        <button className="primary cta-pill hero-centered-cta" onClick={onLogin}>
          <span>Let’s create value together</span>
          <span aria-hidden>↗</span>
        </button>
      </section>

      <section className="mt-20 screen-panel reveal-section" style={{ marginTop: "28vh" }}>
        <UltravoxDemo />
      </section>

      <section className="mt-16 md:mt-20 reveal-section">
        <PricingPackages onSelectPackage={onSelectPlan} />
      </section>
    </>
  );
}
