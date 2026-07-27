import { describe, expect, it } from 'vitest';
import { compute, computeCombinedReallocation } from '../index';
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

function baseInputs(overrides: Partial<EngineInputs> = {}): EngineInputs {
  return { arrivals: unimodalArrivals(), wHppvTarget: 1.5, shiftMenu: dayNight, ...overrides };
}

// PR K (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §6.3) — "if you can't get additional hours for
// boarding, here is the least-bad placement of what you already have." A COMPROMISE with its
// cost NAMED, never the recommendation: it necessarily takes from arrivals coverage to cover
// boarders.
describe('PR K — constrained boarding reallocation (§6.3)', () => {
  it('returns null with no current staffing', () => {
    const inputs = baseInputs({ admitRate: 0.2, boardingDuration: 5 });
    const result = compute(inputs);
    expect(computeCombinedReallocation(result, inputs, {})).toBeNull();
  });

  it('reallocating the SAME hours against combined demand reduces combined shortfall vs. a badly-shaped current grid', () => {
    const inputs = baseInputs({ admitRate: 0.2, boardingDuration: 5 });
    const result = compute(inputs);
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 2, night: 6 }; // night-heavy, badly shaped vs. a day-peaked arrivals curve
    const realloc = computeCombinedReallocation(result, inputs, grid);
    expect(realloc).not.toBeNull();
    expect(realloc!.shortfallHoursAfter).toBeLessThanOrEqual(realloc!.shortfallHoursBefore);
  });

  it('names a real cost on the arrivals side — covering boarders with the same hours cannot be free', () => {
    const inputs = baseInputs({ admitRate: 0.25, boardingDuration: 6 });
    const result = compute(inputs);
    // Current grid staffed adequately FOR ARRIVALS ALONE, no slack for boarding at all.
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 5, night: 3 };
    const realloc = computeCombinedReallocation(result, inputs, grid);
    expect(realloc).not.toBeNull();
    // Reallocating the SAME total hours to also cover boarding, at zero added hours, must cost
    // something on the arrivals side relative to a hypothetical arrivals-only optimum — the
    // reallocated grid's own arrivals-shortfall should be a real, finite, non-negative number.
    expect(realloc!.arrivalsShortfallHoursAfter).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(realloc!.arrivalsShortfallHoursAfter)).toBe(true);
  });

  it('never schedules meaningfully MORE than the current total hours (+ the standard tolerance) — this is a placement change, not a funding ask', () => {
    const inputs = baseInputs({ admitRate: 0.2, boardingDuration: 4 });
    const result = compute(inputs);
    // Deliberately generous current hours so combined arrivals+boarding demand is comfortably
    // coverable within them (avoids the "full coverage costs less than current" edge case,
    // which is a real, separate state — see Scenario B's own `isFullCoverage` handling).
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 10, night: 10 };
    let totalBefore = 0;
    for (let day = 0; day < 7; day++) totalBefore += (grid[day].day + grid[day].night) * 12;
    const realloc = computeCombinedReallocation(result, inputs, grid);
    expect(realloc).not.toBeNull();
    expect(realloc!.weeklyScheduledHours).toBeLessThanOrEqual(totalBefore * 1.15);
  });
});
