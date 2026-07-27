// Band-floor diagnostic (2026-07-25, part of the Step 3 trim-objective reversal — see
// .claude/rules/engine-solver.md's "Budget-capped trim" section). DIAGNOSTIC ONLY, same
// convention as computeBacklog (engine/backlog.ts): reads an already-solved/edited grid and
// reports where its coverage falls below the SAME p25-equivalent band-floor curve
// (`EngineResult.bandFloorHourly`) that Step 3's trim now optimizes against. Callable against
// ANY grid (idealized or current), like computeBacklog.
//
// Unlike computeBacklog, this is a plain per-hour threshold check (no decay/compounding
// accumulator) plus a longest-consecutive-run scan — the run-detection technique (circular,
// doubled-index space) is deliberately the same one computeBacklog already uses, so a streak
// wrapping the Sat->Sun boundary isn't missed here either.

import type { Cell168, Grid, ShiftDef } from './types';
import { fullWeekCapacity, coveringCellsByGlobalHour } from './solver';

export interface BandFloorResult {
  /** Count of (day, hour) cells across the week where on-duty coverage is below bandFloorHourly. */
  hoursOutsideBand: number;
  /** Longest run of consecutive hours (circular) below the floor. */
  longestStreakHours: number;
  /** Where that longest streak begins, or null if the grid never dips below its floor. */
  longestStreakStart: { day: number; hour: number } | null;
  /** Shift(s) covering the start of the worst streak, for the "worst stretch" narrative. */
  worstStretchShiftLabel: string | null;
}

export function computeBandFloorViolations(grid: Grid, bandFloorHourly: Cell168, shifts: ShiftDef[]): BandFloorResult {
  // PR A: capacity via fullWeekCapacity (global-week attribution) — a day's own early hours
  // can be covered by the PREVIOUS day's shift, so per-day coverage is no longer correct.
  const capacity = fullWeekCapacity(grid, shifts);
  const below = capacity.map((c, g) => c < (bandFloorHourly[g] ?? 0));
  const hoursOutsideBand = below.filter(Boolean).length;

  let longestStreakHours = 0;
  let longestStreakStart: { day: number; hour: number } | null = null;
  if (below.every(Boolean)) {
    longestStreakHours = 168;
    longestStreakStart = { day: 0, hour: 0 };
  } else if (hoursOutsideBand > 0) {
    let run = 0;
    let runStart = 0;
    for (let i = 0; i < 168 * 2; i++) {
      const g = i % 168;
      if (below[g]) {
        if (run === 0) runStart = g;
        run++;
        if (run > longestStreakHours) {
          longestStreakHours = Math.min(run, 168);
          longestStreakStart = { day: Math.floor(runStart / 24), hour: runStart % 24 };
        }
      } else {
        run = 0;
      }
    }
  }

  let worstStretchShiftLabel: string | null = null;
  if (longestStreakStart) {
    // PR A: which shift covers this hour now depends on the actual (day, shift) covering
    // cell (which may be the PREVIOUS day's shift, for a spillover hour), not just hour-of-day.
    const g = longestStreakStart.day * 24 + longestStreakStart.hour;
    const covering = coveringCellsByGlobalHour(shifts)[g];
    if (covering.length > 0) {
      const labelById = new Map(shifts.map((s) => [s.id, s.label || s.id]));
      worstStretchShiftLabel = covering.map((c) => labelById.get(c.shiftId) ?? c.shiftId).join(' / ');
    }
  }

  return { hoursOutsideBand, longestStreakHours, longestStreakStart, worstStretchShiftLabel };
}
