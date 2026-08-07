import { useState } from 'react';
import { useStore } from '../../store';
import type { ShiftDef } from '../../engine/types';
import { DEFAULTS, DAY_LABELS } from '../../engine/types';
import { computePerShiftDiagnostic } from '../../engine';
import { recommendWeeklyBoardingGrid, weeklyArrivalsSpareByCell } from '../../engine/boarding';
import { lookupWhppvBand } from '../../lib/edbaLookup';
import { computeColorDomain } from '../../lib/whppvColorDomain';
import { fullWeekCapacity, solveFullCoverageWeekWithTrajectory } from '../../engine/solver';
import { MarginalReturnsCurve } from '../../components/MarginalReturnsCurve';
import { VisualFrame, type VisualFrameView } from '../../components/VisualFrame';
import type { WhppvHeatmapCell } from '../../components/WhppvHeatmap';
import { DISPLAY_DAY_ORDER, DISPLAY_DAY_LABELS } from '../../lib/dayOrder';
import { fmtHour } from '../../lib/queuePattern';
import { shiftDiagnosticSentence } from '../../lib/narrative';

function sortByStartHour(shifts: ShiftDef[]): ShiftDef[] {
  return [...shifts].sort((a, b) => a.startHour - b.startHour);
}

type HourlyWhppvExtreme = { value: number; day: number; hour: number };

/** Same helper Panel 2 uses for its own reallocated-vs-current variance sentence — a direct
 * per-cell capacity/arrivals ratio, zero-arrival cells skipped. */
function hourlyWhppvRange(capacity168: number[], arrivals168: number[]): { min: HourlyWhppvExtreme | null; max: HourlyWhppvExtreme | null } {
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
 * Panel 1/Panel 2 use for their own "X% of hours fall below your peer-typical range" line. */
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

/** % of the given 168-hour demand curve's total nursing-hours a 168-hour capacity curve
 * actually covers — same `sum(min(capacity, demand)) / sum(demand)` arithmetic the trajectory
 * itself uses for the curve's own Y, so a real grid's dot lands on a directly comparable
 * scale. Used for the "Current staffing"/"ShiftLens Solver" marker POINTS below, which are real
 * grids solved by a different process than the curve's own greedy fill-up — they are NOT
 * guaranteed to land on the curve. */
function pctDemandCovered(capacity168: number[], demand168: number[]): number {
  const total = demand168.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let covered = 0;
  for (let g = 0; g < 168; g++) covered += Math.min(capacity168[g] ?? 0, demand168[g] ?? 0);
  return Math.max(0, Math.min(100, (covered / total) * 100));
}

/** Linear interpolation of the curve's own Y at an arbitrary X — used only to size the
 * "the solver's result sits below/above this curve" disclosure, never to reposition a marker. */
function curveValueAt(points: { x: number; y: number }[], x: number): number {
  if (points.length === 0) return 0;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x >= x) {
      const a = points[i - 1];
      const b = points[i];
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return points[points.length - 1].y;
}

// MarginalReturnsCurve moved to components/MarginalReturnsCurve.tsx (2026-08-05, Panel 5
// redesign) so Panel5.tsx's own "% demand covered vs. shifts/week" curve (§9) can reuse the
// exact same chart instead of duplicating the SVG — see that file's own header.

function buildCells(
  onDuty168: number[],
  requirement168: number[],
  demandRaw168: number[],
  arrivals168: number[],
  boardingCurve168?: number[] | null
): WhppvHeatmapCell[] {
  const cells: WhppvHeatmapCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const g = day * 24 + hour;
      cells.push({
        day,
        hour,
        onDuty: onDuty168[g] ?? 0,
        requirement: requirement168[g] ?? 0,
        demandRaw: demandRaw168[g] ?? 0,
        arrivals: arrivals168[g] ?? 0,
        boardingRnHours: boardingCurve168 ? (boardingCurve168[g] ?? 0) : undefined,
        belowFloor: false,
        riskReasons: [],
      });
    }
  }
  return cells;
}

/**
 * PANEL 4 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §4) — "Recommended staffing." R11: "idealized"
 * is renamed "recommended" everywhere in this panel's copy (engine field names — `result.grid`
 * etc. — are unchanged). REPLACES `FundingAskSection.tsx`/`FinancePartnerWorksheet.tsx` (R8,
 * their useful content absorbed into the "benefit per additional shift" section below) and
 * folds `ShiftMenuFlexibilitySection.tsx` in, collapsed, at the bottom.
 *
 * JUDGMENT CALL, flagged (see .claude/rules/results-redesign.md's PR F section): the spec asks
 * for "each additional shift removes roughly X HOURS of unmet need" — the engine's marginal
 * curve only records convex severity per point, not raw backlog-hours per point (no new engine
 * work was scoped for this PR). This panel approximates the hours figure by applying the SAME
 * percentage reduction the severity curve already shows to `EngineResult.totalBacklogHours`
 * (the real current total) — a disclosed approximation, not a fabricated number, but an
 * approximation nonetheless.
 */
export function Panel4() {
  const { shiftMenu, arrivals, currentStaffingGrid, buildEngineInputs, getResult } = useStore();
  const result = getResult();
  const sortedShiftMenu = sortByStartHour(shiftMenu);
  const inputs = buildEngineInputs();
  const hoursPerFteAnnual = inputs.hoursPerFteAnnual ?? DEFAULTS.hoursPerFteAnnual;
  const [active, setActive] = useState<'arrivals' | 'combined'>('arrivals');

  const currentGrid = currentStaffingGrid ?? {};
  const currentWeeklyHours = sortedShiftMenu.reduce(
    (acc, s) => acc + Object.keys(currentGrid).reduce((a, d) => a + (currentGrid[Number(d)]?.[s.id] ?? 0) * s.lengthHours, 0),
    0
  );

  // "Benefit per additional shift" — reframed from the marginal curve (R8 absorbs
  // FundingAskSection's/FinancePartnerWorksheet's useful content). See header note on the
  // hours-approximation judgment call.
  const worstPoint = result.marginalCurve.length > 0 ? result.marginalCurve[result.marginalCurve.length - 1] : null;
  const kneePointData =
    result.marginalKneePoint !== null ? result.marginalCurve.find((p) => p.cumulativeHoursAdded === result.marginalKneePoint) ?? null : null;
  const kneeFte = result.marginalKneePoint !== null ? (result.marginalKneePoint * 52) / hoursPerFteAnnual : null;
  const pctUnmetRemoved =
    kneePointData && worstPoint && worstPoint.totalSeverity > 0
      ? Math.max(0, Math.min(100, ((worstPoint.totalSeverity - kneePointData.totalSeverity) / worstPoint.totalSeverity) * 100))
      : null;
  const approxHoursRemoved = pctUnmetRemoved !== null ? (result.totalBacklogHours * pctUnmetRemoved) / 100 : null;
  const typicalShiftLength = sortedShiftMenu[0]?.lengthHours ?? 12;

  const totalShiftsAt = (weeklyHours: number) => weeklyHours / typicalShiftLength;
  const hasMeaningfulMarginalCurve = kneeFte !== null && pctUnmetRemoved !== null && approxHoursRemoved !== null && approxHoursRemoved >= 0.5;

  // R6 (display-level sum only — EngineResult.grid stays arrivals-only, never mutated/stored).
  // 2026-07-30: the boarding ask is netted against whatever spare capacity the arrivals
  // recommendation already has (weeklyArrivalsSpareByCell/recommendWeeklyBoardingGrid's
  // optional 6th param) — a "reasonable ask" that credits the flexibility ED nurses already
  // provide before asking for anything additional, rather than asking for boarding coverage
  // in a vacuum. See .claude/rules/boarding-seasonality.md.
  const boarding = result.boarding;
  const band = lookupWhppvBand(result.annualVisits);
  const whppvBand = computeColorDomain(result.annualVisits, inputs.wHppvTarget);
  const arrivalsSpareByCell = weeklyArrivalsSpareByCell(result.grid, result.hourlyRequirement, sortedShiftMenu);
  const boardingGrid =
    boarding && result.lostProductivity
      ? recommendWeeklyBoardingGrid(
          boarding,
          sortedShiftMenu,
          inputs.wHppvTarget,
          band.p25Whppv,
          result.lostProductivity.wHppvConsumedByBoarding,
          arrivalsSpareByCell
        )
      : {};
  const combinedGrid: typeof result.grid = {};
  for (let day = 0; day < 7; day++) {
    combinedGrid[day] = {};
    for (const s of sortedShiftMenu) {
      combinedGrid[day][s.id] = (result.grid[day]?.[s.id] ?? 0) + (boardingGrid[day]?.[s.id] ?? 0);
    }
  }

  const arrivalsCapacity = fullWeekCapacity(result.grid, sortedShiftMenu);
  const combinedCapacity = fullWeekCapacity(combinedGrid, sortedShiftMenu);
  const boardingCurve = boarding?.cellBoardingRnHours ?? null;
  const combinedRequirement = result.hourlyRequirement.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));
  // Tooltip-only fractional counterpart, pre-`Math.ceil` — see WhppvHeatmapCell.demandRaw.
  const combinedRequirementRaw = result.cellCoreHoursSmoothed.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));
  const combinedWeeklyHours = sortedShiftMenu.reduce(
    (acc, s) => acc + Object.keys(combinedGrid).reduce((a, d) => a + (combinedGrid[Number(d)]?.[s.id] ?? 0) * s.lengthHours, 0),
    0
  );

  // This staffing's average + hour-to-hour realized WHPPV for the active toggle — same
  // computation Panel 1/Panel 3 use (realizedWHppv = weeklyHours*52/annualVisits; min/max is
  // a direct per-cell capacity/arrivals ratio, zero-arrival cells skipped).
  const activeCapacity = active === 'arrivals' ? arrivalsCapacity : combinedCapacity;
  const activeWeeklyHours = active === 'arrivals' ? result.weeklyScheduledHours : combinedWeeklyHours;
  const avgWhppv = (activeWeeklyHours * 52) / result.annualVisits;
  const { min: minHourlyWhppv, max: maxHourlyWhppv } = hourlyWhppvRange(activeCapacity, arrivals);
  const pctBelowFloor = pctHoursBelowFloor(activeCapacity, arrivals, band.p25Whppv);
  // Same relative-FTE framing Panel 3 uses (fteDelta = hours gap * 52 / hoursPerFteAnnual), but
  // signed both ways — Panel 3's ceiling is guaranteed >= current staffing, this recommendation
  // isn't.
  const fteDelta = ((activeWeeklyHours - currentWeeklyHours) * 52) / hoursPerFteAnnual;

  // Same per-shift diagnostic Panel 1 shows for current staffing (§4, engine/hiddenBoarding.ts),
  // scored against THIS toggle's own recommended grid — boarding only folds in under 'combined',
  // matching that toggle's own demand curve (unlike Panel 1, which has one grid and always shows
  // boarding when present).
  const activeGrid = active === 'arrivals' ? result.grid : combinedGrid;
  const perShiftDiagnostic = computePerShiftDiagnostic(
    result.hourlyRequirement,
    activeGrid,
    sortedShiftMenu,
    result.bandFloorHourly,
    result.bandCeilingHourly,
    active === 'combined' ? boardingCurve : null
  );

  const currentCapacity = fullWeekCapacity(currentGrid, sortedShiftMenu);

  // Diminishing-returns curve (prose column) — TOGGLE-AWARE, starting from a genuine 0
  // shifts scheduled, per Ben's correction: the trim-based `result.marginalCurve` only spans
  // [capped/budget state, full coverage], never 0 — a real "start from nothing, add one shift
  // at a time" curve needs the greedy FULL-COVERAGE search itself run from an empty grid, not
  // the trim. `solveFullCoverageWeekWithTrajectory` (engine/solver.ts) does exactly that,
  // against THIS toggle's own demand curve (arrivals-only or arrivals+boarding) — a fresh,
  // advisory-only solve, never touching `result.grid`/`compute()`'s own pipeline. Y is the
  // literal % of that demand curve's total nursing-hours covered by each cumulative shift
  // count — naturally monotonic/diminishing by construction (greedy always picks the
  // currently-most-deficit-relieving candidate), no envelope/smoothing needed.
  const activeDemand168 = active === 'arrivals' ? result.hourlyRequirement : combinedRequirement;
  const totalDemandHours = activeDemand168.reduce((a, b) => a + b, 0);
  const marginalCurvePoints =
    totalDemandHours > 0
      ? [
          { x: 0, y: 0 },
          ...solveFullCoverageWeekWithTrajectory(activeDemand168, sortedShiftMenu).trajectory.map((p) => ({
            x: p.cumulativeShifts,
            y: Math.max(0, Math.min(100, (p.hoursCovered / totalDemandHours) * 100)),
          })),
        ]
      : [];
  // Peer-typical WHPPV range (p25-p75), converted to a shift-count SPAN — replaces a single
  // "target-implied hours" line, since the target is a policy choice with no grid shape of its
  // own, while a peer range reads as "what a typical department would need" (see
  // MarginalReturnsCurve's own header comment). weeklyVisits = annualVisits/52 (this ED's own
  // representative week); wHppv × weeklyVisits = the weekly hours that WHPPV implies.
  const weeklyVisits = result.annualVisits / 52;
  const marginalCurveBand =
    totalDemandHours > 0
      ? {
          xMin: totalShiftsAt(band.p25Whppv * weeklyVisits),
          xMax: totalShiftsAt(band.p75Whppv * weeklyVisits),
          label: 'Peer-typical range (p25–p75 WHPPV)',
        }
      : null;

  // "Current staffing"/"ShiftLens Solver" plotted as their own actual % of THIS toggle's demand
  // covered — not constrained to the curve line, since both are real grids solved by a
  // different process than the curve's own greedy fill-up (see pctDemandCovered's header).
  // Labeled "ShiftLens Solver," not "Recommended" — this panel models and explains, it doesn't
  // issue a directive; see the panel's own philosophy framing.
  const recommendedX = totalShiftsAt(activeWeeklyHours);
  const recommendedPctCovered = pctDemandCovered(activeCapacity, activeDemand168);
  const marginalCurveMarkerPoints = [
    ...(currentWeeklyHours > 0
      ? [
          {
            x: totalShiftsAt(currentWeeklyHours),
            y: pctDemandCovered(currentCapacity, activeDemand168),
            label: 'Current staffing',
            color: 'var(--warning)',
          },
        ]
      : []),
    { x: recommendedX, y: recommendedPctCovered, label: 'ShiftLens Solver', color: 'var(--accent)' },
  ];

  // Disclosure for when the ShiftLens Solver result visibly sits off the curve at its own
  // shift count — a real, expected possibility (it minimizes weighted backlog/severity, not raw
  // hours covered; see that marker's own header note), not a bug, but worth naming rather than
  // leaving an unexplained gap. GAP_DISCLOSURE_THRESHOLD_PCT is a tunable display heuristic, not
  // load-bearing math.
  const GAP_DISCLOSURE_THRESHOLD_PCT = 5;
  const recommendedGapPct = curveValueAt(marginalCurvePoints, recommendedX) - recommendedPctCovered;
  const showRecommendedGapDisclosure = Math.abs(recommendedGapPct) >= GAP_DISCLOSURE_THRESHOLD_PCT;

  const views: VisualFrameView[] = [
    {
      key: 'arrivals',
      label: 'Arrivals',
      demand168: result.hourlyRequirement,
      capacity168: arrivalsCapacity,
      queueDepth168: null,
      structuralFloor: null,
      heatmapCells: buildCells(arrivalsCapacity, result.hourlyRequirement, result.cellCoreHoursSmoothed, arrivals),
    },
    ...(boarding
      ? [
          {
            key: 'combined',
            label: 'Arrivals and Boarding',
            demand168: combinedRequirement,
            capacity168: combinedCapacity,
            queueDepth168: null,
            structuralFloor: null,
            heatmapCells: buildCells(combinedCapacity, combinedRequirement, combinedRequirementRaw, arrivals, boardingCurve),
          } satisfies VisualFrameView,
        ]
      : []),
  ];

  return (
    <section className="panel panel-4" id="ch-recommended">
      <div className="panel-columns">
        <div className="panel-words">
          <h2>ShiftLens Solver Staffing</h2>

          <p className="panel4-intro">
            Here ShiftLens Solver produces a staffing grid aiming to land near the median for your peer-typical
            WHPPV. Toggling to "Arrivals + Boarding" adds a separate grid of additional nurses to cover boarding
            demand.
          </p>

          <details className="why-toggle-wrap">
            <summary className="btn-link why-toggle">How does the solver decide?</summary>
            <div className="why-explainer">
              <p>
                Nursing work lands mostly right when a patient arrives, so hourly nurse-need is worked out by
                tracking when patients actually show up, smoothed out so it's realistically staffable, with
                extra protection built in at hours that have historically been more volatile than the average.
              </p>
              {boarding && (
                <p>
                  Because boarding patients build up and linger rather than arriving and being seen all at once,
                  boarding is treated as a second, separate demand from arrivals — not blended into the same
                  hourly curve.
                </p>
              )}
              <p>
                To turn that demand into a schedule, the solver first covers every hour using your actual shift
                menu, then trims back wherever cutting is safest — always staying above a peer-benchmark floor
                (
                <strong>
                  {band.p25Whppv.toFixed(2)}–{band.p75Whppv.toFixed(2)} WHPPV
                </strong>
                , the 25th–75th percentile reported by EDs of a similar annual volume to yours).
              </p>
              <p>
                The key thing to know: the solver's goal is minimizing how much backlog — queued, unattended
                patient work — builds up over the week, not keeping every hour close to what similar EDs
                typically staff. So it can legitimately push some hours further from your peer-typical range,
                because it's fixing your worst, most dangerous hour first, in whole shift blocks that overshoot
                nearby quiet hours — while still producing a safer schedule overall.
              </p>
            </div>
          </details>

          {active === 'combined' && <h3 className="staffing-table-label">Nurses for Arrivals</h3>}
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
                    const newValue = result.grid[day]?.[s.id] ?? 0;
                    const diff = newValue - (currentGrid[day]?.[s.id] ?? 0);
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

          {active === 'combined' && (
            <>
              <h3 className="staffing-table-label">Additional Nurses for Boarding</h3>
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
                        const additional = boardingGrid[day]?.[s.id] ?? 0;
                        return (
                          <td key={day}>
                            <span className="diff-cell">
                              <span className="diff-main">+{additional}</span>
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <details className="why-toggle-wrap">
            <summary className="btn-link why-toggle">Why might day-to-day numbers look uneven?</summary>
            <div className="why-explainer">
              <p>
                The model is trying to match staffing to demand each day, not aiming for a steady pattern across the
                week. To smooth it out, you can test alternatives further down in "Test it yourself."
              </p>
            </div>
          </details>

          <p className="comparison-headline">
            This staffing realizes <strong>{avgWhppv.toFixed(2)} WHPPV</strong> at{' '}
            <strong>{activeWeeklyHours.toFixed(0)} hours/week</strong>.
            {currentWeeklyHours > 0 &&
              (Math.abs(fteDelta) < 0.05 ? (
                ' — the same FTE as you staff today.'
              ) : (
                <>
                  {' '}
                  — <strong>{Math.abs(fteDelta).toFixed(1)} FTE</strong> {fteDelta >= 0 ? 'above' : 'below'} what you
                  staff today.
                </>
              ))}
          </p>

          {minHourlyWhppv && maxHourlyWhppv && (
            <p>
              Hour to hour, WHPPV ranges from <strong>{minHourlyWhppv.value.toFixed(2)}</strong> (
              {DAY_LABELS[minHourlyWhppv.day]} {fmtHour(minHourlyWhppv.hour)}) up to{' '}
              <strong>{maxHourlyWhppv.value.toFixed(2)}</strong> ({DAY_LABELS[maxHourlyWhppv.day]}{' '}
              {fmtHour(maxHourlyWhppv.hour)}). <strong>{pctBelowFloor.toFixed(0)}%</strong> of hours fall
              below your peer-typical range.
            </p>
          )}

          {perShiftDiagnostic.groups.map((group) => (
            <p key={group.shiftIds.join('-')}>{shiftDiagnosticSentence(group)}</p>
          ))}

          {hasMeaningfulMarginalCurve ? (
            <>
              {marginalCurvePoints.length >= 2 && (
                <div className="marginal-curve-wrap">
                  <MarginalReturnsCurve points={marginalCurvePoints} band={marginalCurveBand} markerPoints={marginalCurveMarkerPoints} />
                  {showRecommendedGapDisclosure && (
                    <p className="stat-muted">
                      The ShiftLens Solver result sits {recommendedGapPct > 0 ? 'below' : 'above'} this curve at its
                      own shift count — it optimizes for reducing the worst backlog, not maximizing raw hours covered,
                      so it can look {recommendedGapPct > 0 ? 'less' : 'more'} efficient here while doing better on
                      the metric that actually matters.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <p>
              This recommendation already sits close to full coverage of arrivals demand at your target-implied
              hours — there isn't a meaningful additional-shift curve to trace here.
            </p>
          )}

          {/* "Could different shifts be more efficient?" (bounded flex-menu search) removed
              2026-08-06 — extraneous to Panel 4's narrative flow. The backend is untouched and
              may come back: FlexAxesToggles.tsx, engine/flexMenu.ts's searchFlexibleMenus, and
              the store's flexAxes state all still exist; see git history for the removed
              rendering (bestCandidate/searchResults computation + this details block). */}
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
