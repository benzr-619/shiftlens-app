// Step 2: Boarding line — an hourly boarding-census curve (convolution-derived, see
// .claude/rules/boarding-seasonality.md), converted to a priority-ranked list of
// (month?, day-of-week, shift) coverage slots. Kept additive and never blended into the
// core grid — no solved staffing grid here anymore, just ranked raw demand.
import {
  DEFAULTS,
  MONTH_LABELS,
  type BoardingPrioritySlot,
  type BoardingResult,
  type Cell168,
  type Grid,
  type ShiftDef,
} from './types';
import { sum } from './allocate';
import { coveringCellsByGlobalHour } from './solver';

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

/**
 * Breaks the week into (month?, day-of-week, shift) slots and ranks them descending by
 * required annual care hours — the primary boarding output. Reuses
 * `coveringCellsByGlobalHour` (`engine/solver.ts`) to know which (day, shift) GRID CELL
 * actually covers each global hour, rather than reimplementing that mapping; does NOT run
 * `solveShiftFit` — this is raw required demand per slot, not a solved/trimmed staffing
 * recommendation (see .claude/rules/boarding-seasonality.md for why those are different
 * questions).
 *
 * 2026-07-26 PR A: the (day, shift) SLOT a global hour's demand lands in is now the
 * ACTUAL COVERING CELL under the global-week shift-hour model — which can be the PREVIOUS
 * calendar day's shift for an early-morning spillover hour (e.g. Saturday's 02:00 boarding
 * census now maps to Friday night's shift cell, not a same-day Saturday shift that hasn't
 * started yet). The day-of-week seasonality factor (`dayFactor`) still applies to the
 * CENSUS hour's own calendar day — that's a property of when the patients arrived, not of
 * which shift ends up staffed to cover them — so it's looked up separately by the census
 * hour's day, unaffected by which cell the demand is attributed to.
 */
function rankBoardingPrioritySlots(
  cellBoardingRnHours: Cell168,
  dayFactor: number[] | undefined,
  monthFactor: number[] | undefined,
  shiftMenu: ShiftDef[],
  trueAnnualTotal: number
): BoardingPrioritySlot[] {
  const coveringCells = coveringCellsByGlobalHour(shiftMenu); // 168 -> [{day, shiftId}]
  const shiftLabelById = new Map(shiftMenu.map((s) => [s.id, s.label || s.id]));

  const months: Array<number | null> = monthFactor ? MONTH_LABELS.map((_, m) => m) : [null];
  const weeksMultiplier = monthFactor ? WEEKS_PER_MONTH : 52;

  const raw: Array<{ month: number | null; day: number; shiftId: string; requiredCareHours: number }> = [];

  for (const month of months) {
    const mFactor = month !== null ? monthFactor![month] : 1;
    // Keyed by the COVERING cell's "day::shiftId" — not necessarily the census hour's own day.
    const perCell = new Map<string, number>();
    for (let g = 0; g < 168; g++) {
      const cells = coveringCells[g];
      if (cells.length === 0) continue; // no shift covers this global hour — its demand has no slot to land in
      const censusDay = Math.floor(g / 24);
      const dFactor = dayFactor ? dayFactor[censusDay] : 1;
      const cellHours = cellBoardingRnHours[g] * dFactor * mFactor;
      const share = 1 / cells.length;
      for (const { day, shiftId } of cells) {
        const key = `${day}::${shiftId}`;
        perCell.set(key, (perCell.get(key) ?? 0) + cellHours * share);
      }
    }
    for (const [key, hours] of perCell) {
      if (hours <= 0) continue;
      const [dayStr, shiftId] = key.split('::');
      raw.push({ month, day: Number(dayStr), shiftId, requiredCareHours: hours * weeksMultiplier });
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

/**
 * The measured boarding path's inputs (SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md) — a
 * new PRIMARY input alongside (not replacing) admitRate/boardingDuration. Passed as its own
 * bag rather than growing computeBoarding's positional-argument list further.
 */
export interface MeasuredBoardingInputs {
  boardingCensusMedical?: Cell168;
  boardingCensusBH?: Cell168;
  monthlyBoardingCensusMedical?: number[];
  monthlyBoardingCensusBH?: number[];
  bhBoardingRatioTarget?: number;
}

/**
 * §3.4 — per-stream seasonality index, weighted by each stream's own RN-hour contribution
 * (NOT a plain average of the two indices) — the two streams are empirically uncorrelated at
 * real departments (medical peaks in different months than BH), so averaging their indices
 * unweighted would misstate both. Absent monthly medical census -> no month dimension at all
 * (undefined), same graceful degradation as the derived path. If BH census exists overall but
 * its monthly array doesn't, BH contributes a FLAT index (1.0 every month) rather than being
 * dropped from the weighted average — its RN-hour weight still counts.
 */
function deriveMeasuredMonthFactors(
  monthlyBoardingCensusMedical: number[] | undefined,
  monthlyBoardingCensusBH: number[] | undefined,
  medicalWeeklyRnHours: number,
  bhWeeklyRnHours: number
): number[] | undefined {
  if (!monthlyBoardingCensusMedical || monthlyBoardingCensusMedical.length !== 12) return undefined;
  const medMean = sum(monthlyBoardingCensusMedical) / 12;
  if (medMean <= 0) return undefined;
  const medIdx = monthlyBoardingCensusMedical.map((v) => v / medMean);

  let bhIdx: number[];
  if (monthlyBoardingCensusBH && monthlyBoardingCensusBH.length === 12) {
    const bhMean = sum(monthlyBoardingCensusBH) / 12;
    bhIdx = bhMean > 0 ? monthlyBoardingCensusBH.map((v) => v / bhMean) : new Array(12).fill(1);
  } else {
    bhIdx = new Array(12).fill(1);
  }

  const totalWeight = medicalWeeklyRnHours + bhWeeklyRnHours;
  if (totalWeight <= 0) return medIdx;
  return medIdx.map((mi, m) => (mi * medicalWeeklyRnHours + bhIdx[m] * bhWeeklyRnHours) / totalWeight);
}

/**
 * The measured path (2026-07-27, §3.2) — directly measured concurrent boarding census, NO
 * convolution, no admit events, no duration spreading. Conserved-total holds trivially by
 * construction: sum(cellBoardingRnHours) === sum(census)/ratio exactly, since there's no
 * redistribution step at all (unlike the derived path's convolution, which needed a test to
 * prove conservation through the redistribution — here it's true by definition).
 */
function computeMeasuredBoarding(
  measured: MeasuredBoardingInputs,
  boardingRatioTarget: number,
  shiftMenu: ShiftDef[],
  hoursPerFteAnnual: number
): BoardingResult {
  const medCensus = measured.boardingCensusMedical!;
  const bhCensus = measured.boardingCensusBH;
  const bhRatio = measured.bhBoardingRatioTarget ?? DEFAULTS.bhBoardingRatioTarget;

  const cellBoardingRnHours = medCensus.map(
    (m, i) => m / boardingRatioTarget + (bhCensus ? bhCensus[i] / bhRatio : 0)
  );

  const medicalWeeklyRnHours = sum(medCensus) / boardingRatioTarget;
  const bhWeeklyRnHours = bhCensus ? sum(bhCensus) / bhRatio : null;

  const monthFactor = deriveMeasuredMonthFactors(
    measured.monthlyBoardingCensusMedical,
    measured.monthlyBoardingCensusBH,
    medicalWeeklyRnHours,
    bhWeeklyRnHours ?? 0
  );

  // No derived day-of-week duration-mean concept applies here — the measured 168-cell census
  // already IS the real day-of-week shape, cell by cell. Day-of-week is always a ranking
  // dimension regardless (same as the derived path — rankBoardingPrioritySlots's own logic).
  const weeklyTotal = sum(cellBoardingRnHours);
  const annualBoardingHours = monthFactor ? weeklyTotal * sum(monthFactor) * WEEKS_PER_MONTH : weeklyTotal * 52;

  const annualFte = annualBoardingHours / hoursPerFteAnnual;
  const weeklyBoardingHours = annualBoardingHours / 52;
  const weeklyFte = weeklyBoardingHours / 40;

  const prioritySlots = rankBoardingPrioritySlots(cellBoardingRnHours, undefined, monthFactor, shiftMenu, annualBoardingHours);

  return {
    cellBoardingRnHours,
    annualBoardingHours,
    annualFte,
    weeklyBoardingHours,
    weeklyFte,
    hasMonthlySeasonality: monthFactor !== undefined,
    hasDayOfWeekSeasonality: true, // the measured census is inherently day-varying, cell by cell
    monthFactors: monthFactor ?? null,
    prioritySlots,
    medicalWeeklyRnHours,
    bhWeeklyRnHours,
    censusSource: 'measured',
  };
}

export function computeBoarding(
  arrivals: Cell168,
  admitRate: number | Cell168 | undefined,
  boardingDuration: number | Cell168 | undefined,
  boardingRatioTarget: number,
  shiftMenu: ShiftDef[],
  dayOfWeekMeanBoardingDurationHours: number[] | undefined,
  monthlyMeanBoardingDurationHours: number[] | undefined,
  measured?: MeasuredBoardingInputs,
  hoursPerFteAnnual: number = DEFAULTS.hoursPerFteAnnual
): BoardingResult | null {
  // Precedence (§3.2): a measured census, when present, is used EXCLUSIVELY — admitRate/
  // boardingDuration are provably ignored (see boarding.test.ts's precedence assertion). No
  // blending, no partial composition between the two paths.
  if (measured?.boardingCensusMedical) {
    return computeMeasuredBoarding(measured, boardingRatioTarget, shiftMenu, hoursPerFteAnnual);
  }

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

  const annualFte = annualBoardingHours / hoursPerFteAnnual;
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
    medicalWeeklyRnHours: null,
    bhWeeklyRnHours: null,
    censusSource: 'derived',
  };
}

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
 * months (or "no month dimension"). Exported so other annualizers (e.g.
 * `annualStaffingHoursForWeeklyGrid`, §2.6.1) share the exact same scope math as coverage
 * rather than re-deriving it — don't duplicate this logic elsewhere. */
export function scopeWeeks(monthFactors: number[] | null, activeMonths: Set<number> | null): number {
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
export function weeklyBoardingDemandByCell(boarding: BoardingResult, shiftMenu?: ShiftDef[]): Map<string, number> {
  // Measured path (2026-07-27): the 168-cell census grid already IS the representative week —
  // no month scaling is baked into it (monthFactors only scale ANNUAL totals separately), so
  // there's no scope to divide back out. Read cellBoardingRnHours directly via the same
  // covering-cell attribution rankBoardingPrioritySlots uses, skipping the prioritySlots
  // round-trip the derived path needs (see .claude/rules/boarding-seasonality.md). Falls back
  // to the derived-path recovery below when no shiftMenu is passed (e.g. existing call sites/
  // tests that don't have one in scope) — still correct, just the round-trip this simplifies.
  if (boarding.censusSource === 'measured' && shiftMenu) {
    const coveringCells = coveringCellsByGlobalHour(shiftMenu);
    const byCell = new Map<string, number>();
    for (let g = 0; g < 168; g++) {
      const cells = coveringCells[g];
      if (cells.length === 0) continue;
      const share = boarding.cellBoardingRnHours[g] / cells.length;
      for (const { day, shiftId } of cells) {
        const key = `${day}::${shiftId}`;
        byCell.set(key, (byCell.get(key) ?? 0) + share);
      }
    }
    return byCell;
  }

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
  const demandByCell = weeklyBoardingDemandByCell(boarding, shiftMenu);
  const weeklyCovered = weeklyBoardingCoveredByGrid(grid, demandByCell, shiftMenu);
  return weeklyCovered * scopeWeeks(boarding.monthFactors, activeMonths);
}

/**
 * §2.6.1 (2026-07-25) — the REAL cost of a weekly grid, as opposed to the demand it covers.
 * Σ headcount[day][shiftId] × shift.lengthHours across every (day, shift) cell that has any
 * headcount at all — NOT capped at that cell's own demand (unlike `weeklyBoardingCoveredByGrid`)
 * and NOT restricted to cells that have a demand slot in the first place. A fixed-length shift
 * bills for its whole block even in the hours where boarding need is lower than what's
 * scheduled, so this is always >= the demand-capped coverage number for the same grid — the gap
 * is the efficiency overhead of shift-block granularity. Pure arithmetic, no solve.
 */
export function weeklyStaffingHoursForGrid(grid: Grid, shiftMenu: ShiftDef[]): number {
  const lenById = new Map(shiftMenu.map((s) => [s.id, s.lengthHours]));
  let hours = 0;
  for (const row of Object.values(grid)) {
    if (!row) continue;
    for (const [shiftId, headcount] of Object.entries(row)) {
      if (!headcount || headcount <= 0) continue;
      hours += headcount * (lenById.get(shiftId) ?? 0);
    }
  }
  return hours;
}

/**
 * Annual staffing hours a weekly grid represents when applied across the active months' scope —
 * the "actual FTE to staff this plan" figure (§2.6.1). Same `scopeWeeks` scaling as
 * `annualBoardingCoveredByWeeklyGrid` (reused, not duplicated), but on the UNCAPPED
 * `weeklyStaffingHoursForGrid` rather than demand-capped coverage, so it captures what
 * fixed-length shift blocks actually cost. For any given grid, `annualStaffingHoursForWeeklyGrid`
 * >= `annualBoardingCoveredByWeeklyGrid` always — equality holds only in the edge case where
 * every staffed cell's scheduled hours (`headcount × lengthHours`) exactly equal that cell's own
 * weekly demand, with no headcount on cells that have no demand at all.
 */
export function annualStaffingHoursForWeeklyGrid(
  grid: Grid,
  boarding: BoardingResult,
  shiftMenu: ShiftDef[],
  activeMonths: Set<number> | null
): number {
  const weeklyStaffing = weeklyStaffingHoursForGrid(grid, shiftMenu);
  return weeklyStaffing * scopeWeeks(boarding.monthFactors, activeMonths);
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
  const demandByCell = weeklyBoardingDemandByCell(boarding, shiftMenu);
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
export function boardingCoverageFte(annualCoveredHours: number, hoursPerFteAnnual: number = DEFAULTS.hoursPerFteAnnual): number {
  return annualCoveredHours / hoursPerFteAnnual;
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
