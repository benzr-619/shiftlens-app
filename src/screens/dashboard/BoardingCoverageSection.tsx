import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { MONTH_LABELS } from '../../engine/types';
import type { Grid, ShiftDef } from '../../engine/types';
import { DISPLAY_DAY_ORDER, DISPLAY_DAY_LABELS } from '../../lib/dayOrder';
import {
  annualBoardingCoveredByWeeklyGrid,
  annualStaffingHoursForWeeklyGrid,
  boardingCoverageFte,
  effectiveEdWhppvAtCoverage,
  recommendWeeklyBoardingGrid,
} from '../../engine/boarding';
import { lookupWhppvBand } from '../../lib/edbaLookup';
import { NumberCell } from '../../components/NumberCell';

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

  // §2.6.1: the real cost of the grid, vs. the demand it satisfies. Fixed-length shift blocks
  // can't be trimmed to hourly demand, so scheduled (staffing) hours are >= demand-capped
  // (coverage) hours for the same grid — the gap is "efficiency overhead." See
  // .claude/rules/boarding-seasonality.md's last section.
  const annualStaffing = annualStaffingHoursForWeeklyGrid(displayedGrid, boarding, sortedShiftMenu, scopeMonths);
  const fteStaffing = boardingCoverageFte(annualStaffing);
  const efficiencyOverheadFte = Math.max(0, fteStaffing - fteCovered);

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

      {/* §6.1 (2026-07-27 guided-setup-walkthrough prompt) — required wherever BH boarding is
          reported, not optional framing. A 1:10 ratio correctly shows BH boarders draw less
          licensed RN time — reporting that number alone invites exactly the wrong conclusion. */}
      {boarding.bhWeeklyRnHours !== null && (
        <>
          <p className="wHPPV-caveat">
            Medical/surg boarding: <strong>{(boarding.medicalWeeklyRnHours ?? 0).toFixed(1)} RN-hours/week</strong>.
            Behavioral-health boarding: <strong>{boarding.bhWeeklyRnHours.toFixed(1)} RN-hours/week</strong>.
          </p>
          <div className="banner banner-info">
            These figures describe <strong>RN care only</strong>. Behavioral-health boarding places a
            disproportionate burden on techs, sitters, and security, and the operational cost of maintaining
            patient and staff safety for these patients is <strong>understated</strong> by any RN-staffing view
            — including this one.
          </div>
        </>
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
          <div className="stat-label">Boarding hours covered (FTE-equivalent)</div>
          <div className="stat-value">{fteCovered.toFixed(1)}</div>
          <div className="stat-sub">Boarding demand today: {boarding.annualFte.toFixed(1)} FTE if fully covered</div>
        </div>
        <div className="stat">
          <div className="stat-label">Actual FTE to staff this plan</div>
          <div className="stat-value stat-warning">{fteStaffing.toFixed(1)}</div>
          <div className="stat-sub">+{efficiencyOverheadFte.toFixed(1)} FTE efficiency overhead vs. coverage</div>
        </div>
      </div>

      <p className="wHPPV-caveat">
        <strong>Staffing FTE usually runs higher than coverage FTE.</strong> A fixed-length shift (8s, 10s, 12s)
        can't be trimmed to match hourly boarding demand exactly — you're paying for the whole block even in
        hours where the boarding need is lower than what's scheduled. This overhead grows with longer or
        overlapping shifts (like a swing shift), since those are the least demand-shaped.
      </p>

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
            {DISPLAY_DAY_ORDER.map((day, idx) => (
              <tr key={day}>
                <td className="day-cell">{DISPLAY_DAY_LABELS[idx]}</td>
                {sortedShiftMenu.map((s) => {
                  const key = cellKey(day, s.id);
                  const isOverridden = cellOverrides[key] !== undefined;
                  return (
                    <td key={s.id} className={isOverridden ? 'coverage-cell-overridden' : undefined}>
                      <NumberCell
                        value={displayedGrid[day][s.id]}
                        onCommit={(next) => editCell(day, s.id, next)}
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
          {/* PR K (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §10.4) — REWRITTEN from apology to
              shopping list. Ben: "if there is better data / a better way to do this, I should
              look into getting it rather than relying on derivation." Each paragraph now states
              what was COMPUTED, then names the BETTER data that would replace the derivation and
              roughly where it lives — instead of dwelling on what's derived.
              2026-07-27: on the MEASURED path, item 1 of that shopping list is now satisfied —
              rewritten again to say so, per the guided-setup-walkthrough follow-up prompt §6.3. */}
          {boarding.censusSource === 'measured' ? (
            <p>
              <strong>Satisfied:</strong> this uses your directly measured hourly boarding census — patients
              physically in the ED with a bed request placed and no inpatient bed assigned, counted at each hour
              — not a derivation from arrivals and admit rate. No convolution, no admit-timing assumption.
            </p>
          ) : (
            <p>
              <strong>Computed:</strong> an hourly boarding-census curve, from your arrivals × admit rate (new
              admissions per hour) spread across your entered boarding duration, seasonally adjusted if you provided
              monthly/day-of-week means.{' '}
              <strong>Better data, if you can get it:</strong> a directly measured hourly boarding census — most bed-
              management or ADT systems can report actual boarders-in-ED counts by hour (patients with a bed request
              placed and no inpatient bed assigned), which would replace this derivation entirely. Ask your
              bed-management/throughput team whether that report already exists.
            </p>
          )}
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
            capping below 100%, not a rounding error.{' '}
            {boarding.censusSource === 'measured' ? (
              <>
                <strong>Satisfied:</strong> this month factor is weighted by your measured medical and BH census
                streams directly, not a duration proxy.
              </>
            ) : (
              <>
                <strong>Better data, if you can get it:</strong> actual monthly boarding HOURS (not just mean duration)
                from your finance or throughput reporting would let this scale by real seasonal volume, not duration
                alone.
              </>
            )}
          </p>
          <p>
            <strong>Coverage FTE and staffing FTE answer different questions.</strong> Coverage FTE is demand-hours
            satisfied — each cell's contribution is capped at what that cell actually needs. Staffing FTE is what
            you actually schedule — headcount × shift length, uncapped. Since shifts come in fixed blocks, a cell
            almost never needs an exact multiple of the shift length, so staffing FTE is virtually always higher;
            they'd only match if every staffed cell's scheduled hours landed exactly on its demand.
          </p>
          <p>
            <strong>Computed:</strong> "effective ED wHPPV at this coverage" assumes covering X% of annual boarding
            hours recovers exactly X% of the wHPPV boarding consumes, linearly — a placeholder, not a validated
            formula (real recovery, since the highest-value coverage is funded first, is more likely front-loaded).{' '}
            <strong>Better data, if you can get it:</strong> a before/after comparison from a real coverage change
            (a month where boarding staffing measurably increased or decreased) would let this be calibrated
            against your own department instead of assumed.
          </p>
          <p>
            No dollar figure is computed anywhere on this page, by design — see the finance-partner worksheet
            (funding-ask section, above) for the sanctioned way to turn any of this into a cost conversation.
          </p>
        </div>
      )}
    </section>
  );
}
