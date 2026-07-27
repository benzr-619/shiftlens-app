import { DISPLAY_DAY_ORDER, DISPLAY_DAY_LABELS } from '../lib/dayOrder';
import { DAY_LABELS } from '../engine/types';
import type { ShiftDef } from '../engine/types';

export interface WhppvHeatmapCell {
  day: number;
  hour: number;
  onDuty: number;
  requirement: number;
  // 2026-07-26 PR D (SOLVER_REALISM_SPEC_2026-07-26.md, change 4) — the per-hour typical-
  // staffing band (EngineResult.bandFloorHourly/bandCeilingHourly at this cell's global hour),
  // in the SAME absolute-headcount units as onDuty/requirement. This is what now drives the
  // cell's COLOR (via cellVisual below) — replaces the old WEEK-LEVEL wHPPV band
  // (lib/whppvColorDomain.ts's computeColorDomain), which is still used elsewhere on the
  // results page for narrative band language, but no longer drives this heatmap's color.
  bandFloor: number;
  bandCeiling: number;
  whppv: number | null; // realized wHPPV — DEMOTED to the tooltip only (PR D change 4); the
  // cell's primary displayed number is onDuty/requirement now (see render below).
  arrivals: number;
  belowFloor: boolean; // under the ENA on-duty floor — a safety check, red outline + "!"
  backlog: number; // nurse-hours of accumulated backlog at this hour (idealized grid)
  inBacklogStreak: boolean; // backlog at/above the "caught up" threshold — the §2.4 overlay
  riskReasons: string[];
}

// --- Color scale constants (display heuristics — safe to tune, not load-bearing math) ---
// Nonlinear on BOTH sides: nearly flat just outside the neutral band, accelerating with
// distance (t^GAMMA, GAMMA>1). The asymmetry is in how far each side has to travel to reach
// full saturation, not the curve shape itself:
//  - Lean side saturates fast: half the lower band edge already reads fully alarming.
//  - Rich side ramps slowly and clamps early (~2x the point target) — beyond that it's just
//    "plenty of staff overnight," no further shades needed.
const COLOR_EASE_GAMMA = 1.8;
const LEAN_FULL_SATURATE_RATIO = 0.5; // ratio at HALF the lower band edge -> fully saturated lean
const RICH_CLAMP_MULTIPLE = 2; // ratio at 2x the point target (1.0) -> fully saturated rich
const MIN_ALPHA = 0.12;
const MAX_ALPHA = 0.75;
const LEANER_RGB = '194,59,59'; // red — understaffing is the safety/quality signal, stays dominant
const RICHER_RGB = '110,132,150'; // muted gray-blue (NOT saturated blue) — visibly subordinate to red
const TEXT_FLIP_ALPHA_THRESHOLD = 0.45; // above this fill alpha, cell text flips to white for contrast

interface CellVisual {
  background: string;
  textColor: string | undefined; // undefined = inherit theme text color
}

/**
 * PR D (change 4): color is now driven by `onDuty / requirement` — the SAME ratio the cell's
 * displayed number shows, so color and number can never disagree with each other (the
 * previous mechanism colored by realized wHPPV, a different, less intuitive number, which is
 * exactly the mismatch this change fixes). The neutral band is this cell's OWN
 * `bandFloor`/`bandCeiling`, expressed as ratios against `requirement` (so "1.0" always means
 * "exactly at this hour's point target," a per-cell, not week-level, reference point).
 * `Math.max(requirement, 1)` guards the divisor for requirement-0 cells (overnight hours in
 * very low-volume EDs) — same convention `engine/solver.ts`'s `severity` uses.
 */
function cellVisual(onDuty: number, requirement: number, bandFloor: number, bandCeiling: number): CellVisual {
  const denom = Math.max(requirement, 1);
  const ratio = onDuty / denom;
  const low = bandFloor / denom;
  const high = bandCeiling / denom;
  if (low <= 0) return { background: 'var(--bg-card-muted)', textColor: undefined };
  if (ratio >= low && ratio <= high) return { background: 'transparent', textColor: undefined };

  const lean = ratio < low;
  let t: number;
  if (lean) {
    const saturateDist = Math.log(1 / LEAN_FULL_SATURATE_RATIO); // log(2)
    t = ratio <= 0 ? 1 : Math.min(1, Math.log(low / ratio) / saturateDist);
  } else {
    const richClampEdge = Math.max(RICH_CLAMP_MULTIPLE, high * 1.01);
    const saturateDist = Math.log(richClampEdge / high);
    t = Math.min(1, Math.log(ratio / high) / saturateDist);
  }
  const alpha = MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * Math.pow(t, COLOR_EASE_GAMMA);
  const rgb = lean ? LEANER_RGB : RICHER_RGB;
  return {
    background: `rgba(${rgb},${alpha.toFixed(2)})`,
    textColor: alpha >= TEXT_FLIP_ALPHA_THRESHOLD ? '#fff' : undefined,
  };
}

function cellTitle(cell: WhppvHeatmapCell): string {
  const whppvPart = cell.whppv === null ? 'no arrivals recorded' : `${cell.whppv.toFixed(2)} realized wHPPV`;
  const base = `${DAY_LABELS[cell.day]} ${cell.hour.toString().padStart(2, '0')}:00 — ${cell.onDuty}/${cell.requirement} on duty vs. required, ${whppvPart}, ${cell.arrivals} arrivals`;
  return cell.riskReasons.length > 0 ? `${base}\n⚠ ${cell.riskReasons.join('; ')}` : base;
}

/** Distinct shift start hours -> the shift label(s) starting there, for the §5 shift-boundary
 * rule rows. Dedupe by startHour — an overlapping (swing) shift still just adds one more
 * label at its own start hour, it doesn't need its own partition logic. */
function shiftBoundariesByHour(shiftMenu: ShiftDef[]): Map<number, string[]> {
  const byHour = new Map<number, string[]>();
  for (const s of shiftMenu) {
    const label = s.label || s.id;
    const list = byHour.get(s.startHour) ?? [];
    list.push(label);
    byHour.set(s.startHour, list);
  }
  return byHour;
}

/**
 * 7x24 on-duty/requirement heatmap (Mon-Sun display columns — see lib/dayOrder.ts; the
 * engine's day-0-is-Sunday index is unaffected). PR D (change 4): the cell's NUMBER is
 * `onDuty/requirement` (e.g. "7/9") and its COLOR is driven by that same ratio against this
 * cell's OWN per-hour typical-staffing band (`bandFloor`/`bandCeiling`) — number and color now
 * encode the same thing, and this is a strictly better (hour-specific, not week-average) band
 * than the old week-level wHPPV domain. Most of a typical week still renders with NO color at
 * all; ink appears only genuinely outside this hour's own typical range. Realized wHPPV moved
 * to the tooltip — it was the primary number before, but is the least intuitive of the three
 * available (dominated by the arrivals denominator). Two independent overlays, never
 * color-alone: a red outline + "!" for an ENA on-duty floor violation (a safety minimum), and
 * a left-edge vertical spine (weight scaled by backlog magnitude via the shared `backlogMax`)
 * for hours carrying a §2.4 backlog — a streak of these forms one continuous bracket, since
 * backlog runs vertically down a day column. Horizontal rules land at each distinct
 * shift-menu start hour (§5), not fixed hour marks.
 */
export function WhppvHeatmap({
  cells,
  backlogMax,
  shiftMenu,
}: {
  cells: WhppvHeatmapCell[];
  backlogMax: number;
  shiftMenu: ShiftDef[];
}) {
  const byDayHour = new Map(cells.map((c) => [`${c.day}-${c.hour}`, c]));
  const boundaries = shiftBoundariesByHour(shiftMenu);

  return (
    <div className="whppv-heatmap-wrap">
      <table className="whppv-heatmap">
        <thead>
          <tr>
            <th className="hour-col">Shift start / hour</th>
            {DISPLAY_DAY_LABELS.map((d) => (
              <th key={d}>{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 24 }, (_, hour) => {
            const boundaryLabels = boundaries.get(hour);
            return (
              <tr key={hour} className={boundaryLabels ? 'shift-boundary' : undefined}>
                <td className="hour-col">
                  {hour.toString().padStart(2, '0')}:00
                  {boundaryLabels && <span className="shift-boundary-label">{boundaryLabels.join(' / ')}</span>}
                </td>
                {DISPLAY_DAY_ORDER.map((day) => {
                  const cell = byDayHour.get(`${day}-${hour}`);
                  if (!cell) return <td key={day} />;
                  const visual = cellVisual(cell.onDuty, cell.requirement, cell.bandFloor, cell.bandCeiling);
                  const cellClass = [cell.belowFloor ? 'heat-cell-risk' : '', cell.inBacklogStreak ? 'heat-cell-backlog' : '']
                    .filter(Boolean)
                    .join(' ');
                  const backlogT = backlogMax > 0 ? Math.min(1, cell.backlog / backlogMax) : 0;
                  return (
                    <td
                      key={day}
                      className={cellClass || undefined}
                      style={{ backgroundColor: visual.background }}
                      title={cellTitle(cell)}
                    >
                      <div className="heat-cell-inner">
                        {cell.inBacklogStreak && (
                          <span
                            className="heat-backlog-spine"
                            style={{
                              width: `${2 + backlogT * 6}px`,
                              background: `rgba(232,196,104,${(0.35 + backlogT * 0.6).toFixed(2)})`,
                            }}
                          />
                        )}
                        <span className="heat-cell-value" style={{ color: visual.textColor }}>
                          {cell.onDuty}/{cell.requirement}
                        </span>
                        {cell.belowFloor && <span className="heat-risk-badge">!</span>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="whppv-heatmap-legend">
        <div className="heat-legend-band">
          <span className="heat-legend-swatch heat-legend-swatch-lean" />
          <span>Leaner than typical</span>
          <span className="heat-legend-swatch heat-legend-swatch-neutral" />
          <span>Within typical range</span>
          <span className="heat-legend-swatch heat-legend-swatch-rich" />
          <span>Richer than typical</span>
        </div>
        <div className="heat-legend-band-text">
          Colored against each hour's OWN typical range (peer 25th-75th percentile) — a cell reads "leaner" or
          "richer" relative to what that specific hour usually needs, not a single week-wide number.
        </div>
        <div className="heat-legend-risk">
          <span className="heat-legend-risk-swatch">
            <span className="heat-risk-badge">!</span>
          </span>
          <span>Under the ENA on-duty floor</span>
        </div>
        <div className="heat-legend-risk">
          <span className="heat-legend-backlog-swatch">
            <span className="heat-legend-spine" />
          </span>
          <span>Carrying a backlog — spine height/weight tracks how deep and how long</span>
        </div>
      </div>
    </div>
  );
}
