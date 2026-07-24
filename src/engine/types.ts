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

  // policy parameters, all user-adjustable
  hoursBudgetTolerance?: number; // default 0.10
  transitionWeight?: number; // default 2.5
  transitionWindowHours?: number; // default 2
  acuityWeights?: AcuityWeights; // default 1.75/1.00/0.50
  smoothingWeights?: SmoothingWeights; // default 0.6/0.2, must sum center+2*neighbor=1
  enaFloor?: number; // default 2, department-level minimum on-duty headcount
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
  enaFloor: 2,
  // §2.4 backlog/"falling behind" diagnostic (ASSUMPTION, resolved with Ben 2026-07-24, see
  // .claude/rules/results-redesign.md). Per-hour retention of carried backlog: 0.85 ⇒ ~15%/hr
  // passive dissipation (~4.3h half-life). Diagnostic-only — NEVER feeds the solver. Tunable.
  backlogHourlyDecay: 0.85,
};

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
