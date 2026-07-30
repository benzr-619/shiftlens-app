// Panel 2's "moving hours" reallocation — 2026-07-29, Ben's direct ask: the reallocated grid
// must hold total scheduled hours EXACTLY equal to the current grid's own total, not "within
// the standard ~10% tolerance band" the way the primary solve pipeline (`solveShiftFit`/
// `solveShiftFitWithBacklogFeedback`) works. That pipeline can't be reused as-is for this —
// it targets an INEQUALITY (`scheduledHours <= budget * (1 + tolerance)`) via a monotonic
// greedy CUT from a full-coverage upper bound, which can only ever remove hours, never trade
// them, and stops the first time it drops at/under the cap — it has no way to land on an
// arbitrary exact target. This is a genuinely different algorithm: a REALLOCATION (only ever
// trades a shift-unit for another shift-unit) rather than a TRIM (only ever removes).
//
// See `.claude/rules/engine-solver.md`'s "Exact-hours reallocation" section for the full
// design rationale and the scope decision (hours held exactly flat; total headcount/shift
// COUNT is deliberately NOT a separate constraint — confirmed with Ben, since with unequal
// shift lengths the two constraints can conflict and there's no principled way to always
// satisfy both).
import type { Cell168, Grid, ShiftDef } from './types';
import { fullWeekCapacity, totalSeverity } from './solver';
import { backlogRecurrence, rescaleCapacityToRequirementTotal } from './backlogModel';

export interface ExactReallocationResult {
  grid: Grid;
  /** How many hour-conserving trades were actually applied. 0 means either the starting grid
   * was already a local optimum, or no hour-conserving trade exists at all for this shift menu
   * (see the function's own header). */
  swapsApplied: number;
}

/** Hard cap on local-search iterations — a safety backstop, not a target. A 7-day x
 * few-shift grid (the realistic case this panel operates on) converges in well under this in
 * practice; this only guards against an unexpected non-terminating oscillation. */
const MAX_ITERATIONS = 60;
/** Minimum improvement (in the severity objective) for a candidate trade to count as strictly
 * better — guards against floating-point dust causing an infinite loop of zero-value swaps. */
const MIN_IMPROVEMENT = 1e-9;

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function cloneGrid(grid: Grid): Grid {
  const out: Grid = {};
  for (let day = 0; day < 7; day++) out[day] = { ...(grid[day] ?? {}) };
  return out;
}

function cellCount(grid: Grid, day: number, shiftId: string): number {
  return grid[day]?.[shiftId] ?? 0;
}

function setCell(grid: Grid, day: number, shiftId: string, value: number): void {
  if (!grid[day]) grid[day] = {};
  grid[day][shiftId] = value;
}

/** Same objective the Step 3 trim itself minimizes (CYCLICAL — shape-only — total severity,
 * see `.claude/rules/engine-solver.md`'s PR E/ninth-shape sections) but computed leanly: skips
 * `computeBacklog`'s structural-floor/streak bookkeeping, which this local search's inner loop
 * has no use for and can't afford to pay for on every candidate trade. Mirrors
 * `backlog.ts`'s `computeBacklog` cyclical computation exactly (same two calls, same
 * `requirementEquivalent` curve) — keep the two in sync if that formula ever changes. */
function cyclicalTotalSeverity(
  grid: Grid,
  shiftMenu: ShiftDef[],
  arrivals168: Cell168,
  hourlyRequirement168: Cell168,
  floorWhppv: number
): number {
  const capacity = fullWeekCapacity(grid, shiftMenu);
  const requirementEquivalent = arrivals168.map((a) => (a ?? 0) * floorWhppv);
  const { rescaled: cyclicalCapacity } = rescaleCapacityToRequirementTotal(capacity, requirementEquivalent);
  const { backlog: cyclicalBacklog } = backlogRecurrence(cyclicalCapacity, arrivals168, floorWhppv);
  return totalSeverity(cyclicalBacklog, hourlyRequirement168);
}

/**
 * Redistributes an EXISTING staffing grid's headcount across the SAME shift menu while
 * holding total scheduled hours EXACTLY fixed. A hill-climbing local search: each step finds
 * the single best "trade" — `unitsFrom` headcount removed at one (day, shift) cell in exchange
 * for `unitsTo` headcount added at another — that strictly lowers total (cyclical) severity,
 * and applies it, stopping when no improving trade exists or `MAX_ITERATIONS` is hit.
 *
 * `unitsFrom`/`unitsTo` are the minimal integers making the trade hour-neutral:
 * `unitsFrom * shiftFrom.lengthHours === unitsTo * shiftTo.lengthHours`, via
 * `gcd(lengthFrom, lengthTo)`. For two shifts of EQUAL length (including the same shift on two
 * different days) this is a plain 1-for-1 swap. For unequal lengths it's a compound trade
 * (e.g. 3 units of an 8h shift <-> 2 units of a 12h shift, since gcd(8,12)=4). A trade is only
 * even considered when the source cell actually has `unitsFrom` headcount to give — this is a
 * genuine discrete search over a combinatorial space, not an exact optimum (same greedy/
 * bounded-search philosophy as the rest of this engine's solver — see engine-solver.md).
 *
 * Deliberately does NOT run `enforceDepartmentFloor` (the ENA-floor safety pass) — that pass
 * can only ever ADD hours, which would break the exact-conservation guarantee this function
 * exists to provide. A department whose current grid already sits below the ENA floor
 * somewhere stays below it after reallocation; that's visible elsewhere on the results page
 * (the heatmap's floor flag, the "hours outside the peer floor" stat), not silently fixed here.
 *
 * Returns `swapsApplied: 0` when the starting grid is already a local optimum, OR when no
 * hour-conserving trade exists at all for this shift menu (a real, disclosed degenerate case —
 * never silently pretended away).
 */
export function reallocateHoursExact(
  currentGrid: Grid,
  shiftMenu: ShiftDef[],
  arrivals168: Cell168,
  hourlyRequirement168: Cell168,
  floorWhppv: number
): ExactReallocationResult {
  const grid = cloneGrid(currentGrid);
  for (const s of shiftMenu) {
    for (let day = 0; day < 7; day++) {
      if (grid[day]?.[s.id] === undefined) setCell(grid, day, s.id, 0);
    }
  }

  const scoreOf = (g: Grid) => cyclicalTotalSeverity(g, shiftMenu, arrivals168, hourlyRequirement168, floorWhppv);

  // Every ordered pair of shifts (including a shift paired with itself, for cross-day trades
  // of the SAME shift type — the most common move this panel's diff grid shows) with the
  // minimal hour-conserving unit counts.
  const templates: Array<{ from: ShiftDef; to: ShiftDef; unitsFrom: number; unitsTo: number }> = [];
  for (const from of shiftMenu) {
    for (const to of shiftMenu) {
      const g = gcd(from.lengthHours, to.lengthHours);
      templates.push({ from, to, unitsFrom: to.lengthHours / g, unitsTo: from.lengthHours / g });
    }
  }

  let currentScore = scoreOf(grid);
  let swapsApplied = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let bestScore = currentScore;
    let bestMove: { dayFrom: number; dayTo: number; from: string; to: string; unitsFrom: number; unitsTo: number } | null = null;

    for (const t of templates) {
      for (let dayFrom = 0; dayFrom < 7; dayFrom++) {
        const have = cellCount(grid, dayFrom, t.from.id);
        if (have < t.unitsFrom) continue;
        for (let dayTo = 0; dayTo < 7; dayTo++) {
          if (dayFrom === dayTo && t.from.id === t.to.id) continue; // trivial no-op

          const candidate = cloneGrid(grid);
          setCell(candidate, dayFrom, t.from.id, have - t.unitsFrom);
          setCell(candidate, dayTo, t.to.id, cellCount(candidate, dayTo, t.to.id) + t.unitsTo);

          const score = scoreOf(candidate);
          if (score < bestScore - MIN_IMPROVEMENT) {
            bestScore = score;
            bestMove = { dayFrom, dayTo, from: t.from.id, to: t.to.id, unitsFrom: t.unitsFrom, unitsTo: t.unitsTo };
          }
        }
      }
    }

    if (!bestMove) break;
    setCell(grid, bestMove.dayFrom, bestMove.from, cellCount(grid, bestMove.dayFrom, bestMove.from) - bestMove.unitsFrom);
    setCell(grid, bestMove.dayTo, bestMove.to, cellCount(grid, bestMove.dayTo, bestMove.to) + bestMove.unitsTo);
    currentScore = bestScore;
    swapsApplied++;
  }

  return { grid, swapsApplied };
}
