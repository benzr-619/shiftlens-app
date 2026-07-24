export const SETUP_STEP_LABELS = [
  'Data',
  'Volume & wHPPV',
  'Shift menu',
  'Review',
];

export function StepIndicator({ step }: { step: number }) {
  return (
    <div className="step-indicator">
      <div className="step-indicator-title">
        Step {step + 1} of {SETUP_STEP_LABELS.length}: {SETUP_STEP_LABELS[step]}
      </div>
      <div className="step-dots">
        {SETUP_STEP_LABELS.map((label, i) => (
          <div key={label} className={`step-dot-wrap${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}>
            <span className="step-dot">{i < step ? '✓' : i + 1}</span>
            <span className="step-dot-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
