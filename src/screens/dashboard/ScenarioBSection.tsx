import { useMemo } from 'react';
import { useStore } from '../../store';
import { computeScenarioB, summarizeBacklogSeverity } from '../../engine';
import { ConceptCallout } from '../../components/ConceptCallout';
import { ConvexityDemo } from '../../components/ConvexityDemo';

/**
 * PR F (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §5) — Scenario B, "the same hours, better
 * placed." The only scenario with no ask attached: a manager can act on it Monday without
 * permission. See `engine/index.ts`'s `computeScenarioB` for the parameter-swap mechanics.
 *
 * CRITICAL FRAMING (spec §5, non-negotiable): this is computed on the ARRIVALS budget only —
 * `hourlyRequirement` never includes boarding (the separate-budget thesis, spec §6). Presented
 * as "what arrivals alone would justify," explicitly bounded — never as a standalone
 * recommendation. A manager who acts on this without reading the boarding section could hurt
 * their department (most of what looks like a fixable night surplus may actually be boarding,
 * absorbed into a schedule that was never sized for it). This section states that plainly,
 * every time it renders — not just once, buried in a philosophy statement.
 */
export function ScenarioBSection() {
  const { getResult, buildEngineInputs, currentStaffingGrid } = useStore();
  const result = getResult();
  const inputs = useMemo(() => buildEngineInputs(), [buildEngineInputs]);

  const hasCurrentStaffing =
    !!currentStaffingGrid &&
    Object.values(currentStaffingGrid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));

  const scenarioB = useMemo(
    () => (hasCurrentStaffing ? computeScenarioB(result, inputs, currentStaffingGrid ?? {}) : null),
    [hasCurrentStaffing, result, inputs, currentStaffingGrid]
  );

  const currentSeverity = useMemo(
    () => summarizeBacklogSeverity(currentStaffingGrid ?? {}, result.hourlyRequirement, inputs.shiftMenu).totalSeverity,
    [currentStaffingGrid, result.hourlyRequirement, inputs.shiftMenu]
  );

  if (!hasCurrentStaffing) {
    return (
      <section className="card scenario-b-section">
        <h2>Could moving hours fix it? (Scenario B)</h2>
        <div className="banner banner-info comparison-cta">
          Add your current staffing above to see what reallocating your existing hours — with no additional
          funding ask — would do for you.
        </div>
      </section>
    );
  }

  if (!scenarioB) return null;

  const severityReductionPct =
    currentSeverity > 0 ? Math.max(0, Math.min(100, ((currentSeverity - scenarioB.totalSeverity) / currentSeverity) * 100)) : 0;
  const nearOptimal = severityReductionPct < 5;

  return (
    <section className="card scenario-b-section">
      <h2>Could moving hours fix it? (Scenario B)</h2>

      {/* The expectation-setting bound — every render, not a one-time disclaimer. */}
      <div className="banner banner-info">
        This scenario is computed against <strong>arrivals only</strong> — it never sees boarding. It answers "what
        would my own current hours justify if I only had to cover arrivals," not "what should I actually do." Read
        the boarding section below before acting on this.
      </div>

      {scenarioB.isFullCoverage ? (
        <p className="comparison-headline">
          Your current <strong>{scenarioB.currentTotalWeeklyHours.toFixed(0)} hrs/week</strong> already fund enough
          hours to never be short against arrivals alone — <strong>shape is the entire problem</strong>, not size.
          Reallocating them (below) removes essentially all of the queued arrivals work, at zero additional cost.
        </p>
      ) : nearOptimal ? (
        <p className="comparison-headline">
          Your current <strong>{scenarioB.currentTotalWeeklyHours.toFixed(0)} hrs/week</strong> are already close to
          the best placement possible for that total against arrivals — this isn't a shape problem worth chasing
          further. If your department still feels short, the answer likely isn't in this scenario.
        </p>
      ) : (
        <p className="comparison-headline">
          Keeping your <strong>same {scenarioB.currentTotalWeeklyHours.toFixed(0)} hrs/week</strong> but placing them
          where arrivals actually need them would cut modeled queued-arrivals-work by roughly{' '}
          <strong>{severityReductionPct.toFixed(0)}%</strong> — from {currentSeverity.toFixed(0)} down to{' '}
          {scenarioB.totalSeverity.toFixed(0)} on the same severity scale the schedule is optimized against, at{' '}
          <strong>zero additional hours</strong>.
        </p>
      )}

      {scenarioB.overageFromFloor > 0.5 && (
        <p className="wHPPV-caveat">
          Your current hours fall below the department's minimum on-duty floor at some hours — reaching a safe
          schedule at this total isn't quite hour-neutral: it costs <strong>{scenarioB.overageFromFloor.toFixed(0)}</strong>{' '}
          more hours than what you staff today, not zero.
        </p>
      )}

      <div className="wHPPV-stats">
        <div className="stat">
          <div className="stat-label">Hours (unchanged)</div>
          <div className="stat-value">{scenarioB.currentTotalWeeklyHours.toFixed(0)}</div>
          <div className="stat-sub">same as your current staffing</div>
        </div>
        <div className="stat">
          <div className="stat-label">Severity, today</div>
          <div className="stat-value stat-warning">{currentSeverity.toFixed(0)}</div>
          <div className="stat-sub">your actual current placement</div>
        </div>
        <div className="stat">
          <div className="stat-label">Severity, reallocated</div>
          <div className="stat-value">{scenarioB.totalSeverity.toFixed(0)}</div>
          <div className="stat-sub">same hours, best placement against arrivals</div>
        </div>
      </div>

      {/* PR J (teaching layer, §8) — two concepts, first used here (Chapter 4). */}
      <div className="concept-callout-row">
        <ConceptCallout title="Right total != right shape">
          <p>
            Two schedules with the exact same total weekly hours can perform very differently — one placed where
            demand actually peaks, the other spread evenly or placed where it used to be needed. This scenario
            holds your total hours fixed and only changes WHERE they sit, which is exactly why it can improve
            things at zero additional cost when the problem is shape, not size.
          </p>
        </ConceptCallout>
        <ConceptCallout title="Depth beats spread (convexity)">
          <>
            <p>
              A deep hole in one hour is worse than the same total shortfall spread thinly across several hours —
              which is why the solver protects peaks rather than treating every nurse-hour of shortfall as equally
              bad. This is the actual objective the Step 3 trim minimizes; the numbers below use that real
              function, not a mock.
            </p>
            <ConvexityDemo />
          </>
        </ConceptCallout>
      </div>
    </section>
  );
}
