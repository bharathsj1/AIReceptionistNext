import ThreeHero from "../components/ThreeHero";

export default function LandingScreen({ onTry, onLogin }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">AI support suite</p>
          <h1>Build faster, together.</h1>
          <p className="lead">
            Design, build, debug and ship your next AI receptionist in one suite.
          </p>
          <div className="actions hero-actions">
            <button className="primary" onClick={onTry}>
              Try for free
            </button>
            <button className="ghost" onClick={onLogin}>
              Login
            </button>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <ThreeHero />
        </div>
      </section>

      <section className="logo-row" aria-label="Trusted by">
        <div className="logo-track">
          <span>AMD</span>
          <span>Canon</span>
          <span>Unity</span>
          <span>JetBrains</span>
          <span>GitHub</span>
          <span>AMD</span>
          <span>Canon</span>
          <span>Unity</span>
          <span>JetBrains</span>
          <span>GitHub</span>
        </div>
      </section>
    </>
  );
}
