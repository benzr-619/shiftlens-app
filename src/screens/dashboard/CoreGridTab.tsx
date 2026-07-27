import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { DAY_LABELS, type ShiftDef } from '../../engine/types';
import { DISPLAY_DAY_ORDER, DISPLAY_DAY_LABELS } from '../../lib/dayOrder';
import { coverageForDay } from '../../engine/solver';
import { computeBacklog, BACKLOG_CAUGHT_UP_THRESHOLD, computeBandFloorViolations, summarizeBacklogSeverity } from '../../engine';
import { CurrentStaffingGrid } from '../../components/CurrentStaffingGrid';
import { WhppvHeatmap, type WhppvHeatmapCell } from '../../components/WhppvHeatmap';
import { computeColorDomain } from '../../lib/whppvColorDomain';
import { CurrentStaffingAnalysis } from './CurrentStaffingAnalysis';
import { ConceptCallout } from '../../components/ConceptCallout';

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
  // PR F (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §3): FOUR quantities were conflated under
  // one word ("budget"). This is now the "what delivering the target costs" figure vs. the
  // "target-implied hours" figure — never called a budget in the UI (engine field names,
  // e.g. `weeklyBudgetHours`, stay unchanged — this is a copy-layer rule only, enforced by
  // `lib/__tests__/copyLayer.test.ts`'s source-grep).
  const overcoveragePctVsTarget =
    result.weeklyBudgetHours > 0 ? (weeklyScheduledHours - result.weeklyBudgetHours) / result.weeklyBudgetHours : 0;
  // "Disclose the delivery premium" (§3): row 3 (what delivering the target costs) minus row 2
  // (target-implied hours) — today this was silently folded into a % that read like waste. It
  // isn't waste, it's whole-nurse/shift-block granularity, and it's what makes the shift-menu
  // chapter matter (a different menu is the only lever that reduces it).
  const deliveryPremiumHours = weeklyScheduledHours - result.weeklyBudgetHours;
  const deliveryPremiumFte = (deliveryPremiumHours * 52) / 2080;

  const sortedShiftMenu = useMemo(() => sortShiftsByStartHour(shiftMenu), [shiftMenu]);

  // Has the user entered any current staffing at all? An all-zero/unset grid is a valid
  // engine state (getCurrentStaffingResult treats it as "0 everywhere"), but for the
  // narrative comparison it reads as "nothing to compare yet" — show a CTA instead of a
  // misleading size/shape verdict against a blank grid. See spec §2.1/§2.2.
  const hasCurrentStaffing =
    !!currentStaffingGrid &&
    Object.values(currentStaffingGrid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));

  // Current staffed hours — the "actual constraint" quantity (spec §3, row 1). Used for the
  // Coverage-summary Overcoverage stat below, which must compare against THIS, not the
  // target-implied figure, whenever it's available (§3's "never silently fall back" rule).
  let currentTotalWeeklyHours = 0;
  for (let day = 0; day < 7; day++) {
    for (const s of sortedShiftMenu) currentTotalWeeklyHours += (currentStaffingGrid?.[day]?.[s.id] ?? 0) * s.lengthHours;
  }
  const overcoveragePctVsCurrent =
    hasCurrentStaffing && currentTotalWeeklyHours > 0 ? (weeklyScheduledHours - currentTotalWeeklyHours) / currentTotalWeeklyHours : null;

  // Total-hours reconciliation (spec §2.2 / §4.4): is the divergence from current a SIZE gap
  // (wrong total, roughly right shape → the ask is more/fewer funded hours) or a SHAPE gap
  // (right total, wrong distribution → the ask is redistribution, not more hours)? Pure
  // client-side arithmetic over the two grids — no engine involvement, no re-solve.
  //   underHours = hours the idealized grid wants ON TOP OF current (cells ideal > current)
  //   overHours  = hours current staffs ABOVE the idealized grid   (cells current > ideal)
  // Their signed difference is the net total mismatch (the size component); the smaller of
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
  const sizeGapHours = underHours - overHours; // net; == idealized weekly hours − current weekly hours
  const shapeGapHours = Math.min(underHours, overHours); // offsetting/redistribution portion
  const absSizeGap = Math.abs(sizeGapHours);
  const totalMismatch = absSizeGap + shapeGapHours;
  // "Primarily" thresholds: whichever component is <20% of the total is treated as minor.
  const gapKind: 'none' | 'size' | 'shape' | 'both' =
    totalMismatch < 1
      ? 'none'
      : shapeGapHours < 0.2 * totalMismatch
        ? 'size'
        : absSizeGap < 0.2 * totalMismatch
          ? 'shape'
          : 'both';

  const shortfallByDay = new Map<number, typeof shortfall>();
  for (const entry of shortfall) {
    if (!shortfallByDay.has(entry.day)) shortfallByDay.set(entry.day, []);
    shortfallByDay.get(entry.day)!.push(entry);
  }

  // 2026-07-26 PR D (SOLVER_REALISM_SPEC_2026-07-26.md, change 5): "you need 84 more hours"
  // used to just stop there — add what closing the gap actually BUYS. Compares the CURRENT
  // grid's own total severity (same convex objective the solver minimizes, computed against
  // this grid — pure client-side arithmetic, no re-solve) against the idealized grid's
  // (already on `result.totalSeverity`, PR C change 5) — a direct, same-objective before/after,
  // not a re-derivation from the funding-ask marginal curve (which answers a different
  // question: budget vs. full coverage, not current vs. idealized).
  const currentSeverity = useMemo(
    () => summarizeBacklogSeverity(currentStaffingGrid ?? {}, result.hourlyRequirement, sortedShiftMenu).totalSeverity,
    [currentStaffingGrid, result.hourlyRequirement, sortedShiftMenu]
  );
  const severityReductionPct =
    currentSeverity > 0 ? Math.max(0, Math.min(100, ((currentSeverity - result.totalSeverity) / currentSeverity) * 100)) : 0;

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
  // 2026-07-25 (reversal, see .claude/rules/engine-solver.md): retires the point-target
  // "Hours Below Ideal Coverage" stat in favor of a band-based one — a count of hours where
  // the idealized grid's coverage falls below result.bandFloorHourly, plus a "worst stretch"
  // callout. Diagnostic-only client-side call against the already-solved grid, same
  // convention as idealBacklog above. 2026-07-26 PR C: bandFloorHourly is now the CLAMPED
  // REPORTING curve specifically — Step 3's trim itself optimizes against the separate,
  // unclamped result.protectedFloorHourly (see .claude/rules/engine-solver.md's
  // "Budget-capped trim" section) — this stat intentionally reads the clamped one.
  const bandFloor = useMemo(
    () => computeBandFloorViolations(grid, result.bandFloorHourly, sortedShiftMenu),
    [grid, result.bandFloorHourly, sortedShiftMenu]
  );
  // §6 (results-redesign.md): the idealized and current-staffing heatmaps must read as
  // directly comparable, so their color domain AND backlog-weight max are each computed ONCE
  // here and passed into both instances as explicit props — neither WhppvHeatmap instance may
  // derive either from its own cells. currentBacklogForMax exists only to fold the current
  // grid's peak backlog into the shared max; CurrentStaffingAnalysis computes its own (equal)
  // backlog result again for its narrative stats, which is fine — pure arithmetic, no engine cost.
  const currentBacklogForMax = useMemo(
    () => computeBacklog(currentStaffingGrid ?? {}, result.hourlyRequirement, sortedShiftMenu),
    [currentStaffingGrid, result.hourlyRequirement, sortedShiftMenu]
  );
  const backlogMax = Math.max(idealBacklog.peakBacklog, currentBacklogForMax.peakBacklog);
  const colorDomain = useMemo(
    () => computeColorDomain(result.annualVisits, wHppvTarget),
    [result.annualVisits, wHppvTarget]
  );
  const heatmapCells: WhppvHeatmapCell[] = useMemo(() => {
    const weeklyArrivalsForScale = arrivals.reduce((a, b) => a + b, 0);
    const scale =
      weeklyArrivalsForScale > 0 && weeklyScheduledHours > 0
        ? realizedWHppv / (weeklyScheduledHours / weeklyArrivalsForScale)
        : null;

    const cells: WhppvHeatmapCell[] = [];
    for (let day = 0; day < 7; day++) {
      const coverage = coverageForDay(grid, sortedShiftMenu, day);
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
          // PR D (change 4): per-hour band now drives the heatmap's own color — see
          // components/WhppvHeatmap.tsx.
          bandFloor: result.bandFloorHourly[day * 24 + hour] ?? 0,
          bandCeiling: result.bandCeilingHourly[day * 24 + hour] ?? 0,
          arrivals: cellArrivals,
          belowFloor,
          backlog: cellBacklog,
          inBacklogStreak,
          riskReasons,
        });
      }
    }
    return cells;
  }, [
    grid,
    sortedShiftMenu,
    arrivals,
    weeklyScheduledHours,
    realizedWHppv,
    idealBacklog,
    floorViolationSet,
    result.hourlyRequirement,
    result.bandFloorHourly,
    result.bandCeilingHourly,
  ]);

  // PR H (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §8): realized-wHPPV range across the 168
  // HOURS, not the 7 days — a day-grain range hides which HOUR the extremes land on, and a
  // range with no location attached gets read past. Reuses the SAME per-cell whppv already
  // computed for the heatmap (`heatmapCells`) — no second computation, no engine changes.
  let minWHppv: number | null = null;
  let maxWHppv: number | null = null;
  let minWHppvAt: { day: number; hour: number } | null = null;
  let maxWHppvAt: { day: number; hour: number } | null = null;
  for (const cell of heatmapCells) {
    if (cell.whppv === null) continue;
    if (minWHppv === null || cell.whppv < minWHppv) {
      minWHppv = cell.whppv;
      minWHppvAt = { day: cell.day, hour: cell.hour };
    }
    if (maxWHppv === null || cell.whppv > maxWHppv) {
      maxWHppv = cell.whppv;
      maxWHppvAt = { day: cell.day, hour: cell.hour };
    }
  }
  const fmtDayHour = (at: { day: number; hour: number }) => `${DAY_LABELS[at.day]} ${at.hour.toString().padStart(2, '0')}:00`;

  const overText =
    overcoveragePctVsTarget >= 0
      ? `${(overcoveragePctVsTarget * 100).toFixed(0)}% over target-implied hours`
      : `${Math.abs(overcoveragePctVsTarget * 100).toFixed(0)}% under target-implied hours`;

  return (
    <div className="core-grid-tab">
      {/* §3: the "no ESI mix" confidence-caveat banner was removed 2026-07-24 (UI-copy only —
          ESI mix, acuity weighting, and the ESI template tab all stay in the engine unchanged).
          PR K (§10.3) brings a version of it BACK, but reworded to state the CONSEQUENCE for
          what's being read, not just "this is a caveat" — missing-input consequences belong at
          results time, not only setup time, per the spec's explicit instruction. */}
      {result.esiConfidenceFlag && (
        <div className="banner banner-info">
          Your ESI mix wasn't provided, so this schedule allocates hours by raw arrival volume, not patient
          acuity — hours where sicker patients tend to arrive may be under-weighted relative to what they
          actually need. Add ESI mix (Setup Step 1) to correct for this.
        </div>
      )}
      {!result.reconciliation.passes && (
        <div className="banner banner-error">
          Reconciliation check failed: the 168-cell allocation does not reproduce the annual target-implied
          hours exactly (gap {(result.reconciliation.gapPct * 100).toFixed(4)}%). This indicates a
          calculation bug — results below should not be trusted until this is resolved.
        </div>
      )}

      {/* PR H (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §6.1/§8) — the welcome/orientation
          section (`.results-welcome`, "Welcome to the Results Page") used to render here.
          MOVED to DashboardScreen.tsx (2026-07-27) so it sits above the chapter rail, full
          page width, rather than being scoped to CoreGridTab's own chapter inside the
          rail+content two-column layout — see .claude/rules/results-redesign.md's PR H
          section for the full revision history. Do not re-add it here. */}

      {/* §2.1: the page opens with an analysis of CURRENT staffing (or a CTA if none entered),
          before the idealized recommendation. Surfaces the §2.4 backlog diagnostic. */}
      <CurrentStaffingAnalysis colorDomain={colorDomain} backlogMax={backlogMax} />

      <section className="card plain-summary">
        <h2>What this schedule means</h2>
        <ul className="plain-summary-list">
          <li>
            You asked for <strong>{wHppvTarget} weighted hours per patient visit (wHPPV)</strong> — the target
            that drives how much staffing this schedule allocates.
          </li>
          <li>
            The recommended schedule runs <strong>{weeklyScheduledHours.toFixed(0)} hours/week</strong>, which is{' '}
            <strong>{overText}</strong> ({result.weeklyBudgetHours.toFixed(0)} target-implied hrs/week).
          </li>
          {/* PR F (§3): the delivery premium, named honestly rather than folded into a plain
              "% overcoverage" that reads like waste. It isn't waste — it's whole-nurse/shift-
              block granularity, and a different shift menu (see the flexibility section below)
              is the only lever that reduces it. */}
          {deliveryPremiumHours > 0.5 && (
            <li>
              Whole nurses and {sortedShiftMenu.map((s) => s.lengthHours).join('/')}-hour shift blocks cost{' '}
              <strong>
                {deliveryPremiumHours.toFixed(0)} hours a week ({deliveryPremiumFte.toFixed(1)} FTE)
              </strong>{' '}
              more than the target's arithmetic implies. That's granularity, not waste — a different shift
              menu is the one lever that reduces it.
            </li>
          )}
          {minWHppv !== null && maxWHppv !== null && minWHppvAt && maxWHppvAt && (
            <li>
              Across the 168 hours of the week, the schedule actually realizes as low as{' '}
              <strong>{minWHppv.toFixed(2)} wHPPV</strong> (around {fmtDayHour(minWHppvAt)}) and as high as{' '}
              <strong>{maxWHppv.toFixed(2)} wHPPV</strong> (around {fmtDayHour(maxWHppvAt)}), even though the weekly
              average lands at {realizedWHppv.toFixed(2)}.
            </li>
          )}
        </ul>

        {/* PR J (teaching layer, §8) — three concepts, first used here (Chapter 2). Collapsed
            by default; each concept appears exactly once across the whole page. */}
        <div className="concept-callout-row">
          <ConceptCallout title="wHPPV">
            <p>
              Weighted Hours Per Patient Visit — nurse-hours of staffing per visit, adjusted for how sick the
              patients are (a sicker mix needs more hours per visit). It's the unit that lets you compare your
              staffing level against other EDs, regardless of how big or small your department is.
            </p>
          </ConceptCallout>
          <ConceptCallout title="Front-loaded nursing">
            <p>
              Most nursing work happens in the first hour of a visit — triage, assessment, the initial round of
              orders — not spread evenly across however long the patient stays. That's why this schedule staffs
              to when patients <strong>arrive</strong>, not to when your department feels busiest. If your census
              peaks later in the day, that's throughput (length of stay), and it shows up as backlog below, not as
              a need for more nurses at that later hour.
            </p>
          </ConceptCallout>
          <ConceptCallout title="Averages under-staff you half the time">
            <p>
              If you staff to the AVERAGE arrivals for an hour, then by definition roughly half of all instances of
              that hour are busier than average — and short-staffed by construction, not by bad luck. This is why
              the schedule protects a band above the raw average at genuinely volatile hours, rather than staffing
              to the mean everywhere.
            </p>
          </ConceptCallout>
        </div>

        <button className="btn-link why-toggle" onClick={() => setWhyOpen((v) => !v)}>
          {whyOpen ? 'Hide why this happens' : 'Why might this run over or under target?'}
        </button>
        {whyOpen && (
          <div className="why-explainer">
            {/* 2026-07-26 PR D (SOLVER_REALISM_SPEC_2026-07-26.md, change 5) — REWRITE. The old
                copy said the solver cuts "the hours that are cheapest to lose (the ones that
                create the least shortfall)" — that description has been false through multiple
                engine reversals (PR A/B/C above) and was the single most user-visible
                correctness defect on the page. */}
            <p>
              The solver first figures out the minimum staff needed to fully cover every hour of demand — call
              this the &quot;full coverage&quot; picture. That's usually more hours than your target-implied hours
              allow, so it then trims shifts one at a time, each time removing whichever shift-hour would add the
              <strong> least queued patient work</strong> — weighted so that a deep hole counts far more than
              several shallow ones, the way an experienced charge nurse would judge it — until the schedule fits
              the target-implied hours plus a small tolerance. It never cuts below the peer-benchmark staffing
              floor unless that target makes it unavoidable.
            </p>
            <p>
              Finally, it applies one safety check: at every hour, the department must have at least a minimum
              number of nurses on duty, regardless of the target. If trimming ever pushes a low-volume hour below
              that floor, the solver adds staff back — even if that means going over the target-implied hours.
              That floor pass is the most common reason the final schedule can land slightly over target instead
              of under it.
            </p>
            {result.backlogFeedbackStillImprovingAtCap && (
              <p className="wHPPV-caveat">
                Heads up: this grid's internal refinement pass hit its iteration cap while still finding
                improvements — the numbers above are the best found within that target, not a fully converged
                result. This tends to happen in chronically under-staffed weeks; treat the grid as directionally
                right rather than exact.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Spec §2.2: the idealized grid is no longer a standalone hero — it's presented as one
          comparison unit against current staffing (both grids + diff + the size-vs-shape
          reconciliation, collapsed together rather than split across two cards). */}
      <section className="card comparison-unit">
        <h2>Idealized schedule vs. your current staffing</h2>

        {hasCurrentStaffing ? (
          <>
            {/* Templated headline (fixed structure, numbers interpolated) — quotable as-is
                into a message to staff or a funding ask to a boss (spec §0 communication goal). */}
            <p className="comparison-headline">
              Your current staffing runs <strong>{currentStaffing.weeklyScheduledHours.toFixed(0)} hrs/week</strong>{' '}
              against the idealized <strong>{weeklyScheduledHours.toFixed(0)} hrs/week</strong>
              {gapKind === 'none' && <> — the two line up, with no total-hours or shape gap to close.</>}
              {gapKind === 'size' && (
                <>
                  {' '}— a <strong>{absSizeGap.toFixed(0)}-hr {sizeGapHours > 0 ? 'shortfall' : 'surplus'}</strong>{' '}
                  spread roughly evenly across the week. This is mainly a <strong>total-hours gap</strong>: the shape
                  is about right, you just need {sizeGapHours > 0 ? 'more' : 'fewer'} total hours.
                </>
              )}
              {gapKind === 'shape' && (
                <>
                  {' '}— about the same total, but <strong>{shapeGapHours.toFixed(0)} hrs</strong> sit in the wrong
                  shifts. This is mainly a <strong>shape gap</strong>: right total, wrong distribution —
                  redistributing hours, not adding more, is the fix.
                </>
              )}
              {gapKind === 'both' && (
                <>
                  {' '}— a <strong>{absSizeGap.toFixed(0)}-hr {sizeGapHours > 0 ? 'shortfall' : 'surplus'}</strong>,
                  and on top of that <strong>{shapeGapHours.toFixed(0)} hrs</strong> sit in the wrong shifts. This is
                  <strong> both a total-hours gap and a shape gap</strong> — you need a different total and a
                  different distribution.
                </>
              )}
              {/* 2026-07-26 PR D (change 5): state what closing the gap BUYS, not just its size —
                  "you need 84 more hours" used to stop there. Same convex-severity objective the
                  solver itself minimizes (PR C), compared current-grid vs. idealized-grid. */}
              {gapKind !== 'none' && sizeGapHours > 0 && severityReductionPct >= 1 && (
                <>
                  {' '}
                  Closing it would cut modeled queued-patient-work by roughly{' '}
                  <strong>{severityReductionPct.toFixed(0)}%</strong> on the same scale this schedule is optimized
                  against.
                </>
              )}
            </p>

            {/* Reconciliation callout — deliberately distinct from the cell-by-cell diff grid
                below (spec §2.2: the diff shows WHERE; this shows WHICH KIND of gap). */}
            <div className={`reconciliation-callout reconciliation-${gapKind}`}>
              <div className="stat">
                <div className="stat-label">Total-hours gap</div>
                <div className={`stat-value ${absSizeGap >= 1 ? 'stat-warning' : ''}`}>
                  {sizeGapHours > 0 ? '+' : sizeGapHours < 0 ? '−' : ''}
                  {absSizeGap.toFixed(0)} hrs
                </div>
                <div className="stat-sub">wrong total — {sizeGapHours >= 0 ? 'under' : 'over'} the idealized weekly hours</div>
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
            <strong>total-hours</strong> problem (wrong total hours) or a <strong>shape</strong> problem (right
            total, wrong distribution). If you entered it during setup, it's already here.
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
                  {DISPLAY_DAY_ORDER.map((day, idx) => (
                    <tr key={day}>
                      <td className="day-cell">
                        {DISPLAY_DAY_LABELS[idx]}
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
              {DISPLAY_DAY_ORDER.map((day, idx) => (
                <tr key={day}>
                  <td className="day-cell">{DISPLAY_DAY_LABELS[idx]}</td>
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
            {/* PR F (§3): computed against CURRENT STAFFED HOURS — the actual constraint — not
                silently against the target-implied figure. No current staffing entered ->
                SUPPRESS this stat entirely rather than fall back to a denominator the manager
                never stated (a % against an unstated denominator is the defect this fixes). */}
            {overcoveragePctVsCurrent !== null ? (
              <>
                <div className={`stat-value ${overcoveragePctVsCurrent < 0 ? 'stat-negative' : ''}`}>
                  {(overcoveragePctVsCurrent * 100).toFixed(1)}%
                </div>
                <div className="stat-sub">
                  vs. your current {currentTotalWeeklyHours.toFixed(0)} hrs/week (target-implied:{' '}
                  {result.weeklyBudgetHours.toFixed(0)} hrs/week)
                </div>
              </>
            ) : (
              <>
                <div className="stat-value stat-muted">—</div>
                <div className="stat-sub">Add your current staffing above to see this against your actual hours.</div>
              </>
            )}
          </div>
          <div className="stat">
            {/* 2026-07-26 PR D (change 5): relabeled to say PLAINLY what this counts — hours
                BELOW ONLY (not "outside," which implied both directions), against the PEER
                cohort's 25th percentile (not this ED's own history, which "typical staffing
                range" implied). A manager who discovers mid-meeting that the benchmark is the
                bottom quartile loses the room; framing it this way from the start owns it. */}
            <div className="stat-label">Hours below the peer 25th-percentile staffing floor</div>
            <div className={`stat-value ${bandFloor.hoursOutsideBand > 0 ? 'stat-warning' : ''}`}>
              {bandFloor.hoursOutsideBand}
            </div>
            <div className="stat-sub">
              {bandFloor.longestStreakHours > 0 && bandFloor.longestStreakStart
                ? `Worst stretch: ${bandFloor.longestStreakHours} hr${bandFloor.longestStreakHours === 1 ? '' : 's'} around ${
                    DAY_LABELS[bandFloor.longestStreakStart.day]
                  } ${bandFloor.longestStreakStart.hour.toString().padStart(2, '0')}:00${
                    bandFloor.worstStretchShiftLabel ? ` (${bandFloor.worstStretchShiftLabel})` : ''
                  }`
                : "Stays at or above similar EDs' 25th-percentile floor all week."}
            </div>
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

        <WhppvHeatmap cells={heatmapCells} backlogMax={backlogMax} shiftMenu={sortedShiftMenu} />
      </section>
    </div>
  );
}
