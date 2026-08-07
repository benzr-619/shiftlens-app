import { DISPLAY_DAY_ORDER, DISPLAY_DAY_LABELS } from '../lib/dayOrder';
import { DAY_LABELS } from '../engine/types';
import type { ShiftDef } from '../engine/types';
import { ratioVisual, type CellVisual } from '../lib/heatmapColor';
import type { WhppvColorDomain } from '../lib/whppvColorDomain';
import { useHoverTooltip } from '../lib/useHoverTooltip';
import { HoverTooltip } from './HoverTooltip';

export interface WhppvHeatmapCell {
  day: number;
  hour: number;
  onDuty: number;
  requirement: number;
  /** Same quantity as `requirement`, before `Math.ceil` (engine/index.ts's `hourlyRequirement =
   * cellCoreHoursSmoothed.map(Math.ceil)`) — `requirement` stays the solver's actual integer
   * target (used for coloring/floor comparisons elsewhere); this is tooltip-display-only, so a
   * genuinely fractional demand curve doesn't read as a suspiciously round number. */
  demandRaw: number;
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

/** Realized WHPPV for one cell — nurse-hours on duty ÷ arrivals that hour. `null` when there
 * were no arrivals (no meaningful per-visit ratio, renders neutral). */
function cellRealizedWhppv(cell: WhppvHeatmapCell): number | null {
  return cell.arrivals > 0 ? cell.onDuty / cell.arrivals : null;
}

/**
 * 2026-08-05 — color reversed back to a SINGLE week-level WHPPV band (same numbers driving the
 * "ranges from X to Y" prose sentence every panel already shows), not a per-hour one. The prior
 * per-hour-band mechanism colored a cell by `onDuty/requirement` against THAT HOUR's own
 * scaled band — mathematically the same peer band, just necessarily rescaled by that hour's
 * own volume so headcount stayed comparable, but the practical effect read as "some hours have
 * a different bar than others" and didn't line up with which hour prose called out as the
 * week's actual WHPPV extreme (an hour can be the real outlier and still sit inside its own
 * volume-scaled band). Comparing the SAME realized-WHPPV number the prose already cites against
 * ONE fixed band fixes that mismatch directly, at the cost of more noise on very-low-volume
 * cells (a couple of arrivals can swing WHPPV a lot). Normalized by `domain.target` (ratio 1.0
 * = "at target") so `ratioVisual`'s asymmetric-ramp constants apply the same way Panel 2's own
 * per-shift WHPPV coloring already uses them (see lib/heatmapColor.ts's own header).
 */
function cellVisual(cell: WhppvHeatmapCell, domain: WhppvColorDomain): CellVisual {
  const realized = cellRealizedWhppv(cell);
  if (realized === null) return { background: 'transparent', textColor: undefined };
  const denom = Math.max(domain.target, 1e-6);
  return ratioVisual(realized / denom, domain.low / denom, domain.high / denom);
}

function cellTitle(cell: WhppvHeatmapCell): string {
  const realized = cellRealizedWhppv(cell);
  const whppvPart = realized === null ? 'no arrivals recorded' : `${realized.toFixed(2)} realized WHPPV`;
  // onDuty is a headcount — always a whole number of nurses, never fractional, so it's never
  // toFixed'd. demandRaw/arrivals are fractional (allocation shares, arrival-rate averages),
  // rounded consistently to 2dp so they don't print long floats.
  let base = `${DAY_LABELS[cell.day]} ${cell.hour.toString().padStart(2, '0')}:00 — ${cell.onDuty}/${cell.demandRaw.toFixed(2)} on duty vs. demand, ${whppvPart}, ${cell.arrivals.toFixed(2)} arrivals`;
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
 * headcount alone (`onDuty`), not `onDuty/requirement`. Color carries the over/under-typical
 * judgment instead, so a second number doesn't do the same job (see `cellVisual`'s own header
 * for the 2026-08-05 change to what color is computed against).
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
export function WhppvHeatmap({
  cells,
  shiftMenu,
  whppvBand,
}: {
  cells: WhppvHeatmapCell[];
  shiftMenu: ShiftDef[];
  /** The ED's own single peer-typical WHPPV band (25th-75th percentile for its volume,
   * widened to include its own target — see whppvColorDomain.ts) — SAME reference for every
   * cell regardless of hour. Computed once per panel via `computeColorDomain`, not per cell. */
  whppvBand: WhppvColorDomain;
}) {
  const byDayHour = new Map(cells.map((c) => [`${c.day}-${c.hour}`, c]));
  const boundaries = shiftBoundariesByHour(shiftMenu);
  const { tooltip, showTooltip, moveTooltip, hideTooltip } = useHoverTooltip();

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
                  const visual = cellVisual(cell, whppvBand);
                  const title = cellTitle(cell);
                  return (
                    <td
                      key={day}
                      className={cell.belowFloor ? 'heat-cell-risk' : undefined}
                      style={{ backgroundColor: visual.background }}
                      onMouseEnter={(e) => showTooltip(e, title)}
                      onMouseMove={moveTooltip}
                      onMouseLeave={hideTooltip}
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
      <HoverTooltip tooltip={tooltip} />
      <div className="whppv-heatmap-legend">
        <div className="heat-legend-line">
          Each cell shows the number of nurses on duty, split by shift when more than one covers that hour.
        </div>
        <div className="heat-legend-line">
          <span className="heat-legend-swatch-inline heat-legend-swatch-lean" />
          Red = this hour's realized WHPPV falls below your peer-typical range.
          <span className="heat-legend-swatch-inline heat-legend-swatch-rich" />
          Blue = above it.
        </div>
        <div className="heat-legend-line">
          Peer-typical range: <strong>{whppvBand.low.toFixed(2)}–{whppvBand.high.toFixed(2)} WHPPV</strong> (25th–75th
          percentile for EDs your size).
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
