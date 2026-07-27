import { describe, expect, it } from 'vitest';
import { computeHiddenBoardingDiagnostic } from '../hiddenBoarding';
import type { Grid, ShiftDef } from '../types';

const dayNight: ShiftDef[] = [
  { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 },
  { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 },
];

function flat(value: number): number[] {
  return new Array(168).fill(value);
}

describe('PR F — hidden-boarding diagnostic (§6.2)', () => {
  it('boardingDataPresent is false and boarding/total fields are null when boarding curve is absent', () => {
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 6, night: 4 };
    const res = computeHiddenBoardingDiagnostic(flat(5), grid, dayNight, null);
    expect(res.boardingDataPresent).toBe(false);
    expect(res.day.boardingNeedHours).toBeNull();
    expect(res.day.totalNeedHours).toBeNull();
    expect(res.night.boardingNeedHours).toBeNull();
    expect(res.night.totalNeedHours).toBeNull();
  });

  it('reproduces the qualitative shape from spec §6.2 with INVENTED numbers: nights staffed beyond arrivals, days short of arrivals — matching what nocturnal boarding absorption looks like', () => {
    // Day requirement (arrivals) heavier than night — a typical unimodal-day arrival curve.
    const requirement = flat(0);
    for (let g = 0; g < 168; g++) {
      const hod = g % 24;
      requirement[g] = hod >= 7 && hod < 19 ? 6 : 3; // day arrivals-need >> night arrivals-need
    }
    // Current staffing: heavier at night than day arrivals alone would justify (a department
    // that's silently absorbing boarding into its night shift).
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 5, night: 5 }; // flat staffing both blocks

    const boardingCurve = flat(0);
    for (let g = 0; g < 168; g++) {
      const hod = g % 24;
      boardingCurve[g] = hod >= 7 && hod < 19 ? 1.5 : 2; // boarding skews slightly nocturnal
    }

    const res = computeHiddenBoardingDiagnostic(requirement, grid, dayNight, boardingCurve);
    expect(res.boardingDataPresent).toBe(true);

    // Day: staffed (5*12=60/day -> weekly not needed here, block totals already weekly) less
    // than arrivals need -> negative vsArrivalsAlone (day runs short).
    expect(res.day.vsArrivalsAlone).toBeLessThan(0);
    // Night: staffed beyond arrivals need -> positive vsArrivalsAlone (night carries "hidden" hours).
    expect(res.night.vsArrivalsAlone).toBeGreaterThan(0);
    // The two numbers are real, finite, and boarding need is genuinely present on both blocks.
    expect(res.night.boardingNeedHours).toBeGreaterThan(0);
    expect(res.day.boardingNeedHours).toBeGreaterThan(0);
    expect(res.night.totalNeedHours).toBeCloseTo(res.night.arrivalsNeedHours + (res.night.boardingNeedHours ?? 0), 6);
  });

  it('degenerate case: zero current staffing produces finite, non-NaN, negative vsArrivalsAlone everywhere requirement > 0', () => {
    const requirement = flat(4);
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 0, night: 0 };
    const res = computeHiddenBoardingDiagnostic(requirement, grid, dayNight, null);
    expect(Number.isFinite(res.day.vsArrivalsAlone)).toBe(true);
    expect(Number.isFinite(res.night.vsArrivalsAlone)).toBe(true);
    expect(res.day.vsArrivalsAlone).toBeLessThan(0);
    expect(res.night.vsArrivalsAlone).toBeLessThan(0);
  });
});
