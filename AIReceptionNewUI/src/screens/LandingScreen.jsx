import ThreeHero from "../components/ThreeHero";
import PricingPackages from "../components/PricingPackages";
import UltravoxDemo from "../components/UltravoxDemo";

export default function LandingScreen({ onTry, onLogin, onSelectPlan }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">AI support suite</p>
          <h1>Build faster, together.</h1>
          <p className="lead">
            Design, build, debug and ship your next AI receptionist in one suite.
          </p>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <ThreeHero />
        </div>
      </section>

      <section className="mt-28 md:mt-36">
        <UltravoxDemo />
      </section>

      <section className="mt-16 md:mt-20">
        <PricingPackages onSelectPackage={onSelectPlan} />
      </section>
    </>
  );
}
