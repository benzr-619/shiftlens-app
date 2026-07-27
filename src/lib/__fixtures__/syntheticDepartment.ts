// Synthetic department fixture generator (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §12.5).
//
// PURE, PARAMETRIC generation of a complete valid EngineInputs + current-staffing Grid — no
// hand-tuned example data. This is what §12's generality contract is verified against: no
// crashes, no sign-assuming copy, every branch reachable, invariants hold — across departments
// that look nothing like the one real department the rest of this spec is illustrated with.
//
// "Pure" here means deterministic/no I/O, not "never calls compute()" — deriving the current-
// staffing grid's absolute hours needs the target-implied weekly budget, which only compute()
// knows how to derive (wHPPV target + smoothing + band pipeline). Same inputs -> same output,
// always; no Date.now()/Math.random() anywhere in this file.
import { compute } from '../../engine';
import { lookupWhppvBand } from '../edbaLookup';
import type { EngineInputs, EsiMix, Grid, ShiftDef } from '../../engine/types';

export type ArrivalShape = 'unimodalDay' | 'bimodal' | 'flat' | 'eveningSkewed';
export type ShiftMenuPreset = '2x12' | '3x8' | '3x12' | 'mixed8and12' | '1x24';

export const SHIFT_MENU_PRESETS: Record<ShiftMenuPreset, ShiftDef[]> = {
  '2x12': [
    { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 },
    { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 },
  ],
  '3x8': [
    { id: 'day', label: 'Day', startHour: 7, lengthHours: 8 },
    { id: 'evening', label: 'Evening', startHour: 15, lengthHours: 8 },
    { id: 'night', label: 'Night', startHour: 23, lengthHours: 8 },
  ],
  // Deliberately overlapping (36h of shift-length across a 24h day) — a common real-world
  // swing pattern, not a clean tiling. The solver/full-coverage search handles overlap fine;
  // synthetic fixtures don't need to restrict themselves to menus that tile evenly.
  '3x12': [
    { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 },
    { id: 'swing', label: 'Swing', startHour: 11, lengthHours: 12 },
    { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 },
  ],
  mixed8and12: [
    { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 },
    { id: 'evening8', label: 'Evening (8h)', startHour: 11, lengthHours: 8 },
    { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 },
  ],
  // Degenerate single-shift menu (§12.5 sweep requirement: "single-shift menus" must terminate).
  '1x24': [{ id: 'allDay', label: 'All hours', startHour: 0, lengthHours: 24 }],
};

export interface SyntheticDepartmentParams {
  annualVolume: number;
  arrivalShape: ArrivalShape;
  dayOfWeekAmplitude: number; // 0 (flat) .. ~0.6 (strong weekday/weekend swing)
  p75Spread: number; // (p75-mean)/mean ratio, e.g. 0.3; 0 = no volatility signal
  admitRate: number | null; // null -> no boarding inputs at all (profile D)
  meanBoardingDurationHours: number | null;
  monthlyBoardingDispersion: number; // 0..1, swing around the mean by month
  currentStaffingRatio: number; // ratio of current staffed hours to target-implied weekly hours; 0 = no current staffing entered
  currentDayNightSplit: number; // 0..1, fraction of current hours placed on day-classified shifts
  // When true, current staffing is built by scaling the IDEALIZED solved grid itself
  // (rather than a uniform day/night split) — i.e. "current staffing already follows the
  // department's own ideal shape, just at a different total." This is what makes profile G
  // ("already well-allocated") constructible: a uniform per-shift headcount can never track
  // an hour-varying requirement curve closely enough to read as well-shaped. `currentDayNightSplit`
  // is ignored when this is true. Defaults to false (the uniform day/night-split model).
  currentShapeFollowsIdeal?: boolean;
  shiftMenu: ShiftMenuPreset | ShiftDef[];
  esiMixPresent: boolean;
  boardingDataPresent: boolean; // independent gate from admitRate/meanBoardingDurationHours being non-null
  wHppvTarget?: number; // defaults to the cohort median for the given volume
  zeroArrivalHours?: number[]; // 0-23; forces these hour-of-day cells to zero arrivals every day
  // 2026-07-27 (SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md §8) — which boarding INPUT
  // shape to generate, independent of whether boarding data is present at all
  // (`boardingDataPresent` above). 'derived' (default) generates admitRate/
  // meanBoardingDurationHours, unchanged from before. 'measured' generates
  // boardingCensusMedical (and, if `bhCensusPresent`, boardingCensusBH) directly instead —
  // admitRate/meanBoardingDurationHours are still used as the census's approximate magnitude
  // parameters (reusing the existing knobs rather than adding a parallel set), just routed to
  // `computeBoarding`'s measured path instead of its derived path.
  boardingInputMode?: 'derived' | 'measured';
  bhCensusPresent?: boolean; // only meaningful when boardingInputMode === 'measured'
}

export interface SyntheticDepartment {
  inputs: EngineInputs;
  currentStaffingGrid: Grid;
}

const HOUR_OF_DAY = Array.from({ length: 24 }, (_, h) => h);

function hourShapeMultiplier(hour: number, shape: ArrivalShape): number {
  switch (shape) {
    case 'flat':
      return 1;
    case 'unimodalDay':
      // Peak ~13:00, trough ~04:00 — classic front-loaded-daytime ED curve.
      return 1 + 0.9 * Math.cos(((hour - 13) / 24) * 2 * Math.PI);
    case 'bimodal':
      // Two peaks, ~11:00 and ~19:00.
      return 1 + 0.5 * Math.cos(((hour - 11) / 24) * 2 * Math.PI) + 0.5 * Math.cos(((hour - 19) / 24) * 2 * Math.PI);
    case 'eveningSkewed':
      // Peak ~20:00, trough ~08:00 — demand skewed into evening/night.
      return 1 + 0.9 * Math.cos(((hour - 20) / 24) * 2 * Math.PI);
    default:
      return 1;
  }
}

// day 0 = Sunday .. 6 = Saturday (engine convention). Weekend (Sun/Sat) up, Tue/Wed down,
// Mon/Thu/Fri neutral — a mild, generic weekly pattern, not tuned to any real ED.
function dayMultiplier(day: number, amplitude: number): number {
  const factor: Record<number, number> = { 0: 1, 1: 0, 2: -1, 3: -1, 4: 0, 5: 0.2, 6: 1 };
  return 1 + amplitude * (factor[day] ?? 0) * 0.4;
}

function resolveShiftMenu(menu: ShiftMenuPreset | ShiftDef[]): ShiftDef[] {
  return Array.isArray(menu) ? menu : SHIFT_MENU_PRESETS[menu];
}

function shiftDayFraction(shift: ShiftDef): number {
  let dayHours = 0;
  for (let i = 0; i < shift.lengthHours; i++) {
    const h = (shift.startHour + i) % 24;
    if (h >= 7 && h < 19) dayHours++;
  }
  return dayHours / shift.lengthHours;
}

/** Pure parametric generator — see file header. */
export function generateSyntheticDepartment(params: SyntheticDepartmentParams): SyntheticDepartment {
  const {
    annualVolume,
    arrivalShape,
    dayOfWeekAmplitude,
    p75Spread,
    admitRate,
    meanBoardingDurationHours,
    monthlyBoardingDispersion,
    currentStaffingRatio,
    currentDayNightSplit,
    currentShapeFollowsIdeal,
    shiftMenu: shiftMenuParam,
    esiMixPresent,
    boardingDataPresent,
    wHppvTarget,
    zeroArrivalHours,
    boardingInputMode = 'derived',
    bhCensusPresent = false,
  } = params;

  const shiftMenu = resolveShiftMenu(shiftMenuParam);
  const zeroHours = new Set(zeroArrivalHours ?? []);

  // Build unnormalized 168-cell arrivals, then rescale so sum(arrivals)*52 == annualVolume
  // (subject to any forced-zero hours, which are honored, not backfilled).
  const raw: number[] = [];
  for (let day = 0; day < 7; day++) {
    for (const hour of HOUR_OF_DAY) {
      if (zeroHours.has(hour)) {
        raw.push(0);
        continue;
      }
      raw.push(Math.max(0, hourShapeMultiplier(hour, arrivalShape) * dayMultiplier(day, dayOfWeekAmplitude)));
    }
  }
  const rawSum = raw.reduce((a, b) => a + b, 0);
  const weeklyVolume = annualVolume / 52;
  const scale = rawSum > 0 ? weeklyVolume / rawSum : 0;
  const arrivals = raw.map((v) => v * scale);
  const arrivalsP75 = p75Spread > 0 ? arrivals.map((v) => v * (1 + p75Spread)) : undefined;

  const esiMix: EsiMix | undefined = esiMixPresent
    ? {
        esi12: arrivals.map((v) => v * 0.15),
        esi3: arrivals.map((v) => v * 0.55),
        esi45: arrivals.map((v) => v * 0.3),
      }
    : undefined;

  const boardingActive = boardingDataPresent && admitRate != null && meanBoardingDurationHours != null;
  const useMeasuredCensus = boardingActive && boardingInputMode === 'measured';

  const monthlyMeanBoardingDurationHours = boardingActive && !useMeasuredCensus
    ? Array.from({ length: 12 }, (_, m) => {
        const swing = Math.sin((m / 12) * 2 * Math.PI) * monthlyBoardingDispersion;
        return Math.max(0.1, (meanBoardingDurationHours as number) * (1 + swing));
      })
    : undefined;

  // Measured-path census: a simple arrivals * admitRate * duration proxy for the concurrent
  // census magnitude (not the derived path's convolution — this generator doesn't need to
  // reproduce that redistribution, only produce a plausible, non-degenerate measured input).
  const boardingCensusMedical = useMeasuredCensus
    ? arrivals.map((a) => a * (admitRate as number) * (meanBoardingDurationHours as number))
    : undefined;
  const boardingCensusBH = useMeasuredCensus && bhCensusPresent
    ? boardingCensusMedical!.map((v) => v * 0.15) // BH a smaller fraction of medical census
    : undefined;
  const monthlyBoardingCensusMedical = useMeasuredCensus
    ? Array.from({ length: 12 }, (_, m) => {
        const swing = Math.sin((m / 12) * 2 * Math.PI) * monthlyBoardingDispersion;
        return Math.max(0.1, 1 + swing);
      })
    : undefined;
  // Opposing seasonality shape from medical (cos vs. sin) — mirrors the real-department
  // finding the spec cites (medical/BH boarding seasonality genuinely uncorrelated).
  const monthlyBoardingCensusBH = useMeasuredCensus && bhCensusPresent
    ? Array.from({ length: 12 }, (_, m) => {
        const swing = Math.cos((m / 12) * 2 * Math.PI) * monthlyBoardingDispersion;
        return Math.max(0.1, 1 + swing);
      })
    : undefined;

  const target = wHppvTarget ?? lookupWhppvBand(annualVolume).medianWhppv;

  const inputs: EngineInputs = {
    arrivals,
    arrivalsP75,
    wHppvTarget: target,
    shiftMenu,
    esiMix,
    admitRate: boardingActive && !useMeasuredCensus ? (admitRate as number) : undefined,
    boardingDuration: boardingActive && !useMeasuredCensus ? (meanBoardingDurationHours as number) : undefined,
    monthlyMeanBoardingDurationHours,
    boardingCensusMedical,
    boardingCensusBH,
    monthlyBoardingCensusMedical,
    monthlyBoardingCensusBH,
  };

  // Derive the target-implied weekly budget by running compute() once — the only way to know
  // it without re-deriving the allocation pipeline here. Still a pure function of `inputs`.
  const result = compute(inputs);
  const targetWeeklyHours = result.weeklyBudgetHours;
  const desiredTotalHours = Math.max(0, targetWeeklyHours * currentStaffingRatio);

  const dayShifts = shiftMenu.filter((s) => shiftDayFraction(s) >= 0.5);
  const nightShifts = shiftMenu.filter((s) => shiftDayFraction(s) < 0.5);
  const desiredDayHours = desiredTotalHours * currentDayNightSplit;
  const desiredNightHours = desiredTotalHours * (1 - currentDayNightSplit);

  const currentStaffingGrid: Grid = {};
  for (let day = 0; day < 7; day++) currentStaffingGrid[day] = {};

  if (currentShapeFollowsIdeal) {
    for (let day = 0; day < 7; day++) {
      for (const shift of shiftMenu) {
        const idealHeadcount = result.grid[day]?.[shift.id] ?? 0;
        currentStaffingGrid[day][shift.id] = Math.max(0, Math.round(idealHeadcount * currentStaffingRatio));
      }
    }
  } else {
    function fillGrid(shifts: ShiftDef[], desiredHours: number) {
      if (shifts.length === 0 || desiredHours <= 0) return;
      const perShiftHours = desiredHours / shifts.length;
      for (const shift of shifts) {
        const headcountPerDay = Math.max(0, Math.round(perShiftHours / (7 * shift.lengthHours)));
        for (let day = 0; day < 7; day++) {
          currentStaffingGrid[day][shift.id] = headcountPerDay;
        }
      }
    }
    fillGrid(dayShifts, desiredDayHours);
    fillGrid(nightShifts, desiredNightHours);
  }

  return { inputs, currentStaffingGrid };
}
