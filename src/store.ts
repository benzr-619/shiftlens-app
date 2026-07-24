import { create } from 'zustand';
import type { EngineInputs, EsiMix, Grid, ShiftDef } from './engine/types';
import { compute, recomputeAfterEdit, type EngineResult } from './engine';

export type Screen = 'welcome' | 'setup' | 'dashboard';

export interface CompareVariant {
  id: string;
  name: string;
  shiftMenu: ShiftDef[];
}

interface StoreState {
  screen: Screen;
  setupStep: number; // 0-3, current step of the setup wizard (Data, Volume, Shift menu, Review)

  // Section 1 inputs
  arrivals: number[]; // 168 cells, all zero until user provides data
  annualVisitsOverride: number | null;
  wHppvTarget: number;
  wHppvTouched: boolean; // false until user edits away from the cohort-benchmark pre-fill
  shiftMenu: ShiftDef[];

  esiMix: EsiMix | null;
  // All four of admitRate/boardingDuration/monthlyMeanBoardingDurationHours/
  // dayOfWeekMeanBoardingDurationHours are populated exclusively via the consolidated
  // template upload now (Setup Step 1, DataStep.tsx) — no typed manual-entry UI for any of
  // them. See .claude/rules/template-parsing.md.
  admitRate: number | null;
  boardingDuration: number | null; // scalar hours-per-boarder — matches admitRate's scalar shape
  boardingRatioTarget: number; // the one boarding field that IS a typed policy choice, not template data
  monthlyMeanBoardingDurationHours: number[] | null; // 12 mean-duration-per-patient values (Jan-Dec) or null; all-or-nothing
  dayOfWeekMeanBoardingDurationHours: number[] | null; // 7 mean-duration-per-patient values (Sun-Sat) or null; all-or-nothing

  // manual grid edits layered on top of the last solve
  gridOverride: Grid | null;

  // A separate comparison grid — "what are you actually staffing today" — NOT an edit
  // layered on the recommendation (that's gridOverride). Starts null/empty and is never
  // seeded from the idealized grid; cells read as 0 until the user enters a value. See
  // CoreGridTab.tsx's "Current staffing" section.
  currentStaffingGrid: Grid | null;

  compareVariants: CompareVariant[];

  setScreen: (s: Screen) => void;
  setSetupStep: (step: number) => void;
  setArrivals: (a: number[]) => void;
  setAnnualVisitsOverride: (v: number | null) => void;
  setWHppvTarget: (v: number, touched?: boolean) => void;
  setShiftMenu: (m: ShiftDef[]) => void;
  setEsiMix: (m: EsiMix | null) => void;
  setAdmitRate: (v: number | null) => void;
  setBoardingDuration: (v: number | null) => void;
  setBoardingRatioTarget: (v: number) => void;
  setMonthlyMeanBoardingDurationHours: (v: number[] | null) => void;
  setDayOfWeekMeanBoardingDurationHours: (v: number[] | null) => void;
  editGridCell: (day: number, shiftId: string, headcount: number) => void;
  resetGridOverride: () => void;
  setCurrentStaffingCell: (day: number, shiftId: string, headcount: number) => void;
  resetCurrentStaffingGrid: () => void;
  addCompareVariant: (v: CompareVariant) => void;
  removeCompareVariant: (id: string) => void;
  updateCompareVariant: (id: string, menu: ShiftDef[]) => void;

  buildEngineInputs: () => EngineInputs;
  getResult: () => EngineResult;
  getLiveResult: () => {
    weeklyScheduledHours: number;
    shortfall: EngineResult['shortfall'];
    realizedWHppv: number;
    enaFloorViolationsRemaining: EngineResult['enaFloorViolationsRemaining'];
  } | null;
  getCurrentStaffingResult: () => {
    weeklyScheduledHours: number;
    shortfall: EngineResult['shortfall'];
    realizedWHppv: number;
    enaFloorViolationsRemaining: EngineResult['enaFloorViolationsRemaining'];
  };
}

export const useStore = create<StoreState>((set, get) => ({
  screen: 'welcome',
  setupStep: 0,
  arrivals: new Array(168).fill(0),
  annualVisitsOverride: null,
  wHppvTarget: 1.7,
  wHppvTouched: false,
  shiftMenu: [
    { id: 'shift-1', label: 'Day', startHour: 7, lengthHours: 12 },
    { id: 'shift-2', label: 'Night', startHour: 19, lengthHours: 12 },
  ],
  esiMix: null,
  admitRate: null,
  boardingDuration: null,
  boardingRatioTarget: 4,
  monthlyMeanBoardingDurationHours: null,
  dayOfWeekMeanBoardingDurationHours: null,
  gridOverride: null,
  currentStaffingGrid: null,
  compareVariants: [],

  setScreen: (s) => set({ screen: s }),
  setSetupStep: (step) => set({ setupStep: Math.max(0, Math.min(3, step)) }),
  setArrivals: (a) => set({ arrivals: a, gridOverride: null }),
  setAnnualVisitsOverride: (v) => set({ annualVisitsOverride: v }),
  setWHppvTarget: (v, touched = true) => set({ wHppvTarget: v, wHppvTouched: touched }),
  setShiftMenu: (m) => set({ shiftMenu: m, gridOverride: null }),
  setEsiMix: (m) => set({ esiMix: m }),
  setAdmitRate: (v) => set({ admitRate: v }),
  setBoardingDuration: (v) => set({ boardingDuration: v }),
  setBoardingRatioTarget: (v) => set({ boardingRatioTarget: v }),
  setMonthlyMeanBoardingDurationHours: (v) => set({ monthlyMeanBoardingDurationHours: v }),
  setDayOfWeekMeanBoardingDurationHours: (v) => set({ dayOfWeekMeanBoardingDurationHours: v }),

  editGridCell: (day, shiftId, headcount) => {
    const state = get();
    const base = state.gridOverride ?? state.getResult().grid;
    const next: Grid = { ...base, [day]: { ...base[day], [shiftId]: Math.max(0, headcount) } };
    set({ gridOverride: next });
  },
  resetGridOverride: () => set({ gridOverride: null }),

  setCurrentStaffingCell: (day, shiftId, headcount) => {
    const state = get();
    const base = state.currentStaffingGrid ?? {};
    const next: Grid = { ...base, [day]: { ...base[day], [shiftId]: Math.max(0, headcount) } };
    set({ currentStaffingGrid: next });
  },
  resetCurrentStaffingGrid: () => set({ currentStaffingGrid: null }),

  addCompareVariant: (v) => set((s) => ({ compareVariants: [...s.compareVariants, v] })),
  removeCompareVariant: (id) => set((s) => ({ compareVariants: s.compareVariants.filter((v) => v.id !== id) })),
  updateCompareVariant: (id, menu) =>
    set((s) => ({ compareVariants: s.compareVariants.map((v) => (v.id === id ? { ...v, shiftMenu: menu } : v)) })),

  buildEngineInputs: () => {
    const s = get();
    const inputs: EngineInputs = {
      arrivals: s.arrivals,
      annualVisits: s.annualVisitsOverride ?? undefined,
      wHppvTarget: s.wHppvTarget,
      shiftMenu: s.shiftMenu,
      boardingRatioTarget: s.boardingRatioTarget,
    };
    if (s.esiMix) inputs.esiMix = s.esiMix;
    if (s.admitRate !== null) inputs.admitRate = s.admitRate;
    if (s.boardingDuration !== null) inputs.boardingDuration = s.boardingDuration;
    if (s.monthlyMeanBoardingDurationHours) inputs.monthlyMeanBoardingDurationHours = s.monthlyMeanBoardingDurationHours;
    if (s.dayOfWeekMeanBoardingDurationHours) inputs.dayOfWeekMeanBoardingDurationHours = s.dayOfWeekMeanBoardingDurationHours;
    return inputs;
  },

  getResult: () => compute(get().buildEngineInputs()),

  getLiveResult: () => {
    const s = get();
    if (!s.gridOverride) return null;
    const result = s.getResult();
    return recomputeAfterEdit(s.gridOverride, s.buildEngineInputs(), result.hourlyRequirement);
  },

  // Unconditional (unlike getLiveResult) — an empty/unset currentStaffingGrid is a
  // meaningful state to compare against (0 staffed everywhere), not an absent one.
  getCurrentStaffingResult: () => {
    const s = get();
    const result = s.getResult();
    return recomputeAfterEdit(s.currentStaffingGrid ?? {}, s.buildEngineInputs(), result.hourlyRequirement);
  },
}));
