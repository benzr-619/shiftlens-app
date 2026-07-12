import { useStore } from '../../store';
import { DAY_LABELS } from '../../engine/types';
import { EvidenceBadge } from '../../components/EvidenceBadge';

export function BoardingTab() {
  const { getResult, admitRate, boardingDuration, boardingRatioTarget } = useStore();
  const result = getResult();
  const boarding = result.boarding;

  if (!boarding) {
    return (
      <div className="boarding-tab">
        <section className="card">
          <h2>Boarding summary</h2>
          <p className="degrade-note">
            Not produced — {admitRate === null ? 'admit rate' : ''}
            {admitRate === null && !boardingDuration ? ' and ' : ''}
            {!boardingDuration ? 'boarding duration by hour × day' : ''} not provided. This output is never
            estimated from a placeholder — go back to Setup to add it.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="boarding-tab">
      <div className="banner banner-info">
        These figures are a rolling 12-month average. Boarding is more seasonal than arrivals — treat this as a
        floor likely to understate peak-season (e.g. winter surge) boarding need.
      </div>

      <section className="card">
        <h2>
          Annual + weekly FTE <EvidenceBadge status="CONVENTION" defaultValue={`1:${boardingRatioTarget} ratio`} />
        </h2>
        <p>
          This is a separate budget ask, deliberately not a shift grid — it presupposes no single staffing
          mechanism (dedicated hold nurses, additive coverage, float/PRN, and seasonal hire are all still open
          decisions).
        </p>
        <div className="wHPPV-stats">
          <div className="stat">
            <div className="stat-label">Annual hours</div>
            <div className="stat-value">{Math.round(boarding.annualBoardingHours).toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Annual FTE</div>
            <div className="stat-value">{boarding.annualFte.toFixed(2)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Weekly hours</div>
            <div className="stat-value">{boarding.weeklyBoardingHours.toFixed(1)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Weekly FTE</div>
            <div className="stat-value">{boarding.weeklyFte.toFixed(2)}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Per-day-of-week breakdown</h2>
        <p>
          A flat week means a flat FTE add is reasonable; a lopsided week suggests a smaller dedicated core sized
          to the low days, with float/PRN/overtime absorbing surge days.
        </p>
        <table className="boarding-day-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Hold hours</th>
              <th>Avg concurrent headcount</th>
              <th>Peak concurrent headcount</th>
            </tr>
          </thead>
          <tbody>
            {boarding.perDay.map((d) => (
              <tr key={d.day}>
                <td>{DAY_LABELS[d.day]}</td>
                <td>{d.dailyHoldHours.toFixed(1)}</td>
                <td>{d.avgConcurrentHeadcount.toFixed(2)}</td>
                <td>{d.peakConcurrentHeadcount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card card-muted">
        <h2>Dollar cost layer <span className="pill-soon">Coming soon</span></h2>
        <p>
          Annualized cost (RN salary × benefit factor × boarding hours) is designed but not yet built — it needs
          two additional inputs (RN salary, benefit factor) not yet collected. FTE/hours outputs above are
          available now.
        </p>
      </section>
    </div>
  );
}
