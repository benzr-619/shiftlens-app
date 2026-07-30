// §2.3 Shift-menu flexibility search.
//
// NOTE — this REVERSES the long-standing "Auto-optimizing shift-menu search" out-of-scope
// decision (CLAUDE.md Section 7 / algorithm spec Section 7). Confirmed intentional with Ben
// 2026-07-24. The reversal is deliberately SCOPED to stay within the "numbers, not a verdict"
// principle: it is opt-in per axis, a BOUNDED enumeration (not a general optimizer), solved
// through the EXISTING `solveShiftFit` at the SAME budget, and surfaced as a side-by-side
// CANDIDATE — never auto-adopted into the idealized grid. See .claude/rules/engine-solver.md.

import type { ShiftDef } from './types';
import { solveShiftFit, type SolveResult } from './solver';
import { summarizeBacklogSeverity } from './backlog';

export interface FlexAxes {
  startTimes: boolean; // allow different shift start times
  shiftCount: boolean; // allow a different number of shift types (2/3/4)
  shiftLengths: boolean; // allow 8s/10s/12s
}

export const NO_FLEX: FlexAxes = { startTimes: false, shiftCount: false, shiftLengths: false };

export interface MenuCandidate {
  menu: ShiftDef[];
  solve: SolveResult;
  /** PR C (SOLVER_REALISM_SPEC_2026-07-26.md, change 5): the ranking key — the SAME convex
   * severity objective `candidateCutCost` minimizes, scored against this candidate's own
   * solved grid. Lower is better. */
  totalSeverity: number;
  totalShortfall: number; // Σ deficit across the week — DISPLAY COLUMN ONLY, no longer the rank key
  weeklyScheduledHours: number;
}

const CANDIDATE_COUNTS = [2, 3, 4];
const CANDIDATE_LENGTHS = [8, 10, 12];
const CANDIDATE_OFFSETS = [0, 7, 8, 11, 19]; // a few common shift-start anchors

// 2026-07-26 PR D (SOLVER_REALISM_SPEC_2026-07-26.md, change 6): `buildTiling` only ever
// produces REGULAR tilings (same length, evenly spaced) — it can never propose the single most
// common correct answer to a unimodal arrival curve, a short mid/swing shift LAYERED OVER the
// user's existing menu (e.g. an 11:00-17:00 shift added on top of 07:00/19:00 12h shifts to
// cover the midday peak). `OVERLAY_LENGTHS`/`OVERLAY_OFFSETS` bound this second, genuinely
// different candidate family — a "current menu + one shift" search, not a replacement tiling.
const OVERLAY_LENGTHS = [4, 6, 8];
const OVERLAY_OFFSETS = [9, 11, 13, 15]; // late-morning/midday/afternoon swing anchors

/** `currentMenu` unchanged, plus ONE additional overlay shift — the swing-shift candidate
 * family (PR D change 6). Deliberately NOT required to tile 24h on its own (unlike
 * `buildTiling`'s regular family) — it only needs to ADD coverage somewhere, since the
 * underlying menu already tiles the day. */
function buildOverlayMenu(currentMenu: ShiftDef[], length: number, startHour: number): ShiftDef[] {
  return [
    ...currentMenu.map((s) => ({ ...s })),
    { id: 'flex-overlay', label: `${startHour.toString().padStart(2, '0')}:00 swing (${length}h)`, startHour, lengthHours: length },
  ];
}

/** Most common shift length in a menu (ties → the earliest shift's length). Used to hold the
 * length axis fixed at the user's current structure when that axis isn't enabled. */
function dominantLength(menu: ShiftDef[]): number {
  const counts = new Map<number, number>();
  for (const s of menu) counts.set(s.lengthHours, (counts.get(s.lengthHours) ?? 0) + 1);
  let best = menu[0]?.lengthHours ?? 12;
  let bestCount = 0;
  for (const [len, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      best = len;
    }
  }
  return best;
}

/** A regular tiling: `count` shifts of `length` hours, evenly spaced starting at `offset`.
 * Only produced when `length >= 24/count`, so the day is fully covered (no gap hours). */
function buildTiling(count: number, length: number, offset: number): ShiftDef[] {
  const spacing = 24 / count;
  const menu: ShiftDef[] = [];
  for (let i = 0; i < count; i++) {
    const startHour = Math.round(offset + i * spacing) % 24;
    menu.push({ id: `flex-${i}`, label: `${startHour.toString().padStart(2, '0')}:00`, startHour, lengthHours: length });
  }
  return menu;
}

function menuKey(menu: ShiftDef[]): string {
  return [...menu]
    .sort((a, b) => a.startHour - b.startHour)
    .map((s) => `${s.startHour}:${s.lengthHours}`)
    .join('|');
}

/**
 * Enumerate candidate alternate menus along the enabled flexibility axes, solve each through
 * `solveShiftFit` at the same budget, and return them ranked by least total SEVERITY (PR C,
 * SOLVER_REALISM_SPEC_2026-07-26.md change 5 — the SAME convex objective the solver itself
 * minimizes, not total shortfall, which can't distinguish a shallow-everywhere candidate from
 * a catastrophic-one-night candidate with the same total). `totalShortfall` is still computed
 * and returned as a DISPLAY COLUMN, just no longer the rank key. BOUNDED: at most
 * CANDIDATE_COUNTS × CANDIDATE_LENGTHS × CANDIDATE_OFFSETS regular tilings (≤ 45), deduped, and
 * only those that fully tile 24h.
 *
 * `protectedFloorHourly` (PR C change 4) — the UNCLAMPED solver-facing floor
 * (`EngineResult.protectedFloorHourly`), NOT `bandFloorHourly` (the clamped reporting curve).
 *
 * 2026-07-28 (ninth shape): `arrivals168`/`floorWhppv` replace the retired
 * `bandCeilingHourly168` — see backlogModel.ts's header. This search always operates on the
 * arrivals-only budget, so `arrivals168` is the department's real visit counts.
 *
 * An axis that's OFF is held at the current menu's structure (its count / dominant length /
 * earliest start), so the search only explores the dimensions the user opted into. Returns the
 * candidates in rank order; the caller compares the best against the current menu's own solve
 * and only surfaces it as an improvement when it genuinely beats current — never auto-adopts.
 *
 * 2026-07-26 PR D (change 6): ALSO tries the bounded "current menu + one overlay shift" swing
 * family (`OVERLAY_LENGTHS` × `OVERLAY_OFFSETS`, ≤ 12 candidates) alongside whichever regular
 * tilings the enabled axes produce — this is what lets a mid/swing shift ever be reachable. Not
 * gated behind any ONE specific axis (a swing shift is a distinct idea from "resize/re-anchor
 * the existing tiling"), but gated on `anyAxis` (at least one axis enabled) same as the tiling
 * family — with NOTHING enabled the search still returns exactly the one regularized candidate
 * (the existing "static = no search at all" contract, unchanged). Still bounded and still
 * deduped against the same `seen` set.
 */
export function searchFlexibleMenus(
  hourlyRequirement: number[],
  protectedFloorHourly: number[],
  demandVolatilityHourly: number[],
  arrivals168: number[],
  floorWhppv: number,
  currentMenu: ShiftDef[],
  axes: FlexAxes,
  weeklyBudgetHours: number,
  hoursBudgetTolerance: number,
  enaFloor: number
): MenuCandidate[] {
  if (currentMenu.length === 0) return [];
  const curCount = currentMenu.length;
  const curLength = dominantLength(currentMenu);
  const curOffset = Math.min(...currentMenu.map((s) => s.startHour));

  const lengths = axes.shiftLengths ? CANDIDATE_LENGTHS : [curLength];
  const offsets = axes.startTimes ? CANDIDATE_OFFSETS : [curOffset];

  // Count and length are physically coupled — a length L can only tile 24h with count >= 24/L.
  // So the count set is derived PER length: if the shift-count axis is on we try 2/3/4 (keeping
  // only those that tile at this length); otherwise, when exploring lengths we use that length's
  // natural minimal tiling count (8h→3, 10h→3, 12h→2); with neither axis on we hold the current
  // count. This keeps each axis independently meaningful (enabling length flex alone still
  // surfaces 8s/10s, which a fixed 2-shift count could never tile).
  const seen = new Set<string>();
  const candidates: MenuCandidate[] = [];

  const trySolve = (menu: ShiftDef[]) => {
    const key = menuKey(menu);
    if (seen.has(key)) return;
    seen.add(key);
    const solve = solveShiftFit(
      hourlyRequirement,
      protectedFloorHourly,
      demandVolatilityHourly,
      arrivals168,
      floorWhppv,
      menu,
      weeklyBudgetHours,
      hoursBudgetTolerance,
      enaFloor
    );
    const { totalSeverity } = summarizeBacklogSeverity(solve.grid, arrivals168, hourlyRequirement, menu, floorWhppv);
    candidates.push({
      menu,
      solve,
      totalSeverity,
      totalShortfall: solve.shortfall.reduce((a, s) => a + s.deficit, 0),
      weeklyScheduledHours: solve.weeklyScheduledHours,
    });
  };

  for (const length of lengths) {
    let countsForLength: number[];
    if (axes.shiftCount) countsForLength = CANDIDATE_COUNTS.filter((c) => length >= 24 / c);
    else if (axes.shiftLengths) countsForLength = [Math.max(2, Math.ceil(24 / length))];
    else countsForLength = [curCount];

    for (const count of countsForLength) {
      if (count < 1 || length < 24 / count) continue; // would leave uncovered gap hours
      for (const offset of offsets) trySolve(buildTiling(count, length, offset));
    }
  }

  // PR D change 6: swing-shift overlay family — see the header note above. Gated on `anyAxis`
  // so an all-off FlexAxes still returns exactly the one regularized candidate, unchanged.
  const anyAxis = axes.startTimes || axes.shiftCount || axes.shiftLengths;
  if (anyAxis) {
    for (const length of OVERLAY_LENGTHS) {
      for (const offset of OVERLAY_OFFSETS) trySolve(buildOverlayMenu(currentMenu, length, offset));
    }
  }

  candidates.sort((a, b) => a.totalSeverity - b.totalSeverity || a.weeklyScheduledHours - b.weeklyScheduledHours);
  return candidates;
}
