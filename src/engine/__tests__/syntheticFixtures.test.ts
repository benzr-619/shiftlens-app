// PR E0 — the seven §12.2 department profiles, frozen for regression/visual review. No
// committed Playwright harness exists in this repo yet (no playwright devDependency/config) —
// these fixtures are still the thing a future Playwright/visual pass loads directly; in the
// meantime this file is the vitest-level guard that each profile still produces the
// CONCLUSION it's named for. A failing test name here IS the "profile G broke" signal §12.5
// asks for.
import { describe, expect, it } from 'vitest';
import { compute } from '../index';
import { summarizeBacklogSeverity } from '../backlog';
import { generateSyntheticDepartment } from '../../lib/__fixtures__/syntheticDepartment';
import { NAMED_DEPARTMENT_PARAMS } from '../../lib/__fixtures__/namedDepartments';
import type { ShiftDef } from '../types';

function shiftDayFraction(shift: ShiftDef): number {
  let dayHours = 0;
  for (let i = 0; i < shift.lengthHours; i++) {
    const h = (shift.startHour + i) % 24;
    if (h >= 7 && h < 19) dayHours++;
  }
  return dayHours / shift.lengthHours;
}

function currentDayNightHours(grid: ReturnType<typeof generateSyntheticDepartment>['currentStaffingGrid'], shiftMenu: ShiftDef[]) {
  let day = 0;
  let night = 0;
  for (const shift of shiftMenu) {
    const isDay = shiftDayFraction(shift) >= 0.5;
    for (let d = 0; d < 7; d++) {
      const hours = (grid[d]?.[shift.id] ?? 0) * shift.lengthHours;
      if (isDay) day += hours;
      else night += hours;
    }
  }
  return { day, night };
}

describe('synthetic named department profiles (§12.2)', () => {
  it('profile A: underTargetDayShort — under target overall, day-short', () => {
    const params = NAMED_DEPARTMENT_PARAMS.underTargetDayShort;
    const { inputs, currentStaffingGrid } = generateSyntheticDepartment(params);
    const result = compute(inputs);
    const currentTotal = Object.values(currentStaffingGrid).reduce(
      (acc, row) => acc + Object.entries(row).reduce((a, [id, hc]) => a + hc * (inputs.shiftMenu.find((s) => s.id === id)?.lengthHours ?? 0), 0),
      0
    );
    expect(currentTotal, 'total current hours should be under target-implied hours').toBeLessThan(result.weeklyBudgetHours);

    const { day, night } = currentDayNightHours(currentStaffingGrid, inputs.shiftMenu);
    const reqDay = result.hourlyRequirement.reduce((acc, r, i) => (i % 24 >= 7 && i % 24 < 19 ? acc + r : acc), 0);
    const reqNight = result.hourlyRequirement.reduce((acc, r, i) => (i % 24 >= 7 && i % 24 < 19 ? acc : acc + r), 0);
    const dayGap = reqDay - day;
    const nightGap = reqNight - night;
    expect(dayGap, 'day gap should exceed night gap (day-short)').toBeGreaterThan(nightGap);
  });

  it('profile B: adequatelyStaffedBadlyShaped — enough hours, wrong places', () => {
    const params = NAMED_DEPARTMENT_PARAMS.adequatelyStaffedBadlyShaped;
    const { inputs, currentStaffingGrid } = generateSyntheticDepartment(params);
    const result = compute(inputs);
    const currentTotal = Object.values(currentStaffingGrid).reduce(
      (acc, row) => acc + Object.entries(row).reduce((a, [id, hc]) => a + hc * (inputs.shiftMenu.find((s) => s.id === id)?.lengthHours ?? 0), 0),
      0
    );
    expect(currentTotal, 'total current hours should be at/above target-implied hours').toBeGreaterThanOrEqual(
      result.weeklyBudgetHours
    );

    const currentSeverity = summarizeBacklogSeverity(currentStaffingGrid, result.hourlyRequirement, inputs.shiftMenu);
    expect(currentSeverity.totalSeverity, 'current grid should still show real severity despite adequate hours').toBeGreaterThan(0);
  });

  it('profile C: nightShort — same machinery, opposite direction', () => {
    const params = NAMED_DEPARTMENT_PARAMS.nightShort;
    const { inputs, currentStaffingGrid } = generateSyntheticDepartment(params);
    const result = compute(inputs);
    const { night } = currentDayNightHours(currentStaffingGrid, inputs.shiftMenu);
    const reqNight = result.hourlyRequirement.reduce((acc, r, i) => (i % 24 >= 7 && i % 24 < 19 ? acc : acc + r), 0);
    expect(night, 'current night hours should fall short of night requirement').toBeLessThan(reqNight);
  });

  it('profile D: noBoardingData — degrades to a prompt, never silently vanishes', () => {
    const params = NAMED_DEPARTMENT_PARAMS.noBoardingData;
    const { inputs } = generateSyntheticDepartment(params);
    const result = compute(inputs);
    expect(result.boarding, 'boarding should be null when admit rate/duration are absent').toBeNull();
    expect(result.lostProductivity, 'lostProductivity should be null iff boarding is null').toBeNull();
  });

  it('profile E: shortDurationBoarding — hidden-boarding diagnostic ~= 0, still a real finding', () => {
    const params = NAMED_DEPARTMENT_PARAMS.shortDurationBoarding;
    const { inputs } = generateSyntheticDepartment(params);
    const result = compute(inputs);
    expect(result.boarding, 'boarding should still be computed (present, just small)').not.toBeNull();
    const boardingFraction = result.boarding!.weeklyBoardingHours / result.weeklyBudgetHours;
    expect(boardingFraction, 'boarding should be a small fraction of the budget, not zero').toBeGreaterThan(0);
    expect(boardingFraction, 'boarding should be a small fraction of the budget').toBeLessThan(0.1);
  });

  it('profile F: lowVolumeFloorBinds — ENA floor binds, delivery premium is unavoidable', () => {
    const params = NAMED_DEPARTMENT_PARAMS.lowVolumeFloorBinds;
    const { inputs } = generateSyntheticDepartment(params);
    const result = compute(inputs);
    const enaFloor = inputs.enaFloor ?? 2;
    const floorDominates = result.hourlyRequirement.every((r) => r <= enaFloor);
    expect(floorDominates, 'requirement should be at/below the ENA floor everywhere at this low volume').toBe(true);
    expect(
      result.weeklyScheduledHours,
      'the floor should push scheduled hours above pure demand-driven full coverage'
    ).toBeGreaterThanOrEqual(result.fullCoverage.weeklyHours);
  });

  it('profile G: alreadyFine — the page must be able to say "you\'re fine" convincingly', () => {
    const params = NAMED_DEPARTMENT_PARAMS.alreadyFine;
    const { inputs, currentStaffingGrid } = generateSyntheticDepartment(params);
    const result = compute(inputs);
    const currentTotal = Object.values(currentStaffingGrid).reduce(
      (acc, row) => acc + Object.entries(row).reduce((a, [id, hc]) => a + hc * (inputs.shiftMenu.find((s) => s.id === id)?.lengthHours ?? 0), 0),
      0
    );
    expect(currentTotal, 'total current hours should be at/above target-implied hours').toBeGreaterThanOrEqual(
      result.weeklyBudgetHours
    );
    const currentSeverity = summarizeBacklogSeverity(currentStaffingGrid, result.hourlyRequirement, inputs.shiftMenu);
    const idealSeverity = summarizeBacklogSeverity(result.grid, result.hourlyRequirement, inputs.shiftMenu);
    // "Fine" means current severity is close to the idealized grid's own severity, not that
    // it's literally zero (the idealized grid itself always carries some residual severity).
    const relativeGap =
      idealSeverity.totalSeverity > 0
        ? (currentSeverity.totalSeverity - idealSeverity.totalSeverity) / idealSeverity.totalSeverity
        : currentSeverity.totalSeverity;
    expect(relativeGap, 'current severity should be close to the idealized grid\'s own severity').toBeLessThan(0.5);
  });

  it('profile H: measuredBoardingCensus — the measured census path produces censusSource "measured" with both streams reported', () => {
    const params = NAMED_DEPARTMENT_PARAMS.measuredBoardingCensus;
    const { inputs } = generateSyntheticDepartment(params);
    const result = compute(inputs);
    expect(result.boarding).not.toBeNull();
    expect(result.boarding!.censusSource).toBe('measured');
    expect(result.boarding!.medicalWeeklyRnHours).not.toBeNull();
    expect(result.boarding!.bhWeeklyRnHours).not.toBeNull();
    expect(result.boarding!.hasMonthlySeasonality).toBe(true);
    // Precedence: admitRate/meanBoardingDurationHours were generated too (for the census
    // magnitude), but must be provably unused now that a measured census is present.
    const withDifferentAdmitRate = compute({ ...inputs, admitRate: 0.9, boardingDuration: 30 });
    expect(withDifferentAdmitRate.boarding!.cellBoardingRnHours).toEqual(result.boarding!.cellBoardingRnHours);
  });
});
