import { useMemo } from 'react';
import { useStore } from '../../store';
import { computeSynthesis } from '../../engine';

/**
 * PR G (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §7) — the synthesis chapter, where the
 * founding question ("am I understaffed, or misallocated?") gets answered. Adds the two
 * separate budgets (arrivals, boarding) back together FOR THE READER only — never touches
 * `EngineResult.grid` (spec §6/§12's separate-budget thesis).
 *
 * Per §1(5): FOUR NUMBERS AND A SUBTRACTION, then STOP. No closing "which means..." sentence —
 * an earlier draft that presumed a residual always exists was explicitly called out as the
 * exact overcommitment to avoid (false for a department that's adequately staffed and merely
 * misallocated). The arithmetic carries the point for every profile in §12.2 without a single
 * sentence needing to change.
 */
export function SynthesisSection() {
  const { getResult, buildEngineInputs, currentStaffingGrid } = useStore();
  const result = getResult();
  const inputs = useMemo(() => buildEngineInputs(), [buildEngineInputs]);

  const hasCurrentStaffing =
    !!currentStaffingGrid &&
    Object.values(currentStaffingGrid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));

  const synthesis = useMemo(
    () => (hasCurrentStaffing ? computeSynthesis(result, inputs, currentStaffingGrid ?? {}) : null),
    [hasCurrentStaffing, result, inputs, currentStaffingGrid]
  );

  if (!hasCurrentStaffing) {
    return (
      <section className="card synthesis-section">
        <h2>Both budgets together</h2>
        <div className="banner banner-info comparison-cta">
          Add your current staffing above to see arrivals and boarding demand added together against what you
          actually staff.
        </div>
      </section>
    );
  }

  if (!synthesis) return null;

  const gapIsPositive = synthesis.gapHours > 0.5;
  const gapIsNegative = synthesis.gapHours < -0.5;

  return (
    <section className="card synthesis-section">
      <h2>Both budgets together</h2>

      {/* Templated headline (spec §7): four numbers and a subtraction the reader can check on
          paper. Deliberately stops here — no interpretive closing sentence. */}
      <p className="comparison-headline">
        {synthesis.boardingDataPresent ? (
          <>
            Between arrivals and boarding, your department needs about{' '}
            <strong>{synthesis.totalDemandWeeklyHours.toFixed(0)} nurse-hours a week</strong>.
          </>
        ) : (
          <>
            Against arrivals alone, your department needs about{' '}
            <strong>{synthesis.totalDemandWeeklyHours.toFixed(0)} nurse-hours a week</strong> — boarding data isn't
            available, so this is only half the picture.
          </>
        )}{' '}
        You staff <strong>{synthesis.currentStaffedWeeklyHours.toFixed(0)}</strong>.
        {gapIsPositive && (
          <>
            {' '}
            The difference is <strong>{synthesis.gapHours.toFixed(0)} hours — {synthesis.gapFte.toFixed(1)} FTE</strong>
            {synthesis.dayShareOfShortfallPct !== null && (
              <>
                {' '}
                — and <strong>{synthesis.dayShareOfShortfallPct.toFixed(0)}%</strong> of it falls between 07:00 and
                19:00
              </>
            )}
            . Placing your existing hours as well as possible closes{' '}
            <strong>{synthesis.gapClosedByReallocationHours.toFixed(0)}</strong> of those{' '}
            {synthesis.gapHours.toFixed(0)}.
          </>
        )}
        {gapIsNegative && (
          <>
            {' '}
            You already staff <strong>{Math.abs(synthesis.gapHours).toFixed(0)} hours</strong> a week more than
            that total, in aggregate.
          </>
        )}
        {!gapIsPositive && !gapIsNegative && <> Your total hours match total demand almost exactly.</>}
      </p>
    </section>
  );
}
