import { useMemo } from 'react';
import { useStore } from '../../store';
import { computeHiddenBoardingDiagnostic, type HiddenBoardingBlock } from '../../engine';
import { ConceptCallout } from '../../components/ConceptCallout';

// Display threshold below which a day/night surplus-or-shortfall reads as "negligible" rather
// than a real signal — a tunable display heuristic, not load-bearing math. Small enough that a
// genuine real-world imbalance (tens of hours/week) always clears it, large enough that
// rounding noise on a near-zero result doesn't get narrated as a finding.
const NEGLIGIBLE_HOURS = 8;

// PR F (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §6.2) — templated narrative, three sentences,
// each quotable standalone, NONE of which states a verdict (spec §1 decision 3 / §12.1: no
// headline may assume the sign of the gap). These will move into src/lib/narrative.ts wholesale
// when PR H extracts every templated headline into that one pure-function module — written here
// already in that shape (pure functions of the block data, no JSX) so that move is mechanical.

function nightSentence(night: HiddenBoardingBlock, boardingDataPresent: boolean): string {
  if (!boardingDataPresent) {
    return night.vsArrivalsAlone > NEGLIGIBLE_HOURS
      ? `Your nights are staffed ${night.vsArrivalsAlone.toFixed(0)} hours a week beyond what arrivals alone justify — add your boarding data below to see whether that's boarding absorption or something else.`
      : night.vsArrivalsAlone < -NEGLIGIBLE_HOURS
        ? `Your nights run ${Math.abs(night.vsArrivalsAlone).toFixed(0)} hours a week short of what arrivals alone justify.`
        : `Your night staffing roughly matches what arrivals alone justify.`;
  }
  const boardingNeed = night.boardingNeedHours ?? 0;
  if (night.vsArrivalsAlone > NEGLIGIBLE_HOURS) {
    const enough = night.vsArrivalsAlone >= boardingNeed;
    return `Your nights carry ${night.vsArrivalsAlone.toFixed(0)} hours a week beyond what arrivals justify. That isn't overstaffing — it's boarding, absorbed into a schedule that was never sized for it, and ${
      enough
        ? `it covers most of what boarding needs there (${boardingNeed.toFixed(0)} hours at night)`
        : `it isn't even enough (boarding needs ${boardingNeed.toFixed(0)} hours at night)`
    }.`;
  }
  if (night.vsArrivalsAlone < -NEGLIGIBLE_HOURS) {
    return `Your nights run ${Math.abs(night.vsArrivalsAlone).toFixed(0)} hours a week short of what arrivals alone justify — and that's before counting boarding, which needs ${boardingNeed.toFixed(0)} more hours there.`;
  }
  // §12.1: negligible is real information, not a null state.
  return `Your night staffing matches what arrivals justify, and boarding at night is ${
    boardingNeed < NEGLIGIBLE_HOURS ? 'modest' : `real (${boardingNeed.toFixed(0)} hours a week)`
  } — nights are not where your problem is.`;
}

function daySentence(day: HiddenBoardingBlock, boardingDataPresent: boolean): string {
  if (day.vsArrivalsAlone < -NEGLIGIBLE_HOURS) {
    return `Your days run ${Math.abs(day.vsArrivalsAlone).toFixed(0)} hours a week short of what arrivals alone justify.`;
  }
  if (day.vsArrivalsAlone > NEGLIGIBLE_HOURS) {
    return `Your days are staffed ${day.vsArrivalsAlone.toFixed(0)} hours a week beyond what arrivals alone justify${
      boardingDataPresent && (day.boardingNeedHours ?? 0) > NEGLIGIBLE_HOURS ? ' — likely covering some daytime boarding, too' : ''
    }.`;
  }
  return `Your day staffing roughly matches what arrivals alone justify.`;
}

/**
 * PR F §6.2 — "the advocacy artifact." Ben: "we need nursing leaders to understand that they
 * are hurting the days by staffing for boarding overnight, and be able to advocate off of that."
 * Per §12.2 profile D, this must DEGRADE TO A PROMPT when boarding data is absent, never
 * silently vanish (unlike `BoardingTransition`, which returns null in that state) — the whole
 * point is surfacing what half the picture is missing.
 */
export function HiddenBoardingSection() {
  const { getResult, buildEngineInputs, currentStaffingGrid } = useStore();
  const result = getResult();
  const inputs = useMemo(() => buildEngineInputs(), [buildEngineInputs]);

  const hasCurrentStaffing =
    !!currentStaffingGrid &&
    Object.values(currentStaffingGrid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));

  const diagnostic = useMemo(
    () =>
      hasCurrentStaffing
        ? computeHiddenBoardingDiagnostic(
            result.hourlyRequirement,
            currentStaffingGrid ?? {},
            inputs.shiftMenu,
            result.boarding?.cellBoardingRnHours ?? null
          )
        : null,
    [hasCurrentStaffing, result.hourlyRequirement, currentStaffingGrid, inputs.shiftMenu, result.boarding]
  );

  if (!hasCurrentStaffing) {
    return (
      <section className="card hidden-boarding-section">
        <h2>Are your nights staffed for arrivals, or for something else?</h2>
        <div className="banner banner-info comparison-cta">
          Add your current staffing above to see how many of your night hours arrivals alone actually justify — and
          whether the rest is boarding, hidden in a schedule that was never sized for it.
        </div>
      </section>
    );
  }

  if (!diagnostic) return null;

  const { day, night, boardingDataPresent } = diagnostic;

  return (
    <section className="card hidden-boarding-section">
      <h2>Are your nights staffed for arrivals, or for something else?</h2>

      {!boardingDataPresent && (
        <div className="banner banner-info">
          You're seeing half the picture here — without admit rate and boarding duration (Setup Step 1), this can
          only compare your staffing against arrivals, not against what boarding actually needs. Add that data to
          see the other half.
        </div>
      )}

      {/* PR J (teaching layer, §8) — first used here (Chapter 6). */}
      <ConceptCallout title="Two budgets, one department">
        <p>
          Arrivals and boarding are different demands on the same nurses — your department budgets for both, even
          if your current schedule blends them into one number. Separating them is what lets this table say
          "nights carry hours arrivals alone don't justify" without that reading as a mistake — it's usually
          boarding, doing real work.
        </p>
      </ConceptCallout>

      <p className="comparison-headline">{nightSentence(night, boardingDataPresent)}</p>
      <p className="comparison-headline">{daySentence(day, boardingDataPresent)}</p>

      <div className="staffing-grid-wrap">
        <table className="staffing-grid hidden-boarding-table">
          <thead>
            <tr>
              <th></th>
              <th>Arrivals need</th>
              {boardingDataPresent && <th>Boarding need</th>}
              {boardingDataPresent && <th>Total need</th>}
              <th>Staffed</th>
              <th>vs. arrivals alone</th>
            </tr>
          </thead>
          <tbody>
            {[day, night].map((b) => (
              <tr key={b.label}>
                <td className="day-cell">{b.label} {b.label === 'Day' ? '(07-19)' : '(19-07)'}</td>
                <td>{b.arrivalsNeedHours.toFixed(0)}</td>
                {boardingDataPresent && <td>{(b.boardingNeedHours ?? 0).toFixed(0)}</td>}
                {boardingDataPresent && <td>{(b.totalNeedHours ?? 0).toFixed(0)}</td>}
                <td>{b.staffedHours.toFixed(0)}</td>
                <td className={b.vsArrivalsAlone >= 0 ? 'diff-under' : 'diff-over'}>
                  {b.vsArrivalsAlone > 0 ? '+' : ''}
                  {b.vsArrivalsAlone.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="wHPPV-caveat">
        Weekly nurse-hours, representative week. "vs. arrivals alone" is staffed hours minus what arrivals alone
        would require — positive means staffed beyond arrivals, negative means short of even arrivals.
      </p>
    </section>
  );
}
