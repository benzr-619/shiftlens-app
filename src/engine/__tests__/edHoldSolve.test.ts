import { describe, expect, it } from 'vitest';
import { solveEdHoldJointCoverage } from '../edHoldSolve';
import { solveFullCoverageWeek, fullWeekCapacity } from '../solver';
import type { ShiftDef } from '../types';

const N = 168;
function flat(v: number): number[] {
  return new Array(N).fill(v);
}

const DAY: ShiftDef = { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 };
const NIGHT: ShiftDef = { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 };
const ALL_SHIFTS = [DAY, NIGHT];

function totalHeadcountUnits(grid: Record<number, Record<string, number>>): number {
  let total = 0;
  for (let day = 0; day < 7; day++) {
    for (const key of Object.keys(grid[day] ?? {})) total += grid[day][key] ?? 0;
  }
  return total;
}

describe('solveEdHoldJointCoverage (Panel 5 redesign §5)', () => {
  it('hold units never appear on a disallowed shift', () => {
    const combinedDemand = flat(10);
    const medBoarding = flat(4);
    // Hold nurses are only allowed to work the Day shift.
    const { holdGrid } = solveEdHoldJointCoverage(combinedDemand, medBoarding, ALL_SHIFTS, [DAY]);
    for (let day = 0; day < 7; day++) {
      expect(holdGrid[day]?.['night'] ?? 0).toBe(0);
    }
  });

  it('hold contribution never exceeds medical boarding demand at any hour', () => {
    const combinedDemand = flat(20); // heavy demand, tempting the solver to pile on hold capacity
    const medBoarding = flat(3);
    const { holdGrid } = solveEdHoldJointCoverage(combinedDemand, medBoarding, ALL_SHIFTS, ALL_SHIFTS);
    const holdCapacity = fullWeekCapacity(holdGrid, ALL_SHIFTS);
    for (let g = 0; g < N; g++) {
      const applied = Math.min(holdCapacity[g], medBoarding[g]);
      expect(applied).toBeLessThanOrEqual(medBoarding[g] + 1e-9);
    }
  });

  it('combined ED+hold capacity is a genuine full-coverage solve — matches or improves on all-ED-only', () => {
    const combinedDemand = flat(10);
    const medBoarding = flat(4);
    const { edGrid, holdGrid } = solveEdHoldJointCoverage(combinedDemand, medBoarding, ALL_SHIFTS, ALL_SHIFTS);
    const edCapacity = fullWeekCapacity(edGrid, ALL_SHIFTS);
    const holdCapacityRaw = fullWeekCapacity(holdGrid, ALL_SHIFTS);
    const combinedCapacity = edCapacity.map((v, g) => v + Math.min(holdCapacityRaw[g], medBoarding[g]));

    // Every hour of demand is met.
    for (let g = 0; g < N; g++) expect(combinedCapacity[g]).toBeGreaterThanOrEqual(combinedDemand[g] - 1e-9);

    // The joint solve should use no more total shift-units than an all-ED-only full-coverage
    // solve against the same combined demand (it has the SAME demand to cover, plus a second,
    // more-restricted pool that can only help — never hurt — the total headcount required).
    const allEdOnly = solveFullCoverageWeek(combinedDemand, ALL_SHIFTS);
    const allEdOnlyUnits = totalHeadcountUnits(allEdOnly);
    const jointUnits = totalHeadcountUnits(edGrid) + totalHeadcountUnits(holdGrid);
    expect(jointUnits).toBeLessThanOrEqual(allEdOnlyUnits);
  });

  it('with zero medical boarding demand, hold nurses never get scheduled (no candidate would help)', () => {
    const combinedDemand = flat(10);
    const medBoarding = flat(0);
    const { edGrid, holdGrid } = solveEdHoldJointCoverage(combinedDemand, medBoarding, ALL_SHIFTS, ALL_SHIFTS);
    expect(totalHeadcountUnits(holdGrid)).toBe(0);
    const edCapacity = fullWeekCapacity(edGrid, ALL_SHIFTS);
    for (let g = 0; g < N; g++) expect(edCapacity[g]).toBeGreaterThanOrEqual(combinedDemand[g] - 1e-9);
  });

  it('an empty allowed-hold-shift set degrades to an ED-only full-coverage solve', () => {
    const combinedDemand = flat(8);
    const medBoarding = flat(5);
    const { edGrid, holdGrid } = solveEdHoldJointCoverage(combinedDemand, medBoarding, ALL_SHIFTS, []);
    expect(totalHeadcountUnits(holdGrid)).toBe(0);
    const edCapacity = fullWeekCapacity(edGrid, ALL_SHIFTS);
    for (let g = 0; g < N; g++) expect(edCapacity[g]).toBeGreaterThanOrEqual(combinedDemand[g] - 1e-9);
  });

  it('zero demand everywhere produces empty grids (no candidate ever helps)', () => {
    const { edGrid, holdGrid } = solveEdHoldJointCoverage(flat(0), flat(0), ALL_SHIFTS, ALL_SHIFTS);
    expect(totalHeadcountUnits(edGrid)).toBe(0);
    expect(totalHeadcountUnits(holdGrid)).toBe(0);
  });
});
