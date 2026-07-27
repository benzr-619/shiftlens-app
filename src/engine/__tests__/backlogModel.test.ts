import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { backlogRecurrence } from '../backlogModel';

/** The OLD single-decay formula, reimplemented ONLY here (as the equivalence oracle) — never
 * imported into engine code. `backlog[h] = max(0, backlog[h-1]*decay + (req[h]-cap[h]))`,
 * circular over 168h, two-pass settle (same convention as the new recurrence). */
function oldDecayFormula(capacity168: number[], requirement168: number[], decay: number): number[] {
  const backlog = new Array(168).fill(0);
  for (let pass = 0; pass < 2; pass++) {
    for (let g = 0; g < 168; g++) {
      const carryIn = backlog[(g - 1 + 168) % 168] * decay;
      const deficit = (requirement168[g] ?? 0) - (capacity168[g] ?? 0);
      backlog[g] = Math.max(0, carryIn + deficit);
    }
  }
  return backlog;
}

function randomArray168(seed: number, scale: number): number[] {
  let x = seed;
  const next = () => {
    // xorshift32, deterministic across runs — no Math.random() (Date.now()/Math.random() are
    // avoided project-wide for workflow-resumability reasons; a simple deterministic PRNG here
    // is enough for a property test with a fixed seed).
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x |= 0;
    return (Math.abs(x) % 10000) / 10000;
  };
  return Array.from({ length: 168 }, () => next() * scale);
}

describe('PR B step 1 — refactor equivalence (must pass BEFORE the physics-changing DEFAULTS land)', () => {
  it('with abandonRate=0.15, recoveryEfficiency=1, maxDrainFraction=1, the new recurrence is ALGEBRAICALLY IDENTICAL to the old max(0, b*0.85 + req - cap) formula, over random capacity/requirement arrays', () => {
    const params = { abandonRate: 0.15, recoveryEfficiency: 1, maxDrainFraction: 1 };
    for (let trial = 0; trial < 20; trial++) {
      const capacity = randomArray168(1000 + trial * 7, 20);
      const requirement = randomArray168(2000 + trial * 13, 20);
      const expected = oldDecayFormula(capacity, requirement, 0.85);
      const actual = backlogRecurrence(capacity, requirement, params).backlog;
      for (let g = 0; g < 168; g++) {
        expect(actual[g]).toBeCloseTo(expected[g], 9);
      }
    }
  });

  it('carriedIn matches the old pre-adjustment carry-in (backlog[h-1]*decay) under the same degenerate constants', () => {
    const params = { abandonRate: 0.15, recoveryEfficiency: 1, maxDrainFraction: 1 };
    const capacity = randomArray168(555, 15);
    const requirement = randomArray168(777, 15);
    const expectedBacklog = oldDecayFormula(capacity, requirement, 0.85);
    const { carriedIn } = backlogRecurrence(capacity, requirement, params);
    for (let g = 0; g < 168; g++) {
      const prevBacklog = expectedBacklog[(g - 1 + 168) % 168];
      expect(carriedIn[g]).toBeCloseTo(prevBacklog * 0.85, 9);
    }
  });
});

describe('backlog recurrence invariants (hold under any params)', () => {
  const realisticParams = { abandonRate: 0.03, recoveryEfficiency: 0.6, maxDrainFraction: 0.3 };

  it('backlog[h] >= 0 for all h, always', () => {
    const capacity = randomArray168(42, 10);
    const requirement = randomArray168(99, 10);
    const { backlog } = backlogRecurrence(capacity, requirement, realisticParams);
    for (const b of backlog) expect(b).toBeGreaterThanOrEqual(0);
  });

  it('zero deficit everywhere => zero backlog everywhere', () => {
    const flat = new Array(168).fill(5);
    const { backlog } = backlogRecurrence(flat, flat, realisticParams);
    expect(backlog.every((b) => b === 0)).toBe(true);
  });
});

describe('the recurrence lives in exactly ONE place — structural guard against a second implementation', () => {
  it('solver.ts imports backlogRecurrence from ./backlogModel and does not locally reimplement the max(0, carried + deficit) pattern', () => {
    const src = readFileSync(new URL('../solver.ts', import.meta.url), 'utf-8');
    expect(src).toMatch(/from '\.\/backlogModel'/);
    // The old inline recurrence body — if this pattern reappears in solver.ts, someone has
    // re-duplicated the formula instead of importing the shared one.
    expect(src).not.toMatch(/carryIn\s*\+\s*deficit/);
  });

  it('backlog.ts imports backlogRecurrence from ./backlogModel and does not locally reimplement it', () => {
    const src = readFileSync(new URL('../backlog.ts', import.meta.url), 'utf-8');
    expect(src).toMatch(/from '\.\/backlogModel'/);
    expect(src).not.toMatch(/backlog\[\(g - 1 \+ 168\) % 168\] \* decay/);
  });
});
