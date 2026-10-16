import { Check, LockKeyhole } from "lucide-react";

const steps = [
  { label: "Your account", stages: ["signup", "signupSurvey"] },
  { label: "Your company", stages: ["businessDetails", "businessType"] },
  {
    label: "Company brief",
    stages: [
      "crawlForm",
      "loading",
      "businessInfoManual",
      "businessInfoReview",
      "emailCapture",
      "complete",
    ],
  },
];

export default function OnboardingProgress({ stage }) {
  const visibleSteps = steps;
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
        Step {current + 1} of {visibleSteps.length} ·{" "}
        {visibleSteps[current].label}
      </p>
    </nav>
  );
}
