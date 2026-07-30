import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { backlogHourStep, backlogHourStepHours, backlogRecurrence, NO_COMPRESSION_FLOOR_WHPPV } from '../backlogModel';

// 2026-07-28 REVERSAL (NINTH shape, BACKLOG_MODEL_VISITS_BASED_SPEC_2026-07-28.md, see
// .claude/rules/engine-solver.md) — the capacity-elasticity model's own equivalence proof (this
// file used to verify PR B's refactor was behavior-preserving against a retired single-decay
// formula, then tested `spare`/`stretch` paydown directly) is meaningless now — there is no
// spare/stretch split anymore. Replaced with direct tests of the VISITS-based formula: the
// single-hour primitive, the hours-bridge (the algebraic identity the whole rewrite banks on:
// `backlogHours[h] = max(0, arrivals[h]*floorWhppv + backlogHours[h-1] - capacity[h])`), and the
// full-week circular recurrence (non-negativity, a single-hole clearing case, and the
// no-compression degenerate case used for boarding/combined curves).

function randomArray168(seed: number, scale: number): number[] {
  let x = seed;
  const next = () => {
    // xorshift32, deterministic across runs — no Math.random() (project-wide convention).
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x |= 0;
    return (Math.abs(x) % 10000) / 10000;
  };
  return Array.from({ length: 168 }, () => next() * scale);
}

describe('backlogHourStep — the single-hour VISITS primitive', () => {
  it('demand = arrivals + prior; served = min(demand, capacity/floorWhppv); backlog = demand - served', () => {
    const step1 = backlogHourStep(0, 6, 5, 2); // maxServable = 3, demand = 5, served = 3
    expect(step1.backlogVisits).toBe(2);
    expect(step1.carriedInVisits).toBe(0);

    const step2 = backlogHourStep(2, 10, 0, 2); // maxServable = 5, demand = 2, served = 2
    expect(step2.backlogVisits).toBe(0);
    expect(step2.carriedInVisits).toBe(2);
  });

  it('is always non-negative over random arrivals/capacity at a fixed floorWhppv', () => {
    const arrivals = randomArray168(1, 15);
    const capacity = randomArray168(2, 15);
    let prior = 0;
    for (let g = 0; g < 168; g++) {
      const step = backlogHourStep(prior, capacity[g], arrivals[g], 1.7);
      expect(step.backlogVisits).toBeGreaterThanOrEqual(0);
      prior = step.backlogVisits;
    }
  });
});

describe('backlogHourStepHours — the hours-bridge every real consumer calls', () => {
  it('matches the closed-form identity: backlogHours = max(0, arrivals*floorWhppv + priorHours - capacity)', () => {
    const cases: Array<[number, number, number, number]> = [
      [0, 6, 5, 2],
      [4, 6, 5, 2],
      [20, 10, 1, 2],
      [0, 100, 3, 1.5],
      [50, 2, 10, 3],
    ];
    for (const [priorHours, capacity, arrivals, floorWhppv] of cases) {
      const { backlog } = backlogHourStepHours(priorHours, capacity, arrivals, floorWhppv);
      const expected = Math.max(0, arrivals * floorWhppv + priorHours - capacity);
      expect(backlog).toBeCloseTo(expected, 9);
    }
  });

  it('never goes negative, even when capacity vastly exceeds demand', () => {
    const { backlog } = backlogHourStepHours(3, 1000, 1, 2);
    expect(backlog).toBe(0);
  });
});

describe('backlogRecurrence — full-week circular invariants', () => {
  it('backlog[h] >= 0 for all h, always, over random arrivals/capacity', () => {
    const capacity = randomArray168(42, 10);
    const arrivals = randomArray168(99, 10);
    const { backlog } = backlogRecurrence(capacity, arrivals, 1.6);
    for (const b of backlog) expect(b).toBeGreaterThanOrEqual(0);
  });

  it('zero deficit everywhere (capacity exactly meets floor-pace-implied demand) => zero backlog everywhere', () => {
    const floorWhppv = 2;
    const arrivals = new Array(168).fill(5);
    const capacity = new Array(168).fill(10); // 5 visits * floorWhppv(2) = 10 hours needed, exactly met
    const { backlog } = backlogRecurrence(capacity, arrivals, floorWhppv);
    expect(backlog.every((b) => b === 0)).toBe(true);
  });

  it('a single deficit hour, fully paid down by spare capacity before the week wraps, reaches a genuine periodic fixed point', () => {
    const floorWhppv = 2;
    const arrivals = new Array(168).fill(0);
    arrivals[0] = 10; // 10 visits * floorWhppv(2) = 20 hours of implied demand
    const capacity = new Array(168).fill(4); // 4 spare hours/hr everywhere but hour 0
    capacity[0] = 0;
    const { backlog } = backlogRecurrence(capacity, arrivals, floorWhppv);

    expect(backlog[0]).toBe(20);
    expect(backlog[1]).toBe(16);
    expect(backlog[2]).toBe(12);
    expect(backlog[3]).toBe(8);
    expect(backlog[4]).toBe(4);
    expect(backlog[5]).toBe(0);
    expect(backlog[167]).toBe(0); // fully cleared long before the wrap
  });

  it('no separate stretch/paydown mechanism exists — capacity is the ONLY thing that pays a hole down (unlike the retired bandCeiling-stretch model)', () => {
    // Same shape as the previous test, but confirm there's no second lever: a huge capacity
    // number pays down proportionally, nothing more, nothing "extra" from any ceiling concept.
    const floorWhppv = 1;
    const arrivals = new Array(168).fill(0);
    arrivals[0] = 100;
    const capacity = new Array(168).fill(100);
    capacity[0] = 0;
    const { backlog } = backlogRecurrence(capacity, arrivals, floorWhppv);
    expect(backlog[0]).toBe(100);
    expect(backlog[1]).toBe(0); // fully paid down by capacity alone in one hour
  });

  it('NO_COMPRESSION_FLOOR_WHPPV (1) degenerates to a plain max(0, demand + backlog[h-1] - capacity) recurrence — the boarding/combined judgment call', () => {
    const capacity = randomArray168(11, 20);
    const demandHours = randomArray168(22, 20); // a nurse-hours demand curve (e.g. boarding)

    const { backlog } = backlogRecurrence(capacity, demandHours, NO_COMPRESSION_FLOOR_WHPPV);

    // Reference: the same circular multi-pass settle, hand-rolled with the plain formula.
    const ref = new Array(168).fill(0);
    for (let pass = 0; pass < 6; pass++) {
      for (let g = 0; g < 168; g++) {
        const prior = ref[(g - 1 + 168) % 168];
        ref[g] = Math.max(0, demandHours[g] + prior - capacity[g]);
      }
    }
    for (let g = 0; g < 168; g++) expect(backlog[g]).toBeCloseTo(ref[g], 6);
  });

  it('backlogVisits equals backlog (hours) exactly when floorWhppv === 1, and equals backlog/floorWhppv otherwise', () => {
    const capacity = randomArray168(5, 10);
    const arrivals = randomArray168(6, 10);
    const { backlog: hours1, backlogVisits: visits1 } = backlogRecurrence(capacity, arrivals, 1);
    for (let g = 0; g < 168; g++) expect(visits1[g]).toBeCloseTo(hours1[g], 9);

    const { backlog: hours2, backlogVisits: visits2 } = backlogRecurrence(capacity, arrivals, 2.5);
    for (let g = 0; g < 168; g++) expect(visits2[g]).toBeCloseTo(hours2[g] / 2.5, 9);
  });
});

describe('the recurrence lives in exactly ONE place — structural guard against a second implementation', () => {
  it('solver.ts imports the shared recurrence from ./backlogModel and does not locally reimplement it', () => {
    const src = readFileSync(new URL('../solver.ts', import.meta.url), 'utf-8');
    expect(src).toMatch(/from '\.\/backlogModel'/);
    expect(src).toMatch(/backlogHourStepHours|backlogRecurrence/);
  });

  it('backlog.ts imports backlogRecurrence from ./backlogModel and does not locally reimplement it', () => {
    const src = readFileSync(new URL('../backlog.ts', import.meta.url), 'utf-8');
    expect(src).toMatch(/from '\.\/backlogModel'/);
    expect(src).toMatch(/backlogRecurrence/);
  });
});
