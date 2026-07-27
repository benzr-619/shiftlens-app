// PR A (RESULTS_PAGE_V2_SPEC_2026-07-27.md §5.2) — the ONE shared "when is it worst" phrase
// generator. Every templated sentence on the results page that names a time pattern (backlog
// build/peak/clear, worst unbroken stretch, demand-vs-capacity mismatch, etc.) must go through
// this — no component invents its own phrasing, per the spec's explicit instruction.
//
// FLAGGED FINDING (§11 ambiguity-handling — recorded rather than silently "fixed"): as
// literally specified, rung 3 (a single day × block, e.g. "Saturday nights") is
// MATHEMATICALLY UNREACHABLE for any 168-hour input under the spec's own fixed constants.
// Capture requires ≥50% of the fixed 42-hour worst quartile, i.e. ≥21 hits — but the largest
// single (day, block) candidate ("nights", 8 hours) has only 8 cells, so its capture can
// never exceed 8/42 ≈ 19%, regardless of the data. This is proven directly, not just
// argued: `whenPattern.test.ts`'s "rung 3 is structurally unreachable" test maximally
// concentrates an entire day's night block (the largest possible rung-3 candidate) and shows
// it still falls through. Implemented literally as specified (rungs 1/2/4/5 are all
// reachable and tested) rather than silently rescaling the thresholds to force rung 3 open —
// that would be inventing a reading the spec never stated. If a future session wants rung 3
// to actually fire, the fix is a deliberate, separate decision (e.g. scoping the "worst
// quartile" comparison per rung instead of globally), not a quiet tweak here.
import { DAY_LABELS } from '../engine/types';

export type WorseDirection = 'lower-is-worse' | 'higher-is-worse';

const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKEND_DAYS = new Set([0, 6]);
const WEEKDAY_DAYS = [1, 2, 3, 4, 5];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

interface Block {
  noun: string; // "nights", "mornings", ... — used bare (rung 1) and after a day/day-type qualifier
  hours: number[]; // hour-of-day, 0-23
}

// Fixed time blocks (§5.2) — cover all 24 hours exactly once between them.
const BLOCKS: Block[] = [
  { noun: 'nights', hours: [23, 0, 1, 2, 3, 4, 5, 6] }, // overnight 23-06
  { noun: 'mornings', hours: [7, 8, 9, 10, 11] }, // 07-11
  { noun: 'afternoons', hours: [12, 13, 14, 15, 16] }, // 12-16
  { noun: 'evenings', hours: [17, 18, 19, 20, 21, 22] }, // 17-22
];

const CAPTURE_THRESHOLD = 0.5;
const PURITY_THRESHOLD = 0.6;

function globalHour(day: number, hourOfDay: number): number {
  return day * 24 + hourOfDay;
}

interface Candidate {
  label: string;
  indices: number[]; // global hour indices (0-167) this description names
}

function candidatesForRung1(): Candidate[] {
  return BLOCKS.map((b) => ({
    label: b.noun,
    indices: ALL_DAYS.flatMap((d) => b.hours.map((h) => globalHour(d, h))),
  }));
}

function candidatesForRung2(): Candidate[] {
  const out: Candidate[] = [];
  for (const b of BLOCKS) {
    out.push({ label: `weekday ${b.noun}`, indices: WEEKDAY_DAYS.flatMap((d) => b.hours.map((h) => globalHour(d, h))) });
    out.push({
      label: `weekend ${b.noun}`,
      indices: [...WEEKEND_DAYS].flatMap((d) => b.hours.map((h) => globalHour(d, h))),
    });
  }
  return out;
}

function candidatesForRung3(): Candidate[] {
  const out: Candidate[] = [];
  for (const b of BLOCKS) {
    for (const d of ALL_DAYS) {
      out.push({ label: `${DAY_NAMES_FULL[d]} ${b.noun}`, indices: b.hours.map((h) => globalHour(d, h)) });
    }
  }
  return out;
}

function candidatesForRung4(): Candidate[] {
  return ALL_DAYS.map((d) => ({
    label: `${DAY_NAMES_FULL[d]}s`,
    indices: Array.from({ length: 24 }, (_, h) => globalHour(d, h)),
  }));
}

/** Picks the candidate that captures the most worst-quartile hours (ties broken by purity,
 * then by declaration order — deterministic). */
function bestOf(candidates: Candidate[], worstSet: Set<number>, worstCount: number): { label: string; capture: number; purity: number } {
  let best = { label: candidates[0].label, capture: -1, purity: -1 };
  for (const c of candidates) {
    const hits = c.indices.filter((i) => worstSet.has(i)).length;
    const capture = worstCount > 0 ? hits / worstCount : 0;
    const purity = c.indices.length > 0 ? hits / c.indices.length : 0;
    if (capture > best.capture || (capture === best.capture && purity > best.purity)) {
      best = { label: c.label, capture, purity };
    }
  }
  return best;
}

function fmtHourOnly(globalIdx: number): string {
  const day = Math.floor(globalIdx / 24);
  const hour = globalIdx % 24;
  return `${DAY_LABELS[day]} ${hour.toString().padStart(2, '0')}:00`;
}

/**
 * Names a human-readable time pattern for the worst quartile of a 168-hour week.
 *
 * @param values168 168 values, index = day*24+hour (day 0 = Sunday, engine convention).
 * @param direction whether a LOW value or a HIGH value counts as "worse" for this metric.
 * @returns a phrase like "weekday mornings", "Saturday nights", "Tuesdays", or (fallback) a
 *   single hour like "Sat 07:00".
 */
export function namePattern(values168: number[], direction: WorseDirection): string {
  const n = values168.length;
  const worstCount = Math.max(1, Math.round(n / 4));
  const sortedIdx = Array.from({ length: n }, (_, i) => i).sort((a, b) =>
    direction === 'lower-is-worse' ? values168[a] - values168[b] : values168[b] - values168[a],
  );
  const worstSet = new Set(sortedIdx.slice(0, worstCount));

  const rungs = [candidatesForRung1(), candidatesForRung2(), candidatesForRung3(), candidatesForRung4()];
  for (const candidates of rungs) {
    const best = bestOf(candidates, worstSet, worstCount);
    if (best.capture >= CAPTURE_THRESHOLD && best.purity >= PURITY_THRESHOLD) return best.label;
  }

  // Rung 5 fallback — name the single worst hour, as the page did before this helper existed.
  return fmtHourOnly(sortedIdx[0]);
}
