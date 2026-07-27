import { useMemo } from 'react';
import { useStore } from '../../store';

/**
 * PR G (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §7) — "Do the extra hours pay for
 * themselves?" Three parts, all rendered here:
 *   1. What the tool CAN show: the mechanism chain in its own units (more hours at the right
 *      times -> less queued work -> fewer abandoned nurse-hours -> fewer LWBS).
 *   2. What it deliberately WON'T do: convert that to dollars. No salary/benefit-factor/
 *      per-visit-margin inputs are collected — a fabricated ROI is the first thing a finance
 *      partner attacks, and losing that exchange costs the manager the whole argument.
 *   3. The worksheet: state the FTE ask + modeled reduction in abandoned nurse-hours, then
 *      name the three numbers their finance partner already owns that turn it into a dollar
 *      figure. Framed as "take these two numbers to your CFO and ask them for those three."
 *
 * Reaffirmed out of scope (spec §13): no dollar/ROI calculator here or anywhere else.
 * `estimatedAbandonedHours` (PR E) never becomes a dollar figure.
 */
export function FinancePartnerWorksheet() {
  const { getResult } = useStore();
  const result = getResult();
  const { marginalCurve, marginalKneePoint, fullCoverage } = result;

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

  if (fullCoverage.fteDelta <= 0 || kneeFte === null || pctSeverityRemoved === null) return null;

  // Modeled, not independently recomputed — see the caveat below. Scales today's estimated
  // abandoned nurse-hours (PR E) by the same severity-reduction fraction the knee-point ask
  // achieves. This is an approximation, labeled as such: estimatedAbandonedHours isn't
  // recomputed against the knee-point grid directly (that would need the trim to expose a
  // grid per marginal-curve point, which it doesn't).
  const abandonedHoursToday = result.estimatedAbandonedHours;
  const modeledAbandonedHoursReduction = abandonedHoursToday * (pctSeverityRemoved / 100);

  return (
    <section className="card finance-partner-worksheet">
      <h2>Do the extra hours pay for themselves?</h2>

      <p>
        More hours at the right times means less queued work, which means fewer nurse-hours of care abandoned to
        LWBS (left-without-being-seen). That chain is something this tool can show in its own units:
      </p>
      <p className="comparison-headline">
        Today, the model estimates about <strong>{abandonedHoursToday.toFixed(0)} nurse-hours a week</strong> of
        queued care are abandoned to attrition. Funding the <strong>~{kneeFte.toFixed(1)} FTE</strong> ask above
        would reduce that by roughly <strong>{modeledAbandonedHoursReduction.toFixed(0)} nurse-hours a week</strong>{' '}
        — a modeled estimate, not an independent recomputation, scaled from the same{' '}
        {pctSeverityRemoved.toFixed(0)}% severity reduction the ask above buys.
      </p>

      <p className="wHPPV-caveat">
        This tool deliberately does not convert any of this to a dollar figure. It collects no salary, benefit-
        factor, or per-visit-margin inputs — a fabricated ROI is the first thing a finance partner attacks, and
        losing that exchange costs the manager the entire argument.
      </p>

      <div className="finance-worksheet-box">
        <p>
          <strong>Take these two numbers to your CFO:</strong> a <strong>~{kneeFte.toFixed(1)} FTE</strong> ask,
          modeled to reduce abandoned nurse-hours by about{' '}
          <strong>{modeledAbandonedHoursReduction.toFixed(0)} hours a week</strong>.
        </p>
        <p>
          <strong>And ask them for these three numbers</strong> — they already have them, and together with the two
          above, they turn this into a dollar figure without this tool guessing at one:
        </p>
        <ul>
          <li>Fully-loaded cost per FTE</li>
          <li>Contribution margin per treated visit</li>
          <li>Your department's current LWBS rate</li>
        </ul>
      </div>
    </section>
  );
}
