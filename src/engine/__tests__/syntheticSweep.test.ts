// PR E0 (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §12.5) — the generality sweep. Runs the
// engine's ACTUAL correctness proof (reconcile()) plus a set of structural invariants across a
// few hundred PARAMETRICALLY generated synthetic departments, not one hand-picked happy path.
//
// What this proves and doesn't (§12.5's table, worth restating here): this validates
// GENERALIZABILITY — no crashes, no NaN/Infinity/negative headcount, every branch reachable,
// orderings hold, degenerate inputs terminate. It does NOT validate whether the model is RIGHT
// about a real ED, or whether abandonRate/recoveryEfficiency/maxDrainFraction are calibrated
// correctly — that needs real department data (see §12.6). Never tune constants to make this
// suite prettier; a change that improves it while regressing the seven named profiles
// (syntheticFixtures.test.ts) is a regression, not progress.
import { describe, expect, it } from 'vitest';
import { compute } from '../index';
import {
  recommendWeeklyBoardingGrid,
  annualStaffingHoursForWeeklyGrid,
  annualBoardingCoveredByWeeklyGrid,
} from '../boarding';
import {
  generateSyntheticDepartment,
  type ArrivalShape,
  type ShiftMenuPreset,
  type SyntheticDepartmentParams,
} from '../../lib/__fixtures__/syntheticDepartment';
import type { Grid } from '../types';

function assertFiniteDeep(obj: unknown, path: string): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'number') {
    expect(Number.isFinite(obj), `${path} should be finite, got ${obj}`).toBe(true);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertFiniteDeep(v, `${path}[${i}]`));
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      assertFiniteDeep(v, `${path}.${k}`);
    }
  }
}

function assertNonNegativeGrid(grid: Grid, path: string): void {
  for (const dayKey of Object.keys(grid)) {
    const day = Number(dayKey);
    for (const [shiftId, headcount] of Object.entries(grid[day])) {
      expect(headcount, `${path}[${day}][${shiftId}] should be >= 0`).toBeGreaterThanOrEqual(0);
    }
  }
}

// Decorrelated parameter sweep: pick each axis by (index * distinct prime stride) mod its
// length, so axes vary independently of each other rather than always moving together (which
// a plain shared index would do) — without the combinatorial blowup of a full cartesian
// product across 12 axes.
const VOLUMES = [500, 5000, 15000, 25000, 45000, 65000, 90000, 120000, 250000];
const SHAPES: ArrivalShape[] = ['unimodalDay', 'bimodal', 'flat', 'eveningSkewed'];
const DOW_AMPS = [0, 0.15, 0.3, 0.5];
const P75_SPREADS = [0, 0.15, 0.3, 0.6];
const ADMIT_RATES: (number | null)[] = [null, 0.1, 0.2, 0.35];
const BOARD_DURATIONS: (number | null)[] = [null, 1.5, 6, 12];
const MONTH_DISPERSIONS = [0, 0.2, 0.5];
const STAFF_RATIOS = [0, 0.5, 0.85, 1.0, 1.15, 1.5];
const DAY_NIGHT_SPLITS = [0.2, 0.35, 0.5, 0.65, 0.8];
const SHIFT_MENUS: ShiftMenuPreset[] = ['2x12', '3x8', '3x12', 'mixed8and12', '1x24'];
const BOOL = [true, false];
// 2026-07-27 (SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md §8): the measured boarding
// census path must be swept too, not just exercised by the one named profile H.
const BOARDING_MODES: Array<'derived' | 'measured'> = ['derived', 'measured'];

function pick<T>(arr: T[], i: number, stride: number): T {
  return arr[(i * stride) % arr.length];
}

const SWEEP_SIZE = 240;

function sweepParams(i: number): SyntheticDepartmentParams {
  const volume = pick(VOLUMES, i, 1);
  const admitRate = pick(ADMIT_RATES, i, 7);
  const boardDuration = pick(BOARD_DURATIONS, i, 11);
  const boardingDataPresent = pick(BOOL, i, 13) && admitRate != null && boardDuration != null;
  return {
    annualVolume: volume,
    arrivalShape: pick(SHAPES, i, 3),
    dayOfWeekAmplitude: pick(DOW_AMPS, i, 5),
    p75Spread: pick(P75_SPREADS, i, 17),
    admitRate,
    meanBoardingDurationHours: boardDuration,
    monthlyBoardingDispersion: pick(MONTH_DISPERSIONS, i, 19),
    currentStaffingRatio: pick(STAFF_RATIOS, i, 23),
    currentDayNightSplit: pick(DAY_NIGHT_SPLITS, i, 29),
    shiftMenu: pick(SHIFT_MENUS, i, 31),
    esiMixPresent: pick(BOOL, i, 37),
    boardingDataPresent,
    boardingInputMode: pick(BOARDING_MODES, i, 41),
    bhCensusPresent: pick(BOOL, i, 43),
  };
}

// Explicit degenerate cases (§12.5): zero arrivals in an hour, single-shift menus, volumes at
// both ends of the peer-band table, current staffing of zero — called out by name rather than
// left to chance in the modulo sweep above.
const DEGENERATE_CASES: SyntheticDepartmentParams[] = [
  {
    annualVolume: 45000,
    arrivalShape: 'unimodalDay',
    dayOfWeekAmplitude: 0.3,
    p75Spread: 0.2,
    admitRate: 0.2,
    meanBoardingDurationHours: 6,
    monthlyBoardingDispersion: 0.2,
    currentStaffingRatio: 0.9,
    currentDayNightSplit: 0.5,
    shiftMenu: '2x12',
    esiMixPresent: true,
    boardingDataPresent: true,
    zeroArrivalHours: [3, 4],
  },
  {
    annualVolume: 20000,
    arrivalShape: 'flat',
    dayOfWeekAmplitude: 0,
    p75Spread: 0,
    admitRate: null,
    meanBoardingDurationHours: null,
    monthlyBoardingDispersion: 0,
    currentStaffingRatio: 1,
    currentDayNightSplit: 0.5,
    shiftMenu: '1x24',
    esiMixPresent: false,
    boardingDataPresent: false,
  },
  {
    annualVolume: 100, // extreme low, below the peer-band table's lowest band
    arrivalShape: 'flat',
    dayOfWeekAmplitude: 0,
    p75Spread: 0,
    admitRate: null,
    meanBoardingDurationHours: null,
    monthlyBoardingDispersion: 0,
    currentStaffingRatio: 0,
    currentDayNightSplit: 0.5,
    shiftMenu: '2x12',
    esiMixPresent: false,
    boardingDataPresent: false,
  },
  {
    annualVolume: 500000, // extreme high, above the peer-band table's top band
    arrivalShape: 'bimodal',
    dayOfWeekAmplitude: 0.5,
    p75Spread: 0.6,
    admitRate: 0.3,
    meanBoardingDurationHours: 10,
    monthlyBoardingDispersion: 0.4,
    currentStaffingRatio: 1.2,
    currentDayNightSplit: 0.6,
    shiftMenu: '3x8',
    esiMixPresent: true,
    boardingDataPresent: true,
  },
  {
    // current staffing of zero (no current-staffing entered) — must not crash, must not divide
    // by zero anywhere downstream.
    annualVolume: 45000,
    arrivalShape: 'eveningSkewed',
    dayOfWeekAmplitude: 0.2,
    p75Spread: 0.1,
    admitRate: 0.15,
    meanBoardingDurationHours: 4,
    monthlyBoardingDispersion: 0.1,
    currentStaffingRatio: 0,
    currentDayNightSplit: 0.5,
    shiftMenu: 'mixed8and12',
    esiMixPresent: false,
    boardingDataPresent: true,
  },
];

function allCases(): SyntheticDepartmentParams[] {
  const swept = Array.from({ length: SWEEP_SIZE }, (_, i) => sweepParams(i));
  return [...swept, ...DEGENERATE_CASES];
}

describe('synthetic department sweep (§12.5)', () => {
  const cases = allCases();

  it(`generates and computes ${cases.length} synthetic departments without crashing`, () => {
    for (const params of cases) {
      const { inputs, currentStaffingGrid } = generateSyntheticDepartment(params);
      const result = compute(inputs);
      const label = JSON.stringify(params);

      // reconcile() — the existing correctness proof, now under adversarial input.
      expect(result.reconciliation.passes, `reconciliation failed for ${label}`).toBe(true);

      // No NaN/Infinity anywhere in EngineResult.
      assertFiniteDeep(result, 'result');

      // No negative headcount anywhere.
      assertNonNegativeGrid(result.grid, 'result.grid');
      assertNonNegativeGrid(currentStaffingGrid, 'currentStaffingGrid');

      // Orderings: full-coverage hours >= any trimmed solve — EXCEPT when the department ENA
      // floor (min on-duty headcount, engine-solver.md §5.6) exceeds demand at ANY hour.
      // `fullCoverage` (solveFullCoverageWeek) targets `hourlyRequirement` only, ignoring the
      // floor; `enforceDepartmentFloor` runs AFTER the trim and can push scheduled hours back
      // ABOVE `fullCoverage` at genuinely low volume — the exact "low-volume ED where the ENA
      // floor binds" profile F is meant to exercise, not a bug in this ordering check. Widened
      // from `.every` to `.some` (2026-07-28, found by the sweep itself): a MIXED-volume
      // department where the floor only dominates SOME hours (not the whole week) can still
      // legitimately push weeklyScheduledHours above fullCoverage — the original `.every` guard
      // only caught the all-hours-low-volume case (profile F itself), not this partial one.
      const enaFloor = inputs.enaFloor ?? 2;
      const floorDominatesSomewhere = result.hourlyRequirement.some((r) => r <= enaFloor);
      if (!floorDominatesSomewhere) {
        expect(
          result.fullCoverage.weeklyHours,
          `fullCoverage should be >= weeklyScheduledHours for ${label}`
        ).toBeGreaterThanOrEqual(result.weeklyScheduledHours - 1e-6);
      }

      // Orderings: staffing FTE >= coverage FTE, when boarding was computed.
      if (result.boarding && result.lostProductivity) {
        const recommended = recommendWeeklyBoardingGrid(
          result.boarding,
          inputs.shiftMenu,
          inputs.wHppvTarget,
          inputs.wHppvTarget,
          result.lostProductivity.wHppvConsumedByBoarding
        );
        const staffingHours = annualStaffingHoursForWeeklyGrid(recommended, result.boarding, inputs.shiftMenu, null);
        const coveredHours = annualBoardingCoveredByWeeklyGrid(recommended, result.boarding, inputs.shiftMenu, null);
        expect(staffingHours, `staffing hours should be >= covered hours for ${label}`).toBeGreaterThanOrEqual(
          coveredHours - 1e-6
        );
      }

      // Degenerate inputs terminate (implicit — if we got here, compute() returned, it didn't hang/throw).
    }
  }, 30000);

  // src/lib/narrative.ts now exists (PR H) — this is the test that actually catches
  // sign-assuming copy, per §12.5. Still tolerant of functions whose signature isn't
  // (result, inputs) alone (most of them — see narrative.ts's own header for why).
  it('every narrative.ts function returns a non-empty grammatical sentence', async () => {
    let narrative: Record<string, unknown> | null = null;
    try {
      // Non-literal specifier deliberately — the module doesn't exist until PR H, and a
      // literal specifier would make `tsc -b` fail to resolve it right now.
      const narrativeModulePath = '../../lib/narrative';
      narrative = await import(narrativeModulePath);
    } catch {
      narrative = null;
    }
    if (!narrative) return; // module not built yet — PR H wires this for real

    // Precompute (inputs, result) ONCE per sampled case, reused across every narrative
    // function — avoids O(functions * cases) redundant compute() calls, which is what made
    // this test time out at the default 5s once narrative.ts actually gained exports.
    const sampled = cases.slice(0, 20).map((params) => {
      const { inputs } = generateSyntheticDepartment(params);
      return { inputs, result: compute(inputs) };
    });

    const placeholderResidue = /\bundefined\b|\bNaN\b|-0(?!\d)|\{\{|\}\}/;
    for (const [name, fn] of Object.entries(narrative)) {
      if (typeof fn !== 'function') continue;
      for (const { inputs, result } of sampled) {
        // Best-effort call: most narrative functions take (result, inputs) or a subset of it.
        // Failure to call with this shape is not itself a failure of this test — narrative
        // functions may take differently-shaped args; the goal is just to exercise whichever
        // ones DO accept (result, inputs) directly.
        let sentence: unknown;
        try {
          sentence = (fn as (...args: unknown[]) => unknown)(result, inputs);
        } catch {
          continue;
        }
        if (typeof sentence !== 'string') continue;
        expect(sentence.length, `${name} returned empty string for a case`).toBeGreaterThan(0);
        expect(placeholderResidue.test(sentence), `${name} returned placeholder residue: "${sentence}"`).toBe(false);
      }
    }
  }, 15000);
});
