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
  boardingDuration?: Cell168;
  boardingRatioTarget?: number; // default 4 (1:4)

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

export interface BoardingResult {
  cellBoardingRnHours: Cell168;
  annualBoardingHours: number;
  annualFte: number;
  weeklyBoardingHours: number;
  weeklyFte: number;
  perDay: Array<{
    day: number;
    dailyHoldHours: number;
    avgConcurrentHeadcount: number;
    peakConcurrentHeadcount: number;
  }>;
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
}

export const DEFAULTS = {
  hoursBudgetTolerance: 0.1,
  transitionWeight: 2.5,
  transitionWindowHours: 2,
  acuityWeights: { esi12: 1.75, esi3: 1.0, esi45: 0.5 } as AcuityWeights,
  smoothingWeights: { center: 0.6, neighbor: 0.2 } as SmoothingWeights,
  boardingRatioTarget: 4,
  enaFloor: 2,
};

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
