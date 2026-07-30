// Step 3: fit the smoothed core-hours curve to a shift menu.
// 5.2 full-coverage solve (upper bound) -> 5.3 budget-capped JOINT WHOLE-WEEK backlog-
// minimizing trim (the actual output — THIRD reversal of this section, see .claude/rules/
// engine-solver.md's "Budget-capped trim" section for the full history) -> 5.6 department-
// level ENA floor check.
import type { Grid, ShiftDef, ShortfallEntry } from './types';
import {
  backlogHourStepHours,
  backlogRecurrence,
  longestStreakAboveThreshold,
  caughtUpThresholds168,
  rescaleCapacityToRequirementTotal,
} from './backlogModel';

// ---------------------------------------------------------------------------------------
// 2026-07-26 PR A REVERSAL — shift-hour attribution is now GLOBAL-WEEK circular, not
// day-local circular. See SOLVER_REALISM_SPEC_2026-07-26.md's PR A and .claude/rules/
// engine-solver.md's "Shift wraparound model" section for the full rationale: a shift
// assigned to day `d` used to wrap back into day `d`'s own early hours when it crossed
// midnight (a Saturday 19:00 shift covered Saturday 00:00-06:00 too) — physically wrong,
// since that pre-dawn block is really the tail of FRIDAY night's crew. Now a shift assigned
// to day `d` covers global hours `(d*24 + startHour + i) mod 168` for i in
// [0, lengthHours) — circular over the FULL WEEK (only wraps Sat->Sun at the week boundary
// itself), the same convention boarding.ts's convolution already used. `shiftHoursOfDay`
// (day-local) is renamed `shiftGlobalHours(day, shift)` since the day-local reading is now
// actively misleading. Every function that derived per-day coverage from a single day's
// headcount object now needs the WHOLE grid, since a day's actual on-duty coverage can
// depend on the PREVIOUS day's shift (spillover in) as well as its own.
// ---------------------------------------------------------------------------------------

/** Global hours (0-167) covered by one instance of a shift assigned to `day` (0=Sunday).
 * Circular over the FULL WEEK, not per-day. */
function shiftGlobalHours(day: number, shift: ShiftDef): number[] {
  const hours: number[] = [];
  for (let i = 0; i < shift.lengthHours; i++) {
    hours.push((day * 24 + shift.startHour + i) % 168);
  }
  return hours;
}

/** Full 168-hour on-duty capacity from a whole-week grid (all 7 days), in global-hour
 * space — the primary capacity computation everything else derives from. */
function fullWeekCapacity(grid: Grid, shifts: ShiftDef[]): number[] {
  const capacity = new Array(168).fill(0);
  for (let day = 0; day < 7; day++) {
    const headcount = grid[day] ?? {};
    for (const shift of shifts) {
      const hc = headcount[shift.id] ?? 0;
      if (hc <= 0) continue;
      for (const g of shiftGlobalHours(day, shift)) capacity[g] += hc;
    }
  }
  return capacity;
}

/** One day's 24-hour coverage slice, derived from the full week's capacity — a day's own
 * early hours can be covered by the PREVIOUS day's shift (spillover), so this always needs
 * the whole grid, never just `grid[day]`. */
function coverageForDay(grid: Grid, shifts: ShiftDef[], day: number): number[] {
  return fullWeekCapacity(grid, shifts).slice(day * 24, day * 24 + 24);
}

/** For every global hour (0-167), the (day, shiftId) grid cell(s) whose headcount would
 * actually need to change to add capacity there — i.e. which shift ASSIGNMENT structurally
 * covers that hour, honoring cross-midnight spillover (a shift assigned to day `d` can cover
 * into day `d+1`'s early hours; the cell that "owns" that coverage stays day `d`). Splits
 * evenly across shifts that overlap at a hand-off hour, same convention used everywhere
 * else. Used by anything that needs to attribute a global hour's demand/backlog to the grid
 * cell that would need to change to affect it (boarding's priority ranking, backlog's
 * shift-attribution, the band-floor "worst stretch" shift label) — independent of whether
 * that cell currently has any headcount at all (a structural mapping, not a capacity one). */
function coveringCellsByGlobalHour(shifts: ShiftDef[]): Array<Array<{ day: number; shiftId: string }>> {
  const result: Array<Array<{ day: number; shiftId: string }>> = Array.from({ length: 168 }, () => []);
  for (let day = 0; day < 7; day++) {
    for (const s of shifts) {
      for (const g of shiftGlobalHours(day, s)) {
        result[g].push({ day, shiftId: s.id });
      }
    }
  }
  return result;
}

/**
 * 5.2 Full-coverage solve: minimum headcount per (day, shift) slot such that every one of
 * the week's 168 global hours meets its requirement. JOINT over the whole week (not
 * per-day) — REQUIRED now that a shift's coverage can spill across a day boundary, since a
 * day's own early-hour deficit might only be solvable by bumping the PREVIOUS day's shift,
 * not that day's own. Small covering problem, solved by direct greedy search: repeatedly
 * bump whichever (day, shift) candidate relieves the most currently-deficient global hours.
 * For a non-wrapping shift menu this is provably equivalent to solving each day
 * independently (no candidate's coverage ever crosses into another day, so each day's own
 * greedy trajectory is unaffected by interleaving with any other day) — see
 * SOLVER_REALISM_SPEC_2026-07-26.md PR A's no-op regression test.
 */
function solveFullCoverageWeek(hourlyRequirement168: number[], shifts: ShiftDef[]): Grid {
  const grid: Grid = {};
  for (let day = 0; day < 7; day++) {
    grid[day] = {};
    for (const s of shifts) grid[day][s.id] = 0;
  }
  if (shifts.length === 0) return grid;

  let guard = 0;
  while (guard++ < 700000) {
    const capacity = fullWeekCapacity(grid, shifts);
    let deficitHours = 0;
    for (let g = 0; g < 168; g++) if (capacity[g] < hourlyRequirement168[g]) deficitHours++;
    if (deficitHours === 0) break;

    let bestDay = -1;
    let bestShiftId: string | null = null;
    let bestScore = -1;
    for (let day = 0; day < 7; day++) {
      for (const s of shifts) {
        const hours = shiftGlobalHours(day, s);
        const score = hours.filter((g) => capacity[g] < hourlyRequirement168[g]).length;
        if (score > bestScore) {
          bestScore = score;
          bestDay = day;
          bestShiftId = s.id;
        }
      }
    }
    if (bestShiftId === null || bestScore <= 0) break; // no candidate can help; avoid infinite loop
    grid[bestDay][bestShiftId] += 1;
  }
  return grid;
}

// ---------------------------------------------------------------------------------------
// 2026-07-26 REVERSAL — Step 3's budget trim now actively MINIMIZES BACKLOG, reversing the
// "backlog is diagnostic-only, never feeds the solver" rule (see .claude/rules/
// engine-solver.md's "Budget-capped trim" section for the full history — this is the THIRD
// shape this section has taken). Confirmed intentional with Ben, same category as the
// 2026-07-24 shift-menu-flexibility reversal. The per-day proportional budget split and the
// band-floor DEADBAND cost (both 2026-07-25) are gone — replaced by a single JOINT trim over
// the whole 168-hour week, minimizing actual backlog impact, with the band floor demoted to
// a large-but-finite guardrail penalty rather than either a cost term or a hard exclusion.
// `hourWeight`/transition-hour weighting is also gone — the new cost function is a direct
// physical measure (marginal backlog-hours), fully specified with no per-hour weight slot;
// `transitionWeight`/`transitionWindowHours` are no longer read by the solver as a result
// (they remain valid EngineInputs/DEFAULTS fields, just currently unconsumed — flagged in
// engine-solver.md, not silently dropped from the type surface).
// ---------------------------------------------------------------------------------------

/**
 * Full-week baseline backlog, straight from `engine/backlogModel.ts`'s `backlogRecurrence` —
 * PR B removed the circular-import problem that used to force a hand-duplicated local copy of
 * this loop, so this is now a thin wrapper that just discards `carriedIn` (only `candidateCutCost`'s
 * per-candidate windowed simulation needs the single-step primitive, `backlogHourStepHours`,
 * below).
 *
 * 2026-07-26 PR E (`RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §4a, engine-solver.md's PR E
 * section): callers now pass the CYCLICAL (size-rescaled) capacity here, not raw capacity —
 * see the callers below for why.
 *
 * 2026-07-28 (ninth shape): `arrivals168`/`floorWhppv` replace the retired `bandCeilingHourly168`
 * — see backlogModel.ts's header for the visits-based formula.
 */
function backlogFromCapacity(capacity: number[], arrivals168: number[], floorWhppv: number): number[] {
  return backlogRecurrence(capacity, arrivals168, floorWhppv).backlog;
}

// A single headcount-unit cut only ever perturbs capacity within the (at most 24) real hours
// one (day, shift) candidate covers, so a bounded forward resimulation from the earliest
// perturbed hour reconverges toward the true full-week backlog rather than needing an O(168)
// recompute per candidate — the O(168) recompute still happens, but only ONCE per outer trim
// iteration, never per candidate.
//
// 2026-07-28 CAVEAT (ninth shape — updated, the prior abandonment-model caveat here no longer
// applies since that model was already retired): the visits-based recurrence has NO decay term
// at all — a chronic hole that never crosses a genuinely well-staffed (capacity >= floor-pace-
// implied demand) hour persists indefinitely rather than fading. A 48-hour window can therefore
// meaningfully UNDER-count a cut's true marginal cost in a genuinely chronic, no-recovery-nearby
// stretch (the perturbation's effect simply never gets a chance to clear within the window). This
// is a judgment call left AS-IS (widening the window is a bigger, separate performance tradeoff,
// not something this rewrite was scoped to touch) — every candidate compared within the same
// outer iteration is truncated by roughly the same proportional amount, so the RELATIVE ranking
// (all `trimWeekToBudget` actually needs) is less affected than the absolute magnitude, but this
// is a real approximation gap, not a proven-negligible one. Revisit if a realistic scenario shows
// the trim making a visibly wrong call because of it.
const BACKLOG_SIM_WINDOW_HOURS = 48;

// ---------------------------------------------------------------------------------------
// 2026-07-26 PR C REVERSAL (SOLVER_REALISM_SPEC_2026-07-26.md) — the objective becomes CONVEX
// in shortfall depth, peak becomes a real cost term (not just a tie-break), and the 1e6
// floor-breach cliff is retired for a smooth, steeper, still-finite power-law penalty. See
// .claude/rules/engine-solver.md's "Budget-capped trim" section for the full history and the
// FLOOR_WEIGHT validation. PROBLEM this fixes: the prior objective was a LINEAR sum of
// marginal backlog-hours — ten nurse-hours of backlog concentrated in one hour scored
// IDENTICALLY to one nurse-hour spread across ten. Every outcome an ED actually cares about
// (wait times, LWBS, safety events) is convex in shortfall depth, so a linear objective is
// indifferent between "shallow everywhere" and "catastrophic on one night," and will trade the
// latter for small gains elsewhere. This was itself a regression from the 2026-07-25 band-floor
// deadband's `(floor - coverage)^1.8`, which WAS convex — moving to backlog as the variable was
// the right change, but the curvature was dropped along the way. This PR takes it back, applied
// to the better (backlog, not point-target) variable.
// ---------------------------------------------------------------------------------------

// Convex severity curve exponent. severity = (backlog / max(requirement, 1)) ^ SEVERITY_GAMMA
// — normalized by REQUIREMENT, not raw nurse-hours: two nurses short at an hour needing ten is
// a bad hour, two short at an hour needing three is a crisis, and raw nurse-hours can't tell
// the difference (which is exactly why the old linear-backlog-hours objective was willing to
// flatten peaks). The `max(requirement, 1)` guards the divisor for requirement-0 cells
// (overnight hours in very low-volume EDs) without needing a separate branch.
export const SEVERITY_GAMMA = 1.8;

export function severity(backlog: number, requirement: number): number {
  return Math.pow(Math.max(0, backlog) / Math.max(requirement, 1), SEVERITY_GAMMA);
}

/** Total severity across an arbitrary (already-computed) 168-hour backlog curve — the same
 * objective `candidateCutCost` minimizes, exposed for scoring an already-solved grid (PR C
 * change 5: `EngineResult.totalSeverity`/flexMenu candidate ranking need this independent of
 * any single-cut delta). */
export function totalSeverity(backlog168: number[], hourlyRequirement168: number[]): number {
  let total = 0;
  for (let g = 0; g < 168; g++) total += severity(backlog168[g] ?? 0, hourlyRequirement168[g] ?? 0);
  return total;
}

/** Peak severity across an arbitrary 168-hour backlog curve — same normalization as
 * `severity`/`totalSeverity`, used for `EngineResult.peakSeverity`. */
export function peakSeverityOf(backlog168: number[], hourlyRequirement168: number[]): number {
  let peak = 0;
  for (let g = 0; g < 168; g++) {
    const s = severity(backlog168[g] ?? 0, hourlyRequirement168[g] ?? 0);
    if (s > peak) peak = s;
  }
  return peak;
}

// Promotes the worst hour in the simulated window from a tie-break to a real cost component.
// A convex SUM alone will still trade one catastrophic shift for diffuse small gains if the
// arithmetic works out — managers, regulators and plaintiffs' attorneys care about the worst
// night, not the average night. Kept modest relative to the summed severity term (which already
// carries most of the signal) — this is a corrective nudge against the worst hour, not a
// replacement for the convex sum. The existing lower-peak tie-break (see `trimWeekToBudget`) is
// kept too, for cost-ties the peak term itself doesn't fully resolve.
const PEAK_WEIGHT = 0.3;

// Retired 2026-07-26 (PR C): the old BAND_FLOOR_BREACH_PENALTY = 1e6 was a discontinuous cliff
// — `1e6 * depth` scores a 1-unit breach and a 10-unit breach as proportionally identical
// (10x), when a DEEP breach should cost disproportionately more than a shallow one. Replaced by
// a smooth, steeper power-law penalty: FLOOR_WEIGHT * depth^FLOOR_GAMMA. FLOOR_GAMMA=2 makes a
// deep breach cost quadratically more than a shallow one (the property the flat 1e6 model
// couldn't express at all). FLOOR_WEIGHT=75 was validated two ways (see
// `solver.test.ts`'s PR C describe block and engine-solver.md's report): (1) it still
// comfortably dominates ordinary severity costs in every normal scenario tried (a realistic
// severity term is typically O(1)-O(10); a 1-unit floor breach alone costs 75, a 2-unit breach
// 300) — so the trim strongly prefers a non-breaching alternative whenever one exists; (2) the
// existing zero-slack test (floor == starting headcount everywhere, capHours = 0) still reaches
// the cap EXACTLY — finite cost never blocks the trim from continuing once every remaining
// candidate breaches, so "too high, reinvents the cliff" isn't possible by construction (only
// an infinite penalty could do that); the concern from the spec's caution ("too low breaches
// too readily") is what was checked with (1). Both are FINITE-penalty properties the old 1e6
// model had by luck of its sheer size, not by design — this one is deliberately shaped for both.
const FLOOR_WEIGHT = 75;
const FLOOR_GAMMA = 2;

export interface CandidateCutCost {
  /** Marginal cost of this cut: convex severity delta + peak-severity term + any floor penalty. */
  cost: number;
  /** Resulting peak SEVERITY within the simulated window — the tie-break signal (unchanged in
   * spirit from the pre-PR-C peak-backlog tie-break, now expressed in the same severity units
   * the rest of the objective uses). */
  peakSeverityInWindow: number;
  /** True if this candidate would push any of its hours below protectedFloorHourly168. */
  breached: boolean;
}

/**
 * Marginal cost of removing ONE headcount unit from (day, shift): the convex severity delta
 * this single cut would cause (via the bounded forward simulation above), plus a weighted
 * peak-severity term, plus a smooth power-law floor-breach penalty if applicable.
 * `capacity`/`baselineBacklog` are the CURRENT (pre-candidate) full-week 168-arrays — computed
 * ONCE per outer trim iteration by the caller and reused across every candidate that
 * iteration, never recomputed per candidate. `protectedFloorHourly168` is the UNCLAMPED
 * protected floor (PR C change 4, see `engine/demandBand.ts`) — NOT the clamped
 * `bandFloorHourly` reporting curve.
 */
// 2026-07-26 (Phase 2a, BACKLOG_FEEDBACK_AND_VARIANCE_SPEC_2026-07-25.md): a cut at a
// high-volatility hour (per-cell p75-vs-mean arrivals spread, engine/demandBand.ts) is more
// likely to actually manifest as real backlog than the same raw cut at a low-volatility hour
// — the mean-only backlog-cost simulation above can't see that on its own. Folded in as a
// multiplier on the severity delta (NOT the floor-breach penalty, which is already informed by
// volatility indirectly via the volatility-buffered protected floor itself) — a
// display/optimization heuristic weight, safe to tune.
const VOLATILITY_COST_WEIGHT = 1;

// 2026-07-26 PR E (§4a): the severity simulation below runs against CYCLICAL capacity (size-
// rescaled so its weekly total matches the recurrence's own requirement-equivalent total)
// rather than raw capacity — a FIXED-budget trim can only ever redistribute hours, never add
// to the total, so its own cost signal must be blind to whether the total itself is short
// (that's a budget/sizing question, answered elsewhere — the funding-ask surface, §7
// synthesis) and sensitive only to shape. The FLOOR-BREACH check stays against RAW capacity (a
// real physical "can I actually staff this low" constraint, not a shape concept) —
// `cyclicalCapacity`/`capacityScale` are ONLY used for the severity-delta simulation.
// `capacityScale` converts a real 1-headcount-unit cut into its size-normalized equivalent
// (`scale` nurse-hours) for that simulation.
//
// 2026-07-28 (ninth shape): `arrivals168`/`floorWhppv` replace the retired
// `bandCeilingHourly168` as the recurrence's own inputs — see backlogModel.ts's header for the
// visits-based formula and the no-compression degenerate case (boarding/combined curves pass
// `floorWhppv = NO_COMPRESSION_FLOOR_WHPPV`, `arrivals168` = the demand curve itself).
// `hourlyRequirement168` is UNCHANGED in role — severity normalization only.
export function candidateCutCost(
  day: number,
  shift: ShiftDef,
  capacity: number[],
  cyclicalCapacity: number[],
  capacityScale: number,
  baselineBacklog: number[],
  hourlyRequirement168: number[],
  protectedFloorHourly168: number[],
  demandVolatilityHourly168: number[],
  arrivals168: number[],
  floorWhppv: number
): CandidateCutCost {
  const perturbedHours = shiftGlobalHours(day, shift);
  const perturbedSet = new Set(perturbedHours);
  const gStart = Math.min(...perturbedHours);

  let floorPenalty = 0;
  let breached = false;
  for (const g of perturbedHours) {
    const newCap = capacity[g] - 1;
    const floor = protectedFloorHourly168[g] ?? 0;
    const depth = Math.max(0, floor - newCap);
    if (depth > 0) {
      breached = true;
      floorPenalty += FLOOR_WEIGHT * Math.pow(depth, FLOOR_GAMMA);
    }
  }

  const avgVolatility =
    perturbedHours.reduce((acc, g) => acc + (demandVolatilityHourly168[g] ?? 0), 0) / perturbedHours.length;
  const volatilityMultiplier = 1 + VOLATILITY_COST_WEIGHT * avgVolatility;

  let prior = baselineBacklog[(gStart - 1 + 168) % 168];
  let severityDelta = 0;
  let peakSeverityBefore = 0;
  let peakSeverityAfter = 0;
  for (let i = 0; i < BACKLOG_SIM_WINDOW_HOURS; i++) {
    const g = (gStart + i) % 168;
    const req = hourlyRequirement168[g] ?? 0;
    const cap = cyclicalCapacity[g] - (perturbedSet.has(g) ? capacityScale : 0);
    const newBacklog = backlogHourStepHours(prior, cap, arrivals168[g] ?? 0, floorWhppv).backlog;

    const sevBefore = severity(baselineBacklog[g] ?? 0, req);
    const sevAfter = severity(newBacklog, req);
    severityDelta += sevAfter - sevBefore;
    if (sevBefore > peakSeverityBefore) peakSeverityBefore = sevBefore;
    if (sevAfter > peakSeverityAfter) peakSeverityAfter = sevAfter;

    prior = newBacklog;
  }
  const peakDelta = peakSeverityAfter - peakSeverityBefore;

  const cost = severityDelta * volatilityMultiplier + PEAK_WEIGHT * peakDelta + floorPenalty;
  return { cost, peakSeverityInWindow: peakSeverityAfter, breached };
}

/**
 * 5.3 Budget-capped trim — JOINT over the whole week, no fixed per-day budget share. Starts
 * from each day's full-coverage headcount (the 5.2 upper bound) and repeatedly removes
 * whichever single headcount unit, from ANYWHERE in the week, has the least marginal convex
 * SEVERITY cost (`candidateCutCost`) — free to cut more from one day and less from another if
 * that minimizes total severity, as long as total scheduled hours still reaches `capHours`.
 * Ties broken by the resulting peak severity within the simulated window (lower wins). The
 * protected floor is a large-but-finite guardrail (folded into `candidateCutCost`'s cost via a
 * smooth power-law penalty, PR C), never a hard exclusion — see the reversal note above.
 * `protectedFloorHourly168` is the UNCLAMPED floor (PR C change 4) — pass
 * `EngineResult.protectedFloorHourly`, NOT `bandFloorHourly` (the clamped reporting curve).
 */
// PR D (SOLVER_REALISM_SPEC_2026-07-26.md, change 1): `trimWeekToBudget` already walks from
// full coverage down to `capHours` one cheapest-cut-first, so recording state at each cut is
// nearly free — reading that log BACKWARDS gives marginal value in decreasing order, a genuine
// diminishing-returns curve for free, with the right shape already guaranteed by the greedy
// order. `onBeforeCut` is an OPTIONAL hook the public `trimWeekToBudget` never passes (so its
// own behavior/output is completely unaffected — see the byte-identical-grid invariant test),
// called once per outer iteration with the state BEFORE that iteration's cut is applied — i.e.
// the state AFTER all PRIOR cuts. `trimWeekToBudgetWithTrajectory` below is the only caller
// that passes a hook.
// 2026-07-28 (ninth shape): `arrivals168`/`floorWhppv` replace the retired
// `bandCeilingHourly168` throughout this trim — see backlogModel.ts's header. The rescale
// target (`requirementEquivalent168`) is the recurrence's OWN floor-pace-implied hours curve
// (`arrivals168 * floorWhppv`), not `hourlyRequirement168` — see
// `rescaleCapacityToRequirementTotal`'s header for why the two must not be conflated.
function trimWeekToBudgetCore(
  hourlyRequirement168: number[],
  protectedFloorHourly168: number[],
  demandVolatilityHourly168: number[],
  arrivals168: number[],
  floorWhppv: number,
  shifts: ShiftDef[],
  fullCoverageGrid: Grid,
  capHours: number,
  onBeforeCut?: (capacity: number[], baselineBacklog: number[], scheduledHours: number) => void
): Grid {
  const grid: Grid = {};
  for (let day = 0; day < 7; day++) grid[day] = { ...fullCoverageGrid[day] };

  const requirementEquivalent168 = arrivals168.map((a) => (a ?? 0) * floorWhppv);

  const scheduledHours = () =>
    Object.values(grid).reduce(
      (acc, hc) => acc + shifts.reduce((a, s) => a + (hc[s.id] ?? 0) * s.lengthHours, 0),
      0
    );

  let guard = 0;
  let hours = scheduledHours();
  while (hours > capHours && guard++ < 100000) {
    const capacity = fullWeekCapacity(grid, shifts);
    // PR E (§4a): the trim's OWN cost signal must be size-blind (it can only ever
    // redistribute a fixed total, never add to it) — rescale capacity so its weekly total
    // matches the recurrence's own requirement-equivalent total before simulating, so what's
    // left to score is purely shape. See candidateCutCost's header and engine-solver.md's PR
    // E section.
    const { rescaled: cyclicalCapacity, scale: capacityScale } = rescaleCapacityToRequirementTotal(
      capacity,
      requirementEquivalent168
    );
    const baselineBacklog = backlogFromCapacity(cyclicalCapacity, arrivals168, floorWhppv);
    onBeforeCut?.(capacity, baselineBacklog, hours);

    let bestDay = -1;
    let bestShiftId: string | null = null;
    let bestCost = Infinity;
    let bestPeak = Infinity;

    for (let day = 0; day < 7; day++) {
      for (const s of shifts) {
        if ((grid[day][s.id] ?? 0) <= 0) continue;
        const { cost, peakSeverityInWindow } = candidateCutCost(
          day,
          s,
          capacity,
          cyclicalCapacity,
          capacityScale,
          baselineBacklog,
          hourlyRequirement168,
          protectedFloorHourly168,
          demandVolatilityHourly168,
          arrivals168,
          floorWhppv
        );
        if (
          cost < bestCost - 1e-9 ||
          (Math.abs(cost - bestCost) <= 1e-9 && peakSeverityInWindow < bestPeak - 1e-9)
        ) {
          bestCost = cost;
          bestPeak = peakSeverityInWindow;
          bestDay = day;
          bestShiftId = s.id;
        }
      }
    }

    if (bestShiftId === null) break; // nothing left to cut anywhere
    grid[bestDay][bestShiftId] -= 1;
    hours -= shifts.find((s) => s.id === bestShiftId)!.lengthHours;
  }

  return grid;
}

export function trimWeekToBudget(
  hourlyRequirement168: number[],
  protectedFloorHourly168: number[],
  demandVolatilityHourly168: number[],
  arrivals168: number[],
  floorWhppv: number,
  shifts: ShiftDef[],
  fullCoverageGrid: Grid,
  capHours: number
): Grid {
  return trimWeekToBudgetCore(
    hourlyRequirement168,
    protectedFloorHourly168,
    demandVolatilityHourly168,
    arrivals168,
    floorWhppv,
    shifts,
    fullCoverageGrid,
    capHours
  );
}

export interface MarginalCurvePoint {
  /** Cumulative hours removed from full coverage so far, at this point in the trim. */
  cumulativeHoursAdded: number;
  /** Total convex severity (same objective `candidateCutCost` minimizes) at this point. */
  totalSeverity: number;
  /** Longest run of consecutive hours (circular), in the CYCLICAL backlog curve (PR E §4a),
   * at/above that hour's own relative caught-up threshold (`caughtUpThresholdForHour`, PR E
   * §4b — no longer a flat constant). */
  longestLeanStretchHours: number;
  /** Where that longest lean stretch begins, or null if none — lets a consumer name it
   * ("Friday 16:00") rather than just its length, for CHANGE 3's funding-ask headline. */
  longestLeanStretchStart: { day: number; hour: number } | null;
}

/**
 * Same trim as `trimWeekToBudget`, plus a recorded trajectory — one point per cut, in the
 * order the greedy trim actually made them (cheapest-first). Read BACKWARDS (from the last
 * point toward the first), this is a diminishing-returns curve: each step back represents one
 * MORE FTE-hour of budget, and the shape is guaranteed by construction (greedy cheapest-first)
 * — no fitting or smoothing needed. Do NOT assert this is monotonic in either direction in a
 * test: the greedy re-evaluates every candidate fresh each iteration (a later cut can occasionally
 * cost less than an earlier one did, since the backlog LANDSCAPE changes with every cut), so
 * small non-monotonicities are possible and are not bugs.
 *
 * `cumulativeHoursAdded` is named from the marginal-value reading direction (PR D's whole
 * point): reading the trajectory backwards, each point is how many hours you'd be ADDING back
 * relative to `capHours`, not how many were cut relative to full coverage.
 */
export function trimWeekToBudgetWithTrajectory(
  hourlyRequirement168: number[],
  protectedFloorHourly168: number[],
  demandVolatilityHourly168: number[],
  arrivals168: number[],
  floorWhppv: number,
  shifts: ShiftDef[],
  fullCoverageGrid: Grid,
  capHours: number
): { grid: Grid; trajectory: MarginalCurvePoint[] } {
  const fullCoverageHours = Object.values(fullCoverageGrid).reduce(
    (acc, hc) => acc + shifts.reduce((a, s) => a + (hc[s.id] ?? 0) * s.lengthHours, 0),
    0
  );
  const trajectory: MarginalCurvePoint[] = [];
  const grid = trimWeekToBudgetCore(
    hourlyRequirement168,
    protectedFloorHourly168,
    demandVolatilityHourly168,
    arrivals168,
    floorWhppv,
    shifts,
    fullCoverageGrid,
    capHours,
    (_capacity, baselineBacklog, scheduledHoursBefore) => {
      // PR E (b): relative per-hour threshold, not the retired flat constant — see
      // backlogModel.ts's header. `baselineBacklog` here is the CYCLICAL curve (PR E §4a).
      const streak = longestStreakAboveThreshold(baselineBacklog, caughtUpThresholds168(hourlyRequirement168));
      trajectory.push({
        cumulativeHoursAdded: fullCoverageHours - scheduledHoursBefore,
        totalSeverity: totalSeverity(baselineBacklog, hourlyRequirement168),
        longestLeanStretchHours: streak.hours,
        longestLeanStretchStart: streak.start,
      });
    }
  );
  return { grid, trajectory };
}

// Below this fraction of the chord length (the straight line between the curve's first and
// last point), a "bend" is treated as noise, not a genuine knee — a display heuristic, safe to
// tune, not load-bearing math.
const KNEE_MIN_BEND_FRACTION = 0.02;

/**
 * Where the marginal-value curve's return flattens: the point of maximum perpendicular
 * distance from the straight line connecting the trajectory's first and last point (the
 * classic geometric "elbow" heuristic — no curve-fitting, no arbitrary rate threshold). Returns
 * the `cumulativeHoursAdded` value at that point, or null when the trajectory is too short
 * (< 3 points — nothing to find a bend IN) or too flat (max bend under
 * `KNEE_MIN_BEND_FRACTION` of the chord length — reading a knee into noise on a near-straight
 * line would be a false signal, not a real diminishing-returns point).
 */
export function findMarginalKneePoint(trajectory: MarginalCurvePoint[]): number | null {
  if (trajectory.length < 3) return null;
  const first = trajectory[0];
  const last = trajectory[trajectory.length - 1];
  const dx = last.cumulativeHoursAdded - first.cumulativeHoursAdded;
  const dy = last.totalSeverity - first.totalSeverity;
  const chordLength = Math.sqrt(dx * dx + dy * dy);
  if (chordLength < 1e-9) return null; // degenerate: first and last points coincide

  let bestIndex = -1;
  let bestDistance = 0;
  for (let i = 1; i < trajectory.length - 1; i++) {
    const p = trajectory[i];
    const distance =
      Math.abs(dy * (p.cumulativeHoursAdded - first.cumulativeHoursAdded) - dx * (p.totalSeverity - first.totalSeverity)) /
      chordLength;
    if (distance > bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  if (bestIndex === -1 || bestDistance < chordLength * KNEE_MIN_BEND_FRACTION) return null;
  return trajectory[bestIndex].cumulativeHoursAdded;
}

/** 5.6: department-level floor — total on-duty headcount at any global hour, summed across
 * overlapping slots (and, now, across a spilled-over previous day's shift), >= floor. JOINT
 * over the whole week (not per-day) — a bump to fix a day's own early-hour violation may
 * need to land on the PREVIOUS day's shift, since that's the cell whose headcount actually
 * covers the deficient global hour under the global-week wraparound model. */
function enforceDepartmentFloor(
  grid: Grid,
  shifts: ShiftDef[],
  floor: number
): Array<{ day: number; hour: number; onDuty: number }> {
  const violationsFixed: Array<{ day: number; hour: number; onDuty: number }> = [];
  let guard = 0;
  while (guard++ < 7000) {
    const capacity = fullWeekCapacity(grid, shifts);
    let worstG = -1;
    let worstOnDuty = floor;
    for (let g = 0; g < 168; g++) {
      if (capacity[g] < floor && capacity[g] < worstOnDuty + 1) {
        worstG = g;
        worstOnDuty = capacity[g];
      }
    }
    if (worstG === -1) break;
    // bump the (day, shift) candidate covering this hour with the largest overlap with the
    // week's other low hours
    let bestDay = -1;
    let bestShiftId: string | null = null;
    let bestOverlap = -1;
    for (let day = 0; day < 7; day++) {
      for (const s of shifts) {
        const hours = shiftGlobalHours(day, s);
        if (!hours.includes(worstG)) continue;
        const overlap = hours.filter((g) => capacity[g] < floor).length;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestDay = day;
          bestShiftId = s.id;
        }
      }
    }
    if (!bestShiftId) break;
    grid[bestDay] = grid[bestDay] ?? {};
    grid[bestDay][bestShiftId] = (grid[bestDay][bestShiftId] ?? 0) + 1;
    violationsFixed.push({ day: Math.floor(worstG / 24), hour: worstG % 24, onDuty: worstOnDuty });
  }
  return violationsFixed;
}

export interface SolveResult {
  grid: Grid;
  weeklyScheduledHours: number;
  shortfall: ShortfallEntry[];
  enaFloorViolationsRemaining: Array<{ day: number; hour: number; onDuty: number }>;
}

export function solveShiftFit(
  hourlyRequirement168: number[],
  protectedFloorHourly168: number[],
  demandVolatilityHourly168: number[],
  arrivals168: number[],
  floorWhppv: number,
  shifts: ShiftDef[],
  weeklyBudgetHours: number,
  hoursBudgetTolerance: number,
  enaFloor: number
): SolveResult {
  const capHours = weeklyBudgetHours * (1 + hoursBudgetTolerance);

  // 5.2: full-coverage solve, JOINT over the whole week (PR A — a shift's coverage can now
  // spill into the next day, so a day's own deficit may only be solvable by bumping the
  // PREVIOUS day's shift; per-day-independent solving is no longer correct in general).
  const fullCoverageGrid = solveFullCoverageWeek(hourlyRequirement168, shifts);

  // 5.3: JOINT whole-week trim, minimizing convex severity — see the reversal note above
  // trimWeekToBudget. No more per-day proportional budget split. `protectedFloorHourly168` is
  // the UNCLAMPED protected floor (PR C change 4) — see `engine/demandBand.ts`.
  const grid = trimWeekToBudget(
    hourlyRequirement168,
    protectedFloorHourly168,
    demandVolatilityHourly168,
    arrivals168,
    floorWhppv,
    shifts,
    fullCoverageGrid,
    capHours
  );

  const enaFloorViolationsRemaining = enforceDepartmentFloor(grid, shifts, enaFloor);

  const weeklyScheduledHours = Object.values(grid).reduce(
    (acc, headcount) => acc + shifts.reduce((a, s) => a + (headcount[s.id] ?? 0) * s.lengthHours, 0),
    0
  );

  const shortfall: ShortfallEntry[] = [];
  for (let day = 0; day < 7; day++) {
    const coverage = coverageForDay(grid, shifts, day);
    for (let h = 0; h < 24; h++) {
      const requirement = hourlyRequirement168[day * 24 + h];
      if (coverage[h] < requirement) {
        shortfall.push({ day, hour: h, requirement, scheduled: coverage[h], deficit: requirement - coverage[h] });
      }
    }
  }

  return { grid, weeklyScheduledHours, shortfall, enaFloorViolationsRemaining };
}

/** Read-only 5.6 department-floor check: on-duty headcount at any hour, summed across
 * overlapping slots, vs. floor — no fix-up. Separated from `enforceDepartmentFloor` (which
 * mutates the grid during the initial solve) so the live-edit path can flag a violation
 * without silently adding staff back on a manual edit. */
function findDepartmentFloorViolations(
  grid: Grid,
  shifts: ShiftDef[],
  floor: number
): Array<{ day: number; hour: number; onDuty: number }> {
  const capacity = fullWeekCapacity(grid, shifts);
  const violations: Array<{ day: number; hour: number; onDuty: number }> = [];
  for (let g = 0; g < 168; g++) {
    if (capacity[g] < floor) violations.push({ day: Math.floor(g / 24), hour: g % 24, onDuty: capacity[g] });
  }
  return violations;
}

/** Cheap live-edit recompute: pure arithmetic, no re-solve. Used when a user hand-edits a headcount cell. */
export function recomputeFromGrid(
  grid: Grid,
  shifts: ShiftDef[],
  hourlyRequirement168: number[],
  enaFloor: number
): { weeklyScheduledHours: number; shortfall: ShortfallEntry[]; enaFloorViolationsRemaining: Array<{ day: number; hour: number; onDuty: number }> } {
  const weeklyScheduledHours = Object.values(grid).reduce(
    (acc, headcount) => acc + shifts.reduce((a, s) => a + (headcount[s.id] ?? 0) * s.lengthHours, 0),
    0
  );
  const capacity = fullWeekCapacity(grid, shifts);
  const shortfall: ShortfallEntry[] = [];
  for (let g = 0; g < 168; g++) {
    const requirement = hourlyRequirement168[g];
    if (capacity[g] < requirement) {
      shortfall.push({
        day: Math.floor(g / 24),
        hour: g % 24,
        requirement,
        scheduled: capacity[g],
        deficit: requirement - capacity[g],
      });
    }
  }
  const enaFloorViolationsRemaining = findDepartmentFloorViolations(grid, shifts, enaFloor);
  return { weeklyScheduledHours, shortfall, enaFloorViolationsRemaining };
}

export {
  coverageForDay,
  shiftGlobalHours,
  fullWeekCapacity,
  coveringCellsByGlobalHour,
  findDepartmentFloorViolations,
  solveFullCoverageWeek,
  enforceDepartmentFloor,
};
