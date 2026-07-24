// §2.4 Backlog / "falling behind" diagnostic.
//
// Evidence status: ASSUMPTION — this models how an ED's unmet demand compounds forward, and
// is derived (not measured). Resolved with Ben 2026-07-24 (see .claude/rules/results-redesign.md
// and the algorithm-spec's evidence-tagging convention — same rigor as the boarding convolution).
//
// DIAGNOSTIC ONLY. This never feeds the solver, the budget trim, or any allocation logic — it
// reads a grid that has already been solved/edited and reports how shortfall accumulates. It
// reuses the exact demand/capacity values the shortfall math already uses (no new demand model):
//   demand  = hourlyRequirement[h]           (the smoothed per-hour required headcount)
//   capacity = on-duty headcount from the grid (coverageForDay, same as the wHPPV heatmap)
//
// Recurrence (spec §2.4, decay resolved to 0.85/hr):
//   deficit[h] = demand[h] − capacity[h]                       // signed; excess capacity is negative
//   backlog[h] = max(0, backlog[h−1]·DECAY + deficit[h])
// carried CIRCULARLY across the full 168-hour week with NO boundary reset (a Saturday-night
// backlog carries into Sunday). Excess-capacity hours actively pay the backlog down through the
// signed deficit term — there is no separate paydown mechanism, it's already in the formula.

import type { Cell168, Grid, ShiftDef } from './types';
import { DEFAULTS } from './types';
import { coverageForDay, shiftHoursOfDay } from './solver';

/** Below this many nurse-hours of accumulated backlog, an hour counts as "caught up" — a
 * small display threshold so floating-point dust and sub-nurse-hour holes don't read as a
 * streak. Diagnostic-only, tunable; not load-bearing engine math. */
export const BACKLOG_CAUGHT_UP_THRESHOLD = 0.5;

export interface BacklogShiftDiagnostic {
  shiftId: string;
  shiftLabel: string;
  /** Weekly nurse-hours of backlog this shift walks INTO (carried from prior hours). */
  inheritedBacklog: number;
  /** Weekly nurse-hours of backlog this shift GENERATES itself (fresh shortfall in its hours). */
  generatedBacklog: number;
}

export interface BacklogResult {
  /** 168 hours, nurse-hours of accumulated unmet requirement carried forward. */
  backlog: Cell168;
  /** Longest run of consecutive hours (circular) at/above the caught-up threshold. */
  longestStreakHours: number;
  /** Where that longest streak begins, or null if the department never falls behind. */
  longestStreakStart: { day: number; hour: number } | null;
  /** True iff the backlog never returns to ~0 anywhere in the week — a chronic, never-clearing hole. */
  neverClears: boolean;
  /** Hour-of-day (0-23) the backlog most reliably clears — the "overnight reset" — or null if
   * it rarely/never does. */
  typicalClearHour: number | null;
  peakBacklog: number;
  peakAt: { day: number; hour: number } | null;
  /** Per-shift attribution: does this shift mostly inherit a prior shift's hole or dig its own? */
  shiftDiagnostics: BacklogShiftDiagnostic[];
}

/**
 * Compute the backlog diagnostic for ANY grid (idealized or current) against the requirement
 * curve. Pure function, no solver interaction.
 */
export function computeBacklog(
  grid: Grid,
  hourlyRequirement: Cell168,
  shifts: ShiftDef[],
  decay: number = DEFAULTS.backlogHourlyDecay
): BacklogResult {
  // Capacity (on-duty headcount) per global hour from the grid.
  const capacity = new Array(168).fill(0);
  for (let day = 0; day < 7; day++) {
    const cov = coverageForDay(grid[day] ?? {}, shifts);
    for (let h = 0; h < 24; h++) capacity[day * 24 + h] = cov[h];
  }
  const deficit = hourlyRequirement.map((req, g) => (req ?? 0) - capacity[g]);

  // Circular recurrence with NO reset. Iterate the full week twice: the first (settle) pass
  // seeds backlog[167] so the Sat→Sun carry into backlog[0] is a real value rather than 0.
  // The 0.85 decay washes out the initial zero seed within a single pass (0.85^167 ≈ 1e-12),
  // so two passes is comfortably converged; carriedIn is captured in the final pass so it
  // stays consistent with backlog for every hour except the single wraparound point (where the
  // residual is that same ~1e-12).
  const backlog = new Array(168).fill(0);
  const carriedIn = new Array(168).fill(0);
  for (let pass = 0; pass < 2; pass++) {
    for (let g = 0; g < 168; g++) {
      const ci = backlog[(g - 1 + 168) % 168] * decay;
      carriedIn[g] = ci;
      backlog[g] = Math.max(0, ci + deficit[g]);
    }
  }

  const behind = backlog.map((b) => b >= BACKLOG_CAUGHT_UP_THRESHOLD);
  const neverClears = behind.every(Boolean);

  // Longest circular run of "behind" hours.
  let longestStreakHours = 0;
  let longestStreakStart: { day: number; hour: number } | null = null;
  if (neverClears) {
    longestStreakHours = 168;
    longestStreakStart = { day: 0, hour: 0 };
  } else {
    // Not all behind, so at least one gap exists — scan a doubled index space to catch a
    // streak that wraps across the Sat→Sun boundary without double-counting.
    let run = 0;
    let runStart = 0;
    for (let i = 0; i < 168 * 2; i++) {
      const g = i % 168;
      if (behind[g]) {
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

  // "Overnight reset": the hour-of-day most reliably caught up across the 7 days.
  let typicalClearHour: number | null = null;
  if (!neverClears) {
    let bestHod = -1;
    let bestClearDays = 0;
    for (let hod = 0; hod < 24; hod++) {
      let clearDays = 0;
      for (let day = 0; day < 7; day++) if (!behind[day * 24 + hod]) clearDays++;
      if (clearDays > bestClearDays) {
        bestClearDays = clearDays;
        bestHod = hod;
      }
    }
    // Only call it a reliable reset if it clears on a majority of days.
    if (bestHod >= 0 && bestClearDays >= 4) typicalClearHour = bestHod;
  }

  // Peak.
  let peakBacklog = 0;
  let peakAt: { day: number; hour: number } | null = null;
  for (let g = 0; g < 168; g++) {
    if (backlog[g] > peakBacklog) {
      peakBacklog = backlog[g];
      peakAt = { day: Math.floor(g / 24), hour: g % 24 };
    }
  }

  // Per-shift inherited-vs-generated attribution. Each hour's backlog decomposes into a
  // carried-in portion (min(carriedIn, backlog) — what survived from prior hours after any
  // paydown) and a freshly-generated portion (max(0, deficit) — this hour's own shortfall).
  // Attribute each hour to its covering shift(s), split evenly at hand-off hours — the same
  // convention boarding's slot ranking uses (shiftHoursOfDay). Avoids any cross-midnight
  // "shift span" ambiguity, since it's a pure per-hour attribution.
  const coveringByHod: string[][] = Array.from({ length: 24 }, () => []);
  for (const s of shifts) for (const hod of shiftHoursOfDay(s)) coveringByHod[hod].push(s.id);

  const inherited: Record<string, number> = {};
  const generated: Record<string, number> = {};
  for (const s of shifts) {
    inherited[s.id] = 0;
    generated[s.id] = 0;
  }
  for (let g = 0; g < 168; g++) {
    const covers = coveringByHod[g % 24];
    if (covers.length === 0) continue;
    const share = 1 / covers.length;
    const inheritedHere = Math.min(carriedIn[g], backlog[g]);
    const generatedHere = Math.max(0, deficit[g]);
    for (const id of covers) {
      inherited[id] += inheritedHere * share;
      generated[id] += generatedHere * share;
    }
  }

  const shiftDiagnostics: BacklogShiftDiagnostic[] = shifts.map((s) => ({
    shiftId: s.id,
    shiftLabel: s.label || s.id,
    inheritedBacklog: inherited[s.id] ?? 0,
    generatedBacklog: generated[s.id] ?? 0,
  }));

  return {
    backlog,
    longestStreakHours,
    longestStreakStart,
    neverClears,
    typicalClearHour,
    peakBacklog,
    peakAt,
    shiftDiagnostics,
  };
}
