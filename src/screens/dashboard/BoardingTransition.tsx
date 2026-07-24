import { useStore } from '../../store';

/**
 * §2.5 Boarding transition — a short NARRATIVE bridge (no grid, no data table) whose only job
 * is to pivot from "here's your ED-arrivals staffing picture" to "here's what boarding costs
 * on top of that," leading into the boarding coverage recommendation (§2.6) below.
 *
 * Shows effective wHPPV after boarding for BOTH current and idealized staffing (not just
 * idealized), and the additional FTE to fully cover boarding as the bridge line. Renders
 * nothing when boarding wasn't computed (the boarding section itself explains that state).
 */
export function BoardingTransition() {
  const { getResult, getLiveResult, getCurrentStaffingResult, currentStaffingGrid } = useStore();

  const result = getResult();
  if (!result.boarding || !result.lostProductivity) return null;

  const live = getLiveResult();
  const current = getCurrentStaffingResult();

  const consumed = result.lostProductivity.wHppvConsumedByBoarding;
  const annualVisits = result.annualVisits;

  const idealWeeklyHours = live?.weeklyScheduledHours ?? result.weeklyScheduledHours;
  const idealRealized = (idealWeeklyHours * 52) / annualVisits;
  const idealEffective = idealRealized - consumed;

  const hasCurrentStaffing =
    !!currentStaffingGrid &&
    Object.values(currentStaffingGrid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));
  const currentEffective = current.realizedWHppv - consumed;

  const fte = result.boarding.annualFte;

  return (
    <section className="card boarding-transition">
      <h2>What boarding costs on top of this</h2>
      <p className="comparison-headline">
        Boarding quietly consumes about <strong>{consumed.toFixed(2)} wHPPV</strong> of nursing capacity. That pulls
        the idealized schedule's effective wHPPV down to <strong>{idealEffective.toFixed(2)}</strong>
        {hasCurrentStaffing && (
          <>, and your current staffing's to <strong>{currentEffective.toFixed(2)}</strong></>
        )}
        . Fully covering boarding would take about <strong>{fte.toFixed(1)} additional nursing FTE</strong> — the plan
        below shows where that coverage lands.
      </p>

      <div className="wHPPV-stats compact">
        <div className="stat">
          <div className="stat-label">Effective wHPPV — idealized</div>
          <div className="stat-value stat-warning">{idealEffective.toFixed(2)}</div>
          <div className="stat-sub">{idealRealized.toFixed(2)} realized − {consumed.toFixed(2)} boarding</div>
        </div>
        {hasCurrentStaffing && (
          <div className="stat">
            <div className="stat-label">Effective wHPPV — current</div>
            <div className="stat-value stat-warning">{currentEffective.toFixed(2)}</div>
            <div className="stat-sub">{current.realizedWHppv.toFixed(2)} realized − {consumed.toFixed(2)} boarding</div>
          </div>
        )}
        <div className="stat">
          <div className="stat-label">FTE to fully cover boarding</div>
          <div className="stat-value">{fte.toFixed(1)}</div>
          <div className="stat-sub">additional nursing FTE, year-round</div>
        </div>
      </div>
    </section>
  );
}
