import { useState } from 'react';
import type { ShiftDef } from '../engine/types';
import { WhppvHeatmap, type WhppvHeatmapCell } from './WhppvHeatmap';
import type { WhppvColorDomain } from '../lib/whppvColorDomain';
import { averageDay } from '../lib/averageDay';
import { DISPLAY_DAY_ORDER, DISPLAY_DAY_LABELS } from '../lib/dayOrder';

/** Reorders a 168-point engine-indexed (day 0 = Sunday) curve into the shared Mon-Sun DISPLAY
 * order (`lib/dayOrder.ts`) — the same convention the staffing tables/heatmap already render
 * in, so the full-week chart/queue-strip x-axis reads left-to-right as Mon..Sun, weekend
 * contiguous at the right edge, instead of splitting Sunday off to the far left. Display-only;
 * does not touch the engine's own day-0-is-Sunday index anywhere else. */
function toDisplayWeekOrder(values168: number[]): number[] {
  const out = new Array(168);
  DISPLAY_DAY_ORDER.forEach((engineDay, displayIdx) => {
    for (let h = 0; h < 24; h++) {
      out[displayIdx * 24 + h] = values168[engineDay * 24 + h];
    }
  });
  return out;
}

/**
 * PR D (RESULTS_PAGE_V2_SPEC_2026-07-27.md §4) — THE SHARED VISUAL FRAME, built once and
 * reused across all five panels. Three stacked elements sharing one x-axis: a demand-vs-
 * capacity line chart, a queue-depth strip directly beneath it, and the (R1/R2/R3-updated)
 * heatmap below that. Only the DATA loaded into it changes per panel, driven by one toggle —
 * the frame itself has no idea which panel it's in; a panel supplies a list of `views` and
 * decides their order/labels.
 *
 * NOT YET WIRED INTO A REAL PANEL as of this PR — Panels 1-5 (PRs E/F/G) are this component's
 * first real callers. Full end-to-end/e2e verification is therefore deferred to whichever PR
 * mounts it first, per §11's instruction to flag rather than fake verification that hasn't
 * happened. The component is still fully self-contained and exercised by its own logic here
 * (full-week/average-day toggle — defaults to full week, cross-fade on view change,
 * blank-queue-strip support for Panel 3).
 */
export interface VisualFrameView {
  key: string;
  label: string;
  /** 168 values, index = day*24+hour (engine day-0-is-Sunday convention). */
  demand168: number[];
  capacity168: number[];
  /** Normally the CYCLICAL backlog curve (R4), not the blended actual curve — EXCEPT Panel 1,
   * which passes the ACTUAL curve as a deliberate, scoped exception
   * (PANEL1_COPY_REVISION_SPEC_2026-07-28.md §5a — Panel 1 wants the department's real,
   * current situation, not a shape-only hypothetical; see .claude/rules/results-redesign.md
   * for the full note). `null` renders a BLANK strip on purpose (Panel 3's "after two panels
   * of watching a queue build, the strip is empty — preserve that; it is the most persuasive
   * frame on the page and it is free"). */
  queueDepth168: number[] | null;
  /** Horizontal baseline for the queue strip — the STRUCTURAL floor (a sizing signal), stated
   * as a number alongside the CYCLICAL curve per §3.1's two-sentence framing. `null` draws no
   * baseline (e.g. when `queueDepth168` is also null). */
  structuralFloor: number | null;
  /** Label above the queue strip. Defaults to "Backlog" — override when a panel's queue curve
   * models something more specific (e.g. Panel 1 always shows arrivals backlog regardless of
   * toggle, since boarders are already physically present and can't "queue" the way an
   * unseen arrival can). */
  queueLabel?: string;
  heatmapCells: WhppvHeatmapCell[];
  /** Label above the heatmap. Defaults to "Staffing heatmap". */
  heatmapLabel?: string;
  /** Optional second line under the heatmap label, naming what this specific toggle's cells
   * are colored against — e.g. "Colored by staffing vs. arrivals demand" vs. "...vs. boarding
   * demand" — so a manager switching toggles knows the color scale changed meaning, not just
   * the numbers. Omitted (no second line) when a panel doesn't supply one. */
  heatmapSubLabel?: string;
}

function linePath(values: number[], width: number, height: number, pad: number, max: number): string {
  const x = (i: number) => pad + (i / Math.max(values.length - 1, 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - (max > 0 ? (v / max) * (height - 2 * pad) : 0);
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
}

function areaPath(values: number[], width: number, height: number, pad: number, max: number): string {
  const x = (i: number) => pad + (i / Math.max(values.length - 1, 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - (max > 0 ? (v / max) * (height - 2 * pad) : 0);
  const top = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return `${top} L ${x(values.length - 1).toFixed(1)} ${(height - pad).toFixed(1)} L ${x(0).toFixed(1)} ${(height - pad).toFixed(1)} Z`;
}

/** Earliest `startHour` across the shift menu — the shift menu applies identically every day
 * (`ShiftDef` has no day-of-week variation), so this one offset is reused for every day. */
function firstShiftStartHour(shiftMenu: ShiftDef[]): number {
  if (shiftMenu.length === 0) return 0;
  return Math.min(...shiftMenu.map((s) => ((s.startHour % 24) + 24) % 24));
}

// PANEL1_COPY_REVISION_SPEC_2026-07-28.md §5d — minimal chart-level labeling (a compact
// legend, one y-axis label, a handful of x-axis ticks) so the small strip stays legible
// without captioning it; the fuller explanation lives in each panel's own prose, not here.
/** A handful of x-axis tick positions/labels — 4 fixed clock points for the 24-point average-
 * day view, one per day-of-week (Mon-Sun DISPLAY order, `lib/dayOrder.ts` — matching the
 * `toDisplayWeekOrder` reorder applied to the underlying curves) for the 168-point full-week
 * view. Never one tick per hour — that's exactly the clutter this is scoped to avoid. Each
 * day's tick sits at that day's FIRST shift start (`firstShiftStartHour`), not at midnight —
 * midnight is rarely when a department's day actually turns over, so a tick there landed
 * mid-shift more often than not; anchoring to the first shift's start makes the tick line up
 * with where the demand/capacity curves themselves visibly step up for the day. */
function xAxisTicks(length: number, shiftMenu: ShiftDef[]): Array<{ pos: number; label: string }> {
  if (length <= 24) {
    return [
      { pos: 0, label: '12a' },
      { pos: 6, label: '6a' },
      { pos: 12, label: '12p' },
      { pos: 18, label: '6p' },
    ];
  }
  const offset = firstShiftStartHour(shiftMenu);
  return DISPLAY_DAY_LABELS.map((label, i) => ({ pos: i * 24 + offset, label }));
}

/** Demand vs. capacity — two lines, the gap shaded. §4's element 1. */
function DemandCapacityChart({ demand, capacity, shiftMenu }: { demand: number[]; capacity: number[]; shiftMenu: ShiftDef[] }) {
  const width = 640;
  const height = 150;
  const pad = 24;
  const max = Math.max(...demand, ...capacity, 1e-9) * 1.1;
  const gapAbove = demand.map((d, i) => Math.max(d, capacity[i] ?? 0));
  const gapBelow = demand.map((d, i) => Math.min(d, capacity[i] ?? 0));
  const ticks = xAxisTicks(demand.length, shiftMenu);
  const xOf = (i: number) => pad + (i / Math.max(demand.length - 1, 1)) * (width - 2 * pad);
  return (
    <>
      <div className="frame-chart-legend">
        <span className="frame-legend-item">
          <span className="frame-legend-swatch frame-legend-swatch-demand" />
          Demand
        </span>
        <span className="frame-legend-item">
          <span className="frame-legend-swatch frame-legend-swatch-capacity" />
          Capacity
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="frame-demand-chart" role="img" aria-label="Demand versus staffed capacity">
        <path d={`${areaPath(gapAbove, width, height, pad, max)}`} fill="var(--warning)" opacity={0.12} />
        <path d={`${areaPath(gapBelow, width, height, pad, max)}`} fill="var(--bg)" opacity={1} />
        <path d={linePath(demand, width, height, pad, max)} fill="none" stroke="var(--error)" strokeWidth={2} />
        <path d={linePath(capacity, width, height, pad, max)} fill="none" stroke="var(--accent)" strokeWidth={2} />
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="var(--border)" strokeWidth={1} />
        <text x={pad} y={12} fontSize={9} fill="var(--text-muted)">
          Nurse-hours
        </text>
        {ticks.map((t) => (
          <text key={t.label} x={xOf(t.pos)} y={height - 6} fontSize={9} fill="var(--text-muted)" textAnchor="middle">
            {t.label}
          </text>
        ))}
      </svg>
    </>
  );
}

/** Queue depth strip — §4's element 2, same x-axis as the chart above it. Blank when
 * `queueDepth` is null (Panel 3's deliberately empty strip). One short label only — no
 * inline caption explaining the mechanism (§5d); the fuller explanation lives in each
 * panel's own surrounding prose. */
function QueueStrip({
  queueDepth,
  structuralFloor,
  label,
}: {
  queueDepth: number[] | null;
  structuralFloor: number | null;
  label: string;
}) {
  const width = 640;
  const height = 60;
  const pad = 24;
  if (queueDepth === null) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="frame-queue-strip frame-queue-strip-blank" role="img" aria-label="Queue depth (no shortfall)">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="var(--border)" strokeWidth={1} />
      </svg>
    );
  }
  const max = Math.max(...queueDepth, structuralFloor ?? 0, 1e-9) * 1.1;
  const floorY = structuralFloor !== null ? height - pad - (structuralFloor / max) * (height - 2 * pad) : null;
  return (
    <>
      <div className="frame-queue-label">{label}</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="frame-queue-strip" role="img" aria-label="Queue depth over the week">
        <path d={areaPath(queueDepth, width, height, pad, max)} fill="var(--error)" opacity={0.18} />
        <path d={linePath(queueDepth, width, height, pad, max)} fill="none" stroke="var(--error)" strokeWidth={1.5} />
        {floorY !== null && (
          <line x1={pad} y1={floorY} x2={width - pad} y2={floorY} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="4,3" />
        )}
      </svg>
    </>
  );
}

export function VisualFrame({
  views,
  shiftMenu,
  whppvBand,
  activeKey: controlledActiveKey,
  onActiveKeyChange,
}: {
  views: VisualFrameView[];
  shiftMenu: ShiftDef[];
  /** The ED's own single peer-typical WHPPV band — same reference for every toggle/view in
   * this frame, passed straight through to the heatmap (see WhppvHeatmap's own header). */
  whppvBand: WhppvColorDomain;
  /** Optional controlled mode — pass both to let a parent panel keep its own left-column
   * stats (e.g. Panel 2's "hours below need," which must update WITH the toggle) in sync
   * with whichever view is active, rather than duplicating the toggle in two places.
   * Uncontrolled (Panel 1's usage) when omitted — the frame owns its own state. */
  activeKey?: string;
  onActiveKeyChange?: (key: string) => void;
}) {
  const [uncontrolledActiveKey, setUncontrolledActiveKey] = useState(views[0]?.key ?? '');
  const activeKey = controlledActiveKey ?? uncontrolledActiveKey;
  const setActiveKey = onActiveKeyChange ?? setUncontrolledActiveKey;
  const [fullWeek, setFullWeek] = useState(true);
  const active = views.find((v) => v.key === activeKey) ?? views[0];
  if (!active) return null;

  const demand = fullWeek ? toDisplayWeekOrder(active.demand168) : averageDay(active.demand168);
  const capacity = fullWeek ? toDisplayWeekOrder(active.capacity168) : averageDay(active.capacity168);
  const queueDepth =
    active.queueDepth168 === null ? null : fullWeek ? toDisplayWeekOrder(active.queueDepth168) : averageDay(active.queueDepth168);

  return (
    <div className="visual-frame">
      {views.length > 1 && (
        <div className="frame-toggle" role="tablist">
          {views.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={v.key === activeKey}
              className={`frame-toggle-btn${v.key === activeKey ? ' frame-toggle-active' : ''}`}
              onClick={() => setActiveKey(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {/* R10/§4 — toggling ANIMATES the transition (cross-fade), not a static swap. `key`
       * forces a remount on view change, and `.frame-body`'s CSS animation fades the new
       * content in — the simple, robust fallback the spec itself sanctions (§10 open item 2)
       * over per-cell tweening, whose performance at 168 cells was explicitly flagged as
       * unassessed. */}
      <div className="frame-body" key={activeKey}>
        <div className="frame-chart-header">
          <span className="frame-chart-label">Demand vs. staffed capacity</span>
          <button type="button" className="btn-link frame-expand-toggle" onClick={() => setFullWeek((v) => !v)}>
            {fullWeek ? 'Show average day' : 'Show full week'}
          </button>
        </div>
        <DemandCapacityChart demand={demand} capacity={capacity} shiftMenu={shiftMenu} />
        <QueueStrip queueDepth={queueDepth} structuralFloor={active.structuralFloor} label={active.queueLabel ?? 'Backlog'} />
        <div className="frame-heatmap-header">
          <span className="frame-heatmap-label">{active.heatmapLabel ?? 'Staffing heatmap'}</span>
          {active.heatmapSubLabel && <span className="frame-heatmap-sublabel">{active.heatmapSubLabel}</span>}
        </div>
        <WhppvHeatmap cells={active.heatmapCells} shiftMenu={shiftMenu} whppvBand={whppvBand} />
      </div>
    </div>
  );
}
