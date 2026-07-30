// PR G (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §7) — the synthesis chapter: where the
// founding question ("am I understaffed, or misallocated?") actually gets answered. Adds the
// two separate budgets (arrivals, boarding) back together FOR THE READER only — this never
// touches `EngineResult.grid` (the separation stays the thesis, spec §6/§12, and the
// solved core grid is never blended with boarding).
//
// Per §1(5): the page states FINDINGS, not verdicts. This module computes the four numbers +
// one subtraction the synthesis headline needs, and STOPS there — no "which means..." sentence,
// no residual-exists-by-default assumption. `gapHours` can be <= 0 (a real ending, not an
// error: the department already has enough hours in aggregate). See `.claude/rules/
// results-redesign.md`'s PR G section for the three tested endings (§12.3).
//
// PR K (§6.3) — `computeCombinedReallocation` below is the SHARED primitive both this module's
// `computeSynthesis` AND the "constrained boarding reallocation" (`ConstrainedReallocation
// Section.tsx`) use: the same parameter-swap technique as Scenario B (spec §5), just against
// the COMBINED arrivals+boarding demand curve instead of arrivals alone, at the CURRENT total
// hours. Extracted to its own exported function (was inlined in `computeSynthesis` in PR G) so
// PR K doesn't re-derive a third copy of this solve.
import { DEFAULTS, type EngineInputs, type EngineResult, type Cell168, type Grid, type ShiftDef } from './types';
import { fullWeekCapacity } from './solver';
import { reallocateHoursExact } from './exactReallocation';
import { NO_COMPRESSION_FLOOR_WHPPV } from './backlogModel';

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 19;

function isDayHour(hourOfDay: number): boolean {
  return hourOfDay >= DAY_START_HOUR && hourOfDay < DAY_END_HOUR;
}

function shortfallHours(capacity: Cell168, demand: Cell168): number {
  let total = 0;
  for (let g = 0; g < 168; g++) total += Math.max(0, (demand[g] ?? 0) - (capacity[g] ?? 0));
  return total;
}

function totalWeeklyHours(grid: Grid, shiftMenu: ShiftDef[]): number {
  let total = 0;
  for (let day = 0; day < 7; day++) {
    for (const s of shiftMenu) total += (grid[day]?.[s.id] ?? 0) * s.lengthHours;
  }
  return total;
}

export interface CombinedReallocationResult {
  /** Arrivals + boarding demand curve (weekly representative), the curve this reallocation is
   * solved against. */
  combinedRequirement: Cell168;
  /** The reallocated grid — SAME total hours as `currentStaffingGrid`, redistributed against
   * the combined demand. */
  grid: Grid;
  weeklyScheduledHours: number;
  /** Shortfall (nurse-hours) against the COMBINED demand, before/after reallocation. */
  shortfallHoursBefore: number;
  shortfallHoursAfter: number;
  /** Shortfall against ARRIVALS ALONE, before/after reallocation — the "cost on the arrivals
   * side" PR K's constrained-reallocation framing must name: covering boarders with existing
   * hours necessarily takes from arrivals coverage, and `arrivalsShortfallHoursAfter -
   * arrivalsShortfallHoursBefore` is exactly that cost, in the same units as everything else on
   * the page. */
  arrivalsShortfallHoursBefore: number;
  arrivalsShortfallHoursAfter: number;
}

/**
 * Reallocates the SAME current total hours against the COMBINED (arrivals+boarding) demand.
 *
 * 2026-07-29 REVERSAL (Ben's direct ask — see `.claude/rules/engine-solver.md`'s "Exact-hours
 * reallocation" section, and `computeScenarioB`'s matching header in `engine/index.ts`): this
 * used to be the same parameter-swap TRIM technique Scenario B used — it only ever cuts down
 * from a full-coverage upper bound, so it didn't reliably land the reallocated total exactly on
 * `currentStaffedWeeklyHours`. Now uses `reallocateHoursExact` (a REALLOCATION — only ever
 * trades a shift-unit for another, never adds or removes) so total hours are conserved EXACTLY.
 * The NO-COMPRESSION degenerate case still applies (boarding-blended demand has no honest
 * "visits" concept — see backlogModel.ts's header) — `reallocateHoursExact` is called with the
 * combined curve itself as `arrivals168` and `NO_COMPRESSION_FLOOR_WHPPV` as `floorWhppv`, same
 * judgment call as before, just fed to the new function instead of the old one. The ENA floor
 * no longer runs for this reallocation either (same reasoning as Scenario B — it could only add
 * hours, which would break exact conservation). Returns `null` with no current staffing
 * (nothing to reallocate).
 */
export function computeCombinedReallocation(
  result: EngineResult,
  inputs: EngineInputs,
  currentStaffingGrid: Grid
): CombinedReallocationResult | null {
  const currentStaffedWeeklyHours = totalWeeklyHours(currentStaffingGrid, inputs.shiftMenu);
  if (currentStaffedWeeklyHours <= 0) return null;

  const boardingCurve: Cell168 | null = result.boarding?.cellBoardingRnHours ?? null;
  const combinedRequirement: Cell168 = result.hourlyRequirement.map((r, g) => (r ?? 0) + (boardingCurve ? boardingCurve[g] ?? 0 : 0));

  const currentCapacity = fullWeekCapacity(currentStaffingGrid, inputs.shiftMenu);

  const { grid } = reallocateHoursExact(
    currentStaffingGrid,
    inputs.shiftMenu,
    combinedRequirement,
    combinedRequirement,
    NO_COMPRESSION_FLOOR_WHPPV
  );
  const weeklyScheduledHours = currentStaffedWeeklyHours;
  const reallocatedCapacity = fullWeekCapacity(grid, inputs.shiftMenu);

  return {
    combinedRequirement,
    grid,
    weeklyScheduledHours,
    shortfallHoursBefore: shortfallHours(currentCapacity, combinedRequirement),
    shortfallHoursAfter: shortfallHours(reallocatedCapacity, combinedRequirement),
    arrivalsShortfallHoursBefore: shortfallHours(currentCapacity, result.hourlyRequirement),
    arrivalsShortfallHoursAfter: shortfallHours(reallocatedCapacity, result.hourlyRequirement),
  };
}

export interface SynthesisResult {
  arrivalsWeeklyHours: number;
  boardingWeeklyHours: number | null; // null when boarding data absent — single-budget page (§12.2 profile D)
  totalDemandWeeklyHours: number; // arrivals-only when boarding absent
  currentStaffedWeeklyHours: number;
  /** totalDemandWeeklyHours - currentStaffedWeeklyHours. Can be <= 0 — a real ending (spec
   * §12.3: "you have enough hours, they're in the wrong places" / "you're in good shape"),
   * never forced positive. */
  gapHours: number;
  gapFte: number;
  /** % of the COMBINED (day+night) positive shortfall that falls in the daytime block —
   * null when there's no positive shortfall anywhere to attribute (gapHours-style ending). */
  dayShareOfShortfallPct: number | null;
  /** How much of a POSITIVE `gapHours` reallocating the SAME current hours (against the
   * combined arrivals+boarding demand) could close — always >= 0, capped at max(0, gapHours).
   * Zero when gapHours <= 0 (nothing to close) or when reallocation finds no improvement. */
  gapClosedByReallocationHours: number;
  boardingDataPresent: boolean;
}

export function computeSynthesis(result: EngineResult, inputs: EngineInputs, currentStaffingGrid: Grid): SynthesisResult | null {
  const currentStaffedWeeklyHours = totalWeeklyHours(currentStaffingGrid, inputs.shiftMenu);
  if (currentStaffedWeeklyHours <= 0) return null; // no current staffing -> CTA, not a synthesis (caller's job to gate)

  const boardingDataPresent = !!result.boarding;
  const arrivalsWeeklyHours = result.hourlyRequirement.reduce((a, b) => a + (b ?? 0), 0);
  const boardingWeeklyHours = result.boarding?.weeklyBoardingHours ?? null;
  const totalDemandWeeklyHours = arrivalsWeeklyHours + (boardingWeeklyHours ?? 0);
  const gapHours = totalDemandWeeklyHours - currentStaffedWeeklyHours;
  const hoursPerFteAnnual = inputs.hoursPerFteAnnual ?? DEFAULTS.hoursPerFteAnnual;
  const gapFte = (gapHours * 52) / hoursPerFteAnnual;

  const boardingCurve: Cell168 | null = result.boarding?.cellBoardingRnHours ?? null;
  const combinedRequirement: Cell168 = result.hourlyRequirement.map((r, g) => (r ?? 0) + (boardingCurve ? boardingCurve[g] ?? 0 : 0));
  const currentCapacity = fullWeekCapacity(currentStaffingGrid, inputs.shiftMenu);

  let dayGap = 0;
  let nightGap = 0;
  for (let g = 0; g < 168; g++) {
    const shortfall = Math.max(0, combinedRequirement[g] - (currentCapacity[g] ?? 0));
    if (isDayHour(g % 24)) dayGap += shortfall;
    else nightGap += shortfall;
  }
  const dayShareOfShortfallPct = dayGap + nightGap > 0 ? (dayGap / (dayGap + nightGap)) * 100 : null;

  const reallocation = computeCombinedReallocation(result, inputs, currentStaffingGrid);
  const gapClosedByReallocationHours = reallocation
    ? Math.max(0, Math.min(Math.max(0, gapHours), reallocation.shortfallHoursBefore - reallocation.shortfallHoursAfter))
    : 0;

  return {
    arrivalsWeeklyHours,
    boardingWeeklyHours,
    totalDemandWeeklyHours,
    currentStaffedWeeklyHours,
    gapHours,
    gapFte,
    dayShareOfShortfallPct,
    gapClosedByReallocationHours,
    boardingDataPresent,
  };
}
