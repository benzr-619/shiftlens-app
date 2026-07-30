import { create } from 'zustand';
import type { EngineInputs, EsiMix, Grid, ShiftDef } from './engine/types';
import { compute, recomputeAfterEdit, NO_FLEX, type EngineResult, type FlexAxes } from './engine';

export type Screen = 'welcome' | 'setup' | 'dashboard';

interface StoreState {
  screen: Screen;
  setupStep: number; // 0-3, current step of the setup wizard (Data, Volume, Shift menu, Review)

  // Section 1 inputs
  arrivals: number[]; // 168 cells, all zero until user provides data
  // 2026-07-26 (Phase 2a): optional busy-hour (p75) arrivals, all-or-nothing, template-only.
  // null until provided; feeds engine/demandBand.ts's demand-volatility buffer only — never
  // annualVisits/hourlyRequirement. See .claude/rules/template-parsing.md.
  arrivalsP75: number[] | null;
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

  // 2026-07-27 (SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md) — the measured boarding
  // census path, a new PRIMARY input alongside (not replacing) admitRate/boardingDuration
  // above. Populated by the guided walkthrough's boarding fork (census branch) or by
  // uploading the Boarding Census tab of the consolidated template. See
  // .claude/rules/boarding-seasonality.md's measured-path section.
  boardingCensusMedical: number[] | null;
  boardingCensusBH: number[] | null;
  monthlyBoardingCensusMedical: number[] | null;
  monthlyBoardingCensusBH: number[] | null;
  bhBoardingRatioTarget: number; // policy setting, default 10 (1:10) — see the Settings card
  preBedRequestCensus: number[] | null; // §7 validation-only diagnostic input, optional

  // 2026-07-27 — guided setup walkthrough entry fork + tutorial state. `setupMode` is null
  // until the user picks a path on the entry fork; once inside 'tutorial' there is no
  // "ask a colleague" escape hatch (a linear guided flow). `boardingPath` is the tutorial's
  // boarding-fork answer — the user must never see both the census grid and the admit-rate
  // fields at once, so this is a tri-state selector, not two independent booleans.
  setupMode: 'tutorial' | 'colleague' | 'returning' | null;
  tutorialStep: number; // 0-4, one of the five guided-walkthrough items (current staffing isn't one — see TutorialFlow.tsx's header comment)
  boardingPath: 'census' | 'classic' | 'skip' | null;

  // manual grid edits layered on top of the last solve
  gridOverride: Grid | null;

  // A separate comparison grid — "what are you actually staffing today" — NOT an edit
  // layered on the recommendation (that's gridOverride). Starts null/empty and is never
  // seeded from the idealized grid; cells read as 0 until the user enters a value. See
  // CoreGridTab.tsx's "Current staffing" section.
  currentStaffingGrid: Grid | null;

  // §2.3 shift-menu flexibility preferences — which axes the user is open to the solver
  // searching for a more efficient alternate menu. Captured at setup (ShiftMenuStep) and
  // also adjustable on the results page (ShiftMenuFlexibilitySection). Default all-off
  // (static: the idealized grid uses the user's current menu, never a silent substitute).
  flexAxes: FlexAxes;

  // PR H (RESULTS_PAGE_V2_SPEC_2026-07-27.md §7) — Panel 5's sandbox grids, lifted into the
  // store (rather than staying component-local, PR G's original choice) SPECIFICALLY so the
  // PPTX export — which runs from DashboardScreen, not Panel5 — can read "the user's sandbox
  // scenario" per the spec's export-scope requirement. Still ephemeral (not part of
  // EngineInputs, never sent through compute()) — `null` means "untouched," which the export
  // path reads as "prefill with the recommendation" rather than exporting a blank scenario.
  sandboxEdGrid: Grid | null;
  sandboxHoldGrid: Grid | null;

  // 2026-07-26 PR D (SOLVER_REALISM_SPEC_2026-07-26.md, change 7) — headcount semantics, ONE
  // setup question, not role-level modeling. Null until the user answers (no ED-specific
  // default). Still never threaded into EngineInputs/compute() — it never changes
  // hourlyRequirement, the grid, the ENA floor, or any solved number. On "no" it now drives a
  // one-time GRID-CORRECTION action on ShiftMenuStep.tsx (add a typed indirect-care count to
  // every currentStaffingGrid cell) rather than a display-only uplift % field — see that
  // file's "Headcount semantics" card. Do NOT wire this boolean into the engine; that would be
  // the role-level modeling the spec explicitly declined.
  headcountIncludesIndirectCare: boolean | null;

  // Configurable "hours per FTE" policy setting — UI-only, never part of the uploaded data
  // template (same "workbook carries data, policy lives in the UI" rule as
  // boardingRatioTarget/enaFloor). Both the raw entered value and the mode it was entered in
  // are stored so the field redisplays correctly; `buildEngineInputs()` derives the
  // canonical `hoursPerFteAnnual = fteInputMode === 'weekly' ? fteInputValue * 52 :
  // fteInputValue` for the engine.
  fteInputMode: 'weekly' | 'annual';
  fteInputValue: number;

  setScreen: (s: Screen) => void;
  setSetupStep: (step: number) => void;
  setArrivals: (a: number[]) => void;
  setArrivalsP75: (a: number[] | null) => void;
  setAnnualVisitsOverride: (v: number | null) => void;
  setWHppvTarget: (v: number, touched?: boolean) => void;
  setShiftMenu: (m: ShiftDef[]) => void;
  setEsiMix: (m: EsiMix | null) => void;
  setAdmitRate: (v: number | null) => void;
  setBoardingDuration: (v: number | null) => void;
  setBoardingRatioTarget: (v: number) => void;
  setMonthlyMeanBoardingDurationHours: (v: number[] | null) => void;
  setDayOfWeekMeanBoardingDurationHours: (v: number[] | null) => void;
  setBoardingCensusMedical: (v: number[] | null) => void;
  setBoardingCensusBH: (v: number[] | null) => void;
  setMonthlyBoardingCensusMedical: (v: number[] | null) => void;
  setMonthlyBoardingCensusBH: (v: number[] | null) => void;
  setBhBoardingRatioTarget: (v: number) => void;
  setPreBedRequestCensus: (v: number[] | null) => void;
  setSetupMode: (m: 'tutorial' | 'colleague' | 'returning' | null) => void;
  setTutorialStep: (n: number) => void;
  setBoardingPath: (p: 'census' | 'classic' | 'skip' | null) => void;
  editGridCell: (day: number, shiftId: string, headcount: number) => void;
  resetGridOverride: () => void;
  setCurrentStaffingCell: (day: number, shiftId: string, headcount: number) => void;
  setCurrentStaffingGrid: (grid: Grid) => void;
  resetCurrentStaffingGrid: () => void;
  setFlexAxis: (axis: keyof FlexAxes, value: boolean) => void;
  setSandboxEdGrid: (g: Grid | null) => void;
  setSandboxHoldGrid: (g: Grid | null) => void;
  setHeadcountIncludesIndirectCare: (v: boolean | null) => void;
  setFteInputMode: (m: 'weekly' | 'annual') => void;
  setFteInputValue: (v: number) => void;

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
  arrivalsP75: null,
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
  boardingCensusMedical: null,
  boardingCensusBH: null,
  monthlyBoardingCensusMedical: null,
  monthlyBoardingCensusBH: null,
  bhBoardingRatioTarget: 10,
  preBedRequestCensus: null,
  setupMode: null,
  tutorialStep: 0,
  boardingPath: null,
  gridOverride: null,
  currentStaffingGrid: null,
  flexAxes: { ...NO_FLEX },
  sandboxEdGrid: null,
  sandboxHoldGrid: null,
  headcountIncludesIndirectCare: null,
  fteInputMode: 'weekly',
  fteInputValue: 40,

  setScreen: (s) => set({ screen: s }),
  setSetupStep: (step) => set({ setupStep: Math.max(0, Math.min(3, step)) }),
  setArrivals: (a) => set({ arrivals: a, gridOverride: null }),
  setArrivalsP75: (a) => set({ arrivalsP75: a }),
  setAnnualVisitsOverride: (v) => set({ annualVisitsOverride: v }),
  setWHppvTarget: (v, touched = true) => set({ wHppvTarget: v, wHppvTouched: touched }),
  setShiftMenu: (m) => set({ shiftMenu: m, gridOverride: null }),
  setEsiMix: (m) => set({ esiMix: m }),
  setAdmitRate: (v) => set({ admitRate: v }),
  setBoardingDuration: (v) => set({ boardingDuration: v }),
  setBoardingRatioTarget: (v) => set({ boardingRatioTarget: v }),
  setMonthlyMeanBoardingDurationHours: (v) => set({ monthlyMeanBoardingDurationHours: v }),
  setDayOfWeekMeanBoardingDurationHours: (v) => set({ dayOfWeekMeanBoardingDurationHours: v }),
  setBoardingCensusMedical: (v) => set({ boardingCensusMedical: v }),
  setBoardingCensusBH: (v) => set({ boardingCensusBH: v }),
  setMonthlyBoardingCensusMedical: (v) => set({ monthlyBoardingCensusMedical: v }),
  setMonthlyBoardingCensusBH: (v) => set({ monthlyBoardingCensusBH: v }),
  setBhBoardingRatioTarget: (v) => set({ bhBoardingRatioTarget: v }),
  setPreBedRequestCensus: (v) => set({ preBedRequestCensus: v }),
  setSetupMode: (m) => set({ setupMode: m }),
  setTutorialStep: (n) => set({ tutorialStep: Math.max(0, Math.min(4, n)) }), // 0-4, five guided-walkthrough items (current staffing lives on ShiftMenuStep only, not a tutorial item)
  setBoardingPath: (p) => set({ boardingPath: p }),

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
  // Merges cell-by-cell onto the existing grid (uploaded template rows may only cover a
  // subset of day/shift cells, same partial-upload tolerance as everywhere else) rather
  // than replacing it wholesale — an upload only touches the cells it actually populated.
  setCurrentStaffingGrid: (grid) => {
    const state = get();
    const base = state.currentStaffingGrid ?? {};
    const next: Grid = { ...base };
    for (const [day, shifts] of Object.entries(grid)) {
      next[Number(day)] = { ...next[Number(day)], ...shifts };
    }
    set({ currentStaffingGrid: next });
  },
  resetCurrentStaffingGrid: () => set({ currentStaffingGrid: null }),

  setFlexAxis: (axis, value) => set((s) => ({ flexAxes: { ...s.flexAxes, [axis]: value } })),
  setSandboxEdGrid: (g) => set({ sandboxEdGrid: g }),
  setSandboxHoldGrid: (g) => set({ sandboxHoldGrid: g }),
  setHeadcountIncludesIndirectCare: (v) => set({ headcountIncludesIndirectCare: v }),
  setFteInputMode: (m) => set({ fteInputMode: m }),
  setFteInputValue: (v) => set({ fteInputValue: v }),

  buildEngineInputs: () => {
    const s = get();
    const inputs: EngineInputs = {
      arrivals: s.arrivals,
      annualVisits: s.annualVisitsOverride ?? undefined,
      wHppvTarget: s.wHppvTarget,
      shiftMenu: s.shiftMenu,
      boardingRatioTarget: s.boardingRatioTarget,
      hoursPerFteAnnual: s.fteInputMode === 'weekly' ? s.fteInputValue * 52 : s.fteInputValue,
    };
    if (s.arrivalsP75) inputs.arrivalsP75 = s.arrivalsP75;
    if (s.esiMix) inputs.esiMix = s.esiMix;
    if (s.admitRate !== null) inputs.admitRate = s.admitRate;
    if (s.boardingDuration !== null) inputs.boardingDuration = s.boardingDuration;
    if (s.monthlyMeanBoardingDurationHours) inputs.monthlyMeanBoardingDurationHours = s.monthlyMeanBoardingDurationHours;
    if (s.dayOfWeekMeanBoardingDurationHours) inputs.dayOfWeekMeanBoardingDurationHours = s.dayOfWeekMeanBoardingDurationHours;
    if (s.boardingCensusMedical) inputs.boardingCensusMedical = s.boardingCensusMedical;
    if (s.boardingCensusBH) inputs.boardingCensusBH = s.boardingCensusBH;
    if (s.monthlyBoardingCensusMedical) inputs.monthlyBoardingCensusMedical = s.monthlyBoardingCensusMedical;
    if (s.monthlyBoardingCensusBH) inputs.monthlyBoardingCensusBH = s.monthlyBoardingCensusBH;
    if (s.boardingCensusMedical) inputs.bhBoardingRatioTarget = s.bhBoardingRatioTarget;
    if (s.preBedRequestCensus) inputs.preBedRequestCensus = s.preBedRequestCensus;
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
