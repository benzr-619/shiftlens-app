import { useState } from 'react';
import { useStore } from '../../store';
import { DEFAULTS, DAY_LABELS, type ShiftDef } from '../../engine/types';
import { fullWeekCapacity } from '../../engine/solver';
import { VisualFrame, type VisualFrameView } from '../../components/VisualFrame';
import type { WhppvHeatmapCell } from '../../components/WhppvHeatmap';
import { DISPLAY_DAY_ORDER, DISPLAY_DAY_LABELS } from '../../lib/dayOrder';
import { fmtHour } from '../../lib/queuePattern';
import { lookupWhppvBand } from '../../lib/edbaLookup';

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

/** Three vertical bars, left to right: hours staffed today (yellow), total weekly demand
 * (red — arrivals alone, or arrivals+boarding combined when the boarding toggle is active;
 * always one shade, just taller when boarding is added — no stacked breakdown), and the
 * hours it would take to fully cover the department with zero shortfall anywhere (blue/
 * purple). §10 open item 3's degraded state still holds for the demand bar: with no boarding
 * data it's simply the (smaller) arrivals-only total, not a half-empty chart. */
function ThreeBarComparison({
  staffedHours,
  arrivalsHours,
  boardingHours,
  fullyCoveredHours,
}: {
  staffedHours: number;
  arrivalsHours: number;
  boardingHours: number | null;
  fullyCoveredHours: number;
}) {
  const width = 420;
  const height = 200;
  const pad = 32;
  const barWidth = 64;
  const gap = 28;
  const totalDemand = arrivalsHours + (boardingHours ?? 0);
  const max = Math.max(totalDemand, staffedHours, fullyCoveredHours, 1e-9) * 1.1;
  const scale = (v: number) => (v / max) * (height - 2 * pad);
  const staffedH = scale(staffedHours);
  const demandH = scale(totalDemand);
  const fullyCoveredH = scale(fullyCoveredHours);
  const groupWidth = barWidth * 3 + gap * 2;
  const x1 = (width - groupWidth) / 2;
  const x2 = x1 + barWidth + gap;
  const x3 = x2 + barWidth + gap;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="three-bar-chart"
      role="img"
      aria-label="Hours staffed today, total demand, and hours to fully cover the department"
    >
      <line x1={pad - 8} y1={height - pad} x2={width - pad + 8} y2={height - pad} stroke="var(--border)" strokeWidth={1} />
      {/* Staffed today. */}
      <rect x={x1} y={height - pad - staffedH} width={barWidth} height={staffedH} fill="var(--warning)" opacity={0.85} />
      <text x={x1 + barWidth / 2} y={height - pad + 16} fontSize={11} fill="var(--text-muted)" textAnchor="middle">
        staffed today
      </text>
      <text x={x1 + barWidth / 2} y={height - pad - staffedH - 6} fontSize={11} fill="var(--text)" textAnchor="middle">
        {staffedHours.toFixed(0)}
      </text>
      {/* Total demand — one shade of red, taller when boarding is included. */}
      <rect x={x2} y={height - pad - demandH} width={barWidth} height={demandH} fill="var(--error)" opacity={0.85} />
      <text x={x2 + barWidth / 2} y={height - pad + 16} fontSize={11} fill="var(--text-muted)" textAnchor="middle">
        total demand
      </text>
      <text x={x2 + barWidth / 2} y={height - pad - demandH - 6} fontSize={11} fill="var(--text)" textAnchor="middle">
        {totalDemand.toFixed(0)}
      </text>
      {/* Fully covered — zero shortfall anywhere. */}
      <rect x={x3} y={height - pad - fullyCoveredH} width={barWidth} height={fullyCoveredH} fill="var(--accent)" opacity={0.85} />
      <text x={x3 + barWidth / 2} y={height - pad + 16} fontSize={11} fill="var(--text-muted)" textAnchor="middle">
        fully covered
      </text>
      <text x={x3 + barWidth / 2} y={height - pad - fullyCoveredH - 6} fontSize={11} fill="var(--text)" textAnchor="middle">
        {fullyCoveredHours.toFixed(0)}
      </text>
    </svg>
  );
}

/**
 * PANEL 3 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §4) — "What would it take to fully cover the
 * department?" The honest ceiling. Two toggles (2026-07-30, Ben's ask, matching Panels 1/2):
 * "Arrivals" — `EngineResult.fullCoverage` — total nurses so arrivals demand alone is fully
 * met, zero shortfall anywhere, ignoring boarding entirely; "Arrivals + Boarding" (the
 * original, still the default) — `EngineResult.fullCoverageCombined` (PR B) — total nurses so
 * BOTH arrivals and boarding demand are fully met. Both reuse `solveFullCoverageWeek` verbatim
 * — no second solver, resource-agnostic (§3.5 — no hold/ED decomposition here, one number, one
 * grid, per toggle). The queue strip is deliberately BLANK (`queueDepth168: null`) on both
 * toggles — after Panels 1/2's queue-building frames, an empty strip is itself the finding,
 * free of charge.
 */
export function Panel3() {
  const { shiftMenu, arrivals, currentStaffingGrid, buildEngineInputs, getResult } = useStore();
  const result = getResult();
  const inputs = buildEngineInputs();
  const hoursPerFteAnnual = inputs.hoursPerFteAnnual ?? DEFAULTS.hoursPerFteAnnual;
  const sortedShiftMenu = sortByStartHour(shiftMenu);
  const grid = currentStaffingGrid ?? {};

  const [active, setActive] = useState<'arrivals' | 'combined'>('arrivals');

  const boardingCurve = result.boarding?.cellBoardingRnHours ?? null;
  const combinedRequirement = result.hourlyRequirement.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));

  const staffedHours = sortedShiftMenu.reduce(
    (acc, s) => acc + Object.keys(grid).reduce((a, d) => a + (grid[Number(d)]?.[s.id] ?? 0) * s.lengthHours, 0),
    0
  );
  const arrivalsAnnualHours = result.hourlyRequirement.reduce((a, b) => a + b, 0) * 52;
  const boardingAnnualHours = result.boarding?.annualBoardingHours ?? null;

  const combinedBandFloor = result.bandFloorHourly.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));
  const combinedBandCeiling = result.bandCeilingHourly.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));

  // Per-toggle state — same shape both toggles share, only the demand curve/grid/band vary.
  const stateFor = (key: 'arrivals' | 'combined') =>
    key === 'arrivals'
      ? {
          demand: result.hourlyRequirement,
          fullGrid: result.fullCoverage.grid,
          weeklyHours: result.fullCoverage.weeklyHours,
          bandFloor: result.bandFloorHourly,
          bandCeiling: result.bandCeilingHourly,
        }
      : {
          demand: combinedRequirement,
          fullGrid: result.fullCoverageCombined.grid,
          weeklyHours: result.fullCoverageCombined.weeklyHours,
          bandFloor: combinedBandFloor,
          bandCeiling: combinedBandCeiling,
        };

  const activeState = stateFor(active);
  const fteDelta = ((activeState.weeklyHours - staffedHours) * 52) / hoursPerFteAnnual;

  // Average + hour-to-hour realized wHPPV for the active ceiling grid, same computation
  // Panel1/Panel2 use (realizedWHppv = weeklyHours*52/annualVisits; min/max is a direct
  // per-cell capacity/arrivals ratio, zero-arrival cells skipped).
  const activeCapacity = fullWeekCapacity(activeState.fullGrid, sortedShiftMenu);
  const avgWhppv = (activeState.weeklyHours * 52) / result.annualVisits;
  const peerBand = lookupWhppvBand(result.annualVisits);
  const showTooLargeNote = avgWhppv > peerBand.p75Whppv;
  // Same delta the wHPPV figure above expresses, converted to hours/week: this ED's own
  // representative-week visit count (annualVisits/52) times the wHPPV gap above the peer
  // median — kept as one multiplication of the SAME (avgWhppv - medianWhppv) figure so the
  // two numbers in the sentence below can never drift apart from each other.
  const weeklyVisits = result.annualVisits / 52;
  const hoursAboveTypical = (avgWhppv - peerBand.medianWhppv) * weeklyVisits;
  let minHourlyWhppv: { value: number; day: number; hour: number } | null = null;
  let maxHourlyWhppv: { value: number; day: number; hour: number } | null = null;
  for (let g = 0; g < 168; g++) {
    const cellArrivals = arrivals[g] ?? 0;
    if (cellArrivals <= 0) continue;
    const value = (activeCapacity[g] ?? 0) / cellArrivals;
    const day = Math.floor(g / 24);
    const hour = g % 24;
    if (!minHourlyWhppv || value < minHourlyWhppv.value) minHourlyWhppv = { value, day, hour };
    if (!maxHourlyWhppv || value > maxHourlyWhppv.value) maxHourlyWhppv = { value, day, hour };
  }

  const views: VisualFrameView[] = (['arrivals', 'combined'] as const).map((key) => {
    const s = stateFor(key);
    const capacity = fullWeekCapacity(s.fullGrid, sortedShiftMenu);
    return {
      key,
      label: key === 'arrivals' ? 'Arrivals' : 'Arrivals + Boarding',
      demand168: s.demand,
      capacity168: capacity,
      queueDepth168: null,
      structuralFloor: null,
      heatmapCells: buildCells(capacity, s.demand, s.bandFloor, s.bandCeiling, arrivals),
    } satisfies VisualFrameView;
  });

  const headline =
    active === 'arrivals' ? (
      <>
        Fully covering arrivals alone, with no shortfall anywhere, would take{' '}
        <strong>{result.fullCoverage.weeklyHours.toFixed(0)} hours/week</strong> —{' '}
        <strong>{Math.max(0, fteDelta).toFixed(1)} FTE</strong> above what you staff today. This ignores boarding
        entirely — it's the ceiling for arrivals demand only.
      </>
    ) : (
      <>
        Fully covering both arrivals and boarding, with no shortfall anywhere, would take{' '}
        <strong>{result.fullCoverageCombined.weeklyHours.toFixed(0)} hours/week</strong> —{' '}
        <strong>{Math.max(0, fteDelta).toFixed(1)} FTE</strong> above what you staff today.
      </>
    );

  return (
    <section className="panel panel-3" id="ch-full-coverage">
      <div className="panel-columns">
        <div className="panel-words">
          <h2>What would it take to fully cover the department?</h2>

          <p className="comparison-headline">{headline}</p>

          {active === 'combined' && <h3 className="staffing-table-label">Nurses for Arrivals</h3>}
          <table className="staffing-grid diff-grid">
            <thead>
              <tr>
                <th className="hour-col">Shift</th>
                {DISPLAY_DAY_LABELS.map((d) => (
                  <th key={d}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedShiftMenu.map((s) => (
                <tr key={s.id}>
                  <td className="hour-col">{s.label || s.id}</td>
                  {DISPLAY_DAY_ORDER.map((day) => {
                    const newValue =
                      (active === 'combined' ? result.fullCoverage.grid : activeState.fullGrid)[day]?.[s.id] ?? 0;
                    const diff = newValue - (grid[day]?.[s.id] ?? 0);
                    return (
                      <td key={day}>
                        <span className="diff-cell">
                          <span className="diff-main">{newValue}</span>
                          <span className="diff-delta">({diff > 0 ? `+${diff}` : diff})</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {active === 'combined' && (
            <>
              <h3 className="staffing-table-label">Additional Nurses for Boarding</h3>
              <table className="staffing-grid diff-grid">
                <thead>
                  <tr>
                    <th className="hour-col">Shift</th>
                    {DISPLAY_DAY_LABELS.map((d) => (
                      <th key={d}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedShiftMenu.map((s) => (
                    <tr key={s.id}>
                      <td className="hour-col">{s.label || s.id}</td>
                      {DISPLAY_DAY_ORDER.map((day) => {
                        const arrivalsOnly = result.fullCoverage.grid[day]?.[s.id] ?? 0;
                        const combined = result.fullCoverageCombined.grid[day]?.[s.id] ?? 0;
                        const additional = Math.max(0, combined - arrivalsOnly);
                        return (
                          <td key={day}>
                            <span className="diff-cell">
                              <span className="diff-main">+{additional}</span>
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <details className="why-toggle-wrap">
            <summary className="btn-link why-toggle">Why might day-to-day numbers look uneven?</summary>
            <div className="why-explainer">
              <p>
                The model is trying to match staffing to demand each day, not aiming for a steady pattern across the
                week. To smooth it out, you can test alternatives further down in "Test it yourself."
              </p>
            </div>
          </details>

          <p>
            This staffing comes out to <strong>{avgWhppv.toFixed(2)} wHPPV</strong> on average.
            {minHourlyWhppv && maxHourlyWhppv && (
              <>
                {' '}
                Hour to hour, wHPPV ranges from <strong>{minHourlyWhppv.value.toFixed(2)}</strong> (
                {DAY_LABELS[minHourlyWhppv.day]} {fmtHour(minHourlyWhppv.hour)}) up to{' '}
                <strong>{maxHourlyWhppv.value.toFixed(2)}</strong> ({DAY_LABELS[maxHourlyWhppv.day]}{' '}
                {fmtHour(maxHourlyWhppv.hour)}).
              </>
            )}
          </p>

          {showTooLargeNote && (
            <p>
              This number is <strong>{Math.max(0, hoursAboveTypical).toFixed(0)} hours/week</strong> and{' '}
              <strong>{(avgWhppv - peerBand.medianWhppv).toFixed(2)} wHPPV</strong> larger than typical average
              staffing since it does not allow a single hour to fall below ideal staffing. The next panel is more
              rational, accepting the trade-offs of real world budgets.
            </p>
          )}

          <div className="three-bar-wrap">
            <ThreeBarComparison
              staffedHours={staffedHours}
              arrivalsHours={arrivalsAnnualHours / 52}
              boardingHours={active === 'combined' && boardingAnnualHours !== null ? boardingAnnualHours / 52 : null}
              fullyCoveredHours={activeState.weeklyHours}
            />
          </div>
        </div>
        <div className="panel-frame">
          <VisualFrame
            views={views}
            shiftMenu={sortedShiftMenu}
            activeKey={active}
            onActiveKeyChange={(k) => setActive(k as 'arrivals' | 'combined')}
          />
        </div>
      </div>
    </section>
  );
}
