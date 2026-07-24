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

export interface FlexAxes {
  startTimes: boolean; // allow different shift start times
  shiftCount: boolean; // allow a different number of shift types (2/3/4)
  shiftLengths: boolean; // allow 8s/10s/12s
}

export const NO_FLEX: FlexAxes = { startTimes: false, shiftCount: false, shiftLengths: false };

export interface MenuCandidate {
  menu: ShiftDef[];
  solve: SolveResult;
  totalShortfall: number; // Σ deficit across the week (lower is better coverage)
  weeklyScheduledHours: number;
}

const CANDIDATE_COUNTS = [2, 3, 4];
const CANDIDATE_LENGTHS = [8, 10, 12];
const CANDIDATE_OFFSETS = [0, 7, 8, 11, 19]; // a few common shift-start anchors

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
 * `solveShiftFit` at the same budget, and return them ranked by least total shortfall (then
 * fewest scheduled hours). BOUNDED: at most CANDIDATE_COUNTS × CANDIDATE_LENGTHS ×
 * CANDIDATE_OFFSETS regular tilings (≤ 45), deduped, and only those that fully tile 24h.
 *
 * An axis that's OFF is held at the current menu's structure (its count / dominant length /
 * earliest start), so the search only explores the dimensions the user opted into. Returns the
 * candidates in rank order; the caller compares the best against the current menu's own solve
 * and only surfaces it as an improvement when it genuinely beats current — never auto-adopts.
 */
export function searchFlexibleMenus(
  hourlyRequirement: number[],
  currentMenu: ShiftDef[],
  axes: FlexAxes,
  weeklyBudgetHours: number,
  hoursBudgetTolerance: number,
  transitionWeight: number,
  transitionWindowHours: number,
  enaFloor: number
): MenuCandidate[] {
  if (currentMenu.length === 0) return [];
  const curCount = currentMenu.length;
  const curLength = dominantLength(currentMenu);
  const curOffset = Math.min(...currentMenu.map((s) => s.startHour));

  const counts = axes.shiftCount ? CANDIDATE_COUNTS : [curCount];
  const lengths = axes.shiftLengths ? CANDIDATE_LENGTHS : [curLength];
  const offsets = axes.startTimes ? CANDIDATE_OFFSETS : [curOffset];

  const seen = new Set<string>();
  const candidates: MenuCandidate[] = [];
  for (const count of counts) {
    if (count < 1) continue;
    const spacing = 24 / count;
    for (const length of lengths) {
      if (length < spacing) continue; // would leave uncovered gap hours
      for (const offset of offsets) {
        const menu = buildTiling(count, length, offset);
        const key = menuKey(menu);
        if (seen.has(key)) continue;
        seen.add(key);
        const solve = solveShiftFit(
          hourlyRequirement,
          menu,
          weeklyBudgetHours,
          hoursBudgetTolerance,
          transitionWeight,
          transitionWindowHours,
          enaFloor
        );
        candidates.push({
          menu,
          solve,
          totalShortfall: solve.shortfall.reduce((a, s) => a + s.deficit, 0),
          weeklyScheduledHours: solve.weeklyScheduledHours,
        });
      }
    }
  }
  candidates.sort((a, b) => a.totalShortfall - b.totalShortfall || a.weeklyScheduledHours - b.weeklyScheduledHours);
  return candidates;
}
