import { useStore } from '../store';
import { StepIndicator } from './setup/StepIndicator';
import { DataStep } from './setup/DataStep';
import { VolumeStep } from './setup/VolumeStep';
import { ShiftMenuStep } from './setup/ShiftMenuStep';
import { ReviewStep } from './setup/ReviewStep';

const LAST_STEP = 3; // Data, Volume, Shift menu, Review

export function SetupScreen() {
  const { setupStep, setSetupStep, arrivals, wHppvTarget, shiftMenu, setScreen } = useStore();

  const hasArrivalsData = arrivals.some((v) => v > 0);
  const canContinue = hasArrivalsData && shiftMenu.length > 0 && wHppvTarget > 0;

  // Per-step gating: each step's own required condition, not the full-wizard gate.
  const stepBlockedReason: (string | null)[] = [
    hasArrivalsData ? null : 'Upload or enter your arrivals data to continue.',
    wHppvTarget > 0 ? null : 'Set a wHPPV target to continue.',
    shiftMenu.length > 0 ? null : 'Add at least one shift to continue.',
    null, // review — final gate is canContinue, checked separately
  ];

  const blockedReason = stepBlockedReason[setupStep];

  function goNext() {
    if (blockedReason) return;
    setSetupStep(setupStep + 1);
  }

  function goBack() {
    setSetupStep(setupStep - 1);
  }

  return (
    <div className="screen setup-screen">
      <h1>ShiftLens — Setup</h1>
      <p className="subtitle">Enter your ED's data. Nothing here is pre-filled with another ED's numbers.</p>

      <StepIndicator step={setupStep} />

      {setupStep === 0 && <DataStep />}
      {setupStep === 1 && <VolumeStep />}
      {setupStep === 2 && <ShiftMenuStep />}
      {setupStep === 3 && <ReviewStep onEdit={setSetupStep} />}

      <div className="button-row continue-row">
        {setupStep > 0 && (
          <button className="btn-secondary" onClick={goBack}>Back</button>
        )}
        {setupStep < LAST_STEP && (
          <button className="btn-primary btn-large" disabled={!!blockedReason} onClick={goNext}>
            Next
          </button>
        )}
        {setupStep === LAST_STEP && (
          <button className="btn-primary btn-large" disabled={!canContinue} onClick={() => setScreen('dashboard')}>
            Continue to results
          </button>
        )}
        {blockedReason && <span className="degrade-note">{blockedReason}</span>}
        {setupStep === LAST_STEP && !canContinue && (
          <span className="degrade-note">Need arrivals data, a wHPPV target, and at least one shift.</span>
        )}
      </div>
    </div>
  );
}
