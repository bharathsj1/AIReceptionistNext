import { Check, LockKeyhole } from "lucide-react";

const steps = [
  { label: "Your account", stages: ["signup", "signupSurvey"] },
  { label: "Your business", stages: ["businessDetails", "businessType"] },
  {
    label: "Your knowledge",
    stages: [
      "crawlForm",
      "loading",
      "businessInfoManual",
      "businessInfoReview",
      "emailCapture",
      "complete",
    ],
  },
  { label: "Your plan", stages: ["packages", "payment"] },
  { label: "Go live", stages: ["paymentSuccess", "numberSelect"] },
];

export default function OnboardingProgress({ stage, localSetup = false }) {
  const visibleSteps = localSetup ? steps.slice(0, 3) : steps;
  const current = visibleSteps.findIndex((step) => step.stages.includes(stage));
  if (current < 0) return null;
  return (
    <nav className="setup-progress" aria-label="Workspace setup progress">
      <div className="setup-progress-intro">
        <span>YOUR NEW WORKSPACE</span>
        <span>
          <LockKeyhole size={12} /> Secure setup
        </span>
      </div>
      <ol>
        {visibleSteps.map((step, index) => (
          <li
            key={step.label}
            aria-label={step.label}
            className={
              index === current
                ? "is-current"
                : index < current
                  ? "is-complete"
                  : ""
            }
            aria-current={index === current ? "step" : undefined}
          >
            <span className="setup-progress-number">
              {index < current ? <Check size={14} /> : index + 1}
            </span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      <p className="setup-progress-mobile">
        Step {current + 1} of {visibleSteps.length} · {visibleSteps[current].label}
      </p>
    </nav>
  );
}
