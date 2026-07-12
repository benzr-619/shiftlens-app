// Step 1 (core allocation) + Step 1b (acuity reweighting) + Step 1c (day-of-week smoothing)
import type { AcuityWeights, Cell168, EsiMix, SmoothingWeights } from './types';

export function deriveAnnualVisits(arrivals: Cell168): number {
  return sum(arrivals) * 52;
}

export function annualCoreRnHoursBudget(annualVisits: number, wHppvTarget: number): number {
  return annualVisits * wHppvTarget;
}

/** Step 1b: reshapes the fixed pie, never resizes it. Returns raw arrivals unmodified if no ESI data. */
export function weightedArrivals(
  arrivals: Cell168,
  esiMix: EsiMix | undefined,
  weights: AcuityWeights
): { weighted: Cell168; hasEsi: boolean } {
  if (!esiMix) return { weighted: arrivals.slice(), hasEsi: false };
  const weighted = arrivals.map(
    (_, i) => weights.esi12 * esiMix.esi12[i] + weights.esi3 * esiMix.esi3[i] + weights.esi45 * esiMix.esi45[i]
  );
  return { weighted, hasEsi: true };
}

/** Step 1.2: allocate the fixed annual budget across the 168 cells by share of weighted arrivals. */
export function allocateCellCoreHours(weighted: Cell168, annualBudget: number): Cell168 {
  const total = sum(weighted);
  if (total === 0) return weighted.map(() => 0);
  return weighted.map((w) => ((w / total) * annualBudget) / 52);
}

/**
 * Step 1c: circular day-of-week smoothing applied to the continuous cell_core_rn_hours curve,
 * before rounding or the Step 3 solve. Weights must sum to 1 to preserve the annual total exactly.
 */
export function smoothDayOfWeek(cellCoreHours: Cell168, weights: SmoothingWeights): Cell168 {
  const out = new Array<number>(168);
  for (let day = 0; day < 7; day++) {
    const prevDay = (day + 6) % 7;
    const nextDay = (day + 1) % 7;
    for (let hour = 0; hour < 24; hour++) {
      const idx = day * 24 + hour;
      const prevIdx = prevDay * 24 + hour;
      const nextIdx = nextDay * 24 + hour;
      out[idx] =
        weights.center * cellCoreHours[idx] +
        weights.neighbor * cellCoreHours[prevIdx] +
        weights.neighbor * cellCoreHours[nextIdx];
    }
  }
  return out;
}

export function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}
