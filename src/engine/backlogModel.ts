// The backlog recurrence — in exactly ONE place. LEAF module: no engine imports (takes plain
// capacity/arrivals number arrays, not Grid/ShiftDef), so both `backlog.ts` and `solver.ts` can
// import it without a circular dependency (the problem that previously forced two hand-
// duplicated copies of this formula — see .claude/rules/engine-solver.md's "Budget-capped
// trim" section for the history). Do not reimplement this recurrence a second time anywhere;
// import `backlogRecurrence`/`backlogHourStepHours` instead.
//
// 2026-07-28 REVERSAL (NINTH shape of this area's history, BACKLOG_MODEL_VISITS_BASED_SPEC_
// 2026-07-28.md, see engine-solver.md's dated section) — retires the capacity-elasticity
// model (`spare`/`stretch`/`bandCeilingHourly`-as-recurrence-input) for a VISITS-BASED model.
//
// WHY THE ELASTICITY MODEL WAS WRONG, PRECISELY: it defined `stretch[h] = max(0,
// bandCeilingHourly[h] - capacity[h])` — the gap between a peer-benchmark ceiling and actual
// capacity. This is LARGEST exactly when capacity is LOWEST, meaning the worse an hour was
// staffed, the more backlog-clearing throughput the model assumed was available — backwards.
// The gap to a peer ceiling represents "how many MORE nurses a busy peer department would have
// staffed," not "how much harder your actual on-duty nurses can work." Confirmed by Ben looking
// at a real department's Panel 1: the queue strip claimed to clear by 19:00 while the heatmap
// read red (understaffed vs. peer band) continuously from 08:00 onward — the two displays
// visibly contradicted each other.
//
// THE REPLACEMENT: nurses can compress how much time they spend per patient, down to — but
// never past — the worst pace still considered acceptable for a department of this volume:
// this department's own peer-cohort p25 WHPPV (`lookupWhppvBand(annualVisits).p25Whppv` — the
// SAME flat number that already drives the "below/within/above the typical range" headline
// stat). That's the ceiling on how fast anyone can defensibly go; beyond it, extra patients
// simply don't get adequately seen that hour and become unmet demand carried into the next.
//
// Recurrence, in VISITS (not nurse-hours):
//   demand[h]       = arrivals[h] + backlogVisits[h-1]     // new arrivals PLUS carried-over unseen visits
//   maxServable[h]  = capacity[h] / floorWhppv             // most visits this hour's staffed
//                                                            // nurse-hours can defensibly get
//                                                            // through, fully stretched
//   served[h]       = min(demand[h], maxServable[h])
//   backlogVisits[h] = demand[h] - served[h]                // always >= 0 by construction
//
// `floorWhppv` is a SINGLE FLAT department-level number (confirmed with Ben — not an hour-
// specific band; `bandFloorHourly` isn't actually measured hour by hour, it's the same flat
// p25 number reallocated the same way the point-target budget is, plus a volatility nudge —
// using the flat number here is the simpler, more legible, and correct choice for a model that
// captures the RELATIVE SHAPE of a schedule's shortfall, not a precise wait-time estimate).
//
// NO SEPARATE "spare pays down at some rate" RULE IS NEEDED — it falls out of the min()
// naturally: if capacity is generous enough that maxServable >= demand, everything gets seen
// and backlog clears to exactly zero that hour, without ever invoking the full-stretch pace.
// This is a genuine simplification over the old three-term formula, not just different
// constants — there is no decay term, no separate stretch-vs-spare split to maintain.
//
// REMOVED: `bandCeilingHourly`/`bandCeiling` as a recurrence input (the peer ceiling stays a
// real EngineResult field — `bandCeilingHourly` — used for band-color reporting/heatmap
// coloring/arrivals-vs-band classification elsewhere; it just has no role in THIS recurrence
// anymore). Every function that took a `bandCeilingHourly168` array now takes `arrivals168`
// (visits) + `floorWhppv` (a single scalar) in its place.
//
// NO-COMPRESSION DEGENERATE CASE (a real, disclosed judgment call, not a silent hack — see
// .claude/rules/engine-solver.md's ninth-shape section for the full reasoning and exactly
// which call sites use it): boarding-only and arrivals+boarding COMBINED demand curves (Panel
// 1's Boarding/Combined toggles, `synthesis.ts`'s `computeCombinedReallocation`, `sandbox.ts`'s
// blended `residualDemand`) have no honest "visits" concept — boarding coverage is a fixed
// nurse-to-patient ratio, not a per-visit pace a nurse can compress. For these, callers pass
// `floorWhppv = NO_COMPRESSION_FLOOR_WHPPV` (1) and the demand curve ITSELF (already in nurse-
// hours) as the "arrivals" argument. Algebraically this degenerates the recurrence to a plain
// `backlog[h] = max(0, demand[h] + backlog[h-1] - capacity[h])` — deficit carries forward
// exactly, capacity pays it down 1:1, nothing "stretches" — because there is genuinely no
// stretch story for a curve that isn't ED-visit throughput.

export const NO_COMPRESSION_FLOOR_WHPPV = 1;

export interface BacklogRecurrenceResult {
  /** 168 hours, nurse-hours of accumulated unmet requirement carried forward — the bridged-
   * back-to-hours value (`backlogVisits * floorWhppv`). */
  backlog: number[];
  /** Per-hour backlog flowing INTO this hour from the previous hour, in hours. */
  carriedIn: number[];
  /** The same curve in raw VISITS (== `backlog` when `floorWhppv === 1`, the no-compression
   * case) — exposed for any future consumer that wants visits directly (Ben has explicitly
   * deferred Panel 1's displayed-unit question; this is here so that decision isn't blocked
   * on a later engine change). */
  backlogVisits: number[];
}

export interface BacklogHourStepResult {
  backlogVisits: number;
  carriedInVisits: number;
}

/**
 * ONE hour of the recurrence, in VISITS — the literal formula from this file's header. Kept
 * as the canonical, spec-faithful primitive; `backlogHourStepHours` below is the hours-bridged
 * convenience wrapper every actual consumer in this codebase calls (candidateCutCost's
 * windowed simulation, the full-week `backlogRecurrence`).
 */
export function backlogHourStep(
  priorBacklogVisits: number,
  capacity: number,
  arrivals: number,
  floorWhppv: number
): BacklogHourStepResult {
  const demand = arrivals + priorBacklogVisits;
  const maxServable = floorWhppv > 0 ? capacity / floorWhppv : capacity;
  const served = Math.min(demand, maxServable);
  return { backlogVisits: demand - served, carriedInVisits: priorBacklogVisits };
}

/**
 * Hours-bridged convenience wrapper around `backlogHourStep` — converts the incoming prior
 * backlog (hours) to visits, steps the recurrence, and converts the result back to hours. This
 * is what every actual consumer in this codebase calls (they all already work in nurse-hours),
 * so the visits<->hours conversion happens at exactly one seam rather than being re-derived at
 * each call site.
 */
export function backlogHourStepHours(
  priorBacklogHours: number,
  capacity: number,
  arrivals: number,
  floorWhppv: number
): { backlog: number; carriedIn: number } {
  const priorVisits = floorWhppv > 0 ? priorBacklogHours / floorWhppv : priorBacklogHours;
  const { backlogVisits, carriedInVisits } = backlogHourStep(priorVisits, capacity, arrivals, floorWhppv);
  return { backlog: backlogVisits * floorWhppv, carriedIn: carriedInVisits * floorWhppv };
}

// How many full circular passes the settle loop below needs to converge. Kept unchanged from
// prior shapes (SETTLE_PASSES = 6) — the mechanics of settling (a circular, no-boundary-reset
// recurrence needs multiple full laps to seed a stable Sat->Sun carry) are unaffected by which
// per-hour formula is used. A department with genuinely zero spare/stretch capacity anywhere
// in the whole week (capacity never exceeds the floor-pace-implied demand) has no release
// valve at all under this model — that's the physically honest answer (a truly saturated
// system's queue really does grow without bound), not a bug. Every realistic solved grid has
// SOME hour where capacity exceeds floor-pace demand, so this doesn't arise in practice.
const SETTLE_PASSES = 6;

/**
 * The recurrence, circular over the full 168-hour week with NO boundary reset (a Saturday
 * night backlog carries into Sunday) — run `SETTLE_PASSES` full passes over the week so the
 * final pass's Sat->Sun carry into `backlog[0]` is a converged value, not a zero-seed
 * artifact. Operates on `arrivals168` (visits) + a single flat `floorWhppv` — see this file's
 * header for the no-compression degenerate case (`floorWhppv = NO_COMPRESSION_FLOOR_WHPPV`,
 * `arrivals168` = a nurse-hours demand curve directly) used for boarding/combined curves.
 */
export function backlogRecurrence(capacity168: number[], arrivals168: number[], floorWhppv: number): BacklogRecurrenceResult {
  const backlog = new Array(168).fill(0);
  const carriedIn = new Array(168).fill(0);
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    for (let g = 0; g < 168; g++) {
      const step = backlogHourStepHours(backlog[(g - 1 + 168) % 168], capacity168[g] ?? 0, arrivals168[g] ?? 0, floorWhppv);
      backlog[g] = step.backlog;
      carriedIn[g] = step.carriedIn;
    }
  }
  const backlogVisits = floorWhppv > 0 ? backlog.map((h) => h / floorWhppv) : backlog.slice();
  return { backlog, carriedIn, backlogVisits };
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
 * 2026-07-26 PR E (§4a) — rescales a capacity curve so its WEEKLY TOTAL matches a given
 * "requirement-equivalent" curve's own weekly total, stripping out the SIZE mismatch (is my
 * department over/under-budget in aggregate) so what's left is purely the SHAPE mismatch (is
 * my budget in the wrong hours). This is what makes a backlog curve "CYCLICAL" rather than
 * raw/actual — see `backlog.ts`'s `computeBacklog` header for the structural/cyclical split
 * this feeds, and `.claude/rules/engine-solver.md`'s "Budget-capped trim" PR E section for why
 * the trim's own objective needs this (a FIXED-budget trim can only fix shape, never size —
 * its cost signal must be blind to the one thing it structurally cannot change).
 *
 * 2026-07-28 (ninth shape, visits-based recurrence): callers now pass `arrivals168.map(a =>
 * a*floorWhppv)` (the floor-pace-IMPLIED hours curve) as the "requirement-equivalent" second
 * argument for the real-compression case — NOT `hourlyRequirement168` (the target-pace curve)
 * — since that's the actual total the new recurrence's own demand accumulates against. See
 * `backlog.ts`'s `computeBacklog` and `solver.ts`'s `trimWeekToBudgetCore` for the call sites.
 * This function itself is UNCHANGED — generic over any two arrays — only WHAT gets passed as
 * the second argument changed.
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
