import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { ShiftDef, Grid } from '../../engine/types';
import { DAY_LABELS } from '../../engine/types';
import { fullWeekCapacity, solveFullCoverageWeekWithTrajectory, bestUnitToAdd, bestUnitToRemove, shiftGlobalHours } from '../../engine/solver';
import { recommendWeeklyBoardingGrid, weeklyArrivalsSpareByCell } from '../../engine/boarding';
import {
  computeScenarioB,
  computeCombinedReallocation,
  computeBacklogFromCapacity,
  computePerShiftDiagnostic,
  solveEdHoldJointCoverage,
  NO_COMPRESSION_FLOOR_WHPPV,
} from '../../engine';
import { lookupWhppvBand } from '../../lib/edbaLookup';
import { computeColorDomain } from '../../lib/whppvColorDomain';
import { computeSandbox } from '../../engine/sandbox';
import { fmtHour } from '../../lib/queuePattern';
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

function buildCells(onDuty168: number[], requirement168: number[], arrivals168: number[]): WhppvHeatmapCell[] {
  const cells: WhppvHeatmapCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const g = day * 24 + hour;
      cells.push({
        day,
        hour,
        onDuty: onDuty168[g] ?? 0,
        requirement: requirement168[g] ?? 0,
        arrivals: arrivals168[g] ?? 0,
        belowFloor: false,
        riskReasons: [],
      });
    }
  }
  return cells;
}

/** Local copy of the same per-panel helper Panel 1/2/4 each keep their own copy of (repo
 * convention — see those files' own copies) — % of hours (arrivals > 0 only) whose realized
 * wHPPV falls below the peer cohort's p25 floor. */
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

/** 2026-08-05 redesign, §3c — which starting-point card was last clicked. Tracked separately
 * from the grids themselves so the UI can highlight the active card without re-deriving it from
 * grid contents (which a hand-edit would make ambiguous anyway). Reset to 'current' on toggle
 * change; a manual `GridEditor` edit deliberately leaves it untouched — see `editCell` below,
 * which never touches this state. */
type ActiveStrategy = 'current' | 'reallocated' | 'allEd' | 'holdSplit' | 'mixed';

/** Hours of deficit (or, for a remove candidate, hours of slack) a single (day, shift) unit
 * covers against a demand curve — the SAME scoring `solver.ts`'s internal `bestAddCandidate`/
 * `bestCutCandidate` already use, re-derived here (not exported, both are file-private) so §3d's
 * joint ED-vs-hold control can compare a candidate from EACH pool on one common, comparable
 * metric. `wantDeficit=true` scores "how much this unit would relieve" (for add); `false` scores
 * "how much slack this unit already sits on" (for remove — the more slack, the safer/cheaper the
 * cut). JUDGMENT CALL, flagged: comparing two differently-scaled pools (ED vs. hold) by raw
 * hours-covered rather than a cost-normalized metric can favor whichever pool's best shift
 * happens to be longer; deemed acceptable for a single-step advisory control, not a solver
 * objective — revisit if it visibly favors one pool over the other in practice.
 */
function candidateCoverageScore(day: number, shift: ShiftDef, capacity168: number[], demand168: number[], wantDeficit: boolean): number {
  const hours = shiftGlobalHours(day, shift);
  return hours.filter((g) => (wantDeficit ? capacity168[g] < (demand168[g] ?? 0) : capacity168[g] >= (demand168[g] ?? 0))).length;
}

/**
 * PANEL 5 REDESIGN (2026-08-05, planned in Cowork) — "Test it yourself." REPLACES the prior
 * two-grids/two-pools-always-visible build (PR G of RESULTS_PAGE_V2_SPEC_2026-07-27.md §5.4).
 * See .claude/rules/results-redesign.md's dated 2026-08-05 section for the full architecture.
 *
 * Governing change: an Arrivals / Arrivals + Boarding toggle (same `VisualFrame` controlled-
 * toggle pattern Panels 1/2/4 already use) now drives EVERYTHING on the panel — which demand
 * curve scores every stat/curve, which starting-point cards render, and whether the hold-
 * nurse grid/table/shift-restriction row exist at all (fully unmounted under Arrivals, not
 * just zeroed).
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
  function changeToggle(next: Toggle) {
    setToggle(next);
    setActiveStrategy('current');
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

  // §3 — starting-point cards, per toggle. Each sets `activeStrategy` itself (never `editCell`,
  // which is what keeps a manual grid edit from silently changing which card reads as active).
  function prefillCurrent() {
    setEdGrid(currentStaffingGrid ? { ...currentStaffingGrid } : emptyGrid(sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
    setActiveStrategy('current');
  }
  function prefillReallocatedArrivals() {
    const scenarioB = currentStaffingGrid ? computeScenarioB(result, inputs, currentStaffingGrid) : null;
    setEdGrid(scenarioB ? { ...scenarioB.grid } : currentStaffingGrid ? { ...currentStaffingGrid } : emptyGrid(sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
    setActiveStrategy('reallocated');
  }
  function prefillReallocatedCombined() {
    const combinedRealloc = currentStaffingGrid ? computeCombinedReallocation(result, inputs, currentStaffingGrid) : null;
    setEdGrid(combinedRealloc ? { ...combinedRealloc.grid } : currentStaffingGrid ? { ...currentStaffingGrid } : emptyGrid(sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
    setActiveStrategy('reallocated');
  }
  function prefillSolverArrivals() {
    setEdGrid({ ...result.grid });
    setHoldGrid(emptyGrid(sortedShiftMenu));
    setActiveStrategy('allEd');
  }
  function prefillSolverAllEd() {
    setEdGrid(sumGrids(result.grid, boardingGridAllEd, sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
    setActiveStrategy('allEd');
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
  }
  // §3b — NEW: joint ED+hold full-coverage solve (`edHoldSolve.ts`, previously unused by any
  // Panel 5 button — see .claude/rules/engine-solver.md's now-updated note). Solved from
  // scratch against BOTH pools at once, restricted to whichever shifts hold nurses are allowed
  // to work — its total will generally NOT match either `prefillSolverAllEd`'s or
  // `prefillSolverHoldSplit`'s total, since those solve ED alone (or ED alone plus a
  // separately-solved hold grid) rather than jointly.
  function prefillSolverMixed() {
    const { edGrid: mixedEd, holdGrid: mixedHold } = solveEdHoldJointCoverage(
      combinedRequirement,
      medBoarding168,
      sortedShiftMenu,
      allowedHoldShiftMenu
    );
    setEdGrid(mixedEd);
    setHoldGrid(mixedHold);
    setActiveStrategy('mixed');
  }

  // §5/§6/§9 — the current sandbox test schedule's own combined ED+hold picture.
  const edCapacity = fullWeekCapacity(edGrid, sortedShiftMenu);
  const holdCapacityRaw = fullWeekCapacity(holdGrid, sortedShiftMenu);
  const sandbox = computeSandbox(result.hourlyRequirement, medBoarding168, bhBoarding168, arrivals, edCapacity, holdCapacityRaw);
  // The combined ED+hold capacity this staffing actually delivers — ED capacity plus hold's
  // capped contribution (never more than that hour's own medical boarding demand, per §5's
  // capping convention, same as `computeSandbox`'s `holdApplied`).
  const combinedCapacity168 = useMemo(() => edCapacity.map((v, i) => v + sandbox.holdApplied[i]), [edCapacity, sandbox.holdApplied]);

  const cells = buildCells(edCapacity, sandbox.residualDemand, arrivals);
  const holdSurplusTotal = sandbox.holdSurplus.reduce((a, b) => a + b, 0);

  // Same per-shift diagnostic Panel 1/2/4 show (§4, engine/hiddenBoarding.ts), REPLACING the
  // old single "Hours below need this week" aggregate — that number blended ED and hold
  // shortfall into one figure with no sense of WHICH shift is short or by how much; the
  // per-shift sentences say that directly. Scored against the total staffed grid (ED + hold
  // together — both are real, paid-for hours) under Arrivals + Boarding, ED alone under
  // Arrivals (hold isn't part of that toggle's own story); boarding only folds in under
  // 'combined', matching that toggle's own demand curve.
  const diagnosticGrid = toggle === 'combined' ? sumGrids(edGrid, holdGrid, sortedShiftMenu) : edGrid;
  const perShiftDiagnostic = computePerShiftDiagnostic(
    result.hourlyRequirement,
    diagnosticGrid,
    sortedShiftMenu,
    result.bandFloorHourly,
    result.bandCeilingHourly,
    toggle === 'combined' ? combined : null
  );

  // §6 — the three-sentence stat pattern (Panel 1/4's own wording), scored against this
  // staffing's actual scheduled hours (ED + hold combined — both pools are real, paid-for
  // hours) and the combined ED+hold capacity curve above.
  const edWeeklyHours = sortedShiftMenu.reduce((acc, s) => acc + Object.keys(edGrid).reduce((a, d) => a + (edGrid[Number(d)]?.[s.id] ?? 0) * s.lengthHours, 0), 0);
  const holdWeeklyHours =
    toggle === 'combined'
      ? sortedShiftMenu.reduce((acc, s) => acc + Object.keys(holdGrid).reduce((a, d) => a + (holdGrid[Number(d)]?.[s.id] ?? 0) * s.lengthHours, 0), 0)
      : 0;
  const totalWeeklyHours = edWeeklyHours + holdWeeklyHours;
  const avgWhppv = result.annualVisits > 0 ? (totalWeeklyHours * 52) / result.annualVisits : 0;
  const { min: minHourlyWhppv, max: maxHourlyWhppv } = hourlyWhppvRange(combinedCapacity168, arrivals);
  const pctBelowFloor = pctHoursBelowFloor(combinedCapacity168, arrivals, band.p25Whppv);

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
  // remaining-after-ED, same capping §5's joint solver uses. JUDGMENT CALL, flagged: removal
  // needs a "requirement"/"protected floor" curve to score against; under the Arrivals +
  // Boarding toggle there's no honest visits-based protected floor for a blended demand curve
  // (same reasoning Panel 2's 'combined' branch already documents), so removal there scores
  // against the combined demand curve itself with zero floor protection and the NO_COMPRESSION
  // degenerate case, rather than inventing a new protected-floor concept for blended demand.
  const edResidualDemand168 = useMemo(
    () => activeDemand168.map((d, i) => Math.max(0, d - (toggle === 'combined' ? sandbox.holdApplied[i] : 0))),
    [activeDemand168, toggle, sandbox.holdApplied]
  );
  const holdCandidateDemand168 = useMemo(
    () => medBoarding168.map((m, i) => Math.min(m, Math.max(0, activeDemand168[i] - edCapacity[i]))),
    [medBoarding168, activeDemand168, edCapacity]
  );
  const zero168 = useMemo(() => new Array(168).fill(0), []);

  function applyEdDelta(candidate: { day: number; shiftId: string } | null, delta: 1 | -1) {
    if (!candidate) return;
    setEdGrid((prev) => ({
      ...prev,
      [candidate.day]: { ...prev[candidate.day], [candidate.shiftId]: Math.max(0, (prev[candidate.day]?.[candidate.shiftId] ?? 0) + delta) },
    }));
  }
  function applyHoldDelta(candidate: { day: number; shiftId: string } | null, delta: 1 | -1) {
    if (!candidate) return;
    setHoldGrid((prev) => ({
      ...prev,
      [candidate.day]: { ...prev[candidate.day], [candidate.shiftId]: Math.max(0, (prev[candidate.day]?.[candidate.shiftId] ?? 0) + delta) },
    }));
  }

  // §3d — the single up/down control next to the "Your scenario" marker, REPLACING the old
  // separate "+ Add best ED/hold shift" button rows.
  //   - Under Arrivals, or under Arrivals + Boarding with the "All ED Nurses" solver card
  //     active: no separate hold pool exists either way, so this always operates on the ED grid
  //     alone — identical logic to the old addEdUnit/removeEdUnit.
  //   - Under Arrivals + Boarding with any other active strategy: jointly decide whether the
  //     next unit is better spent on ED or hold, by comparing each pool's own best candidate
  //     (bestUnitToAdd/bestUnitToRemove, scored against that pool's own demand curve —
  //     edResidualDemand168 for ED, holdCandidateDemand168 for hold) on the SAME comparable
  //     metric (`candidateCoverageScore` — hours of deficit relieved, or hours of slack for a
  //     removal), and applies whichever pool's candidate scores higher.
  const edOnlyControl = toggle === 'arrivals' || activeStrategy === 'allEd';

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
      const requirement168 = toggle === 'arrivals' ? result.hourlyRequirement : combinedRequirement;
      const protectedFloor168 = toggle === 'arrivals' ? result.protectedFloorHourly : zero168;
      const volatility168 = toggle === 'arrivals' ? result.demandVolatilityHourly : zero168;
      const recurrenceArrivals168 = toggle === 'arrivals' ? arrivals : combinedRequirement;
      const floorWhppv = toggle === 'arrivals' ? result.floorWhppv : NO_COMPRESSION_FLOOR_WHPPV;
      applyEdDelta(bestUnitToRemove(edGrid, requirement168, protectedFloor168, volatility168, recurrenceArrivals168, floorWhppv, sortedShiftMenu), -1);
      return;
    }
    const edCandidate = bestUnitToRemove(
      edGrid,
      edResidualDemand168,
      zero168,
      zero168,
      edResidualDemand168,
      NO_COMPRESSION_FLOOR_WHPPV,
      sortedShiftMenu
    );
    const holdCandidate = bestUnitToRemove(
      holdGrid,
      holdCandidateDemand168,
      zero168,
      zero168,
      holdCandidateDemand168,
      NO_COMPRESSION_FLOOR_WHPPV,
      allowedHoldShiftMenu
    );
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
  const arrivalsQueueDepth = useMemo(
    () => computeBacklogFromCapacity(edCapacity, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv).backlog,
    [edCapacity, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv]
  );
  const combinedQueueDepth = useMemo(() => {
    const netCapacity = edCapacity.map((c, i) => Math.max(0, c - boardingClaimOnEd168[i]));
    return computeBacklogFromCapacity(netCapacity, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv).backlog;
  }, [edCapacity, boardingClaimOnEd168, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv]);

  const views: VisualFrameView[] = [
    {
      key: 'arrivals',
      label: 'Arrivals',
      demand168: result.hourlyRequirement,
      capacity168: edCapacity,
      queueDepth168: arrivalsQueueDepth,
      structuralFloor: null,
      heatmapCells: cells,
    },
    {
      key: 'combined',
      label: 'Arrivals + Boarding',
      demand168: combinedRequirement,
      capacity168: combinedCapacity168,
      queueDepth168: combinedQueueDepth,
      structuralFloor: null,
      heatmapCells: cells,
    },
  ];

  function editCell(setter: typeof setEdGrid, day: number, shiftId: string, value: number) {
    setter((prev) => ({ ...prev, [day]: { ...prev[day], [shiftId]: Math.max(0, value) } }));
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

  // §3a — stacked starting-point cards, per toggle. Each card pre-fills `sandboxEdGrid`/
  // `sandboxHoldGrid` — a STARTING point, not a lock-in; every card's description says so, and
  // `GridEditor` stays fully hand-editable afterward. "Re-allocated Current Staffing" carries
  // different description text per toggle (§3a) since it calls a genuinely different function —
  // `computeScenarioB` (arrivals-only) under Arrivals, `computeCombinedReallocation` (considers
  // boarding too) under Arrivals + Boarding.
  interface StrategyCard {
    id: ActiveStrategy;
    title: string;
    description: string;
    onClick: () => void;
    disabled?: boolean;
  }
  const strategyCards: StrategyCard[] =
    toggle === 'arrivals'
      ? [
          {
            id: 'current',
            title: 'Current Staffing',
            description: 'Starts from what you actually staff today, exactly as entered in the comparison grid above.',
            onClick: prefillCurrent,
          },
          {
            id: 'reallocated',
            title: 'Re-allocated Current Staffing',
            description:
              'Starts from your same current total hours, moved to better match arrivals demand alone — same hours, different placement.',
            onClick: prefillReallocatedArrivals,
          },
          {
            id: 'allEd',
            title: 'ShiftLens Solver Staffing',
            description: "Starts from the ShiftLens Solver's own recommended ED staffing — the same grid the solver panel above recommends.",
            onClick: prefillSolverArrivals,
          },
        ]
      : [
          {
            id: 'current',
            title: 'Current Staffing',
            description: 'Starts from what you actually staff today, exactly as entered in the comparison grid above.',
            onClick: prefillCurrent,
          },
          {
            id: 'reallocated',
            title: 'Re-allocated Current Staffing',
            description:
              "Starts from your same current total hours, moved to better match arrivals AND boarding together — a different placement than the arrivals-only version, since it also weighs boarding's demand.",
            onClick: prefillReallocatedCombined,
          },
          {
            id: 'allEd',
            title: 'ShiftLens Solver Staffing (All ED Nurses)',
            description: 'Starts from the recommended ED + boarding coverage, all funded as ED nurses — no separate hold pool.',
            onClick: prefillSolverAllEd,
            disabled: !boarding,
          },
          {
            id: 'holdSplit',
            title: 'ShiftLens Solver Staffing (Hold Nurses for Boarding)',
            description:
              'Starts from the recommended ED staffing plus a SEPARATE hold-nurse grid funded to cover boarding — split into two pools instead of one.',
            onClick: prefillSolverHoldSplit,
            disabled: !boarding,
          },
          {
            id: 'mixed',
            title: 'ShiftLens Solver Staffing (Mixed ED + Hold)',
            description:
              "Jointly solves ED and hold staffing together, from scratch, to cover arrivals + boarding split across both pools. Its total will generally not match \"All ED Nurses\" or \"Hold Nurses for Boarding\" above — this is a different solve, not a rounding difference.",
            onClick: prefillSolverMixed,
            disabled: !boarding,
          },
        ];

  return (
    <section className="panel panel-5" id="ch-sandbox">
      <div className="panel-columns">
        <div className="panel-words">
          <h2>Test it yourself</h2>

          <div className="strategy-cards">
            {strategyCards.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-label={c.title}
                className={`strategy-card${activeStrategy === c.id ? ' strategy-card-active' : ''}`}
                onClick={c.onClick}
                disabled={c.disabled}
              >
                <span className="strategy-card-title">{c.title}</span>
                <span className="strategy-card-description">{c.description}</span>
              </button>
            ))}
          </div>
          <p className="strategy-cards-note">
            Each card is a starting point — it pre-fills the grid(s) below, which you can still hand-edit afterward.
          </p>

          <p className="comparison-headline">
            This staffing realizes <strong>{avgWhppv.toFixed(2)} wHPPV</strong> at{' '}
            <strong>{totalWeeklyHours.toFixed(0)} hours/week</strong>.
          </p>
          {minHourlyWhppv && maxHourlyWhppv && (
            <p>
              Hour to hour, wHPPV ranges from <strong>{minHourlyWhppv.value.toFixed(2)}</strong> (
              {DAY_LABELS[minHourlyWhppv.day]} {fmtHour(minHourlyWhppv.hour)}) up to{' '}
              <strong>{maxHourlyWhppv.value.toFixed(2)}</strong> ({DAY_LABELS[maxHourlyWhppv.day]}{' '}
              {fmtHour(maxHourlyWhppv.hour)}). <strong>{pctBelowFloor.toFixed(0)}%</strong> of hours fall below your
              peer-typical floor.
            </p>
          )}

          {perShiftDiagnostic.groups.map((group) => (
            <p key={group.shiftIds.join('-')}>{shiftDiagnosticSentence(group)}</p>
          ))}

          {toggle === 'combined' && (
            <p>
              {holdSurplusTotal >= 0.5 ? (
                <>
                  Hold-nurse surplus: <strong>{holdSurplusTotal.toFixed(0)} hours</strong> — hold nurses staffed
                  against medical boarders who aren't there. This is a real finding, not a rounding error: hold
                  nurses can't help with BH boarders or arrivals, so surplus hold capacity just sits idle while
                  other hours may still run short.
                </>
              ) : (
                'No hold-nurse surplus in this scenario.'
              )}
            </p>
          )}

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

          {toggle === 'combined' && (
            <>
              <h3>Which shifts can hold nurses work?</h3>
              <div className="flex-axes">
                {sortedShiftMenu.map((s) => (
                  <label key={s.id} className="flex-axis-option">
                    <input type="checkbox" checked={allowedHoldShiftIds.has(s.id)} onChange={() => toggleHoldShift(s.id)} />
                    <span>{s.label || s.id}</span>
                  </label>
                ))}
              </div>

              <h3>Hold nurses</h3>
              <GridEditor
                grid={holdGrid}
                setter={setHoldGrid}
                label="Hold"
                columns={sortedShiftMenu}
                disabledShiftIds={new Set(sortedShiftMenu.filter((s) => !allowedHoldShiftIds.has(s.id)).map((s) => s.id))}
              />
            </>
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
