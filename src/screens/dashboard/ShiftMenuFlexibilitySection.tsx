import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { DEFAULTS, DAY_LABELS } from '../../engine/types';
import type { ShiftDef } from '../../engine/types';
import { searchFlexibleMenus, summarizeBacklogSeverity, computeBacklog } from '../../engine';
import { solveShiftFit, type SolveResult } from '../../engine/solver';
import { ShiftMenuEditor } from '../../components/ShiftMenuEditor';
import { FlexAxesToggles } from '../../components/FlexAxesToggles';

function menuSummary(menu: ShiftDef[]): string {
  return [...menu]
    .sort((a, b) => a.startHour - b.startHour)
    .map((s) => `${s.startHour.toString().padStart(2, '0')}:00 (${s.lengthHours}h)`)
    .join(', ');
}

function fmtDayHour(day: number, hour: number): string {
  return `${DAY_LABELS[day]} ${hour.toString().padStart(2, '0')}:00`;
}

/** 2026-07-26 PR D (SOLVER_REALISM_SPEC_2026-07-26.md, change 5): the single global hour where
 * a candidate's backlog improves (or worsens) the MOST vs. the current menu — pure client-side
 * arithmetic over two already-computed backlog curves, no engine changes. A minimum delta
 * guards against reporting noise-level differences as a meaningful swing. */
function biggestSwing(
  currentBacklog: number[],
  candidateBacklog: number[],
  direction: 'improve' | 'worsen'
): { day: number; hour: number; delta: number } | null {
  let bestG = -1;
  let bestDelta = 0.5; // minimum nurse-hours of swing to bother reporting
  for (let g = 0; g < 168; g++) {
    const delta = direction === 'improve' ? currentBacklog[g] - candidateBacklog[g] : candidateBacklog[g] - currentBacklog[g];
    if (delta > bestDelta) {
      bestDelta = delta;
      bestG = g;
    }
  }
  if (bestG === -1) return null;
  return { day: Math.floor(bestG / 24), hour: bestG % 24, delta: bestDelta };
}

/** A 3-row Current-vs-Alternative metrics table. Same target-implied hours for both, so it's apples-to-apples. */
function MetricsCompare({
  altLabel,
  currentHours,
  currentShortfall,
  currentWhppv,
  altHours,
  altShortfall,
  altWhppv,
}: {
  altLabel: string;
  currentHours: number;
  currentShortfall: number;
  currentWhppv: number;
  altHours: number;
  altShortfall: number;
  altWhppv: number;
}) {
  return (
    <table className="flex-compare-table">
      <thead>
        <tr>
          <th></th>
          <th>Current menu</th>
          <th>{altLabel}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Weekly hours</td>
          <td>{currentHours.toFixed(0)}</td>
          <td>{altHours.toFixed(0)}</td>
        </tr>
        <tr>
          <td>Hours below ideal coverage</td>
          <td>{currentShortfall}</td>
          <td className={altShortfall < currentShortfall ? 'flex-better' : altShortfall > currentShortfall ? 'flex-worse' : ''}>
            {altShortfall}
          </td>
        </tr>
        <tr>
          <td>Realized wHPPV</td>
          <td>{currentWhppv.toFixed(2)}</td>
          <td>{altWhppv.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * §2.3 Shift-menu flexibility (replaces the retired standalone "Compare shift menus" section).
 * The idealized grid always uses the user's current menu — this section only asks "is that grid
 * as good as it could be?" Two paths, both comparison-only (never auto-adopted, preserving the
 * "numbers, not a verdict" principle): (1) opt-in solver search along the flexibility axes,
 * surfacing the best bounded-enumeration candidate side-by-side; (2) a manual alternate menu the
 * user defines by hand and sees solved. See .claude/rules/engine-solver.md for the reversal note.
 *
 * PR C (SOLVER_REALISM_SPEC_2026-07-26.md, change 5) — FAIRNESS FIX: the current menu used to
 * be scored via `result` (the primary idealized-grid solve, run through Phase 2b's 8-pass
 * backlog-feedback relaxation loop) while every candidate/manual menu was scored via a plain
 * one-shot `solveShiftFit` — the current menu was getting a strictly better solver than its
 * challengers, an unfair comparison. The current menu is now ALSO solved one-shot, HERE, for
 * this comparison table only — the idealized grid above this section still uses the relaxation
 * path via `result`/`getResult()`, unaffected. Ranking (both the search's own ordering and the
 * "does it beat current" check here) is now by total SEVERITY — the same convex objective the
 * solver itself minimizes — not total shortfall, which stays as a display-only column.
 */
export function ShiftMenuFlexibilitySection() {
  const { shiftMenu, flexAxes, getResult } = useStore();
  const result = getResult();
  const targetImpliedHours = result.weeklyBudgetHours;
  const annualVisits = result.annualVisits;
  const anyAxis = flexAxes.startTimes || flexAxes.shiftCount || flexAxes.shiftLengths;

  // Current menu, solved ONE-SHOT (not the relaxation-loop result) — see the fairness note
  // above. `protectedFloorHourly` (PR C change 4) is the UNCLAMPED solver-facing floor.
  const currentSolve = useMemo(
    () =>
      solveShiftFit(
        result.hourlyRequirement,
        result.protectedFloorHourly,
        result.demandVolatilityHourly,
        shiftMenu,
        targetImpliedHours,
        DEFAULTS.hoursBudgetTolerance,
        DEFAULTS.enaFloor
      ),
    [result.hourlyRequirement, result.protectedFloorHourly, result.demandVolatilityHourly, shiftMenu, targetImpliedHours]
  );
  const currentSeverity = useMemo(
    () => summarizeBacklogSeverity(currentSolve.grid, result.hourlyRequirement, shiftMenu).totalSeverity,
    [currentSolve, result.hourlyRequirement, shiftMenu]
  );
  const currentShortfall = currentSolve.shortfall.reduce((a, s) => a + s.deficit, 0);
  const currentHours = currentSolve.weeklyScheduledHours;
  const currentWhppv = annualVisits > 0 ? (currentHours * 52) / annualVisits : 0;

  const candidates = useMemo(
    () =>
      anyAxis
        ? searchFlexibleMenus(
            result.hourlyRequirement,
            result.protectedFloorHourly,
            result.demandVolatilityHourly,
            shiftMenu,
            flexAxes,
            targetImpliedHours,
            DEFAULTS.hoursBudgetTolerance,
            DEFAULTS.enaFloor
          )
        : [],
    [anyAxis, result.hourlyRequirement, result.protectedFloorHourly, result.demandVolatilityHourly, shiftMenu, flexAxes, targetImpliedHours]
  );

  const best = candidates[0] ?? null;
  const bestBeatsCurrent =
    !!best &&
    (best.totalSeverity < currentSeverity - 1e-9 ||
      (Math.abs(best.totalSeverity - currentSeverity) < 1e-9 && best.weeklyScheduledHours < currentHours - 1e-9));

  // 2026-07-26 PR D (change 5): state WHICH hours the best candidate actually improves/costs,
  // not just aggregate numbers — "fixes Friday 16:00-21:00, costs you Sunday overnight" is a
  // staffing decision; a bare severity number isn't. Pure client-side arithmetic over two
  // already-solved grids' backlog curves, no engine changes.
  const currentBacklogForFlex = useMemo(
    () => computeBacklog(currentSolve.grid, result.hourlyRequirement, shiftMenu),
    [currentSolve, result.hourlyRequirement, shiftMenu]
  );
  const bestBacklog = useMemo(
    () => (best ? computeBacklog(best.solve.grid, result.hourlyRequirement, best.menu) : null),
    [best, result.hourlyRequirement]
  );
  const bestFixes = bestBacklog ? biggestSwing(currentBacklogForFlex.backlog, bestBacklog.backlog, 'improve') : null;
  const bestCosts = bestBacklog ? biggestSwing(currentBacklogForFlex.backlog, bestBacklog.backlog, 'worsen') : null;

  // Retention caveat: any suggestion that trims a 12h shift down to 8h shifts changes the
  // rotation itself, not just the arithmetic — worth flagging explicitly rather than letting a
  // manager discover it's a bigger ask than "same target-implied hours, better spread" implies.
  const bestHas12hToday = shiftMenu.some((s) => s.lengthHours === 12);
  const bestSuggests8h = best ? best.menu.some((s) => s.lengthHours === 8) : false;
  const bestIsShorterRotation = bestHas12hToday && bestSuggests8h;

  const [manualMenu, setManualMenu] = useState<ShiftDef[] | null>(null);
  const manualSolve: SolveResult | null = useMemo(() => {
    if (!manualMenu || manualMenu.length === 0) return null;
    return solveShiftFit(
      result.hourlyRequirement,
      result.protectedFloorHourly,
      result.demandVolatilityHourly,
      manualMenu,
      targetImpliedHours,
      DEFAULTS.hoursBudgetTolerance,
      DEFAULTS.enaFloor
    );
  }, [manualMenu, result.hourlyRequirement, result.protectedFloorHourly, result.demandVolatilityHourly, targetImpliedHours]);

  const manualShortfall = manualSolve ? manualSolve.shortfall.reduce((a, s) => a + s.deficit, 0) : 0;
  const manualWhppv = manualSolve && annualVisits > 0 ? (manualSolve.weeklyScheduledHours * 52) / annualVisits : 0;

  return (
    <section className="card flex-menu-section">
      <h2>Is this shift menu as good as it could be?</h2>
      <p>
        The idealized grid above always uses your <strong>current</strong> shift menu — we never silently swap it.
        If you're open to changes, pick which kinds below and we'll search for a more efficient spread of the{' '}
        <em>same</em> target-implied hours. Anything we find is shown only for comparison; it is never adopted into the
        grid above.
      </p>

      <FlexAxesToggles />

      {anyAxis &&
        (best && bestBeatsCurrent ? (
          <div className="flex-candidate">
            {/* PR C: the ranking is by total severity now, not shortfall-hour count, so the
                headline leads with severity (what actually changed) and states shortfall as a
                secondary, honestly-labeled data point rather than implying "fewer gaps" — a
                severity-better candidate can occasionally have an EQUAL or slightly higher
                shortfall-hour count if it trades a few shallow hours for resolving a deep one. */}
            <p className="comparison-headline">
              A <strong>{menuSummary(best.menu)}</strong> menu covers the same target-implied hours with less concentrated
              shortfall ({best.totalSeverity.toFixed(1)} vs. your current {currentSeverity.toFixed(1)} on the
              severity scale the schedule is optimized against) — {best.totalShortfall} hours below ideal coverage,
              vs. your current {currentShortfall}.
            </p>
            {/* 2026-07-26 PR D (change 5): WHICH hours, not just aggregate numbers. */}
            {(bestFixes || bestCosts) && (
              <p className="comparison-headline">
                {bestFixes && (
                  <>
                    Fixes around <strong>{fmtDayHour(bestFixes.day, bestFixes.hour)}</strong> (~{bestFixes.delta.toFixed(1)}{' '}
                    fewer nurse-hours of backlog there)
                  </>
                )}
                {bestFixes && bestCosts && <>, but </>}
                {bestCosts && (
                  <>
                    costs you around <strong>{fmtDayHour(bestCosts.day, bestCosts.hour)}</strong> (~
                    {bestCosts.delta.toFixed(1)} more nurse-hours of backlog there instead)
                  </>
                )}
                .
              </p>
            )}
            {bestIsShorterRotation && (
              <p className="wHPPV-caveat">
                Retention note: this trades some or all of your 12-hour shifts for 8-hour ones. Shorter shifts can
                mean more hand-offs and a bigger schedule-pattern change for staff than the hours-and-coverage
                numbers alone suggest — worth weighing before treating this as a like-for-like swap.
              </p>
            )}
            <MetricsCompare
              altLabel="Suggested menu"
              currentHours={currentHours}
              currentShortfall={currentShortfall}
              currentWhppv={currentWhppv}
              altHours={best.weeklyScheduledHours}
              altShortfall={best.totalShortfall}
              altWhppv={annualVisits > 0 ? (best.weeklyScheduledHours * 52) / annualVisits : 0}
            />
            <p className="wHPPV-caveat">
              A suggestion for comparison only — your idealized grid still uses your current menu. Numbers, not a
              verdict: if the trade-off isn't worth it operationally, keep what you have.
            </p>
          </div>
        ) : (
          <p className="degrade-note">
            Across the alternatives we tried on the axes you enabled, none beat your current menu on coverage for
            the same target-implied hours — it's already an efficient choice.
          </p>
        ))}

      <div className="flex-manual">
        <h3>Or try a specific menu by hand</h3>
        {manualMenu === null ? (
          <button className="btn-secondary" onClick={() => setManualMenu(shiftMenu.map((s) => ({ ...s })))}>
            Define an alternate menu
          </button>
        ) : (
          <>
            <ShiftMenuEditor menu={manualMenu} onChange={setManualMenu} />
            <button className="btn-link" onClick={() => setManualMenu(null)}>
              Discard this menu
            </button>
            {manualSolve && (
              <MetricsCompare
                altLabel="Your menu"
                currentHours={currentHours}
                currentShortfall={currentShortfall}
                currentWhppv={currentWhppv}
                altHours={manualSolve.weeklyScheduledHours}
                altShortfall={manualShortfall}
                altWhppv={manualWhppv}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
