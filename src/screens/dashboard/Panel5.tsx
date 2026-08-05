import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { ShiftDef, Grid } from '../../engine/types';
import { DAY_LABELS } from '../../engine/types';
import { fullWeekCapacity, solveFullCoverageWeekWithTrajectory, bestUnitToAdd, bestUnitToRemove } from '../../engine/solver';
import { recommendWeeklyBoardingGrid } from '../../engine/boarding';
import { computeScenarioB, computeCombinedReallocation, NO_COMPRESSION_FLOOR_WHPPV } from '../../engine';
import { solveEdHoldJointCoverage } from '../../engine/edHoldSolve';
import { lookupWhppvBand } from '../../lib/edbaLookup';
import { computeSandbox } from '../../engine/sandbox';
import { fmtHour } from '../../lib/queuePattern';
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
        bandFloor: requirement168[g] ?? 0,
        bandCeiling: requirement168[g] ?? 0,
        whppv: null,
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

/**
 * PANEL 5 REDESIGN (2026-08-05, planned in Cowork) — "Test it yourself." REPLACES the prior
 * two-grids/two-pools-always-visible build (PR G of RESULTS_PAGE_V2_SPEC_2026-07-27.md §5.4).
 * See .claude/rules/results-redesign.md's dated 2026-08-05 section for the full architecture.
 *
 * Governing change: an Arrivals / Arrivals + Boarding toggle (same `VisualFrame` controlled-
 * toggle pattern Panels 1/2/4 already use) now drives EVERYTHING on the panel — which demand
 * curve scores every stat/curve, which starting-point buttons render, and whether the hold-
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
  const boardingCurve = boarding?.cellBoardingRnHours ?? null;
  const combinedRequirement = useMemo(
    () => result.hourlyRequirement.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0)),
    [result.hourlyRequirement, boardingCurve]
  );
  const activeDemand168 = toggle === 'arrivals' ? result.hourlyRequirement : combinedRequirement;

  const boardingGridAllEd =
    boarding && result.lostProductivity
      ? recommendWeeklyBoardingGrid(boarding, sortedShiftMenu, inputs.wHppvTarget, band.p25Whppv, result.lostProductivity.wHppvConsumedByBoarding)
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

  // §3 — starting-point buttons, per toggle.
  function prefillCurrent() {
    setEdGrid(currentStaffingGrid ? { ...currentStaffingGrid } : emptyGrid(sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
  }
  function prefillReallocatedArrivals() {
    const scenarioB = currentStaffingGrid ? computeScenarioB(result, inputs, currentStaffingGrid) : null;
    setEdGrid(scenarioB ? { ...scenarioB.grid } : currentStaffingGrid ? { ...currentStaffingGrid } : emptyGrid(sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
  }
  function prefillReallocatedCombined() {
    const combinedRealloc = currentStaffingGrid ? computeCombinedReallocation(result, inputs, currentStaffingGrid) : null;
    setEdGrid(combinedRealloc ? { ...combinedRealloc.grid } : currentStaffingGrid ? { ...currentStaffingGrid } : emptyGrid(sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
  }
  function prefillSolverArrivals() {
    setEdGrid({ ...result.grid });
    setHoldGrid(emptyGrid(sortedShiftMenu));
  }
  function prefillSolverAllEd() {
    setEdGrid(sumGrids(result.grid, boardingGridAllEd, sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
  }
  function prefillSolverHoldSplit() {
    const { edGrid: solvedEd, holdGrid: solvedHold } = solveEdHoldJointCoverage(
      combinedRequirement,
      medBoarding168,
      sortedShiftMenu,
      allowedHoldShiftMenu
    );
    setEdGrid(solvedEd);
    setHoldGrid(solvedHold);
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
  const unmetTotal = sandbox.unmet.reduce((a, b) => a + b, 0);

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
  const liveMarkerPoints = [{ x: liveShiftCount, y: livePctCovered, label: 'Your scenario', color: 'var(--accent)' }];

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

  function addEdUnit() {
    const candidate = bestUnitToAdd(edGrid, edResidualDemand168, sortedShiftMenu);
    if (candidate) setEdGrid((prev) => ({ ...prev, [candidate.day]: { ...prev[candidate.day], [candidate.shiftId]: (prev[candidate.day]?.[candidate.shiftId] ?? 0) + 1 } }));
  }
  function removeEdUnit() {
    const requirement168 = toggle === 'arrivals' ? result.hourlyRequirement : combinedRequirement;
    const protectedFloor168 = toggle === 'arrivals' ? result.protectedFloorHourly : zero168;
    const volatility168 = toggle === 'arrivals' ? result.demandVolatilityHourly : zero168;
    const recurrenceArrivals168 = toggle === 'arrivals' ? arrivals : combinedRequirement;
    const floorWhppv = toggle === 'arrivals' ? result.floorWhppv : NO_COMPRESSION_FLOOR_WHPPV;
    const candidate = bestUnitToRemove(edGrid, requirement168, protectedFloor168, volatility168, recurrenceArrivals168, floorWhppv, sortedShiftMenu);
    if (candidate) setEdGrid((prev) => ({ ...prev, [candidate.day]: { ...prev[candidate.day], [candidate.shiftId]: Math.max(0, (prev[candidate.day]?.[candidate.shiftId] ?? 0) - 1) } }));
  }
  function addHoldUnit() {
    const candidate = bestUnitToAdd(holdGrid, holdCandidateDemand168, allowedHoldShiftMenu);
    if (candidate) setHoldGrid((prev) => ({ ...prev, [candidate.day]: { ...prev[candidate.day], [candidate.shiftId]: (prev[candidate.day]?.[candidate.shiftId] ?? 0) + 1 } }));
  }
  function removeHoldUnit() {
    const candidate = bestUnitToRemove(holdGrid, medBoarding168, zero168, zero168, medBoarding168, NO_COMPRESSION_FLOOR_WHPPV, allowedHoldShiftMenu);
    if (candidate) setHoldGrid((prev) => ({ ...prev, [candidate.day]: { ...prev[candidate.day], [candidate.shiftId]: Math.max(0, (prev[candidate.day]?.[candidate.shiftId] ?? 0) - 1) } }));
  }

  const views: VisualFrameView[] = [
    {
      key: 'arrivals',
      label: 'Arrivals',
      demand168: result.hourlyRequirement,
      capacity168: edCapacity,
      queueDepth168: sandbox.queueDepth,
      structuralFloor: null,
      heatmapCells: cells,
    },
    {
      key: 'combined',
      label: 'Arrivals + Boarding',
      demand168: combinedRequirement,
      capacity168: combinedCapacity168,
      queueDepth168: sandbox.queueDepth,
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
  }: {
    grid: Grid;
    setter: typeof setEdGrid;
    label: string;
    columns: ShiftDef[];
    disabledShiftIds?: Set<string>;
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
                return (
                  <td key={s.id}>
                    <input
                      type="number"
                      min={0}
                      disabled={disabled}
                      value={disabled ? 0 : grid[day]?.[s.id] ?? 0}
                      onChange={(e) => !disabled && editCell(setter, day, s.id, Number(e.target.value))}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <section className="panel panel-5" id="ch-sandbox">
      <div className="panel-columns">
        <div className="panel-words">
          <h2>Test it yourself</h2>

          <div className="button-row">
            <button className="btn-secondary" onClick={prefillCurrent}>
              Current Staffing
            </button>
            <button className="btn-secondary" onClick={toggle === 'arrivals' ? prefillReallocatedArrivals : prefillReallocatedCombined}>
              Re-allocated Current Staffing
            </button>
            {toggle === 'arrivals' ? (
              <button className="btn-secondary" onClick={prefillSolverArrivals}>
                ShiftLens Solver Staffing
              </button>
            ) : (
              <>
                <button className="btn-secondary" onClick={prefillSolverAllEd}>
                  ShiftLens Solver Staffing (All ED Nurses)
                </button>
                <button className="btn-secondary" onClick={prefillSolverHoldSplit} disabled={!boarding}>
                  ShiftLens Solver Staffing (Hold Nurses for Boarding)
                </button>
              </>
            )}
          </div>

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

          <p>
            Hours below need this week: <strong>{unmetTotal.toFixed(0)}</strong>.{' '}
            {toggle === 'combined' &&
              (holdSurplusTotal >= 0.5 ? (
                <>
                  Hold-nurse surplus: <strong>{holdSurplusTotal.toFixed(0)} hours</strong> — hold nurses staffed
                  against medical boarders who aren't there. This is a real finding, not a rounding error: hold
                  nurses can't help with BH boarders or arrivals, so surplus hold capacity just sits idle while
                  other hours may still run short.
                </>
              ) : (
                'No hold-nurse surplus in this scenario.'
              ))}
          </p>

          {marginalCurvePoints.length >= 2 && (
            <div className="marginal-curve-wrap">
              <MarginalReturnsCurve points={marginalCurvePoints} band={null} markerPoints={liveMarkerPoints} />
            </div>
          )}

          <h3>ED nurses</h3>
          <div className="button-row">
            <button className="btn-secondary" onClick={addEdUnit}>
              + Add best ED shift
            </button>
            <button className="btn-secondary" onClick={removeEdUnit}>
              − Remove cheapest ED shift
            </button>
          </div>
          <GridEditor grid={edGrid} setter={setEdGrid} label="ED" columns={sortedShiftMenu} />

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
              <div className="button-row">
                <button className="btn-secondary" onClick={addHoldUnit} disabled={allowedHoldShiftMenu.length === 0}>
                  + Add best hold shift
                </button>
                <button className="btn-secondary" onClick={removeHoldUnit}>
                  − Remove cheapest hold shift
                </button>
              </div>
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
          <VisualFrame views={views} shiftMenu={sortedShiftMenu} activeKey={toggle} onActiveKeyChange={(k) => setToggle(k as Toggle)} />
        </div>
      </div>
    </section>
  );
}
