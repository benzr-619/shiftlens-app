// Shared "when does the queue build/peak/clear" pattern finder — pulled out of `Panel1.tsx`
// (2026-07-28, Panel 2 rework) once Panel 2 became a second consumer, per the standing
// convention elsewhere in this app (`lib/dayOrder.ts`, `lib/averageDay.ts`) of sharing a
// helper rather than duplicating its logic once a second caller needs it.
import { caughtUpThresholdForHour } from '../engine/backlogModel';

export interface QueuePattern {
  buildHour: number;
  peakHour: number;
  peakValue: number;
  clearHour: number | null; // null = never returns to near-baseline before the day resets
}

export function findLowHour(avg: number[]): number {
  let lowIdx = 0;
  for (let i = 1; i < avg.length; i++) if (avg[i] < avg[lowIdx]) lowIdx = i;
  return lowIdx;
}

/** First hour, walking forward circularly from the day's own low point, where the curve
 * starts a sustained (2-hour) climb away from that low. */
export function findBuildHour(avg: number[], lowIdx: number): number {
  const n = avg.length;
  const lowVal = avg[lowIdx];
  for (let step = 1; step <= n; step++) {
    const h = (lowIdx + step) % n;
    const hNext = (h + 1) % n;
    if (avg[h] > lowVal && avg[hNext] >= avg[h]) return h;
  }
  return (lowIdx + 1) % n;
}

/** First hour after the peak where the curve returns to near its own daily low point — reuses
 * the existing relative "caught up" logic (~10% of that hour's own averaged requirement),
 * applied to the averaged curve. `null` if it never returns before the day resets. */
export function findClearHour(avg: number[], avgRequirement: number[], peakHour: number): number | null {
  const n = avg.length;
  for (let step = 1; step <= n; step++) {
    const h = (peakHour + step) % n;
    if (avg[h] <= caughtUpThresholdForHour(avgRequirement[h] ?? 0)) return h;
  }
  return null;
}

export function computeQueuePattern(avgBacklog: number[], avgRequirement: number[]): QueuePattern {
  const lowIdx = findLowHour(avgBacklog);
  let peakHour = 0;
  for (let i = 1; i < avgBacklog.length; i++) if (avgBacklog[i] > avgBacklog[peakHour]) peakHour = i;
  const peakValue = avgBacklog[peakHour];
  const buildHour = findBuildHour(avgBacklog, lowIdx);
  const clearHour = findClearHour(avgBacklog, avgRequirement, peakHour);
  return { buildHour, peakHour, peakValue, clearHour };
}

export function fmtHour(h: number): string {
  return `${((h % 24) + 24) % 24}`.padStart(2, '0') + ':00';
}

/** Nurse-hours -> patient-arrivals-equivalent, dividing by the department's own floor pace
 * (`floorWhppv`, nurse-hours/visit) — exact for a real-compression curve (see
 * `backlogModel.ts`'s hours<->visits bridging identity); for a no-compression curve
 * (`NO_COMPRESSION_FLOOR_WHPPV = 1`) this is a no-op, since there's no real visits concept. */
export function toPatients(peakValueHours: number, floorWhppv: number): number {
  return Math.max(0, Math.round(peakValueHours / floorWhppv));
}

/** Shared "build/peak/clear" sentence — pulled out of `Panel1.tsx` (2026-07-28, Panel 2
 * rework) once Panel 2 became a second consumer, reusing Panel 1's exact phrasing rather than
 * inventing a parallel one. Reports the peak in PATIENTS (arrivals-equivalent), not raw
 * nurse-hours — see `toPatients`'s header. */
export function queuePatternSentence(pattern: QueuePattern, lead: string, floorWhppv: number): string {
  const clearPart =
    pattern.clearHour !== null
      ? `come back down by around ${fmtHour(pattern.clearHour)}`
      : "doesn't fully clear before building again the next day";
  const patients = toPatients(pattern.peakValue, floorWhppv);
  return `${lead}the backlog is modeled to build starting around ${fmtHour(pattern.buildHour)}, peak around ${fmtHour(
    pattern.peakHour
  )} (about ${patients} patient${patients === 1 ? '' : 's'} behind), and ${clearPart}.`;
}

// --- Weekday/weekend split — pulled out of `Panel1.tsx` (2026-07-28, Panel 2 rework) once
// Panel 2 became a second consumer. Display heuristics, tunable, not load-bearing math (per
// the governing spec's own framing) — first-pass defaults for when a weekday/weekend split is
// meaningful enough to render as two sentences instead of one combined sentence for the week.

export const WEEKDAY_DAYS = [1, 2, 3, 4, 5];
export const WEEKEND_DAYS = [0, 6];
export const PEAK_HOUR_DIFF_THRESHOLD_HOURS = 3;
export const PEAK_MAGNITUDE_DIFF_FRACTION = 0.4;

export function averageOverDays(values168: number[], days: number[]): number[] {
  const out = new Array(24).fill(0);
  for (let hour = 0; hour < 24; hour++) {
    let sum = 0;
    for (const d of days) sum += values168[d * 24 + hour] ?? 0;
    out[hour] = sum / days.length;
  }
  return out;
}

function circularHourDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 24 - d);
}

export function patternsDifferMeaningfully(weekday: QueuePattern, weekend: QueuePattern): boolean {
  if (circularHourDiff(weekday.peakHour, weekend.peakHour) > PEAK_HOUR_DIFF_THRESHOLD_HOURS) return true;
  const maxVal = Math.max(weekday.peakValue, weekend.peakValue, 1e-9);
  return Math.abs(weekday.peakValue - weekend.peakValue) / maxVal > PEAK_MAGNITUDE_DIFF_FRACTION;
}
