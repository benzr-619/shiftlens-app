import { useStore } from '../store';
import { StepIndicator } from './setup/StepIndicator';
import { SetupEntryFork } from './setup/SetupEntryFork';
import { TutorialFlow } from './setup/TutorialFlow';
import { ColleagueRequestPage } from './setup/ColleagueRequestPage';
import { VolumeStep } from './setup/VolumeStep';
import { ShiftMenuStep } from './setup/ShiftMenuStep';
import { ReviewStep } from './setup/ReviewStep';

const LAST_STEP = 3; // Data, Volume, Shift menu, Review

export function SetupScreen() {
  const { setupStep, setSetupStep, setupMode, arrivals, wHppvTarget, shiftMenu, setScreen } = useStore();

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

  // The entry fork (2026-07-27 guided-setup-walkthrough prompt, Part 2.1) — nothing else in
  // setup renders until the user picks a path. The "returning" path jumps straight to Review
  // from inside the fork itself (see SetupEntryFork.tsx), never rendering this wizard's Step 0.
  if (setupMode === null) {
    return (
      <div className="screen setup-screen">
        <h1>Setup</h1>
        <p className="subtitle">Enter your ED's data.</p>
        <SetupEntryFork />
      </div>
    );
  }

  // The tutorial owns its own progress indicator and Back/Next/Skip controls for Step 0 (one
  // item per screen) — the outer wizard's step chrome only applies to Steps 1-3 while inside it.
  const tutorialOwnsStep0 = setupMode === 'tutorial' && setupStep === 0;

  return (
    <div className="screen setup-screen">
      <h1>Setup</h1>
      <p className="subtitle">Enter your ED's data.</p>

      {!tutorialOwnsStep0 && <StepIndicator step={setupStep} />}

      {setupStep === 0 && setupMode === 'tutorial' && <TutorialFlow onDone={() => setSetupStep(1)} />}
      {setupStep === 0 && setupMode === 'colleague' && <ColleagueRequestPage />}
      {setupStep === 1 && <VolumeStep />}
      {setupStep === 2 && <ShiftMenuStep />}
      {setupStep === 3 && <ReviewStep onEdit={setSetupStep} />}

      {!tutorialOwnsStep0 && (
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
      )}
    </div>
  );
}
