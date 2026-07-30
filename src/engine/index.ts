import {
  allocateCellCoreHours,
  annualCoreRnHoursBudget,
  deriveAnnualVisits,
  smoothDayOfWeek,
  sum,
  weightedArrivals,
} from './allocate';
import { computeBoarding } from './boarding';
import { recomputeFromGrid, solveFullCoverageWeek, trimWeekToBudgetWithTrajectory, findMarginalKneePoint } from './solver';
import { solveShiftFitWithBacklogFeedback } from './backlogFeedback';
import { deriveCohortBandFloor, deriveDemandVolatilityHourly, applyVolatilityBuffer } from './demandBand';
import { summarizeBacklogSeverity } from './backlog';
import { reallocateHoursExact } from './exactReallocation';
import { lookupWhppvBand } from '../lib/edbaLookup';
import { DEFAULTS, type EngineInputs, type EngineResult, type Grid, type ReconciliationResult } from './types';

export * from './types';
export {
  recomputeFromGrid,
  solveShiftFit,
  solveFullCoverageWeek,
  trimWeekToBudget,
  trimWeekToBudgetWithTrajectory,
  findMarginalKneePoint,
  candidateCutCost,
  severity,
  totalSeverity,
  peakSeverityOf,
  SEVERITY_GAMMA,
  type MarginalCurvePoint,
} from './solver';
export {
  computeBacklog,
  summarizeBacklogSeverity,
  BACKLOG_CAUGHT_UP_THRESHOLD,
  type BacklogResult,
  type BacklogShiftDiagnostic,
  type BacklogSeveritySummary,
} from './backlog';
export { computeBandFloorViolations, type BandFloorResult } from './bandFloor';
export { computePerShiftDiagnostic, type PerShiftDiagnostic, type ShiftDiagnosticGroup, type ArrivalsStatus } from './hiddenBoarding';
export { computeSynthesis, type SynthesisResult, computeCombinedReallocation, type CombinedReallocationResult } from './synthesis';
export { searchFlexibleMenus, NO_FLEX, type FlexAxes, type MenuCandidate } from './flexMenu';
export { computePreBedRequestValidation, type PreBedRequestValidation } from './preBedRequestValidation';
export { solveShiftFitWithBacklogFeedback, type BacklogFeedbackDiagnostics, type BacklogFeedbackResult } from './backlogFeedback';
export { NO_COMPRESSION_FLOOR_WHPPV } from './backlogModel';
export { reallocateHoursExact, type ExactReallocationResult } from './exactReallocation';

/** The single callable engine function: (arrivals, wHPPV target, shift menu, optional inputs) -> full result. */
export function compute(inputs: EngineInputs): EngineResult {
  const acuityWeights = inputs.acuityWeights ?? DEFAULTS.acuityWeights;
  const smoothingWeights = inputs.smoothingWeights ?? DEFAULTS.smoothingWeights;
  const hoursBudgetTolerance = inputs.hoursBudgetTolerance ?? DEFAULTS.hoursBudgetTolerance;
  const boardingRatioTarget = inputs.boardingRatioTarget ?? DEFAULTS.boardingRatioTarget;
  const enaFloor = inputs.enaFloor ?? DEFAULTS.enaFloor;
  const hoursPerFteAnnual = inputs.hoursPerFteAnnual ?? DEFAULTS.hoursPerFteAnnual;

  const annualVisits = inputs.annualVisits ?? deriveAnnualVisits(inputs.arrivals);
  const annualBudget = annualCoreRnHoursBudget(annualVisits, inputs.wHppvTarget);

  const { weighted, hasEsi } = weightedArrivals(inputs.arrivals, inputs.esiMix, acuityWeights);
  const cellCoreHours = allocateCellCoreHours(weighted, annualBudget);
  const cellCoreHoursSmoothed = smoothDayOfWeek(cellCoreHours, smoothingWeights);
  const hourlyRequirement = cellCoreHoursSmoothed.map((v) => Math.ceil(v));

  // 2026-07-25 (reversal, see .claude/rules/engine-solver.md "Budget-capped trim"): per-cell
  // lower/upper typical-staffing-band curves, derived via the EXACT SAME allocation pipeline
  // as hourlyRequirement above — just run twice more against the cohort p25/p75 annual
  // budgets instead of the point wHppvTarget budget. This does NOT change
  // annualCoreRnHoursBudget (still driven by the single wHppvTarget point) or the
  // reconciliation check below.
  const { bandFloorHourly: cohortBandFloor, bandCeilingHourly } = deriveCohortBandFloor(
    weighted,
    annualVisits,
    smoothingWeights,
    hourlyRequirement
  );

  // 2026-07-26 (Phase 2a, BACKLOG_FEEDBACK_AND_VARIANCE_SPEC_2026-07-25.md "mean-arrival
  // trap" fix): an independent second signal composes onto the cohort floor — this ED's own
  // p75-vs-mean arrivals spread (arrivalsP75, all-or-nothing optional; all-zero volatility
  // when absent, so this is a no-op over Phase 1's cohort-only floor). Deliberately does NOT
  // touch annualVisits/annualCoreRnHoursBudget/hourlyRequirement either — see
  // engine/demandBand.ts's header comment for why both signals stay separate functions.
  //
  // 2026-07-26 PR C (SOLVER_REALISM_SPEC_2026-07-26.md, change 4): the composed curve now
  // SPLITS into two. `protectedFloorHourly` is UNCLAMPED — volatility may raise it above
  // hourlyRequirement — and is SOLVER-FACING ONLY (the trim's guardrail penalty,
  // backlogFeedback's relaxation floor). `bandFloorHourly` stays CLAMPED to hourlyRequirement,
  // derived FROM protectedFloorHourly by clamping here, and is REPORTING-ONLY (the "Hours
  // outside your typical staffing range" stat, `computeBandFloorViolations`) — nothing solver-
  // facing may read `bandFloorHourly` anymore. See engine/demandBand.ts's header and
  // .claude/rules/engine-solver.md's "Budget-capped trim" section for the full rationale.
  const demandVolatilityHourly = deriveDemandVolatilityHourly(inputs.arrivals, inputs.arrivalsP75);
  const protectedFloorHourly = applyVolatilityBuffer(cohortBandFloor, demandVolatilityHourly, hourlyRequirement);
  const bandFloorHourly = protectedFloorHourly.map((v, i) => Math.min(v, hourlyRequirement[i]));

  // 2026-07-28 (ninth shape) — the single flat department-level peer-cohort p25 wHPPV the
  // visits-based backlog recurrence compresses down to (never past). See EngineResult's
  // `floorWhppv` field doc and backlogModel.ts's header for the full formula.
  const floorWhppv = lookupWhppvBand(annualVisits).p25Whppv;

  const weeklyBudgetHours = annualBudget / 52;

  // 2026-07-26 (Phase 2b, BACKLOG_FEEDBACK_AND_VARIANCE_SPEC_2026-07-25.md): the primary
  // idealized-grid solve now runs the iterative backlog-feedback relaxation loop (engine/
  // backlogFeedback.ts) instead of a single one-shot trim — see .claude/rules/
  // engine-solver.md's "Budget-capped trim" section for the full record. Fixed annual
  // budget throughout (same weeklyBudgetHours/hoursBudgetTolerance every pass); only the
  // internal distribution changes. flexMenu.ts's candidate search and
  // ShiftMenuFlexibilitySection.tsx's manual-menu solve deliberately stay on the plain
  // one-shot `solveShiftFit` — flagged as an open question in engine-solver.md, not silently
  // decided either way.
  const { grid, weeklyScheduledHours, shortfall, enaFloorViolationsRemaining, feedback } = solveShiftFitWithBacklogFeedback(
    hourlyRequirement,
    protectedFloorHourly,
    demandVolatilityHourly,
    inputs.arrivals,
    floorWhppv,
    inputs.shiftMenu,
    weeklyBudgetHours,
    hoursBudgetTolerance,
    enaFloor
  );

  const overcoveragePct = weeklyBudgetHours > 0 ? (weeklyScheduledHours - weeklyBudgetHours) / weeklyBudgetHours : 0;

  // PR C (change 5): expose the solver's actual objective — otherwise the grid is
  // unexplainable by construction (the results page had no way to show what the solver was
  // even minimizing).
  const { totalBacklogHours, totalSeverity, peakSeverity } = summarizeBacklogSeverity(
    grid,
    inputs.arrivals,
    hourlyRequirement,
    inputs.shiftMenu,
    floorWhppv
  );

  // 2026-07-26 PR D (SOLVER_REALISM_SPEC_2026-07-26.md, changes 1-2) — the funding-ask surface.
  // `solveFullCoverageWeek`'s never-short-at-any-hour grid was previously computed (inside
  // `solveShiftFit`/`solveShiftFitWithBacklogFeedback`) and thrown away as a pure intermediate.
  // Computed here as a SEPARATE, plain ONE-SHOT trim-with-trajectory — deliberately NOT threaded
  // through the Phase 2b relaxation loop above, for the same reason flexMenu/the flex-comparison
  // stayed one-shot (PR C change 5): this is an ADVISORY curve (what does more budget buy),
  // not the primary schedule, and running 8 relaxation passes just to trace a marginal curve
  // would be a real cost multiplier for no accuracy benefit the curve's own consumers need. Uses
  // the SAME hourlyRequirement/protectedFloorHourly/weeklyBudgetHours the primary solve uses, so
  // `fullCoverage.weeklyHours` is directly comparable to `weeklyScheduledHours`.
  const capHours = weeklyBudgetHours * (1 + hoursBudgetTolerance);
  const fullCoverageGrid = solveFullCoverageWeek(hourlyRequirement, inputs.shiftMenu);
  const fullCoverageWeeklyHours = Object.values(fullCoverageGrid).reduce(
    (acc, hc) => acc + inputs.shiftMenu.reduce((a, s) => a + (hc[s.id] ?? 0) * s.lengthHours, 0),
    0
  );
  const { trajectory: marginalCurve } = trimWeekToBudgetWithTrajectory(
    hourlyRequirement,
    protectedFloorHourly,
    demandVolatilityHourly,
    inputs.arrivals,
    floorWhppv,
    inputs.shiftMenu,
    fullCoverageGrid,
    capHours
  );
  const marginalKneePoint = findMarginalKneePoint(marginalCurve);
  // EDGE CASE (explicit, not assumed): a generous wHppvTarget can already fund full coverage,
  // making fteDelta <= 0 — the UI must say "your budget already funds full coverage," not
  // render a negative ask. capHours (not weeklyBudgetHours) is the comparison point since
  // that's the actual funded ceiling the trim targets (budget + tolerance).
  const fullCoverage = {
    weeklyHours: fullCoverageWeeklyHours,
    impliedWhppv: annualVisits > 0 ? (fullCoverageWeeklyHours * 52) / annualVisits : 0,
    fteDelta: ((fullCoverageWeeklyHours - capHours) * 52) / hoursPerFteAnnual,
    grid: fullCoverageGrid,
  };

  const boarding = computeBoarding(
    inputs.arrivals,
    inputs.admitRate,
    inputs.boardingDuration,
    boardingRatioTarget,
    inputs.shiftMenu,
    inputs.dayOfWeekMeanBoardingDurationHours,
    inputs.monthlyMeanBoardingDurationHours,
    {
      boardingCensusMedical: inputs.boardingCensusMedical,
      boardingCensusBH: inputs.boardingCensusBH,
      monthlyBoardingCensusMedical: inputs.monthlyBoardingCensusMedical,
      monthlyBoardingCensusBH: inputs.monthlyBoardingCensusBH,
      bhBoardingRatioTarget: inputs.bhBoardingRatioTarget,
    },
    hoursPerFteAnnual
  );

  // PR B (RESULTS_PAGE_V2_SPEC_2026-07-27.md §5.3) — Panel 3's "what would it take to fully
  // cover the department" ceiling: full coverage over the COMBINED arrivals+boarding demand
  // curve. Reuses solveFullCoverageWeek verbatim (no second solver) against
  // hourlyRequirement + boarding's base representative-week curve
  // (cellBoardingRnHours — the same pre-seasonality, per-hour-requirement-shaped curve
  // hiddenBoarding.ts already combines with hourlyRequirement, see .claude/rules/
  // results-redesign.md's PR F section). Resource-agnostic by construction — solveFullCoverageWeek
  // has no concept of ED-vs-hold nurses (§3.5); it just asks "how many total nurse-hours,
  // placed where, cover this demand curve with zero shortfall anywhere." Always computed
  // (never null) — with no boarding data the combined curve degenerately equals the arrivals-only
  // curve, which is the mathematically correct answer, not a special case to guard against.
  const combinedRequirement168 = hourlyRequirement.map((v, i) => v + (boarding ? boarding.cellBoardingRnHours[i] : 0));
  const fullCoverageCombinedGrid = solveFullCoverageWeek(combinedRequirement168, inputs.shiftMenu);
  const fullCoverageCombinedWeeklyHours = Object.values(fullCoverageCombinedGrid).reduce(
    (acc, hc) => acc + inputs.shiftMenu.reduce((a, s) => a + (hc[s.id] ?? 0) * s.lengthHours, 0),
    0
  );
  const fullCoverageCombined = { weeklyHours: fullCoverageCombinedWeeklyHours, grid: fullCoverageCombinedGrid };

  // Productivity Target Buffer method (ENA-referenced): what the boarding load would cost
  // in ED-facing wHPPV if it were absorbed by core staff rather than separately covered.
  const lostProductivity = boarding
    ? {
        wHppvConsumedByBoarding: boarding.annualBoardingHours / annualVisits,
        wHppvAvailableForEdCare: inputs.wHppvTarget - boarding.annualBoardingHours / annualVisits,
      }
    : null;

  const reconciliation = reconcile(cellCoreHours, annualBudget);

  return {
    annualVisits,
    annualCoreRnHoursBudget: annualBudget,
    cellCoreHours,
    cellCoreHoursSmoothed,
    hourlyRequirement,
    bandFloorHourly,
    bandCeilingHourly,
    protectedFloorHourly,
    demandVolatilityHourly,
    floorWhppv,
    totalBacklogHours,
    totalSeverity,
    peakSeverity,
    backlogFeedbackPassCount: feedback.passesRun,
    backlogFeedbackStillImprovingAtCap: feedback.stillImprovingAtCap,
    fullCoverage,
    fullCoverageCombined,
    marginalCurve,
    marginalKneePoint,
    esiConfidenceFlag: !hasEsi,
    grid,
    weeklyScheduledHours,
    weeklyBudgetHours,
    overcoveragePct,
    shortfall,
    enaFloorViolationsRemaining,
    reconciliation,
    boarding,
    lostProductivity,
  };
}

// PR F (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §5) — Scenario B, "the same hours, better
// placed." The only scenario with no ask attached: a manager can act on it Monday without
// permission.
//
// 2026-07-29 REVERSAL (Ben's direct ask, see .claude/rules/engine-solver.md's "Exact-hours
// reallocation" section): this used to be a PARAMETER SWAP over the primary solve pipeline
// (`solveShiftFitWithBacklogFeedback`, budget set to the current grid's own hours) — but that
// pipeline only ever CUTS from a full-coverage upper bound down to "at or under budget * 1.10,"
// so the reallocated total routinely landed somewhat under (or, via the ENA-floor pass, above)
// today's actual hours, not exactly ON it. Scenario B's whole premise is "the SAME hours,
// better placed" — an inexact total contradicted its own headline. Now uses
// `reallocateHoursExact` (`engine/exactReallocation.ts`) instead: a REALLOCATION (only ever
// trades one shift-unit for another) rather than a TRIM (only ever removes), so total hours are
// conserved EXACTLY, by construction, every time — not approximately. This also means the ENA
// floor pass no longer runs for this scenario (it can only ever ADD hours, which would break
// exact conservation) — see `ScenarioBResult.overageFromFloor`'s doc below.
//
// CRITICAL FRAMING (spec §5, not enforced by this function — it's a UI responsibility):
// Scenario B is computed on the ARRIVALS budget only (`hourlyRequirement` never includes
// boarding — the separate-budget thesis, spec §6). It must be presented as "what arrivals
// alone would justify," explicitly bounded, with the §7 synthesis as a required continuation
// — never as a standalone recommendation. Acting on B without reading the boarding chapters
// can genuinely hurt a department whose current schedule is (silently) covering boarding at
// night. This function only computes the number; it carries no opinion about whether acting on
// it alone is a good idea — that's the caller's (and ultimately the page's) job.
export interface ScenarioBResult {
  grid: Grid;
  /** The reallocated grid's actual weekly hours — ALWAYS exactly `currentTotalWeeklyHours`
   * (2026-07-29: exact reallocation never adds or removes hours, only trades them). */
  weeklyScheduledHours: number;
  /** The current grid's own weekly scheduled hours — the fixed total this scenario reallocates
   * against. */
  currentTotalWeeklyHours: number;
  totalBacklogHours: number;
  totalSeverity: number;
  peakSeverity: number;
  /** Edge case (spec §5): current hours already meet/exceed full-coverage hours — B IS full
   * coverage. A great result; the caller must say so plainly, not render it as an error. */
  isFullCoverage: boolean;
  /** ALWAYS 0 as of 2026-07-29 — kept on the type for backward compatibility with existing
   * callers/narrative copy. Before the exact-reallocation reversal above, a department below
   * the ENA floor could see the floor's safety pass push B's hours above
   * `currentTotalWeeklyHours`; that safety net no longer runs for this scenario (it would
   * break the "exactly the same hours" guarantee), so a below-floor department now stays below
   * the floor after reallocation too — visible via the heatmap's floor flag/the "hours below
   * the peer floor" stat, not auto-corrected here. */
  overageFromFloor: number;
}

/**
 * Returns `null` when there's no current staffing to compute against (spec §5: "no current
 * staffing -> CTA, not a scenario" — the caller's `hasCurrentStaffing` check should already
 * gate rendering, this is a second, cheap guard against calling it on an empty/unset grid).
 */
export function computeScenarioB(result: EngineResult, inputs: EngineInputs, currentStaffingGrid: Grid): ScenarioBResult | null {
  let currentTotalWeeklyHours = 0;
  for (let day = 0; day < 7; day++) {
    for (const s of inputs.shiftMenu) currentTotalWeeklyHours += (currentStaffingGrid[day]?.[s.id] ?? 0) * s.lengthHours;
  }
  if (currentTotalWeeklyHours <= 0) return null;

  const { grid } = reallocateHoursExact(
    currentStaffingGrid,
    inputs.shiftMenu,
    inputs.arrivals,
    result.hourlyRequirement,
    result.floorWhppv
  );

  const { totalBacklogHours, totalSeverity, peakSeverity } = summarizeBacklogSeverity(
    grid,
    inputs.arrivals,
    result.hourlyRequirement,
    inputs.shiftMenu,
    result.floorWhppv
  );

  return {
    grid,
    weeklyScheduledHours: currentTotalWeeklyHours,
    currentTotalWeeklyHours,
    totalBacklogHours,
    totalSeverity,
    peakSeverity,
    isFullCoverage: currentTotalWeeklyHours >= result.fullCoverage.weeklyHours,
    overageFromFloor: 0,
  };
}

/** Section 2.2 build-in sanity check: summing the 168-cell grid across a year reproduces the budget exactly. */
export function reconcile(cellCoreHours: number[], annualBudget: number): ReconciliationResult {
  const annualFromGrid = sum(cellCoreHours) * 52;
  const gapPct = annualBudget > 0 ? Math.abs(annualFromGrid - annualBudget) / annualBudget : 0;
  return { annualFromGrid, annualBudget, gapPct, passes: gapPct < 1e-9 };
}

/** Live-edit recompute after a manual grid edit: cheap arithmetic wHPPV + shortfall recheck,
 * plus a 5.6 department-floor re-check (also arithmetic, no re-solve) so a manual edit that
 * drops an hour below enaFloor is caught immediately rather than only at the next full solve. */
export function recomputeAfterEdit(
  grid: Grid,
  inputs: EngineInputs,
  hourlyRequirement: number[]
) {
  const enaFloor = inputs.enaFloor ?? DEFAULTS.enaFloor;
  const { weeklyScheduledHours, shortfall, enaFloorViolationsRemaining } = recomputeFromGrid(
    grid,
    inputs.shiftMenu,
    hourlyRequirement,
    enaFloor
  );
  const annualVisits = inputs.annualVisits ?? deriveAnnualVisits(inputs.arrivals);
  const realizedWHppv = (weeklyScheduledHours * 52) / annualVisits;
  return { weeklyScheduledHours, shortfall, realizedWHppv, enaFloorViolationsRemaining };
}
