import { describe, expect, it } from 'vitest';
import { compute } from '../index';
import type { ShiftDef } from '../types';

function randomArrivals168(seedBase: number): number[] {
  const arr = new Array(168);
  for (let i = 0; i < 168; i++) {
    // deterministic pseudo-random, no real data, purely synthetic for testing
    const hourOfDay = i % 24;
    const base = hourOfDay >= 8 && hourOfDay <= 20 ? 6 : 2;
    arr[i] = base + ((i * 37 + seedBase) % 5);
  }
  return arr;
}

const shiftMenu: ShiftDef[] = [
  { id: 'day', label: '7a-7p', startHour: 7, lengthHours: 12 },
  { id: 'night', label: '7p-7a', startHour: 19, lengthHours: 12 },
];

describe('Section 2.2 reconciliation: sum(168-cell grid) x 52 == annual_core_rn_hours_budget', () => {
  it('reconciles exactly for a generic synthetic arrivals pattern', () => {
    const result = compute({
      arrivals: randomArrivals168(1),
      wHppvTarget: 0.5,
      shiftMenu,
    });
    expect(result.reconciliation.passes).toBe(true);
    expect(result.reconciliation.gapPct).toBeLessThan(1e-9);
  });

  it('reconciles exactly when acuity reweighting (ESI mix) is applied', () => {
    const arrivals = randomArrivals168(2);
    const esi12 = arrivals.map((a) => Math.round(a * 0.2));
    const esi45 = arrivals.map((a) => Math.round(a * 0.3));
    const esi3 = arrivals.map((a, i) => Math.max(0, a - esi12[i] - esi45[i]));
    const result = compute({
      arrivals,
      wHppvTarget: 0.6,
      shiftMenu,
      esiMix: { esi12, esi3, esi45 },
    });
    expect(result.esiConfidenceFlag).toBe(false);
    expect(result.reconciliation.passes).toBe(true);
  });

  it('reconciles exactly with a directly-entered annual visit count (not derived)', () => {
    const result = compute({
      arrivals: randomArrivals168(3),
      annualVisits: 40000,
      wHppvTarget: 0.45,
      shiftMenu,
    });
    expect(result.reconciliation.annualBudget).toBeCloseTo(40000 * 0.45, 6);
    expect(result.reconciliation.passes).toBe(true);
  });

  it('smoothing weights preserve the annual total exactly (Section 1c claim)', () => {
    const result = compute({
      arrivals: randomArrivals168(4),
      wHppvTarget: 0.5,
      shiftMenu,
      smoothingWeights: { center: 0.6, neighbor: 0.2 },
    });
    expect(result.reconciliation.passes).toBe(true);
  });

  it('derives annual visits from arrivals when not entered directly', () => {
    const arrivals = randomArrivals168(5);
    const expectedAnnual = arrivals.reduce((a, b) => a + b, 0) * 52;
    const result = compute({ arrivals, wHppvTarget: 0.5, shiftMenu });
    expect(result.annualVisits).toBeCloseTo(expectedAnnual, 6);
  });
});
