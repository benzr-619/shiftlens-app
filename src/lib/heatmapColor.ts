// The generic neutral-band + log-ratio + asymmetric-ramp color mechanism behind
// `WhppvHeatmap.tsx`'s per-cell coloring — split into its own `lib/` file (2026-07-28, Panel
// 2's per-shift wHPPV coloring, a second consumer) for the same reason `whppvColorDomain.ts`
// documents for `computeColorDomain`: a component file exporting a non-component function
// trips oxlint's fast-refresh rule.
//
// Display heuristics below are safe to tune, not load-bearing math. Nonlinear on BOTH sides:
// nearly flat just outside the neutral band, accelerating with distance (t^GAMMA, GAMMA>1).
// The asymmetry is in how far each side has to travel to reach full saturation, not the curve
// shape itself:
//  - Lean side saturates fast: half the lower band edge already reads fully alarming.
//  - Rich side ramps slowly and clamps early (~2x the point target) — beyond that it's just
//    "plenty of staff overnight," no further shades needed.
const COLOR_EASE_GAMMA = 1.8;
const LEAN_FULL_SATURATE_RATIO = 0.5; // ratio at HALF the lower band edge -> fully saturated lean
const RICH_CLAMP_MULTIPLE = 2; // ratio at 2x the point target (1.0) -> fully saturated rich
const MIN_ALPHA = 0.12;
const MAX_ALPHA = 0.75;
const LEANER_RGB = '194,59,59'; // red — understaffing is the safety/quality signal, stays dominant
const RICHER_RGB = '37,99,235'; // saturated blue
const TEXT_FLIP_ALPHA_THRESHOLD = 0.45; // above this fill alpha, cell text flips to white for contrast

export interface CellVisual {
  background: string;
  textColor: string | undefined; // undefined = inherit theme text color
}

/**
 * `ratio`/`low`/`high` are all already normalized to the same reference point (1.0 = "at
 * target"). The heatmap normalizes by a cell's own `requirement`; Panel 2's per-shift wHPPV
 * coloring normalizes by `wHppvTarget` (via `computeColorDomain`) — same shape, different
 * denominator.
 */
export function ratioVisual(ratio: number, low: number, high: number): CellVisual {
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
