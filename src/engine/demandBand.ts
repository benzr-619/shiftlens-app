// §2a — cohort-benchmark band floor + arrivals-variance buffer (2026-07-26, Phase 2a of
// BACKLOG_FEEDBACK_AND_VARIANCE_SPEC_2026-07-25.md). Two INDEPENDENT signals compose into
// one `bandFloorHourly` curve — kept as separate functions on purpose, not merged into one
// opaque derivation, since they come from genuinely different data sources:
//   - deriveCohortBandFloor: this ED's own point-target curve, re-derived against a cohort-
//     wide p25/p75 wHPPV benchmark (lookupWhppvBand, OTHER EDs' aggregate data).
//   - deriveDemandVolatilityHourly / applyVolatilityBuffer: THIS ED's own hourly arrivals
//     variance (mean vs. p75-arrivals, if provided) — a completely different question
//     ("how spiky is my own demand at this hour") from the cohort benchmark.
// Both compose into `protectedFloorHourly` — the curve Step 3's trim actually protects — but
// for different reasons; don't collapse them into a single formula, a future session may need
// to reason about (or disable) one signal independently of the other.
//
// 2026-07-26 PR C (SOLVER_REALISM_SPEC_2026-07-26.md, change 4): this composed curve SPLIT
// into two — `bandFloorHourly` (clamped to hourlyRequirement, REPORTING ONLY — the "Hours
// outside your typical staffing range" stat) and `protectedFloorHourly` (UNCLAMPED, SOLVER
// ONLY — the trim's guardrail penalty and `backlogFeedback.ts`'s relaxation floor). Before PR
// C, `applyVolatilityBuffer`'s own internal clamp meant the two were identical; see that
// function's header for why they no longer are.

import type { Cell168, SmoothingWeights } from './types';
import { allocateCellCoreHours, annualCoreRnHoursBudget, smoothDayOfWeek } from './allocate';
import { lookupWhppvBand } from '../lib/edbaLookup';

export interface CohortBandFloor {
  bandFloorHourly: Cell168;
  bandCeilingHourly: Cell168;
}

/**
 * The Phase 1 (2026-07-25) band-floor/ceiling derivation, extracted unchanged from
 * `compute()` — p25/p75-equivalent curves via the EXACT SAME allocation pipeline as
 * `hourlyRequirement` (`allocateCellCoreHours` + `smoothDayOfWeek`), just run against the
 * cohort p25/p75 annual budgets instead of the point `wHppvTarget` budget. Clamped so the
 * floor never exceeds (and the ceiling never falls below) the point-target curve — the
 * user's own chosen target must never itself read as a violation of its own band.
 */
export function deriveCohortBandFloor(
  weighted: Cell168,
  annualVisits: number,
  smoothingWeights: SmoothingWeights,
  hourlyRequirement: Cell168
): CohortBandFloor {
  const band = lookupWhppvBand(annualVisits);
  const cellCoreHoursP25 = allocateCellCoreHours(weighted, annualCoreRnHoursBudget(annualVisits, band.p25Whppv));
  const cellCoreHoursP75 = allocateCellCoreHours(weighted, annualCoreRnHoursBudget(annualVisits, band.p75Whppv));
  const bandFloorHourly = smoothDayOfWeek(cellCoreHoursP25, smoothingWeights).map((v, i) =>
    Math.min(Math.ceil(v), hourlyRequirement[i])
  );
  const bandCeilingHourly = smoothDayOfWeek(cellCoreHoursP75, smoothingWeights).map((v, i) =>
    Math.max(Math.ceil(v), hourlyRequirement[i])
  );
  return { bandFloorHourly, bandCeilingHourly };
}

/**
 * Per-cell demand-volatility proxy: how far this cell's p75 (busy-hour) arrivals sit above
 * its mean, as a fraction of the mean — a coefficient-of-variation-style ratio, not a formal
 * CV. `arrivalsP75` is all-or-nothing optional (same convention as ESI mix); when absent,
 * every cell is 0 (no volatility signal — Phase 2a becomes a no-op, identical to Phase 1's
 * cohort-only floor). Never negative (a p75 at or below the mean contributes no buffer);
 * mean <= 0 also contributes 0 (nothing to divide by, and nothing being asked of that cell).
 */
export function deriveDemandVolatilityHourly(arrivals: Cell168, arrivalsP75: Cell168 | null | undefined): Cell168 {
  if (!arrivalsP75) return new Array(168).fill(0);
  return arrivals.map((mean, i) => {
    if (mean <= 0) return 0;
    const p75 = arrivalsP75[i] ?? mean;
    return Math.max(0, (p75 - mean) / mean);
  });
}

/**
 * Raises the cohort band floor toward (and, as of PR C, potentially PAST) the point-target
 * curve at high-volatility hours, by linear interpolation/extrapolation:
 * `floor + ratio * (hourlyRequirement - floor)`. At volatility 0 (no p75 data, or p75 ==
 * mean), the floor is exactly the cohort floor (Phase 1's behavior, unchanged).
 *
 * 2026-07-26 PR C (SOLVER_REALISM_SPEC_2026-07-26.md, change 4) — REVERSES the ratio clamp
 * this function used to apply (`VOLATILITY_RATIO_CLAMP_MAX = 1`, retired): the old formula
 * capped `ratio` at 1, which caps the interpolation AT hourlyRequirement by construction (a
 * convex combination between `floor` and `hourlyRequirement` can never exceed either
 * endpoint) — meaning demand volatility could only ever REDISTRIBUTE the fixed budget toward
 * spiky hours, never justify staffing a spiky hour ABOVE the mean-derived target, which is
 * the entire point of a buffer. Now UNCLAMPED: a cell whose p75 arrivals are e.g. 3x its mean
 * (ratio 2) gets `floor + 2*(hourlyRequirement-floor)` — genuinely above hourlyRequirement,
 * scaling continuously with how spiky the data actually is, with no arbitrary secondary cap.
 * This is safe specifically BECAUSE PR C also retired the solver's 1e6 floor-breach cliff for
 * a finite power-law penalty (`FLOOR_WEIGHT`/`FLOOR_GAMMA`, `engine/solver.ts`) — an unusually
 * high floor from a genuine data outlier costs more to breach, it doesn't make the trim
 * infeasible, so there's no correctness reason left to cap the floor's magnitude here.
 *
 * This function now produces `protectedFloorHourly` — SOLVER-FACING ONLY (the guardrail
 * penalty in `candidateCutCost`/`trimWeekToBudget`, and `backlogFeedback.ts`'s relaxation
 * floor). It is NOT `EngineResult.bandFloorHourly` anymore — that's the CLAMPED reporting
 * curve (`computeBandFloorViolations`'s "Hours outside your typical staffing range" stat),
 * derived by clamping THIS function's output to `hourlyRequirement` in `compute()`
 * (`engine/index.ts`), not computed independently. See `.claude/rules/engine-solver.md`'s
 * "Budget-capped trim" section for the full PR C record.
 */
export function applyVolatilityBuffer(
  cohortBandFloor: Cell168,
  demandVolatilityHourly: Cell168,
  hourlyRequirement: Cell168
): Cell168 {
  return cohortBandFloor.map((floor, i) => {
    const ratio = Math.max(0, demandVolatilityHourly[i] ?? 0);
    const buffered = floor + ratio * (hourlyRequirement[i] - floor);
    return Math.ceil(buffered);
  });
}
