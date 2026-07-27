import { describe, expect, it } from 'vitest';
import { severity } from '../solver';

// PR J (teaching layer) — verifies the exact claim `components/ConvexityDemo.tsx` makes to the
// user: the SAME 10 nurse-hours of shortfall scores higher (worse) concentrated in one hour
// than spread across four, using the real engine `severity` function (not a mock).
describe('PR J — convexity demo claim', () => {
  it('10 nurse-hours concentrated in 1 hour scores worse than 10 spread across 4 hours, same requirement baseline', () => {
    const requirement = 10;
    const spreadTotal = [2.5, 2.5, 2.5, 2.5].reduce((acc, b) => acc + severity(b, requirement), 0);
    const concentratedTotal = severity(10, requirement);
    expect(concentratedTotal).toBeGreaterThan(spreadTotal);
  });
});
