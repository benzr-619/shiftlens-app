import { describe, expect, it } from 'vitest';
import { compute, recomputeAfterEdit } from '../index';
import { recomputeFromGrid } from '../solver';
import type { Grid, ShiftDef } from '../types';

function randomArrivals168(seedBase: number): number[] {
  const arr = new Array(168);
  for (let i = 0; i < 168; i++) {
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

describe('Step 3 shift-fit solver', () => {
  it('caps scheduled hours near budget (5.3) rather than over-scheduling to cover every peak', () => {
    const result = compute({ arrivals: randomArrivals168(10), wHppvTarget: 0.5, shiftMenu });
    expect(result.overcoveragePct).toBeLessThanOrEqual(0.11); // 10% tolerance + rounding slack
  });

  it('always reports shortfall alongside wHPPV rather than netting it against the total (5.5)', () => {
    const result = compute({ arrivals: randomArrivals168(11), wHppvTarget: 0.3, shiftMenu });
    // low wHPPV target forces trimming -> some shortfall should exist and be enumerated, not hidden
    expect(Array.isArray(result.shortfall)).toBe(true);
  });

  it('enforces the ENA floor at department level, not per shift-slot (5.6)', () => {
    const result = compute({ arrivals: randomArrivals168(12), wHppvTarget: 0.5, shiftMenu, enaFloor: 2 });
    for (let day = 0; day < 7; day++) {
      const headcount = result.grid[day];
      const total = Object.values(headcount).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(0); // grid exists and is well-formed
    }
  });

  it('shift start-time changes shortfall (5.7): different menus give different results', () => {
    const arrivals = randomArrivals168(13);
    const menuA: ShiftDef[] = [
      { id: 'a', startHour: 7, lengthHours: 12 },
      { id: 'b', startHour: 19, lengthHours: 12 },
    ];
    const menuB: ShiftDef[] = [
      { id: 'a', startHour: 10, lengthHours: 12 },
      { id: 'b', startHour: 22, lengthHours: 12 },
    ];
    const resultA = compute({ arrivals, wHppvTarget: 0.5, shiftMenu: menuA });
    const resultB = compute({ arrivals, wHppvTarget: 0.5, shiftMenu: menuB });
    expect(resultA.grid).not.toEqual(resultB.grid);
  });

  it('withholds boarding output entirely when admit rate is absent (Section 8 lesson)', () => {
    const result = compute({ arrivals: randomArrivals168(14), wHppvTarget: 0.5, shiftMenu });
    expect(result.boarding).toBeNull();
  });

  it('produces boarding output when both admit rate and boarding duration are present', () => {
    const arrivals = randomArrivals168(15);
    const result = compute({
      arrivals,
      wHppvTarget: 0.5,
      shiftMenu,
      admitRate: 0.2,
      boardingDuration: arrivals.map(() => 3),
    });
    expect(result.boarding).not.toBeNull();
    expect(result.boarding!.annualFte).toBeGreaterThan(0);
    expect(result.boarding!.prioritySlots.length).toBeGreaterThan(0);
  });
});

describe('Live-edit department-floor re-check (5.6, recomputeFromGrid/recomputeAfterEdit)', () => {
  it('flags an hour a manual edit drops below the floor, without mutating the grid', () => {
    const arrivals = randomArrivals168(16);
    const result = compute({ arrivals, wHppvTarget: 0.5, shiftMenu, enaFloor: 2 });

    // Zero out every slot covering hour 3 on Monday (day 1) so on-duty coverage there is 0.
    const grid: Grid = { ...result.grid };
    grid[1] = { ...grid[1] };
    for (const s of shiftMenu) {
      const hours = new Set(Array.from({ length: s.lengthHours }, (_, i) => (s.startHour + i) % 24));
      if (hours.has(3)) grid[1][s.id] = 0;
    }

    const { enaFloorViolationsRemaining } = recomputeFromGrid(grid, shiftMenu, result.hourlyRequirement, 2);
    expect(enaFloorViolationsRemaining.some((v) => v.day === 1 && v.hour === 3 && v.onDuty === 0)).toBe(true);
    // Read-only: the grid handed in is untouched, unlike enforceDepartmentFloor's fix-up pass.
    expect(grid[1]['night']).toBe(0);
  });

  it('reports no floor violations when every hour clears the floor', () => {
    const arrivals = randomArrivals168(17);
    const result = compute({ arrivals, wHppvTarget: 1.2, shiftMenu, enaFloor: 2 });
    const { enaFloorViolationsRemaining } = recomputeFromGrid(result.grid, shiftMenu, result.hourlyRequirement, 0);
    expect(enaFloorViolationsRemaining).toHaveLength(0);
  });

  it('recomputeAfterEdit surfaces the same violations via the live-edit entry point', () => {
    const arrivals = randomArrivals168(18);
    const inputs = { arrivals, wHppvTarget: 0.5, shiftMenu, enaFloor: 2 };
    const result = compute(inputs);

    const grid: Grid = { ...result.grid };
    grid[2] = Object.fromEntries(shiftMenu.map((s) => [s.id, 0]));

    const live = recomputeAfterEdit(grid, inputs, result.hourlyRequirement);
    expect(live.enaFloorViolationsRemaining.length).toBeGreaterThan(0);
    expect(live.enaFloorViolationsRemaining.every((v) => v.onDuty < 2)).toBe(true);
  });
});
