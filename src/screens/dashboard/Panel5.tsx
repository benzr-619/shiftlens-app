import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { ShiftDef, Grid } from '../../engine/types';
import { DAY_LABELS, DEFAULTS } from '../../engine/types';
import { fullWeekCapacity, solveFullCoverageWeekWithTrajectory, bestUnitToAdd, bestUnitToRemove, shiftGlobalHours } from '../../engine/solver';
import { recommendWeeklyBoardingGrid, weeklyArrivalsSpareByCell } from '../../engine/boarding';
import {
  computeScenarioB,
  computeCombinedReallocation,
  computeBacklogFromCapacity,
  computePerShiftDiagnostic,
} from '../../engine';
import { lookupWhppvBand } from '../../lib/edbaLookup';
import { computeColorDomain } from '../../lib/whppvColorDomain';
import { computeSandbox } from '../../engine/sandbox';
import { averageDay } from '../../lib/averageDay';
import {
  fmtHour,
  computeQueuePattern,
  queuePatternSentence,
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
  averageOverDays,
  patternsDifferMeaningfully,
} from '../../lib/queuePattern';
import { shiftDiagnosticSentence } from '../../lib/narrative';
import { DISPLAY_DAY_ORDER, DISPLAY_DAY_LABELS } from '../../lib/dayOrder';
import { VisualFrame, type VisualFrameView } from '../../components/VisualFrame';
import { MarginalReturnsCurve } from '../../components/MarginalReturnsCurve';
import type { WhppvHeatmapCell } from '../../components/WhppvHeatmap';

function sortByStartHour(shifts: ShiftDef[]): ShiftDef[] {
  return [...shifts].sort((a, b) => a.startHour - b.startHour);
}

function emptyGrid(shiftMenu: ShiftDef[]): Grid {
  const g: Grid = {};
  for (let day = 0; day < 7; day++) {
    g[day] = {};
    for (const s of shiftMenu) g[day][s.id] = 0;
  }
  return g;
}

function sumGrids(a: Grid, b: Grid, shiftMenu: ShiftDef[]): Grid {
  const out: Grid = {};
  for (let day = 0; day < 7; day++) {
    out[day] = {};
    for (const s of shiftMenu) out[day][s.id] = (a[day]?.[s.id] ?? 0) + (b[day]?.[s.id] ?? 0);
  }
  return out;
}

function totalHeadcountUnits(grid: Grid, shiftMenu: ShiftDef[]): number {
  let total = 0;
  for (let day = 0; day < 7; day++) {
    for (const s of shiftMenu) total += grid[day]?.[s.id] ?? 0;
  }
  return total;
}

function buildCells(
  onDuty168: number[],
  requirement168: number[],
  demandRaw168: number[],
  arrivals168: number[],
  boardingCurve168?: number[] | null
): WhppvHeatmapCell[] {
  const cells: WhppvHeatmapCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const g = day * 24 + hour;
      cells.push({
        day,
        hour,
        onDuty: onDuty168[g] ?? 0,
        requirement: requirement168[g] ?? 0,
        demandRaw: demandRaw168[g] ?? 0,
        arrivals: arrivals168[g] ?? 0,
        boardingRnHours: boardingCurve168 ? (boardingCurve168[g] ?? 0) : undefined,
        belowFloor: false,
        riskReasons: [],
      });
    }
  }
  return cells;
}

/** Local copy of the same per-panel helper Panel 1/2/4 each keep their own copy of (repo
 * convention — see those files' own copies) — % of hours (arrivals > 0 only) whose realized
 * WHPPV falls below the peer cohort's p25 floor. */
function pctHoursBelowFloor(capacity168: number[], arrivals168: number[], p25: number): number {
  let total = 0;
  let below = 0;
  for (let g = 0; g < 168; g++) {
    const cellArrivals = arrivals168[g] ?? 0;
    if (cellArrivals <= 0) continue;
    total++;
    const value = (capacity168[g] ?? 0) / cellArrivals;
    if (value < p25) below++;
  }
  return total > 0 ? (below / total) * 100 : 0;
}

interface HourlyWhppvExtreme {
  value: number;
  day: number;
  hour: number;
}

/** Local copy of the same per-panel helper Panel 2/4 keep their own copy of. */
function hourlyWhppvRange(capacity168: number[], arrivals168: number[]): { min: HourlyWhppvExtreme | null; max: HourlyWhppvExtreme | null } {
  let min: HourlyWhppvExtreme | null = null;
  let max: HourlyWhppvExtreme | null = null;
  for (let g = 0; g < 168; g++) {
    const cellArrivals = arrivals168[g] ?? 0;
    if (cellArrivals <= 0) continue;
    const value = (capacity168[g] ?? 0) / cellArrivals;
    const day = Math.floor(g / 24);
    const hour = g % 24;
    if (!min || value < min.value) min = { value, day, hour };
    if (!max || value > max.value) max = { value, day, hour };
  }
  return { min, max };
}

/** Local copy of Panel 4's `pctDemandCovered` — % of a demand curve's total nursing-hours a
 * capacity curve actually covers. */
function pctDemandCovered(capacity168: number[], demand168: number[]): number {
  const total = demand168.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let covered = 0;
  for (let g = 0; g < 168; g++) covered += Math.min(capacity168[g] ?? 0, demand168[g] ?? 0);
  return Math.max(0, Math.min(100, (covered / total) * 100));
}

type Toggle = 'arrivals' | 'combined';

/** 2026-08-06 redesign — which mechanism+target cell was last clicked. Tracked separately from
 * the grids themselves so the UI can highlight the active cell without re-deriving it from grid
 * contents (which a hand-edit would make ambiguous anyway). Encodes BOTH the mechanism (which
 * starting grid) and, where meaningful, the target it was built against (arrivals-only vs.
 * combined) — two questions the page-level Arrivals / Arrivals + Boarding toggle used to
 * conflate by silently swapping which underlying computation a card ran. The toggle no longer
 * touches this state at all: flipping it re-scores whichever grid is selected against a
 * different demand curve (mirroring Panel 1), it never changes the selection. A manual
 * `GridEditor` edit also deliberately leaves it untouched — see `editCell` below. `holdSplit`
 * has no arrivals-only counterpart — it's combined-only by definition (it funds a SEPARATE hold
 * pool, which only exists as a concept once boarding is part of the demand being covered) — so
 * it carries no target suffix.
 *
 * 2026-08-06: a "Mixed ED + Hold" mechanism (a from-scratch joint greedy solve,
 * `engine/edHoldSolve.ts`) was tried and removed — under this model an ED-nurse-hour is never
 * worse than a hold-nurse-hour (ED can cover arrivals, BH boarding, AND medical boarding; hold
 * only medical boarding, capped) with no cost/FTE differential to offset that, so any
 * coverage-maximizing joint solve provably always allocates 100% to ED and 0% to hold — a
 * "mixed" mechanism with no way to ever actually produce a mix. Don't resurrect it without
 * first giving hold pool some genuine advantage (e.g. an ED-hours ceiling) — see git history for
 * `edHoldSolve.ts` if that's ever wanted. */
type ActiveStrategy =
  | 'current'
  | 'reallocated-arrivals'
  | 'reallocated-combined'
  | 'allEd-arrivals'
  | 'allEd-combined'
  | 'holdSplit';

/** Hours of deficit (or, for a remove candidate, hours of slack) a single (day, shift) unit
 * covers against a demand curve — a coarser, count-based cousin of `solver.ts`'s exact
 * coverage-hours scorers (`bestUnitToAdd`/`bestUnitToRemove`'s internal `coverageDeltaForUnit`),
 * re-derived here (not exported, file-private) so §3d's joint ED-vs-hold control can compare a
 * candidate ALREADY chosen from each pool (by the exact scorer, within-pool) on one common,
 * comparable metric across pools. `wantDeficit=true` scores "how much this unit would relieve"
 * (for add); `false` scores "how much slack this unit already sits on" (for remove — the more
 * slack, the safer/cheaper the cut). JUDGMENT CALL, flagged: comparing two differently-scaled
 * pools (ED vs. hold) by raw hours-covered rather than a cost-normalized metric can favor
 * whichever pool's best shift happens to be longer; deemed acceptable for a single-step
 * advisory control, not a solver objective — revisit if it visibly favors one pool over the
 * other in practice.
 */
function candidateCoverageScore(day: number, shift: ShiftDef, capacity168: number[], demand168: number[], wantDeficit: boolean): number {
  const hours = shiftGlobalHours(day, shift);
  return hours.filter((g) => (wantDeficit ? capacity168[g] < (demand168[g] ?? 0) : capacity168[g] >= (demand168[g] ?? 0))).length;
}

/**
 * PANEL 5 REDESIGN (2026-08-06) — "Test it yourself." REPLACES the 2026-08-05 build's flat
 * starting-point card stack, whose OFFERED cards (and, for "Re-allocated"/"Solver Staffing", the
 * underlying compute call each ran) changed with the page's Arrivals / Arrivals + Boarding
 * toggle — making the toggle behave like Panels 2/3 (changes what's recommended) instead of
 * Panel 1 (a pure lens on the same selection). See .claude/rules/results-redesign.md's Panel 5
 * section for the full architecture.
 *
 * Governing change: the toggle now drives ONLY which demand curve scores the currently-selected
 * grid (`VisualFrame`/`computeBacklog`, same as Panel 1) — never which grid is selected. Which
 * starting grid to test is a separate, explicit choice made via the mechanism x target matrix
 * below (`strategyMatrix`); every row is reachable regardless of `toggle`, and a selection
 * persists across a toggle flip.
 */
export function Panel5() {
  const {
    shiftMenu,
    arrivals,
    currentStaffingGrid,
    sandboxEdGrid,
    sandboxHoldGrid,
    setSandboxEdGrid,
    setSandboxHoldGrid,
    buildEngineInputs,
    getResult,
  } = useStore();
  const result = getResult();
  const sortedShiftMenu = useMemo(() => sortByStartHour(shiftMenu), [shiftMenu]);
  const inputs = buildEngineInputs();

  const [toggle, setToggle] = useState<Toggle>('arrivals');
  const [activeStrategy, setActiveStrategy] = useState<ActiveStrategy>('current');
  // Tracks whether the grids have been hand-edited (GridEditor cell edit or the +/- marginal
  // control) since `activeStrategy` was last set by a matrix click. Cleared by every prefill*
  // function, set by every mutation path that ISN'T a prefill — so the matrix can tell "this is
  // still exactly what you started from" (Selected) from "you've since changed it" (Reset),
  // without diffing grid contents cell-by-cell.
  const [hasEdits, setHasEdits] = useState(false);
  // 2026-08-06 redesign — the toggle is a pure lens (which demand curve scores the SAME selected
  // grid), never a mechanism switch. It must never touch `activeStrategy` or either sandbox
  // grid — a selection made under one toggle state stays selected after flipping it, exactly so
  // a user can build "re-allocated for arrivals only" and then flip to combined to see what
  // boarding costs a plan that never accounted for it.
  function changeToggle(next: Toggle) {
    setToggle(next);
  }

  // §4 — hold-shift restriction. Default: every shift is allowed. A shift newly added to the
  // menu (e.g. mid-session, back in setup) is treated as allowed by default too — tracked via
  // `seenShiftIdsRef` so a shift the user has EXPLICITLY unchecked doesn't silently reappear as
  // allowed just because the menu re-rendered. JUDGMENT CALL, flagged: the spec names the state
  // shape (`allowedHoldShiftIds: Set<string>`, default all shifts) but not this reconciliation
  // behavior for a changing shift menu — this is the most conservative reading (new shifts
  // start allowed, explicit un-checks persist).
  const [allowedHoldShiftIds, setAllowedHoldShiftIds] = useState<Set<string>>(() => new Set(sortedShiftMenu.map((s) => s.id)));
  const seenShiftIdsRef = useRef<Set<string>>(new Set(sortedShiftMenu.map((s) => s.id)));
  useEffect(() => {
    setAllowedHoldShiftIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const s of sortedShiftMenu) {
        if (!seenShiftIdsRef.current.has(s.id)) {
          next.add(s.id);
          changed = true;
        }
      }
      seenShiftIdsRef.current = new Set(sortedShiftMenu.map((s) => s.id));
      return changed ? next : prev;
    });
  }, [sortedShiftMenu]);

  function toggleHoldShift(id: string) {
    setAllowedHoldShiftIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Disallowing a shift zeroes any hold headcount already sitting on it — a disallowed
    // column is not just visually disabled, its data is cleared too (§4's "manual hold edits
    // must respect the restriction" rule applies to a retroactive restriction too).
    if (allowedHoldShiftIds.has(id)) {
      const base = holdGrid;
      const next: Grid = {};
      for (let day = 0; day < 7; day++) next[day] = { ...base[day], [id]: 0 };
      setHoldGrid(next);
    }
  }

  const allowedHoldShiftMenu = useMemo(
    () => sortedShiftMenu.filter((s) => allowedHoldShiftIds.has(s.id)),
    [sortedShiftMenu, allowedHoldShiftIds]
  );

  const edGrid = sandboxEdGrid ?? emptyGrid(sortedShiftMenu);
  const holdGrid = sandboxHoldGrid ?? emptyGrid(sortedShiftMenu);
  const setEdGrid = (updater: Grid | ((prev: Grid) => Grid)) =>
    setSandboxEdGrid(typeof updater === 'function' ? (updater as (prev: Grid) => Grid)(edGrid) : updater);
  const setHoldGrid = (updater: Grid | ((prev: Grid) => Grid)) =>
    setSandboxHoldGrid(typeof updater === 'function' ? (updater as (prev: Grid) => Grid)(holdGrid) : updater);

  const boarding = result.boarding;
  const band = lookupWhppvBand(result.annualVisits);
  const whppvBand = computeColorDomain(result.annualVisits, inputs.wHppvTarget);
  const boardingCurve = boarding?.cellBoardingRnHours ?? null;
  const combinedRequirement = useMemo(
    () => result.hourlyRequirement.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0)),
    [result.hourlyRequirement, boardingCurve]
  );
  const activeDemand168 = toggle === 'arrivals' ? result.hourlyRequirement : combinedRequirement;

  // Same arrivals-spare netting Panel4.tsx's own "combined" grid uses (recommendWeeklyBoardingGrid's
  // optional 6th param) — computed against the FULL, unrestricted shift menu, since ED's own
  // spare capacity is real regardless of which shifts hold nurses happen to be allowed to work.
  // Using the identical inputs Panel4 uses is what makes `boardingGridAllEd` below byte-
  // identical to Panel4's own boarding table, not just an equivalent re-derivation.
  const arrivalsSpareByCell = useMemo(
    () => weeklyArrivalsSpareByCell(result.grid, result.hourlyRequirement, sortedShiftMenu),
    [result.grid, result.hourlyRequirement, sortedShiftMenu]
  );
  const boardingGridAllEd =
    boarding && result.lostProductivity
      ? recommendWeeklyBoardingGrid(
          boarding,
          sortedShiftMenu,
          inputs.wHppvTarget,
          band.p25Whppv,
          result.lostProductivity.wHppvConsumedByBoarding,
          arrivalsSpareByCell
        )
      : {};

  // The SAME recommended boarding grid, but solved against whichever shift menu hold nurses are
  // actually allowed to work (§4's restriction checkboxes). When every shift is allowed, this is
  // the identical call as `boardingGridAllEd` above (same menu, same result) — reusing that
  // value directly rather than recomputing guarantees byte-identical output, exactly recreating
  // Panel 4's own two tables (arrivals = result.grid, boarding = this grid) split across pools
  // instead of summed into one. Only when the allowed set is actually narrower does this produce
  // a genuinely different recommendation — `recommendWeeklyBoardingGrid` re-solves its own
  // stackable-unit funding against the smaller menu, per the redesign's own "compute a new
  // solution" instruction.
  const allShiftsAllowed = allowedHoldShiftMenu.length === sortedShiftMenu.length;
  const boardingGridForHold =
    allShiftsAllowed
      ? boardingGridAllEd
      : boarding && result.lostProductivity
        ? recommendWeeklyBoardingGrid(
            boarding,
            allowedHoldShiftMenu,
            inputs.wHppvTarget,
            band.p25Whppv,
            result.lostProductivity.wHppvConsumedByBoarding,
            arrivalsSpareByCell
          )
        : {};

  // §1 — the medical/BH boarding split, unchanged from the prior build's own judgment call
  // (see this file's git history / results-redesign.md's PR G section): the engine only
  // exposes weekly medical/BH totals (measured path only), never a per-hour split, so the
  // combined per-hour curve is split proportionally by the weekly ratio, uniformly across all
  // 168 hours.
  const combined = boarding?.cellBoardingRnHours ?? new Array(168).fill(0);
  const medWeekly = boarding?.medicalWeeklyRnHours ?? null;
  const bhWeekly = boarding?.bhWeeklyRnHours ?? null;
  const medFraction = medWeekly !== null && bhWeekly !== null && medWeekly + bhWeekly > 0 ? medWeekly / (medWeekly + bhWeekly) : 1;
  const medBoarding168 = useMemo(() => combined.map((v) => v * medFraction), [combined, medFraction]);
  const bhBoarding168 = useMemo(() => combined.map((v) => v * (1 - medFraction)), [combined, medFraction]);

  // §3 — mechanism x target matrix cells. Each sets `activeStrategy` itself (never `editCell`,
  // which is what keeps a manual grid edit from silently changing which cell reads as active).
  // Every one of these is reachable regardless of the current page toggle — the matrix itself
  // doesn't read `toggle` at all; each cell that has a target bakes it into its OWN name
  // (`-arrivals`/`-combined`) rather than reading the ambient toggle, which is the entire fix.
  function prefillCurrent() {
    setEdGrid(currentStaffingGrid ? { ...currentStaffingGrid } : emptyGrid(sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
    setActiveStrategy('current');
    setHasEdits(false);
  }
  function prefillReallocatedArrivals() {
    const scenarioB = currentStaffingGrid ? computeScenarioB(result, inputs, currentStaffingGrid) : null;
    setEdGrid(scenarioB ? { ...scenarioB.grid } : currentStaffingGrid ? { ...currentStaffingGrid } : emptyGrid(sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
    setActiveStrategy('reallocated-arrivals');
    setHasEdits(false);
  }
  function prefillReallocatedCombined() {
    const combinedRealloc = currentStaffingGrid ? computeCombinedReallocation(result, inputs, currentStaffingGrid) : null;
    setEdGrid(combinedRealloc ? { ...combinedRealloc.grid } : currentStaffingGrid ? { ...currentStaffingGrid } : emptyGrid(sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
    setActiveStrategy('reallocated-combined');
    setHasEdits(false);
  }
  function prefillSolverAllEdArrivals() {
    setEdGrid({ ...result.grid });
    setHoldGrid(emptyGrid(sortedShiftMenu));
    setActiveStrategy('allEd-arrivals');
    setHasEdits(false);
  }
  function prefillSolverAllEdCombined() {
    setEdGrid(sumGrids(result.grid, boardingGridAllEd, sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
    setActiveStrategy('allEd-combined');
    setHasEdits(false);
  }
  // ED stays exactly `result.grid` — the SAME budget-trimmed arrivals solve Panel4 shows as its
  // "Nurses for Arrivals" table, never re-solved from scratch here. When every shift is allowed
  // for hold, `boardingGridForHold` is the identical `boardingGridAllEd` grid Panel4 shows as
  // "Additional Nurses for Boarding" — so this exactly recreates Panel4's two tables, just
  // assigning the boarding one to the hold pool instead of summing it into ED. Only when the
  // restriction narrows the allowed shifts does `boardingGridForHold` differ, which is exactly
  // the "compute a new solution" case — recommendWeeklyBoardingGrid re-solves its own funding
  // order against the smaller menu, not a from-scratch full-coverage fill.
  function prefillSolverHoldSplit() {
    setEdGrid({ ...result.grid });
    setHoldGrid({ ...boardingGridForHold });
    setActiveStrategy('holdSplit');
    setHasEdits(false);
  }

  // §5/§6/§9 — the current sandbox test schedule's own combined ED+hold picture.
  const edCapacity = fullWeekCapacity(edGrid, sortedShiftMenu);
  const holdCapacityRaw = fullWeekCapacity(holdGrid, sortedShiftMenu);
  const sandbox = computeSandbox(result.hourlyRequirement, medBoarding168, bhBoarding168, arrivals, edCapacity, holdCapacityRaw);
  // Tooltip-only fractional counterpart of `sandbox.residualDemand`, pre-`Math.ceil` on the
  // arrivals component — see WhppvHeatmapCell.demandRaw. Reuses `sandbox.holdApplied` (the
  // real, already-computed capping) rather than re-deriving it, so this can never disagree with
  // the actual solve about how much boarding hold nurses absorbed.
  const residualDemandRaw = useMemo(
    () => result.cellCoreHoursSmoothed.map((v, i) => v + (medBoarding168[i] - sandbox.holdApplied[i]) + bhBoarding168[i]),
    [result.cellCoreHoursSmoothed, medBoarding168, bhBoarding168, sandbox.holdApplied]
  );
  // The combined ED+hold capacity this staffing actually delivers — ED capacity plus hold's
  // capped contribution (never more than that hour's own medical boarding demand, per §5's
  // capping convention, same as `computeSandbox`'s `holdApplied`).
  const combinedCapacity168 = useMemo(() => edCapacity.map((v, i) => v + sandbox.holdApplied[i]), [edCapacity, sandbox.holdApplied]);

  const cellsArrivals = buildCells(edCapacity, sandbox.residualDemand, residualDemandRaw, arrivals);

  // 2026-08-07 — boarding demand NET of what hold nurses actually absorb (`sandbox.holdApplied`,
  // capped at that hour's own medical boarding demand — same capping the rest of the sandbox
  // already uses). This is the boarding that's STILL a claim on ED capacity, so it's what both
  // the boarding paragraph and the per-shift diagnostic below should read as "boarding demand" —
  // otherwise a staffed hold pool would silently go uncredited and boarding would keep reading
  // as if nothing had been done about it.
  const netBoarding168 = useMemo(() => combined.map((v, i) => v - sandbox.holdApplied[i]), [combined, sandbox.holdApplied]);
  const holdCoveredWeeklyHours = sandbox.holdApplied.reduce((a, b) => a + b, 0);
  const remainingBoardingWeeklyHours = netBoarding168.reduce((a, b) => a + b, 0);

  // 2026-08-07 — prose is now a static read of "this staffing," patterned after Panel 1: the
  // Arrivals / Arrivals + Boarding toggle re-scores the SAME selected/edited grids against a
  // different demand curve for the VISUALS only (VisualFrame, the marginal curve, the +/-
  // control), exactly as it already did for `activeStrategy`. It must never change which prose
  // sentences render or what they say. Capacity is ED ONLY here (not ED+hold) — "ahead of/short
  // of arrivals demand alone" only means something measured against the pool that actually
  // serves arrivals; hold's contribution is credited entirely by shrinking the boarding-need
  // curve above (`netBoarding168`), not by adding to the capacity side too, which would double-
  // count it.
  const perShiftDiagnostic = computePerShiftDiagnostic(
    result.hourlyRequirement,
    edGrid,
    sortedShiftMenu,
    result.bandFloorHourly,
    result.bandCeilingHourly,
    netBoarding168
  );

  // §6 — the three-sentence stat pattern (Panel 1/4's own wording). The headline WHPPV/hours
  // figure is ED hours ONLY, mirroring Panel 1's headline (which has no hold-pool concept
  // either) — boarding/hold get their own separate sentences below rather than being blended
  // into the arrivals-facing WHPPV number, matching "Panel 5 alone distinguishes ED nurses from
  // hold nurses" (results-redesign.md).
  const edWeeklyHours = sortedShiftMenu.reduce((acc, s) => acc + Object.keys(edGrid).reduce((a, d) => a + (edGrid[Number(d)]?.[s.id] ?? 0) * s.lengthHours, 0), 0);
  const holdWeeklyHours = sortedShiftMenu.reduce(
    (acc, s) => acc + Object.keys(holdGrid).reduce((a, d) => a + (holdGrid[Number(d)]?.[s.id] ?? 0) * s.lengthHours, 0),
    0
  );
  const avgWhppv = result.annualVisits > 0 ? (edWeeklyHours * 52) / result.annualVisits : 0;
  const { min: minHourlyWhppv, max: maxHourlyWhppv } = hourlyWhppvRange(combinedCapacity168, arrivals);
  const pctBelowFloor = pctHoursBelowFloor(combinedCapacity168, arrivals, band.p25Whppv);
  // Same relative-FTE framing Panel 3/4 use — signed both ways, since this sandbox scenario can
  // land above OR below current staffing.
  const hoursPerFteAnnual = inputs.hoursPerFteAnnual ?? DEFAULTS.hoursPerFteAnnual;
  const currentStaffedWeeklyHours = sortedShiftMenu.reduce(
    (acc, s) =>
      acc + Object.keys(currentStaffingGrid ?? {}).reduce((a, d) => a + (currentStaffingGrid?.[Number(d)]?.[s.id] ?? 0) * s.lengthHours, 0),
    0
  );
  // ED-only comparison against "what you staff today" — apples to apples, since
  // `currentStaffingGrid` has no hold-nurse concept of its own to compare against.
  const fteDelta = ((edWeeklyHours - currentStaffedWeeklyHours) * 52) / hoursPerFteAnnual;
  // Hold's own FTE ask is reported separately, never folded into `fteDelta` above — there's no
  // "current hold staffing" to net it against, it's simply new headcount this scenario adds.
  const holdFteDelta = (holdWeeklyHours * 52) / hoursPerFteAnnual;

  // Boarding paragraph (Panel 1's own wording, extended with hold-nurse awareness) — ED-hours
  // share of the total budget the STILL-UNCOVERED boarding demand consumes (net of whatever hold
  // nurses already absorbed above), and the effective WHPPV once that's netted out of the
  // headline figure above.
  const totalBoardingWeeklyHours = result.boarding?.weeklyBoardingHours ?? 0;
  const pctBoardingCoveredByHold = totalBoardingWeeklyHours > 0 ? (holdCoveredWeeklyHours / totalBoardingWeeklyHours) * 100 : 0;
  const remainingBoardingWhppv = result.annualVisits > 0 ? (remainingBoardingWeeklyHours * 52) / result.annualVisits : 0;
  const remainingBoardingPctOfNursingHours = inputs.wHppvTarget > 0 ? (remainingBoardingWhppv / inputs.wHppvTarget) * 100 : 0;
  const effectiveWhppv = avgWhppv - remainingBoardingWhppv;
  const effectivePosition = effectiveWhppv < band.p25Whppv ? 'below' : effectiveWhppv > band.p75Whppv ? 'above' : 'within';
  const effectivePositionPhrase =
    effectivePosition === 'within' ? 'within the target range' : effectivePosition === 'below' ? 'below the target range' : 'above the target range';

  // Peak-lag sentence (Panel 1's own wording) — arrivals demand vs. ED capacity only, since hold
  // nurses don't serve arrivals and so can't move when "your staffing" peaks for this purpose.
  const avgDemand = averageDay(result.hourlyRequirement);
  const avgEdCapacity = averageDay(edCapacity);
  const peakDemandHour = avgDemand.indexOf(Math.max(...avgDemand));
  const peakCapacityHour = avgEdCapacity.indexOf(Math.max(...avgEdCapacity));
  const rampGap = (peakCapacityHour - peakDemandHour + 24) % 24;

  // §9 — background curve (computed once per toggle change) + a single live dot for the
  // current sandbox schedule, recomputed on every edit/prefill/toggle change since it's derived
  // straight from component state, not memoized against a stale dependency list.
  const totalDemandHours = activeDemand168.reduce((a, b) => a + b, 0);
  const marginalCurvePoints = useMemo(
    () =>
      totalDemandHours > 0
        ? [
            { x: 0, y: 0 },
            ...solveFullCoverageWeekWithTrajectory(activeDemand168, sortedShiftMenu).trajectory.map((p) => ({
              x: p.cumulativeShifts,
              y: Math.max(0, Math.min(100, (p.hoursCovered / totalDemandHours) * 100)),
            })),
          ]
        : [],
    [activeDemand168, sortedShiftMenu, totalDemandHours]
  );
  const liveShiftCount = totalHeadcountUnits(edGrid, sortedShiftMenu) + (toggle === 'combined' ? totalHeadcountUnits(holdGrid, sortedShiftMenu) : 0);
  const livePctCovered = pctDemandCovered(toggle === 'combined' ? combinedCapacity168 : edCapacity, activeDemand168);

  // Current staffing — always plotted alongside the live sandbox dot so the curve always shows
  // where today's real schedule sits, not just whatever the user happens to be editing. Same
  // "Current staffing" label/color Panel 4's curve uses, scored against THIS toggle's own
  // demand curve (arrivals-only or arrivals+boarding), same convention as the live dot above.
  const currentGridForMarker = currentStaffingGrid ?? emptyGrid(sortedShiftMenu);
  const currentShiftCount = totalHeadcountUnits(currentGridForMarker, sortedShiftMenu);
  const currentCapacityForMarker = fullWeekCapacity(currentGridForMarker, sortedShiftMenu);
  const currentPctCovered = pctDemandCovered(currentCapacityForMarker, activeDemand168);
  const liveMarkerPoints = [
    ...(currentShiftCount > 0
      ? [{ x: currentShiftCount, y: currentPctCovered, label: 'Current staffing', color: 'var(--warning)' }]
      : []),
    { x: liveShiftCount, y: livePctCovered, label: 'Your scenario', color: 'var(--accent)' },
  ];

  // §10 — the two +/- controls' underlying candidates. ED: whatever's left of the active
  // demand after both pools' current (capped) contribution. Hold: capped medical-boarding-
  // remaining-after-ED, same capping §5's joint solver uses. 2026-08-06: Add and Remove now
  // both score against this SAME demand curve via the SAME coverage metric
  // (`sum(min(capacity, demand))`, `bestUnitToAdd`/`bestUnitToRemove` in solver.ts) — no
  // separate "requirement"/"protected floor"/backlog concept for removal anymore, which used to
  // make Remove hollow out one shift the trim's severity cost happened to call "cheapest"
  // instead of moving smoothly back down this same curve Add moves up.
  const edResidualDemand168 = useMemo(
    () => activeDemand168.map((d, i) => Math.max(0, d - (toggle === 'combined' ? sandbox.holdApplied[i] : 0))),
    [activeDemand168, toggle, sandbox.holdApplied]
  );
  const holdCandidateDemand168 = useMemo(
    () => medBoarding168.map((m, i) => Math.min(m, Math.max(0, activeDemand168[i] - edCapacity[i]))),
    [medBoarding168, activeDemand168, edCapacity]
  );

  function applyEdDelta(candidate: { day: number; shiftId: string } | null, delta: 1 | -1) {
    if (!candidate) return;
    setEdGrid((prev) => ({
      ...prev,
      [candidate.day]: { ...prev[candidate.day], [candidate.shiftId]: Math.max(0, (prev[candidate.day]?.[candidate.shiftId] ?? 0) + delta) },
    }));
    setHasEdits(true);
  }
  function applyHoldDelta(candidate: { day: number; shiftId: string } | null, delta: 1 | -1) {
    if (!candidate) return;
    setHoldGrid((prev) => ({
      ...prev,
      [candidate.day]: { ...prev[candidate.day], [candidate.shiftId]: Math.max(0, (prev[candidate.day]?.[candidate.shiftId] ?? 0) + delta) },
    }));
    setHasEdits(true);
  }

  // §3d — the single up/down control next to the "Your scenario" marker, REPLACING the old
  // separate "+ Add best ED/hold shift" button rows.
  //   - Under Arrivals, or with either "All ED Nurses" solver cell active (arrivals or combined
  //     target): no separate hold pool exists either way, so this always operates on the ED grid
  //     alone — identical logic to the old addEdUnit/removeEdUnit.
  //   - Under Arrivals + Boarding with any other active strategy: jointly decide whether the
  //     next unit is better spent on ED or hold, by comparing each pool's own best candidate
  //     (bestUnitToAdd/bestUnitToRemove, scored against that pool's own demand curve —
  //     edResidualDemand168 for ED, holdCandidateDemand168 for hold) on the SAME comparable
  //     metric (`candidateCoverageScore` — hours of deficit relieved, or hours of slack for a
  //     removal), and applies whichever pool's candidate scores higher.
  const edOnlyControl = toggle === 'arrivals' || activeStrategy === 'allEd-arrivals' || activeStrategy === 'allEd-combined';

  function incrementScenario() {
    if (edOnlyControl) {
      applyEdDelta(bestUnitToAdd(edGrid, edResidualDemand168, sortedShiftMenu), 1);
      return;
    }
    const edCandidate = bestUnitToAdd(edGrid, edResidualDemand168, sortedShiftMenu);
    const holdCandidate = allowedHoldShiftMenu.length > 0 ? bestUnitToAdd(holdGrid, holdCandidateDemand168, allowedHoldShiftMenu) : null;
    const edShift = edCandidate ? sortedShiftMenu.find((s) => s.id === edCandidate.shiftId) : undefined;
    const holdShift = holdCandidate ? allowedHoldShiftMenu.find((s) => s.id === holdCandidate.shiftId) : undefined;
    const edScore = edCandidate && edShift ? candidateCoverageScore(edCandidate.day, edShift, edCapacity, edResidualDemand168, true) : -1;
    const holdScore = holdCandidate && holdShift ? candidateCoverageScore(holdCandidate.day, holdShift, holdCapacityRaw, holdCandidateDemand168, true) : -1;
    if (edScore < 0 && holdScore < 0) return;
    if (holdScore > edScore) applyHoldDelta(holdCandidate, 1);
    else applyEdDelta(edCandidate, 1);
  }

  function decrementScenario() {
    if (edOnlyControl) {
      applyEdDelta(bestUnitToRemove(edGrid, edResidualDemand168, sortedShiftMenu), -1);
      return;
    }
    const edCandidate = bestUnitToRemove(edGrid, edResidualDemand168, sortedShiftMenu);
    const holdCandidate = bestUnitToRemove(holdGrid, holdCandidateDemand168, allowedHoldShiftMenu);
    const edShift = edCandidate ? sortedShiftMenu.find((s) => s.id === edCandidate.shiftId) : undefined;
    const holdShift = holdCandidate ? allowedHoldShiftMenu.find((s) => s.id === holdCandidate.shiftId) : undefined;
    const edScore = edCandidate && edShift ? candidateCoverageScore(edCandidate.day, edShift, edCapacity, edResidualDemand168, false) : -1;
    const holdScore = holdCandidate && holdShift ? candidateCoverageScore(holdCandidate.day, holdShift, holdCapacityRaw, holdCandidateDemand168, false) : -1;
    if (edScore < 0 && holdScore < 0) return;
    if (holdScore > edScore) applyHoldDelta(holdCandidate, -1);
    else applyEdDelta(edCandidate, -1);
  }

  // Backlog is fundamentally an arrivals-visits concept; boarding has no honest "queue" of its
  // own. `sandbox.queueDepth` runs the NO-COMPRESSION degenerate recurrence over the blended
  // `residualDemand` curve (arrivals + unabsorbed boarding fed in directly) — a flat deficit
  // carry-forward, identical on both toggles by construction, which is the bug this fixes. Same
  // reference shape as Panel1.tsx's "Arrivals + Boarding" toggle / Panel2.tsx's 'combined' view:
  // net boarding's claim on ED capacity out FIRST (hold nurses can't touch arrivals, so only ED
  // capacity is ever available to them — `sandbox.residualDemand - result.hourlyRequirement` is
  // exactly that claim, unabsorbed medical boarding plus all BH boarding), then run the REAL
  // arrivals backlog recurrence (real floorWhppv, real arrivals visits) against what's left.
  const boardingClaimOnEd168 = useMemo(
    () => sandbox.residualDemand.map((r, i) => r - (result.hourlyRequirement[i] ?? 0)),
    [sandbox.residualDemand, result.hourlyRequirement]
  );
  // Combined-toggle heatmap cells net boarding's claim on ED capacity out of `onDuty` before
  // the WHPPV ratio, same reference shape as `combinedQueueDepth`'s own netting just below —
  // hourly EFFECTIVE WHPPV (what's left for arrivals), not the same edCapacity/arrivals ratio
  // the "Arrivals" toggle already shows. Clamped >=0: a negative claim (hold nurses absorbing
  // more than this hour's unmet boarding) shouldn't inflate onDuty for the ratio.
  const cellsCombined = useMemo(
    () => buildCells(edCapacity, sandbox.residualDemand, residualDemandRaw, arrivals, boardingClaimOnEd168.map((v) => Math.max(0, v))),
    [edCapacity, sandbox.residualDemand, residualDemandRaw, arrivals, boardingClaimOnEd168]
  );
  const arrivalsQueueDepth = useMemo(
    () => computeBacklogFromCapacity(edCapacity, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv).backlog,
    [edCapacity, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv]
  );
  const combinedQueueDepth = useMemo(() => {
    const netCapacity = edCapacity.map((c, i) => Math.max(0, c - boardingClaimOnEd168[i]));
    return computeBacklogFromCapacity(netCapacity, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv).backlog;
  }, [edCapacity, boardingClaimOnEd168, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv]);

  // §5b backlog build/peak/clear pattern (Panel 1's own wording), on the same arrivals-only,
  // ED-capacity backlog curve above (`arrivalsQueueDepth`) — see that variable's own comment for
  // why arrivals gets the real recurrence while boarding doesn't. Static, like every other prose
  // stat on this panel now — not read from `combinedQueueDepth` or gated on `toggle`.
  const avgBacklogArrivals = averageDay(arrivalsQueueDepth);
  const avgRequirementArrivals = averageDay(result.hourlyRequirement);
  const wholeWeekPattern = computeQueuePattern(avgBacklogArrivals, avgRequirementArrivals);
  const weekdayPattern = computeQueuePattern(
    averageOverDays(arrivalsQueueDepth, WEEKDAY_DAYS),
    averageOverDays(result.hourlyRequirement, WEEKDAY_DAYS)
  );
  const weekendPattern = computeQueuePattern(
    averageOverDays(arrivalsQueueDepth, WEEKEND_DAYS),
    averageOverDays(result.hourlyRequirement, WEEKEND_DAYS)
  );
  const splitMeaningfully = patternsDifferMeaningfully(weekdayPattern, weekendPattern);

  const views: VisualFrameView[] = [
    {
      key: 'arrivals',
      label: 'Arrivals',
      demand168: result.hourlyRequirement,
      capacity168: edCapacity,
      queueDepth168: arrivalsQueueDepth,
      structuralFloor: null,
      heatmapCells: cellsArrivals,
    },
    {
      key: 'combined',
      label: 'Arrivals + Boarding',
      demand168: combinedRequirement,
      capacity168: combinedCapacity168,
      queueDepth168: combinedQueueDepth,
      structuralFloor: null,
      heatmapCells: cellsCombined,
    },
  ];

  function editCell(setter: typeof setEdGrid, day: number, shiftId: string, value: number) {
    setter((prev) => ({ ...prev, [day]: { ...prev[day], [shiftId]: Math.max(0, value) } }));
    setHasEdits(true);
  }

  function GridEditor({
    grid,
    setter,
    label,
    columns,
    disabledShiftIds,
    deltaBaseline,
  }: {
    grid: Grid;
    setter: typeof setEdGrid;
    label: string;
    columns: ShiftDef[];
    disabledShiftIds?: Set<string>;
    /** §3e — when passed, each cell shows a live `(+N)`/`(−N)` against this baseline grid's
     * same (day, shift) value. ED-only: `currentStaffingGrid`. Skipped for the hold table — no
     * "current hold staffing" baseline exists to diff against. */
    deltaBaseline?: Grid;
  }) {
    return (
      <table className="staffing-grid sandbox-grid">
        <thead>
          <tr>
            <th className="hour-col">{label}</th>
            {columns.map((s) => (
              <th key={s.id}>{s.label || s.id}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DISPLAY_DAY_ORDER.map((day, i) => (
            <tr key={day}>
              <td className="hour-col">{DISPLAY_DAY_LABELS[i]}</td>
              {columns.map((s) => {
                const disabled = disabledShiftIds?.has(s.id) ?? false;
                const value = disabled ? 0 : (grid[day]?.[s.id] ?? 0);
                const delta = deltaBaseline && !disabled ? value - (deltaBaseline[day]?.[s.id] ?? 0) : null;
                return (
                  <td key={s.id}>
                    <span className="sandbox-cell">
                      <input
                        type="number"
                        min={0}
                        disabled={disabled}
                        value={value}
                        onChange={(e) => !disabled && editCell(setter, day, s.id, Number(e.target.value))}
                      />
                      {delta !== null && delta !== 0 && (
                        <span className="sandbox-cell-delta">({delta > 0 ? `+${delta}` : delta})</span>
                      )}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // 2026-08-06 redesign — mechanism (row) x target (column) matrix, replacing the old flat card
  // stack whose OFFERED cards (and, for "Re-allocated"/"Solver Staffing", the underlying compute
  // call each ran) used to change with the page-level toggle. That conflated two separate
  // questions: which starting grid to test (a mechanism, chosen here) vs. which demand to score
  // it against (the toggle, now a pure lens — see `changeToggle`). Every row below is reachable
  // regardless of `toggle`; a target-bearing option bakes its target into its own name instead of
  // reading the ambient toggle. Cells render as a plain "Choose"/"Selected" button, not a
  // repeated paragraph — the one-line row `description` carries the explanation, once.
  // `holdSplit` funds a genuinely separate hold pool, a concept that only exists once boarding
  // is part of what's being covered — combined-only BY DEFINITION, so its button sits under the
  // "Arrivals + Boarding" column only, with the arrivals-only column left blank rather than a
  // disabled cell that implies one could exist. (A "Mixed ED + Hold" row existed briefly and was
  // removed — see the `ActiveStrategy` doc comment above for why it can't work under this model.)
  interface StrategyOption {
    id: ActiveStrategy;
    onClick: () => void;
    disabled?: boolean;
  }
  interface StrategyRow {
    key: string;
    title: string;
    description?: string;
    /** No target split — one button spanning both columns (e.g. "Current Staffing"). */
    span?: StrategyOption;
    arrivals?: StrategyOption;
    combined?: StrategyOption;
  }
  const strategyMatrix: StrategyRow[] = [
    {
      key: 'current',
      title: 'Current Staffing',
      description: 'Exactly what you staff today.',
      span: { id: 'current', onClick: prefillCurrent },
    },
    {
      key: 'reallocated',
      title: 'Re-allocated Current Staffing',
      description: 'Same total hours.',
      arrivals: { id: 'reallocated-arrivals', onClick: prefillReallocatedArrivals },
      combined: { id: 'reallocated-combined', onClick: prefillReallocatedCombined },
    },
    {
      key: 'allEd',
      title: 'ShiftLens Solver — All ED Nurses',
      arrivals: { id: 'allEd-arrivals', onClick: prefillSolverAllEdArrivals },
      combined: { id: 'allEd-combined', onClick: prefillSolverAllEdCombined, disabled: !boarding },
    },
    {
      key: 'holdSplit',
      title: 'ShiftLens Solver — Hold Nurses for Boarding',
      combined: { id: 'holdSplit', onClick: prefillSolverHoldSplit, disabled: !boarding },
    },
  ];

  return (
    <section className="panel panel-5" id="ch-sandbox">
      <div className="panel-columns">
        <div className="panel-words">
          <h2>Test it yourself</h2>

          <p>
            Starting from one of the grids we just went through, test different staffing schedules. Toggle to see
            how this matches demand for just "Arrivals" or "Arrivals + Boarding".
          </p>

          {/* Set BEFORE the matrix below, always visible (not gated by toggle/strategy) — the
              "Hold Nurses for Boarding" mechanism reads this restriction at the moment its
              "Choose" button is clicked, so it needs to already reflect the user's intent
              before that click, not just become visible/adjustable after the fact. */}
          <h3>Which shifts can hold nurses work?</h3>
          <p className="WHPPV-caveat hold-shift-caveat">(Hold nurses can only cover boarding demand.)</p>
          <div className="flex-axes">
            {sortedShiftMenu.map((s) => (
              <label key={s.id} className="flex-axis-option">
                <input type="checkbox" checked={allowedHoldShiftIds.has(s.id)} onChange={() => toggleHoldShift(s.id)} />
                <span>{s.label || s.id}</span>
              </label>
            ))}
          </div>

          <div className="strategy-matrix">
            <div className="strategy-matrix-header">
              <span />
              <span>Arrivals only</span>
              <span>Arrivals + Boarding</span>
            </div>
            {strategyMatrix.map((row) => {
              function renderOption(option: StrategyOption, target: 'arrivals' | 'combined' | null) {
                const isActive = activeStrategy === option.id;
                // Once you've hand-edited the grid (GridEditor or the +/- control) away from
                // the strategy you clicked, "Selected" would be lying about what's on screen —
                // this cell becomes "Reset" instead, offering to re-apply the original starting
                // point. Same active color, outline instead of filled, so it still reads as
                // "this is the one you picked" without claiming the grid still matches it.
                const isDirty = isActive && hasEdits;
                const label =
                  target === null ? row.title : `${row.title} — ${target === 'arrivals' ? 'Arrivals only' : 'Arrivals + Boarding'}`;
                const ariaLabel = isDirty ? `${label} — reset to this starting point` : label;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={ariaLabel}
                    className={`strategy-cell${isActive ? (isDirty ? ' strategy-cell-dirty' : ' strategy-cell-active') : ''}`}
                    onClick={option.onClick}
                    disabled={option.disabled}
                  >
                    {isActive ? (isDirty ? 'Reset' : 'Selected') : 'Choose'}
                  </button>
                );
              }
              return (
                <div className="strategy-matrix-row" key={row.key}>
                  <div className="strategy-matrix-row-label">
                    <span className="strategy-matrix-row-title">{row.title}</span>
                    {row.description && <span className="strategy-matrix-row-description">{row.description}</span>}
                  </div>
                  {row.span ? (
                    <span className="strategy-matrix-cell strategy-matrix-cell-span">{renderOption(row.span, null)}</span>
                  ) : row.arrivals && row.combined ? (
                    <>
                      <span className="strategy-matrix-cell">{renderOption(row.arrivals, 'arrivals')}</span>
                      <span className="strategy-matrix-cell">{renderOption(row.combined, 'combined')}</span>
                    </>
                  ) : (
                    <>
                      <span className="strategy-matrix-cell" />
                      <span className="strategy-matrix-cell">{row.combined ? renderOption(row.combined, null) : null}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {marginalCurvePoints.length >= 2 && (
            <div className="marginal-curve-wrap">
              <MarginalReturnsCurve
                points={marginalCurvePoints}
                band={null}
                markerPoints={liveMarkerPoints}
                adjustControl={{ onIncrement: incrementScenario, onDecrement: decrementScenario }}
              />
            </div>
          )}

          <h3>ED nurses</h3>
          <GridEditor grid={edGrid} setter={setEdGrid} label="ED" columns={sortedShiftMenu} deltaBaseline={currentStaffingGrid ?? undefined} />

          {/* Always visible, regardless of toggle or selected strategy — hold nurses can be
              staffed and tested even under the Arrivals-only toggle, they just don't cover
              arrivals demand, so adding them won't change that toggle's visuals. */}
          <h3>Hold nurses</h3>
          <GridEditor
            grid={holdGrid}
            setter={setHoldGrid}
            label="Hold"
            columns={sortedShiftMenu}
            disabledShiftIds={new Set(sortedShiftMenu.filter((s) => !allowedHoldShiftIds.has(s.id)).map((s) => s.id))}
          />

          <p className="comparison-headline">
            This staffing realizes <strong>{avgWhppv.toFixed(2)} WHPPV</strong> at{' '}
            <strong>{edWeeklyHours.toFixed(0)} hours/week</strong>.
            {currentStaffedWeeklyHours > 0 &&
              (Math.abs(fteDelta) < 0.05 ? (
                ' — the same FTE as you staff today.'
              ) : (
                <>
                  {' '}
                  — <strong>{Math.abs(fteDelta).toFixed(1)} FTE</strong> {fteDelta >= 0 ? 'above' : 'below'} what you
                  staff today.
                </>
              ))}
            {holdWeeklyHours > 0 && (
              <>
                {' '}
                Hold nurses call for an additional <strong>{holdFteDelta.toFixed(1)} FTE</strong>.
              </>
            )}
          </p>
          {minHourlyWhppv && maxHourlyWhppv && (
            <p>
              Hour to hour, WHPPV ranges from <strong>{minHourlyWhppv.value.toFixed(2)}</strong> (
              {DAY_LABELS[minHourlyWhppv.day]} {fmtHour(minHourlyWhppv.hour)}) up to{' '}
              <strong>{maxHourlyWhppv.value.toFixed(2)}</strong> ({DAY_LABELS[maxHourlyWhppv.day]}{' '}
              {fmtHour(maxHourlyWhppv.hour)}). <strong>{pctBelowFloor.toFixed(0)}%</strong> of hours fall below your
              peer-typical range.
            </p>
          )}

          {result.boarding && (
            <p>
              On average, boarding demands <strong>{totalBoardingWeeklyHours.toFixed(0)} hours/week</strong>
              {holdCoveredWeeklyHours >= 0.5 ? (
                <>
                  , <strong>{pctBoardingCoveredByHold.toFixed(0)}%</strong> of which is covered by hold nurses. The
                  remaining <strong>{remainingBoardingWeeklyHours.toFixed(0)} hours</strong> is{' '}
                </>
              ) : (
                ', '
              )}
              <strong>{remainingBoardingPctOfNursingHours.toFixed(0)}%</strong> of your department's total nursing
              hours, and the equivalent of <strong>{remainingBoardingWhppv.toFixed(2)} WHPPV</strong>. Said
              differently, effective WHPPV after accounting for boarding is{' '}
              <strong>{effectiveWhppv.toFixed(2)}</strong>, {effectivePositionPhrase} for a department of your size.
            </p>
          )}

          {perShiftDiagnostic.groups.map((group) => (
            <p key={group.shiftIds.join('-')}>{shiftDiagnosticSentence(group)}</p>
          ))}

          <p>
            On an average day, demand peaks around <strong>{fmtHour(peakDemandHour)}</strong>, but your staffing
            doesn't peak until <strong>{fmtHour(peakCapacityHour)}</strong>
            {rampGap > 0 ? ` — roughly a ${rampGap}-hour lag` : ' — no lag'}.
          </p>

          {splitMeaningfully ? (
            <>
              <p>{queuePatternSentence(weekdayPattern, 'On weekdays, ', result.floorWhppv)}</p>
              <p>{queuePatternSentence(weekendPattern, 'On weekends, ', result.floorWhppv)}</p>
            </>
          ) : (
            <p>{queuePatternSentence(wholeWeekPattern, 'Based on your schedule, ', result.floorWhppv)}</p>
          )}
        </div>
        <div className="panel-frame">
          <VisualFrame
            views={views}
            shiftMenu={sortedShiftMenu}
            whppvBand={whppvBand}
            activeKey={toggle}
            onActiveKeyChange={(k) => changeToggle(k as Toggle)}
          />
        </div>
      </div>
    </section>
  );
}
