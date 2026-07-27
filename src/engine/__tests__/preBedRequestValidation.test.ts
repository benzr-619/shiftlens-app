import { describe, expect, it } from 'vitest';
import { computePreBedRequestValidation } from '../preBedRequestValidation';

describe('computePreBedRequestValidation (§7, optional diagnostic)', () => {
  it('returns null when preBedRequestCensus is absent', () => {
    const hourlyRequirement = new Array(168).fill(5);
    expect(computePreBedRequestValidation(undefined, hourlyRequirement, 1.7)).toBeNull();
  });

  it('returns null when wHppvTarget is non-positive (guards the divide)', () => {
    const census = new Array(168).fill(10);
    const hourlyRequirement = new Array(168).fill(5);
    expect(computePreBedRequestValidation(census, hourlyRequirement, 0)).toBeNull();
  });

  it('reports correlation ~1 when observed census tracks the implied occupancy proportionally', () => {
    const hourlyRequirement = Array.from({ length: 168 }, (_, i) => 4 + Math.sin(i / 10) * 2);
    const wHppvTarget = 1.5;
    const impliedOccupancy = hourlyRequirement.map((v) => v / wHppvTarget);
    const census = impliedOccupancy.map((v) => v * 3 + 1); // scaled + offset, same shape
    const result = computePreBedRequestValidation(census, hourlyRequirement, wHppvTarget)!;
    expect(result.correlation).toBeGreaterThan(0.99);
  });

  it('reports correlation near 0 for unrelated curves', () => {
    const hourlyRequirement = new Array(168).fill(5); // flat -> zero variance in implied occupancy
    const census = Array.from({ length: 168 }, (_, i) => (i % 2 === 0 ? 10 : 2));
    const result = computePreBedRequestValidation(census, hourlyRequirement, 1.7)!;
    expect(result.correlation).toBe(0); // zero-variance implied curve -> correlation defined as 0
  });

  it('computes meanObserved/meanImplied correctly', () => {
    const census = new Array(168).fill(8);
    const hourlyRequirement = new Array(168).fill(3.4);
    const wHppvTarget = 1.7;
    const result = computePreBedRequestValidation(census, hourlyRequirement, wHppvTarget)!;
    expect(result.meanObserved).toBeCloseTo(8, 9);
    expect(result.meanImplied).toBeCloseTo(2, 9); // 3.4/1.7
  });
});
