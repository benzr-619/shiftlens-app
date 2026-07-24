import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { DAY_LABELS, MONTH_LABELS } from '../../engine/types';
import type { Grid, ShiftDef } from '../../engine/types';
import {
  annualBoardingCoveredByWeeklyGrid,
  boardingCoverageFte,
  effectiveEdWhppvAtCoverage,
  recommendWeeklyBoardingGrid,
} from '../../engine/boarding';
import { lookupWhppvBand } from '../../lib/edbaLookup';

const ALL_MONTHS = new Set(Array.from({ length: 12 }, (_, i) => i));

/** Shift-menu columns render in startHour order, same convention as CoreGridTab.tsx — see
 * CLAUDE.md Section 6 ("Shift-menu columns always render sorted by startHour"). */
function sortShiftsByStartHour(shifts: ShiftDef[]): ShiftDef[] {
  return [...shifts].sort((a, b) => a.startHour - b.startHour);
}

function cellKey(day: number, shiftId: string): string {
  return `${day}::${shiftId}`;
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * §2.6 Boarding coverage recommendation (2026-07-24, fourth reversal of this section's shape —
 * see .claude/rules/boarding-seasonality.md). ONE representative-week incremental-headcount
 * grid (same day × shift-menu shape as the core grids), directly editable, pre-filled with the
 * minimal plan that brings effective ED wHPPV back to the p25 band. Month toggles set the
 * SCOPE (which months the one weekly plan is applied to) and scale the stats — they never
 * change the grid's pattern. No day toggle: a day that shouldn't get coverage is edited to 0.
 * Replaces the old annual-aggregated grid whose day-of-week-view cell counts summed a combo
 * across all 12 funded months (a cell could read "+12" against a ~7-FTE headline).
 */
export function BoardingCoverageSection() {
  const { getResult, admitRate, boardingDuration, shiftMenu, wHppvTarget } = useStore();
  const result = getResult();
  const boarding = result.boarding;
  const [whyOpen, setWhyOpen] = useState(false);
  const [activeMonths, setActiveMonths] = useState<Set<number>>(ALL_MONTHS);
  const [cellOverrides, setCellOverrides] = useState<Record<string, number>>({});

  const sortedShiftMenu = useMemo(() => sortShiftsByStartHour(shiftMenu), [shiftMenu]);

  // result.lostProductivity is null iff boarding is null. Compute these (and the recommended
  // grid) unconditionally so all hooks run before the early return below — the useMemo just
  // returns an empty grid when boarding is absent. See React rules-of-hooks.
  const wHppvConsumedByBoarding = result.lostProductivity?.wHppvConsumedByBoarding ?? 0;
  const p25Whppv = lookupWhppvBand(result.annualVisits).p25Whppv;

  // Recommended default grid — the minimal weekly plan reaching the p25 band, computed once at
  // full-year scope. It does NOT change when month toggles change (§2.6: toggles are scope,
  // not pattern).
  const recommendedGrid = useMemo(
    () =>
      boarding
        ? recommendWeeklyBoardingGrid(boarding, sortedShiftMenu, wHppvTarget, p25Whppv, wHppvConsumedByBoarding)
        : {},
    [boarding, sortedShiftMenu, wHppvTarget, p25Whppv, wHppvConsumedByBoarding]
  );

  if (!boarding) {
    return (
      <section className="card boarding-coverage-section">
        <h2>Boarding coverage recommendation</h2>
        <p className="degrade-note">
          Not produced — {admitRate === null ? 'admit rate' : ''}
          {admitRate === null && boardingDuration === null ? ' and ' : ''}
          {boardingDuration === null ? 'boarding duration' : ''} not provided in the data template. This
          output is never estimated from a placeholder — go back to Setup to add it.
        </p>
      </section>
    );
  }

  const hasOverrides = Object.keys(cellOverrides).length > 0;

  // The grid's actual current contents: recommended value for any untouched cell, the user's
  // value otherwise. Built fresh each render (cheap: 7 × shift-count).
  const displayedGrid: Grid = {};
  for (let day = 0; day < 7; day++) {
    displayedGrid[day] = {};
    for (const s of sortedShiftMenu) {
      const key = cellKey(day, s.id);
      displayedGrid[day][s.id] = cellOverrides[key] ?? recommendedGrid[day]?.[s.id] ?? 0;
    }
  }

  // Live stats: the grid's actual contents scaled by the active-month scope. The denominator is
  // always the full annual boarding total, so a toggled-off month or a shift-menu gap honestly
  // caps coverage below 100% (see .claude/rules/boarding-seasonality.md).
  const scopeMonths = boarding.hasMonthlySeasonality ? activeMonths : null;
  const annualCovered = annualBoardingCoveredByWeeklyGrid(displayedGrid, boarding, sortedShiftMenu, scopeMonths);
  const coveredFraction = boarding.annualBoardingHours > 0 ? Math.min(1, annualCovered / boarding.annualBoardingHours) : 0;
  const coveredPct = coveredFraction * 100;
  const fteCovered = boardingCoverageFte(annualCovered);
  const effectiveWhppv = effectiveEdWhppvAtCoverage(wHppvTarget, wHppvConsumedByBoarding, coveredFraction);
  const baselineEffective = wHppvTarget - wHppvConsumedByBoarding; // effective wHPPV at zero boarding coverage

  const activeMonthCount = boarding.hasMonthlySeasonality ? activeMonths.size : 12;
  const showScopeClause = boarding.hasMonthlySeasonality && activeMonthCount < 12;
  const peakMonth = boarding.monthFactors ? boarding.monthFactors.indexOf(Math.max(...boarding.monthFactors)) : null;

  function editCell(day: number, shiftId: string, value: number) {
    setCellOverrides((prev) => ({ ...prev, [cellKey(day, shiftId)]: Math.max(0, value) }));
  }

  return (
    <section className="card boarding-coverage-section">
      <h2>Boarding coverage recommendation</h2>

      {/* Templated headline (fixed structure, numbers interpolated) — quotable per the §2 design pattern. */}
      <p className="comparison-headline">
        Covering boarding fully would take about <strong>{boarding.annualFte.toFixed(1)} extra nursing FTE</strong>
        {peakMonth !== null && (
          <>, with the heaviest need around <strong>{MONTH_LABELS[peakMonth]}</strong></>
        )}
        . The weekly plan below covers <strong>{coveredPct.toFixed(0)}%</strong> of annual boarding hours (
        <strong>{fteCovered.toFixed(1)} FTE</strong>)
        {showScopeClause && (
          <> across the {activeMonthCount} month{activeMonthCount === 1 ? '' : 's'} it's applied to</>
        )}{' '}
        and raises effective ED wHPPV from <strong>{baselineEffective.toFixed(2)}</strong> to{' '}
        <strong>{effectiveWhppv.toFixed(2)}</strong>.
      </p>

      {!boarding.hasMonthlySeasonality && !boarding.hasDayOfWeekSeasonality && (
        <div className="banner banner-info">
          This recommendation is based on your arrivals pattern alone. Add mean boarding duration by month or
          day-of-week to the data template to sharpen where the need concentrates.
        </div>
      )}

      <div className="wHPPV-stats compact">
        <div className="stat">
          <div className="stat-label">% of annual boarding hours covered</div>
          <div className="stat-value">{coveredPct.toFixed(0)}%</div>
        </div>
        <div className="stat">
          <div className="stat-label">Effective ED wHPPV at this coverage</div>
          <div className="stat-value stat-warning">{effectiveWhppv.toFixed(2)}</div>
          <div className="stat-sub">
            up from {baselineEffective.toFixed(2)} · p25 band for this volume {p25Whppv.toFixed(2)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">FTE in this plan</div>
          <div className="stat-value">{fteCovered.toFixed(1)}</div>
          <div className="stat-sub">full year-round coverage would be {boarding.annualFte.toFixed(1)} FTE</div>
        </div>
      </div>

      {boarding.hasMonthlySeasonality && (
        <div className="boarding-scope">
          <div className="optional-label">Apply this weekly plan to which months?</div>
          <div className="button-row boarding-period-toggle">
            {MONTH_LABELS.map((label, m) => (
              <button
                key={label}
                className={`btn-secondary${activeMonths.has(m) ? ' btn-toggle-active' : ''}`}
                onClick={() => setActiveMonths((prev) => toggleInSet(prev, m))}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="wHPPV-caveat">
            These set the <strong>scope</strong> — which months you apply this one weekly plan to. They scale the
            stats above; they do not change the grid's pattern. Covering boarding year-round usually isn't
            realistic, so the default is the minimal plan that brings effective wHPPV back to the p25 band.
          </p>
        </div>
      )}

      <div className="grid-header-row">
        <div className="optional-label">
          {hasOverrides ? 'Weekly coverage plan (edited)' : 'Weekly coverage plan (recommended starting point)'}
        </div>
        {hasOverrides && (
          <button className="btn-link" onClick={() => setCellOverrides({})}>
            Reset to recommended
          </button>
        )}
      </div>
      <p className="wHPPV-caveat">
        One representative week's added headcount per shift — edit any cell directly, same as the grids above; to
        skip a day, set its cells to 0. This is the coverage <em>need</em>. How you staff it — dedicated hold
        nurses, additive ED coverage, float/PRN, a seasonal hire — is a separate tactical choice the grid doesn't
        prescribe cell by cell.
      </p>

      <div className="staffing-grid-wrap">
        <table className="staffing-grid boarding-coverage-grid">
          <thead>
            <tr>
              <th>Day</th>
              {sortedShiftMenu.map((s) => (
                <th key={s.id}>{s.label || s.id}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAY_LABELS.map((label, day) => (
              <tr key={day}>
                <td className="day-cell">{label}</td>
                {sortedShiftMenu.map((s) => {
                  const key = cellKey(day, s.id);
                  const isOverridden = cellOverrides[key] !== undefined;
                  return (
                    <td key={s.id} className={isOverridden ? 'coverage-cell-overridden' : undefined}>
                      <input
                        type="number"
                        min={0}
                        value={displayedGrid[day][s.id]}
                        onChange={(e) => editCell(day, s.id, Number(e.target.value))}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="btn-link why-toggle" onClick={() => setWhyOpen((v) => !v)}>
        {whyOpen ? 'Hide methodology' : 'How is this calculated?'}
      </button>
      {whyOpen && (
        <div className="why-explainer">
          <p>
            There's no direct hourly boarding-census measurement, so we derive one: your arrivals × admit rate
            gives an hourly count of new admissions, and each admission is assumed to board for your entered
            boarding duration — spreading that patient's hold time across the hours that follow. If you gave us
            mean boarding duration by month or day of week, we turn those into a seasonality index and scale the
            base pattern by it.
          </p>
          <p>
            That hourly boarding load is attributed to the shift that covers each hour, then collapsed into{' '}
            <strong>one representative week</strong> of coverage need per (day, shift). The grid above starts
            pre-filled with the minimal weekly plan whose coverage brings effective ED wHPPV up to the p25
            benchmark band — a recommended starting point, not a floor or ceiling. Edit any cell to override it;
            set a day's cells to 0 to skip it.
          </p>
          <p>
            <strong>Month toggles are scope, not pattern.</strong> The one weekly plan doesn't change per season;
            the toggles just choose how many months you apply it to, and the coverage %, FTE, and effective-wHPPV
            stats scale accordingly. The denominator is always your full annual boarding demand, so applying the
            plan to fewer months — or a shift menu with a gap hour no shift covers — honestly shows coverage
            capping below 100%, not a rounding error.
          </p>
          <p>
            <strong>Effective ED wHPPV at this coverage is an assumption, not a validated formula</strong> — it
            assumes covering X% of annual boarding hours recovers exactly X% of the wHPPV boarding consumes,
            linearly. In reality, since the highest-value coverage is funded first, real recovery is more likely
            front-loaded — treat this number as a rough guide, not a precise prediction.
          </p>
          <p>
            A dollar cost layer (RN salary × benefit factor × boarding hours) is designed but not yet built — it
            needs two additional inputs not yet collected.
          </p>
        </div>
      )}
    </section>
  );
}
