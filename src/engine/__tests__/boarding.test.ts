import { describe, expect, it } from 'vitest';
import { compute } from '../index';
import {
  annualBoardingCoveredByWeeklyGrid,
  boardingCoverageFte,
  computeBoarding,
  effectiveEdWhppvAtCoverage,
  recommendWeeklyBoardingGrid,
  weeklyBoardingCoveredByGrid,
  weeklyBoardingDemandByCell,
} from '../boarding';
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

describe('Boarding hourly curve + priority-ranked coverage', () => {
  it('is withheld when either admit rate or boarding duration is absent, same as before', () => {
    const arrivals = randomArrivals168(20);
    expect(computeBoarding(arrivals, undefined, 4, 4, shiftMenu, undefined, undefined)).toBeNull();
    expect(computeBoarding(arrivals, 0.2, undefined, 4, shiftMenu, undefined, undefined)).toBeNull();
  });

  it('degrades to shift-block-only ranking (no month split) when neither seasonality total is provided', () => {
    const arrivals = randomArrivals168(21);
    const boarding = computeBoarding(arrivals, 0.2, 4, 4, shiftMenu, undefined, undefined);
    expect(boarding).not.toBeNull();
    expect(boarding!.hasMonthlySeasonality).toBe(false);
    expect(boarding!.hasDayOfWeekSeasonality).toBe(false);
    expect(boarding!.monthFactors).toBeNull();
    expect(boarding!.prioritySlots.every((s) => s.month === null)).toBe(true);
    // 7 days x 2 shifts = 14 slots (menu fully tiles 24h, no gaps)
    expect(boarding!.prioritySlots).toHaveLength(14);
  });

  it('the convolution-based census conserves total admission-hours (no loss at week wraparound)', () => {
    const arrivals = randomArrivals168(22);
    const admitRate = 0.2;
    const boardingDuration = 4.5;
    const boarding = computeBoarding(arrivals, admitRate, boardingDuration, 4, shiftMenu, undefined, undefined);
    const expectedTotalCareHours = arrivals.reduce((a, b) => a + b * admitRate * boardingDuration, 0) / 4;
    const actualTotalCareHours = boarding!.cellBoardingRnHours.reduce((a, b) => a + b, 0);
    expect(actualTotalCareHours).toBeCloseTo(expectedTotalCareHours, 6);
  });

  it('ranks slots descending by required care hours with a monotonic cumulative percentage', () => {
    const arrivals = randomArrivals168(23);
    const boarding = computeBoarding(arrivals, 0.2, 4, 4, shiftMenu, undefined, undefined);
    const slots = boarding!.prioritySlots;
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].requiredCareHours).toBeLessThanOrEqual(slots[i - 1].requiredCareHours);
      expect(slots[i].cumulativePct).toBeGreaterThanOrEqual(slots[i - 1].cumulativePct);
    }
    expect(slots[slots.length - 1].cumulativePct).toBeCloseTo(100, 4); // menu fully tiles 24h, no gap loss
  });

  it('derives a day-of-week seasonality index as mean-duration-per-patient ratio against the overall boardingDuration baseline (day_mean / overallDuration)', () => {
    const arrivals = randomArrivals168(24);
    const overallDuration = 4;
    const flat = computeBoarding(arrivals, 0.2, overallDuration, 4, shiftMenu, undefined, undefined);
    // Sun-Thu mean duration same as baseline, Fri/Sat patients board twice as long on average.
    const weekendLongerBoarding = [4, 4, 4, 4, 4, 8, 8];
    const boarding = computeBoarding(arrivals, 0.2, overallDuration, 4, shiftMenu, weekendLongerBoarding, undefined);
    expect(boarding!.hasDayOfWeekSeasonality).toBe(true);
    // Friday (day 5) slots should now rank above where they did in the flat case.
    const fridayHoursFlat = flat!.prioritySlots.filter((s) => s.day === 5).reduce((a, s) => a + s.requiredCareHours, 0);
    const fridayHoursWeighted = boarding!.prioritySlots.filter((s) => s.day === 5).reduce((a, s) => a + s.requiredCareHours, 0);
    expect(fridayHoursWeighted).toBeCloseTo(fridayHoursFlat * 2, 6);
  });

  it('produces month-split slots (12x the day/shift combos) when monthlyMeanBoardingDurationHours is provided', () => {
    const arrivals = randomArrivals168(25);
    const overallDuration = 4;
    const monthlyMeans = new Array(12).fill(overallDuration);
    monthlyMeans[0] = overallDuration * 2; // January patients board twice as long on average
    const boarding = computeBoarding(arrivals, 0.2, overallDuration, 4, shiftMenu, undefined, monthlyMeans);
    expect(boarding!.hasMonthlySeasonality).toBe(true);
    expect(boarding!.monthFactors).toHaveLength(12);
    expect(boarding!.prioritySlots.every((s) => s.month !== null)).toBe(true);
    expect(boarding!.prioritySlots).toHaveLength(12 * 7 * 2);
    const janHours = boarding!.prioritySlots.filter((s) => s.month === 0).reduce((a, s) => a + s.requiredCareHours, 0);
    const febHours = boarding!.prioritySlots.filter((s) => s.month === 1).reduce((a, s) => a + s.requiredCareHours, 0);
    expect(janHours).toBeCloseTo(febHours * 2, 6);
  });

  it('treats a zero/invalid overall boardingDuration baseline as absent seasonality (guards divide-by-zero), even with valid per-period means', () => {
    const arrivals = randomArrivals168(26);
    const boarding = computeBoarding(arrivals, 0.2, 0, 4, shiftMenu, [4, 4, 4, 4, 4, 8, 8], undefined);
    expect(boarding!.hasDayOfWeekSeasonality).toBe(false);
    expect(Number.isFinite(boarding!.annualBoardingHours)).toBe(true);
  });

  it('all-zero per-period means are a legitimate (not absent) seasonality signal — every period weighted to zero boarding', () => {
    const arrivals = randomArrivals168(30);
    const boarding = computeBoarding(arrivals, 0.2, 4, 4, shiftMenu, new Array(7).fill(0), undefined);
    expect(boarding!.hasDayOfWeekSeasonality).toBe(true);
    expect(boarding!.prioritySlots.every((s) => s.requiredCareHours === 0)).toBe(true);
  });

  it('when boardingDuration is an hourly array, the overall baseline is the admit-events-weighted mean, not a naive average', () => {
    // Heavy volume (100 arrivals) at hour 8 every day, light (1 arrival) every other hour —
    // admit events are dominated by hour 8, so the weighted baseline should land far from the
    // plain per-cell average of the duration array.
    const arrivals = new Array(168).fill(0).map((_, i) => (i % 24 === 8 ? 100 : 1));
    const admitRate = 0.5;
    const boardingDurationByHour = new Array(168).fill(0).map((_, i) => (i % 24 === 8 ? 10 : 2));

    const admitEvents = arrivals.map((a) => a * admitRate);
    const totalEvents = admitEvents.reduce((a, b) => a + b, 0);
    const weightedBaseline =
      boardingDurationByHour.reduce((a, d, i) => a + d * admitEvents[i], 0) / totalEvents;
    const naiveBaseline = boardingDurationByHour.reduce((a, b) => a + b, 0) / boardingDurationByHour.length;
    expect(weightedBaseline).not.toBeCloseTo(naiveBaseline, 1); // sanity: the two baselines actually differ here

    // A flat monthly mean equal to the naive average: if the engine used the naive baseline,
    // every month's factor would be 1 (no-op); since it uses the weighted baseline instead,
    // the factor should be naiveBaseline / weightedBaseline, scaling annual hours down from
    // the no-seasonality case by that same ratio.
    const noSeasonality = computeBoarding(arrivals, admitRate, boardingDurationByHour, 4, shiftMenu, undefined, undefined);
    const withSeasonality = computeBoarding(
      arrivals,
      admitRate,
      boardingDurationByHour,
      4,
      shiftMenu,
      undefined,
      new Array(12).fill(naiveBaseline)
    );
    expect(withSeasonality!.hasMonthlySeasonality).toBe(true);
    const expectedFactor = naiveBaseline / weightedBaseline;
    expect(withSeasonality!.annualBoardingHours / noSeasonality!.annualBoardingHours).toBeCloseTo(expectedFactor, 6);
    expect(expectedFactor).not.toBeCloseTo(1, 1); // confirms this test actually distinguishes the two baselines
  });

  it("slot required-care-hours are attributed via the shift menu's own hour coverage, not a solved schedule", () => {
    const arrivals = randomArrivals168(27);
    const boarding = computeBoarding(arrivals, 0.3, 6, 4, shiftMenu, undefined, undefined);
    expect(boarding!.prioritySlots.every((s) => s.requiredCareHours > 0)).toBe(true);
    expect(boarding!.prioritySlots.every((s) => ['day', 'night'].includes(s.shiftId))).toBe(true);
  });
});

describe('§2.6 single representative-week coverage model', () => {
  const twelveFlat = () => new Array(12).fill(4); // mean duration == baseline ⇒ every month factor 1

  it('weeklyBoardingDemandByCell recovers a representative week whose cells sum to the weekly boarding hours', () => {
    const arrivals = randomArrivals168(31);
    const boarding = computeBoarding(arrivals, 0.2, 4, 4, shiftMenu, undefined, undefined)!;
    const demand = weeklyBoardingDemandByCell(boarding);
    expect(demand.size).toBe(14); // 7 days x 2 shifts, menu tiles 24h with no gap
    const total = [...demand.values()].reduce((a, b) => a + b, 0);
    // Month is removed as a scale effect, so the per-week cells sum back to the weekly total.
    expect(total).toBeCloseTo(boarding.weeklyBoardingHours, 6);
  });

  it('weeklyBoardingDemandByCell is month-scope-invariant: monthly seasonality does not change the weekly shape total', () => {
    const arrivals = randomArrivals168(33);
    const flat = computeBoarding(arrivals, 0.2, 4, 4, shiftMenu, undefined, undefined)!;
    const seasonal = computeBoarding(arrivals, 0.2, 4, 4, shiftMenu, undefined, twelveFlat())!;
    const flatTotal = [...weeklyBoardingDemandByCell(flat).values()].reduce((a, b) => a + b, 0);
    const seasonalTotal = [...weeklyBoardingDemandByCell(seasonal).values()].reduce((a, b) => a + b, 0);
    expect(seasonalTotal).toBeCloseTo(flatTotal, 6); // all-factor-1 seasonality ⇒ identical representative week
  });

  it('weeklyBoardingCoveredByGrid caps each cell at its own weekly demand', () => {
    const demand = new Map([
      ['1::day', 30],
      ['2::night', 10],
    ]);
    // day1: 2 x 12h = 24 (< 30, uncapped); day2: 1 x 12h = 12 (> 10, capped to 10)
    expect(weeklyBoardingCoveredByGrid({ 1: { day: 2 }, 2: { night: 1 } }, demand, shiftMenu)).toBeCloseTo(34, 6);
    // an oversized headcount can't cover more than the cell's demand
    expect(weeklyBoardingCoveredByGrid({ 1: { day: 10 } }, demand, shiftMenu)).toBeCloseTo(30, 6);
    // headcount for a cell with no demand slot covers nothing
    expect(weeklyBoardingCoveredByGrid({ 5: { nope: 4 } }, demand, shiftMenu)).toBe(0);
  });

  it('annual coverage scales with month scope, reaching the annual total only at full grid + all months', () => {
    const arrivals = randomArrivals168(34);
    const boarding = computeBoarding(arrivals, 0.2, 4, 4, shiftMenu, undefined, twelveFlat())!;
    // Build a grid that fully covers every cell's weekly demand.
    const demand = weeklyBoardingDemandByCell(boarding);
    const fullGrid: Grid = {};
    for (const [key, d] of demand) {
      const [dayStr, shiftId] = key.split('::');
      const len = shiftMenu.find((s) => s.id === shiftId)!.lengthHours;
      fullGrid[Number(dayStr)] = { ...(fullGrid[Number(dayStr)] ?? {}), [shiftId]: Math.ceil(d / len) };
    }
    const all = new Set(Array.from({ length: 12 }, (_, m) => m));
    const coveredAll = annualBoardingCoveredByWeeklyGrid(fullGrid, boarding, shiftMenu, all);
    expect(coveredAll).toBeCloseTo(boarding.annualBoardingHours, 3); // full grid + all months + gapless menu ⇒ ~100%

    const half = new Set([0, 1, 2, 3, 4, 5]);
    const coveredHalf = annualBoardingCoveredByWeeklyGrid(fullGrid, boarding, shiftMenu, half);
    // all-factor-1 months ⇒ scope is linear in month count: 6 of 12 ⇒ half.
    expect(coveredHalf).toBeCloseTo(coveredAll / 2, 3);
  });

  it('with no monthly seasonality, month scope is the whole year (activeMonths ignored/null)', () => {
    const arrivals = randomArrivals168(35);
    const boarding = computeBoarding(arrivals, 0.2, 4, 4, shiftMenu, undefined, undefined)!;
    const demand = weeklyBoardingDemandByCell(boarding);
    const fullGrid: Grid = {};
    for (const [key, d] of demand) {
      const [dayStr, shiftId] = key.split('::');
      const len = shiftMenu.find((s) => s.id === shiftId)!.lengthHours;
      fullGrid[Number(dayStr)] = { ...(fullGrid[Number(dayStr)] ?? {}), [shiftId]: Math.ceil(d / len) };
    }
    expect(annualBoardingCoveredByWeeklyGrid(fullGrid, boarding, shiftMenu, null)).toBeCloseTo(
      boarding.annualBoardingHours,
      3
    );
  });

  it('recommendWeeklyBoardingGrid funds the minimal weekly grid that clears the target band, never empty', () => {
    const result = compute({ arrivals: randomArrivals168(36), wHppvTarget: 1.7, shiftMenu, admitRate: 0.3, boardingDuration: 6 });
    const boarding = result.boarding!;
    const consumed = result.lostProductivity!.wHppvConsumedByBoarding;
    const target = 1.68; // reachable (< wHppvTarget), but demands real coverage
    const grid = recommendWeeklyBoardingGrid(boarding, shiftMenu, 1.7, target, consumed);

    const covered = annualBoardingCoveredByWeeklyGrid(grid, boarding, shiftMenu, null);
    const frac = covered / boarding.annualBoardingHours;
    expect(effectiveEdWhppvAtCoverage(1.7, consumed, frac)).toBeGreaterThanOrEqual(target - 1e-9);
    const totalHeadcount = Object.values(grid).reduce((a, row) => a + Object.values(row).reduce((x, y) => x + y, 0), 0);
    expect(totalHeadcount).toBeGreaterThanOrEqual(1);
  });

  it('recommendWeeklyBoardingGrid funds the full-demand grid when the target is unreachable', () => {
    const result = compute({ arrivals: randomArrivals168(37), wHppvTarget: 1.7, shiftMenu, admitRate: 0.3, boardingDuration: 6 });
    const boarding = result.boarding!;
    const consumed = result.lostProductivity!.wHppvConsumedByBoarding;
    // 1.9 > wHppvTarget (1.7), so even 100% boarding coverage can't reach it ⇒ fund everything.
    const grid = recommendWeeklyBoardingGrid(boarding, shiftMenu, 1.7, 1.9, consumed);
    const covered = annualBoardingCoveredByWeeklyGrid(grid, boarding, shiftMenu, null);
    expect(covered / boarding.annualBoardingHours).toBeCloseTo(1, 2); // gapless menu ⇒ ~100% coverage
  });

  it('boardingCoverageFte converts annual hours to FTE at 2080 hrs/yr', () => {
    expect(boardingCoverageFte(2080)).toBeCloseTo(1, 9);
    expect(boardingCoverageFte(1040)).toBeCloseTo(0.5, 9);
  });
});

describe('Effective ED wHPPV at a given coverage level (ASSUMPTION: linear proportional recovery)', () => {
  it('at 0% coverage, effective wHPPV equals target minus the full amount consumed by boarding', () => {
    expect(effectiveEdWhppvAtCoverage(1.7, 0.3, 0)).toBeCloseTo(1.4, 9);
  });

  it('at 100% coverage, effective wHPPV equals the full target (nothing lost to boarding)', () => {
    expect(effectiveEdWhppvAtCoverage(1.7, 0.3, 1)).toBeCloseTo(1.7, 9);
  });

  it('scales linearly in between', () => {
    expect(effectiveEdWhppvAtCoverage(1.7, 0.3, 0.5)).toBeCloseTo(1.55, 9);
  });

  it('clamps out-of-range coveredFraction inputs', () => {
    expect(effectiveEdWhppvAtCoverage(1.7, 0.3, -0.5)).toBeCloseTo(1.4, 9);
    expect(effectiveEdWhppvAtCoverage(1.7, 0.3, 1.5)).toBeCloseTo(1.7, 9);
  });
});

describe('Lost-productivity metric (Productivity Target Buffer method)', () => {
  it('is null when boarding is withheld', () => {
    const result = compute({ arrivals: randomArrivals168(28), wHppvTarget: 1.7, shiftMenu });
    expect(result.boarding).toBeNull();
    expect(result.lostProductivity).toBeNull();
  });

  it('reports ED-facing wHPPV as the target minus wHPPV consumed by boarding', () => {
    const arrivals = randomArrivals168(29);
    const result = compute({
      arrivals,
      wHppvTarget: 1.7,
      shiftMenu,
      admitRate: 0.25,
      boardingDuration: 5,
    });
    expect(result.lostProductivity).not.toBeNull();
    const consumed = result.boarding!.annualBoardingHours / result.annualVisits;
    expect(result.lostProductivity!.wHppvConsumedByBoarding).toBeCloseTo(consumed, 9);
    expect(result.lostProductivity!.wHppvAvailableForEdCare).toBeCloseTo(1.7 - consumed, 9);
  });
});
