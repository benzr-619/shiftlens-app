import { describe, it, expect } from 'vitest';
import { namePattern } from '../whenPattern';

function zeros(): number[] {
  return new Array(168).fill(0);
}
function g(day: number, hour: number): number {
  return day * 24 + hour;
}

describe('namePattern — the §5.2 ladder', () => {
  it('rung 1 — a block, every day ("mornings")', () => {
    const v = zeros();
    for (let day = 0; day < 7; day++) {
      for (const h of [7, 8, 9, 10, 11]) v[g(day, h)] = 100;
    }
    expect(namePattern(v, 'higher-is-worse')).toBe('mornings');
  });

  it('rung 2 — weekday/weekend × block ("weekday nights")', () => {
    const v = zeros();
    // 25 cells: weekdays (Mon-Fri) × 5 of the 8 night hours — a genuine subset of the
    // "nights" block, large enough to pass rung 2's thresholds but NOT rung 1's (see
    // whenPattern.ts's header note on why rung 1/2 share the same capture denominator and
    // only diverge on purity for blocks whose size isn't exactly 35).
    for (const day of [1, 2, 3, 4, 5]) {
      for (const h of [23, 0, 1, 2, 3]) v[g(day, h)] = 100;
    }
    // 17 filler cells elsewhere (afternoons, spread thin) so the worst-quartile is exactly
    // 42 without inflating any other candidate above threshold.
    const filler: Array<[number, number]> = [
      [0, 12], [0, 13], [0, 14], [3, 12], [3, 13], [3, 14],
      [4, 12], [4, 13], [5, 12], [5, 13], [6, 12], [6, 13],
      [0, 15], [3, 15], [4, 15], [5, 15], [6, 15],
    ];
    for (const [day, h] of filler) v[g(day, h)] = 50;
    expect(namePattern(v, 'higher-is-worse')).toBe('weekday nights');
  });

  it('rung 3 (single day × block) is structurally unreachable at these fixed thresholds — falls through', () => {
    // FLAGGED FINDING (see whenPattern.ts's header): a single (day, block) candidate has at
    // most 8 cells (the "nights" block), but the capture bar is 50% of the fixed 42-hour
    // worst quartile = 21 hits — impossible for an 8-cell candidate to ever reach, for any
    // input. Even the most concentrated possible case (a single day's entire night block
    // maximally elevated) cannot pass rung 3; it falls through to rung 4 or the fallback.
    const v = zeros();
    for (const h of [23, 0, 1, 2, 3, 4, 5, 6]) v[g(6, h)] = 100; // all of Saturday's night hours
    const result = namePattern(v, 'higher-is-worse');
    expect(result).not.toBe('Saturday nights');
  });

  it('rung 4 — a single day, spanning all its blocks ("Tuesdays")', () => {
    const v = zeros();
    for (let h = 0; h < 24; h++) v[g(2, h)] = 100; // all of Tuesday
    // 18 filler cells on OTHER days, kept below any single rung1/2/3 candidate's threshold.
    for (const h of [23, 0, 1, 2, 3, 4, 5, 6]) v[g(0, h)] = 50; // 8 cells, Sunday nights
    for (const h of [23, 0, 1, 2]) v[g(3, h)] = 50; // 4 cells, Wednesday nights
    for (const h of [17, 18, 19, 20, 21, 22]) v[g(4, h)] = 50; // 6 cells, Thursday evenings
    expect(namePattern(v, 'higher-is-worse')).toBe('Tuesdays');
  });

  it('fallback — no block/day pattern clears the bar, names the single worst hour', () => {
    // A scattered baseline (distinct values, no ties) so the "next 41 worst" hours land
    // arbitrarily across days/blocks rather than clustering into a clean day boundary the
    // way a flat tied baseline would (ties break by array index, which — tried first —
    // produced a full contiguous day and accidentally passed rung 4).
    const v = Array.from({ length: 168 }, (_, i) => (i * 47 + 13) % 97);
    v[g(5, 3)] = 100000; // Friday 03:00, a lone extreme outlier
    expect(namePattern(v, 'higher-is-worse')).toBe('Fri 03:00');
  });

  it('lower-is-worse direction: worst hours are the LOWEST values', () => {
    const v = new Array(168).fill(100);
    for (let day = 0; day < 7; day++) {
      for (const h of [7, 8, 9, 10, 11]) v[g(day, h)] = 1; // mornings are the worst (lowest)
    }
    expect(namePattern(v, 'lower-is-worse')).toBe('mornings');
  });
});
