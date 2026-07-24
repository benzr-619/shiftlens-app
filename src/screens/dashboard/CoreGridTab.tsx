import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { DAY_LABELS } from '../../engine/types';
import type { ShiftDef } from '../../engine/types';
import { coverageForDay } from '../../engine/solver';
import { computeBacklog, BACKLOG_CAUGHT_UP_THRESHOLD } from '../../engine';
import { CurrentStaffingGrid } from '../../components/CurrentStaffingGrid';
import { WhppvHeatmap, type WhppvHeatmapCell } from '../../components/WhppvHeatmap';
import { CurrentStaffingAnalysis } from './CurrentStaffingAnalysis';

/** Shift-menu columns render in startHour order, not upload/creation order — a mid-shift
 * must sit between Day and Night rather than tacking onto the end. */
function sortShiftsByStartHour(shifts: ShiftDef[]): ShiftDef[] {
  return [...shifts].sort((a, b) => a.startHour - b.startHour);
}

export function CoreGridTab() {
  const {
    shiftMenu,
    arrivals,
    gridOverride,
    editGridCell,
    resetGridOverride,
    currentStaffingGrid,
    resetCurrentStaffingGrid,
    getCurrentStaffingResult,
    getResult,
    getLiveResult,
    wHppvTarget,
  } = useStore();

  const result = getResult();
  const live = getLiveResult();
  const currentStaffing = getCurrentStaffingResult();

  const grid = gridOverride ?? result.grid;
  const weeklyScheduledHours = live?.weeklyScheduledHours ?? result.weeklyScheduledHours;
  const shortfall = live?.shortfall ?? result.shortfall;
  const realizedWHppv = live?.realizedWHppv ?? (weeklyScheduledHours * 52) / result.annualVisits;
  const overcoveragePct = result.weeklyBudgetHours > 0 ? (weeklyScheduledHours - result.weeklyBudgetHours) / result.weeklyBudgetHours : 0;

  const sortedShiftMenu = useMemo(() => sortShiftsByStartHour(shiftMenu), [shiftMenu]);

  // Has the user entered any current staffing at all? An all-zero/unset grid is a valid
  // engine state (getCurrentStaffingResult treats it as "0 everywhere"), but for the
  // narrative comparison it reads as "nothing to compare yet" — show a CTA instead of a
  // misleading budget/shape verdict against a blank grid. See spec §2.1/§2.2.
  const hasCurrentStaffing =
    !!currentStaffingGrid &&
    Object.values(currentStaffingGrid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));

  // Total-hours reconciliation (spec §2.2 / §4.4): is the divergence from current a BUDGET
  // gap (wrong total, roughly right shape → the ask is more/fewer funded hours) or a SHAPE
  // gap (right total, wrong distribution → the ask is redistribution, not budget)? Pure
  // client-side arithmetic over the two grids — no engine involvement, no re-solve.
  //   underHours = hours the idealized grid wants ON TOP OF current (cells ideal > current)
  //   overHours  = hours current staffs ABOVE the idealized grid   (cells current > ideal)
  // Their signed difference is the net total mismatch (the budget component); the smaller of
  // the two is the pure-redistribution amount (the shape component) — hours you'd have to
  // move from over-staffed shifts to under-staffed ones even if the totals already matched.
  let underHours = 0;
  let overHours = 0;
  for (let day = 0; day < 7; day++) {
    for (const s of sortedShiftMenu) {
      const diffHours = ((grid[day]?.[s.id] ?? 0) - (currentStaffingGrid?.[day]?.[s.id] ?? 0)) * s.lengthHours;
      if (diffHours > 0) underHours += diffHours;
      else overHours += -diffHours;
    }
  }
  const budgetGapHours = underHours - overHours; // net; == idealized weekly hours − current weekly hours
  const shapeGapHours = Math.min(underHours, overHours); // offsetting/redistribution portion
  const absBudgetGap = Math.abs(budgetGapHours);
  const totalMismatch = absBudgetGap + shapeGapHours;
  // "Primarily" thresholds: whichever component is <20% of the total is treated as minor.
  const gapKind: 'none' | 'budget' | 'shape' | 'both' =
    totalMismatch < 1
      ? 'none'
      : shapeGapHours < 0.2 * totalMismatch
        ? 'budget'
        : absBudgetGap < 0.2 * totalMismatch
          ? 'shape'
          : 'both';

  const shortfallByDay = new Map<number, typeof shortfall>();
  for (const entry of shortfall) {
    if (!shortfallByDay.has(entry.day)) shortfallByDay.set(entry.day, []);
    shortfallByDay.get(entry.day)!.push(entry);
  }

  const [whyOpen, setWhyOpen] = useState(false);

  // Per-cell realized wHPPV, for the 7x24 heatmap: same convention as the daily range below
  // (scheduled hours / arrivals for that cell, scaled so the arrivals-weighted average
  // reproduces the reported weekly realizedWHppv exactly) — just at hour grain instead of
  // day grain. Pure display arithmetic over already-computed fields, no engine changes.
  const enaFloorViolations = live?.enaFloorViolationsRemaining ?? result.enaFloorViolationsRemaining;
  const floorViolationSet = useMemo(
    () => new Set(enaFloorViolations.map((v) => `${v.day}-${v.hour}`)),
    [enaFloorViolations]
  );
  // §2.4 backlog overlay: the idealized grid's hour-by-hour backlog drives the heatmap's
  // "still digging out" marker. This SUPERSEDES the old single-hour p25 red-outline flag
  // (a streak is strictly more informative than a lone short hour — resolved with Ben
  // 2026-07-24); the ENA on-duty floor flag stays, as it's an absolute safety check, not a
  // demand-backlog signal. See .claude/rules/results-redesign.md.
  const idealBacklog = useMemo(
    () => computeBacklog(grid, result.hourlyRequirement, sortedShiftMenu),
    [grid, result.hourlyRequirement, sortedShiftMenu]
  );
  const heatmapCells: WhppvHeatmapCell[] = useMemo(() => {
    const weeklyArrivalsForScale = arrivals.reduce((a, b) => a + b, 0);
    const scale =
      weeklyArrivalsForScale > 0 && weeklyScheduledHours > 0
        ? realizedWHppv / (weeklyScheduledHours / weeklyArrivalsForScale)
        : null;

    const cells: WhppvHeatmapCell[] = [];
    for (let day = 0; day < 7; day++) {
      const coverage = coverageForDay(grid[day] ?? {}, sortedShiftMenu);
      for (let hour = 0; hour < 24; hour++) {
        const cellArrivals = arrivals[day * 24 + hour] ?? 0;
        const whppv = scale !== null && cellArrivals > 0 ? (coverage[hour] / cellArrivals) * scale : null;
        const belowFloor = floorViolationSet.has(`${day}-${hour}`);
        const cellBacklog = idealBacklog.backlog[day * 24 + hour] ?? 0;
        const inBacklogStreak = cellBacklog >= BACKLOG_CAUGHT_UP_THRESHOLD;
        const riskReasons: string[] = [];
        if (belowFloor) riskReasons.push('below the ENA on-duty floor');
        if (inBacklogStreak) riskReasons.push(`carrying ~${cellBacklog.toFixed(1)} nurse-hrs of backlog (still catching up)`);
        cells.push({
          day,
          hour,
          whppv,
          onDuty: coverage[hour],
          requirement: result.hourlyRequirement[day * 24 + hour] ?? 0,
          arrivals: cellArrivals,
          belowFloor,
          backlog: cellBacklog,
          inBacklogStreak,
          riskReasons,
        });
      }
    }
    return cells;
  }, [grid, sortedShiftMenu, arrivals, weeklyScheduledHours, realizedWHppv, idealBacklog, floorViolationSet, result.hourlyRequirement]);

  // Realized wHPPV range across the week: per-day scheduled hours vs. per-day arrivals,
  // scaled so the arrivals-weighted average reproduces the reported weekly realizedWHppv
  // exactly. Pure display arithmetic over already-computed fields — no engine changes.
  const weeklyArrivals = arrivals.reduce((a, b) => a + b, 0);
  const dailyWHppv: number[] = [];
  if (weeklyArrivals > 0 && weeklyScheduledHours > 0) {
    const scale = realizedWHppv / (weeklyScheduledHours / weeklyArrivals);
    for (let day = 0; day < 7; day++) {
      const dayArrivals = arrivals.slice(day * 24, day * 24 + 24).reduce((a, b) => a + b, 0);
      if (dayArrivals <= 0) continue;
      const dayHours = sortedShiftMenu.reduce((acc, s) => acc + (grid[day]?.[s.id] ?? 0) * s.lengthHours, 0);
      dailyWHppv.push((dayHours / dayArrivals) * scale);
    }
  }
  const minWHppv = dailyWHppv.length > 0 ? Math.min(...dailyWHppv) : null;
  const maxWHppv = dailyWHppv.length > 0 ? Math.max(...dailyWHppv) : null;

  const overText =
    overcoveragePct >= 0
      ? `${(overcoveragePct * 100).toFixed(0)}% over your weekly hours budget`
      : `${Math.abs(overcoveragePct * 100).toFixed(0)}% under your weekly hours budget`;

  return (
    <div className="core-grid-tab">
      {/* §3: the "no ESI mix" confidence-caveat banner was removed (UI-copy only — ESI mix,
          acuity weighting, and the ESI template tab all stay in the engine unchanged). */}
      {!result.reconciliation.passes && (
        <div className="banner banner-error">
          Reconciliation check failed: the 168-cell allocation does not reproduce the annual budget exactly
          (gap {(result.reconciliation.gapPct * 100).toFixed(4)}%). This indicates a calculation bug — results
          below should not be trusted until this is resolved.
        </div>
      )}

      {/* §2.1: the page opens with an analysis of CURRENT staffing (or a CTA if none entered),
          before the idealized recommendation. Surfaces the §2.4 backlog diagnostic. */}
      <CurrentStaffingAnalysis />

      <section className="card plain-summary">
        <h2>What this schedule means</h2>
        <ul className="plain-summary-list">
          <li>
            You asked for <strong>{wHppvTarget} weighted hours per patient visit (wHPPV)</strong> — the target
            that drives how much staffing this schedule allocates.
          </li>
          <li>
            The recommended schedule runs <strong>{weeklyScheduledHours.toFixed(0)} hours/week</strong>, which is{' '}
            <strong>{overText}</strong> ({result.weeklyBudgetHours.toFixed(0)} hrs/week budget).
          </li>
          {minWHppv !== null && maxWHppv !== null && (
            <li>
              Across the week, the schedule actually realizes between{' '}
              <strong>{minWHppv.toFixed(2)} and {maxWHppv.toFixed(2)} wHPPV</strong> day to day, even though the
              weekly average lands at {realizedWHppv.toFixed(2)}.
            </li>
          )}
        </ul>
        <button className="btn-link why-toggle" onClick={() => setWhyOpen((v) => !v)}>
          {whyOpen ? 'Hide why this happens' : 'Why might this run over or under budget?'}
        </button>
        {whyOpen && (
          <div className="why-explainer">
            <p>
              The solver first figures out the minimum staff needed to fully cover every hour of demand — call
              this the &quot;full coverage&quot; picture. That's usually more hours than your weekly budget allows,
              so it then trims shifts, cutting the hours that are cheapest to lose (the ones that create the
              least shortfall), until the schedule fits your budget plus a small tolerance.
            </p>
            <p>
              Finally, it applies one safety check: at every hour, the department must have at least a minimum
              number of nurses on duty, regardless of budget. If trimming ever pushes a low-volume hour below
              that floor, the solver adds staff back — even if that means going over budget. That floor pass is
              the most common reason the final schedule can land slightly over your target instead of under it.
            </p>
          </div>
        )}
      </section>

      {/* Spec §2.2: the idealized grid is no longer a standalone hero — it's presented as one
          comparison unit against current staffing (both grids + diff + the budget-vs-shape
          reconciliation, collapsed together rather than split across two cards). */}
      <section className="card comparison-unit">
        <h2>Idealized schedule vs. your current staffing</h2>

        {hasCurrentStaffing ? (
          <>
            {/* Templated headline (fixed structure, numbers interpolated) — quotable as-is
                into a message to staff or a budget ask to a boss (spec §0 communication goal). */}
            <p className="comparison-headline">
              Your current staffing runs <strong>{currentStaffing.weeklyScheduledHours.toFixed(0)} hrs/week</strong>{' '}
              against the idealized <strong>{weeklyScheduledHours.toFixed(0)} hrs/week</strong>
              {gapKind === 'none' && <> — the two line up, with no budget or shape gap to close.</>}
              {gapKind === 'budget' && (
                <>
                  {' '}— a <strong>{absBudgetGap.toFixed(0)}-hr {budgetGapHours > 0 ? 'shortfall' : 'surplus'}</strong>{' '}
                  spread roughly evenly across the week. This is mainly a <strong>budget gap</strong>: the shape is
                  about right, you just need {budgetGapHours > 0 ? 'more' : 'fewer'} total hours.
                </>
              )}
              {gapKind === 'shape' && (
                <>
                  {' '}— about the same total, but <strong>{shapeGapHours.toFixed(0)} hrs</strong> sit in the wrong
                  shifts. This is mainly a <strong>shape gap</strong>: right total, wrong distribution —
                  redistributing hours, not adding budget, is the fix.
                </>
              )}
              {gapKind === 'both' && (
                <>
                  {' '}— a <strong>{absBudgetGap.toFixed(0)}-hr {budgetGapHours > 0 ? 'shortfall' : 'surplus'}</strong>,
                  and on top of that <strong>{shapeGapHours.toFixed(0)} hrs</strong> sit in the wrong shifts. This is
                  <strong> both a budget gap and a shape gap</strong> — you need a different total and a different
                  distribution.
                </>
              )}
            </p>

            {/* Reconciliation callout — deliberately distinct from the cell-by-cell diff grid
                below (spec §2.2: the diff shows WHERE; this shows WHICH KIND of gap). */}
            <div className={`reconciliation-callout reconciliation-${gapKind}`}>
              <div className="stat">
                <div className="stat-label">Budget gap</div>
                <div className={`stat-value ${absBudgetGap >= 1 ? 'stat-warning' : ''}`}>
                  {budgetGapHours > 0 ? '+' : budgetGapHours < 0 ? '−' : ''}
                  {absBudgetGap.toFixed(0)} hrs
                </div>
                <div className="stat-sub">wrong total — {budgetGapHours >= 0 ? 'under' : 'over'} the idealized weekly hours</div>
              </div>
              <div className="stat">
                <div className="stat-label">Shape gap</div>
                <div className={`stat-value ${shapeGapHours >= 1 ? 'stat-warning' : ''}`}>{shapeGapHours.toFixed(0)} hrs</div>
                <div className="stat-sub">wrong distribution — hours that would need to move between shifts</div>
              </div>
              <div className="stat">
                <div className="stat-label">Hours below ideal coverage (current)</div>
                <div className={`stat-value ${currentStaffing.shortfall.length > 0 ? 'stat-warning' : ''}`}>
                  {currentStaffing.shortfall.reduce((a, s) => a + s.deficit, 0)}
                </div>
                <div className="stat-sub">{currentStaffing.shortfall.length} (day, hour) cells short</div>
              </div>
              <div className="stat">
                <div className="stat-label">ENA floor violations (current)</div>
                <div className={`stat-value ${currentStaffing.enaFloorViolationsRemaining.length > 0 ? 'stat-warning' : ''}`}>
                  {currentStaffing.enaFloorViolationsRemaining.length}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="banner banner-info comparison-cta">
            Add your current staffing in the grid below to see how it compares — and whether your gap is a{' '}
            <strong>budget</strong> problem (wrong total hours) or a <strong>shape</strong> problem (right total,
            wrong distribution). If you entered it during setup, it's already here.
          </div>
        )}

        {/* Both grids, side by side — peers in a comparison, not a hero + an afterthought. */}
        <div className="comparison-grids">
          <div className="comparison-grid-block">
            <div className="grid-header-row">
              <h3>Idealized</h3>
              {gridOverride && (
                <button className="btn-link" onClick={resetGridOverride}>
                  Reset to solver output
                </button>
              )}
            </div>
            <p className="grid-hint">Edit any headcount cell — the comparison, wHPPV, and heatmap recompute live.</p>
            <div className="staffing-grid-wrap">
              <table className="staffing-grid">
                <thead>
                  <tr>
                    <th>Day</th>
                    {sortedShiftMenu.map((s) => (
                      <th key={s.id}>
                        {s.label || s.id} ({s.startHour.toString().padStart(2, '0')}:00, {s.lengthHours}h)
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAY_LABELS.map((label, day) => (
                    <tr key={day}>
                      <td className="day-cell">
                        {label}
                        {shortfallByDay.has(day) && <span className="shortfall-dot" title="Shortfall this day" />}
                      </td>
                      {sortedShiftMenu.map((s) => (
                        <td key={s.id}>
                          <input
                            type="number"
                            min={0}
                            value={grid[day]?.[s.id] ?? 0}
                            onChange={(e) => editGridCell(day, s.id, Number(e.target.value))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="comparison-grid-block">
            <div className="grid-header-row">
              <h3>Current staffing</h3>
              {currentStaffingGrid && (
                <button className="btn-link" onClick={resetCurrentStaffingGrid}>
                  Clear
                </button>
              )}
            </div>
            <p className="grid-hint">What you actually staff today — starts blank, carried over from setup if entered there.</p>
            <CurrentStaffingGrid />
          </div>
        </div>

        <h3>Difference (idealized − current)</h3>
        <div className="staffing-grid-wrap">
          <table className="staffing-grid diff-grid">
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
                    const idealHc = grid[day]?.[s.id] ?? 0;
                    const currentHc = currentStaffingGrid?.[day]?.[s.id] ?? 0;
                    const diff = idealHc - currentHc;
                    return (
                      <td key={s.id} className={diff > 0 ? 'diff-under' : diff < 0 ? 'diff-over' : 'diff-even'}>
                        {diff > 0 ? `+${diff}` : diff}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Hard requirement: wHPPV, overcoverage, and shortfall live in one visual unit — never separable cards. */}
      <section className="card wHPPV-unit">
        <h2>Coverage summary</h2>
        <div className="wHPPV-stats">
          <div className="stat">
            <div className="stat-label">Realized wHPPV</div>
            <div className="stat-value">{realizedWHppv.toFixed(3)}</div>
            <div className="stat-sub">target {wHppvTarget}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Overcoverage</div>
            <div className={`stat-value ${overcoveragePct < 0 ? 'stat-negative' : ''}`}>
              {(overcoveragePct * 100).toFixed(1)}%
            </div>
            <div className="stat-sub">vs. weekly budget of {result.weeklyBudgetHours.toFixed(0)} hrs</div>
          </div>
          <div className="stat">
            <div className="stat-label">Hours Below Ideal Coverage</div>
            <div className={`stat-value ${shortfall.length > 0 ? 'stat-warning' : ''}`}>
              {shortfall.reduce((a, s) => a + s.deficit, 0)}
            </div>
            <div className="stat-sub">Hours this week where staffing fell short of the ideal target.</div>
          </div>
          {result.lostProductivity && (
            <div className="stat">
              <div className="stat-label">Effective ED wHPPV (accounting for boarding)</div>
              <div className="stat-value stat-warning">{result.lostProductivity.wHppvAvailableForEdCare.toFixed(2)}</div>
              <div className="stat-sub">
                down from {wHppvTarget} if boarding isn't separately staffed ({result.lostProductivity.wHppvConsumedByBoarding.toFixed(2)}{' '}
                consumed)
              </div>
            </div>
          )}
        </div>

        <p className="wHPPV-caveat">
          A clean wHPPV number can coexist with genuinely short hours — the heatmap below is the diagnostic
          that catches that, hour by hour. It is shown here, in the same unit, deliberately.
        </p>

        <WhppvHeatmap cells={heatmapCells} wHppvTarget={wHppvTarget} />
      </section>
    </div>
  );
}
