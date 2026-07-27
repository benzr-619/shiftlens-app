// The seven §12.2 department profiles, as FROZEN synthetic-generator parameter sets — chosen
// from `generateSyntheticDepartment`'s own parameter space, not hand-built EngineInputs. Named
// for the conclusion each should produce, so a regression that breaks one profile (e.g. "the
// page stops being able to say you're fine") is obvious from the failing test/fixture name
// alone, per RESULTS_COMPREHENSION_SPEC_2026-07-26.md §12.5.
//
// These illustrate the ARCHITECTURE, not any one department's STORY (§12.4) — the specific
// numbers here are arbitrary points in the parameter space chosen to exercise each profile,
// not tuned to look good. Don't hand-edit a fixture's output to "fix" a failing assertion;
// fix the generator or re-pick the parameters instead.
import type { SyntheticDepartmentParams } from './syntheticDepartment';

export const NAMED_DEPARTMENT_PARAMS: Record<string, SyntheticDepartmentParams> = {
  // A — the source department's shape: under-target overall, day-short.
  underTargetDayShort: {
    annualVolume: 47000,
    arrivalShape: 'unimodalDay',
    dayOfWeekAmplitude: 0.3,
    p75Spread: 0.2,
    admitRate: 0.25,
    meanBoardingDurationHours: 8,
    monthlyBoardingDispersion: 0.3,
    currentStaffingRatio: 0.85, // under target-implied hours
    currentDayNightSplit: 0.35, // day-short: unimodalDay wants more day coverage than this gives
    shiftMenu: '3x12',
    esiMixPresent: true,
    boardingDataPresent: true,
  },

  // B — at/above target on total hours, badly shaped. "You have enough hours; they're in the
  // wrong places" — a first-class ending, not a degenerate case.
  adequatelyStaffedBadlyShaped: {
    annualVolume: 55000,
    arrivalShape: 'unimodalDay',
    dayOfWeekAmplitude: 0.25,
    p75Spread: 0.2,
    admitRate: 0.2,
    meanBoardingDurationHours: 6,
    monthlyBoardingDispersion: 0.2,
    currentStaffingRatio: 1.08, // at/above target-implied hours
    currentDayNightSplit: 0.5, // mismatched vs. unimodalDay's day-heavy demand
    shiftMenu: '2x12',
    esiMixPresent: true,
    boardingDataPresent: true,
  },

  // C — night-short rather than day-short. Same machinery, opposite direction.
  nightShort: {
    annualVolume: 50000,
    arrivalShape: 'eveningSkewed',
    dayOfWeekAmplitude: 0.2,
    p75Spread: 0.2,
    admitRate: 0.2,
    meanBoardingDurationHours: 5,
    monthlyBoardingDispersion: 0.2,
    currentStaffingRatio: 0.9,
    currentDayNightSplit: 0.75, // most current hours on day, while demand skews to evening/night
    shiftMenu: '2x12',
    esiMixPresent: true,
    boardingDataPresent: true,
  },

  // D — no boarding data at all (no admit rate / duration). The two-budget thesis must degrade
  // to a prompt, never silently vanish.
  noBoardingData: {
    annualVolume: 40000,
    arrivalShape: 'unimodalDay',
    dayOfWeekAmplitude: 0.2,
    p75Spread: 0.15,
    admitRate: null,
    meanBoardingDurationHours: null,
    monthlyBoardingDispersion: 0,
    currentStaffingRatio: 0.95,
    currentDayNightSplit: 0.55,
    shiftMenu: '3x8',
    esiMixPresent: false,
    boardingDataPresent: false,
  },

  // E — boarding present but short-duration/small. Hidden-boarding diagnostic ~= 0; must read
  // as a finding ("staffed for arrivals, appropriately"), not an empty section.
  shortDurationBoarding: {
    annualVolume: 40000,
    arrivalShape: 'unimodalDay',
    dayOfWeekAmplitude: 0.2,
    p75Spread: 0.15,
    admitRate: 0.05,
    meanBoardingDurationHours: 1,
    monthlyBoardingDispersion: 0.05,
    currentStaffingRatio: 0.95,
    currentDayNightSplit: 0.55,
    shiftMenu: '3x8',
    esiMixPresent: false,
    boardingDataPresent: true,
  },

  // F — low-volume ED where the ENA floor binds and per-hour rounding dominates. Delivery
  // premium is large and mostly unavoidable; say so rather than implying waste.
  lowVolumeFloorBinds: {
    annualVolume: 6000,
    arrivalShape: 'flat',
    dayOfWeekAmplitude: 0.1,
    p75Spread: 0.1,
    admitRate: 0.2,
    meanBoardingDurationHours: 4,
    monthlyBoardingDispersion: 0.1,
    currentStaffingRatio: 1.0,
    currentDayNightSplit: 0.5,
    shiftMenu: '2x12',
    esiMixPresent: false,
    boardingDataPresent: true,
  },

  // G — already well-allocated and adequately staffed. The page must say "you're fine"
  // convincingly — the profile most likely to be silently broken by a tool that always finds
  // a problem.
  alreadyFine: {
    annualVolume: 50000,
    arrivalShape: 'unimodalDay',
    dayOfWeekAmplitude: 0.2,
    p75Spread: 0.15,
    admitRate: 0.15,
    meanBoardingDurationHours: 4,
    monthlyBoardingDispersion: 0.1,
    currentStaffingRatio: 1.1,
    currentDayNightSplit: 0.68, // unused when currentShapeFollowsIdeal is true, kept for clarity
    currentShapeFollowsIdeal: true, // current staffing tracks the idealized shape — well-allocated by construction
    shiftMenu: '3x12',
    esiMixPresent: true,
    boardingDataPresent: true,
  },

  // H — 2026-07-27 (SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md §8): the MEASURED boarding
  // census path, both medical and BH streams present with opposing monthly seasonality — so
  // the sweep/fixtures exercise `censusSource === 'measured'`, `medicalWeeklyRnHours`/
  // `bhWeeklyRnHours` both non-null, and the RN-hour-weighted `monthFactors` combination, not
  // just the derived admitRate/boardingDuration path every other profile above uses.
  measuredBoardingCensus: {
    annualVolume: 48000,
    arrivalShape: 'unimodalDay',
    dayOfWeekAmplitude: 0.25,
    p75Spread: 0.2,
    admitRate: 0.2,
    meanBoardingDurationHours: 6,
    monthlyBoardingDispersion: 0.3,
    currentStaffingRatio: 0.95,
    currentDayNightSplit: 0.5,
    shiftMenu: '2x12',
    esiMixPresent: true,
    boardingDataPresent: true,
    boardingInputMode: 'measured',
    bhCensusPresent: true,
  },
};
