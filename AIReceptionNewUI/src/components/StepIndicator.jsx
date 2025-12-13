export default function StepIndicator({ steps = [], currentStep }) {
  if (!steps.length) return null;
  return (
    <div className="screen-stack">
      <div className="stepper-inline">
        {steps.map((step, idx) => {
          const isActive = step.id === currentStep;
          const isDone = steps.findIndex((s) => s.id === currentStep) > idx;
          return (
            <div
              key={step.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                opacity: isActive || isDone ? 1 : 0.5
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "999px",
                  background: isActive ? "#8ad2ff" : isDone ? "#94a3b8" : "#475569",
                  boxShadow: isActive ? "0 0 0 6px rgba(138,210,255,0.25)" : "none"
                }}
              />
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
