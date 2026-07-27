// Cell168: 168-cell hour-of-day x day-of-week array. index = day*24 + hour.
// day 0 = Sunday ... day 6 = Saturday (spec 2.3: "Sunday's previous day is Saturday").
export type Cell168 = number[];

export interface ShiftDef {
  id: string;
  label?: string;
  startHour: number; // 0-23
  lengthHours: number; // 1-24
}

export interface EsiMix {
  esi12: Cell168;
  esi3: Cell168;
  esi45: Cell168;
}

export interface AcuityWeights {
  esi12: number;
  esi3: number;
  esi45: number;
}

export interface SmoothingWeights {
  center: number;
  neighbor: number; // applied to both day-1 and day+1
}

export interface EngineInputs {
  arrivals: Cell168; // required, median counts
  annualVisits?: number; // derived as sum(arrivals)*52 if absent
  wHppvTarget: number; // required
  shiftMenu: ShiftDef[]; // required, 1+ shifts

  // optional, graceful degradation
  esiMix?: EsiMix;
  // 2026-07-26 (Phase 2a, "mean-arrival trap" fix, see BACKLOG_FEEDBACK_AND_VARIANCE_SPEC_
  // 2026-07-25.md): the p75 (busy-hour) arrivals count per cell, alongside the required mean
  // `arrivals`. All-or-nothing optional, same convention as ESI mix. Deliberately does NOT
  // touch `annualVisits`/`annualCoreRnHoursBudget`/`hourlyRequirement` (those stay mean-only,
  // preserving wHPPV's own definition and the reconciliation invariant) — it only feeds
  // `demandVolatilityHourly`, which raises `protectedFloorHourly` (PR C: solver-facing,
  // unclamped — see below) and the Step 3 trim's marginal severity cost at high-variance
  // hours. See engine/demandBand.ts and .claude/rules/engine-solver.md's "Budget-capped
  // trim" section.
  arrivalsP75?: Cell168;
  admitRate?: number | Cell168;
  boardingDuration?: number | Cell168;
  boardingRatioTarget?: number; // default 4 (1:4)
  // MEAN boarding duration per patient (hours) for that period — NOT a total and NOT a
  // median (Boarding Seasonality tab of the consolidated template). The engine derives a
  // seasonality index by comparing each period's mean against the overall `boardingDuration`
  // baseline (mean_for_period / overall_mean) — a ratio of means, since duration multiplies
  // directly into total hours. Both optional, independently, all-or-nothing per the existing
  // rule. See .claude/rules/boarding-seasonality.md.
  monthlyMeanBoardingDurationHours?: number[]; // length 12 (Jan-Dec)
  dayOfWeekMeanBoardingDurationHours?: number[]; // length 7 (Sun-Sat)

  // 2026-07-27 (SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md) — the MEASURED boarding
  // path, a new PRIMARY input alongside (not replacing) the derived admitRate/boardingDuration
  // path above. When `boardingCensusMedical` is present, `computeBoarding` uses it exclusively
  // and ignores `admitRate`/`boardingDuration` entirely — no blending. See
  // .claude/rules/boarding-seasonality.md's measured-path section.
  // REQUIRED clock convention, not a setting: this census must be counted from bed request/
  // admit decision — patients physically in the ED with a bed request placed and no inpatient
  // bed assigned, counted at each hour. There is deliberately NO arrival-clocked variant and
  // no clock-start field — an arrival-clocked count overstates boarding by including
  // pre-bed-request workup the arrivals grid already staffs (~36% overstatement measured at a
  // real department), and the gap isn't a flat correction factor (it runs 0.66 at 16:00 to
  // 0.88 at 06:00), so a caveat beside a wrong number was rejected as an acceptable fix. A
  // department that can't produce exactly this uses the admitRate/boardingDuration fallback
  // instead. See .claude/rules/boarding-seasonality.md's measured-path section.
  boardingCensusMedical?: Cell168; // mean concurrent medical/surg boarding census, per hour-of-week
  boardingCensusBH?: Cell168; // mean concurrent behavioral-health boarding census, per hour-of-week
  monthlyBoardingCensusMedical?: number[]; // length 12 (Jan-Dec), mean concurrent census that month
  monthlyBoardingCensusBH?: number[]; // length 12 (Jan-Dec)
  bhBoardingRatioTarget?: number; // default 10 (1:10) — far less RN time per BH boarder than medical
  // Validation-only (§7) — observed non-boarding ED occupancy, compared against what the
  // arrivals -> hourlyRequirement translation implies. No solver interaction, no effect on
  // any recommendation — purely a diagnostic on the evidence surface.
  preBedRequestCensus?: Cell168;

  // policy parameters, all user-adjustable
  hoursBudgetTolerance?: number; // default 0.10
  transitionWeight?: number; // default 2.5
  transitionWindowHours?: number; // default 2
  acuityWeights?: AcuityWeights; // default 1.75/1.00/0.50
  smoothingWeights?: SmoothingWeights; // default 0.6/0.2, must sum center+2*neighbor=1
  enaFloor?: number; // default 2, department-level minimum on-duty headcount

  // 2026-07-26 PR E (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §4d) — the department's OWN
  // Left-Without-Being-Seen rate (0-1), an OPTIONAL setup field deriving `backlogAbandonRate`
  // directly, rather than leaving it at the DEFAULTS cohort-assumption value. Absent -> the
  // existing default (0.03) is used, labeled in the UI as a cohort assumption, not this
  // department's own number (never invent a fallback; respect the no-seeded-ED-data
  // constraint). This is the one parameter of the backlog recurrence's three that's plausibly
  // measurable from a real ED's own data — see engine/backlog.ts's FRAMING note.
  lwbsRate?: number;
}

export interface ShortfallEntry {
  day: number;
  hour: number;
  requirement: number;
  scheduled: number;
  deficit: number;
}

// grid[day][shiftId] = headcount
export type Grid = Record<number, Record<string, number>>;

// One (month?, day-of-week, shift) slot in the priority-ranked boarding coverage list —
// the primary boarding output now, not a single flat FTE number. Ranked descending by
// requiredCareHours; cumulativePct is the running % of total annual boarding hours covered
// if funded down to and including this rank. See .claude/rules/boarding-seasonality.md.
export interface BoardingPrioritySlot {
  month: number | null; // 0-11, or null if monthlyMeanBoardingDurationHours wasn't provided (no month split)
  day: number; // 0-6
  shiftId: string;
  shiftLabel: string;
  requiredCareHours: number; // annual hours attributable to this slot
  cumulativePct: number; // running % of total annual boarding hours, ranks 1..this one
}

export interface BoardingResult {
  cellBoardingRnHours: Cell168; // base curve, pre month/day-of-week seasonality (convolution-derived)
  annualBoardingHours: number; // seasonally-adjusted if totals provided, else flat curve x 52
  annualFte: number;
  weeklyBoardingHours: number;
  weeklyFte: number;
  hasMonthlySeasonality: boolean; // true iff monthlyMeanBoardingDurationHours was usable (drives slot.month presence)
  hasDayOfWeekSeasonality: boolean; // true iff dayOfWeekMeanBoardingDurationHours was usable
  monthFactors: number[] | null; // 12 monthly seasonality factors, or null if no monthly seasonality.
  // Needed by the §2.6 single-representative-week coverage model to scale the stats by how many
  // months a weekly plan is applied to (scope), and to recover the weekly demand shape from the
  // priority ranking. See .claude/rules/boarding-seasonality.md.
  prioritySlots: BoardingPrioritySlot[]; // ranked descending by requiredCareHours — the underlying
  // (month?, day, shift) demand ranking. The §2.6 coverage grid recovers a representative-week
  // per-(day, shift) demand from this (summed across months ÷ full-year scope-weeks); see
  // weeklyBoardingDemandByCell in engine/boarding.ts.

  // 2026-07-27 (SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md §3.2) — per-stream breakdown so
  // the results page can report BH separately (it carries a materially different, understated,
  // RN-only picture — see .claude/rules/boarding-seasonality.md's measured-path section). `null`
  // when that stream contributed nothing (BH absent — never silently zero-weighted as "present
  // but zero"). `censusSource` drives which known-approximations/provenance apply on the
  // evidence surface (Q) and whether the derived-path integrity banners fire at all.
  medicalWeeklyRnHours: number | null;
  bhWeeklyRnHours: number | null;
  censusSource: 'measured' | 'derived';
}

// Productivity Target Buffer method: wHPPV consumed by boarding vs. left over for ED care.
export interface LostProductivity {
  wHppvConsumedByBoarding: number;
  wHppvAvailableForEdCare: number;
}

export interface ReconciliationResult {
  annualFromGrid: number;
  annualBudget: number;
  gapPct: number;
  passes: boolean;
}

export interface EngineResult {
  annualVisits: number;
  annualCoreRnHoursBudget: number;
  cellCoreHours: Cell168;
  cellCoreHoursSmoothed: Cell168;
  hourlyRequirement: Cell168; // ceiling(smoothed)
  esiConfidenceFlag: boolean; // true = no ESI data, raw-volume-only allocation

  // 2026-07-25 solver-objective reversal (Step 3 trim now protects a typical-staffing BAND
  // instead of minimizing shortfall against the point target — see .claude/rules/
  // engine-solver.md's "Budget-capped trim" section). Derived via the SAME allocation
  // pipeline as hourlyRequirement (allocateCellCoreHours + smoothDayOfWeek), just run against
  // the cohort p25/p75 annual budgets (lookupWhppvBand) instead of the point wHppvTarget
  // budget. bandFloorHourly is clamped to never exceed hourlyRequirement (a "floor" can't ask
  // for more than the point target itself); bandCeilingHourly is symmetrically clamped to
  // never fall below it. bandFloorHourly is what Step 3's trim now optimizes against and what
  // the "Hours outside your typical staffing range" stat counts against; bandCeilingHourly is
  // derived for parity but has no consumer yet.
  //
  // 2026-07-26 (Phase 2a): bandFloorHourly above is now the COHORT floor composed with a
  // volatility buffer (see engine/demandBand.ts) — raised further at hours with high p75-vs-
  // mean arrivals spread, when `arrivalsP75` is provided. `demandVolatilityHourly` below is
  // that per-cell volatility signal itself (all-zero when arrivalsP75 is absent — graceful
  // degradation, identical to Phase 1's cohort-only floor).
  //
  // 2026-07-26 PR C (SOLVER_REALISM_SPEC_2026-07-26.md, change 4): `bandFloorHourly` above
  // STAYS clamped to hourlyRequirement, but is now REPORTING-ONLY (the "Hours outside your
  // typical staffing range" stat) — nothing solver-facing reads it anymore.
  // `protectedFloorHourly` below is the UNCLAMPED curve the trim's guardrail penalty and
  // backlogFeedback's relaxation floor actually use — volatility may raise it ABOVE
  // hourlyRequirement, which `bandFloorHourly`'s clamp can never express. `bandFloorHourly` is
  // derived FROM `protectedFloorHourly` by clamping (`compute()`, `engine/index.ts`), not
  // computed independently — the two can only diverge at genuinely high-volatility hours. See
  // `engine/demandBand.ts`'s header and .claude/rules/engine-solver.md's "Budget-capped trim"
  // section for the full rationale.
  bandFloorHourly: Cell168;
  bandCeilingHourly: Cell168;
  protectedFloorHourly: Cell168;
  demandVolatilityHourly: Cell168;

  // 2026-07-26 PR C (change 5): the solver's actual objective, exposed — otherwise the grid
  // is unexplainable by construction. `totalBacklogHours`/`peakSeverity` are computed from the
  // FINAL solved grid's own backlog curve (`engine/backlog.ts`'s `summarizeBacklogSeverity`),
  // using the SAME convex severity function (`engine/solver.ts`'s `severity`/`totalSeverity`/
  // `peakSeverityOf`) `candidateCutCost` minimizes during the trim.
  totalBacklogHours: number;
  totalSeverity: number;
  peakSeverity: number;

  // 2026-07-26 PR E (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §4e): nurse-hours of queued
  // care the backlog recurrence's own passive-attrition term estimates left the system via
  // abandonment (LWBS), for the FINAL solved grid, per scenario (weekly, not annualized). An
  // ESTIMATE of WORK abandoned, NOT a patient count — NEVER convert to a dollar figure (spec
  // §12/§13 — the finance-partner worksheet, PR G, is the sanctioned alternative).
  estimatedAbandonedHours: number;

  // 2026-07-26 (Phase 2b, engine/backlogFeedback.ts's iterative relaxation loop — see
  // .claude/rules/engine-solver.md's "Budget-capped trim" section, fourth reversal-in-spirit
  // of this area): how many relaxation passes actually ran (<= the internal cap) and whether
  // the total-backlog-hours metric was still improving when that cap was hit — a
  // chronically-backlogged scenario that never converges within the pass budget is itself a
  // signal worth surfacing, not silently swallowed into whatever the last pass produced.
  backlogFeedbackPassCount: number;
  backlogFeedbackStillImprovingAtCap: boolean;

  // 2026-07-26 PR D (SOLVER_REALISM_SPEC_2026-07-26.md, changes 1-2) — the funding-ask surface.
  // `solveFullCoverageDay`/Week's never-short-at-any-hour grid used to be computed and thrown
  // away (an intermediate upper bound feeding the trim, never surfaced). `fullCoverage` exposes
  // it directly: what covering every hour, no shortfall anywhere, would actually cost.
  // `fteDelta = (fullCoverage.weeklyHours - capHours) * 52 / 2080` — can be <= 0 when a
  // generous wHPPV target already funds full coverage (a real, not-hypothetical edge case in a
  // low-volume ED); UI must handle that explicitly rather than rendering a negative ask.
  fullCoverage: { weeklyHours: number; impliedWhppv: number; fteDelta: number };
  // `trimWeekToBudgetWithTrajectory`'s recorded trim trajectory (ONE-SHOT solve — see
  // engine/index.ts and .claude/rules/engine-solver.md's PR D section for why this is
  // deliberately NOT threaded through the Phase 2b relaxation loop), read BACKWARDS for
  // marginal value in decreasing order — a genuine diminishing-returns curve, guaranteed by
  // the trim's own cheapest-first greedy order. Empty when full coverage is already <= budget
  // (nothing was cut). `marginalKneePoint` is the `cumulativeHoursAdded` value (hours) at the
  // point of maximum curvature (perpendicular distance from the chord connecting the curve's
  // two endpoints) — a display heuristic, not load-bearing; null when the curve is too flat or
  // too short (< 3 points) to have a meaningful bend.
  marginalCurve: Array<{
    cumulativeHoursAdded: number;
    totalSeverity: number;
    longestLeanStretchHours: number;
    longestLeanStretchStart: { day: number; hour: number } | null;
  }>;
  marginalKneePoint: number | null;

  grid: Grid;
  weeklyScheduledHours: number;
  weeklyBudgetHours: number;
  overcoveragePct: number;
  shortfall: ShortfallEntry[];
  enaFloorViolationsRemaining: Array<{ day: number; hour: number; onDuty: number }>;

  reconciliation: ReconciliationResult;
  boarding: BoardingResult | null;
  lostProductivity: LostProductivity | null; // null iff boarding is null
}

export const DEFAULTS = {
  hoursBudgetTolerance: 0.1,
  transitionWeight: 2.5,
  transitionWindowHours: 2,
  acuityWeights: { esi12: 1.75, esi3: 1.0, esi45: 0.5 } as AcuityWeights,
  smoothingWeights: { center: 0.6, neighbor: 0.2 } as SmoothingWeights,
  boardingRatioTarget: 4,
  // 2026-07-27 (SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md) — BH boarders draw far less
  // licensed RN time per patient than medical/surg boarders (classic range 10-12, per Ben —
  // CONVENTION, not peer-benchmarked, unlike boardingRatioTarget's own evidence tag).
  bhBoardingRatioTarget: 10,
  enaFloor: 2,
  // §2.4 backlog/"falling behind" diagnostic (ASSUMPTION). 2026-07-26 PR B
  // (SOLVER_REALISM_SPEC_2026-07-26.md) REVERSED the single-decay model (`backlogHourlyDecay`,
  // retired — see .claude/rules/engine-solver.md's "Budget-capped trim" section) with three
  // named processes instead of one blended constant. See `engine/backlogModel.ts`'s header for
  // the full recurrence and rationale.
  //   backlogAbandonRate: work that LEAVES the system per hour — this is LWBS. Unlike the
  //     other two, this is measurable in a real ED's own data (the old 0.85 decay implied
  //     15%/hr simply vanishing — far too forgiving as an LWBS proxy).
  backlogAbandonRate: 0.03,
  //   backlogRecoveryEfficiency: a spare nurse-hour retires LESS than an hour of queued work —
  //     catch-up loses batching, adds re-triage and reassessment.
  backlogRecoveryEfficiency: 0.6,
  //   backlogMaxDrainFraction: hard ceiling on queue drainage per hour regardless of spare
  //     staff — beds, providers and imaging gate it. THIS is the term that fixes the
  //     peak-cutting bias the old unconstrained-symmetric-recovery model had.
  backlogMaxDrainFraction: 0.3,
};

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
