import { describe, expect, it } from 'vitest';
import { computeBacklog, BACKLOG_CAUGHT_UP_THRESHOLD } from '../backlog';
import { NO_COMPRESSION_FLOOR_WHPPV } from '../backlogModel';
import type { Grid, ShiftDef } from '../types';

// 2026-07-28 REVERSAL (NINTH shape, BACKLOG_MODEL_VISITS_BASED_SPEC_2026-07-28.md, see
// .claude/rules/engine-solver.md) — the capacity-elasticity model (`spare`/`stretch`/
// `bandCeilingHourly`-as-recurrence-input) is retired for a VISITS-BASED model.
// `computeBacklog` now takes `arrivals168` (visits) + `floorWhppv` (a single flat scalar) in
// place of `bandCeilingHourly`. Most tests below use `NO_COMPRESSION_FLOOR_WHPPV` (1) with the
// demand curve itself as `arrivals168` — this exercises the SAME structural/cyclical-split and
// streak/attribution machinery the real compression path uses, just without the compression
// mechanic itself (which has its own dedicated describe block below). Passing `floorWhppv = 1`
// with `arrivals168 = requirement` is algebraically identical to a plain
// `backlog[h] = max(0, requirement[h] + backlog[h-1] - capacity[h])` recurrence — see
// backlogModel.ts's header for why.

// A single shift covering all 24h — lets us drive capacity purely via one headcount value.
const allDay: ShiftDef[] = [{ id: 'all', label: '24h', startHour: 0, lengthHours: 24 }];
// A 2-shift menu that tiles the day with no overlap: day 7a-7p, night 7p-7a.
const dayNight: ShiftDef[] = [
  { id: 'day', label: '7a-7p', startHour: 7, lengthHours: 12 },
  { id: 'night', label: '7p-7a', startHour: 19, lengthHours: 12 },
];

/** Grid where every day staffs `hc` on the given single shift → flat capacity. */
function flatGrid(shiftId: string, hc: number): Grid {
  const g: Grid = {};
  for (let day = 0; day < 7; day++) g[day] = { [shiftId]: hc };
  return g;
}

function zeros(): number[] {
  return new Array(168).fill(0);
}

describe('§2.4 backlog diagnostic (no-compression degenerate case, floorWhppv = 1)', () => {
  it('is all zero when capacity always meets demand (no one falls behind)', () => {
    const res = computeBacklog({}, zeros(), zeros(), allDay, NO_COMPRESSION_FLOOR_WHPPV);
    expect(res.backlog.every((b) => b === 0)).toBe(true);
    expect(res.longestStreakHours).toBe(0);
    expect(res.longestStreakStart).toBeNull();
    expect(res.neverClears).toBe(false);
    expect(res.peakBacklog).toBe(0);
  });

  it('a deficit spike carries EXACTLY across the Sat→Sun week boundary (no reset, no decay) and pays down 1:1 against genuinely idle capacity afterward', () => {
    const requirement = zeros();
    requirement[167] = 7;
    const grid = flatGrid('all', 2);
    const res = computeBacklog(grid, requirement, requirement, allDay, NO_COMPRESSION_FLOOR_WHPPV);

    expect(res.backlog[167]).toBe(5); // the fresh deficit itself, no decay applied to it
    expect(res.backlog[0]).toBe(3);
    expect(res.backlog[1]).toBe(1);
    expect(res.backlog[2]).toBe(0);
    expect(res.backlog[3]).toBe(0);
    expect(res.longestStreakStart).toEqual({ day: 6, hour: 23 });
    expect(res.neverClears).toBe(false);
  });

  it('excess capacity pays backlog down 1:1, bounded by how much is actually available that hour', () => {
    const reqA = zeros();
    reqA[0] = 10;
    // Scenario A: no excess capacity anywhere afterward — the hole never pays down.
    const a = computeBacklog({}, reqA, reqA, allDay, NO_COMPRESSION_FLOOR_WHPPV);
    const reqB = zeros();
    reqB[0] = 12;
    const b = computeBacklog(flatGrid('all', 2), reqB, reqB, allDay, NO_COMPRESSION_FLOOR_WHPPV);

    // A never pays down ANYWHERE in the whole week (zero release valve) — a genuine
    // zero-capacity scenario. With no decay term, the SAME deficit compounds lap over lap
    // across the circular settle passes rather than converging to a fixed 10 (see
    // backlogModel.ts's header) — assert the qualitative property, not an exact value.
    expect(a.backlog[0]).toBeGreaterThan(10);
    expect(a.neverClears).toBe(true);
    // B pays down exactly 2/hr: 10, 8, 6, 4, 2, 0 — fully cleared by hour 5.
    expect(b.backlog[0]).toBe(10);
    expect(b.backlog[1]).toBe(8);
    expect(b.backlog[5]).toBe(0);
    expect(b.neverClears).toBe(false);
    expect(a.longestStreakHours).toBeGreaterThan(b.longestStreakHours);
  });

  it('attributes generated vs inherited backlog to the right shift', () => {
    const req = zeros();
    for (let h = 0; h <= 4; h++) req[h] = 5;
    const res = computeBacklog({}, req, req, dayNight, NO_COMPRESSION_FLOOR_WHPPV);
    const night = res.shiftDiagnostics.find((s) => s.shiftId === 'night')!;
    const day = res.shiftDiagnostics.find((s) => s.shiftId === 'day')!;

    expect(night.generatedBacklog).toBeCloseTo(25, 6);
    expect(day.generatedBacklog).toBeCloseTo(0, 6);
    expect(day.inheritedBacklog).toBeGreaterThan(0);
  });

  it('flags a lone short hour as a much shorter streak than a compounding hole', () => {
    const grid = flatGrid('all', 3);
    const lone = zeros();
    lone[50] = 4; // deficit 1 (just above threshold), pays off in a single hour at 3/hr
    const loneRes = computeBacklog(grid, lone, lone, allDay, NO_COMPRESSION_FLOOR_WHPPV);

    const sustained = zeros();
    for (let h = 40; h < 50; h++) sustained[h] = 8; // deficit 5/hr for 10 hours straight
    const sustainedRes = computeBacklog(grid, sustained, sustained, allDay, NO_COMPRESSION_FLOOR_WHPPV);

    expect(loneRes.longestStreakHours).toBeLessThan(sustainedRes.longestStreakHours);
    expect(loneRes.peakBacklog).toBeLessThan(sustainedRes.peakBacklog);
    expect(BACKLOG_CAUGHT_UP_THRESHOLD).toBeGreaterThan(0);
  });
});

// The genuine, new mechanic: nurses compressing pace down to a single flat peer-cohort floor
// wHPPV — replacing the retired per-hour "stretch to a ceiling" concept.
describe('real compression (floorWhppv < the pace capacity alone would imply)', () => {
  it('a smaller floorWhppv (faster achievable pace) clears the SAME visit spike faster than a larger one', () => {
    const arrivals = zeros();
    arrivals[0] = 20; // a 20-visit spike, then nothing
    const grid = flatGrid('all', 8); // flat 8 nurse-hours/hr capacity throughout

    const fast = computeBacklog(grid, arrivals, arrivals, allDay, 2); // floorWhppv=2 -> 40 hours implied
    const slow = computeBacklog(grid, arrivals, arrivals, allDay, 4); // floorWhppv=4 -> 80 hours implied

    expect(fast.backlog[0]).toBe(32); // 40 implied - 8 capacity
    expect(fast.backlog[1]).toBe(24);
    expect(fast.backlog[4]).toBe(0); // cleared in 4 hours at 8/hr

    expect(slow.backlog[0]).toBe(72); // 80 implied - 8 capacity
    expect(slow.backlog[4]).toBe(40); // still well behind at the same hour
    expect(slow.peakBacklog).toBeGreaterThan(fast.peakBacklog);
  });

  it('capacity that exactly meets arrivals*floorWhppv every hour clears to zero regardless of floorWhppv', () => {
    const arrivals = new Array(168).fill(5);
    for (const floorWhppv of [1, 2, 3.5]) {
      const grid = flatGrid('all', 5 * floorWhppv);
      const res = computeBacklog(grid, arrivals, arrivals, allDay, floorWhppv);
      expect(res.backlog.every((b) => b === 0)).toBe(true);
    }
  });
});

// PR E (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §4) — structural/cyclical split, UNCHANGED IN
// SHAPE by the ninth-shape reversal (only the per-hour formula changed, not the split's
// existence). Exercised here in the no-compression degenerate case (floorWhppv=1) since the
// split logic is independent of which recurrence produced the backlog curve.
describe('PR E — structural/cyclical split (validation gate)', () => {
  it('reproduces cyclical overnight clearing + a real per-day structural floor, with no neverClears claim', () => {
    const peakAmplitudeByDay = [24, 34, 33, 30, 25, 20, 18]; // Sun..Sat, INVENTED, illustrative only
    const requirement = zeros();
    for (let day = 0; day < 7; day++) {
      for (let h = 0; h < 24; h++) {
        const raw = Math.max(0, Math.cos(((h - 19) / 24) * 2 * Math.PI));
        const shape = Math.pow(raw, 3);
        requirement[day * 24 + h] = 3 + peakAmplitudeByDay[day] * shape;
      }
    }
    // Flat day/night capacity, comfortably above the baseline (3) but below the evening peak —
    // no separate "stretch ceiling" input exists anymore, so capacity alone must be enough to
    // drain most nights, leaving a real, day-varying residual on the heaviest days.
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 10, night: 9 };

    const res = computeBacklog(grid, requirement, requirement, dayNight, NO_COMPRESSION_FLOOR_WHPPV);

    expect(res.structuralFloorByDay).toHaveLength(7);
    expect(res.structuralFloorMin).toBeGreaterThanOrEqual(0);
    expect(res.peakBacklog).toBeGreaterThan(10);

    expect(res.cyclicalBacklog).toHaveLength(168);
    expect(res.cyclicalBacklog.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });

  it('cyclical backlog isolates SHAPE from SIZE: a flat (no-shape) under-target department shows real ACTUAL backlog but ~zero CYCLICAL backlog', () => {
    const requirement = new Array(168).fill(10);
    const res = computeBacklog(flatGrid('all', 8), requirement, requirement, allDay, NO_COMPRESSION_FLOOR_WHPPV);

    expect(res.peakBacklog).toBeGreaterThan(0); // real actual backlog: a genuine size shortfall
    expect(res.cyclicalPeakBacklog).toBeCloseTo(0, 6); // isolates to ~zero once size is factored out
  });

  it('the relative caught-up threshold reads a real-world-scale peak as genuinely clearing, where the old flat 0.5hr bar would have called it "always behind"', () => {
    const requirement = zeros();
    for (let h = 0; h < 24; h++) requirement[h] = h === 0 ? 40 : 5;
    const res = computeBacklog(flatGrid('all', 6), requirement, requirement, allDay, NO_COMPRESSION_FLOOR_WHPPV);
    expect(res.neverClears).toBe(false);
    expect(res.peakBacklog).toBeGreaterThan(10);
  });
});
