// §2.4 Backlog / "falling behind" diagnostic.
//
// Evidence status: ASSUMPTION — this models how an ED's unmet demand compounds forward, and
// is derived (not measured). Resolved with Ben 2026-07-24 (see .claude/rules/results-redesign.md
// and the algorithm-spec's evidence-tagging convention — same rigor as the boarding convolution).
//
// DIAGNOSTIC. This specific function (computeBacklog) never feeds the solver — it reads a
// grid that has already been solved/edited and reports how shortfall accumulates. It reuses
// the exact demand/capacity values the shortfall math already uses (no new demand model):
//   demand  = hourlyRequirement[h]           (the smoothed per-hour required headcount)
//   capacity = on-duty headcount from the grid (fullWeekCapacity, same as the wHPPV heatmap)
//
// 2026-07-26 UPDATE: the Step 3 budget trim DOES now feed on this SAME recurrence (a
// deliberate reversal — see .claude/rules/engine-solver.md's "Budget-capped trim" section) —
// `engine/solver.ts`'s `trimWeekToBudget` minimizes marginal backlog-hours while choosing what
// to cut — so "never imported by solver.ts" is no longer true of the MODEL, only of this
// literal function.
//
// 2026-07-26 PR A: capacity is now computed via `fullWeekCapacity` over the WHOLE grid
// (global-week shift-hour attribution — see .claude/rules/engine-solver.md's "Shift
// wraparound model" section), not per-day `coverageForDay` — a day's own early hours can now
// be covered by the PREVIOUS day's shift (spillover), so per-day-independent capacity was no
// longer correct. Same for the shift-attribution split below (`coveringCellsByGlobalHour`
// replaces the old hour-of-day-only `coveringByHod`/`shiftHoursOfDay` lookup).
//
// 2026-07-26 PR B (SOLVER_REALISM_SPEC_2026-07-26.md): the recurrence itself moved to a new
// leaf module, `engine/backlogModel.ts`'s `backlogRecurrence` — see that file's header for the
// full formula and the physics rationale for retiring the old single-decay model. This also
// removes the circular-import problem that used to force a hand-duplicated copy of the
// recurrence in `solver.ts` (`backlog.ts` imports `fullWeekCapacity`/`coveringCellsByGlobalHour`
// FROM `solver.ts`; `solver.ts` now imports the recurrence from `backlogModel.ts` too, a leaf
// module neither of them owns, so there's no cycle and no duplication). Do not reimplement the
// recurrence here again — import it.
//
// DECLINED (recorded so it's not re-litigated): a rework/degradation term — waiting patients
// generating EXTRA nursing work the longer they wait (re-triage, reassessment, complications).
// It is real but second-order and harder to defend with the evidence this tool already leans
// on; explicitly out of scope for PR B. If revisited, it would add a fourth term to the
// recurrence, not replace any of the three above.
//
// FRAMING: backlog is un-started FRONT-LOADED ARRIVAL WORK — i.e. the waiting room — which is
// the direct antecedent of LWBS. This is why `abandonRate` is the one parameter of the three
// that's plausibly measurable from a real ED's own LWBS-rate data, unlike the other two.
//
// 2026-07-26 PR E (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §4) — REVERSAL of part of PR B,
// the SEVENTH shape of the Step 3 trim's history (see .claude/rules/engine-solver.md's
// "Budget-capped trim" section for the full six-shape history this is now a seventh entry in).
//
// THE FINDING this reverses: the model was never wrong about the physics — the REPORTING layer
// was destroying the evidence. A real department's own current-staffing grid, run through this
// exact recurrence, drains its queue overnight EVERY night, bottoming out at a genuinely low
// (but non-zero, and day-varying) floor, then rebuilds through the day — exactly the cyclical
// pattern the department reports living through. But the page reported a flat "neverClears:
// true, 168 of 168 hours behind," because (1) one blended `backlog` curve conflated a real
// STRUCTURAL floor (the amount you start each day already behind — a budget/sizing signal)
// with the CYCLICAL swing around it (a shape signal, independent of total budget size), and
// (2) `BACKLOG_CAUGHT_UP_THRESHOLD`'s flat 0.5 nurse-hour bar was calibrated against peaks an
// order of magnitude smaller than this model's own physics (PR B) now produces — a queue 98%
// drained from a peak of 44 still read as "still behind."
//
// TWO CHANGES, both below: (a) `computeBacklog` now reports STRUCTURAL (the per-day floor the
// ACTUAL backlog curve never drops below — `structuralFloorByDay`/`structuralFloorMin`) and
// CYCLICAL (the SAME recurrence run against capacity RESCALED so its weekly total matches the
// requirement's own weekly total — `cyclicalBacklog`/`cyclicalLongestStreakHours`/etc. — see
// `backlogModel.ts`'s `rescaleCapacityToRequirementTotal` header for why this isolates shape
// from size) as SEPARATE fields — never blend them into one number again. (b) the "caught up"
// bar is now `caughtUpThresholdForHour` (~10% of THAT HOUR's own requirement, floored at the
// old absolute value) instead of a flat constant — see `backlogModel.ts`'s header for the
// full before/after. `neverClears`/`longestStreakHours`/etc. (the ACTUAL/raw curve's own
// diagnostics) now use this per-hour threshold too, not just the new cyclical fields.
//
// (e) `estimatedAbandonedHours` — the fraction of each hour's INHERITED backlog that
// `abandonRate` already removes from the recurrence every hour was computed and discarded;
// now summed and reported (see `BacklogResult.estimatedAbandonedHours` below). This is an
// estimate of WORK abandoned (nurse-hours of queued care that left the system via attrition),
// NOT a patient count and NEVER a dollar figure — do not convert it to either (spec §12).

import type { Cell168, Grid, ShiftDef } from './types';
import { DEFAULTS } from './types';
import { fullWeekCapacity, coveringCellsByGlobalHour, totalSeverity, peakSeverityOf } from './solver';
import {
  backlogRecurrence,
  longestStreakAboveThreshold,
  caughtUpThresholds168,
  rescaleCapacityToRequirementTotal,
  BACKLOG_CAUGHT_UP_THRESHOLD,
  type BacklogRecurrenceParams,
} from './backlogModel';

// Re-exported for backward compatibility — the canonical definition now lives in
// backlogModel.ts (PR D, SOLVER_REALISM_SPEC_2026-07-26.md) so solver.ts's trim-trajectory
// recorder can share the exact same threshold without a circular import. PR E (2026-07-26)
// retired this as the actual caught-up bar (see backlogModel.ts's header) — kept exported so
// nothing importing the name breaks; new code should use `caughtUpThresholdForHour`.
export { BACKLOG_CAUGHT_UP_THRESHOLD };

export interface BacklogShiftDiagnostic {
  shiftId: string;
  shiftLabel: string;
  /** Weekly nurse-hours of backlog this shift walks INTO (carried from prior hours). */
  inheritedBacklog: number;
  /** Weekly nurse-hours of backlog this shift GENERATES itself (fresh shortfall in its hours). */
  generatedBacklog: number;
}

export interface BacklogResult {
  /** 168 hours, nurse-hours of accumulated unmet requirement carried forward. The ACTUAL/raw
   * curve — against real capacity, not rescaled. Never report this alone; see
   * `structuralFloorByDay`/`cyclicalBacklog` below (PR E). */
  backlog: Cell168;
  /** 2026-07-26 (Phase 2b): per-hour inherited backlog flowing INTO this hour from the
   * previous hour (`backlog[h-1] * (1 - abandonRate)` as of PR B — the passive-attrition
   * carry, BEFORE this hour's own newWork/paydown is applied). Powers
   * `engine/backlogFeedback.ts`'s relaxation loop (raise a protected floor by the inherited
   * amount, not the total backlog, which would also count this hour's own freshly-generated
   * shortfall). */
  carriedIn: Cell168;
  /** Longest run of consecutive hours (circular) at/above THAT HOUR's own relative caught-up
   * threshold (PR E — `caughtUpThresholdForHour`, no longer a flat constant). Measured against
   * the ACTUAL/raw curve. */
  longestStreakHours: number;
  /** Where that longest streak begins, or null if the department never falls behind. */
  longestStreakStart: { day: number; hour: number } | null;
  /** True iff the ACTUAL backlog never drops back below its own relative threshold anywhere in
   * the week — a genuine chronic, never-clearing hole. PR E's relative threshold (vs. the old
   * flat 0.5-hour bar) is specifically what makes this claim trustworthy at real-world peak
   * magnitudes — see this file's PR E header note. */
  neverClears: boolean;
  /** Hour-of-day (0-23) the backlog most reliably clears — the "overnight reset" — or null if
   * it rarely/never does. */
  typicalClearHour: number | null;
  peakBacklog: number;
  peakAt: { day: number; hour: number } | null;
  /** Per-shift attribution: does this shift mostly inherit a prior shift's hole or dig its own? */
  shiftDiagnostics: BacklogShiftDiagnostic[];

  // --- PR E (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §4a) — structural vs. cyclical split ---
  /** For each day (0=Sun..6=Sat), the MINIMUM the ACTUAL backlog curve reaches that day —
   * typically near the department's own daily trough hour. A BUDGET signal: "you start
   * Tuesday already 14 nurse-hours behind" is what this number lets you say. Never report a
   * single "structural" scalar without this per-day breakdown available alongside it. */
  structuralFloorByDay: number[];
  /** The minimum across the whole week (= min of `structuralFloorByDay`) — the floor the
   * ACTUAL backlog never drops below anywhere, at any hour. */
  structuralFloorMin: number;
  /** The SAME recurrence, run against capacity RESCALED so its weekly total matches the
   * requirement curve's own weekly total (`rescaleCapacityToRequirementTotal`,
   * `backlogModel.ts`) — isolates SHAPE from SIZE. A department that's genuinely under-budget
   * in aggregate will show real ACTUAL backlog but a much smaller CYCLICAL curve (most of its
   * problem is size, not shape); a department that's adequately staffed in aggregate but
   * badly allocated will show the opposite. This is what drives the heatmap overlay, the
   * lean-stretch headline, and the Step 3 trim's own objective (see engine-solver.md) — the
   * trim can only ever fix shape (it operates under a FIXED budget), so its cost signal must
   * be blind to size or it spends effort on a problem it structurally cannot solve. */
  cyclicalBacklog: Cell168;
  cyclicalLongestStreakHours: number;
  cyclicalLongestStreakStart: { day: number; hour: number } | null;
  cyclicalNeverClears: boolean;
  cyclicalPeakBacklog: number;
  cyclicalPeakAt: { day: number; hour: number } | null;

  // --- PR E change (e) ---
  /** Sum over the week of `abandonRate * backlog[hour-1]` — the nurse-hours of queued work
   * the recurrence's own passive-attrition term already removes every hour, previously
   * computed internally and discarded. An ESTIMATE of WORK abandoned (queued nurse-hours that
   * left the system via attrition), NOT a patient count — never convert to a dollar figure
   * (spec §12). Computed against the ACTUAL/raw curve (real attrition happens to real backlog,
   * not the shape-only cyclical view). */
  estimatedAbandonedHours: number;
}

const DEFAULT_BACKLOG_PARAMS: BacklogRecurrenceParams = {
  abandonRate: DEFAULTS.backlogAbandonRate,
  recoveryEfficiency: DEFAULTS.backlogRecoveryEfficiency,
  maxDrainFraction: DEFAULTS.backlogMaxDrainFraction,
};

/**
 * Compute the backlog diagnostic for ANY grid (idealized or current) against the requirement
 * curve. Pure function, no solver interaction.
 */
export function computeBacklog(
  grid: Grid,
  hourlyRequirement: Cell168,
  shifts: ShiftDef[],
  params: BacklogRecurrenceParams = DEFAULT_BACKLOG_PARAMS
): BacklogResult {
  // Capacity (on-duty headcount) per global hour from the grid — PR A: a day's own early
  // hours can be covered by the PREVIOUS day's shift (spillover), so this must always be
  // computed from the whole grid, not per-day.
  const capacity = fullWeekCapacity(grid, shifts);
  const deficit = hourlyRequirement.map((req, g) => (req ?? 0) - capacity[g]);

  // The recurrence itself lives in engine/backlogModel.ts (PR B) — circular over the full
  // 168-hour week with NO boundary reset, two-pass settle so the Sat->Sun carry into
  // backlog[0] is a real value rather than a zero seed. See that file's header for the
  // formula and physics rationale.
  const { backlog, carriedIn } = backlogRecurrence(capacity, hourlyRequirement, params);

  // PR E (b) — the "caught up" bar is now relative to each hour's own requirement, not a flat
  // nurse-hours constant. See backlogModel.ts's header for the before/after.
  const thresholds = caughtUpThresholds168(hourlyRequirement);
  const behind = backlog.map((b, g) => b >= thresholds[g]);
  // Longest circular run of "behind" hours — shared implementation (backlogModel.ts) so this
  // and solver.ts's trim-trajectory recorder (PR D) never drift on what counts as a "streak."
  const streak = longestStreakAboveThreshold(backlog, thresholds);
  const neverClears = streak.neverClears;
  const longestStreakHours = streak.hours;
  const longestStreakStart = streak.start;

  // PR E (a) — structural (per-day floor of the ACTUAL curve) + cyclical (same recurrence
  // against size-rescaled capacity — shape only). See BacklogResult's header for the full
  // rationale; this is the split that stops a real cyclical-clearing department from reading
  // as "neverClears."
  const structuralFloorByDay: number[] = [];
  for (let day = 0; day < 7; day++) {
    let dayMin = Infinity;
    for (let h = 0; h < 24; h++) dayMin = Math.min(dayMin, backlog[day * 24 + h]);
    structuralFloorByDay.push(dayMin);
  }
  const structuralFloorMin = Math.min(...structuralFloorByDay);

  const { rescaled: cyclicalCapacity } = rescaleCapacityToRequirementTotal(capacity, hourlyRequirement);
  const { backlog: cyclicalBacklog } = backlogRecurrence(cyclicalCapacity, hourlyRequirement, params);
  const cyclicalThresholds = caughtUpThresholds168(hourlyRequirement);
  const cyclicalStreak = longestStreakAboveThreshold(cyclicalBacklog, cyclicalThresholds);
  let cyclicalPeakBacklog = 0;
  let cyclicalPeakAt: { day: number; hour: number } | null = null;
  for (let g = 0; g < 168; g++) {
    if (cyclicalBacklog[g] > cyclicalPeakBacklog) {
      cyclicalPeakBacklog = cyclicalBacklog[g];
      cyclicalPeakAt = { day: Math.floor(g / 24), hour: g % 24 };
    }
  }

  // PR E (e) — nurse-hours of queued work the recurrence's own passive-attrition term already
  // removes every hour (abandonRate * the PRIOR hour's actual backlog), summed across the
  // week. An estimate of work abandoned, never a patient count or a dollar figure.
  let estimatedAbandonedHours = 0;
  for (let g = 0; g < 168; g++) {
    const priorBacklog = backlog[(g - 1 + 168) % 168];
    estimatedAbandonedHours += params.abandonRate * priorBacklog;
  }

  // "Overnight reset": the hour-of-day most reliably caught up across the 7 days.
  let typicalClearHour: number | null = null;
  if (!neverClears) {
    let bestHod = -1;
    let bestClearDays = 0;
    for (let hod = 0; hod < 24; hod++) {
      let clearDays = 0;
      for (let day = 0; day < 7; day++) if (!behind[day * 24 + hod]) clearDays++;
      if (clearDays > bestClearDays) {
        bestClearDays = clearDays;
        bestHod = hod;
      }
    }
    // Only call it a reliable reset if it clears on a majority of days.
    if (bestHod >= 0 && bestClearDays >= 4) typicalClearHour = bestHod;
  }

  // Peak.
  let peakBacklog = 0;
  let peakAt: { day: number; hour: number } | null = null;
  for (let g = 0; g < 168; g++) {
    if (backlog[g] > peakBacklog) {
      peakBacklog = backlog[g];
      peakAt = { day: Math.floor(g / 24), hour: g % 24 };
    }
  }

  // Per-shift inherited-vs-generated attribution. Each hour's backlog decomposes into a
  // carried-in portion (min(carriedIn, backlog) — what survived from prior hours after any
  // paydown) and a freshly-generated portion (max(0, deficit) — this hour's own shortfall).
  // Attribute each hour to its covering (day, shift) CELL(s), split evenly at hand-off hours
  // — PR A: this must use the actual covering cell, which can be the PREVIOUS day's shift
  // for spillover hours, not a simple hour-of-day lookup. Aggregated by shiftId only (this
  // diagnostic doesn't distinguish which day a shift's coverage came from).
  const coveringCells = coveringCellsByGlobalHour(shifts);

  const inherited: Record<string, number> = {};
  const generated: Record<string, number> = {};
  for (const s of shifts) {
    inherited[s.id] = 0;
    generated[s.id] = 0;
  }
  for (let g = 0; g < 168; g++) {
    const covers = coveringCells[g];
    if (covers.length === 0) continue;
    const share = 1 / covers.length;
    const inheritedHere = Math.min(carriedIn[g], backlog[g]);
    const generatedHere = Math.max(0, deficit[g]);
    for (const { shiftId } of covers) {
      inherited[shiftId] += inheritedHere * share;
      generated[shiftId] += generatedHere * share;
    }
  }

  const shiftDiagnostics: BacklogShiftDiagnostic[] = shifts.map((s) => ({
    shiftId: s.id,
    shiftLabel: s.label || s.id,
    inheritedBacklog: inherited[s.id] ?? 0,
    generatedBacklog: generated[s.id] ?? 0,
  }));

  return {
    backlog,
    carriedIn,
    longestStreakHours,
    longestStreakStart,
    neverClears,
    typicalClearHour,
    peakBacklog,
    peakAt,
    shiftDiagnostics,
    structuralFloorByDay,
    structuralFloorMin,
    cyclicalBacklog,
    cyclicalLongestStreakHours: cyclicalStreak.hours,
    cyclicalLongestStreakStart: cyclicalStreak.start,
    cyclicalNeverClears: cyclicalStreak.neverClears,
    cyclicalPeakBacklog,
    cyclicalPeakAt,
    estimatedAbandonedHours,
  };
}

export interface BacklogSeveritySummary {
  totalBacklogHours: number;
  totalSeverity: number;
  peakSeverity: number;
}

/**
 * PR C (SOLVER_REALISM_SPEC_2026-07-26.md, change 5) — scores an already-solved grid on the
 * SAME convex-severity objective `engine/solver.ts`'s `candidateCutCost` minimizes (`severity`/
 * `totalSeverity`/`peakSeverityOf`, PR C), not just raw backlog-hours. Used to populate
 * `EngineResult.totalBacklogHours`/`totalSeverity`/`peakSeverity` and to rank flexMenu
 * candidates (and the current menu, solved one-shot for a fair comparison — see `flexMenu.ts`)
 * on the actual objective rather than total shortfall.
 *
 * PR E (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §4a): `totalSeverity`/`peakSeverity` now
 * score the CYCLICAL backlog curve (shape-only, size-rescaled), not the actual/raw one —
 * this is the objective the budget-capped Step 3 trim optimizes, and a FIXED-budget trim can
 * only ever fix shape, never size, so its cost signal must be blind to size or it spends
 * effort on a problem it structurally cannot solve (same reasoning `candidateCutCost` in
 * `solver.ts` follows — see engine-solver.md's PR E section). `totalBacklogHours` STAYS the
 * actual/raw total (unchanged meaning — "how much has really accumulated," a size-sensitive
 * number on purpose, for consumers that want the real total rather than the shape-only view).
 */
export function summarizeBacklogSeverity(
  grid: Grid,
  hourlyRequirement: Cell168,
  shifts: ShiftDef[],
  params?: BacklogRecurrenceParams
): BacklogSeveritySummary {
  const { backlog, cyclicalBacklog } = computeBacklog(grid, hourlyRequirement, shifts, params);
  return {
    totalBacklogHours: backlog.reduce((a, b) => a + b, 0),
    totalSeverity: totalSeverity(cyclicalBacklog, hourlyRequirement),
    peakSeverity: peakSeverityOf(cyclicalBacklog, hourlyRequirement),
  };
}
