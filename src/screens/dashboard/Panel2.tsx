import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { DAY_LABELS } from '../../engine/types';
import type { Grid, ShiftDef } from '../../engine/types';
import { computeBacklog, computeBacklogFromCapacity, computeScenarioB, computeCombinedReallocation, computePerShiftDiagnostic } from '../../engine';
import { fullWeekCapacity } from '../../engine/solver';
import { lookupWhppvBand } from '../../lib/edbaLookup';
import { computeColorDomain } from '../../lib/whppvColorDomain';
import { VisualFrame, type VisualFrameView } from '../../components/VisualFrame';
import type { WhppvHeatmapCell } from '../../components/WhppvHeatmap';
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
import { shiftDiagnosticSentence } from '../../lib/narrative';
import { DISPLAY_DAY_ORDER, DISPLAY_DAY_LABELS } from '../../lib/dayOrder';

function sortByStartHour(shifts: ShiftDef[]): ShiftDef[] {
  return [...shifts].sort((a, b) => a.startHour - b.startHour);
}

/** `perShiftBreakdown168`, when passed, gives split cell text/tooltip when more than one shift
 * structurally covers a global hour (same convention as Panel 1's heatmap, §7) — only
 * meaningful when `onDuty168` IS actual reallocated-grid headcount, which is true for both of
 * this panel's toggles (their capacity comes straight from `fullWeekCapacity` on a real grid). */
function buildCells(
  onDuty168: number[],
  requirement168: number[],
  demandRaw168: number[],
  arrivals168: number[],
  perShiftBreakdown168?: Array<Array<{ label: string; headcount: number }>>
): WhppvHeatmapCell[] {
  const cells: WhppvHeatmapCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const g = day * 24 + hour;
      const perShift = perShiftBreakdown168 && perShiftBreakdown168[g].length > 1 ? perShiftBreakdown168[g] : undefined;
      cells.push({
        day,
        hour,
        onDuty: onDuty168[g] ?? 0,
        requirement: requirement168[g] ?? 0,
        demandRaw: demandRaw168[g] ?? 0,
        arrivals: arrivals168[g] ?? 0,
        belowFloor: false,
        riskReasons: [],
        perShift,
      });
    }
  }
  return cells;
}

/** Total weekly scheduled nurse-hours a grid produces — Σ headcount × shift length, every
 * (day, shift) cell. Used to state the reallocated grid's own hours/week figure; since
 * `reallocateHoursExact` (engine/exactReallocation.ts) only ever trades one shift-unit for
 * another, this is provably identical to the current grid's own total — see the
 * "no change" wording below. */
function weeklyScheduledHoursOf(grid: Grid, shiftMenu: ShiftDef[]): number {
  let total = 0;
  for (let day = 0; day < 7; day++) {
    const headcount = grid[day] ?? {};
    for (const s of shiftMenu) total += (headcount[s.id] ?? 0) * s.lengthHours;
  }
  return total;
}

interface HourlyWhppvExtreme {
  value: number;
  day: number;
  hour: number;
}

/** Hour-to-hour realized WHPPV range — direct per-cell nurse-hours ÷ arrivals, same formula
 * Panel 1 uses for its own realized-WHPPV range (see Panel1.tsx). Zero-arrival cells are
 * skipped (no meaningful per-visit ratio there). */
function hourlyWhppvRange(
  capacity168: number[],
  arrivals168: number[]
): { min: HourlyWhppvExtreme | null; max: HourlyWhppvExtreme | null } {
  let min: HourlyWhppvExtreme | null = null;
  let max: HourlyWhppvExtreme | null = null;
  for (let g = 0; g < 168; g++) {
    const cellArrivals = arrivals168[g] ?? 0;
    if (cellArrivals <= 0) continue;
    const value = (capacity168[g] ?? 0) / cellArrivals;
    const day = Math.floor(g / 24);
    const hour = g % 24;
    if (!min || value < min.value) min = { value, day, hour };
    if (!max || value > max.value) max = { value, day, hour };
  }
  return { min, max };
}

/** % of hours (arrivals > 0 only, same denominator as hourlyWhppvRange) whose realized WHPPV
 * falls below the peer cohort's p25 floor — deliberately one-sided (2026-08-05): the solver
 * optimizes for minimizing queue cost, not for hugging the peer-typical band, so it can
 * legitimately push some hours ABOVE p75 (whole shift blocks overshooting a quiet hour while
 * fixing a worse one elsewhere) — that's not a problem this stat should flag. Same formula
 * Panel 1/Panel 4 use for their own "X% of hours fall below your peer-typical range" line. */
function pctHoursBelowFloor(capacity168: number[], arrivals168: number[], p25: number): number {
  let total = 0;
  let below = 0;
  for (let g = 0; g < 168; g++) {
    const cellArrivals = arrivals168[g] ?? 0;
    if (cellArrivals <= 0) continue;
    total++;
    const value = (capacity168[g] ?? 0) / cellArrivals;
    if (value < p25) below++;
  }
  return total > 0 ? (below / total) * 100 : 0;
}

/**
 * PANEL 2 (PANEL2_REWORK_SPEC_2026-07-28, planned in Cowork) — "What can moving hours fix?"
 * Reuses `computeScenarioB` (arrivals only) and `computeCombinedReallocation` (arrivals +
 * boarding) UNCHANGED — no new engine work. Two toggles only ("Current" is dropped — Panel 1
 * already shows current staffing). Below the toggle: a shift-change diff grid (each cell shows
 * the reallocated headcount with the +/- delta in parentheses), a whole-schedule WHPPV mirror
 * of Panel 1's own current-staffing framing (still X WHPPV at X hours/week — necessarily
 * unchanged, since `reallocateHoursExact` only ever trades hours, never adds/removes them —
 * plus the hour-to-hour realized-WHPPV range and how its variance compares to today's), and a
 * backlog build/peak/clear stat (reusing Panel 1's shared `lib/queuePattern.ts` helpers) — all
 * vocabulary Panel 1 already introduced, rather than inventing new stats.
 */
export function Panel2() {
  const { shiftMenu, arrivals, currentStaffingGrid, buildEngineInputs, getResult } = useStore();
  const result = getResult();
  const sortedShiftMenu = useMemo(() => sortByStartHour(shiftMenu), [shiftMenu]);
  const grid = currentStaffingGrid ?? {};
  const inputs = buildEngineInputs();

  const [active, setActive] = useState<'arrivals' | 'combined'>('arrivals');

  const hasCurrentStaffing = Object.values(grid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));

  if (!hasCurrentStaffing) {
    return (
      <section className="card panel panel-2" id="ch-scenario-b">
        <h2>What can moving hours fix?</h2>
        <p>Add your current staffing above to see whether reallocating the same hours would close any gap.</p>
      </section>
    );
  }

  const scenarioB = computeScenarioB(result, inputs, grid);
  const combinedRealloc = computeCombinedReallocation(result, inputs, grid);
  const boardingCurve = result.boarding?.cellBoardingRnHours ?? null;
  const combinedRequirement = result.hourlyRequirement.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));
  // Tooltip-only fractional counterpart, pre-`Math.ceil` — see WhppvHeatmapCell.demandRaw.
  const combinedRequirementRaw = result.cellCoreHoursSmoothed.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));

  const currentCapacity = fullWeekCapacity(grid, sortedShiftMenu);
  const arrivalsCapacity = scenarioB ? fullWeekCapacity(scenarioB.grid, sortedShiftMenu) : currentCapacity;
  const combinedCapacity = combinedRealloc ? fullWeekCapacity(combinedRealloc.grid, sortedShiftMenu) : currentCapacity;

  const arrivalsReallocatedGrid = scenarioB?.grid ?? grid;
  const combinedReallocatedGrid = combinedRealloc?.grid ?? grid;

  const stateFor = (key: 'arrivals' | 'combined') =>
    key === 'arrivals'
      ? {
          demand: result.hourlyRequirement,
          demandRaw: result.cellCoreHoursSmoothed,
          capacity: arrivalsCapacity,
          reallocatedGrid: arrivalsReallocatedGrid,
        }
      : {
          demand: combinedRequirement,
          demandRaw: combinedRequirementRaw,
          capacity: combinedCapacity,
          reallocatedGrid: combinedReallocatedGrid,
        };

  const activeState = stateFor(active);

  // Backlog build/peak/clear is an ARRIVALS-specific measure, full stop — never re-derived
  // against the combined (arrivals+boarding) demand curve, which has no honest "queue" concept
  // (see backlogModel.ts's header on the no-compression degenerate case). Every toggle asks the
  // SAME question — "how does this reallocated grid's capacity affect the arrivals backlog?" —
  // only the GRID varies by toggle, never the demand curve or compression floor.
  const avgArrivalsDemand = averageDay(result.hourlyRequirement);
  const backlogAfter = computeBacklog(activeState.reallocatedGrid, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv);
  const patternAfter = computeQueuePattern(averageDay(backlogAfter.backlog), avgArrivalsDemand);
  const weekdayPatternAfter = computeQueuePattern(
    averageOverDays(backlogAfter.backlog, WEEKDAY_DAYS),
    averageOverDays(result.hourlyRequirement, WEEKDAY_DAYS)
  );
  const weekendPatternAfter = computeQueuePattern(
    averageOverDays(backlogAfter.backlog, WEEKEND_DAYS),
    averageOverDays(result.hourlyRequirement, WEEKEND_DAYS)
  );
  const splitMeaningfullyAfter = patternsDifferMeaningfully(weekdayPatternAfter, weekendPatternAfter);

  // Demand-vs-staffing peak lag, same sentence shape as Panel 1's late-ramp sentence — this one
  // legitimately follows the active toggle's own demand curve (it's describing that toggle's
  // own demand/capacity chart, not the backlog). Computed both today (current grid) and on the
  // reallocated schedule so the sentence can honestly state when a lag disappears, and skip
  // itself entirely when there was never one to begin with (redundant with Panel 1 otherwise).
  const avgActiveDemand = averageDay(activeState.demand);
  const avgActiveCapacity = averageDay(activeState.capacity);
  const avgCurrentCapacity = averageDay(currentCapacity);
  const peakDemandHour = avgActiveDemand.indexOf(Math.max(...avgActiveDemand));
  const peakCapacityHourAfter = avgActiveCapacity.indexOf(Math.max(...avgActiveCapacity));
  const peakCapacityHourBefore = avgCurrentCapacity.indexOf(Math.max(...avgCurrentCapacity));
  const rampGapAfter = (peakCapacityHourAfter - peakDemandHour + 24) % 24;
  const rampGapBefore = (peakCapacityHourBefore - peakDemandHour + 24) % 24;

  // Reallocated-grid WHPPV: total hours/week (conserved EXACTLY by `reallocateHoursExact` —
  // see engine/exactReallocation.ts — hence "no change") and the hour-to-hour realized-WHPPV
  // range, compared against the same range computed on today's actual grid.
  const reallocatedWeeklyHours = weeklyScheduledHoursOf(activeState.reallocatedGrid, sortedShiftMenu);
  const reallocatedRealizedWhppv = result.annualVisits > 0 ? (reallocatedWeeklyHours * 52) / result.annualVisits : 0;
  const reallocatedWhppvRange = hourlyWhppvRange(activeState.capacity, arrivals);
  const band = lookupWhppvBand(result.annualVisits);
  const whppvBand = computeColorDomain(result.annualVisits, inputs.wHppvTarget);
  const pctBelowFloor = pctHoursBelowFloor(activeState.capacity, arrivals, band.p25Whppv);

  // Same per-shift diagnostic Panel 1 shows for current staffing (§4,
  // engine/hiddenBoarding.ts), scored against THIS reallocated grid instead — boarding is only
  // folded in under the 'combined' toggle, matching that toggle's own demand curve (unlike
  // Panel 1, which has only one grid and always shows boarding when present).
  const perShiftDiagnostic = computePerShiftDiagnostic(
    result.hourlyRequirement,
    activeState.reallocatedGrid,
    sortedShiftMenu,
    result.bandFloorHourly,
    result.bandCeilingHourly,
    active === 'combined' ? boardingCurve : null
  );

  // Backlog is fundamentally an arrivals-visits concept (queueing for a nurse); boarding has no
  // such concept, so feeding a merged arrivals+boarding demand curve into the recurrence (the
  // old 'combined' behavior, via NO_COMPRESSION_FLOOR_WHPPV) degenerates to a flat deficit
  // carry-forward against a curve that was never real "backlog." Instead, same reference shape
  // as Panel1.tsx's "Arrivals + Boarding" toggle: net boarding's claim out of capacity FIRST,
  // then run the real arrivals backlog recurrence (real floorWhppv, real arrivals visits)
  // against whatever capacity boarding leaves behind. The 'arrivals' toggle has nothing to net
  // (boardingCurve168 all zero there in effect), so this is a no-op for it.
  const views: VisualFrameView[] = (['arrivals', 'combined'] as const)
    .filter((key) => key !== 'combined' || combinedRealloc)
    .map((key) => {
      const s = stateFor(key);
      const netOfBoardingCapacity =
        key === 'combined' && boardingCurve ? s.capacity.map((c, i) => Math.max(0, c - (boardingCurve[i] ?? 0))) : s.capacity;
      const b = computeBacklogFromCapacity(netOfBoardingCapacity, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv);
      const label = key === 'arrivals' ? 'Arrivals' : 'Arrivals + Boarding';
      const perShiftBreakdown = buildPerShiftBreakdown(sortedShiftMenu, s.reallocatedGrid);
      return {
        key,
        label,
        demand168: s.demand,
        capacity168: s.capacity,
        queueDepth168: b.cyclicalBacklog,
        structuralFloor: b.structuralFloorMin,
        heatmapCells: buildCells(s.capacity, s.demand, s.demandRaw, arrivals, perShiftBreakdown),
      } satisfies VisualFrameView;
    });

  return (
    <section className="panel panel-2" id="ch-scenario-b">
      <div className="panel-columns">
        <div className="panel-words">
          <h2>What can moving hours fix?</h2>
          <p>
            Holding your total hours flat, toggling between "Arrivals" and "Arrivals + Boarding" shows how the
            solver would redistribute shifts to better match demand — either focusing on arrivals or stretching to
            also cover boarding.
          </p>

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
                  {DISPLAY_DAY_ORDER.map((day) => {
                    const newValue = activeState.reallocatedGrid[day]?.[s.id] ?? 0;
                    const diff = newValue - (grid[day]?.[s.id] ?? 0);
                    return (
                      <td key={day}>
                        <span className="diff-cell">
                          <span className="diff-main">{newValue}</span>
                          <span className="diff-delta">({diff > 0 ? `+${diff}` : diff})</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <details className="why-toggle-wrap">
            <summary className="btn-link why-toggle">Why might day-to-day numbers look uneven?</summary>
            <div className="why-explainer">
              <p>
                The model is trying to match staffing to demand each day, not aiming for a steady pattern across the
                week. To smooth it out, you can test alternatives further down in "Test it yourself."
              </p>
            </div>
          </details>

          <p>
            Staffing still realizes <strong>{reallocatedRealizedWhppv.toFixed(2)} WHPPV</strong> at{' '}
            <strong>{reallocatedWeeklyHours.toFixed(0)} hours/week</strong>, no change.
          </p>

          {reallocatedWhppvRange.min && reallocatedWhppvRange.max && (
            <>
              <p>
                Hour to hour, WHPPV now ranges from <strong>{reallocatedWhppvRange.min.value.toFixed(2)}</strong> (
                {DAY_LABELS[reallocatedWhppvRange.min.day]} {fmtHour(reallocatedWhppvRange.min.hour)}) up to{' '}
                <strong>{reallocatedWhppvRange.max.value.toFixed(2)}</strong> ({DAY_LABELS[reallocatedWhppvRange.max.day]}{' '}
                {fmtHour(reallocatedWhppvRange.max.hour)}). <strong>{pctBelowFloor.toFixed(0)}%</strong> of hours fall
                below your peer-typical range.
              </p>
              <details className="why-toggle-wrap">
                <summary className="btn-link why-toggle">What is my peer-typical range?</summary>
                <div className="why-explainer">
                  <p>
                    Your peer-typical range is{' '}
                    <strong>
                      {band.p25Whppv.toFixed(2)}–{band.p75Whppv.toFixed(2)} WHPPV
                    </strong>{' '}
                    — the 25th–75th percentile WHPPV reported by EDs of a similar annual volume to yours,
                    each measured as a single year-round average, not hour by hour. It's normal for individual
                    hours to fall outside this range even when your average staffing is appropriate — that's
                    expected, not a problem on its own. Think of it as a rough gauge of how over- or
                    understaffed a given hour would feel to the staff working it, not a target every hour needs
                    to hit.
                  </p>
                </div>
              </details>
            </>
          )}

          {perShiftDiagnostic.groups.map((group) => (
            <p key={group.shiftIds.join('-')}>{shiftDiagnosticSentence(group)}</p>
          ))}

          {(rampGapBefore > 0 || rampGapAfter > 0) && (
            <p>
              On this reallocated schedule, demand peaks around <strong>{fmtHour(peakDemandHour)}</strong>
              {rampGapAfter === 0 ? (
                <>
                  , and staffing peaks at <strong>{fmtHour(peakCapacityHourAfter)}</strong> — no longer any lag.
                </>
              ) : (
                <>
                  , but staffing doesn't peak until <strong>{fmtHour(peakCapacityHourAfter)}</strong> — roughly a{' '}
                  {rampGapAfter}-hour lag.
                </>
              )}
            </p>
          )}

          {splitMeaningfullyAfter ? (
            <>
              <p>{queuePatternSentence(weekdayPatternAfter, 'On weekdays under this reallocated schedule, ', result.floorWhppv)}</p>
              <p>{queuePatternSentence(weekendPatternAfter, 'On weekends under this reallocated schedule, ', result.floorWhppv)}</p>
            </>
          ) : (
            <p>{queuePatternSentence(patternAfter, 'On this reallocated schedule, ', result.floorWhppv)}</p>
          )}
        </div>
        <div className="panel-frame">
          <VisualFrame
            views={views}
            shiftMenu={sortedShiftMenu}
            whppvBand={whppvBand}
            activeKey={active}
            onActiveKeyChange={(k) => setActive(k as 'arrivals' | 'combined')}
          />
        </div>
      </div>
    </section>
  );
}
