// PR F (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §6.2) — the hidden-boarding diagnostic, "the
// advocacy artifact." Ben: "we need nursing leaders to understand that they are hurting the
// days by staffing for boarding overnight, and be able to advocate off of that." That requires
// a NUMBER, not an intuition — this computes it.
//
// New output: per (day/night) hour-block, current capacity minus ARRIVALS-ONLY requirement —
// the staffing that exists for something other than arrivals. Day = 07:00-19:00, Night =
// 19:00-07:00 — a FIXED calendar convention (not shift-menu-derived), matching the spec's own
// framing exactly; this deliberately does NOT depend on the department's shift menu, so the
// same day/night split applies whether the current schedule uses 8h, 10h, or 12h blocks.
//
// Pure diagnostic, no solver interaction, no engine changes elsewhere. Reads `hourlyRequirement`
// (already arrivals-only, per the separate-budget thesis — boarding never touches it) and
// `currentStaffingGrid`'s actual on-duty capacity (same `fullWeekCapacity` every other
// diagnostic in this codebase uses). Boarding need is `BoardingResult.cellBoardingRnHours` —
// the base weekly representative-week census curve, PRE month/day-of-week seasonality (matching
// the weekly-representative granularity `hourlyRequirement` itself is expressed at).
import type { Cell168, Grid, ShiftDef } from './types';
import { fullWeekCapacity } from './solver';

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 19; // exclusive — day block is hours [7, 19), i.e. 07:00-18:59

function isDayHour(hourOfDay: number): boolean {
  return hourOfDay >= DAY_START_HOUR && hourOfDay < DAY_END_HOUR;
}

export interface HiddenBoardingBlock {
  label: 'Day' | 'Night';
  /** Weekly nurse-hours this block needs to cover arrivals alone. */
  arrivalsNeedHours: number;
  /** Weekly nurse-hours this block needs to cover boarding — null when boarding data is absent. */
  boardingNeedHours: number | null;
  /** arrivalsNeedHours + boardingNeedHours — null when boarding data is absent (never silently
   * falls back to arrivals-only; §12.1's "no headline may assume the sign or size of a gap"). */
  totalNeedHours: number | null;
  /** Weekly nurse-hours this block is ACTUALLY staffed, from the current-staffing grid. */
  staffedHours: number;
  /** staffedHours - arrivalsNeedHours. Positive = staffed BEYOND what arrivals alone justify
   * (the "hidden" capacity — likely absorbing boarding, or genuinely idle); negative = short of
   * even arrivals alone. */
  vsArrivalsAlone: number;
}

export interface HiddenBoardingDiagnostic {
  day: HiddenBoardingBlock;
  night: HiddenBoardingBlock;
  /** False when boarding data (admit rate/duration) is absent — per §12.2 profile D, the
   * two-budget thesis must degrade to a prompt for the missing data, never silently vanish. */
  boardingDataPresent: boolean;
}

export function computeHiddenBoardingDiagnostic(
  hourlyRequirement: Cell168,
  currentStaffingGrid: Grid,
  shiftMenu: ShiftDef[],
  boardingCellHours: Cell168 | null
): HiddenBoardingDiagnostic {
  const capacity = fullWeekCapacity(currentStaffingGrid, shiftMenu);
  const boardingDataPresent = boardingCellHours !== null;

  let dayArrivals = 0;
  let nightArrivals = 0;
  let dayStaffed = 0;
  let nightStaffed = 0;
  let dayBoarding = 0;
  let nightBoarding = 0;

  for (let g = 0; g < 168; g++) {
    const hourOfDay = g % 24;
    const req = hourlyRequirement[g] ?? 0;
    const cap = capacity[g] ?? 0;
    const boarding = boardingCellHours ? boardingCellHours[g] ?? 0 : 0;
    if (isDayHour(hourOfDay)) {
      dayArrivals += req;
      dayStaffed += cap;
      dayBoarding += boarding;
    } else {
      nightArrivals += req;
      nightStaffed += cap;
      nightBoarding += boarding;
    }
  }

  function block(label: 'Day' | 'Night', arrivalsNeed: number, staffed: number, boardingNeed: number): HiddenBoardingBlock {
    return {
      label,
      arrivalsNeedHours: arrivalsNeed,
      boardingNeedHours: boardingDataPresent ? boardingNeed : null,
      totalNeedHours: boardingDataPresent ? arrivalsNeed + boardingNeed : null,
      staffedHours: staffed,
      vsArrivalsAlone: staffed - arrivalsNeed,
    };
  }

  return {
    day: block('Day', dayArrivals, dayStaffed, dayBoarding),
    night: block('Night', nightArrivals, nightStaffed, nightBoarding),
    boardingDataPresent,
  };
}
