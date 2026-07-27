import { describe, expect, it } from 'vitest';
import { searchFlexibleMenus, type FlexAxes } from '../flexMenu';
import type { ShiftDef } from '../types';

const currentMenu: ShiftDef[] = [
  { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 },
  { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 },
];

// A requirement curve that clearly wants three 8-hour blocks of differing intensity per day
// (heavy 8-16, medium 16-24, light 0-8), repeated across all 7 days.
function threeBlockRequirement(): number[] {
  const req = new Array(168).fill(0);
  for (let day = 0; day < 7; day++) {
    for (let h = 0; h < 24; h++) {
      const level = h >= 8 && h < 16 ? 6 : h >= 16 && h < 24 ? 4 : 2;
      req[day * 24 + h] = level;
    }
  }
  return req;
}

// A plausible typical-staffing-band floor: 2 below the point requirement (never negative) —
// just needs to be a realistic, non-degenerate curve for these candidate-search tests, which
// aren't about the trim cost function itself (see solver.test.ts for that).
function threeBlockBandFloor(): number[] {
  return threeBlockRequirement().map((v) => Math.max(0, v - 2));
}

// No volatility signal in these candidate-search tests (see solver.test.ts / demandBand
// tests for that dimension) — flat zero is Phase 1's exact behavior.
function noVolatility(): number[] {
  return new Array(168).fill(0);
}

const AXES = (o: Partial<FlexAxes>): FlexAxes => ({ startTimes: false, shiftCount: false, shiftLengths: false, ...o });

const budget = 3000;

describe('§2.3 shift-menu flexibility search (bounded, opt-in, advisory)', () => {
  it('holds every axis at the current structure when nothing is enabled (one regularized candidate)', () => {
    const cands = searchFlexibleMenus(threeBlockRequirement(), threeBlockBandFloor(), noVolatility(), currentMenu, AXES({}), budget, 0.1, 2);
    expect(cands).toHaveLength(1);
    // current: 2 shifts, dominant length 12
    expect(cands[0].menu).toHaveLength(2);
    expect(cands[0].menu.every((s) => s.lengthHours === 12)).toBe(true);
  });

  it('shiftCount axis explores 2/3/4-shift menus', () => {
    const cands = searchFlexibleMenus(threeBlockRequirement(), threeBlockBandFloor(), noVolatility(), currentMenu, AXES({ shiftCount: true }), budget, 0.1, 2);
    const counts = new Set(cands.map((c) => c.menu.length));
    expect(counts.has(2)).toBe(true);
    expect(counts.has(3)).toBe(true);
    expect(counts.has(4)).toBe(true);
  });

  it('shiftLengths axis explores 8/10/12-hour shifts', () => {
    const cands = searchFlexibleMenus(threeBlockRequirement(), threeBlockBandFloor(), noVolatility(), currentMenu, AXES({ shiftLengths: true }), budget, 0.1, 2);
    const lengths = new Set(cands.flatMap((c) => c.menu.map((s) => s.lengthHours)));
    expect(lengths.has(8)).toBe(true);
    expect(lengths.has(10)).toBe(true);
    expect(lengths.has(12)).toBe(true);
  });

  it('never emits a gapped candidate: a 2-shift menu must use 12h shifts (8h would leave gaps)', () => {
    const cands = searchFlexibleMenus(
      threeBlockRequirement(),
      threeBlockBandFloor(),
      noVolatility(),
      currentMenu,
      AXES({ shiftCount: true, shiftLengths: true }),
      budget,
      0.1,
      2
    );
    const twoShift = cands.filter((c) => c.menu.length === 2);
    expect(twoShift.length).toBeGreaterThan(0);
    expect(twoShift.every((c) => c.menu.every((s) => s.lengthHours >= 12))).toBe(true);
  });

  it('returns candidates ranked ascending by total shortfall (best coverage first)', () => {
    const cands = searchFlexibleMenus(
      threeBlockRequirement(),
      threeBlockBandFloor(),
      noVolatility(),
      currentMenu,
      AXES({ startTimes: true, shiftCount: true, shiftLengths: true }),
      budget,
      0.1,
      2
    );
    expect(cands.length).toBeGreaterThan(1);
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i].totalShortfall).toBeGreaterThanOrEqual(cands[i - 1].totalShortfall);
    }
  });

  it('is bounded and deduped: at most 45 regular tilings + 12 overlay candidates (57) even with every axis on — PR D change 6 widened the bound', () => {
    const cands = searchFlexibleMenus(
      threeBlockRequirement(),
      threeBlockBandFloor(),
      noVolatility(),
      currentMenu,
      AXES({ startTimes: true, shiftCount: true, shiftLengths: true }),
      budget,
      0.1,
      2
    );
    expect(cands.length).toBeLessThanOrEqual(57);
    const keys = new Set(cands.map((c) => c.menu.map((s) => `${s.startHour}:${s.lengthHours}`).sort().join('|')));
    expect(keys.size).toBe(cands.length); // no duplicates
  });

  it('returns nothing for an empty menu', () => {
    expect(searchFlexibleMenus(threeBlockRequirement(), threeBlockBandFloor(), noVolatility(), [], AXES({ shiftLengths: true }), budget, 0.1, 2)).toEqual([]);
  });

  describe('2026-07-26 PR D change 6 — swing-shift overlay family (SOLVER_REALISM_SPEC_2026-07-26.md)', () => {
    it('a mid/swing shift layered over the current menu is reachable when any axis is enabled — unreachable via regular tilings alone', () => {
      const cands = searchFlexibleMenus(
        threeBlockRequirement(),
        threeBlockBandFloor(),
        noVolatility(),
        currentMenu,
        AXES({ shiftCount: true }), // any single axis is enough to unlock the overlay family
        budget,
        0.1,
        2
      );
      // An overlay candidate keeps the ORIGINAL 2 shifts (day/night) and adds a 3rd on top —
      // distinguishable from a regular 3-shift tiling because it keeps 'day'/'night' verbatim.
      const overlayCandidates = cands.filter(
        (c) => c.menu.some((s) => s.id === 'day') && c.menu.some((s) => s.id === 'night') && c.menu.length === 3
      );
      expect(overlayCandidates.length).toBeGreaterThan(0);
    });

    it('is gated on anyAxis: with NOTHING enabled, no overlay candidates appear (the "static = no search" contract holds)', () => {
      const cands = searchFlexibleMenus(threeBlockRequirement(), threeBlockBandFloor(), noVolatility(), currentMenu, AXES({}), budget, 0.1, 2);
      expect(cands).toHaveLength(1); // unchanged from the pre-PR-D contract
    });
  });
});
