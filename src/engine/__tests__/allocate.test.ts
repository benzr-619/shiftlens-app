import { describe, expect, it } from 'vitest';
import { normalizeEsiMix, weightedArrivals } from '../allocate';
import type { EsiMix } from '../types';

// SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md §5 — the one sanctioned auto-correction in
// the app: an ESI mix that doesn't sum to arrivals is arithmetically impossible, not merely
// suspicious, so it's corrected (with disclosure) rather than just flagged.
describe('normalizeEsiMix', () => {
  it('is a no-op when the mix already sums to arrivals', () => {
    const arrivals = [10, 20, 30];
    const esiMix: EsiMix = { esi12: [2, 4, 6], esi3: [5, 11, 18], esi45: [3, 5, 6] };
    const { esiMix: normalized, adjustment } = normalizeEsiMix(arrivals, esiMix);
    expect(adjustment).toBeNull();
    expect(normalized).toEqual(esiMix);
  });

  it('sums to arrivals per cell after correction, preserving ESI 3 exactly', () => {
    // Reproduces the qualitative NYP-W shape: mix sums to ~126% of arrivals.
    const arrivals = [100];
    const esiMix: EsiMix = { esi12: [21.3], esi3: [54.5], esi45: [24.2] }; // sums to 100.0... wait use 126
    esiMix.esi12[0] = 26.8; // rescale so total is 126 against arrivals=100
    esiMix.esi3[0] = 68.6;
    esiMix.esi45[0] = 30.5;
    const totalBefore = esiMix.esi12[0] + esiMix.esi3[0] + esiMix.esi45[0];
    expect(totalBefore).toBeCloseTo(125.9, 1);

    const { esiMix: normalized, adjustment } = normalizeEsiMix(arrivals, esiMix);
    expect(adjustment).not.toBeNull();
    expect(adjustment!.adjustedCells).toEqual([0]);
    expect(adjustment!.esi3ExceededArrivalsCells).toEqual([]);
    // ESI 3 preserved exactly (not proportionally scaled).
    expect(normalized.esi3[0]).toBeCloseTo(esiMix.esi3[0], 9);
    // ESI 1-2 and ESI 4-5 scaled proportionally to make the total land on arrivals.
    const total = normalized.esi12[0] + normalized.esi3[0] + normalized.esi45[0];
    expect(total).toBeCloseTo(100, 6);
    const sparseScale = normalized.esi12[0] / esiMix.esi12[0];
    expect(normalized.esi45[0] / esiMix.esi45[0]).toBeCloseTo(sparseScale, 9);
  });

  it('falls back to proportional scaling of all three when ESI 3 alone meets/exceeds arrivals', () => {
    const arrivals = [10];
    const esiMix: EsiMix = { esi12: [2], esi3: [15], esi45: [3] }; // esi3 alone > arrivals
    const { esiMix: normalized, adjustment } = normalizeEsiMix(arrivals, esiMix);
    expect(adjustment).not.toBeNull();
    expect(adjustment!.esi3ExceededArrivalsCells).toEqual([0]);
    const total = normalized.esi12[0] + normalized.esi3[0] + normalized.esi45[0];
    expect(total).toBeCloseTo(10, 9);
    // All three scaled by the same factor (10/20), not just the sparse ones.
    const scale = 10 / 20;
    expect(normalized.esi12[0]).toBeCloseTo(2 * scale, 9);
    expect(normalized.esi3[0]).toBeCloseTo(15 * scale, 9);
    expect(normalized.esi45[0]).toBeCloseTo(3 * scale, 9);
  });

  it('skips cells where arrivals is zero (nothing to normalize against)', () => {
    const arrivals = [0];
    const esiMix: EsiMix = { esi12: [1], esi3: [1], esi45: [1] };
    const { adjustment } = normalizeEsiMix(arrivals, esiMix);
    expect(adjustment).toBeNull();
  });

  it('weightedArrivals applies normalization before acuity weighting, so hasEsi still reads true', () => {
    const arrivals = [100];
    const esiMix: EsiMix = { esi12: [26.8], esi3: [68.6], esi45: [30.5] };
    const { hasEsi } = weightedArrivals(arrivals, esiMix, { esi12: 1.75, esi3: 1, esi45: 0.5 });
    expect(hasEsi).toBe(true);
  });
});
