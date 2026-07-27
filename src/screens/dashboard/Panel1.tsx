import { useMemo } from 'react';
import { useStore } from '../../store';
import { DAY_LABELS } from '../../engine/types';
import type { ShiftDef } from '../../engine/types';
import { computeBacklog, computeHiddenBoardingDiagnostic } from '../../engine';
import { fullWeekCapacity } from '../../engine/solver';
import { hiddenBoardingNightSentence, hiddenBoardingDaySentence } from '../../lib/narrative';
import { lookupWhppvBand } from '../../lib/edbaLookup';
import { VisualFrame, type VisualFrameView } from '../../components/VisualFrame';
import { averageDay } from '../../lib/averageDay';
import type { WhppvHeatmapCell } from '../../components/WhppvHeatmap';

function sortByStartHour(shifts: ShiftDef[]): ShiftDef[] {
  return [...shifts].sort((a, b) => a.startHour - b.startHour);
}
function fmtHour(h: number): string {
  return `${h.toString().padStart(2, '0')}:00`;
}
function fmtDayHour(at: { day: number; hour: number }): string {
  return `${DAY_LABELS[at.day]} ${fmtHour(at.hour)}`;
}

/** Shared cell-builder for every VisualFrame view this panel offers — same shape
 * (onDuty/requirement/bandFloor/bandCeiling/belowFloor), different source curves. */
function buildCells(
  onDuty168: number[],
  requirement168: number[],
  bandFloor168: number[],
  bandCeiling168: number[],
  arrivals168: number[],
  belowFloorSet: Set<string>
): WhppvHeatmapCell[] {
  const cells: WhppvHeatmapCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const g = day * 24 + hour;
      const belowFloor = belowFloorSet.has(`${day}-${hour}`);
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
      });
    }
  }
  return cells;
}

/**
 * PANEL 1 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §4) — "What your department demands, and what
 * you staff against it." Absorbs the old `CurrentStaffingAnalysis`, `CoreGridTab`'s coverage-
 * summary stats, and `HiddenBoardingSection`. See .claude/rules/results-redesign.md's
 * "Results Page V2" PR E section for the judgment calls this panel makes explicit (what
 * "capacity" means per toggle view — the spec doesn't give exact formulas).
 */
export function Panel1() {
  const {
    shiftMenu,
    arrivals,
    currentStaffingGrid,
    wHppvTarget,
    boardingRatioTarget,
    bhBoardingRatioTarget,
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

  const backlog = useMemo(
    () => computeBacklog(grid, result.hourlyRequirement, sortedShiftMenu),
    [grid, result.hourlyRequirement, sortedShiftMenu]
  );

  const hidden = useMemo(
    () => computeHiddenBoardingDiagnostic(result.hourlyRequirement, grid, sortedShiftMenu, result.boarding?.cellBoardingRnHours ?? null),
    [grid, result.hourlyRequirement, sortedShiftMenu, result.boarding]
  );

  const currentCapacity = useMemo(() => fullWeekCapacity(grid, sortedShiftMenu), [grid, sortedShiftMenu]);
  const boardingCurve = result.boarding?.cellBoardingRnHours ?? null;

  if (!hasCurrentStaffing) {
    return (
      <section className="card panel panel-1" id="ch-current-staffing">
        <h2>What your department demands, and what you staff against it</h2>
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

  // Late-ramp sentence (§3.2) — when demand peaks vs. when staffing peaks, on the average day.
  const avgDemand = averageDay(result.hourlyRequirement);
  const avgCapacity = averageDay(currentCapacity);
  const peakDemandHour = avgDemand.indexOf(Math.max(...avgDemand));
  const peakCapacityHour = avgCapacity.indexOf(Math.max(...avgCapacity));
  const rampGap = (peakCapacityHour - peakDemandHour + 24) % 24;

  // Effective wHPPV (§3.3) — never compared to the band.
  const consumed = result.lostProductivity?.wHppvConsumedByBoarding ?? null;
  const effectiveAfterBoarding = consumed !== null ? realized - consumed : null;

  // The two backlog sentences (§3.1) — STRUCTURAL (sizing) + CYCLICAL (shape), never the
  // blended actual curve (see .claude/rules/engine-solver.md's PR A section for why that
  // blend was the mechanical cause of the old "never clears" bug).
  const structuralShort = -backlog.structuralFloorMin; // positive = short every day by this much
  const cyclicalClearHour =
    backlog.cyclicalLongestStreakStart && !backlog.cyclicalNeverClears
      ? (backlog.cyclicalLongestStreakStart.day * 24 + backlog.cyclicalLongestStreakStart.hour + backlog.cyclicalLongestStreakHours) % 168
      : null;

  const enaFloorSet = new Set(current.enaFloorViolationsRemaining.map((v) => `${v.day}-${v.hour}`));

  const combinedRequirement = result.hourlyRequirement.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));
  const spareForBoarding = currentCapacity.map((c, i) => Math.max(0, c - (result.hourlyRequirement[i] ?? 0)));
  const effectiveWhppv168 = currentCapacity.map((c, i) => {
    const a = arrivals[i] ?? 0;
    if (a <= 0) return 0;
    return (c - (boardingCurve ? boardingCurve[i] : 0)) / a;
  });

  const arrivalsCells = buildCells(currentCapacity, result.hourlyRequirement, result.bandFloorHourly, result.bandCeilingHourly, arrivals, enaFloorSet);
  const boardingCells = boardingCurve
    ? buildCells(spareForBoarding, boardingCurve, boardingCurve, boardingCurve, arrivals, enaFloorSet)
    : arrivalsCells;
  const combinedBandFloor = result.bandFloorHourly.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));
  const combinedBandCeiling = result.bandCeilingHourly.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));
  const combinedCells = buildCells(currentCapacity, combinedRequirement, combinedBandFloor, combinedBandCeiling, arrivals, enaFloorSet);

  const views: VisualFrameView[] = [
    {
      key: 'arrivals',
      label: 'Arrivals',
      demand168: result.hourlyRequirement,
      capacity168: currentCapacity,
      queueDepth168: backlog.cyclicalBacklog,
      structuralFloor: backlog.structuralFloorMin,
      heatmapCells: arrivalsCells,
    },
    ...(boardingCurve
      ? [
          {
            key: 'boarding',
            label: 'Boarding',
            demand168: boardingCurve,
            capacity168: spareForBoarding,
            queueDepth168: null,
            structuralFloor: null,
            heatmapCells: boardingCells,
          } satisfies VisualFrameView,
        ]
      : []),
    {
      key: 'combined',
      label: 'Combined',
      demand168: combinedRequirement,
      capacity168: currentCapacity,
      queueDepth168: backlog.cyclicalBacklog,
      structuralFloor: backlog.structuralFloorMin,
      heatmapCells: combinedCells,
    },
    {
      key: 'effective',
      label: 'Effective wHPPV',
      demand168: new Array(168).fill(wHppvTarget ?? 0),
      capacity168: effectiveWhppv168,
      queueDepth168: null,
      structuralFloor: null,
      heatmapCells: combinedCells,
    },
  ];

  return (
    <section className="panel panel-1" id="ch-current-staffing">
      <div className="panel-columns">
        <div className="panel-words">
          <h2>What your department demands, and what you staff against it</h2>

          <p className="comparison-headline">
            Your current staffing realizes <strong>{realized.toFixed(2)} wHPPV</strong>, running{' '}
            {position === 'within' ? 'within' : position === 'below' ? 'below' : 'above'} the peer band
            (<strong>{band.p25Whppv.toFixed(2)}–{band.p75Whppv.toFixed(2)}</strong> for your volume) at{' '}
            <strong>{current.weeklyScheduledHours.toFixed(0)} hours/week</strong>.
          </p>

          <p>
            On an average day, demand peaks around <strong>{fmtHour(peakDemandHour)}</strong>, but your staffing
            doesn't peak until <strong>{fmtHour(peakCapacityHour)}</strong>
            {rampGap > 0 ? ` — roughly a ${rampGap}-hour lag` : ' — no lag'}.
          </p>

          {result.boarding && (
            <>
              <p>
                Boarding demands the equivalent of <strong>{(result.lostProductivity?.wHppvConsumedByBoarding ?? 0).toFixed(2)} wHPPV</strong>,
                about <strong>{result.annualVisits > 0 ? (((result.lostProductivity?.wHppvConsumedByBoarding ?? 0) / wHppvTarget) * 100).toFixed(0) : 0}%</strong> of
                your department's total nursing demand. Medical boarding is staffed at a 1:{boardingRatioTarget} nurse-to-patient
                ratio; behavioral-health boarding at 1:{bhBoardingRatioTarget} — BH boarders draw less licensed RN time per
                patient, not because they need less care, but less of it is nursing-specific.
              </p>
              {result.boarding.bhWeeklyRnHours !== null && (
                <div className="banner banner-info">
                  These figures describe <strong>RN care only</strong>. Behavioral-health boarding places a disproportionate
                  burden on techs, sitters, and security, and the operational cost of maintaining patient and staff safety
                  for these patients is <strong>understated</strong> by any RN-staffing view — including this one.
                </div>
              )}
            </>
          )}

          {effectiveAfterBoarding !== null && (
            <p>
              Of the nursing time per visit you staff, <strong>{effectiveAfterBoarding.toFixed(2)} wHPPV</strong> effectively
              remains for your ED patients once boarding is accounted for. This number is <strong>not</strong> compared to
              the peer band above — peer figures include their own boarding load, so a boarding-stripped number isn't
              comparable to them.
            </p>
          )}

          <p>{hiddenBoardingNightSentence(hidden.night, hidden.boardingDataPresent)}</p>
          <p>{hiddenBoardingDaySentence(hidden.day, hidden.boardingDataPresent)}</p>

          <p>
            {structuralShort > 0.5
              ? `You are short about ${structuralShort.toFixed(0)} nurse-hours a day against arrivals alone, so you begin
                 each day already behind.`
              : `Your staffing doesn't leave you starting any day already behind — what backlog exists is shape, not size.`}
          </p>
          <p>
            {backlog.cyclicalLongestStreakStart
              ? `Within a day, the queue builds starting around ${fmtDayHour(backlog.cyclicalLongestStreakStart)}, peaks
                 around ${backlog.cyclicalPeakAt ? fmtDayHour(backlog.cyclicalPeakAt) : 'midday'}, and ${
                  backlog.cyclicalNeverClears || cyclicalClearHour === null
                    ? 'does not fully clear'
                    : `would clear by around ${fmtHour(cyclicalClearHour % 24)}`
                } if the day itself were fully staffed.`
              : 'Within a day, the queue keeps pace hour to hour, with no sustained shape problem building up.'}
          </p>

          <div className="banner banner-info queue-honesty-callout">
            This queue assumes every patient gets the full nursing time your target implies. In reality, when you are
            short, nurses do not let a line form — they go faster. So the backlog shown here usually is not a visible
            waiting room. It is care compressed, checks skipped, and breaks missed. It shows up as burnout, turnover,
            and patients who leave before being seen, not as a queue anyone can point to.
          </div>
        </div>
        <div className="panel-frame">
          <VisualFrame views={views} shiftMenu={sortedShiftMenu} />
        </div>
      </div>
    </section>
  );
}
