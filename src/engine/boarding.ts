// Step 2: Boarding line — an hourly boarding-census curve (convolution-derived, see
// .claude/rules/boarding-seasonality.md), converted to a priority-ranked list of
// (month?, day-of-week, shift) coverage slots. Kept additive and never blended into the
// core grid — no solved staffing grid here anymore, just ranked raw demand.
import {
  MONTH_LABELS,
  type BoardingPrioritySlot,
  type BoardingResult,
  type Cell168,
  type Grid,
  type ShiftDef,
} from './types';
import { sum } from './allocate';
import { shiftHoursOfDay } from './solver';

const WEEKS_PER_MONTH = 52 / 12; // approximation: 52 weeks spread evenly across 12 months

/**
 * ASSUMPTION (not independently measured — boarding accumulation is derived from admission
 * timing, not observed census): a patient admitted at hour h boards for the next
 * `duration` hours. Convolves the admission-events curve with a boxcar of that width,
 * circularly across the full 168-cell week (deliberately NOT the shift solver's
 * within-a-single-day model — boarding genuinely spills across day boundaries, e.g. an
 * 11pm Monday admission boards into Tuesday). Fractional duration gets a partial-weight
 * final hour so the total contributed per event is exactly `duration`, preserving the
 * annual total this replaces (see .claude/rules/boarding-seasonality.md).
 */
function convolveBoardingCensus(admitEvents: Cell168, boardingDuration: number | Cell168): Cell168 {
  const n = admitEvents.length;
  const census = new Array(n).fill(0);
  for (let h = 0; h < n; h++) {
    const events = admitEvents[h];
    if (events <= 0) continue;
    const duration = typeof boardingDuration === 'number' ? boardingDuration : boardingDuration[h];
    if (duration <= 0) continue;
    const fullHours = Math.floor(duration);
    const frac = duration - fullHours;
    for (let k = 0; k < fullHours; k++) {
      census[(h + k) % n] += events;
    }
    if (frac > 1e-9) {
      census[(h + fullHours) % n] += events * frac;
    }
  }
  return census;
}

/**
 * Seasonality index from mean boarding duration PER PATIENT (not totals, not a
 * pre-computed multiplier): factor[i] = meanDuration[i] / overallBoardingDuration. A ratio
 * of means is the correct rescaling here because duration multiplies directly into total
 * hours (a mean-based ratio correctly rescales that term; a median would not). Returns
 * undefined if the per-period means are absent/wrong-length or the overall baseline is
 * <= 0 (can't derive a meaningful index) — same graceful-degradation philosophy as every
 * other optional input. See .claude/rules/boarding-seasonality.md.
 */
function deriveSeasonalityFactor(
  meanDurations: number[] | undefined,
  periods: number,
  overallBoardingDuration: number
): number[] | undefined {
  if (!meanDurations || meanDurations.length !== periods) return undefined;
  if (overallBoardingDuration <= 0) return undefined;
  return meanDurations.map((d) => d / overallBoardingDuration);
}

/**
 * Single overall baseline value for `boardingDuration`, used as the denominator of the
 * seasonality ratio. If `boardingDuration` is already a scalar (the common case — the
 * Scalars-tab field), it IS the baseline. If it's an hourly Cell168 array, there is no
 * single obvious baseline — this uses the admit-events-weighted mean (weighted by
 * `arrivals * admitRate` per hour) so the baseline represents the actual mean duration
 * per patient across all admitted patients, consistent with the per-period fields' own
 * "mean per patient" framing. FLAG: this weighting choice hasn't been confirmed with Ben —
 * revisit if an hourly boardingDuration + seasonality totals are ever used together in
 * practice.
 */
function overallMeanBoardingDuration(boardingDuration: number | Cell168, admitEvents: Cell168): number {
  if (typeof boardingDuration === 'number') return boardingDuration;
  const totalEvents = sum(admitEvents);
  if (totalEvents <= 0) return 0;
  return sum(boardingDuration.map((d, i) => d * admitEvents[i])) / totalEvents;
}

/** Every hour 0-23 mapped to the shift(s) covering it, splitting evenly across overlapping
 * shifts (transition windows) so a hand-off hour's demand doesn't get double-counted —
 * same convention as the retired `summarizeShortfallByShift` client-side rollup. */
function hourToShiftShares(shiftMenu: ShiftDef[]): Map<number, Array<{ shiftId: string; share: number }>> {
  const hoursByShift = shiftMenu.map((s) => ({ id: s.id, hours: new Set(shiftHoursOfDay(s)) }));
  const map = new Map<number, Array<{ shiftId: string; share: number }>>();
  for (let h = 0; h < 24; h++) {
    const covering = hoursByShift.filter((x) => x.hours.has(h));
    if (covering.length === 0) continue; // no shift covers this hour — its demand has no slot to land in
    map.set(
      h,
      covering.map((c) => ({ shiftId: c.id, share: 1 / covering.length }))
    );
  }
  return map;
}

/**
 * Breaks the week into (month?, day-of-week, shift) slots and ranks them descending by
 * required annual care hours — the primary boarding output. Reuses `shiftHoursOfDay`
 * (`engine/solver.ts`) to know which hours belong to which shift, rather than
 * reimplementing that mapping; does NOT run `solveShiftFit` — this is raw required demand
 * per slot, not a solved/trimmed staffing recommendation (see
 * .claude/rules/boarding-seasonality.md for why those are different questions).
 */
function rankBoardingPrioritySlots(
  cellBoardingRnHours: Cell168,
  dayFactor: number[] | undefined,
  monthFactor: number[] | undefined,
  shiftMenu: ShiftDef[],
  trueAnnualTotal: number
): BoardingPrioritySlot[] {
  const shareByHour = hourToShiftShares(shiftMenu);
  const shiftLabelById = new Map(shiftMenu.map((s) => [s.id, s.label || s.id]));

  const months: Array<number | null> = monthFactor ? MONTH_LABELS.map((_, m) => m) : [null];
  const weeksMultiplier = monthFactor ? WEEKS_PER_MONTH : 52;

  const raw: Array<{ month: number | null; day: number; shiftId: string; requiredCareHours: number }> = [];

  for (const month of months) {
    const mFactor = month !== null ? monthFactor![month] : 1;
    for (let day = 0; day < 7; day++) {
      const dFactor = dayFactor ? dayFactor[day] : 1;
      const perShift = new Map<string, number>();
      for (let h = 0; h < 24; h++) {
        const shares = shareByHour.get(h);
        if (!shares) continue;
        const cellHours = cellBoardingRnHours[day * 24 + h] * dFactor * mFactor;
        for (const { shiftId, share } of shares) {
          perShift.set(shiftId, (perShift.get(shiftId) ?? 0) + cellHours * share);
        }
      }
      for (const [shiftId, hours] of perShift) {
        if (hours <= 0) continue;
        raw.push({ month, day, shiftId, requiredCareHours: hours * weeksMultiplier });
      }
    }
  }

  raw.sort((a, b) => b.requiredCareHours - a.requiredCareHours);

  // Cumulative % is against the true analytic annual total (passed in, not summed from
  // these slots) — if the shift menu has coverage gaps, slots alone won't reach 100%,
  // which is an honest signal, not a bug. See .claude/rules/boarding-seasonality.md.
  let running = 0;
  return raw.map((s) => {
    running += s.requiredCareHours;
    return {
      month: s.month,
      day: s.day,
      shiftId: s.shiftId,
      shiftLabel: shiftLabelById.get(s.shiftId) ?? s.shiftId,
      requiredCareHours: s.requiredCareHours,
      cumulativePct: trueAnnualTotal > 0 ? Math.min(100, (running / trueAnnualTotal) * 100) : 0,
    };
  });
}

export function computeBoarding(
  arrivals: Cell168,
  admitRate: number | Cell168 | undefined,
  boardingDuration: number | Cell168 | undefined,
  boardingRatioTarget: number,
  shiftMenu: ShiftDef[],
  dayOfWeekMeanBoardingDurationHours: number[] | undefined,
  monthlyMeanBoardingDurationHours: number[] | undefined
): BoardingResult | null {
  // Boarding output is withheld entirely if either required input is absent — never estimated from a placeholder.
  if (admitRate === undefined || boardingDuration === undefined) return null;

  const admitEvents = arrivals.map((a, i) => a * (typeof admitRate === 'number' ? admitRate : admitRate[i]));
  const census = convolveBoardingCensus(admitEvents, boardingDuration);
  const cellBoardingRnHours = census.map((c) => c / boardingRatioTarget);

  const overallBoardingDuration = overallMeanBoardingDuration(boardingDuration, admitEvents);
  const dayFactor = deriveSeasonalityFactor(dayOfWeekMeanBoardingDurationHours, 7, overallBoardingDuration);
  const monthFactor = deriveSeasonalityFactor(monthlyMeanBoardingDurationHours, 12, overallBoardingDuration);

  // Analytic annual total — independent of shift-menu coverage, so it stays correct (and
  // usable for lostProductivity) even if the shift menu has gaps that would make a
  // slot-sum total undercount. See .claude/rules/boarding-seasonality.md.
  const weeklyDayAdjusted = sum(cellBoardingRnHours.map((v, i) => v * (dayFactor ? dayFactor[Math.floor(i / 24)] : 1)));
  const annualBoardingHours = monthFactor ? weeklyDayAdjusted * sum(monthFactor) * WEEKS_PER_MONTH : weeklyDayAdjusted * 52;

  const annualFte = annualBoardingHours / 2080;
  const weeklyBoardingHours = annualBoardingHours / 52;
  const weeklyFte = weeklyBoardingHours / 40;

  const prioritySlots = rankBoardingPrioritySlots(cellBoardingRnHours, dayFactor, monthFactor, shiftMenu, annualBoardingHours);

  return {
    cellBoardingRnHours,
    annualBoardingHours,
    annualFte,
    weeklyBoardingHours,
    weeklyFte,
    hasMonthlySeasonality: monthFactor !== undefined,
    hasDayOfWeekSeasonality: dayFactor !== undefined,
    monthFactors: monthFactor ?? null,
    prioritySlots,
  };
}

const HOURS_PER_FTE_YEAR = 2080;

/**
 * §2.6 single representative-week coverage model (2026-07-24, fourth reversal of the boarding
 * output shape — see .claude/rules/boarding-seasonality.md). Replaces the 2026-07-22/23
 * annual-aggregation model (`deriveBoardingCoverageCells` + `boardingHoursCoveredByGrid` +
 * `restrictPrioritySlotsToActivePeriods`, all removed), whose day-of-week-aggregated cell
 * counts summed a (day, shift) combo across all 12 funded months — so a cell could read "+12"
 * against a ~7 FTE headline, which didn't reconcile and confused users.
 *
 * New model: ONE representative week's incremental headcount per (day, shift). Month toggles
 * scale the STATS (scope of application), never the grid PATTERN. Day toggles are gone — a day
 * that shouldn't get coverage is edited to 0 in the grid directly.
 */

/** Weeks of application implied by a set of active months — month toggles are SCOPE, not
 * pattern (§2.6). With no monthly seasonality there is no month dimension, so the plan applies
 * to the whole year (52 weeks) and month toggles aren't shown. With monthly seasonality each
 * active month contributes its own factor-weighted weeks (a busier month carries more weight),
 * so full-year scope reproduces `annualBoardingHours` exactly. `activeMonths: null` = all
 * months (or "no month dimension"). */
function scopeWeeks(monthFactors: number[] | null, activeMonths: Set<number> | null): number {
  if (!monthFactors) return 52;
  let weeks = 0;
  for (let m = 0; m < 12; m++) {
    if (activeMonths === null || activeMonths.has(m)) weeks += monthFactors[m];
  }
  return weeks * WEEKS_PER_MONTH;
}

/**
 * Representative-week boarding RN-hours per (day, shift), recovered from the priority ranking:
 * a cell's annual hours (summed across its month slots) divided back out by the full-year
 * scope-weeks, so month seasonality (a SCALE effect) is removed and only the day-of-week-
 * adjusted weekly SHAPE remains. Keyed "day::shiftId". This is the fixed pattern the coverage
 * grid is built on; it does not change when month toggles change.
 */
export function weeklyBoardingDemandByCell(boarding: BoardingResult): Map<string, number> {
  const scopeAll = scopeWeeks(boarding.monthFactors, null);
  const byCell = new Map<string, number>();
  for (const slot of boarding.prioritySlots) {
    const key = `${slot.day}::${slot.shiftId}`;
    byCell.set(key, (byCell.get(key) ?? 0) + slot.requiredCareHours);
  }
  if (scopeAll > 0) {
    for (const [key, annual] of byCell) byCell.set(key, annual / scopeAll);
  }
  return byCell;
}

/**
 * Representative-week boarding RN-hours a (day, shift) headcount grid covers, capped per cell
 * at that cell's own weekly demand — a cell can't cover more boarding than it actually has.
 * Pure arithmetic, no solve.
 */
export function weeklyBoardingCoveredByGrid(
  grid: Grid,
  demandByCell: Map<string, number>,
  shiftMenu: ShiftDef[]
): number {
  const lenById = new Map(shiftMenu.map((s) => [s.id, s.lengthHours]));
  let covered = 0;
  for (const [key, demand] of demandByCell) {
    const [dayStr, shiftId] = key.split('::');
    const headcount = grid[Number(dayStr)]?.[shiftId] ?? 0;
    if (headcount <= 0) continue;
    const len = lenById.get(shiftId) ?? 0;
    covered += Math.min(headcount * len, demand);
  }
  return covered;
}

/**
 * Annual boarding hours a weekly grid covers when applied across the active months' scope:
 * weekly coverage × the factor-weighted weeks in scope. Reaches `annualBoardingHours` only at
 * full grid AND all months on AND a gapless shift menu — otherwise it honestly caps below
 * (the same "honest gap" convention the old cumulativePct used: a toggled-off month or a
 * shift-menu coverage gap can never let it reach 100%). `activeMonths: null` = all months.
 */
export function annualBoardingCoveredByWeeklyGrid(
  grid: Grid,
  boarding: BoardingResult,
  shiftMenu: ShiftDef[],
  activeMonths: Set<number> | null
): number {
  const demandByCell = weeklyBoardingDemandByCell(boarding);
  const weeklyCovered = weeklyBoardingCoveredByGrid(grid, demandByCell, shiftMenu);
  return weeklyCovered * scopeWeeks(boarding.monthFactors, activeMonths);
}

/**
 * Default single representative-week coverage grid: funds the highest-value weekly +1 units
 * (stacking within a cell, up to that cell's weekly demand) until effective ED wHPPV clears
 * `targetWhppv` at FULL month scope — a recommended starting point (spec §2.6), not a floor or
 * ceiling. Computed once at full scope; it does NOT change when month toggles change. Funds at
 * least the top unit so the recommendation is never a fully empty grid (mirroring the removed
 * `fundedCountToReachWhppv`'s never-returns-0 behavior). Returns the full-demand grid if even
 * 100% coverage can't reach `targetWhppv` (e.g. `wHppvTarget` is itself below the band).
 */
export function recommendWeeklyBoardingGrid(
  boarding: BoardingResult,
  shiftMenu: ShiftDef[],
  wHppvTarget: number,
  targetWhppv: number,
  wHppvConsumedByBoarding: number
): Grid {
  const demandByCell = weeklyBoardingDemandByCell(boarding);
  const lenById = new Map(shiftMenu.map((s) => [s.id, s.lengthHours]));
  const scopeAll = scopeWeeks(boarding.monthFactors, null);
  const denom = boarding.annualBoardingHours;

  // Break each cell's weekly demand into stackable +1 units, each worth the marginal hours it
  // would cover, then fund highest-value-first.
  const units: Array<{ day: number; shiftId: string; hours: number }> = [];
  for (const [key, demand] of demandByCell) {
    const [dayStr, shiftId] = key.split('::');
    const len = lenById.get(shiftId) ?? 0;
    if (len <= 0 || demand <= 0) continue;
    const maxUnits = Math.ceil(demand / len);
    for (let j = 0; j < maxUnits; j++) {
      units.push({ day: Number(dayStr), shiftId, hours: Math.min(len, demand - j * len) });
    }
  }
  units.sort((a, b) => b.hours - a.hours);

  const grid: Grid = {};
  let weeklyCovered = 0;
  for (const unit of units) {
    weeklyCovered += unit.hours;
    grid[unit.day] = { ...(grid[unit.day] ?? {}), [unit.shiftId]: (grid[unit.day]?.[unit.shiftId] ?? 0) + 1 };
    const coveredFraction = denom > 0 ? (weeklyCovered * scopeAll) / denom : 0;
    if (effectiveEdWhppvAtCoverage(wHppvTarget, wHppvConsumedByBoarding, coveredFraction) >= targetWhppv) break;
  }
  return grid;
}

/** Annual FTE a given number of annual boarding-coverage hours represents. */
export function boardingCoverageFte(annualCoveredHours: number): number {
  return annualCoveredHours / HOURS_PER_FTE_YEAR;
}

/**
 * ASSUMPTION, not yet validated against real data: linear proportional recovery — funding
 * X% of ranked boarding coverage (by `cumulativePct`) is assumed to recover exactly X% of
 * the wHPPV consumed by boarding (`lostProductivity.wHppvConsumedByBoarding`), uniformly
 * across the coverage curve. Real recovery is very unlikely to be perfectly linear (the
 * ranking funds the highest-value slots first, so early coverage plausibly recovers MORE
 * than proportionally, with diminishing returns as cheaper slots get funded) — this is a
 * deliberately simple placeholder pending real data. See .claude/rules/boarding-seasonality.md.
 */
export function effectiveEdWhppvAtCoverage(
  wHppvTarget: number,
  wHppvConsumedByBoarding: number,
  coveredFraction: number
): number {
  const clamped = Math.max(0, Math.min(1, coveredFraction));
  return wHppvTarget - wHppvConsumedByBoarding * (1 - clamped);
}
