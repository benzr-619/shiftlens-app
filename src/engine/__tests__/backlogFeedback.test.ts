import { describe, expect, it } from 'vitest';
import { solveShiftFitWithBacklogFeedback } from '../backlogFeedback';
import { trimWeekToBudget, solveFullCoverageWeek } from '../solver';
import { computeBacklog } from '../backlog';
import { DEFAULTS } from '../types';
import type { Grid, ShiftDef } from '../types';

// PR B (SOLVER_REALISM_SPEC_2026-07-26.md): computeBacklog takes a BacklogRecurrenceParams
// object now, not a single decay number — use the SAME realistic defaults
// solveShiftFitWithBacklogFeedback itself falls back to, so this helper measures the loop
// against its own actual objective.
const REALISTIC_PARAMS = {
  abandonRate: DEFAULTS.backlogAbandonRate,
  recoveryEfficiency: DEFAULTS.backlogRecoveryEfficiency,
  maxDrainFraction: DEFAULTS.backlogMaxDrainFraction,
};

function totalBacklogHours(grid: Grid, requirement: number[], shifts: ShiftDef[]): number {
  return computeBacklog(grid, requirement, shifts, REALISTIC_PARAMS).backlog.reduce((a, b) => a + b, 0);
}

function scheduledHours(grid: Grid, shifts: ShiftDef[]): number {
  return Object.values(grid).reduce((acc, hc) => acc + shifts.reduce((a, s) => a + (hc[s.id] ?? 0) * s.lengthHours, 0), 0);
}

// A chronic weekly peak (day 0, hours 0-7 at requirement 3) whose backlog spills into an
// adjacent hour (day 0, hour 9) that's a genuine excess-capacity recovery point once its own
// high requirement (10) is fully covered — 'recovery' (hours 8-9) ends up with far more
// headcount than hour 8 itself needs, purely because hour 9 demands it. Every other day is a
// trivial, easily-covered baseline (requirement 1) so the interesting dynamics are isolated
// to day 0's peak/recovery interplay. Shared across all three test priorities below.
const shifts: ShiftDef[] = [
  { id: 'target', startHour: 0, lengthHours: 8 },
  { id: 'recovery', startHour: 8, lengthHours: 2 },
];

function chronicPeakRequirement(): number[] {
  const requirement = new Array(168).fill(0);
  for (let h = 0; h < 8; h++) requirement[h] = 3; // day 0, hours 0-7
  requirement[8] = 0; // day 0, hour 8
  requirement[9] = 10; // day 0, hour 9
  for (let day = 1; day < 7; day++) {
    for (let h = 0; h < 8; h++) requirement[day * 24 + h] = 1;
    requirement[day * 24 + 8] = 1;
    requirement[day * 24 + 9] = 1;
  }
  return requirement;
}

describe('2026-07-26 Phase 2b — true backlog-feedback relaxation loop (fourth reversal-in-spirit of the Step 3 trim area)', () => {
  it('chronic-shortfall scenario: the loop reallocates hours and reduces total backlog-hours across passes, at an UNCHANGED total budget', () => {
    const requirement = chronicPeakRequirement();
    const bandFloorHourly = new Array(168).fill(0);
    const demandVolatilityHourly = new Array(168).fill(0);
    const weeklyBudgetHours = 60;
    const capHours = weeklyBudgetHours * 1.1;

    // Pass 1 in isolation: the exact same trim call the loop's first iteration makes,
    // against the UN-raised floor — our baseline to compare against the loop's final result.
    const fullCoverageGrid: Grid = solveFullCoverageWeek(requirement, shifts);
    const pass1Grid = trimWeekToBudget(requirement, bandFloorHourly, demandVolatilityHourly, shifts, fullCoverageGrid, capHours);
    const pass1Total = totalBacklogHours(pass1Grid, requirement, shifts);

    const result = solveShiftFitWithBacklogFeedback(
      requirement,
      bandFloorHourly,
      demandVolatilityHourly,
      shifts,
      weeklyBudgetHours,
      0.1,
      0,
      8
    );
    const finalTotal = totalBacklogHours(result.grid, requirement, shifts);

    // The loop actually reallocated capacity somewhere (not a no-op) ...
    const gridsDiffer = [0, 1, 2, 3, 4, 5, 6].some(
      (day) => JSON.stringify(result.grid[day]) !== JSON.stringify(pass1Grid[day])
    );
    expect(gridsDiffer).toBe(true);
    // ... and that reallocation genuinely reduced total backlog-hours versus pass 1 alone.
    expect(finalTotal).toBeLessThan(pass1Total);
    // The total budget is unchanged throughout — same cap every pass, same cap at the end.
    expect(result.weeklyScheduledHours).toBeLessThanOrEqual(capHours + 1e-9);
    expect(scheduledHours(pass1Grid, shifts)).toBeLessThanOrEqual(capHours + 1e-9);
    expect(result.feedback.passesRun).toBeGreaterThan(1);
  });

  it('near-budget-exhausted guardrail: the floor-as-large-cost-penalty behavior from Phase 1 still holds under the added pressure of locally-raised floors', () => {
    // Zero slack anywhere from the start (floor == starting headcount everywhere) — every
    // possible cut breaches immediately, and the relaxation loop's own floor-raising can
    // only make hours MORE protected pass over pass, never less. If the guardrail were a
    // hard exclusion anywhere in this pipeline, an extreme cap of 0 could never be reached.
    const localShifts: ShiftDef[] = [{ id: 's', startHour: 0, lengthHours: 1 }];
    const requirement = new Array(168).fill(2);
    const bandFloorHourly = new Array(168).fill(2);
    const demandVolatilityHourly = new Array(168).fill(0);

    const result = solveShiftFitWithBacklogFeedback(requirement, bandFloorHourly, demandVolatilityHourly, localShifts, 0, 0, 0, 8);

    expect(result.weeklyScheduledHours).toBe(0); // reached the cap despite every cut breaching every pass — no stall
  });

  it('oscillation case: a later pass undoes an earlier improvement, and the loop returns the BEST pass, not the last', () => {
    const requirement = chronicPeakRequirement();
    const bandFloorHourly = new Array(168).fill(0);
    const demandVolatilityHourly = new Array(168).fill(0);

    const result = solveShiftFitWithBacklogFeedback(
      requirement,
      bandFloorHourly,
      demandVolatilityHourly,
      shifts,
      // PR B found budget=50 (single-decay model) oscillated; PR B re-swept to budget=70 for
      // the new abandon/recovery/drain-cap physics. PR C (SOLVER_REALISM_SPEC_2026-07-26.md)
      // changes the trim's cost function again (convex severity + peak term, replacing linear
      // backlog-hours) — 70 no longer oscillates cleanly under THIS objective either. Re-swept
      // empirically a second time against the same scenario — 65 oscillates cleanly (pass 1
      // total ≈1000, pass 2 drops to ≈800 — the best pass — then rises back to ≈933 and stays
      // there, worse than pass 2's own result).
      65,
      0.1,
      0,
      8
    );

    const series = result.feedback.totalBacklogHoursByPass;
    const best = Math.min(...series);
    const last = series[series.length - 1];

    // Prove this scenario actually oscillates — the fallback wouldn't be tested otherwise.
    expect(best).toBeLessThan(last - 1e-6);

    // The returned grid matches the BEST pass, not the last.
    const returnedTotal = totalBacklogHours(result.grid, requirement, shifts);
    expect(returnedTotal).toBeCloseTo(best, 3);
    expect(returnedTotal).toBeLessThan(last - 1e-6);
  });
});
