// PR K (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §10) — input integrity checks. A real
// department's upload silently produced wrong numbers in two ways, neither the user's fault,
// neither surfaced. These are pure, DIAGNOSTIC-ONLY functions — they never auto-correct
// anything; the manager knows which data source is trustworthy and the tool does not.

const CONSISTENCY_TOLERANCE = 0.15; // ~15% per spec §10(1) — a display heuristic, not exact math
const DISPERSION_RATIO_THRESHOLD = 3; // "swings 4x" in the spec's own real example; 3x is a conservative flag point

export interface BoardingDurationConsistency {
  /** The Scalars-tab mean boarding duration — what the engine's seasonality ratio actually uses
   * as its denominator (see engine/boarding.ts's overallMeanBoardingDuration). */
  scalarValue: number;
  /** The plain average of the per-period (monthly or day-of-week) means — what the SHAPE of the
   * uploaded seasonality data implies the baseline should be. */
  impliedValue: number;
  /** |implied - scalar| / scalar. */
  diffPct: number;
  withinTolerance: boolean;
}

/**
 * §10(1) — cross-field consistency check. When the monthly/day-of-week means and the scalar
 * baseline disagree by more than ~15%, this returns a result flagging it — the caller decides
 * how to render "say so, name both numbers, and say which one the calculation used." Never
 * auto-corrects: returns `null` only when there's nothing to compare (no per-period data, or a
 * non-positive scalar to divide by).
 */
export function checkBoardingDurationConsistency(
  scalarBoardingDuration: number | null | undefined,
  monthlyMeans?: number[] | null,
  dayOfWeekMeans?: number[] | null
): BoardingDurationConsistency | null {
  if (!scalarBoardingDuration || scalarBoardingDuration <= 0) return null;
  const means = monthlyMeans && monthlyMeans.length === 12 ? monthlyMeans : dayOfWeekMeans && dayOfWeekMeans.length === 7 ? dayOfWeekMeans : null;
  if (!means) return null;

  const impliedValue = means.reduce((a, b) => a + b, 0) / means.length;
  const diffPct = Math.abs(impliedValue - scalarBoardingDuration) / scalarBoardingDuration;
  return {
    scalarValue: scalarBoardingDuration,
    impliedValue,
    diffPct,
    withinTolerance: diffPct <= CONSISTENCY_TOLERANCE,
  };
}

export interface DispersionFlag {
  maxValue: number;
  maxIndex: number;
  minValue: number;
  minIndex: number;
  ratio: number;
  flagged: boolean;
}

/**
 * §10(2) — outlier/dispersion flagging. Implausible swings (the spec's own example: Jan 15.1
 * vs. Mar 4.0, a 4x swing) get flagged as "possible small-sample months" WITHOUT refusing the
 * input — this is diagnostic-only, never a validation error that blocks the upload.
 */
export function checkMonthlyDispersion(monthlyMeans?: number[] | null): DispersionFlag | null {
  if (!monthlyMeans || monthlyMeans.length !== 12) return null;
  let maxValue = -Infinity;
  let maxIndex = -1;
  let minValue = Infinity;
  let minIndex = -1;
  monthlyMeans.forEach((v, i) => {
    if (v > maxValue) {
      maxValue = v;
      maxIndex = i;
    }
    if (v > 0 && v < minValue) {
      minValue = v;
      minIndex = i;
    }
  });
  if (minIndex === -1 || maxIndex === -1) return null;
  const ratio = maxValue / minValue;
  return { maxValue, maxIndex, minValue, minIndex, ratio, flagged: ratio >= DISPERSION_RATIO_THRESHOLD };
}
