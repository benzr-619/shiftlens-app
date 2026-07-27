// Step 1 (core allocation) + Step 1b (acuity reweighting) + Step 1c (day-of-week smoothing)
import type { AcuityWeights, Cell168, EsiMix, SmoothingWeights } from './types';

export function deriveAnnualVisits(arrivals: Cell168): number {
  return sum(arrivals) * 52;
}

export function annualCoreRnHoursBudget(annualVisits: number, wHppvTarget: number): number {
  return annualVisits * wHppvTarget;
}

/**
 * §5 (SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md) — the one SANCTIONED auto-correction in
 * the app. A real ED's pulled ESI mix does not always sum to arrivals — NYP-W's summed to
 * 126%, because the source dashboard averaged only over days with a non-zero count (a sparse
 * category's per-cell "mean" was inflated toward its own minimum-possible nonzero value). This
 * is arithmetically IMPOSSIBLE (three sub-counts can't exceed their own total), not merely
 * suspicious — unlike `lib/inputIntegrity.ts`'s diagnostic-only checks, which flag plausible-
 * but-uncertain data without ever touching it. Per cell: preserve ESI 3 (the least sparse,
 * least biased-by-the-same-averaging-artifact category — an inference from one department's
 * data, not a proven universal, see .claude/rules/template-parsing.md's open question),
 * scale ESI 1-2 and ESI 4-5 proportionally so the three sum to arrivals. If ESI 3 alone
 * already meets/exceeds arrivals for a cell (didn't occur in NYP-W's 168 cells, but must be
 * handled), falls back to proportional scaling of ALL THREE for that cell instead.
 */
export interface EsiNormalizationAdjustment {
  /** Cells (0-167) where a correction was actually applied — either branch. */
  adjustedCells: number[];
  /** Cells where ESI 3 could not be preserved (the exceeds-arrivals fallback fired). */
  esi3ExceededArrivalsCells: number[];
  /** Whole-week totals before/after, for a plain-language summary at setup + results. */
  totalsBefore: { esi12: number; esi3: number; esi45: number };
  totalsAfter: { esi12: number; esi3: number; esi45: number };
}

export function normalizeEsiMix(
  arrivals: Cell168,
  esiMix: EsiMix
): { esiMix: EsiMix; adjustment: EsiNormalizationAdjustment | null } {
  const esi12 = esiMix.esi12.slice();
  const esi3 = esiMix.esi3.slice();
  const esi45 = esiMix.esi45.slice();
  const adjustedCells: number[] = [];
  const esi3ExceededArrivalsCells: number[] = [];

  for (let i = 0; i < arrivals.length; i++) {
    const total = esiMix.esi12[i] + esiMix.esi3[i] + esiMix.esi45[i];
    const target = arrivals[i];
    if (target <= 0 || Math.abs(total - target) < 1e-9) continue;

    if (esiMix.esi3[i] >= target) {
      // ESI 3 alone already meets/exceeds arrivals for this cell — preserving it exactly is
      // impossible without going negative elsewhere, so fall back to scaling all three.
      esi3ExceededArrivalsCells.push(i);
      adjustedCells.push(i);
      if (total > 0) {
        const scale = target / total;
        esi12[i] = esiMix.esi12[i] * scale;
        esi3[i] = esiMix.esi3[i] * scale;
        esi45[i] = esiMix.esi45[i] * scale;
      }
      continue;
    }

    const sparseTotal = esiMix.esi12[i] + esiMix.esi45[i];
    const sparseTarget = target - esiMix.esi3[i];
    adjustedCells.push(i);
    if (sparseTotal > 0) {
      const scale = sparseTarget / sparseTotal;
      esi12[i] = esiMix.esi12[i] * scale;
      esi45[i] = esiMix.esi45[i] * scale;
    } else {
      // No sparse-category signal to scale proportionally from — split the shortfall evenly.
      esi12[i] = sparseTarget / 2;
      esi45[i] = sparseTarget / 2;
    }
    esi3[i] = esiMix.esi3[i];
  }

  if (adjustedCells.length === 0) return { esiMix, adjustment: null };

  return {
    esiMix: { esi12, esi3, esi45 },
    adjustment: {
      adjustedCells,
      esi3ExceededArrivalsCells,
      totalsBefore: { esi12: sum(esiMix.esi12), esi3: sum(esiMix.esi3), esi45: sum(esiMix.esi45) },
      totalsAfter: { esi12: sum(esi12), esi3: sum(esi3), esi45: sum(esi45) },
    },
  };
}

/** Step 1b: reshapes the fixed pie, never resizes it. Returns raw arrivals unmodified if no ESI data. */
export function weightedArrivals(
  arrivals: Cell168,
  esiMix: EsiMix | undefined,
  weights: AcuityWeights
): { weighted: Cell168; hasEsi: boolean } {
  if (!esiMix) return { weighted: arrivals.slice(), hasEsi: false };
  const { esiMix: normalized } = normalizeEsiMix(arrivals, esiMix);
  const weighted = arrivals.map(
    (_, i) => weights.esi12 * normalized.esi12[i] + weights.esi3 * normalized.esi3[i] + weights.esi45 * normalized.esi45[i]
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
