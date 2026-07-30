// §2.4 Backlog / "falling behind" diagnostic.
//
// Evidence status: ASSUMPTION — this models how an ED's unmet demand compounds forward, and
// is derived (not measured). Resolved with Ben 2026-07-24 (see .claude/rules/results-redesign.md
// and the algorithm-spec's evidence-tagging convention — same rigor as the boarding convolution).
//
// 2026-07-26 UPDATE: the Step 3 budget trim DOES now feed on this SAME recurrence (a
// deliberate reversal — see .claude/rules/engine-solver.md's "Budget-capped trim" section) —
// `engine/solver.ts`'s `trimWeekToBudget` minimizes marginal severity while choosing what to
// cut — so "never imported by solver.ts" is no longer true of the MODEL, only of this literal
// function.
//
// 2026-07-28 REVERSAL (NINTH shape, see .claude/rules/engine-solver.md) — the capacity-
// elasticity model (`spare`/`stretch`/`bandCeilingHourly`-as-recurrence-input) is RETIRED,
// replaced by a VISITS-BASED model (see `backlogModel.ts`'s header for the full formula and
// rationale — the old model's `stretch = max(0, bandCeiling - capacity)` was backwards: it
// assumed the WORSE an hour was staffed, the MORE backlog-clearing throughput was available).
// `computeBacklog` now takes `arrivals168` (raw visit counts) + `floorWhppv` (a single flat
// department-level p25-wHPPV scalar, `lookupWhppvBand(annualVisits).p25Whppv`) in place of
// `bandCeilingHourly`. `hourlyRequirement168` STAYS as a parameter — it's still needed for
// severity normalization and the caught-up threshold (both unrelated to which recurrence
// generates the backlog curve).
//
// NO-COMPRESSION DEGENERATE CASE (a disclosed judgment call — see backlogModel.ts's header and
// .claude/rules/engine-solver.md's ninth-shape section): callers whose demand curve isn't
// literally ED-visit arrivals (Panel 1's Boarding/Combined toggles, pptxExport) pass
// `floorWhppv = NO_COMPRESSION_FLOOR_WHPPV` (1) and the demand curve itself as `arrivals168` —
// there's no honest "visits" concept for boarding coverage (a fixed nurse-ratio, not a
// per-visit pace), so no compression is modeled for those curves.
//
// FRAMING: backlog is un-started FRONT-LOADED ARRIVAL WORK — i.e. the waiting room. It clears
// only by nurses compressing their own pace down to the peer-cohort floor (never past it) or
// by genuinely idle capacity — never via a passive attrition/LWBS assumption.
//
// 2026-07-26 PR E (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §4) — structural vs. cyclical
// split, UNCHANGED IN SHAPE by the 2026-07-28 reversal above (only the per-hour step formula
// and what gets rescaled changed, not this split's existence): `computeBacklog` reports
// STRUCTURAL (the per-day floor the ACTUAL backlog curve never drops below —
// `structuralFloorByDay`/`structuralFloorMin`) and CYCLICAL (the SAME recurrence run against
// capacity RESCALED so its weekly total matches the recurrence's OWN requirement-equivalent
// curve's weekly total — `cyclicalBacklog`/`cyclicalLongestStreakHours`/etc.) as SEPARATE
// fields — never blend them into one number again. The "caught up" bar is
// `caughtUpThresholdForHour` (~10% of THAT HOUR's own requirement) instead of a flat constant.

import type { Cell168, Grid, ShiftDef } from './types';
import { fullWeekCapacity, coveringCellsByGlobalHour, totalSeverity, peakSeverityOf } from './solver';
import {
  backlogRecurrence,
  longestStreakAboveThreshold,
  caughtUpThresholds168,
  rescaleCapacityToRequirementTotal,
  BACKLOG_CAUGHT_UP_THRESHOLD,
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
  /** 2026-07-26 (Phase 2b): per-hour backlog flowing INTO this hour from the previous hour
   * (`backlog[h-1]`, BEFORE this hour's own deficit/paydown is applied). Powers
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
   * recurrence's own requirement-equivalent curve's weekly total — isolates SHAPE from SIZE.
   * A department that's genuinely under-target in aggregate will show real ACTUAL backlog but
   * a much smaller CYCLICAL curve (most of its problem is size, not shape); a department
   * that's adequately staffed in aggregate but badly allocated will show the opposite. This is
   * what drives the heatmap overlay, the lean-stretch headline, and the Step 3 trim's own
   * objective (see engine-solver.md) — the trim can only ever fix shape (it operates under a
   * FIXED budget), so its cost signal must be blind to size or it spends effort on a problem
   * it structurally cannot solve. */
  cyclicalBacklog: Cell168;
  cyclicalLongestStreakHours: number;
  cyclicalLongestStreakStart: { day: number; hour: number } | null;
  cyclicalNeverClears: boolean;
  cyclicalPeakBacklog: number;
  cyclicalPeakAt: { day: number; hour: number } | null;
}

/**
 * Compute the backlog diagnostic for ANY grid (idealized or current) against the requirement
 * curve. Pure function, no solver interaction.
 *
 * @param arrivals168 raw visit counts (the recurrence's own "new demand" input, in VISITS) —
 *   pass `NO_COMPRESSION_FLOOR_WHPPV`/the demand-hours curve itself (see backlogModel.ts's
 *   header) for a boarding/combined curve that has no real visits concept.
 * @param hourlyRequirement168 the target-pace nurse-hours curve — used ONLY for severity
 *   normalization and the caught-up threshold, unrelated to which recurrence produced the
 *   backlog curve itself. For a no-compression call, this is typically the SAME array as
 *   `arrivals168`.
 * @param floorWhppv the single flat department-level p25 wHPPV (or `NO_COMPRESSION_FLOOR_WHPPV`
 *   = 1 for a curve with no real visits concept).
 */
export function computeBacklog(
  grid: Grid,
  arrivals168: Cell168,
  hourlyRequirement168: Cell168,
  shifts: ShiftDef[],
  floorWhppv: number
): BacklogResult {
  // Capacity (on-duty headcount) per global hour from the grid — PR A: a day's own early
  // hours can be covered by the PREVIOUS day's shift (spillover), so this must always be
  // computed from the whole grid, not per-day.
  const capacity = fullWeekCapacity(grid, shifts);

  // The recurrence's own requirement-equivalent — the floor-pace-implied hours curve
  // (arrivals*floorWhppv). Used for (a) the per-shift generated/inherited attribution below,
  // and (b) rescaling capacity for the CYCLICAL pass — NOT `hourlyRequirement168` (see
  // backlogModel.ts's `rescaleCapacityToRequirementTotal` header for why the two curves
  // shouldn't be conflated).
  const requirementEquivalent = arrivals168.map((a) => (a ?? 0) * floorWhppv);
  const deficit = requirementEquivalent.map((req, g) => req - capacity[g]);

  // The recurrence itself lives in engine/backlogModel.ts (ninth shape) — circular over the
  // full 168-hour week with NO boundary reset, multi-pass settle so the Sat->Sun carry into
  // backlog[0] is a real value rather than a zero seed. See that file's header for the
  // formula.
  const { backlog, carriedIn } = backlogRecurrence(capacity, arrivals168, floorWhppv);

  // PR E (b) — the "caught up" bar is relative to each hour's own requirement, not a flat
  // nurse-hours constant. See backlogModel.ts's header for the before/after.
  const thresholds = caughtUpThresholds168(hourlyRequirement168);
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
  // as "neverClears." Capacity is rescaled against `requirementEquivalent` (the recurrence's
  // OWN implied-hours curve), not `hourlyRequirement168` — see backlogModel.ts's
  // `rescaleCapacityToRequirementTotal` header.
  const structuralFloorByDay: number[] = [];
  for (let day = 0; day < 7; day++) {
    let dayMin = Infinity;
    for (let h = 0; h < 24; h++) dayMin = Math.min(dayMin, backlog[day * 24 + h]);
    structuralFloorByDay.push(dayMin);
  }
  const structuralFloorMin = Math.min(...structuralFloorByDay);

  const { rescaled: cyclicalCapacity } = rescaleCapacityToRequirementTotal(capacity, requirementEquivalent);
  const { backlog: cyclicalBacklog } = backlogRecurrence(cyclicalCapacity, arrivals168, floorWhppv);
  const cyclicalThresholds = caughtUpThresholds168(hourlyRequirement168);
  const cyclicalStreak = longestStreakAboveThreshold(cyclicalBacklog, cyclicalThresholds);
  let cyclicalPeakBacklog = 0;
  let cyclicalPeakAt: { day: number; hour: number } | null = null;
  for (let g = 0; g < 168; g++) {
    if (cyclicalBacklog[g] > cyclicalPeakBacklog) {
      cyclicalPeakBacklog = cyclicalBacklog[g];
      cyclicalPeakAt = { day: Math.floor(g / 24), hour: g % 24 };
    }
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
  // paydown) and a freshly-generated portion (max(0, deficit) — this hour's own shortfall,
  // against the recurrence's OWN requirement-equivalent curve). Attribute each hour to its
  // covering (day, shift) CELL(s), split evenly at hand-off hours — PR A: this must use the
  // actual covering cell, which can be the PREVIOUS day's shift for spillover hours, not a
  // simple hour-of-day lookup. Aggregated by shiftId only (this diagnostic doesn't
  // distinguish which day a shift's coverage came from).
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
  arrivals168: Cell168,
  hourlyRequirement: Cell168,
  shifts: ShiftDef[],
  floorWhppv: number
): BacklogSeveritySummary {
  const { backlog, cyclicalBacklog } = computeBacklog(grid, arrivals168, hourlyRequirement, shifts, floorWhppv);
  return {
    totalBacklogHours: backlog.reduce((a, b) => a + b, 0),
    totalSeverity: totalSeverity(cyclicalBacklog, hourlyRequirement),
    peakSeverity: peakSeverityOf(cyclicalBacklog, hourlyRequirement),
  };
}
