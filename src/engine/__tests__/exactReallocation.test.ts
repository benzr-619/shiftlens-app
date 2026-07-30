import { describe, expect, it } from 'vitest';
import { reallocateHoursExact } from '../exactReallocation';
import { fullWeekCapacity, totalSeverity } from '../solver';
import type { Grid, ShiftDef } from '../types';

function totalWeeklyHours(grid: Grid, shiftMenu: ShiftDef[]): number {
  let total = 0;
  for (let day = 0; day < 7; day++) {
    for (const s of shiftMenu) total += (grid[day]?.[s.id] ?? 0) * s.lengthHours;
  }
  return total;
}

function unimodalArrivals(): number[] {
  const arr = new Array(168);
  for (let i = 0; i < 168; i++) {
    const h = i % 24;
    arr[i] = Math.max(1, 10 + 8 * Math.cos(((h - 13) / 24) * 2 * Math.PI));
  }
  return arr;
}

const FLAT_REQUIREMENT = new Array(168).fill(10);
const FLOOR_WHPPV = 1.5;

describe('reallocateHoursExact — exact-hours-conserving reallocation (Panel 2, 2026-07-29)', () => {
  it('conserves total scheduled hours EXACTLY for equal-length shifts', () => {
    const dayNight: ShiftDef[] = [
      { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 },
      { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 },
    ];
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 2, night: 8 }; // badly shaped
    const before = totalWeeklyHours(grid, dayNight);

    const { grid: after } = reallocateHoursExact(grid, dayNight, unimodalArrivals(), FLAT_REQUIREMENT, FLOOR_WHPPV);
    expect(totalWeeklyHours(after, dayNight)).toBeCloseTo(before, 9);
  });

  it('conserves total scheduled hours EXACTLY for a shift menu with unequal lengths (8h/12h)', () => {
    const mixed: ShiftDef[] = [
      { id: 'day8', label: 'Day', startHour: 7, lengthHours: 8 },
      { id: 'eve8', label: 'Evening', startHour: 15, lengthHours: 8 },
      { id: 'night12', label: 'Night', startHour: 19, lengthHours: 12 },
    ];
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day8: 3, eve8: 3, night12: 4 };
    const before = totalWeeklyHours(grid, mixed);

    const { grid: after } = reallocateHoursExact(grid, mixed, unimodalArrivals(), FLAT_REQUIREMENT, FLOOR_WHPPV);
    expect(totalWeeklyHours(after, mixed)).toBeCloseTo(before, 9);
  });

  it('strictly improves (or at worst matches) total severity for a badly-shaped current grid', () => {
    const dayNight: ShiftDef[] = [
      { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 },
      { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 },
    ];
    // Night-heavy against a daytime-peaked arrivals curve — exactly the shape this reallocation
    // should be able to fix without changing total hours at all.
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 2, night: 8 };
    const arrivals = unimodalArrivals();

    const scoreOf = (g: Grid) => {
      const capacity = fullWeekCapacity(g, dayNight);
      return totalSeverity(capacity.map((_c, i) => Math.max(0, FLAT_REQUIREMENT[i] - capacity[i])), FLAT_REQUIREMENT);
    };
    const before = scoreOf(grid);

    const { grid: after, swapsApplied } = reallocateHoursExact(grid, dayNight, arrivals, FLAT_REQUIREMENT, FLOOR_WHPPV);
    expect(swapsApplied).toBeGreaterThan(0);
    expect(scoreOf(after)).toBeLessThan(before);
  });

  it('finds no improving trade (swapsApplied 0) when the grid is already a local optimum', () => {
    const dayNight: ShiftDef[] = [
      { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 },
      { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 },
    ];
    // A perfectly flat, already-uniform grid against a flat requirement/arrivals curve has
    // nothing to gain by trading hours between days or shifts.
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 5, night: 5 };
    const flatArrivals = new Array(168).fill(6);

    const { swapsApplied } = reallocateHoursExact(grid, dayNight, flatArrivals, FLAT_REQUIREMENT, FLOOR_WHPPV);
    expect(swapsApplied).toBe(0);
  });

  it('degenerate case: a single-shift menu still allows cross-day reallocation (same-shift trades)', () => {
    const single: ShiftDef[] = [{ id: 'round', label: 'Round the clock', startHour: 0, lengthHours: 24 }];
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { round: day === 0 ? 10 : 4 }; // way overstaffed on day 0 only
    const before = totalWeeklyHours(grid, single);

    const { grid: after, swapsApplied } = reallocateHoursExact(grid, single, unimodalArrivals(), FLAT_REQUIREMENT, FLOOR_WHPPV);
    expect(totalWeeklyHours(after, single)).toBeCloseTo(before, 9);
    // A single 24h shift means every day is identical in shape (one shift covers the whole
    // day), so the only lever is cross-day headcount trades — confirm at least one fires.
    expect(swapsApplied).toBeGreaterThan(0);
  });
});
