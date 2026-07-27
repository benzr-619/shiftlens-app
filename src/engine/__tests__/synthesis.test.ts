import { describe, expect, it } from 'vitest';
import { compute, computeSynthesis } from '../index';
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
  return {
    arrivals: unimodalArrivals(),
    wHppvTarget: 1.5,
    shiftMenu: dayNight,
    ...overrides,
  };
}

describe('PR G — synthesis (§7): four numbers and a subtraction, no verdict', () => {
  it('returns null with no current staffing (CTA, not a synthesis)', () => {
    const inputs = baseInputs();
    const result = compute(inputs);
    expect(computeSynthesis(result, inputs, {})).toBeNull();
  });

  it('ending 1 — "you need more": current hours well below total demand -> positive gapHours', () => {
    const inputs = baseInputs({
      admitRate: 0.2,
      boardingDuration: 5,
    });
    const result = compute(inputs);
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 2, night: 2 };
    const synthesis = computeSynthesis(result, inputs, grid);
    expect(synthesis).not.toBeNull();
    expect(synthesis!.gapHours).toBeGreaterThan(0);
    expect(synthesis!.gapFte).toBeGreaterThan(0);
    expect(synthesis!.boardingDataPresent).toBe(true);
    expect(synthesis!.dayShareOfShortfallPct).not.toBeNull();
    expect(synthesis!.gapClosedByReallocationHours).toBeGreaterThanOrEqual(0);
    expect(synthesis!.gapClosedByReallocationHours).toBeLessThanOrEqual(synthesis!.gapHours);
  });

  it('ending 2 — "you have enough, they\'re in the wrong places": current hours meet total demand but badly shaped -> gapHours <= 0', () => {
    const inputs = baseInputs();
    const result = compute(inputs);
    // Current staffing has plenty of TOTAL hours (well above target-implied) but flat/badly shaped.
    const grid: Grid = {};
    const bigHeadcount = Math.ceil((result.weeklyBudgetHours * 2) / (12 * 7 * 2));
    for (let day = 0; day < 7; day++) grid[day] = { day: bigHeadcount, night: bigHeadcount };
    const synthesis = computeSynthesis(result, inputs, grid);
    expect(synthesis).not.toBeNull();
    expect(synthesis!.gapHours).toBeLessThanOrEqual(0);
    // Nothing to close when there's no positive gap.
    expect(synthesis!.gapClosedByReallocationHours).toBe(0);
  });

  it('ending 3 — "you\'re in good shape": no boarding data, current hours closely track arrivals need', () => {
    const inputs = baseInputs(); // no admitRate/boardingDuration -> boarding absent
    const result = compute(inputs);
    const synthesis = computeSynthesis(result, inputs, result.grid); // current == idealized grid itself
    expect(synthesis).not.toBeNull();
    expect(synthesis!.boardingDataPresent).toBe(false);
    expect(synthesis!.boardingWeeklyHours).toBeNull();
    // totalDemandWeeklyHours degrades to arrivals-only when boarding is absent.
    expect(synthesis!.totalDemandWeeklyHours).toBeCloseTo(synthesis!.arrivalsWeeklyHours, 6);
  });

  it('every field stays finite and non-NaN across a badly-shaped-with-boarding scenario', () => {
    const inputs = baseInputs({ admitRate: 0.15, boardingDuration: 4 });
    const result = compute(inputs);
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 1, night: 6 };
    const synthesis = computeSynthesis(result, inputs, grid);
    expect(synthesis).not.toBeNull();
    for (const [key, value] of Object.entries(synthesis!)) {
      if (typeof value === 'number') expect(Number.isFinite(value), `${key} should be finite`).toBe(true);
    }
  });
});
