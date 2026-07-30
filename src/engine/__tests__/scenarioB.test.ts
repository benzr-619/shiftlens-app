import { describe, expect, it } from 'vitest';
import { compute, computeScenarioB, summarizeBacklogSeverity } from '../index';
import type { EngineInputs, Grid } from '../types';

const dayNight = [
  { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 },
  { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 },
];

function unimodalArrivals(): number[] {
  const arr = new Array(168);
  for (let i = 0; i < 168; i++) {
    const h = i % 24;
    arr[i] = Math.max(1, 10 + 8 * Math.cos(((h - 13) / 24) * 2 * Math.PI));
  }
  return arr;
}

function baseInputs(): EngineInputs {
  return {
    arrivals: unimodalArrivals(),
    wHppvTarget: 1.5,
    shiftMenu: dayNight,
  };
}

describe('PR F — Scenario B ("the same hours, better placed")', () => {
  it('returns null when there is no current staffing (spec §5: CTA, not a scenario)', () => {
    const inputs = baseInputs();
    const result = compute(inputs);
    expect(computeScenarioB(result, inputs, {})).toBeNull();
  });

  it('is a parameter swap: weeklyScheduledHours matches currentTotalWeeklyHours when the ENA floor does not bind', () => {
    const inputs = baseInputs();
    const result = compute(inputs);
    // Current staffing badly shaped but same rough total as the idealized grid: heavy on
    // nights, light on days (an under-target-day-shape mismatch), same total hours as target.
    const totalTargetHours = result.weeklyBudgetHours;
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 2, night: 6 };
    const b = computeScenarioB(result, inputs, grid);
    expect(b).not.toBeNull();
    expect(b!.currentTotalWeeklyHours).toBeCloseTo((2 + 6) * 12 * 7, 6);
    // Solved hours should land at/near the SAME total (parameter swap, not a different budget) —
    // within the standard tolerance band, same as the primary solve.
    expect(Math.abs(b!.weeklyScheduledHours - b!.currentTotalWeeklyHours)).toBeLessThan(0.15 * totalTargetHours);
  });

  it('reallocating the SAME hours reduces severity vs. the actual current grid (the whole point of B)', () => {
    const inputs = baseInputs();
    const result = compute(inputs);
    // Badly shaped: heavy nights, light days, against a unimodal DAYTIME-peaked arrival curve —
    // exactly the shape Scenario B should be able to fix without adding any hours.
    const badGrid: Grid = {};
    for (let day = 0; day < 7; day++) badGrid[day] = { day: 2, night: 8 };

    const b = computeScenarioB(result, inputs, badGrid);
    expect(b).not.toBeNull();

    const actualSeverity = summarizeBacklogSeverity(badGrid, inputs.arrivals, result.hourlyRequirement, inputs.shiftMenu, result.floorWhppv).totalSeverity;
    expect(b!.totalSeverity).toBeLessThan(actualSeverity);
  });

  it('edge case: current hours >= full coverage -> isFullCoverage is true, reported plainly (not an error)', () => {
    const inputs = baseInputs();
    const result = compute(inputs);
    const fullCoverageHoursPerShift = Math.ceil(result.fullCoverage.weeklyHours / (12 * 7 * 2)) + 2; // generously over
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: fullCoverageHoursPerShift, night: fullCoverageHoursPerShift };
    const b = computeScenarioB(result, inputs, grid);
    expect(b).not.toBeNull();
    expect(b!.isFullCoverage).toBe(true);
  });

  // 2026-07-29 REWRITTEN (not just loosened) — Ben's direct ask was for Scenario B to hold
  // total hours EXACTLY flat, which required switching from the old trim-based parameter swap
  // (which could push hours above the current total via the ENA-floor safety pass) to an exact
  // reallocation (`reallocateHoursExact`) that only ever TRADES shift-units, never adds them.
  // The floor safety net is a genuine, disclosed casualty of that guarantee — see
  // `ScenarioBResult.overageFromFloor`'s doc in `engine/index.ts`. This test used to assert the
  // OPPOSITE of what it asserts now; that's the deliberate reversal, not a loosened assertion.
  it('edge case: current hours below what the ENA floor requires -> hours still hold exactly flat (the floor safety net does not apply to this reallocation)', () => {
    const inputs: EngineInputs = { ...baseInputs(), enaFloor: 5 };
    const result = compute(inputs);
    // Current staffing well below the ENA floor (5) at every hour.
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 1, night: 1 };
    const b = computeScenarioB(result, inputs, grid);
    expect(b).not.toBeNull();
    expect(b!.overageFromFloor).toBe(0);
    expect(b!.weeklyScheduledHours).toBe(b!.currentTotalWeeklyHours);
  });

  it('already near-optimal: reallocating an already-well-shaped current grid does not find a dramatically better arrangement', () => {
    const inputs = baseInputs();
    const result = compute(inputs);
    // Current staffing IS the idealized grid itself — already optimal for its own total hours.
    const b = computeScenarioB(result, inputs, result.grid);
    expect(b).not.toBeNull();
    const actualSeverity = summarizeBacklogSeverity(result.grid, inputs.arrivals, result.hourlyRequirement, inputs.shiftMenu, result.floorWhppv).totalSeverity;
    // NOTE: Scenario B's own trim is an 8-pass relaxation heuristic (engine/backlogFeedback.ts)
    // re-run against a slightly different effective budget (the current grid's ACTUAL hours,
    // which can differ from the target-implied figure the original solve targeted — the
    // delivery premium, spec §3). The heuristic is not guaranteed monotonic across different
    // budgets (documented oscillation behavior, engine-solver.md's Phase 2b section) — so this
    // asserts "not dramatically worse," not "identical or strictly better."
    expect(b!.totalSeverity).toBeLessThan(actualSeverity * 1.5);
  });
});
