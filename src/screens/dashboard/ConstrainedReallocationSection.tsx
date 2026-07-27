import { useMemo } from 'react';
import { useStore } from '../../store';
import { computeCombinedReallocation } from '../../engine';

/**
 * PR K (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §6.3) — the constrained boarding reallocation,
 * at the END of the boarding chapter. Ben: "if you can't get additional hours for boarding,
 * here is the least-bad placement of what you already have." Same parameter-swap technique as
 * Scenario B (spec §5), run against COMBINED arrivals+boarding demand at CURRENT TOTAL HOURS —
 * `engine/synthesis.ts`'s `computeCombinedReallocation` (shared with the synthesis chapter).
 *
 * Presented as a COMPROMISE WITH ITS COST NAMED, never the recommendation: it necessarily
 * takes from arrivals coverage to cover boarders, and this section states what that costs on
 * the arrivals side, every time it renders. This is the honest version of what most departments
 * are already doing by accident — seeing it costed is exactly why it's persuasive.
 */
export function ConstrainedReallocationSection() {
  const { getResult, buildEngineInputs, currentStaffingGrid } = useStore();
  const result = getResult();
  const inputs = useMemo(() => buildEngineInputs(), [buildEngineInputs]);

  const hasCurrentStaffing =
    !!currentStaffingGrid &&
    Object.values(currentStaffingGrid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));

  const reallocation = useMemo(
    () => (hasCurrentStaffing && result.boarding ? computeCombinedReallocation(result, inputs, currentStaffingGrid ?? {}) : null),
    [hasCurrentStaffing, result, inputs, currentStaffingGrid]
  );

  // Renders nothing without both current staffing AND boarding data — this is specifically a
  // boarding-vs-arrivals TRADE-OFF question, which doesn't exist without both demands present.
  if (!hasCurrentStaffing || !result.boarding) return null;
  if (!reallocation) return null;

  const arrivalsCostHours = Math.max(0, reallocation.arrivalsShortfallHoursAfter - reallocation.arrivalsShortfallHoursBefore);
  const combinedImprovementHours = Math.max(0, reallocation.shortfallHoursBefore - reallocation.shortfallHoursAfter);

  return (
    <section className="card constrained-reallocation-section">
      <h2>If you can't get additional hours for boarding</h2>
      <div className="banner banner-info">
        This is a COMPROMISE, not a recommendation — it takes from arrivals coverage to cover boarders, using only
        the hours you already have. Read it as "here's the least-bad placement," not "here's what to do."
      </div>
      <p className="comparison-headline">
        Placing your existing <strong>{reallocation.weeklyScheduledHours.toFixed(0)} hrs/week</strong> to cover
        arrivals AND boarding together would reduce combined queued work by about{' '}
        <strong>{combinedImprovementHours.toFixed(0)} nurse-hours a week</strong>
        {arrivalsCostHours > 0.5 ? (
          <>
            {' '}
            — at a real cost of roughly <strong>{arrivalsCostHours.toFixed(0)} nurse-hours a week</strong> of
            additional arrivals shortfall. It isn't free; it's a trade.
          </>
        ) : (
          <>. This particular trade-off costs little on the arrivals side for this department.</>
        )}
      </p>
      <div className="wHPPV-stats">
        <div className="stat">
          <div className="stat-label">Combined shortfall, today</div>
          <div className="stat-value stat-warning">{reallocation.shortfallHoursBefore.toFixed(0)}</div>
          <div className="stat-sub">your actual current placement, vs. arrivals + boarding</div>
        </div>
        <div className="stat">
          <div className="stat-label">Combined shortfall, reallocated</div>
          <div className="stat-value">{reallocation.shortfallHoursAfter.toFixed(0)}</div>
          <div className="stat-sub">same hours, best placement against arrivals + boarding</div>
        </div>
        <div className="stat">
          <div className="stat-label">Cost on arrivals side</div>
          <div className={`stat-value ${arrivalsCostHours > 0.5 ? 'stat-negative' : ''}`}>{arrivalsCostHours.toFixed(0)}</div>
          <div className="stat-sub">additional arrivals-only shortfall this trade creates</div>
        </div>
      </div>
    </section>
  );
}
