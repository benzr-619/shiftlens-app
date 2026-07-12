import { create } from 'zustand';
import type { EngineInputs, EsiMix, Grid, ShiftDef } from './engine/types';
import { compute, recomputeAfterEdit, type EngineResult } from './engine';

export type Screen = 'setup' | 'dashboard';

export interface CompareVariant {
  id: string;
  name: string;
  shiftMenu: ShiftDef[];
}

interface StoreState {
  screen: Screen;

  // Section 1 inputs
  arrivals: number[]; // 168 cells, all zero until user provides data
  annualVisitsOverride: number | null;
  wHppvTarget: number;
  wHppvTouched: boolean; // false until user edits away from the EDBA pre-fill
  shiftMenu: ShiftDef[];

  esiMix: EsiMix | null;
  admitRate: number | null;
  boardingDuration: number[] | null;
  boardingRatioTarget: number;

  // manual grid edits layered on top of the last solve
  gridOverride: Grid | null;

  compareVariants: CompareVariant[];

  setScreen: (s: Screen) => void;
  setArrivals: (a: number[]) => void;
  setAnnualVisitsOverride: (v: number | null) => void;
  setWHppvTarget: (v: number, touched?: boolean) => void;
  setShiftMenu: (m: ShiftDef[]) => void;
  setEsiMix: (m: EsiMix | null) => void;
  setAdmitRate: (v: number | null) => void;
  setBoardingDuration: (v: number[] | null) => void;
  setBoardingRatioTarget: (v: number) => void;
  editGridCell: (day: number, shiftId: string, headcount: number) => void;
  resetGridOverride: () => void;
  addCompareVariant: (v: CompareVariant) => void;
  removeCompareVariant: (id: string) => void;
  updateCompareVariant: (id: string, menu: ShiftDef[]) => void;

  buildEngineInputs: () => EngineInputs;
  getResult: () => EngineResult;
  getLiveResult: () => { weeklyScheduledHours: number; shortfall: EngineResult['shortfall']; realizedWHppv: number } | null;
}

export const useStore = create<StoreState>((set, get) => ({
  screen: 'setup',
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
  gridOverride: null,
  compareVariants: [],

  setScreen: (s) => set({ screen: s }),
  setArrivals: (a) => set({ arrivals: a, gridOverride: null }),
  setAnnualVisitsOverride: (v) => set({ annualVisitsOverride: v }),
  setWHppvTarget: (v, touched = true) => set({ wHppvTarget: v, wHppvTouched: touched }),
  setShiftMenu: (m) => set({ shiftMenu: m, gridOverride: null }),
  setEsiMix: (m) => set({ esiMix: m }),
  setAdmitRate: (v) => set({ admitRate: v }),
  setBoardingDuration: (v) => set({ boardingDuration: v }),
  setBoardingRatioTarget: (v) => set({ boardingRatioTarget: v }),

  editGridCell: (day, shiftId, headcount) => {
    const state = get();
    const base = state.gridOverride ?? state.getResult().grid;
    const next: Grid = { ...base, [day]: { ...base[day], [shiftId]: Math.max(0, headcount) } };
    set({ gridOverride: next });
  },
  resetGridOverride: () => set({ gridOverride: null }),

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
    if (s.boardingDuration) inputs.boardingDuration = s.boardingDuration;
    return inputs;
  },

  getResult: () => compute(get().buildEngineInputs()),

  getLiveResult: () => {
    const s = get();
    if (!s.gridOverride) return null;
    const result = s.getResult();
    return recomputeAfterEdit(s.gridOverride, s.buildEngineInputs(), result.hourlyRequirement);
  },
}));
