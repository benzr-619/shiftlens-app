import { useMemo } from 'react';
import { useStore } from '../../store';
import { DAY_LABELS } from '../../engine/types';

function fmtHour(h: number): string {
  return `${h.toString().padStart(2, '0')}:00`;
}

/** Cheap inline SVG line chart for the marginal curve — self-contained, no charting library.
 * X = cumulativeHoursAdded (read left-to-right as "hours added back toward full coverage"),
 * Y = totalSeverity (inverted visually — lower severity draws higher on the chart, since
 * "up" reading as "better" is the intuitive direction for a manager). */
function MarginalCurveChart({
  points,
  kneePoint,
}: {
  points: Array<{ cumulativeHoursAdded: number; totalSeverity: number }>;
  kneePoint: number | null;
}) {
  if (points.length < 2) return null;
  const width = 560;
  const height = 160;
  const pad = 28;
  const maxX = Math.max(...points.map((p) => p.cumulativeHoursAdded));
  const maxY = Math.max(...points.map((p) => p.totalSeverity), 1e-9);
  const x = (v: number) => pad + (v / Math.max(maxX, 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - (v / maxY) * (height - 2 * pad);

  // Reverse for display: chart reads left (capHours, worst) -> right (full coverage, best) —
  // matches "read the trajectory backwards" framing (PR D change 1).
  const displayPoints = [...points].reverse();
  const pathD = displayPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(maxX - p.cumulativeHoursAdded).toFixed(1)} ${y(p.totalSeverity).toFixed(1)}`)
    .join(' ');

  const kneeX = kneePoint !== null ? x(maxX - kneePoint) : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="marginal-curve-chart" role="img" aria-label="Marginal returns to added hours">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="var(--border)" strokeWidth={1} />
      <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {kneeX !== null && (
        <line x1={kneeX} y1={pad} x2={kneeX} y2={height - pad} stroke="var(--warning)" strokeWidth={1} strokeDasharray="4,3" />
      )}
      <text x={pad} y={height - 8} fontSize={10} fill="var(--text-muted)">
        today
      </text>
      <text x={width - pad} y={height - 8} fontSize={10} fill="var(--text-muted)" textAnchor="end">
        full coverage
      </text>
    </svg>
  );
}

/**
 * 2026-07-26 PR D (SOLVER_REALISM_SPEC_2026-07-26.md, change 3) — "What this schedule costs
 * you, and what closing the gap buys." Until now the tool's only answer to "do I need more
 * staff?" was "here's how to spend what your own wHPPV target implies" — solveFullCoverageDay's
 * never-short-at-any-hour grid was computed and thrown away. This section surfaces it directly,
 * plus the marginal-return curve (change 1/2) read backwards: a genuine diminishing-returns
 * curve, for free, since the trim is greedy cheapest-first.
 */
export function FundingAskSection() {
  const { getResult, wHppvTarget } = useStore();
  const result = getResult();
  const { fullCoverage, marginalCurve, marginalKneePoint } = result;

  const gapHours = Math.max(0, fullCoverage.weeklyHours - result.weeklyScheduledHours);
  const alreadyFunded = fullCoverage.fteDelta <= 0;

  const worstPoint = marginalCurve.length > 0 ? marginalCurve[marginalCurve.length - 1] : null;
  const kneePointData = useMemo(
    () => (marginalKneePoint !== null ? marginalCurve.find((p) => p.cumulativeHoursAdded === marginalKneePoint) ?? null : null),
    [marginalCurve, marginalKneePoint]
  );
  const kneeFte = marginalKneePoint !== null ? (marginalKneePoint * 52) / 2080 : null;
  const pctSeverityRemoved =
    kneePointData && worstPoint && worstPoint.totalSeverity > 0
      ? Math.max(0, Math.min(100, ((worstPoint.totalSeverity - kneePointData.totalSeverity) / worstPoint.totalSeverity) * 100))
      : null;
  const worstStretchLabel = worstPoint?.longestLeanStretchStart
    ? `${DAY_LABELS[worstPoint.longestLeanStretchStart.day]} ${fmtHour(worstPoint.longestLeanStretchStart.hour)}`
    : null;

  return (
    <section className="card funding-ask-section">
      <h2>What this schedule costs you, and what closing the gap buys</h2>

      {alreadyFunded ? (
        <p className="comparison-headline">
          Full coverage of every hour would take <strong>{fullCoverage.weeklyHours.toFixed(0)} hrs/week</strong> — and
          what delivering your target already funds covers that (equivalent to running at{' '}
          {fullCoverage.impliedWhppv.toFixed(2)} wHPPV, at or below your {wHppvTarget} target). There's no funding
          ask to make here; the idealized grid above already covers every hour without trimming.
        </p>
      ) : (
        <>
          {/* PR G (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §7) — REFRAMED to lead with the
              KNEE of the marginal curve (the ask that buys the most per FTE), with full
              coverage shown as the far end of a range, not the headline. The old framing led
              with full coverage (+14.9 FTE for the source department — unsellable) and buried
              the knee (+2.7 FTE, which captured most of the benefit) as an afterthought. */}
          <p className="comparison-headline">
            {kneeFte !== null && pctSeverityRemoved !== null ? (
              <>
                The ask that buys the most: about <strong>{kneeFte.toFixed(1)} FTE</strong> removes roughly{' '}
                <strong>{pctSeverityRemoved.toFixed(0)}%</strong> of the modeled queued-patient-work
                {worstPoint && worstPoint.longestLeanStretchHours >= 168 ? (
                  <> and ends the week-long stretch where backlog never fully clears</>
                ) : worstStretchLabel && worstPoint && worstPoint.longestLeanStretchHours > 0 ? (
                  <>
                    {' '}
                    and eliminates the <strong>{worstPoint.longestLeanStretchHours}-hour {worstStretchLabel}</strong>{' '}
                    stretch
                  </>
                ) : null}
                . Past about {kneeFte.toFixed(1)} FTE, each additional FTE buys progressively less — full coverage of
                every hour, the far end of that range, would take{' '}
                <strong>{fullCoverage.weeklyHours.toFixed(0)} hrs/week</strong> in total (
                <strong>{fullCoverage.fteDelta.toFixed(1)} FTE</strong> above what delivering your target costs
                today), equivalent to running at {fullCoverage.impliedWhppv.toFixed(2)} wHPPV instead of your{' '}
                {wHppvTarget} target.
              </>
            ) : (
              <>
                Full coverage of every hour would take <strong>{fullCoverage.weeklyHours.toFixed(0)} hrs/week</strong>.
                What delivering your target costs today funds{' '}
                <strong>{result.weeklyScheduledHours.toFixed(0)}</strong> — a{' '}
                <strong>{gapHours.toFixed(0)}-hour gap</strong>, about{' '}
                <strong>{fullCoverage.fteDelta.toFixed(1)} FTE</strong>, equivalent to running at{' '}
                <strong>{fullCoverage.impliedWhppv.toFixed(2)} wHPPV</strong> instead of your {wHppvTarget} target.
              </>
            )}
          </p>

          {marginalCurve.length >= 2 && (
            <>
              <MarginalCurveChart points={marginalCurve} kneePoint={marginalKneePoint} />
              <p className="wHPPV-caveat">
                Read right-to-left: this traces the trim's own cheapest-cut-first order, so it's a genuine
                diminishing-returns curve, not a fitted one. The dashed line (if shown) marks where returns visibly
                flatten.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
