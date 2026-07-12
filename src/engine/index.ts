import {
  allocateCellCoreHours,
  annualCoreRnHoursBudget,
  deriveAnnualVisits,
  smoothDayOfWeek,
  sum,
  weightedArrivals,
} from './allocate';
import { computeBoarding } from './boarding';
import { solveShiftFit, recomputeFromGrid } from './solver';
import { DEFAULTS, type EngineInputs, type EngineResult, type Grid, type ReconciliationResult } from './types';

export * from './types';
export { recomputeFromGrid } from './solver';

/** The single callable engine function: (arrivals, wHPPV target, shift menu, optional inputs) -> full result. */
export function compute(inputs: EngineInputs): EngineResult {
  const acuityWeights = inputs.acuityWeights ?? DEFAULTS.acuityWeights;
  const smoothingWeights = inputs.smoothingWeights ?? DEFAULTS.smoothingWeights;
  const hoursBudgetTolerance = inputs.hoursBudgetTolerance ?? DEFAULTS.hoursBudgetTolerance;
  const transitionWeight = inputs.transitionWeight ?? DEFAULTS.transitionWeight;
  const transitionWindowHours = inputs.transitionWindowHours ?? DEFAULTS.transitionWindowHours;
  const boardingRatioTarget = inputs.boardingRatioTarget ?? DEFAULTS.boardingRatioTarget;
  const enaFloor = inputs.enaFloor ?? DEFAULTS.enaFloor;

  const annualVisits = inputs.annualVisits ?? deriveAnnualVisits(inputs.arrivals);
  const annualBudget = annualCoreRnHoursBudget(annualVisits, inputs.wHppvTarget);

  const { weighted, hasEsi } = weightedArrivals(inputs.arrivals, inputs.esiMix, acuityWeights);
  const cellCoreHours = allocateCellCoreHours(weighted, annualBudget);
  const cellCoreHoursSmoothed = smoothDayOfWeek(cellCoreHours, smoothingWeights);
  const hourlyRequirement = cellCoreHoursSmoothed.map((v) => Math.ceil(v));

  const weeklyBudgetHours = annualBudget / 52;

  const { grid, weeklyScheduledHours, shortfall, enaFloorViolationsRemaining } = solveShiftFit(
    hourlyRequirement,
    inputs.shiftMenu,
    weeklyBudgetHours,
    hoursBudgetTolerance,
    transitionWeight,
    transitionWindowHours,
    enaFloor
  );

  const overcoveragePct = weeklyBudgetHours > 0 ? (weeklyScheduledHours - weeklyBudgetHours) / weeklyBudgetHours : 0;

  const boarding = computeBoarding(inputs.arrivals, inputs.admitRate, inputs.boardingDuration, boardingRatioTarget);

  const reconciliation = reconcile(cellCoreHours, annualBudget);

  return {
    annualVisits,
    annualCoreRnHoursBudget: annualBudget,
    cellCoreHours,
    cellCoreHoursSmoothed,
    hourlyRequirement,
    esiConfidenceFlag: !hasEsi,
    grid,
    weeklyScheduledHours,
    weeklyBudgetHours,
    overcoveragePct,
    shortfall,
    enaFloorViolationsRemaining,
    reconciliation,
    boarding,
  };
}

/** Section 2.2 build-in sanity check: summing the 168-cell grid across a year reproduces the budget exactly. */
export function reconcile(cellCoreHours: number[], annualBudget: number): ReconciliationResult {
  const annualFromGrid = sum(cellCoreHours) * 52;
  const gapPct = annualBudget > 0 ? Math.abs(annualFromGrid - annualBudget) / annualBudget : 0;
  return { annualFromGrid, annualBudget, gapPct, passes: gapPct < 1e-9 };
}

/** Live-edit recompute after a manual grid edit: cheap arithmetic wHPPV + shortfall recheck, no re-solve. */
export function recomputeAfterEdit(
  grid: Grid,
  inputs: EngineInputs,
  hourlyRequirement: number[]
) {
  const { weeklyScheduledHours, shortfall } = recomputeFromGrid(grid, inputs.shiftMenu, hourlyRequirement);
  const annualVisits = inputs.annualVisits ?? deriveAnnualVisits(inputs.arrivals);
  const realizedWHppv = (weeklyScheduledHours * 52) / annualVisits;
  return { weeklyScheduledHours, shortfall, realizedWHppv };
}
