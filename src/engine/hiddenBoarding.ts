// PANEL1_COPY_REVISION_SPEC_2026-07-28.md, Section 4 — REWRITE of the day/night hidden-
// boarding diagnostic into a per-actual-shift diagnostic.
//
// PRIOR MODEL (PR F, RESULTS_COMPREHENSION_SPEC_2026-07-26.md §6.2, now retired): a FIXED
// 07:00-19:00 / 19:00-07:00 calendar split (`computeHiddenBoardingDiagnostic`,
// `HiddenBoardingBlock`). This didn't generalize to an 8-8 split, a 3x8 menu, or any shift
// structure that doesn't happen to land on a 12-hour clock boundary — flagged directly by
// Ben, confirmed as a genuine bug rather than a style call.
//
// CURRENT MODEL: one diagnostic PER SHIFT in the (sorted-by-startHour) shift menu, not fixed
// calendar blocks. For each shift `s`:
//   staffedHours(s)  = headcount(day, s) x s.lengthHours, summed over the representative week.
//   requiredHours(s) = sum of hourlyRequirement over the global hours `s` covers, attributed
//                      via `coveringCellsByGlobalHour` (the SAME even-split-at-handoff-hours
//                      convention already used for boarding priority ranking and the backlog
//                      per-shift diagnostics — no new attribution convention invented here).
//   Arrivals status  — staffedHours(s) vs. the SAME split-weighted sum of bandFloorHourly/
//                      bandCeilingHourly over s's covered hours (the same per-hour peer band
//                      already driving the heatmap's color): below the floor-sum ->
//                      'understaffed'; above the ceiling-sum -> 'overstaffed'; between ->
//                      'appropriate'.
//   Boarding coverage (only when boarding data is present) — surplus(s) = max(0,
//                      staffedHours(s) - requiredHours(s)); boardingNeed(s) = the same split-
//                      weighted sum of boarding.cellBoardingRnHours over s's covered hours;
//                      boardingCovered(s) = surplus(s) >= boardingNeed(s).
//
// Shifts producing an IDENTICAL sentence are merged: grouped by the tuple (arrivalsStatus,
// boardingCovered) — or arrivalsStatus alone when boarding is absent — preserving each
// group's first-appearance order in the (already sorted) shift menu, with staffedHours/
// requiredHours/surplus/boardingNeedHours summed across the group's members.
//
// Pure diagnostic, no solver interaction, no engine changes elsewhere. Reads
// `hourlyRequirement` (arrivals-only, per the separate-budget thesis) and the current-
// staffing grid's actual headcount — same "graceful degradation when boarding is absent"
// convention as the rest of this app (never silently zero, always explicit null).
import type { Cell168, Grid, ShiftDef } from './types';
import { coveringCellsByGlobalHour } from './solver';

export type ArrivalsStatus = 'understaffed' | 'overstaffed' | 'appropriate';

export interface ShiftDiagnosticGroup {
  shiftIds: string[];
  /** Shift label(s) in this group, in first-appearance (startHour) order. */
  labels: string[];
  arrivalsStatus: ArrivalsStatus;
  /** Weekly nurse-hours this group is actually staffed, summed across its members. */
  staffedHours: number;
  /** Weekly nurse-hours this group's covered hours require for arrivals alone, summed. */
  requiredHours: number;
  /** max(0, staffedHours - requiredHours), summed across members — the nursing hours left
   * over once arrivals are served. */
  surplus: number;
  /** Weekly nurse-hours of boarding demand across this group's covered hours — null when
   * boarding data is absent. */
  boardingNeedHours: number | null;
  /** surplus >= boardingNeedHours — null when boarding data is absent. */
  boardingCovered: boolean | null;
}

export interface PerShiftDiagnostic {
  /** One entry per MERGED group, in first-appearance order. */
  groups: ShiftDiagnosticGroup[];
  boardingDataPresent: boolean;
}

interface PerShiftStat {
  shift: ShiftDef;
  staffedHours: number;
  requiredHours: number;
  floorSum: number;
  ceilingSum: number;
  boardingNeed: number;
}

/**
 * `shiftMenu` must already be sorted by `startHour` (the caller's job, same convention as
 * everywhere else in this app — see CLAUDE.md Section 6's `sortShiftsByStartHour` note) so
 * group labels/merge order read chronologically.
 */
export function computePerShiftDiagnostic(
  hourlyRequirement: Cell168,
  currentStaffingGrid: Grid,
  shiftMenu: ShiftDef[],
  bandFloorHourly: Cell168,
  bandCeilingHourly: Cell168,
  boardingCellHours: Cell168 | null
): PerShiftDiagnostic {
  const boardingDataPresent = boardingCellHours !== null;
  if (shiftMenu.length === 0) return { groups: [], boardingDataPresent };

  const coveringCells = coveringCellsByGlobalHour(shiftMenu);

  const stats = new Map<string, PerShiftStat>();
  for (const s of shiftMenu) {
    stats.set(s.id, { shift: s, staffedHours: 0, requiredHours: 0, floorSum: 0, ceilingSum: 0, boardingNeed: 0 });
  }

  for (let day = 0; day < 7; day++) {
    const headcount = currentStaffingGrid[day] ?? {};
    for (const s of shiftMenu) {
      const hc = headcount[s.id] ?? 0;
      if (hc > 0) stats.get(s.id)!.staffedHours += hc * s.lengthHours;
    }
  }

  for (let g = 0; g < 168; g++) {
    const covers = coveringCells[g];
    if (covers.length === 0) continue;
    const share = 1 / covers.length;
    const req = hourlyRequirement[g] ?? 0;
    const floor = bandFloorHourly[g] ?? 0;
    const ceiling = bandCeilingHourly[g] ?? 0;
    const boarding = boardingCellHours ? (boardingCellHours[g] ?? 0) : 0;
    for (const { shiftId } of covers) {
      const stat = stats.get(shiftId);
      if (!stat) continue;
      stat.requiredHours += req * share;
      stat.floorSum += floor * share;
      stat.ceilingSum += ceiling * share;
      stat.boardingNeed += boarding * share;
    }
  }

  const perShift = shiftMenu.map((s) => {
    const stat = stats.get(s.id)!;
    const arrivalsStatus: ArrivalsStatus =
      stat.staffedHours < stat.floorSum ? 'understaffed' : stat.staffedHours > stat.ceilingSum ? 'overstaffed' : 'appropriate';
    const surplus = Math.max(0, stat.staffedHours - stat.requiredHours);
    const boardingCovered = boardingDataPresent ? surplus >= stat.boardingNeed : null;
    return { shift: s, stat, arrivalsStatus, surplus, boardingCovered };
  });

  // Merge shifts that would produce an identical sentence — group by (arrivalsStatus,
  // boardingCovered), or arrivalsStatus alone when boarding is absent — preserving
  // first-appearance order in the (already startHour-sorted) shift menu.
  const groupKey = (p: (typeof perShift)[number]) =>
    boardingDataPresent ? `${p.arrivalsStatus}::${p.boardingCovered}` : p.arrivalsStatus;

  const order: string[] = [];
  const buckets = new Map<string, typeof perShift>();
  for (const p of perShift) {
    const key = groupKey(p);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(p);
  }

  const groups: ShiftDiagnosticGroup[] = order.map((key) => {
    const members = buckets.get(key)!;
    return {
      shiftIds: members.map((m) => m.shift.id),
      labels: members.map((m) => m.shift.label || m.shift.id),
      arrivalsStatus: members[0].arrivalsStatus,
      staffedHours: members.reduce((a, m) => a + m.stat.staffedHours, 0),
      requiredHours: members.reduce((a, m) => a + m.stat.requiredHours, 0),
      surplus: members.reduce((a, m) => a + m.surplus, 0),
      boardingNeedHours: boardingDataPresent ? members.reduce((a, m) => a + m.stat.boardingNeed, 0) : null,
      boardingCovered: boardingDataPresent ? members[0].boardingCovered : null,
    };
  });

  return { groups, boardingDataPresent };
}
