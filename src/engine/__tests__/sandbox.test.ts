import { describe, expect, it } from 'vitest';
import { computeSandbox } from '../sandbox';
import { DEFAULTS } from '../types';
import type { BacklogRecurrenceParams } from '../backlogModel';

const N = 168;
function flat(v: number): number[] {
  return new Array(N).fill(v);
}

const PARAMS: BacklogRecurrenceParams = {
  abandonRate: DEFAULTS.backlogAbandonRate,
  recoveryEfficiency: DEFAULTS.backlogRecoveryEfficiency,
  maxDrainFraction: DEFAULTS.backlogMaxDrainFraction,
};

describe('PR C — sandbox model (§5.4)', () => {
  it('hold nurses never reduce arrivals/BH shortfall — with zero medical boarding, hold has zero effect', () => {
    const arrivalsRequirement = flat(10);
    const bhBoarding = flat(2);
    const medBoarding = flat(0); // nothing for hold nurses to apply against
    const arrivals = flat(5);
    const edNurses = flat(8); // short against residual demand (10+2=12)

    const noHold = computeSandbox(arrivalsRequirement, medBoarding, bhBoarding, arrivals, edNurses, flat(0), PARAMS);
    const withHold = computeSandbox(arrivalsRequirement, medBoarding, bhBoarding, arrivals, edNurses, flat(50), PARAMS);

    expect(withHold.residualDemand).toEqual(noHold.residualDemand);
    expect(withHold.unmet).toEqual(noHold.unmet);
    expect(withHold.spare).toEqual(noHold.spare);
    expect(withHold.holdApplied).toEqual(flat(0));
    // Every hold-nurse-hour is pure surplus when there's no medical boarding to apply against.
    expect(withHold.holdSurplus).toEqual(flat(50));
  });

  it('surplus hold nurses appear as surplus, not as coverage — capped at medical boarding demand', () => {
    const arrivalsRequirement = flat(10);
    const bhBoarding = flat(0);
    const medBoarding = flat(3);
    const arrivals = flat(5);
    const edNurses = flat(10);

    const under = computeSandbox(arrivalsRequirement, medBoarding, bhBoarding, arrivals, edNurses, flat(2), PARAMS);
    const exact = computeSandbox(arrivalsRequirement, medBoarding, bhBoarding, arrivals, edNurses, flat(3), PARAMS);
    const over = computeSandbox(arrivalsRequirement, medBoarding, bhBoarding, arrivals, edNurses, flat(10), PARAMS);

    expect(under.holdApplied).toEqual(flat(2));
    expect(under.holdSurplus).toEqual(flat(0));

    expect(exact.holdApplied).toEqual(flat(3));
    expect(exact.holdSurplus).toEqual(flat(0));

    // Once medical boarding is fully absorbed (hold=3=medBoarding), MORE hold never applies
    // further — it all becomes surplus, and residualDemand/unmet are identical to the exact case.
    expect(over.holdApplied).toEqual(flat(3));
    expect(over.holdSurplus).toEqual(flat(7));
    expect(over.residualDemand).toEqual(exact.residualDemand);
    expect(over.unmet).toEqual(exact.unmet);
  });

  it('a full-coverage input produces zero unmet and a flat (zero) queue', () => {
    const arrivalsRequirement = flat(10);
    const bhBoarding = flat(2);
    const medBoarding = flat(4);
    const arrivals = flat(5);
    const hold = flat(4); // fully absorbs medical boarding
    // residualDemand = 10 + 0 + 2 = 12 exactly; staff exactly that.
    const edNurses = flat(12);

    const result = computeSandbox(arrivalsRequirement, medBoarding, bhBoarding, arrivals, edNurses, hold, PARAMS);
    expect(result.unmet.every((v) => v === 0)).toBe(true);
    for (const v of result.queueDepth) expect(v).toBeCloseTo(0, 6);
  });

  it('effective wHPPV can go negative and is never silently clamped', () => {
    const arrivalsRequirement = flat(1);
    const bhBoarding = flat(0);
    const medBoarding = flat(20); // heavy boarding, no hold at all
    const arrivals = flat(2);
    const edNurses = flat(3); // far short once 20 unabsorbed hours of medical boarding are netted in

    const result = computeSandbox(arrivalsRequirement, medBoarding, bhBoarding, arrivals, edNurses, flat(0), PARAMS);
    // (3 - 20 - 0) / 2 = -8.5
    expect(result.effectiveWhppv[0]).toBeCloseTo(-8.5, 6);
  });

  it('effective wHPPV is 0 at an hour with zero arrivals, not NaN/Infinity', () => {
    const arrivalsRequirement = flat(10);
    const bhBoarding = flat(0);
    const medBoarding = flat(0);
    const arrivals = flat(0);
    const edNurses = flat(5);
    const result = computeSandbox(arrivalsRequirement, medBoarding, bhBoarding, arrivals, edNurses, flat(0), PARAMS);
    expect(result.effectiveWhppv[0]).toBe(0);
  });
});
