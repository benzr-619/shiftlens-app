import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import type { ShiftDef } from '../../engine/types';
import { computeBacklog, computeScenarioB, computeCombinedReallocation } from '../../engine';
import { fullWeekCapacity } from '../../engine/solver';
import { namePattern } from '../../lib/whenPattern';
import { VisualFrame, type VisualFrameView } from '../../components/VisualFrame';
import type { WhppvHeatmapCell } from '../../components/WhppvHeatmap';

function sortByStartHour(shifts: ShiftDef[]): ShiftDef[] {
  return [...shifts].sort((a, b) => a.startHour - b.startHour);
}

function buildCells(onDuty168: number[], requirement168: number[], bandFloor168: number[], bandCeiling168: number[], arrivals168: number[]): WhppvHeatmapCell[] {
  const cells: WhppvHeatmapCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const g = day * 24 + hour;
      cells.push({
        day,
        hour,
        onDuty: onDuty168[g] ?? 0,
        requirement: requirement168[g] ?? 0,
        bandFloor: bandFloor168[g] ?? 0,
        bandCeiling: bandCeiling168[g] ?? 0,
        whppv: null,
        arrivals: arrivals168[g] ?? 0,
        belowFloor: false,
        riskReasons: [],
      });
    }
  }
  return cells;
}

function shortfallHours(demand168: number[], capacity168: number[]): number {
  let total = 0;
  for (let i = 0; i < 168; i++) total += Math.max(0, (demand168[i] ?? 0) - (capacity168[i] ?? 0));
  return total;
}

/**
 * PANEL 2 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §4) — "Could moving hours fix it?" Reuses
 * `computeScenarioB` (arrivals only) and `computeCombinedReallocation` (arrivals + boarding)
 * UNCHANGED — no new engine work, per the spec. The honest-cost sentence renders on EVERY
 * state, not just when the "arrivals + boarding" option is selected (spec's explicit
 * instruction) — reallocating to cover boarding necessarily costs the arrivals picture
 * something, and that cost must never be hidden behind a toggle click.
 */
export function Panel2() {
  const { shiftMenu, arrivals, currentStaffingGrid, buildEngineInputs, getResult } = useStore();
  const result = getResult();
  const sortedShiftMenu = useMemo(() => sortByStartHour(shiftMenu), [shiftMenu]);
  const grid = currentStaffingGrid ?? {};
  const inputs = buildEngineInputs();

  const [active, setActive] = useState<'current' | 'arrivals' | 'combined'>('current');

  const hasCurrentStaffing = Object.values(grid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));

  if (!hasCurrentStaffing) {
    return (
      <section className="card panel panel-2" id="ch-scenario-b">
        <h2>Could moving hours fix it?</h2>
        <p>Add your current staffing above to see whether reallocating the same hours would close any gap.</p>
      </section>
    );
  }

  const scenarioB = computeScenarioB(result, inputs, grid);
  const combinedRealloc = computeCombinedReallocation(result, inputs, grid);
  const boardingCurve = result.boarding?.cellBoardingRnHours ?? null;
  const combinedRequirement = result.hourlyRequirement.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));

  const currentCapacity = fullWeekCapacity(grid, sortedShiftMenu);
  const arrivalsCapacity = scenarioB ? fullWeekCapacity(scenarioB.grid, sortedShiftMenu) : currentCapacity;
  const combinedCapacity = combinedRealloc ? fullWeekCapacity(combinedRealloc.grid, sortedShiftMenu) : currentCapacity;

  const stateFor = (key: 'current' | 'arrivals' | 'combined') => {
    if (key === 'arrivals') return { demand: result.hourlyRequirement, capacity: arrivalsCapacity, gridForBacklog: scenarioB?.grid ?? grid };
    if (key === 'combined') return { demand: combinedRequirement, capacity: combinedCapacity, gridForBacklog: combinedRealloc?.grid ?? grid };
    return { demand: result.hourlyRequirement, capacity: currentCapacity, gridForBacklog: grid };
  };

  const activeState = stateFor(active);
  const activeBacklog = computeBacklog(activeState.gridForBacklog, activeState.demand, sortedShiftMenu);
  const activeShortfall = shortfallHours(activeState.demand, activeState.capacity);
  const worstStretchLabel = namePattern(activeBacklog.cyclicalBacklog, 'higher-is-worse');

  const views: VisualFrameView[] = (['current', 'arrivals', 'combined'] as const)
    .filter((key) => key !== 'combined' || combinedRealloc)
    .map((key) => {
      const s = stateFor(key);
      const b = computeBacklog(s.gridForBacklog, s.demand, sortedShiftMenu);
      const label = key === 'current' ? 'Current' : key === 'arrivals' ? 'Reallocated for arrivals' : 'Reallocated for arrivals + boarding';
      return {
        key,
        label,
        demand168: s.demand,
        capacity168: s.capacity,
        queueDepth168: b.cyclicalBacklog,
        structuralFloor: b.structuralFloorMin,
        heatmapCells: buildCells(s.capacity, s.demand, result.bandFloorHourly, result.bandCeilingHourly, arrivals),
      } satisfies VisualFrameView;
    });

  return (
    <section className="panel panel-2" id="ch-scenario-b">
      <div className="panel-columns">
        <div className="panel-words">
          <h2>Could moving hours fix it?</h2>

          <p>
            Hours below need this week: <strong>{activeShortfall.toFixed(0)}</strong>. Worst unbroken stretch:{' '}
            <strong>{worstStretchLabel}</strong>.
          </p>

          <div className="banner banner-info">
            "Reallocated for arrivals" only ever answers what arrivals alone would justify — it is bounded to that
            question on every render, never a standalone recommendation for your whole department.
          </div>

          {combinedRealloc && (
            <p>
              Reallocating your same hours to also cover boarding makes the arrivals picture worse, not better —
              covering boarding this way costs you{' '}
              <strong>
                {Math.max(0, combinedRealloc.arrivalsShortfallHoursAfter - combinedRealloc.arrivalsShortfallHoursBefore).toFixed(0)} more hours
              </strong>{' '}
              short against arrivals alone. This is the honest price of a same-hours compromise, not a hidden cost.
            </p>
          )}
        </div>
        <div className="panel-frame">
          <VisualFrame
            views={views}
            shiftMenu={sortedShiftMenu}
            activeKey={active}
            onActiveKeyChange={(k) => setActive(k as 'current' | 'arrivals' | 'combined')}
          />
        </div>
      </div>
    </section>
  );
}
