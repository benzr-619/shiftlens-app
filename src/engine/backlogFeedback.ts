// §2b — true backlog-feedback loop (2026-07-26, Phase 2b of
// BACKLOG_FEEDBACK_AND_VARIANCE_SPEC_2026-07-25.md). REVERSES "Phase 1 only uses backlog as
// a cost signal for choosing which hours to cut, it never actually asks for more capacity at
// the hours that need to drain a queue" — the FOURTH reversal-in-spirit of the Step 3 trim
// area (see .claude/rules/engine-solver.md's "Budget-capped trim" section for the full
// history: linear shortfall → band-floor deadband → joint whole-week backlog-cost trim →
// THIS iterative relaxation on top of it).
//
// The gap this closes: effective demand at hour h depends on backlog carried in from h-1,
// which depends on whether h-1 was adequately staffed, which was itself a solver decision
// made using whatever effective demand existed for h-1. Circular — not a closed-form curve,
// hence the iterative relaxation below rather than a one-pass formula.

import type { Cell168, Grid, ShiftDef, ShortfallEntry } from './types';
import { DEFAULTS } from './types';
import { coverageForDay, solveFullCoverageWeek, trimWeekToBudget, enforceDepartmentFloor } from './solver';
import { computeBacklog } from './backlog';
import { caughtUpThresholdForHour, type BacklogRecurrenceParams } from './backlogModel';

const DEFAULT_BACKLOG_PARAMS: BacklogRecurrenceParams = {
  abandonRate: DEFAULTS.backlogAbandonRate,
  recoveryEfficiency: DEFAULTS.backlogRecoveryEfficiency,
  maxDrainFraction: DEFAULTS.backlogMaxDrainFraction,
};

// 6-10 passes per the spec's own starting point ("cheap at 168-hour scale"); a named,
// tunable constant, not load-bearing math.
const DEFAULT_MAX_PASSES = 8;

export interface BacklogFeedbackDiagnostics {
  /** How many relaxation passes actually ran (<= the cap; can stop early on convergence). */
  passesRun: number;
  /** True iff the pass cap was hit WHILE the total-backlog-hours metric was still improving
   * (i.e. the loop didn't get a chance to converge or oscillate — a chronically-backlogged
   * scenario is a real signal worth surfacing, not silently swallowing into the last pass). */
  stillImprovingAtCap: boolean;
  /** Total backlog-hours at every pass attempted, in order — diagnostic history. */
  totalBacklogHoursByPass: number[];
}

export interface BacklogFeedbackResult {
  grid: Grid;
  weeklyScheduledHours: number;
  shortfall: ShortfallEntry[];
  enaFloorViolationsRemaining: Array<{ day: number; hour: number; onDuty: number }>;
  feedback: BacklogFeedbackDiagnostics;
}

/**
 * The relaxation loop:
 *   1. Full-coverage solve ONCE (the 5.2 upper bound) — fixed across every pass.
 *   2. Pass 1: trim to budget against the given (2a-composed) floor; compute backlog.
 *   3. Wherever INHERITED backlog at an hour (`carriedIn`, not the hour's own generated
 *      share) meets/exceeds `BACKLOG_CAUGHT_UP_THRESHOLD`, raise that hour's LOCAL protected
 *      floor by the carried-in amount for the next pass — cumulative across passes, and
 *      deliberately NOT clamped to `hourlyRequirement` the way the 2a cohort/volatility floor
 *      is: this floor is actively asking for MORE than the point target to drain a queue,
 *      which is the entire point of this mechanism.
 *   4. Re-run ONLY the trim step against the raised floor (same fixed `capHours`, same
 *      `fullCoverageGrid`, same candidates) — never the full pipeline again.
 *   5. Repeat until either total backlog-hours stops improving, the floor stops changing
 *      anywhere (converged), or `maxPasses` is hit. Return whichever pass had the LOWEST
 *      total backlog-hours, not necessarily the last — this is a relaxation, not a provably
 *      convergent fixed point, and pass N can undo pass N-1's improvement (oscillation).
 *
 * The ENA department floor (5.6) is applied ONCE, at the very end, to whichever pass's grid
 * wins — not repeated inside the loop. This keeps every pass's backlog measurement directly
 * comparable (same post-processing state), and the floor essentially never fires in practice
 * anyway (see .claude/rules/engine-solver.md's 5.6 section).
 *
 * Fixed annual budget throughout (per the spec's explicit resolution of the budget-tension
 * question): only the INTERNAL distribution changes pass to pass, never the total. If a
 * future session wants the budget itself to flex upward for a chronically-backlogged week,
 * that's a bigger, separate decision requiring its own sign-off — not something this loop
 * decides on its own.
 */
export function solveShiftFitWithBacklogFeedback(
  hourlyRequirement168: number[],
  protectedFloorHourly168: number[],
  demandVolatilityHourly168: number[],
  shifts: ShiftDef[],
  weeklyBudgetHours: number,
  hoursBudgetTolerance: number,
  enaFloor: number,
  maxPasses: number = DEFAULT_MAX_PASSES,
  params: BacklogRecurrenceParams = DEFAULT_BACKLOG_PARAMS
): BacklogFeedbackResult {
  const capHours = weeklyBudgetHours * (1 + hoursBudgetTolerance);

  // PR A: full-coverage solve is now JOINT over the whole week (a shift's coverage can spill
  // into the next day) — see .claude/rules/engine-solver.md's "Shift wraparound model".
  const fullCoverageGrid: Grid = solveFullCoverageWeek(hourlyRequirement168, shifts);

  // PR C (change 4): the loop's LOCAL floor-raising (step 3 below) composes onto
  // `protectedFloorHourly168` — the UNCLAMPED protected floor, not `bandFloorHourly` (the
  // clamped reporting curve) — since this floor is actively asking for MORE than the point
  // target to drain a queue, same reasoning as the "deliberately NOT clamped" note above.
  let passFloor: Cell168 = protectedFloorHourly168.slice();
  let bestGrid: Grid | null = null;
  let bestTotal = Infinity;
  const totalBacklogHoursByPass: number[] = [];

  for (let pass = 0; pass < maxPasses; pass++) {
    const grid = trimWeekToBudget(
      hourlyRequirement168,
      passFloor,
      demandVolatilityHourly168,
      shifts,
      fullCoverageGrid,
      capHours,
      params
    );
    const backlog = computeBacklog(grid, hourlyRequirement168, shifts, params);
    const totalBacklogHours = backlog.backlog.reduce((a, b) => a + b, 0);
    totalBacklogHoursByPass.push(totalBacklogHours);

    if (totalBacklogHours < bestTotal - 1e-9) {
      bestTotal = totalBacklogHours;
      bestGrid = grid;
    }

    if (pass === maxPasses - 1) break; // no next pass to prepare

    const nextFloor = passFloor.slice();
    let anyRaise = false;
    for (let g = 0; g < 168; g++) {
      // PR E (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §4b): relative per-hour threshold, not
      // the retired flat constant — see backlogModel.ts's header.
      if (backlog.carriedIn[g] >= caughtUpThresholdForHour(hourlyRequirement168[g] ?? 0)) {
        nextFloor[g] = passFloor[g] + backlog.carriedIn[g];
        anyRaise = true;
      }
    }
    if (!anyRaise) break; // converged: no hour has material inherited backlog left to protect against
    passFloor = nextFloor;
  }

  const passesRun = totalBacklogHoursByPass.length;
  const stillImprovingAtCap = passesRun >= maxPasses && totalBacklogHoursByPass[passesRun - 1] === bestTotal;

  const finalGrid = bestGrid ?? fullCoverageGrid;
  const enaFloorViolationsRemaining = enforceDepartmentFloor(finalGrid, shifts, enaFloor);

  const weeklyScheduledHours = Object.values(finalGrid).reduce(
    (acc, headcount) => acc + shifts.reduce((a, s) => a + (headcount[s.id] ?? 0) * s.lengthHours, 0),
    0
  );

  const shortfall: ShortfallEntry[] = [];
  for (let day = 0; day < 7; day++) {
    const requirement = hourlyRequirement168.slice(day * 24, day * 24 + 24);
    const coverage = coverageForDay(finalGrid, shifts, day);
    for (let h = 0; h < 24; h++) {
      if (coverage[h] < requirement[h]) {
        shortfall.push({ day, hour: h, requirement: requirement[h], scheduled: coverage[h], deficit: requirement[h] - coverage[h] });
      }
    }
  }

  return {
    grid: finalGrid,
    weeklyScheduledHours,
    shortfall,
    enaFloorViolationsRemaining,
    feedback: { passesRun, stillImprovingAtCap, totalBacklogHoursByPass },
  };
}
