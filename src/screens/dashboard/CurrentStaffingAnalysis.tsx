import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import type { ShiftDef } from '../../engine/types';
import { computeBacklog } from '../../engine';
import { lookupWhppvBand } from '../../lib/edbaLookup';
import { EvidenceBadge } from '../../components/EvidenceBadge';

function sortByStartHour(shifts: ShiftDef[]): ShiftDef[] {
  return [...shifts].sort((a, b) => a.startHour - b.startHour);
}

function fmtHour(h: number): string {
  return `${h.toString().padStart(2, '0')}:00`;
}

/**
 * §2.1 opening section: when a current-staffing grid exists, the results page opens with an
 * ANALYSIS of it (not the idealized grid) — realized wHPPV vs. the benchmark band, where it
 * runs lean (the §2.4 backlog/streak diagnostic, framed as "shortfall feeds forward"), and
 * what boarding costs on top. When no current grid exists, a lightweight CTA stands in and
 * the page proceeds to the idealized recommendation below. Templated headline + stat cards,
 * per the Section 2 design pattern.
 */
export function CurrentStaffingAnalysis() {
  const { shiftMenu, arrivals, currentStaffingGrid, getResult, getCurrentStaffingResult } = useStore();

  const result = getResult();
  const current = getCurrentStaffingResult();
  const sortedShiftMenu = useMemo(() => sortByStartHour(shiftMenu), [shiftMenu]);

  // Backlog is computed against the CURRENT grid here (the idealized-grid backlog drives the
  // heatmap overlay in CoreGridTab instead). Hooks run unconditionally — an empty grid is a
  // valid input to computeBacklog — with the render branching on hasCurrentStaffing below.
  const backlog = useMemo(
    () => computeBacklog(currentStaffingGrid ?? {}, result.hourlyRequirement, sortedShiftMenu),
    [currentStaffingGrid, result.hourlyRequirement, sortedShiftMenu]
  );

  const [whyOpen, setWhyOpen] = useState(false);

  const hasCurrentStaffing =
    !!currentStaffingGrid &&
    Object.values(currentStaffingGrid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));

  if (!hasCurrentStaffing) {
    return (
      <section className="card current-analysis-cta">
        <h2>Start with your current staffing</h2>
        <p>
          Add what you actually staff today — in the comparison grid just below, or back in setup — and this page
          will open with an analysis of <em>it</em>: how your realized wHPPV compares to the benchmark band for
          your volume, where you run lean across the week, and what boarding costs you on top. Until then, here's
          the idealized recommendation.
        </p>
      </section>
    );
  }

  const band = lookupWhppvBand(result.annualVisits);
  const realized = current.realizedWHppv;
  const position = realized < band.p25Whppv ? 'below' : realized > band.p75Whppv ? 'above' : 'within';
  const positionWord = position === 'within' ? 'within' : position === 'below' ? 'below' : 'above';

  // Weekly realized-wHPPV range for the CURRENT grid — same scaling approach as CoreGridTab's
  // idealized range (per-day scheduled hrs / arrivals, scaled so the arrivals-weighted mean
  // reproduces the reported weekly realized value). Pure display arithmetic.
  const weeklyArrivals = arrivals.reduce((a, b) => a + b, 0);
  const dailyWHppv: number[] = [];
  if (weeklyArrivals > 0 && current.weeklyScheduledHours > 0) {
    const scale = realized / (current.weeklyScheduledHours / weeklyArrivals);
    for (let day = 0; day < 7; day++) {
      const dayArrivals = arrivals.slice(day * 24, day * 24 + 24).reduce((a, b) => a + b, 0);
      if (dayArrivals <= 0) continue;
      const dayHours = sortedShiftMenu.reduce((acc, s) => acc + (currentStaffingGrid?.[day]?.[s.id] ?? 0) * s.lengthHours, 0);
      dailyWHppv.push((dayHours / dayArrivals) * scale);
    }
  }
  const minWHppv = dailyWHppv.length > 0 ? Math.min(...dailyWHppv) : null;
  const maxWHppv = dailyWHppv.length > 0 ? Math.max(...dailyWHppv) : null;

  // Effective wHPPV after boarding, for CURRENT staffing (previews §2.5).
  const consumed = result.lostProductivity?.wHppvConsumedByBoarding ?? null;
  const effectiveAfterBoarding = consumed !== null ? realized - consumed : null;
  const boardingFte = result.boarding?.annualFte ?? null;

  // Backlog narrative: streak, overnight reset, which shift originates vs. inherits the hole.
  const streak = backlog.longestStreakHours;
  const clearHour = backlog.typicalClearHour;
  const originator = backlog.shiftDiagnostics.reduce(
    (a, b) => (b.generatedBacklog > a.generatedBacklog ? b : a),
    backlog.shiftDiagnostics[0]
  );
  const inheritorPool = backlog.shiftDiagnostics.filter((d) => d.shiftId !== originator?.shiftId);
  const topInheritor =
    inheritorPool.length > 0 ? inheritorPool.reduce((a, b) => (b.inheritedBacklog > a.inheritedBacklog ? b : a)) : null;
  const hasMeaningfulBacklog = backlog.peakBacklog >= 1;

  let backlogClause: string;
  if (backlog.neverClears) {
    backlogClause = 'and it never fully catches up — demand runs ahead of staffing every hour of the week';
  } else if (streak >= 2 && hasMeaningfulBacklog) {
    backlogClause =
      `and when it falls behind, the hole persists for up to ${streak} hours before clearing` +
      (clearHour !== null ? ` (typically around ${fmtHour(clearHour)})` : '');
  } else {
    backlogClause = 'and it keeps pace hour to hour, with no sustained backlog building up';
  }

  return (
    <section className="card current-analysis">
      <div className="grid-header-row">
        <h2>Your current staffing, analyzed</h2>
        <EvidenceBadge status="ASSUMPTION" note="The backlog/'falling behind' diagnostic models how unmet demand feeds forward — a derived assumption, not measured data." />
      </div>

      {/* Templated headline — quotable as-is (spec §0 communication goal). */}
      <p className="comparison-headline">
        Your current staffing realizes <strong>{realized.toFixed(2)} wHPPV</strong>, {positionWord}{' '}
        {position === 'within' ? 'the' : position === 'below' ? 'below the' : 'above the'}{' '}
        <strong>{band.p25Whppv.toFixed(2)}–{band.p75Whppv.toFixed(2)}</strong> typical band for an ED your size, {backlogClause}.
        {effectiveAfterBoarding !== null && (
          <> Boarding pulls the effective figure down to <strong>{effectiveAfterBoarding.toFixed(2)} wHPPV</strong>.</>
        )}
      </p>

      <div className="wHPPV-stats compact">
        <div className="stat">
          <div className="stat-label">Current realized wHPPV</div>
          <div className={`stat-value ${position === 'below' ? 'stat-warning' : ''}`}>{realized.toFixed(2)}</div>
          <div className="stat-sub">{positionWord} the {band.p25Whppv.toFixed(2)}–{band.p75Whppv.toFixed(2)} band</div>
        </div>
        {minWHppv !== null && maxWHppv !== null && (
          <div className="stat">
            <div className="stat-label">Weekly range</div>
            <div className="stat-value">{minWHppv.toFixed(2)}–{maxWHppv.toFixed(2)}</div>
            <div className="stat-sub">leanest to richest day</div>
          </div>
        )}
        <div className="stat">
          <div className="stat-label">Longest lean stretch</div>
          <div className={`stat-value ${streak >= 2 && hasMeaningfulBacklog ? 'stat-warning' : ''}`}>
            {backlog.neverClears ? 'all week' : `${streak} hr${streak === 1 ? '' : 's'}`}
          </div>
          <div className="stat-sub">
            {backlog.neverClears
              ? 'never fully clears'
              : clearHour !== null
                ? `usually clears by ${fmtHour(clearHour)}`
                : 'before catching back up'}
          </div>
        </div>
        {effectiveAfterBoarding !== null && (
          <div className="stat">
            <div className="stat-label">Effective wHPPV after boarding</div>
            <div className="stat-value stat-warning">{effectiveAfterBoarding.toFixed(2)}</div>
            <div className="stat-sub">{consumed!.toFixed(2)} consumed by boarding</div>
          </div>
        )}
        {boardingFte !== null && (
          <div className="stat">
            <div className="stat-label">FTE to fully cover boarding</div>
            <div className="stat-value">{boardingFte.toFixed(1)}</div>
            <div className="stat-sub">additional nursing FTE (previews the boarding section below)</div>
          </div>
        )}
      </div>

      <button className="btn-link why-toggle" onClick={() => setWhyOpen((v) => !v)}>
        {whyOpen ? 'Hide how backlog builds' : 'Why a short hour costs more than one hour'}
      </button>
      {whyOpen && (
        <div className="why-explainer">
          <p>
            In an ED, a short hour doesn't just cost that hour. The patients who couldn't be seen queue into the
            next hour, and it's genuinely hard to recover mid-shift — so a shortfall <em>feeds forward</em>,
            compounding until demand eases (usually the overnight arrivals drop). That's why a lone short hour
            reads very differently from an hour still digging out of a two-hour hole.
          </p>
          {hasMeaningfulBacklog && originator && (
            <p>
              Here, the backlog mostly originates in the <strong>{originator.shiftLabel}</strong> shift
              {topInheritor && topInheritor.inheritedBacklog > 0.5 ? (
                <> and is inherited by the <strong>{topInheritor.shiftLabel}</strong> shift, which walks into a hole it didn't create.</>
              ) : (
                <>.</>
              )}
            </p>
          )}
          <p className="wHPPV-caveat">
            This diagnostic is a modeling assumption (how unmet demand carries and decays), not measured census —
            treat the streak length as directional, not exact.
          </p>
        </div>
      )}
    </section>
  );
}
