import { useMemo } from 'react';
import { useStore } from '../../store';
import type { ShiftDef } from '../../engine/types';
import { DAY_LABELS } from '../../engine/types';
import { computeBacklog, computePerShiftDiagnostic } from '../../engine';
import { fullWeekCapacity } from '../../engine/solver';
import { shiftDiagnosticSentence } from '../../lib/narrative';
import { lookupWhppvBand } from '../../lib/edbaLookup';
import { VisualFrame, type VisualFrameView } from '../../components/VisualFrame';
import { averageDay } from '../../lib/averageDay';
import {
  computeQueuePattern,
  queuePatternSentence,
  fmtHour,
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
  averageOverDays,
  patternsDifferMeaningfully,
} from '../../lib/queuePattern';
import { buildPerShiftBreakdown } from '../../lib/shiftBreakdown';
import type { WhppvHeatmapCell } from '../../components/WhppvHeatmap';
import { DISPLAY_DAY_ORDER, DISPLAY_DAY_LABELS } from '../../lib/dayOrder';

function sortByStartHour(shifts: ShiftDef[]): ShiftDef[] {
  return [...shifts].sort((a, b) => a.startHour - b.startHour);
}
/** Shared cell-builder for every VisualFrame view this panel offers — same shape
 * (onDuty/requirement/bandFloor/bandCeiling/belowFloor), different source curves.
 * `perShiftBreakdown168`, when passed, gives §7's per-shift split cell text/tooltip — only
 * meaningful for views whose `onDuty168` IS actual current-staffing headcount (arrivals,
 * combined); the boarding view's "onDuty" is derived spare capacity, which has no clean
 * per-shift decomposition, so it's omitted there (falls back to a plain number). */
function buildCells(
  onDuty168: number[],
  requirement168: number[],
  bandFloor168: number[],
  bandCeiling168: number[],
  arrivals168: number[],
  belowFloorSet: Set<string>,
  perShiftBreakdown168?: Array<Array<{ label: string; headcount: number }>>
): WhppvHeatmapCell[] {
  const cells: WhppvHeatmapCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const g = day * 24 + hour;
      const belowFloor = belowFloorSet.has(`${day}-${hour}`);
      const perShift = perShiftBreakdown168 && perShiftBreakdown168[g].length > 1 ? perShiftBreakdown168[g] : undefined;
      cells.push({
        day,
        hour,
        onDuty: onDuty168[g] ?? 0,
        requirement: requirement168[g] ?? 0,
        bandFloor: bandFloor168[g] ?? 0,
        bandCeiling: bandCeiling168[g] ?? 0,
        whppv: null,
        arrivals: arrivals168[g] ?? 0,
        belowFloor,
        riskReasons: belowFloor ? ['below the ENA on-duty floor'] : [],
        perShift,
      });
    }
  }
  return cells;
}

/**
 * PANEL 1 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §4, revised per
 * PANEL1_COPY_REVISION_SPEC_2026-07-28.md) — "What your department demands, and what you
 * staff against it." Absorbs the old `CurrentStaffingAnalysis`, `CoreGridTab`'s coverage-
 * summary stats, and `HiddenBoardingSection`. See .claude/rules/results-redesign.md's
 * dated 2026-07-28 section for the copy-revision judgment calls this panel makes explicit.
 */
export function Panel1() {
  const {
    shiftMenu,
    arrivals,
    currentStaffingGrid,
    wHppvTarget,
    getResult,
    getCurrentStaffingResult,
  } = useStore();
  const result = getResult();
  const current = getCurrentStaffingResult();
  const sortedShiftMenu = useMemo(() => sortByStartHour(shiftMenu), [shiftMenu]);
  // `currentStaffingGrid ?? {}` allocates a new object every render when null — memoize so
  // downstream useMemo/useCallback dependency arrays keyed on `grid` are actually stable.
  const grid = useMemo(() => currentStaffingGrid ?? {}, [currentStaffingGrid]);

  const hasCurrentStaffing = Object.values(grid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));

  const band = useMemo(() => lookupWhppvBand(result.annualVisits), [result.annualVisits]);

  const boardingCurve = result.boarding?.cellBoardingRnHours ?? null;
  const combinedRequirement = useMemo(
    () => result.hourlyRequirement.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0)),
    [result.hourlyRequirement, boardingCurve]
  );

  // §5a — the ACTUAL curve (BacklogResult.backlog), never `.cyclicalBacklog`, computed against
  // ARRIVALS ONLY and shown on every toggle regardless of which demand curve that toggle's
  // chart is displaying. Boarders can't "queue" the way an unseen arrival can — they're
  // already physically present, waiting on a bed, not waiting to be seen — so there's no
  // honest boarding-specific or combined backlog curve to draw; this is the department's one
  // real backlog, full stop. A scoped, deliberate exception to how the rest of the results
  // page treats the queue strip (elsewhere it isolates shape from size) — Panel 1 wants the
  // department's real, current situation, not a shape-only hypothetical. See VisualFrame.tsx's
  // `queueDepth168` doc comment and .claude/rules/results-redesign.md.
  //
  // 2026-07-28 (ninth shape, BACKLOG_MODEL_VISITS_BASED_SPEC_2026-07-28.md): real visits-based
  // compression (real `arrivals` counts + `result.floorWhppv`, the department's own
  // peer-cohort p25 wHPPV). See backlogModel.ts's header and
  // .claude/rules/engine-solver.md's ninth-shape section.
  const backlogArrivals = useMemo(
    () => computeBacklog(grid, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv),
    [grid, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv]
  );

  // §4 — per-shift arrivals/boarding diagnostic, rebuilt per actual shift in the shift menu
  // (not fixed calendar day/night blocks) — see engine/hiddenBoarding.ts.
  const perShiftDiagnostic = useMemo(
    () => computePerShiftDiagnostic(result.hourlyRequirement, grid, sortedShiftMenu, result.bandFloorHourly, result.bandCeilingHourly, boardingCurve),
    [grid, result.hourlyRequirement, sortedShiftMenu, result.bandFloorHourly, result.bandCeilingHourly, boardingCurve]
  );

  const currentCapacity = useMemo(() => fullWeekCapacity(grid, sortedShiftMenu), [grid, sortedShiftMenu]);

  const perShiftBreakdown = useMemo(() => buildPerShiftBreakdown(sortedShiftMenu, grid), [sortedShiftMenu, grid]);

  if (!hasCurrentStaffing) {
    return (
      <section className="card panel panel-1" id="ch-current-staffing">
        <h2>Your current staffing</h2>
        <p>
          Add what you actually staff today — in the comparison grid, or back in setup — and this panel will open
          with an analysis of it: how your realized wHPPV compares to the peer band, whether boarding is currently
          staffed for at all, and where your staffing runs lean across the week.
        </p>
      </section>
    );
  }

  const realized = current.realizedWHppv;
  const position = realized < band.p25Whppv ? 'below' : realized > band.p75Whppv ? 'above' : 'within';

  const staffedPhrase =
    position === 'within'
      ? 'look reasonable for your volume, before looking at individual hours or accounting for boarding'
      : position === 'below'
        ? 'run light for your volume'
        : 'run rich for your volume';

  // Hour-to-hour realized wHPPV range — direct per-cell nurse-hours ÷ arrivals (not the
  // scaled-to-reconcile approach the old CoreGridTab used; a min/max descriptive range
  // doesn't need to reconcile to the weekly aggregate ratio the way an averaged stat would).
  // Zero-arrival cells are skipped (no meaningful per-visit ratio there).
  let minHourlyWhppv: { value: number; day: number; hour: number } | null = null;
  let maxHourlyWhppv: { value: number; day: number; hour: number } | null = null;
  for (let g = 0; g < 168; g++) {
    const cellArrivals = arrivals[g] ?? 0;
    if (cellArrivals <= 0) continue;
    const value = (currentCapacity[g] ?? 0) / cellArrivals;
    const day = Math.floor(g / 24);
    const hour = g % 24;
    if (!minHourlyWhppv || value < minHourlyWhppv.value) minHourlyWhppv = { value, day, hour };
    if (!maxHourlyWhppv || value > maxHourlyWhppv.value) maxHourlyWhppv = { value, day, hour };
  }

  const effectiveWhppv = realized - (result.lostProductivity?.wHppvConsumedByBoarding ?? 0);
  const effectivePosition =
    effectiveWhppv < band.p25Whppv ? 'below' : effectiveWhppv > band.p75Whppv ? 'above' : 'within';
  const effectivePositionPhrase =
    effectivePosition === 'within'
      ? 'within the target range'
      : effectivePosition === 'below'
        ? 'below the target range'
        : 'above the target range';

  // Late-ramp sentence (§3.2 of the prior spec, unchanged by this revision) — when demand
  // peaks vs. when staffing peaks, on the average day.
  const avgDemand = averageDay(result.hourlyRequirement);
  const avgCapacity = averageDay(currentCapacity);
  const peakDemandHour = avgDemand.indexOf(Math.max(...avgDemand));
  const peakCapacityHour = avgCapacity.indexOf(Math.max(...avgCapacity));
  const rampGap = (peakCapacityHour - peakDemandHour + 24) % 24;

  // §5b — average-day build/peak/clear pattern, with a weekday/weekend split when the two
  // differ meaningfully (peak hour by >3h, or peak magnitude by >40%).
  const avgBacklogArrivals = averageDay(backlogArrivals.backlog);
  const avgRequirementArrivals = averageDay(result.hourlyRequirement);
  const wholeWeekPattern = computeQueuePattern(avgBacklogArrivals, avgRequirementArrivals);
  const weekdayPattern = computeQueuePattern(
    averageOverDays(backlogArrivals.backlog, WEEKDAY_DAYS),
    averageOverDays(result.hourlyRequirement, WEEKDAY_DAYS)
  );
  const weekendPattern = computeQueuePattern(
    averageOverDays(backlogArrivals.backlog, WEEKEND_DAYS),
    averageOverDays(result.hourlyRequirement, WEEKEND_DAYS)
  );
  const splitMeaningfully = patternsDifferMeaningfully(weekdayPattern, weekendPattern);

  const enaFloorSet = new Set(current.enaFloorViolationsRemaining.map((v) => `${v.day}-${v.hour}`));

  const arrivalsCells = buildCells(
    currentCapacity,
    result.hourlyRequirement,
    result.bandFloorHourly,
    result.bandCeilingHourly,
    arrivals,
    enaFloorSet,
    perShiftBreakdown
  );
  const combinedBandFloor = result.bandFloorHourly.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));
  const combinedBandCeiling = result.bandCeilingHourly.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));
  const combinedCells = buildCells(
    currentCapacity,
    combinedRequirement,
    combinedBandFloor,
    combinedBandCeiling,
    arrivals,
    enaFloorSet,
    perShiftBreakdown
  );

  // §6 — the "Effective wHPPV" toggle is dropped entirely; the "Boarding" toggle was dropped
  // 2026-07-30 (Ben's ask) — two toggles remain (Arrivals, Arrivals + Boarding — renamed from
  // "Combined" 2026-07-30, key unchanged), not three or four. The queue strip always shows
  // ARRIVALS backlog, labeled "Arrivals backlog" — boarders can't backlog (they're already
  // physically present), so there's no separate boarding/combined curve to draw; only the
  // demand/capacity chart and heatmap above it change per toggle.
  const views: VisualFrameView[] = [
    {
      key: 'arrivals',
      label: 'Arrivals',
      demand168: result.hourlyRequirement,
      capacity168: currentCapacity,
      queueDepth168: backlogArrivals.backlog,
      structuralFloor: backlogArrivals.structuralFloorMin,
      queueLabel: 'Arrivals backlog',
      heatmapCells: arrivalsCells,
      heatmapSubLabel: 'Colored by staffing vs. arrivals demand, hour by hour.',
    },
    {
      key: 'combined',
      label: 'Arrivals + Boarding',
      demand168: combinedRequirement,
      capacity168: currentCapacity,
      queueDepth168: backlogArrivals.backlog,
      structuralFloor: backlogArrivals.structuralFloorMin,
      queueLabel: 'Arrivals backlog',
      heatmapCells: combinedCells,
      heatmapSubLabel: 'Colored by staffing vs. arrivals + boarding demand combined.',
    },
  ];

  return (
    <section className="panel panel-1" id="ch-current-staffing">
      <div className="panel-columns">
        <div className="panel-words">
          <h2>Your current staffing</h2>

          <table className="staffing-grid diff-grid">
            <thead>
              <tr>
                <th className="hour-col">Shift</th>
                {DISPLAY_DAY_LABELS.map((d) => (
                  <th key={d}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedShiftMenu.map((s) => (
                <tr key={s.id}>
                  <td className="hour-col">{s.label || s.id}</td>
                  {DISPLAY_DAY_ORDER.map((day) => (
                    <td key={day}>{grid[day]?.[s.id] ?? 0}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <p className="comparison-headline">
            Your current staffing realizes <strong>{realized.toFixed(2)} wHPPV</strong> at{' '}
            <strong>{current.weeklyScheduledHours.toFixed(0)} hours/week</strong>. Averaged across the
            week, your staffed hours {staffedPhrase}.
          </p>

          {minHourlyWhppv && maxHourlyWhppv && (
            <p>
              Hour to hour, wHPPV ranges from <strong>{minHourlyWhppv.value.toFixed(2)}</strong> (
              {DAY_LABELS[minHourlyWhppv.day]} {fmtHour(minHourlyWhppv.hour)}) up to{' '}
              <strong>{maxHourlyWhppv.value.toFixed(2)}</strong> ({DAY_LABELS[maxHourlyWhppv.day]}{' '}
              {fmtHour(maxHourlyWhppv.hour)})
            </p>
          )}

          {result.boarding && (
            <>
              <p>
                Boarding demands the equivalent of <strong>{(result.lostProductivity?.wHppvConsumedByBoarding ?? 0).toFixed(2)} wHPPV</strong>,{' '}
                <strong>
                  {result.annualVisits > 0
                    ? (((result.lostProductivity?.wHppvConsumedByBoarding ?? 0) / wHppvTarget) * 100).toFixed(0)
                    : 0}
                  %
                </strong>{' '}
                of your department's total nursing hours. Said differently, effective wHPPV after accounting for
                boarding is <strong>{effectiveWhppv.toFixed(2)}</strong>, {effectivePositionPhrase} for a department
                of your size.
              </p>
            </>
          )}

          {perShiftDiagnostic.groups.map((group) => (
            <p key={group.shiftIds.join('-')}>{shiftDiagnosticSentence(group)}</p>
          ))}

          <p>
            This treats boarding as drawing only on whatever nursing capacity arrivals leave
            over. In reality, boarding patients compete for nursing time concurrently with
            arrivals. The diagnostic isn't trying to model that real-time competition; it's
            showing that both draw from the same finite pool of nurse-hours.
          </p>

          <p>
            On an average day, demand peaks around <strong>{fmtHour(peakDemandHour)}</strong>, but your staffing
            doesn't peak until <strong>{fmtHour(peakCapacityHour)}</strong>
            {rampGap > 0 ? ` — roughly a ${rampGap}-hour lag` : ' — no lag'}.
          </p>

          {splitMeaningfully ? (
            <>
              <p>{queuePatternSentence(weekdayPattern, 'On weekdays, ', result.floorWhppv)}</p>
              <p>{queuePatternSentence(weekendPattern, 'On weekends, ', result.floorWhppv)}</p>
            </>
          ) : (
            <p>{queuePatternSentence(wholeWeekPattern, 'Based on your schedule, ', result.floorWhppv)}</p>
          )}

          <details className="why-toggle-wrap queue-honesty-callout">
            <summary className="btn-link why-toggle">How is backlog calculated?</summary>
            <div className="why-explainer">
              <p>
                This is a modeled estimate based on a compression floor to 25th percentile peer productivity. Your
                real backlog may build and drain faster or slower than shown, depending on how far your nurses can
                actually stretch — but stretching capacity isn't free: it trades against burnout, care quality,
                experience, and safety.
              </p>
            </div>
          </details>
        </div>
        <div className="panel-frame">
          <VisualFrame views={views} shiftMenu={sortedShiftMenu} />
        </div>
      </div>
    </section>
  );
}
