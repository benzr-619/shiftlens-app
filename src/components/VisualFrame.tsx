import { useState } from 'react';
import type { ShiftDef } from '../engine/types';
import { WhppvHeatmap, type WhppvHeatmapCell } from './WhppvHeatmap';

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
 * (default/full-week toggle, cross-fade on view change, blank-queue-strip support for Panel 3).
 */
export interface VisualFrameView {
  key: string;
  label: string;
  /** 168 values, index = day*24+hour (engine day-0-is-Sunday convention). */
  demand168: number[];
  capacity168: number[];
  /** The CYCLICAL backlog curve (R4) — never the blended actual curve. `null` renders a BLANK
   * strip on purpose (Panel 3's "after two panels of watching a queue build, the strip is
   * empty — preserve that; it is the most persuasive frame on the page and it is free"). */
  queueDepth168: number[] | null;
  /** Horizontal baseline for the queue strip — the STRUCTURAL floor (a sizing signal), stated
   * as a number alongside the CYCLICAL curve per §3.1's two-sentence framing. `null` draws no
   * baseline (e.g. when `queueDepth168` is also null). */
  structuralFloor: number | null;
  heatmapCells: WhppvHeatmapCell[];
}

function averageDay(values168: number[]): number[] {
  const out = new Array(24).fill(0);
  for (let hour = 0; hour < 24; hour++) {
    let sum = 0;
    for (let day = 0; day < 7; day++) sum += values168[day * 24 + hour] ?? 0;
    out[hour] = sum / 7;
  }
  return out;
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

/** Demand vs. capacity — two lines, the gap shaded. §4's element 1. */
function DemandCapacityChart({ demand, capacity }: { demand: number[]; capacity: number[] }) {
  const width = 640;
  const height = 150;
  const pad = 24;
  const max = Math.max(...demand, ...capacity, 1e-9) * 1.1;
  const gapAbove = demand.map((d, i) => Math.max(d, capacity[i] ?? 0));
  const gapBelow = demand.map((d, i) => Math.min(d, capacity[i] ?? 0));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="frame-demand-chart" role="img" aria-label="Demand versus staffed capacity">
      <path d={`${areaPath(gapAbove, width, height, pad, max)}`} fill="var(--warning)" opacity={0.12} />
      <path d={`${areaPath(gapBelow, width, height, pad, max)}`} fill="var(--bg)" opacity={1} />
      <path d={linePath(demand, width, height, pad, max)} fill="none" stroke="var(--error)" strokeWidth={2} />
      <path d={linePath(capacity, width, height, pad, max)} fill="none" stroke="var(--accent)" strokeWidth={2} />
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="var(--border)" strokeWidth={1} />
    </svg>
  );
}

/** Queue depth strip — §4's element 2, same x-axis as the chart above it. Blank when
 * `queueDepth` is null (Panel 3's deliberately empty strip). */
function QueueStrip({ queueDepth, structuralFloor }: { queueDepth: number[] | null; structuralFloor: number | null }) {
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
    <svg viewBox={`0 0 ${width} ${height}`} className="frame-queue-strip" role="img" aria-label="Queue depth over the week">
      <path d={areaPath(queueDepth, width, height, pad, max)} fill="var(--error)" opacity={0.18} />
      <path d={linePath(queueDepth, width, height, pad, max)} fill="none" stroke="var(--error)" strokeWidth={1.5} />
      {floorY !== null && (
        <line x1={pad} y1={floorY} x2={width - pad} y2={floorY} stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="4,3" />
      )}
    </svg>
  );
}

export function VisualFrame({ views, shiftMenu }: { views: VisualFrameView[]; shiftMenu: ShiftDef[] }) {
  const [activeKey, setActiveKey] = useState(views[0]?.key ?? '');
  const [fullWeek, setFullWeek] = useState(false);
  const active = views.find((v) => v.key === activeKey) ?? views[0];
  if (!active) return null;

  const demand = fullWeek ? active.demand168 : averageDay(active.demand168);
  const capacity = fullWeek ? active.capacity168 : averageDay(active.capacity168);
  const queueDepth = active.queueDepth168 === null ? null : fullWeek ? active.queueDepth168 : averageDay(active.queueDepth168);

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
        <DemandCapacityChart demand={demand} capacity={capacity} />
        <QueueStrip queueDepth={queueDepth} structuralFloor={active.structuralFloor} />
        <WhppvHeatmap cells={active.heatmapCells} shiftMenu={shiftMenu} />
      </div>
    </div>
  );
}
