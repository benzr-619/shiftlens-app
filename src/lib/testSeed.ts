// PR A0 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §8.1) — the e2e seeding hook.
//
// Dev-only: installed from `main.tsx` behind `import.meta.env.DEV`, which Vite replaces with
// a literal `false` in production builds — the `if` branch (and this whole module, since the
// import itself is dynamic) is dead-code-eliminated from the shipped bundle. This must never
// become a route into seeded ED data in production; it is a test harness, not a feature.
//
// Loads one of the existing NAMED_DEPARTMENT_PARAMS synthetic profiles straight into the
// zustand store and jumps to the results page — see .claude/rules/synthetic-fixtures.md for
// why fixtures are generated parametrically here rather than hand-built a second time in a
// `.spec.ts` file.
import { useStore } from '../store';
import { generateSyntheticDepartment, type SyntheticDepartmentParams } from './__fixtures__/syntheticDepartment';

declare global {
  interface Window {
    __shiftlensSeed?: (params: SyntheticDepartmentParams) => void;
  }
}

export function installTestSeedHook(): void {
  window.__shiftlensSeed = (params: SyntheticDepartmentParams) => {
    const { inputs, currentStaffingGrid } = generateSyntheticDepartment(params);
    const s = useStore.getState();
    s.setArrivals(inputs.arrivals);
    s.setArrivalsP75(inputs.arrivalsP75 ?? null);
    s.setWHppvTarget(inputs.wHppvTarget, true);
    s.setShiftMenu(inputs.shiftMenu);
    s.setEsiMix(inputs.esiMix ?? null);
    // The synthetic generator only ever produces a SCALAR admitRate/boardingDuration (never
    // the hourly Cell168 variant EngineInputs also allows) — the store's setters are
    // scalar-only to match, since no UI path sets the array form. Narrow defensively rather
    // than widening the store's type for a shape this seed path never actually produces.
    s.setAdmitRate(typeof inputs.admitRate === 'number' ? inputs.admitRate : null);
    s.setBoardingDuration(typeof inputs.boardingDuration === 'number' ? inputs.boardingDuration : null);
    s.setMonthlyMeanBoardingDurationHours(inputs.monthlyMeanBoardingDurationHours ?? null);
    s.setDayOfWeekMeanBoardingDurationHours(inputs.dayOfWeekMeanBoardingDurationHours ?? null);
    s.setBoardingCensusMedical(inputs.boardingCensusMedical ?? null);
    s.setBoardingCensusBH(inputs.boardingCensusBH ?? null);
    s.setMonthlyBoardingCensusMedical(inputs.monthlyBoardingCensusMedical ?? null);
    s.setMonthlyBoardingCensusBH(inputs.monthlyBoardingCensusBH ?? null);
    s.setCurrentStaffingGrid(currentStaffingGrid);
    s.setScreen('dashboard');
  };
}
