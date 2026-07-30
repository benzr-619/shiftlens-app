import { describe, expect, it } from 'vitest';
import { computePerShiftDiagnostic } from '../hiddenBoarding';
import type { Grid, ShiftDef } from '../types';

// Three shifts tiling 24 hours exactly with no overlap (Day 07-14, Evening 15-22, Night
// 23 + next day's 00-06, global-week circular) — every hour is covered by exactly one
// shift, so the split-at-handoff-hours convention never actually splits in this fixture,
// keeping the arithmetic exact and easy to hand-check.
const threeShift: ShiftDef[] = [
  { id: 'day', label: 'Day', startHour: 7, lengthHours: 8 },
  { id: 'evening', label: 'Evening', startHour: 15, lengthHours: 8 },
  { id: 'night', label: 'Night', startHour: 23, lengthHours: 8 },
];

const dayNight: ShiftDef[] = [
  { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 },
  { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 },
];

function flat(value: number): number[] {
  return new Array(168).fill(value);
}

/** hourOfDay 23,0-6 -> nightValue; 7-14 -> dayValue; 15-22 -> dayValue (Evening reuses the
 * same "day-shaped" demand as Day so both blocks are symmetric unless a test overrides). */
function byBlock(nightValue: number, dayValue: number): number[] {
  const out = new Array(168).fill(0);
  for (let g = 0; g < 168; g++) {
    const hod = g % 24;
    out[g] = hod === 23 || hod <= 6 ? nightValue : dayValue;
  }
  return out;
}

function gridWith(headcounts: Record<string, number>): Grid {
  const grid: Grid = {};
  for (let day = 0; day < 7; day++) grid[day] = { ...headcounts };
  return grid;
}

describe('PANEL1_COPY_REVISION_SPEC_2026-07-28.md §4 — per-shift arrivals/boarding diagnostic', () => {
  it('boarding absent: boardingDataPresent false, every group has null boardingNeedHours/boardingCovered', () => {
    const requirement = byBlock(4, 10);
    const bandFloor = byBlock(2, 8);
    const bandCeiling = byBlock(6, 12);
    const grid = gridWith({ day: 2, evening: 2, night: 1 });
    const res = computePerShiftDiagnostic(requirement, grid, threeShift, bandFloor, bandCeiling, null);
    expect(res.boardingDataPresent).toBe(false);
    for (const g of res.groups) {
      expect(g.boardingNeedHours).toBeNull();
      expect(g.boardingCovered).toBeNull();
    }
  });

  it('merges shifts with an identical (arrivalsStatus, boardingCovered) tuple even when they are not adjacent in the shift menu', () => {
    const requirement = byBlock(4, 10);
    const bandFloor = byBlock(2, 8);
    const bandCeiling = byBlock(6, 12);
    const boarding = flat(1); // uniform boarding demand, 1 nurse-hour/hour
    // Day: headcount 13 -> staffed 13*8*7=728, required 560, ceilingSum 672 -> overstaffed.
    // Evening: headcount 2 -> staffed 2*8*7=112, floorSum 448 -> understaffed.
    // Night: headcount 7 -> staffed 7*8*7=392, required 224, ceilingSum 336 -> overstaffed.
    // Day and Night should merge (both overstaffed + boarding covered) despite Evening
    // sitting between them in startHour order.
    const grid = gridWith({ day: 13, evening: 2, night: 7 });
    const res = computePerShiftDiagnostic(requirement, grid, threeShift, bandFloor, bandCeiling, boarding);
    expect(res.boardingDataPresent).toBe(true);
    expect(res.groups).toHaveLength(2);

    const merged = res.groups.find((g) => g.shiftIds.includes('day'))!;
    expect(merged.shiftIds.sort()).toEqual(['day', 'night'].sort());
    expect(merged.labels).toEqual(['Day', 'Night']);
    expect(merged.arrivalsStatus).toBe('overstaffed');
    expect(merged.staffedHours).toBeCloseTo(728 + 392, 6);
    expect(merged.requiredHours).toBeCloseTo(560 + 224, 6);
    expect(merged.surplus).toBeCloseTo(168 + 168, 6);
    expect(merged.boardingNeedHours).toBeCloseTo(56 + 56, 6);
    expect(merged.boardingCovered).toBe(true);

    const evening = res.groups.find((g) => g.shiftIds.includes('evening'))!;
    expect(evening.arrivalsStatus).toBe('understaffed');
    expect(evening.boardingCovered).toBe(false);
  });

  it('overstaffed-but-not-covered group carries the "extra hours don\'t fully close" numbers correctly', () => {
    const requirement = byBlock(4, 10);
    const bandFloor = byBlock(2, 8);
    const bandCeiling = byBlock(6, 12);
    const boarding = flat(20); // heavy boarding demand no reasonable surplus can absorb.
    const grid = gridWith({ day: 13, evening: 13, night: 7 });
    const res = computePerShiftDiagnostic(requirement, grid, threeShift, bandFloor, bandCeiling, boarding);
    for (const g of res.groups) {
      expect(g.arrivalsStatus).toBe('overstaffed');
      expect(g.boardingCovered).toBe(false);
      expect(g.surplus).toBeLessThan(g.boardingNeedHours ?? Infinity);
    }
  });

  it('degenerate case: zero current staffing collapses a 3-shift menu into ONE merged "understaffed" group, not three near-duplicates', () => {
    const requirement = flat(4);
    const bandFloor = flat(2);
    const bandCeiling = flat(6);
    const grid = gridWith({ day: 0, evening: 0, night: 0 });
    const res = computePerShiftDiagnostic(requirement, grid, threeShift, bandFloor, bandCeiling, null);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].arrivalsStatus).toBe('understaffed');
    expect(res.groups[0].shiftIds).toHaveLength(3);
    for (const g of res.groups) {
      expect(Number.isFinite(g.staffedHours)).toBe(true);
      expect(Number.isFinite(g.requiredHours)).toBe(true);
    }
  });

  it('a 2-shift (Day/Night) menu collapses correctly when both shifts land on the same verdict', () => {
    const requirement = flat(5);
    const bandFloor = flat(3);
    const bandCeiling = flat(8);
    const grid = gridWith({ day: 1, night: 1 }); // both understaffed identically
    const res = computePerShiftDiagnostic(requirement, grid, dayNight, bandFloor, bandCeiling, null);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].labels).toEqual(['Day', 'Night']);
  });

  it('empty shift menu returns no groups without throwing', () => {
    const res = computePerShiftDiagnostic(flat(4), {}, [], flat(2), flat(6), null);
    expect(res.groups).toEqual([]);
  });
});
