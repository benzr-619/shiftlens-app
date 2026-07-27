import { useStore } from '../../store';
import type { ShiftDef } from '../../engine/types';
import { fullWeekCapacity } from '../../engine/solver';
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

/** Two vertical bars: total weekly demand (arrivals + boarding, stacked when boarding is
 * present) vs. hours actually staffed today. §10 open item 3's degraded state, resolved here:
 * when boarding is absent, the demand bar is a single (arrivals-only) segment — a smaller,
 * still-correctly-scaled total, not a half-empty chart. */
function TwoBarComparison({
  arrivalsHours,
  boardingHours,
  staffedHours,
}: {
  arrivalsHours: number;
  boardingHours: number | null;
  staffedHours: number;
}) {
  const width = 320;
  const height = 200;
  const pad = 32;
  const barWidth = 70;
  const totalDemand = arrivalsHours + (boardingHours ?? 0);
  const max = Math.max(totalDemand, staffedHours, 1e-9) * 1.1;
  const scale = (v: number) => (v / max) * (height - 2 * pad);
  const arrivalsH = scale(arrivalsHours);
  const boardingH = boardingHours !== null ? scale(boardingHours) : 0;
  const staffedH = scale(staffedHours);
  const x1 = width / 2 - barWidth - 16;
  const x2 = width / 2 + 16;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="two-bar-chart" role="img" aria-label="Total demand versus hours staffed today">
      <line x1={pad - 8} y1={height - pad} x2={width - pad + 8} y2={height - pad} stroke="var(--border)" strokeWidth={1} />
      {/* Demand bar — boarding stacked on top of arrivals when present. */}
      <rect x={x1} y={height - pad - arrivalsH} width={barWidth} height={arrivalsH} fill="var(--error)" opacity={0.75} />
      {boardingHours !== null && (
        <rect x={x1} y={height - pad - arrivalsH - boardingH} width={barWidth} height={boardingH} fill="var(--warning)" opacity={0.75} />
      )}
      <text x={x1 + barWidth / 2} y={height - pad + 16} fontSize={11} fill="var(--text-muted)" textAnchor="middle">
        total demand
      </text>
      <text x={x1 + barWidth / 2} y={height - pad - arrivalsH - boardingH - 6} fontSize={11} fill="var(--text)" textAnchor="middle">
        {totalDemand.toFixed(0)}
      </text>
      {/* Staffed-today bar. */}
      <rect x={x2} y={height - pad - staffedH} width={barWidth} height={staffedH} fill="var(--accent)" opacity={0.75} />
      <text x={x2 + barWidth / 2} y={height - pad + 16} fontSize={11} fill="var(--text-muted)" textAnchor="middle">
        staffed today
      </text>
      <text x={x2 + barWidth / 2} y={height - pad - staffedH - 6} fontSize={11} fill="var(--text)" textAnchor="middle">
        {staffedHours.toFixed(0)}
      </text>
    </svg>
  );
}

/**
 * PANEL 3 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §4) — "What would it take to fully cover the
 * department?" New. The honest ceiling: `EngineResult.fullCoverageCombined` (PR B) — total
 * nurses so arrivals AND boarding demand are both fully met, zero shortfall anywhere.
 * Resource-agnostic (§3.5 — no hold/ED decomposition here, one number, one grid). The queue
 * strip is deliberately BLANK (`queueDepth168: null`) — after Panels 1/2's queue-building
 * frames, an empty strip is itself the finding, free of charge.
 */
export function Panel3() {
  const { shiftMenu, arrivals, currentStaffingGrid, getResult } = useStore();
  const result = getResult();
  const sortedShiftMenu = sortByStartHour(shiftMenu);
  const grid = currentStaffingGrid ?? {};

  const boardingCurve = result.boarding?.cellBoardingRnHours ?? null;
  const combinedRequirement = result.hourlyRequirement.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));
  const fullCoverageCapacity = fullWeekCapacity(result.fullCoverageCombined.grid, sortedShiftMenu);

  const staffedHours = sortedShiftMenu.reduce(
    (acc, s) => acc + Object.keys(grid).reduce((a, d) => a + (grid[Number(d)]?.[s.id] ?? 0) * s.lengthHours, 0),
    0
  );
  const arrivalsAnnualHours = result.hourlyRequirement.reduce((a, b) => a + b, 0) * 52;
  const boardingAnnualHours = result.boarding?.annualBoardingHours ?? null;

  const combinedBandFloor = result.bandFloorHourly.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));
  const combinedBandCeiling = result.bandCeilingHourly.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));
  const cells = buildCells(fullCoverageCapacity, combinedRequirement, combinedBandFloor, combinedBandCeiling, arrivals);

  const views: VisualFrameView[] = [
    {
      key: 'full-coverage',
      label: 'Full coverage',
      demand168: combinedRequirement,
      capacity168: fullCoverageCapacity,
      queueDepth168: null,
      structuralFloor: null,
      heatmapCells: cells,
    },
  ];

  const fteDelta = ((result.fullCoverageCombined.weeklyHours - staffedHours) * 52) / 2080;

  return (
    <section className="panel panel-3" id="ch-full-coverage">
      <div className="panel-columns">
        <div className="panel-words">
          <h2>What would it take to fully cover the department?</h2>

          <p className="comparison-headline">
            Fully covering both arrivals and boarding, with no shortfall anywhere, would take{' '}
            <strong>{result.fullCoverageCombined.weeklyHours.toFixed(0)} hours/week</strong> —{' '}
            <strong>{Math.max(0, fteDelta).toFixed(1)} FTE</strong> above what you staff today.
          </p>

          <p>
            This number is large, and it is meant to be: it is the ceiling, not the ask. The next panel is what is
            actually worth asking for, and why — without that handoff this number reads as unsellable and easy to
            bounce off of.
          </p>

          <div className="two-bar-wrap">
            <TwoBarComparison arrivalsHours={arrivalsAnnualHours / 52} boardingHours={boardingAnnualHours !== null ? boardingAnnualHours / 52 : null} staffedHours={staffedHours} />
          </div>
        </div>
        <div className="panel-frame">
          <VisualFrame views={views} shiftMenu={sortedShiftMenu} />
        </div>
      </div>
    </section>
  );
}
