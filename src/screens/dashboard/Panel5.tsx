import { useMemo } from 'react';
import { useStore } from '../../store';
import type { ShiftDef, Grid } from '../../engine/types';
import { fullWeekCapacity } from '../../engine/solver';
import { recommendWeeklyBoardingGrid } from '../../engine/boarding';
import { lookupWhppvBand } from '../../lib/edbaLookup';
import { computeSandbox } from '../../engine/sandbox';
import { DISPLAY_DAY_ORDER, DISPLAY_DAY_LABELS } from '../../lib/dayOrder';
import { VisualFrame, type VisualFrameView } from '../../components/VisualFrame';
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

/**
 * PANEL 5 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §4) — "Test it yourself." New. Two editable
 * day×shift grids (ED nurses / hold nurses), live-updating via `computeSandbox` (PR C) — no
 * solver call, per the spec. §3.5's hard rule lives entirely in this panel: the ED-vs-hold
 * distinction is a distinction in the ASK (whose budget, which patients they can cover), not
 * in the engine's demand model — nowhere else on the page makes this split.
 *
 * JUDGMENT CALL, flagged: the engine exposes a per-hour COMBINED boarding curve
 * (`cellBoardingRnHours`) but only WEEKLY medical/BH totals (measured path only — the derived
 * path has no medical/BH split at all). Hold nurses can only ever cover medical boarders
 * (§3.5), so this panel needs a per-hour medical curve that doesn't exist yet. Approximated as:
 * on the measured path with both streams present, split `cellBoardingRnHours` proportionally
 * by the weekly medical:BH ratio, uniformly across all 168 hours (assumes both streams share
 * the same hourly shape — a real simplification, not a proven one); everywhere else (derived
 * path, or measured with only medical tracked), the ENTIRE curve is treated as medical, since
 * the derived path has no BH-specific concept to split out in the first place.
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

  // PR H moved this from component-local state into the store — see the store field's own
  // comment for why (the PPTX export needs to read "the user's sandbox scenario" from outside
  // this component). Behavior is otherwise identical: starts empty, edits persist for the
  // session, `null` reads as "untouched."
  const edGrid = sandboxEdGrid ?? emptyGrid(sortedShiftMenu);
  const holdGrid = sandboxHoldGrid ?? emptyGrid(sortedShiftMenu);
  const setEdGrid = (updater: Grid | ((prev: Grid) => Grid)) =>
    setSandboxEdGrid(typeof updater === 'function' ? (updater as (prev: Grid) => Grid)(edGrid) : updater);
  const setHoldGrid = (updater: Grid | ((prev: Grid) => Grid)) =>
    setSandboxHoldGrid(typeof updater === 'function' ? (updater as (prev: Grid) => Grid)(holdGrid) : updater);

  const boarding = result.boarding;
  const band = lookupWhppvBand(result.annualVisits);
  const boardingGrid =
    boarding && result.lostProductivity
      ? recommendWeeklyBoardingGrid(boarding, sortedShiftMenu, inputs.wHppvTarget, band.p25Whppv, result.lostProductivity.wHppvConsumedByBoarding)
      : {};

  function prefillCurrent() {
    setEdGrid(currentStaffingGrid ? { ...currentStaffingGrid } : emptyGrid(sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
  }
  function prefillAllEd() {
    setEdGrid(sumGrids(result.grid, boardingGrid, sortedShiftMenu));
    setHoldGrid(emptyGrid(sortedShiftMenu));
  }
  function prefillHoldSplit() {
    setEdGrid({ ...result.grid });
    setHoldGrid(boarding ? { ...boardingGrid } : emptyGrid(sortedShiftMenu));
  }

  const edCapacity = fullWeekCapacity(edGrid, sortedShiftMenu);
  const holdCapacity = fullWeekCapacity(holdGrid, sortedShiftMenu);

  const combined = boarding?.cellBoardingRnHours ?? new Array(168).fill(0);
  const medWeekly = boarding?.medicalWeeklyRnHours ?? null;
  const bhWeekly = boarding?.bhWeeklyRnHours ?? null;
  const medFraction = medWeekly !== null && bhWeekly !== null && medWeekly + bhWeekly > 0 ? medWeekly / (medWeekly + bhWeekly) : 1;
  const medBoarding168 = combined.map((v) => v * medFraction);
  const bhBoarding168 = combined.map((v) => v * (1 - medFraction));

  const sandbox = computeSandbox(result.hourlyRequirement, medBoarding168, bhBoarding168, arrivals, edCapacity, holdCapacity);

  const residualCapacity = edCapacity; // ED nurses are the one pooled resource against residualDemand
  const cells = buildCells(residualCapacity, sandbox.residualDemand, arrivals);
  const holdSurplusTotal = sandbox.holdSurplus.reduce((a, b) => a + b, 0);
  const unmetTotal = sandbox.unmet.reduce((a, b) => a + b, 0);

  const views: VisualFrameView[] = [
    {
      key: 'sandbox',
      label: 'Your scenario',
      demand168: sandbox.residualDemand,
      capacity168: edCapacity,
      queueDepth168: sandbox.queueDepth,
      structuralFloor: null,
      heatmapCells: cells,
    },
  ];

  function editCell(setter: typeof setEdGrid, day: number, shiftId: string, value: number) {
    setter((prev) => ({ ...prev, [day]: { ...prev[day], [shiftId]: Math.max(0, value) } }));
  }

  function GridEditor({ grid, setter, label }: { grid: Grid; setter: typeof setEdGrid; label: string }) {
    return (
      <table className="staffing-grid sandbox-grid">
        <thead>
          <tr>
            <th className="hour-col">{label}</th>
            {sortedShiftMenu.map((s) => (
              <th key={s.id}>{s.label || s.id}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DISPLAY_DAY_ORDER.map((day, i) => (
            <tr key={day}>
              <td className="hour-col">{DISPLAY_DAY_LABELS[i]}</td>
              {sortedShiftMenu.map((s) => (
                <td key={s.id}>
                  <input
                    type="number"
                    min={0}
                    value={grid[day]?.[s.id] ?? 0}
                    onChange={(e) => editCell(setter, day, s.id, Number(e.target.value))}
                  />
                </td>
              ))}
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

          <p>
            Two grids, because they are two different asks, to two different people, paid for out of two different
            pools of hours: <strong>ED nurses</strong> are your own department's hours, flexible across both
            arrivals and boarding. <strong>Hold nurses</strong> come from the hospital's float pool — likely outside
            your own hours entirely, and able to cover medical/surg boarders only, never behavioral-health
            boarders or arrivals.
          </p>

          <div className="button-row">
            <button className="btn-secondary" onClick={prefillCurrent}>
              My current staffing
            </button>
            <button className="btn-secondary" onClick={prefillAllEd}>
              The recommendation, all as ED nurses
            </button>
            <button className="btn-secondary" onClick={prefillHoldSplit} disabled={!boarding}>
              The recommendation, with boarding covered by hold nurses
            </button>
          </div>

          <p>
            Hours below need this week: <strong>{unmetTotal.toFixed(0)}</strong>.{' '}
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

          <h3>ED nurses</h3>
          <GridEditor grid={edGrid} setter={setEdGrid} label="ED" />
          <h3>Hold nurses</h3>
          <GridEditor grid={holdGrid} setter={setHoldGrid} label="Hold" />
        </div>
        <div className="panel-frame">
          <VisualFrame views={views} shiftMenu={sortedShiftMenu} />
        </div>
      </div>
    </section>
  );
}
