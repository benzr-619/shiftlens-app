import { describe, expect, it } from 'vitest';
import { checkBoardingDurationConsistency, checkMonthlyDispersion } from '../inputIntegrity';

describe('PR K — input integrity (§10)', () => {
  describe('checkBoardingDurationConsistency', () => {
    it('reproduces the qualitative shape of the real defect with invented numbers: scalar and monthly-mean average disagree by >15%', () => {
      // Invented numbers of the same shape as the real defect (scalar ~10, monthly average
      // ~6.4 — a ~37% gap) — not the literal real figures (no-seeded-ED-data constraint).
      const monthly = new Array(12).fill(6.36);
      const res = checkBoardingDurationConsistency(10.02, monthly, null);
      expect(res).not.toBeNull();
      expect(res!.withinTolerance).toBe(false);
      expect(res!.scalarValue).toBe(10.02);
      expect(res!.impliedValue).toBeCloseTo(6.36, 6);
      expect(res!.diffPct).toBeGreaterThan(0.15);
    });

    it('within tolerance when scalar and monthly average roughly agree', () => {
      const monthly = new Array(12).fill(9.8);
      const res = checkBoardingDurationConsistency(10, monthly, null);
      expect(res).not.toBeNull();
      expect(res!.withinTolerance).toBe(true);
    });

    it('returns null with no per-period data or a non-positive scalar', () => {
      expect(checkBoardingDurationConsistency(10, null, null)).toBeNull();
      expect(checkBoardingDurationConsistency(0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], null)).toBeNull();
      expect(checkBoardingDurationConsistency(null, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], null)).toBeNull();
    });

    it('falls back to day-of-week means when monthly means are absent', () => {
      const dow = [8, 8, 8, 8, 8, 8, 8];
      const res = checkBoardingDurationConsistency(8, null, dow);
      expect(res).not.toBeNull();
      expect(res!.withinTolerance).toBe(true);
    });
  });

  describe('checkMonthlyDispersion', () => {
    it('flags a real-world-shaped 4x swing (invented numbers, same shape as the real defect)', () => {
      const monthly = [15.1, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4.0]; // Jan high, Dec low — ~3.8x
      const res = checkMonthlyDispersion(monthly);
      expect(res).not.toBeNull();
      expect(res!.flagged).toBe(true);
      expect(res!.ratio).toBeGreaterThan(3);
    });

    it('does not flag modest month-to-month variation', () => {
      const monthly = [8, 8.5, 9, 8.2, 7.8, 8, 8.4, 8.1, 7.9, 8.3, 8, 8.2];
      const res = checkMonthlyDispersion(monthly);
      expect(res).not.toBeNull();
      expect(res!.flagged).toBe(false);
    });

    it('returns null with no monthly data', () => {
      expect(checkMonthlyDispersion(null)).toBeNull();
      expect(checkMonthlyDispersion([1, 2, 3])).toBeNull();
    });
  });
});
