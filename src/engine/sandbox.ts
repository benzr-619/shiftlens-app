// PR C (RESULTS_PAGE_V2_SPEC_2026-07-27.md §5.4) — Panel 5's "test it yourself" sandbox model.
// Pure arithmetic, no solve — fits the existing cheap-live-recompute convention
// (`recomputeAfterEdit`, engine/index.ts) so it can update on every keystroke against two
// editable day×shift grids (ED nurses, hold nurses), never a re-solve.
//
// §3.5's hard rule, load-bearing for this whole file: ED-vs-hold nurses is a SANDBOX-ONLY
// distinction — a distinction in the ASK (whose budget, which patients they can cover), not a
// distinction the main engine's demand model has any concept of. Hold nurses cover MEDICAL
// boarders only (never BH, never arrivals) — a real, load-bearing operational fact (hold pools
// are float/med-surg staff, not behavioral-health-credentialed), not a simplification.
import { backlogRecurrence, type BacklogRecurrenceParams } from './backlogModel';

export interface SandboxResult {
  /** Per-hour hold-nurse hours actually absorbed by medical boarding demand (capped at that
   * hour's own medical boarding demand — a hold nurse can't "cover" more medical boarding
   * than exists that hour). */
  holdApplied: number[];
  /** Per-hour hold-nurse hours staffed against medical boarders who aren't there — REAL,
   * always surfaced (§5.4's second hard rule), never silently absorbed into "coverage." The
   * honest cost of the cheaper-looking hold-nurse ask. */
  holdSurplus: number[];
  /** What's left for ED nurses to cover after hold nurses take their (capped) share of
   * medical boarding — arrivals demand + unabsorbed medical boarding + ALL BH boarding
   * (hold nurses never touch BH, per §3.5). ONE combined curve — never decomposed by source,
   * per §5.4's first hard rule ("do not attribute unmet between arrivals and boarding"). */
  residualDemand: number[];
  /** max(0, residualDemand - edNurses) — the one combined shortfall picture. */
  unmet: number[];
  /** max(0, edNurses - residualDemand). */
  spare: number[];
  /** (edNurses - unabsorbed medical boarding - BH boarding) / arrivals. Can go NEGATIVE —
   * reported honestly, never clamped (clamping is a display/color concern only, not something
   * this function does). 0 at an hour with zero arrivals (no ED-patient-per-visit figure is
   * meaningful there). */
  effectiveWhppv: number[];
  /** The queue-depth strip — the SAME `backlogModel.ts` recurrence used everywhere else in the
   * engine, run over `residualDemand` (requirement) vs `edNurses` (capacity). ONE queue,
   * because ED nurses are a single pooled resource (§5.4) — hold nurses never appear in this
   * recurrence at all, since by the time we're here their (capped) contribution has already
   * been netted into `residualDemand`. */
  queueDepth: number[];
}

/**
 * @param arrivalsRequirement168 the arrivals-only hourly requirement (EngineResult.hourlyRequirement)
 * @param medBoarding168 medical boarding demand, nurse-hours (EngineResult.boarding.cellBoardingRnHours,
 *   medical share only — see the caller for how BH/medical are split when a combined census is used)
 * @param bhBoarding168 BH boarding demand, nurse-hours (0 everywhere if not tracked separately)
 * @param arrivals168 raw arrivals counts (for the effective-wHPPV denominator)
 * @param edNurses168 the "ED nurses" sandbox grid's per-hour on-duty headcount
 * @param hold168 the "hold nurses" sandbox grid's per-hour on-duty headcount
 */
export function computeSandbox(
  arrivalsRequirement168: number[],
  medBoarding168: number[],
  bhBoarding168: number[],
  arrivals168: number[],
  edNurses168: number[],
  hold168: number[],
  backlogParams: BacklogRecurrenceParams
): SandboxResult {
  const n = 168;
  const holdApplied = new Array(n).fill(0);
  const holdSurplus = new Array(n).fill(0);
  const residualDemand = new Array(n).fill(0);
  const unmet = new Array(n).fill(0);
  const spare = new Array(n).fill(0);
  const effectiveWhppv = new Array(n).fill(0);

  for (let h = 0; h < n; h++) {
    const hold = hold168[h] ?? 0;
    const med = medBoarding168[h] ?? 0;
    const bh = bhBoarding168[h] ?? 0;
    const ed = edNurses168[h] ?? 0;
    const arrivalsReq = arrivalsRequirement168[h] ?? 0;
    const arrivalsCount = arrivals168[h] ?? 0;

    const applied = Math.min(hold, med);
    const surplus = Math.max(0, hold - med);
    const unabsorbedMed = med - applied;
    const residual = arrivalsReq + unabsorbedMed + bh;

    holdApplied[h] = applied;
    holdSurplus[h] = surplus;
    residualDemand[h] = residual;
    unmet[h] = Math.max(0, residual - ed);
    spare[h] = Math.max(0, ed - residual);
    effectiveWhppv[h] = arrivalsCount > 0 ? (ed - unabsorbedMed - bh) / arrivalsCount : 0;
  }

  const { backlog: queueDepth } = backlogRecurrence(edNurses168, residualDemand, backlogParams);

  return { holdApplied, holdSurplus, residualDemand, unmet, spare, effectiveWhppv, queueDepth };
}
