import { DISPLAY_DAY_ORDER, DISPLAY_DAY_LABELS } from '../lib/dayOrder';
import { DAY_LABELS } from '../engine/types';
import type { ShiftDef } from '../engine/types';
import { ratioVisual, type CellVisual } from '../lib/heatmapColor';

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
  // PANEL1_COPY_REVISION_SPEC_2026-07-28.md §7 — per-shift breakdown for hours covered by
  // more than one shift (e.g. "7+4" instead of a summed "11"), ordered by each shift's own
  // startHour. `undefined`/length <= 1 means "single-shift hour" — render the plain `onDuty`
  // number unchanged. Always the FULL breakdown (never just the split-worthy ones) so the
  // tooltip can show it regardless of what the cell text renders.
  perShift?: Array<{ label: string; headcount: number }>;
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
  return ratioVisual(onDuty / denom, bandFloor / denom, bandCeiling / denom);
}

function cellTitle(cell: WhppvHeatmapCell): string {
  const whppvPart = cell.whppv === null ? 'no arrivals recorded' : `${cell.whppv.toFixed(2)} realized wHPPV`;
  let base = `${DAY_LABELS[cell.day]} ${cell.hour.toString().padStart(2, '0')}:00 — ${cell.onDuty}/${cell.requirement} on duty vs. required, ${whppvPart}, ${cell.arrivals} arrivals`;
  // §7 — put the total plus a labeled per-shift breakdown in the tooltip so nothing is lost
  // even when the cell text itself just shows the split ("7+4"), not each shift's label.
  if (cell.perShift && cell.perShift.length > 1) {
    const breakdown = cell.perShift.map((s) => `${s.label}: ${s.headcount}`).join(', ');
    base += `\n${cell.onDuty} total (${breakdown})`;
  }
  return cell.riskReasons.length > 0 ? `${base}\n⚠ ${cell.riskReasons.join('; ')}` : base;
}

/** §7 — "7+4" instead of a summed "11" for hours more than one shift covers. Plain onDuty
 * number, unchanged, for single-shift hours. */
function cellText(cell: WhppvHeatmapCell): string {
  if (cell.perShift && cell.perShift.length > 1) return cell.perShift.map((s) => s.headcount).join('+');
  return String(cell.onDuty);
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
 *
 * PANEL1_COPY_REVISION_SPEC_2026-07-28.md §7/§8 — per-shift split cell text ("7+4" instead of
 * a summed "11") for hours more than one shift covers, ordered by startHour, with the total +
 * full breakdown always in the tooltip; and a legend rewrite (plain prose instead of the old
 * three-swatch leaner/typical/richer row, the ENA-floor line only rendered when at least one
 * displayed cell is actually flagged). See `cellText`/`cellTitle` above and
 * `.claude/rules/results-redesign.md`'s dated section for the judgment call on which toggle
 * views get a real per-shift breakdown vs. a plain number.
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
                          {cellText(cell)}
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
        <div className="heat-legend-line">
          Each cell shows the number of nurses on duty, split by shift when more than one covers that hour.
        </div>
        <div className="heat-legend-line">
          <span className="heat-legend-swatch-inline heat-legend-swatch-lean" />
          Red = short-staffed for how busy this hour runs.
          <span className="heat-legend-swatch-inline heat-legend-swatch-rich" />
          Blue = over-staffed.
        </div>
        {cells.some((c) => c.belowFloor) && (
          <div className="heat-legend-risk">
            <span className="heat-legend-risk-swatch">
              <span className="heat-risk-badge">!</span>
            </span>
            <span>Under the ENA on-duty floor</span>
          </div>
        )}
      </div>
    </div>
  );
}
