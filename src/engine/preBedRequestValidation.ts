// §7 (SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md) — pre-bed-request census diagnostic.
// When `preBedRequestCensus` is supplied, compares OBSERVED non-boarding ED occupancy against
// what the tool's own arrivals -> hourlyRequirement translation implies — the first
// correctness check the arrivals half of the engine has ever had. Deliberately small: a
// diagnostic on the evidence surface only, no solver interaction, no change to any
// recommendation. Expect few departments to supply it.
import type { Cell168 } from './types';

export interface PreBedRequestValidation {
  /** hourlyRequirement[i] / wHppvTarget — a rough visit-equivalent occupancy proxy implied by
   * the arrivals-derived demand curve. Not a measured occupancy figure itself; wHppvTarget is
   * nurse-hours per visit, so this divides the nurse-hours the tool assigned to an hour back
   * down into an implied patient-equivalent count for that hour — a rough proxy, not exact,
   * since real occupancy also depends on length-of-stay, not just arrival-hour demand. */
  impliedOccupancy: Cell168;
  meanObserved: number;
  meanImplied: number;
  /** Pearson correlation between observed and implied, -1..1 — do the two curves at least
   * SHAPE-track each other, independent of scale. */
  correlation: number;
}

export function computePreBedRequestValidation(
  preBedRequestCensus: Cell168 | undefined,
  hourlyRequirement: Cell168,
  wHppvTarget: number
): PreBedRequestValidation | null {
  if (!preBedRequestCensus || wHppvTarget <= 0) return null;

  const impliedOccupancy = hourlyRequirement.map((v) => v / wHppvTarget);
  const n = preBedRequestCensus.length;
  const meanObserved = preBedRequestCensus.reduce((a, b) => a + b, 0) / n;
  const meanImplied = impliedOccupancy.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let varObs = 0;
  let varImp = 0;
  for (let i = 0; i < n; i++) {
    const dObs = preBedRequestCensus[i] - meanObserved;
    const dImp = impliedOccupancy[i] - meanImplied;
    cov += dObs * dImp;
    varObs += dObs * dObs;
    varImp += dImp * dImp;
  }
  const denom = Math.sqrt(varObs * varImp);
  const correlation = denom > 0 ? cov / denom : 0;

  return { impliedOccupancy, meanObserved, meanImplied, correlation };
}
