import { DAY_LABELS } from '../engine/types';

export interface WhppvHeatmapCell {
  day: number;
  hour: number;
  whppv: number | null; // null = no arrivals recorded that hour, ratio uncomputable
  onDuty: number;
  requirement: number;
  arrivals: number;
  belowFloor: boolean; // under the ENA on-duty floor — a safety check, red outline + "!"
  backlog: number; // nurse-hours of accumulated backlog at this hour (idealized grid)
  inBacklogStreak: boolean; // backlog at/above the "caught up" threshold — the §2.4 overlay
  riskReasons: string[];
}

// Diverging pair (leaner/red <-> richer/blue) with a near-transparent neutral midpoint at
// the target — alpha scales with distance from target, mirroring the intensity-by-alpha
// approach already used in ArrivalsGrid, rather than introducing a separate color system.
const RICHER_RGB = '37,106,191';
const LEANER_RGB = '194,59,59';
const CAP = 0.5; // deviation from target, as a fraction of target, that reaches full saturation

function heatColor(whppv: number | null, target: number): string {
  if (whppv === null || target <= 0) return 'var(--bg-card-muted)';
  const ratio = Math.max(-1, Math.min(1, (whppv - target) / target / CAP));
  const alpha = 0.1 + Math.abs(ratio) * 0.55;
  const rgb = ratio >= 0 ? RICHER_RGB : LEANER_RGB;
  return `rgba(${rgb},${alpha.toFixed(2)})`;
}

function cellTitle(cell: WhppvHeatmapCell): string {
  const base = `${DAY_LABELS[cell.day]} ${cell.hour.toString().padStart(2, '0')}:00 — ${
    cell.whppv === null ? 'no arrivals recorded' : `${cell.whppv.toFixed(2)} realized wHPPV`
  }, ${cell.onDuty} on duty, ${cell.arrivals} arrivals, ${cell.requirement} req'd`;
  return cell.riskReasons.length > 0 ? `${base}\n⚠ ${cell.riskReasons.join('; ')}` : base;
}

/**
 * 7x24 realized-wHPPV heatmap. Color is continuous and centered on `wHppvTarget` (richer/
 * leaner than what was asked for, not an absolute judgment) — the flags are deliberately
 * separate visual treatments (never color-alone), since a cell can read as a mild color while
 * still failing a check. Two independent overlays: a red outline + "!" for an ENA on-duty
 * floor violation (a safety minimum), and an amber corner dot for hours carrying a backlog —
 * the §2.4 "still digging out" diagnostic that superseded the old single-hour p25 flag.
 */
export function WhppvHeatmap({ cells, wHppvTarget }: { cells: WhppvHeatmapCell[]; wHppvTarget: number }) {
  const byDayHour = new Map(cells.map((c) => [`${c.day}-${c.hour}`, c]));

  return (
    <div className="whppv-heatmap-wrap">
      <table className="whppv-heatmap">
        <thead>
          <tr>
            <th className="hour-col">Hour</th>
            {DAY_LABELS.map((d) => (
              <th key={d}>{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 24 }, (_, hour) => (
            <tr key={hour}>
              <td className="hour-col">{hour.toString().padStart(2, '0')}:00</td>
              {DAY_LABELS.map((_, day) => {
                const cell = byDayHour.get(`${day}-${hour}`);
                if (!cell) return <td key={day} />;
                const cellClass = [cell.belowFloor ? 'heat-cell-risk' : '', cell.inBacklogStreak ? 'heat-cell-backlog' : '']
                  .filter(Boolean)
                  .join(' ');
                return (
                  <td
                    key={day}
                    className={cellClass || undefined}
                    style={{ backgroundColor: heatColor(cell.whppv, wHppvTarget) }}
                    title={cellTitle(cell)}
                  >
                    <div className="heat-cell-inner">
                      <span className="heat-cell-value">{cell.whppv === null ? '—' : cell.whppv.toFixed(1)}</span>
                      {cell.belowFloor && <span className="heat-risk-badge">!</span>}
                      {cell.inBacklogStreak && <span className="heat-backlog-dot" />}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="whppv-heatmap-legend">
        <div className="heat-legend-gradient">
          <span>Leaner</span>
          <span className="heat-legend-bar" />
          <span>target {wHppvTarget}</span>
          <span className="heat-legend-bar heat-legend-bar-richer" />
          <span>Richer</span>
        </div>
        <div className="heat-legend-risk">
          <span className="heat-legend-risk-swatch">
            <span className="heat-risk-badge">!</span>
          </span>
          <span>Under the ENA on-duty floor</span>
        </div>
        <div className="heat-legend-risk">
          <span className="heat-legend-risk-swatch">
            <span className="heat-backlog-dot" />
          </span>
          <span>Carrying a backlog — still catching up from an earlier hour</span>
        </div>
      </div>
    </div>
  );
}
