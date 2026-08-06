import { useHoverTooltip } from '../lib/useHoverTooltip';
import { HoverTooltip } from './HoverTooltip';

// Extracted from Panel4.tsx (2026-08-05, Panel 5 redesign) so Panel5.tsx's own "% demand
// covered vs. shifts/week" curve (§9 of the redesign) can reuse the exact same chart instead of
// copy-pasting the SVG. Behavior is byte-identical to the version that used to live inline in
// Panel4.tsx — only the file moved.
export function MarginalReturnsCurve({
  points,
  band,
  markerPoints,
  adjustControl,
}: {
  points: { x: number; y: number }[];
  band: { xMin: number; xMax: number; label: string } | null;
  markerPoints: Array<{ x: number; y: number; label: string; color: string }>;
  /** 2026-08-05 Panel 5 redesign, §3d — a single up/down control rendered next to the "Your
   * scenario" legend entry, replacing the old separate "+ Add best ED/hold shift" button rows.
   * Optional — panels other than Panel 5 don't pass this. */
  adjustControl?: { onIncrement: () => void; onDecrement: () => void } | null;
}) {
  const width = 480;
  const height = 260;
  const padLeft = 36;
  const padBottom = 32;
  const padTop = 16;
  const padRight = 16;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const maxX = Math.max(1e-6, ...points.map((p) => p.x), ...markerPoints.map((m) => m.x), band?.xMax ?? 0);
  const sx = (x: number) => padLeft + (Math.max(0, Math.min(maxX, x)) / maxX) * plotW;
  const sy = (yPct: number) => padTop + plotH - (Math.max(0, Math.min(100, yPct)) / 100) * plotH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
  const { tooltip, showTooltip, moveTooltip, hideTooltip } = useHoverTooltip();

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="marginal-curve-chart"
        role="img"
        aria-label="Percent of demand covered as total scheduled shifts increase, with a shaded band for the peer-typical wHPPV range and points for current staffing and the ShiftLens Solver result"
      >
        {band && (
          <rect
            x={sx(band.xMin)}
            y={padTop}
            width={Math.max(0, sx(band.xMax) - sx(band.xMin))}
            height={plotH}
            fill="var(--text-muted)"
            opacity={0.14}
          />
        )}
        <line x1={padLeft} y1={padTop + plotH} x2={padLeft + plotW} y2={padTop + plotH} stroke="var(--border)" strokeWidth={1} />
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} stroke="var(--border)" strokeWidth={1} />
        {points.length > 0 && <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.5} />}
        {markerPoints.map((m) => {
          // A generously-sized hit-circle carries the hover — the visible dot below (r=6) is
          // deliberately smaller than a comfortable mouse target, so hovering anywhere within
          // ~14px of the dot's center still triggers the tooltip. Native SVG <title> tooltips
          // turned out not to fire reliably (see HoverTooltip.tsx's own header) — this uses the
          // same JS-driven tooltip the heatmap now uses instead of a second native mechanism.
          const title = `${m.label}: ${m.x.toFixed(0)} shifts/week, ${m.y.toFixed(0)}% demand covered`;
          return (
            <g key={m.label}>
              <circle
                cx={sx(m.x)}
                cy={sy(m.y)}
                r={14}
                fill="transparent"
                onMouseEnter={(e) => showTooltip(e, title)}
                onMouseMove={moveTooltip}
                onMouseLeave={hideTooltip}
              />
              <circle cx={sx(m.x)} cy={sy(m.y)} r={6} fill={m.color} stroke="var(--bg-card)" strokeWidth={2} pointerEvents="none" />
            </g>
          );
        })}
        <text x={padLeft + 2} y={padTop + 10} fontSize={12} fill="var(--text-muted)">
          100%
        </text>
        <text x={padLeft + 2} y={padTop + plotH - 2} fontSize={12} fill="var(--text-muted)">
          0%
        </text>
        <text x={padLeft + plotW / 2} y={height - 6} fontSize={13} fill="var(--text-muted)" textAnchor="middle">
          Total shifts/week
        </text>
        <text
          x={12}
          y={padTop + plotH / 2}
          fontSize={13}
          fill="var(--text-muted)"
          textAnchor="middle"
          transform={`rotate(-90 12 ${padTop + plotH / 2})`}
        >
          % demand covered
        </text>
      </svg>
      <HoverTooltip tooltip={tooltip} />
      <div className="marginal-curve-legend">
        {band && (
          <span className="marginal-curve-legend-item">
            <span className="marginal-curve-legend-swatch marginal-curve-legend-swatch-band" />
            {band.label}
          </span>
        )}
        {markerPoints.map((m) => (
          <span key={m.label} className="marginal-curve-legend-item">
            <span className="marginal-curve-legend-swatch marginal-curve-legend-swatch-dot" style={{ background: m.color }} />
            <span>{m.label}</span>
            {m.label === 'Your scenario' && adjustControl && (
              <span className="marginal-curve-adjust">
                <button type="button" className="btn-icon" onClick={adjustControl.onDecrement} aria-label="Remove one unit from your scenario">
                  −
                </button>
                <button type="button" className="btn-icon" onClick={adjustControl.onIncrement} aria-label="Add one unit to your scenario">
                  +
                </button>
              </span>
            )}
          </span>
        ))}
      </div>
    </>
  );
}
