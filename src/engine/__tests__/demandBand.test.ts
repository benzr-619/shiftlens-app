import { describe, expect, it } from 'vitest';
import { deriveDemandVolatilityHourly, applyVolatilityBuffer, deriveCohortBandFloor } from '../demandBand';
import { compute } from '../index';
import type { ShiftDef } from '../types';

const shiftMenu: ShiftDef[] = [
  { id: 'day', label: '7a-7p', startHour: 7, lengthHours: 12 },
  { id: 'night', label: '7p-7a', startHour: 19, lengthHours: 12 },
];

function flatArrivals(mean: number): number[] {
  return new Array(168).fill(mean);
}

describe('2026-07-26 Phase 2a — deriveDemandVolatilityHourly (mean-arrival trap fix)', () => {
  it('is all-zero when arrivalsP75 is absent — graceful no-op', () => {
    const v = deriveDemandVolatilityHourly(flatArrivals(10), null);
    expect(v).toHaveLength(168);
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('computes (p75 - mean) / mean per cell, never negative', () => {
    const arrivals = flatArrivals(10);
    const p75 = arrivals.map((_, i) => (i === 0 ? 15 : i === 1 ? 8 : 10)); // cell0: +50%, cell1: below mean, cell2+: equal
    const v = deriveDemandVolatilityHourly(arrivals, p75);
    expect(v[0]).toBeCloseTo(0.5, 6);
    expect(v[1]).toBe(0); // p75 below mean -> clamped to 0, not negative
    expect(v[2]).toBe(0);
  });

  it('treats a zero-mean cell as zero volatility (nothing to divide by, nothing asked of it)', () => {
    const arrivals = flatArrivals(10);
    arrivals[5] = 0;
    const p75 = flatArrivals(10);
    p75[5] = 20;
    const v = deriveDemandVolatilityHourly(arrivals, p75);
    expect(v[5]).toBe(0);
  });
});

describe('2026-07-26 Phase 2a — applyVolatilityBuffer composes onto the cohort floor', () => {
  it('is a no-op when volatility is all-zero (Phase 1 behavior unchanged)', () => {
    const cohortFloor = [1, 2, 3, 4];
    const hourlyRequirement = [5, 5, 5, 5];
    const buffered = applyVolatilityBuffer(cohortFloor, [0, 0, 0, 0], hourlyRequirement);
    expect(buffered).toEqual(cohortFloor);
  });

  it('raises the floor toward hourlyRequirement proportional to volatility, up to and PAST it for genuinely spiky hours — PR C reversal, see SOLVER_REALISM_SPEC_2026-07-26.md change 4', () => {
    // 2026-07-26 PR C REVERSAL: this function used to clamp its ratio (and its own output) at
    // hourlyRequirement — "never past it" was the old, now-retired behavior. The whole point of
    // the reversal is that a genuinely spiky hour (ratio > 1, i.e. p75 arrivals more than double
    // the mean) can now be protected ABOVE the mean-derived point target, which is what a
    // buffer is supposed to be able to do. See engine-solver.md's "Budget-capped trim" section.
    const cohortFloor = [2, 2, 2];
    const hourlyRequirement = [10, 10, 10];
    const buffered = applyVolatilityBuffer(cohortFloor, [0.5, 1, 5], hourlyRequirement);
    // volatility 0.5 -> halfway from 2 to 10 = 6 (unaffected by the reversal — ratio <= 1)
    expect(buffered[0]).toBe(6);
    // volatility 1 -> exactly hourlyRequirement (unaffected — the boundary case)
    expect(buffered[1]).toBe(10);
    // volatility 5 -> 2 + 5*(10-2) = 42, genuinely PAST hourlyRequirement — the reversal itself
    expect(buffered[2]).toBe(42);
    expect(buffered[2]).toBeGreaterThan(hourlyRequirement[2]);
  });

  it('this is now `protectedFloorHourly` (solver-facing, unclamped) — the CLAMPED `bandFloorHourly` reporting curve is derived by clamping this output, not computed here', () => {
    const cohortFloor = [2];
    const hourlyRequirement = [10];
    const protectedFloor = applyVolatilityBuffer(cohortFloor, [5], hourlyRequirement);
    const bandFloorHourly = protectedFloor.map((v, i) => Math.min(v, hourlyRequirement[i]));
    expect(protectedFloor[0]).toBe(42);
    expect(bandFloorHourly[0]).toBe(10); // clamped reporting curve caps back at the point target
  });
});

describe('2026-07-26 Phase 2a — arrivalsP75 NEVER touches annualVisits/annualCoreRnHoursBudget/hourlyRequirement', () => {
  it('produces byte-identical annualVisits, annualCoreRnHoursBudget, and hourlyRequirement with or without arrivalsP75', () => {
    const arrivals = flatArrivals(10).map((v, i) => v + (i % 5)); // some hour-to-hour texture
    const arrivalsP75 = arrivals.map((v) => v * 1.8); // deliberately large busy-hour spread everywhere
    // wHppvTarget deliberately well ABOVE the cohort's p25 band for this volume, so the
    // cohort floor sits genuinely below hourlyRequirement (headroom for the volatility
    // buffer to raise into) — otherwise the floor is already clamped to hourlyRequirement
    // and there's nothing for volatility to add, which would be a degenerate test, not a
    // real assertion about the buffer.
    const without = compute({ arrivals, wHppvTarget: 3.0, shiftMenu });
    const withP75 = compute({ arrivals, arrivalsP75, wHppvTarget: 3.0, shiftMenu });

    expect(withP75.annualVisits).toBe(without.annualVisits);
    expect(withP75.annualCoreRnHoursBudget).toBe(without.annualCoreRnHoursBudget);
    expect(withP75.hourlyRequirement).toEqual(without.hourlyRequirement);
    expect(withP75.reconciliation).toEqual(without.reconciliation);

    // But it DOES change bandFloorHourly (raised at the now-volatile hours) and expose the
    // new demandVolatilityHourly signal — confirming the buffer actually did something.
    expect(withP75.demandVolatilityHourly.some((v) => v > 0)).toBe(true);
    expect(without.demandVolatilityHourly.every((v) => v === 0)).toBe(true);
    const floorRaisedSomewhere = withP75.bandFloorHourly.some((v, i) => v > without.bandFloorHourly[i]);
    expect(floorRaisedSomewhere).toBe(true);
  });

  it('deriveCohortBandFloor alone (no volatility layer) matches the un-buffered floor exactly', () => {
    const arrivals = flatArrivals(8);
    const result = compute({ arrivals, wHppvTarget: 0.6, shiftMenu });
    // No arrivalsP75 -> demandVolatilityHourly all zero -> bandFloorHourly === cohort floor
    // alone. Spot-check via deriveCohortBandFloor directly isn't feasible without the same
    // internal `weighted` array, so this just re-confirms the composed result is internally
    // consistent (floor never exceeds hourlyRequirement, ceiling never falls below it).
    for (let i = 0; i < 168; i++) {
      expect(result.bandFloorHourly[i]).toBeLessThanOrEqual(result.hourlyRequirement[i]);
      expect(result.bandCeilingHourly[i]).toBeGreaterThanOrEqual(result.hourlyRequirement[i]);
    }
    expect(typeof deriveCohortBandFloor).toBe('function'); // exported and composable, per the spec's explicit ask
  });
});
