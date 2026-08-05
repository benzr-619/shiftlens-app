// Panel 5 redesign (2026-08-05) — the joint ED+hold full-coverage solve behind the "ShiftLens
// Solver Staffing (Hold Nurses for Boarding)" starting point and §5's new prefill/starting-
// point option. See .claude/rules/engine-solver.md's dated section for the full record.
//
// This is a NEW, explicitly flagged capability, not a variant of the existing Step 3 solver
// (`solveShiftFit`) — it has no budget/trim phase at all, it's a pure full-coverage FILL over
// TWO pools at once (ED nurses, hold nurses), where the hold pool is restricted to a subset of
// shifts (§4's shift-restriction checkboxes) and can only ever relieve MEDICAL boarding demand,
// never arrivals or BH boarding — the same capping convention `engine/sandbox.ts`'s
// `computeSandbox`/`holdApplied` already uses (a hold unit's contribution at any hour is capped
// at that hour's own medical boarding demand, never the combined deficit).
import type { Grid, ShiftDef } from './types';
import { fullWeekCapacity, shiftGlobalHours } from './solver';

function emptyGrid(shifts: ShiftDef[]): Grid {
  const g: Grid = {};
  for (let day = 0; day < 7; day++) {
    g[day] = {};
    for (const s of shifts) g[day][s.id] = 0;
  }
  return g;
}

interface JointCandidate {
  day: number;
  shiftId: string;
  pool: 'ed' | 'hold';
  perHour: number;
}

/** Best candidate across BOTH pools this iteration — an ED unit's value is how many currently-
 * deficient hours (against the COMBINED capacity, ED + capped hold) it would relieve; a hold
 * unit's value is the same deficient-hour count, further restricted to hours where the hold
 * pool still has uncapped medical boarding demand left to relieve at that hour. Both are
 * normalized by the shift's own length ("relieves the most deficit per shift-hour," per the
 * spec) so a short, well-targeted shift can beat a long, poorly-targeted one. */
function bestJointCandidate(
  combinedDemand168: number[],
  medicalBoardingDemand168: number[],
  combinedCapacity: number[],
  holdCapacityRaw: number[],
  edShifts: ShiftDef[],
  allowedHoldShifts: ShiftDef[]
): JointCandidate | null {
  let best: JointCandidate | null = null;

  for (const s of edShifts) {
    for (let day = 0; day < 7; day++) {
      const hours = shiftGlobalHours(day, s);
      const score = hours.filter((g) => combinedCapacity[g] < (combinedDemand168[g] ?? 0)).length;
      if (score <= 0) continue;
      const perHour = score / s.lengthHours;
      if (!best || perHour > best.perHour) best = { day, shiftId: s.id, pool: 'ed', perHour };
    }
  }

  for (const s of allowedHoldShifts) {
    for (let day = 0; day < 7; day++) {
      const hours = shiftGlobalHours(day, s);
      const score = hours.filter(
        (g) => combinedCapacity[g] < (combinedDemand168[g] ?? 0) && holdCapacityRaw[g] < (medicalBoardingDemand168[g] ?? 0)
      ).length;
      if (score <= 0) continue;
      const perHour = score / s.lengthHours;
      if (!best || perHour > best.perHour) best = { day, shiftId: s.id, pool: 'hold', perHour };
    }
  }

  return best;
}

/**
 * Joint ED+hold full-coverage greedy fill. Same style as `solveFullCoverageWeekWithTrajectory`'s
 * inner loop (reuses `fullWeekCapacity`/`shiftGlobalHours` from `solver.ts`, not a re-derivation
 * of shift-hour attribution) — at each iteration, adds ONE unit of whichever candidate (an ED
 * (day, shift) unit or an allowed hold (day, shift) unit) relieves the most currently-deficient
 * hours of `combinedDemand168` per shift-hour, until `combinedDemand168` is fully covered or no
 * candidate helps further (a genuinely unreachable hour — e.g. no shift covers it at all).
 *
 * `allowedHoldShifts` should already be filtered down to whichever shifts the caller allows hold
 * nurses to work (Panel 5's shift-restriction checkboxes, §4) — this function never widens that
 * set; a shift excluded here structurally can never appear in the returned `holdGrid`.
 */
export function solveEdHoldJointCoverage(
  combinedDemand168: number[],
  medicalBoardingDemand168: number[],
  edShifts: ShiftDef[],
  allowedHoldShifts: ShiftDef[]
): { edGrid: Grid; holdGrid: Grid } {
  const edGrid = emptyGrid(edShifts);
  const holdGrid = emptyGrid(allowedHoldShifts);
  if (edShifts.length === 0 && allowedHoldShifts.length === 0) return { edGrid, holdGrid };

  let guard = 0;
  while (guard++ < 700000) {
    const edCapacity = fullWeekCapacity(edGrid, edShifts);
    const holdCapacityRaw = fullWeekCapacity(holdGrid, allowedHoldShifts);
    const combinedCapacity = edCapacity.map((v, g) => v + Math.min(holdCapacityRaw[g] ?? 0, medicalBoardingDemand168[g] ?? 0));

    let deficitHours = 0;
    for (let g = 0; g < 168; g++) if (combinedCapacity[g] < (combinedDemand168[g] ?? 0)) deficitHours++;
    if (deficitHours === 0) break;

    const candidate = bestJointCandidate(
      combinedDemand168,
      medicalBoardingDemand168,
      combinedCapacity,
      holdCapacityRaw,
      edShifts,
      allowedHoldShifts
    );
    if (!candidate) break; // no remaining candidate can relieve anything further

    if (candidate.pool === 'ed') {
      edGrid[candidate.day][candidate.shiftId] += 1;
    } else {
      holdGrid[candidate.day][candidate.shiftId] += 1;
    }
  }

  return { edGrid, holdGrid };
}
