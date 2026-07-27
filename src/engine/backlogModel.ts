// The backlog recurrence — in exactly ONE place. LEAF module: no engine imports (takes plain
// capacity/requirement number arrays, not Grid/ShiftDef), so both `backlog.ts` and `solver.ts`
// can import it without a circular dependency (the problem that previously forced two
// hand-duplicated copies of this formula — see .claude/rules/engine-solver.md's "Budget-capped
// trim" section for the history). Do not reimplement this recurrence a second time anywhere;
// import `backlogRecurrence` instead.
//
// 2026-07-26 PR B (SOLVER_REALISM_SPEC_2026-07-26.md) — REVERSES the single-decay model:
//   backlog[h] = max(0, backlog[h-1] * 0.85 + (req[h] - cap[h]))
// which collapsed three distinct physical processes into one constant and modeled recovery as
// unconstrained and symmetric (one spare nurse-hour retires exactly one nurse-hour of backlog,
// without limit). That's false: backlog in an ED is usually bed- and provider-limited, not
// nurse-limited, and care delivered late already produced its harm. The visible consequence
// (documented in engine-solver.md's own test descriptions before this change) was that
// `candidateCutCost` scored a cut as nearly free whenever a later excess-capacity hour could
// "absorb" it unboundedly — so the trim systematically preferred to cut AT OR BEFORE A PEAK
// when slack existed afterward, which an experienced charge nurse would reject on sight.
//
// New recurrence — three named processes instead of one blended constant:
//   carried[h]  = backlog[h-1] * (1 - abandonRate)     // passive attrition: this IS LWBS
//   newWork[h]  = max(0, req[h] - cap[h])               // fresh shortfall this hour
//   spare[h]    = max(0, cap[h] - req[h])                // excess capacity this hour
//   paydown[h]  = min( carried[h],
//                      spare[h] * recoveryEfficiency,     // a spare nurse-hour retires LESS
//                                                          // than an hour of queued work
//                      carried[h] * maxDrainFraction )     // hard per-hour drain ceiling —
//                                                          // beds/providers/imaging gate it,
//                                                          // not nurse headcount alone
//   backlog[h]  = carried[h] + newWork[h] - paydown[h]
//
// `paydown[h] <= carried[h]` always (it's one of the three terms in the min), so
// `backlog[h] >= newWork[h] >= 0` always — no explicit max(0, ...) clamp is needed; it falls
// out of the formula. (A defensive floor is still applied below for floating-point safety.)
//
// EQUIVALENCE (verified in backlogModel.test.ts, and it's the reason this refactor is trusted
// to be behavior-preserving before the physics change lands): with abandonRate = 0.15,
// recoveryEfficiency = 1, maxDrainFraction = 1, this recurrence is ALGEBRAICALLY IDENTICAL to
// the old max(0, b*0.85 + req - cap) formula for every hour, not just approximately — see the
// proof sketch in that test file. The physics change (moving to the new DEFAULTS below) is a
// SEPARATE step from the refactor and was verified not to alter behavior before the constants
// changed.

export interface BacklogRecurrenceParams {
  /** Fraction of carried backlog that LEAVES the system per hour — this is LWBS. Unlike the
   * other two params, this is measurable in a real ED's own data. */
  abandonRate: number;
  /** A spare nurse-hour retires LESS than an hour of queued work — catch-up loses batching,
   * adds re-triage and reassessment. */
  recoveryEfficiency: number;
  /** Hard ceiling on queue drainage per hour regardless of spare staff — beds, providers and
   * imaging gate it, not nurse headcount alone. THIS is the term that fixes the peak-cutting
   * bias described above. */
  maxDrainFraction: number;
}

export interface BacklogRecurrenceResult {
  /** 168 hours, nurse-hours of accumulated unmet requirement carried forward. */
  backlog: number[];
  /** Per-hour inherited backlog flowing INTO this hour from the previous hour
   * (`backlog[h-1] * (1 - abandonRate)`), BEFORE this hour's own newWork/paydown is applied. */
  carriedIn: number[];
}

export interface BacklogHourStepResult {
  backlog: number;
  carriedIn: number;
}

/**
 * ONE hour of the recurrence — the single canonical implementation of the formula in this
 * file's header. Both the full-week `backlogRecurrence` below AND `engine/solver.ts`'s
 * `candidateCutCost` (a bounded forward simulation over a SUBSET of hours, not the full
 * 168-array) call this same function — there is no third, independently-hand-rolled copy of
 * the formula anywhere in the codebase. If you find yourself writing `Math.max(0, ... - ...)`
 * with `abandonRate`/`recoveryEfficiency`/`maxDrainFraction` in it anywhere else, stop and
 * import this instead.
 */
export function backlogHourStep(
  priorBacklog: number,
  capacity: number,
  requirement: number,
  params: BacklogRecurrenceParams
): BacklogHourStepResult {
  const carried = priorBacklog * (1 - params.abandonRate);
  const newWork = Math.max(0, requirement - capacity);
  const spare = Math.max(0, capacity - requirement);
  const paydown = Math.min(carried, spare * params.recoveryEfficiency, carried * params.maxDrainFraction);
  return { backlog: Math.max(0, carried + newWork - paydown), carriedIn: carried };
}

// How many full circular passes the settle loop below needs to converge. The old single-decay
// model (retention 0.85/hr) vanished a full 168-hour lap in ~0.85^168 ≈ 4e-13 — two passes was
// comfortably converged. The new `backlogAbandonRate = 0.03` decays much more slowly on its
// own (retention 0.97/hr, ~0.97^168 ≈ 0.006/lap in the worst case with no paydown anywhere) —
// two passes would leave a ~0.6% residual at the wraparound point, not negligible. Verified
// empirically (see backlogModel.test.ts): 6 passes converges to full floating-point precision
// even in that worst case. Cheap either way (O(168 * passes), trivial at this scale).
const SETTLE_PASSES = 6;

/**
 * The recurrence, circular over the full 168-hour week with NO boundary reset (a Saturday
 * night backlog carries into Sunday) — run `SETTLE_PASSES` full passes over the week so the
 * final pass's Sat->Sun carry into `backlog[0]` is a converged value, not a zero-seed artifact.
 */
export function backlogRecurrence(
  capacity168: number[],
  requirement168: number[],
  params: BacklogRecurrenceParams
): BacklogRecurrenceResult {
  const backlog = new Array(168).fill(0);
  const carriedIn = new Array(168).fill(0);
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    for (let g = 0; g < 168; g++) {
      const step = backlogHourStep(backlog[(g - 1 + 168) % 168], capacity168[g] ?? 0, requirement168[g] ?? 0, params);
      backlog[g] = step.backlog;
      carriedIn[g] = step.carriedIn;
    }
  }
  return { backlog, carriedIn };
}

/** Below this many nurse-hours of accumulated backlog, an hour counts as "caught up" — a
 * small display threshold so floating-point dust and sub-nurse-hour holes don't read as a
 * streak. Diagnostic-only, tunable; not load-bearing engine math. Lives here (not in
 * `backlog.ts`, which re-exports it for backward compatibility) so `solver.ts`'s trim
 * trajectory (PR D, `SOLVER_REALISM_SPEC_2026-07-26.md`) can share the exact same threshold
 * without importing FROM `backlog.ts` (which imports FROM `solver.ts` — a cycle).
 *
 * 2026-07-26 PR E (`RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §4b) — RETIRED as a standalone
 * absolute threshold, kept only as `BACKLOG_CAUGHT_UP_ABSOLUTE_FLOOR` below (same value, new
 * name/role). The problem: against a peak of 44 nurse-hours (a real department's actual
 * numbers — see engine-solver.md's "Budget-capped trim" PR E section), a queue 98% cleared
 * still read as "behind" under a flat 0.5-hour bar. `caughtUpThresholdForHour` replaces it —
 * ~10% of THAT HOUR's own requirement, floored at the old absolute value so a near-zero-
 * requirement hour doesn't get a degenerate near-zero threshold (which would make every
 * nonzero backlog value read as "still behind," the opposite failure mode). Every consumer of
 * the old flat constant (`backlog.ts`'s `computeBacklog`, `solver.ts`'s trim-trajectory
 * recorder, the heatmap's per-cell `inBacklogStreak` checks) moved to the per-hour version. */
export const BACKLOG_CAUGHT_UP_ABSOLUTE_FLOOR = 0.5;
/** ~10% of an hour's own requirement — see `caughtUpThresholdForHour`'s header above. Tunable
 * display heuristic, not load-bearing math. */
export const BACKLOG_CAUGHT_UP_RELATIVE_FRACTION = 0.1;

/** The "am I caught up" bar for one hour, relative to THAT HOUR's own requirement rather than
 * a flat nurse-hours constant — see the header above for why the flat version was retired. */
export function caughtUpThresholdForHour(requirement: number): number {
  return Math.max(BACKLOG_CAUGHT_UP_ABSOLUTE_FLOOR, BACKLOG_CAUGHT_UP_RELATIVE_FRACTION * requirement);
}

/** Convenience: a full 168-array of `caughtUpThresholdForHour`, matching an hourlyRequirement curve. */
export function caughtUpThresholds168(hourlyRequirement168: number[]): number[] {
  return hourlyRequirement168.map((r) => caughtUpThresholdForHour(r ?? 0));
}

/** @deprecated kept only so nothing importing the old name breaks at the type level; use
 * `caughtUpThresholdForHour`/`caughtUpThresholds168` for any new code. Same value as
 * `BACKLOG_CAUGHT_UP_ABSOLUTE_FLOOR`. */
export const BACKLOG_CAUGHT_UP_THRESHOLD = BACKLOG_CAUGHT_UP_ABSOLUTE_FLOOR;

/**
 * 2026-07-26 PR E (§4a) — rescales a capacity curve so its WEEKLY TOTAL matches the
 * requirement curve's own weekly total, stripping out the SIZE mismatch (is my department
 * over/under-budget in aggregate) so what's left is purely the SHAPE mismatch (is my budget in
 * the wrong hours). This is what makes a backlog curve "CYCLICAL" rather than raw/actual — see
 * `backlog.ts`'s `computeBacklog` header for the structural/cyclical split this feeds, and
 * `.claude/rules/engine-solver.md`'s "Budget-capped trim" PR E section for why the trim's own
 * objective needs this (a FIXED-budget trim can only fix shape, never size — its cost signal
 * must be blind to the one thing it structurally cannot change).
 */
export function rescaleCapacityToRequirementTotal(capacity168: number[], requirement168: number[]): { rescaled: number[]; scale: number } {
  const totalCapacity = capacity168.reduce((a, b) => a + b, 0);
  const totalRequirement = requirement168.reduce((a, b) => a + b, 0);
  const scale = totalCapacity > 0 ? totalRequirement / totalCapacity : 1;
  return { rescaled: capacity168.map((c) => c * scale), scale };
}

export interface StreakResult {
  /** Longest run of consecutive hours (circular over the 168-hour week) at/above the threshold. */
  hours: number;
  /** Where that longest streak begins, or null if it never crosses the threshold anywhere. */
  start: { day: number; hour: number } | null;
  /** True iff every one of the 168 hours is at/above the threshold — a chronic, never-clearing hole. */
  neverClears: boolean;
}

/**
 * Longest circular run of hours at/above `threshold` in a 168-hour array — the single shared
 * implementation `engine/backlog.ts`'s `computeBacklog` (its `longestStreakHours`/
 * `longestStreakStart`/`neverClears` fields) AND `engine/solver.ts`'s trim-trajectory recorder
 * (PR D change 1, `longestLeanStretchHours`) both use, so the two never drift apart on what
 * counts as a "streak." Scans a doubled index space so a streak wrapping the Sat->Sun boundary
 * isn't missed or double-counted.
 */
export function longestStreakAboveThreshold(values168: number[], threshold: number | number[]): StreakResult {
  const behind = values168.map((v, i) => v >= (Array.isArray(threshold) ? (threshold[i] ?? 0) : threshold));
  const neverClears = behind.every(Boolean);
  if (neverClears) {
    return { hours: 168, start: { day: 0, hour: 0 }, neverClears: true };
  }
  let hours = 0;
  let start: { day: number; hour: number } | null = null;
  let run = 0;
  let runStart = 0;
  for (let i = 0; i < 336; i++) {
    const g = i % 168;
    if (behind[g]) {
      if (run === 0) runStart = g;
      run++;
      if (run > hours) {
        hours = Math.min(run, 168);
        start = { day: Math.floor(runStart / 24), hour: runStart % 24 };
      }
    } else {
      run = 0;
    }
  }
  return { hours, start, neverClears: false };
}
