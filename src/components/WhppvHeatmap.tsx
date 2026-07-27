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
  // in the SAME absolute-headcount units as onDuty/requirement. Drives the cell's COLOR (via
  // cellVisual below) — a per-hour, not week-level, reference point.
  bandFloor: number;
  bandCeiling: number;
  whppv: number | null; // realized wHPPV — tooltip only.
  arrivals: number;
  belowFloor: boolean; // under the ENA on-duty floor — a safety check, red outline + "!"
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
// R2 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §2) — REVERSES the 2026-07-25 deliberate muting
// (was '110,132,150', a gray-blue chosen specifically to be visually subordinate to red).
// Confirmed with Ben against a real rendered page: an 8-nurses-against-a-4-requirement hour
// at 04:00 rendered in pale gray was arguably the single most actionable fact on the page —
// muting it made a genuinely useful "you're overstaffed here, move these hours" finding
// invisible. Saturated blue reads as clearly as the lean/red side now; the two sides are
// still asymmetric in RAMP (see LEAN_FULL_SATURATE_RATIO/RICH_CLAMP_MULTIPLE above), just no
// longer asymmetric in how saturated the color itself is allowed to get.
const RICHER_RGB = '37,99,235'; // saturated blue
const TEXT_FLIP_ALPHA_THRESHOLD = 0.45; // above this fill alpha, cell text flips to white for contrast

interface CellVisual {
  background: string;
  textColor: string | undefined; // undefined = inherit theme text color
}

/**
 * Color is driven by `onDuty / requirement` against this cell's OWN `bandFloor`/`bandCeiling`,
 * expressed as ratios against `requirement` (so "1.0" always means "exactly at this hour's
 * point target," a per-cell, not week-level, reference point). `Math.max(requirement, 1)`
 * guards the divisor for requirement-0 cells (overnight hours in very low-volume EDs) — same
 * convention `engine/solver.ts`'s `severity` uses.
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
 * 7x24 heatmap (Mon-Sun display columns — see lib/dayOrder.ts; the engine's day-0-is-Sunday
 * index is unaffected).
 *
 * R1 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §2) — THIRD change to this cell's displayed number:
 * headcount alone (`onDuty`), not `onDuty/requirement`. Color still encodes the ratio against
 * this cell's own typical band, unchanged — only the NUMBER simplified, so the visual frame's
 * repeated heatmap reads as "how many nurses" at a glance, with color carrying the
 * over/under-typical judgment rather than a second number doing the same job.
 *
 * R3 — the backlog spine overlay is REMOVED from this component entirely (was a left-edge
 * vertical spine, weight scaled by backlog magnitude). In the rendered page it appeared on
 * essentially every cell at near-uniform weight — reading as a table-border artifact, not
 * data (spec §3.2). Backlog now gets its OWN aligned strip chart in the shared visual frame
 * (`components/VisualFrame.tsx`, same x-axis as the demand/capacity chart above it) — a
 * genuinely different, more legible representation of the same signal, not a deletion of the
 * signal itself. `WhppvHeatmapCell` no longer carries `backlog`/`inBacklogStreak` fields, and
 * this component no longer takes a `backlogMax` prop — don't reintroduce either without
 * checking first; the ENA on-duty floor overlay (red outline + "!") is UNCHANGED and still the
 * only per-cell risk flag left, since it's a safety minimum, not a backlog signal (unrelated
 * to R3 — see the resolved call in `.claude/rules/results-redesign.md`).
 */
export function WhppvHeatmap({ cells, shiftMenu }: { cells: WhppvHeatmapCell[]; shiftMenu: ShiftDef[] }) {
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
                  return (
                    <td
                      key={day}
                      className={cell.belowFloor ? 'heat-cell-risk' : undefined}
                      style={{ backgroundColor: visual.background }}
                      title={cellTitle(cell)}
                    >
                      <div className="heat-cell-inner">
                        <span className="heat-cell-value" style={{ color: visual.textColor }}>
                          {cell.onDuty}
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
          Each cell shows the number of nurses on duty. Color is against each hour's OWN typical range (peer
          25th-75th percentile) — a cell reads "leaner" or "richer" relative to what that specific hour usually
          needs, not a single week-wide number.
        </div>
        <div className="heat-legend-risk">
          <span className="heat-legend-risk-swatch">
            <span className="heat-risk-badge">!</span>
          </span>
          <span>Under the ENA on-duty floor</span>
        </div>
      </div>
    </div>
  );
}
