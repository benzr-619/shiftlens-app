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
import { summarizeBacklogSeverity, computeBacklog } from './backlog';
import type { BacklogRecurrenceParams } from './backlogModel';
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
export { computeHiddenBoardingDiagnostic, type HiddenBoardingDiagnostic, type HiddenBoardingBlock } from './hiddenBoarding';
export { computeSynthesis, type SynthesisResult, computeCombinedReallocation, type CombinedReallocationResult } from './synthesis';
export { searchFlexibleMenus, NO_FLEX, type FlexAxes, type MenuCandidate } from './flexMenu';
export { computePreBedRequestValidation, type PreBedRequestValidation } from './preBedRequestValidation';
export { solveShiftFitWithBacklogFeedback, type BacklogFeedbackDiagnostics, type BacklogFeedbackResult } from './backlogFeedback';

// PR E (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §4d): abandonRate becomes measurable from the
// department's own LWBS rate when provided; absent -> the DEFAULTS cohort assumption.
// recoveryEfficiency/maxDrainFraction stay at their DEFAULTS values — those two are not (yet)
// plausibly measurable from a real ED's own data, unlike abandonRate. Shared by `compute()` and
// `computeScenarioB` (PR F) so both use identical backlog physics for the same department.
function resolveBacklogParams(inputs: EngineInputs): BacklogRecurrenceParams {
  return {
    abandonRate: inputs.lwbsRate ?? DEFAULTS.backlogAbandonRate,
    recoveryEfficiency: DEFAULTS.backlogRecoveryEfficiency,
    maxDrainFraction: DEFAULTS.backlogMaxDrainFraction,
  };
}

/** The single callable engine function: (arrivals, wHPPV target, shift menu, optional inputs) -> full result. */
export function compute(inputs: EngineInputs): EngineResult {
  const acuityWeights = inputs.acuityWeights ?? DEFAULTS.acuityWeights;
  const smoothingWeights = inputs.smoothingWeights ?? DEFAULTS.smoothingWeights;
  const hoursBudgetTolerance = inputs.hoursBudgetTolerance ?? DEFAULTS.hoursBudgetTolerance;
  const boardingRatioTarget = inputs.boardingRatioTarget ?? DEFAULTS.boardingRatioTarget;
  const enaFloor = inputs.enaFloor ?? DEFAULTS.enaFloor;
  const backlogParams = resolveBacklogParams(inputs);

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
    inputs.shiftMenu,
    weeklyBudgetHours,
    hoursBudgetTolerance,
    enaFloor,
    undefined,
    backlogParams
  );

  const overcoveragePct = weeklyBudgetHours > 0 ? (weeklyScheduledHours - weeklyBudgetHours) / weeklyBudgetHours : 0;

  // PR C (change 5): expose the solver's actual objective — otherwise the grid is
  // unexplainable by construction (the results page had no way to show what the solver was
  // even minimizing).
  const { totalBacklogHours, totalSeverity, peakSeverity } = summarizeBacklogSeverity(
    grid,
    hourlyRequirement,
    inputs.shiftMenu,
    backlogParams
  );
  // PR E (§4e): estimatedAbandonedHours for the FINAL solved grid — computeBacklog is cheap
  // pure arithmetic; summarizeBacklogSeverity above doesn't expose this field, so a second
  // (identical-inputs) call is the simplest way to get it without changing that function's
  // return shape for its other callers (flexMenu ranking, etc.) that don't need it.
  const estimatedAbandonedHours = computeBacklog(grid, hourlyRequirement, inputs.shiftMenu, backlogParams)
    .estimatedAbandonedHours;

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
    inputs.shiftMenu,
    fullCoverageGrid,
    capHours,
    backlogParams
  );
  const marginalKneePoint = findMarginalKneePoint(marginalCurve);
  // EDGE CASE (explicit, not assumed): a generous wHppvTarget can already fund full coverage,
  // making fteDelta <= 0 — the UI must say "your budget already funds full coverage," not
  // render a negative ask. capHours (not weeklyBudgetHours) is the comparison point since
  // that's the actual funded ceiling the trim targets (budget + tolerance).
  const fullCoverage = {
    weeklyHours: fullCoverageWeeklyHours,
    impliedWhppv: annualVisits > 0 ? (fullCoverageWeeklyHours * 52) / annualVisits : 0,
    fteDelta: ((fullCoverageWeeklyHours - capHours) * 52) / 2080,
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
    }
  );

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
    totalBacklogHours,
    totalSeverity,
    peakSeverity,
    estimatedAbandonedHours,
    backlogFeedbackPassCount: feedback.passesRun,
    backlogFeedbackStillImprovingAtCap: feedback.stillImprovingAtCap,
    fullCoverage,
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
// permission. Mechanically a PARAMETER SWAP, not a second solver — the EXACT SAME pipeline
// `compute()` uses for the primary idealized grid (`solveShiftFitWithBacklogFeedback`), just
// with `weeklyBudgetHours` set to the CURRENT grid's own weekly scheduled hours instead of the
// target-implied figure. `hourlyRequirement`/`protectedFloorHourly`/`demandVolatilityHourly`/
// the ENA floor/the shift menu are all held FIXED (read off the already-computed `result` and
// `inputs`) — this function does not re-derive any of them.
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
  /** The solved grid's actual weekly hours — equals `currentTotalWeeklyHours` unless the ENA
   * floor pass (which runs LAST, unconditionally) pushed it higher. */
  weeklyScheduledHours: number;
  /** The current grid's own weekly scheduled hours — the fixed budget this scenario solves
   * against. */
  currentTotalWeeklyHours: number;
  totalBacklogHours: number;
  totalSeverity: number;
  peakSeverity: number;
  /** Edge case (spec §5): current hours already meet/exceed full-coverage hours — B IS full
   * coverage. A great result; the caller must say so plainly, not render it as an error. */
  isFullCoverage: boolean;
  /** Edge case (spec §5): current hours are below what the ENA floor requires, so the floor
   * pass pushed B's actual hours above `currentTotalWeeklyHours`. Report this overage; never
   * call B "budget-neutral" when the floor pass has already made it not one. Zero when the
   * floor didn't need to intervene. */
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

  const enaFloor = inputs.enaFloor ?? DEFAULTS.enaFloor;
  const hoursBudgetTolerance = inputs.hoursBudgetTolerance ?? DEFAULTS.hoursBudgetTolerance;
  const backlogParams = resolveBacklogParams(inputs);

  const { grid, weeklyScheduledHours } = solveShiftFitWithBacklogFeedback(
    result.hourlyRequirement,
    result.protectedFloorHourly,
    result.demandVolatilityHourly,
    inputs.shiftMenu,
    currentTotalWeeklyHours,
    hoursBudgetTolerance,
    enaFloor,
    undefined,
    backlogParams
  );

  const { totalBacklogHours, totalSeverity, peakSeverity } = summarizeBacklogSeverity(
    grid,
    result.hourlyRequirement,
    inputs.shiftMenu,
    backlogParams
  );

  return {
    grid,
    weeklyScheduledHours,
    currentTotalWeeklyHours,
    totalBacklogHours,
    totalSeverity,
    peakSeverity,
    isFullCoverage: currentTotalWeeklyHours >= result.fullCoverage.weeklyHours,
    overageFromFloor: Math.max(0, weeklyScheduledHours - currentTotalWeeklyHours),
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
