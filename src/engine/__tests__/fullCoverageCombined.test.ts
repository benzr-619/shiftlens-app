import { describe, expect, it } from 'vitest';
import { compute } from '../index';
import type { EngineInputs } from '../types';

// PR B (RESULTS_PAGE_V2_SPEC_2026-07-27.md §5.3) — Panel 3's full-coverage-over-combined-demand
// ceiling. Reuses solveFullCoverageWeek verbatim (no second solver); no engine changes to
// annualVisits/annualCoreRnHoursBudget/hourlyRequirement/reconciliation.

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

describe('PR B — fullCoverageCombined (§5.3)', () => {
  it('degenerately equals the arrivals-only fullCoverage when boarding is absent', () => {
    const result = compute(baseInputs());
    expect(result.boarding).toBeNull();
    expect(result.fullCoverageCombined.weeklyHours).toBeCloseTo(result.fullCoverage.weeklyHours, 6);
  });

  it('is strictly greater than the arrivals-only ceiling when boarding demand is present', () => {
    const result = compute(baseInputs({ admitRate: 0.25, boardingDuration: 6 }));
    expect(result.boarding).not.toBeNull();
    expect(result.fullCoverageCombined.weeklyHours).toBeGreaterThan(result.fullCoverage.weeklyHours);
  });

  it('the combined grid covers the combined demand curve with zero shortfall anywhere', () => {
    const inputs = baseInputs({ admitRate: 0.25, boardingDuration: 6 });
    const result = compute(inputs);
    const combinedRequirement = result.hourlyRequirement.map((v, i) => v + (result.boarding ? result.boarding.cellBoardingRnHours[i] : 0));
    // Reconstruct capacity from the returned grid the same way the engine does, and confirm
    // it never falls short of the combined curve at any of the 168 hours.
    const shiftGlobalHours = (day: number, shift: (typeof dayNight)[number]) =>
      Array.from({ length: shift.lengthHours }, (_, i) => (day * 24 + shift.startHour + i) % 168);
    const capacity = new Array(168).fill(0);
    for (let day = 0; day < 7; day++) {
      for (const shift of dayNight) {
        const hc = result.fullCoverageCombined.grid[day]?.[shift.id] ?? 0;
        for (const g of shiftGlobalHours(day, shift)) capacity[g] += hc;
      }
    }
    for (let h = 0; h < 168; h++) {
      expect(capacity[h]).toBeGreaterThanOrEqual(combinedRequirement[h] - 1e-9);
    }
  });

  it('never touches annualVisits/annualCoreRnHoursBudget/hourlyRequirement/reconciliation', () => {
    const inputsNoBoarding = baseInputs();
    const inputsBoarding = baseInputs({ admitRate: 0.25, boardingDuration: 6 });
    const a = compute(inputsNoBoarding);
    const b = compute(inputsBoarding);
    expect(a.annualVisits).toBeCloseTo(b.annualVisits, 6);
    expect(a.annualCoreRnHoursBudget).toBeCloseTo(b.annualCoreRnHoursBudget, 6);
    expect(a.hourlyRequirement).toEqual(b.hourlyRequirement);
    expect(a.reconciliation.passes).toBe(true);
    expect(b.reconciliation.passes).toBe(true);
  });
});
