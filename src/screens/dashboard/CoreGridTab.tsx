import { useStore } from '../../store';
import { DAY_LABELS } from '../../engine/types';
import { EvidenceBadge } from '../../components/EvidenceBadge';

export function CoreGridTab() {
  const { shiftMenu, gridOverride, editGridCell, resetGridOverride, getResult, getLiveResult, wHppvTarget } = useStore();

  const result = getResult();
  const live = getLiveResult();

  const grid = gridOverride ?? result.grid;
  const weeklyScheduledHours = live?.weeklyScheduledHours ?? result.weeklyScheduledHours;
  const shortfall = live?.shortfall ?? result.shortfall;
  const realizedWHppv = live?.realizedWHppv ?? (weeklyScheduledHours * 52) / result.annualVisits;
  const overcoveragePct = result.weeklyBudgetHours > 0 ? (weeklyScheduledHours - result.weeklyBudgetHours) / result.weeklyBudgetHours : 0;

  const shortfallByDay = new Map<number, typeof shortfall>();
  for (const entry of shortfall) {
    if (!shortfallByDay.has(entry.day)) shortfallByDay.set(entry.day, []);
    shortfallByDay.get(entry.day)!.push(entry);
  }

  return (
    <div className="core-grid-tab">
      {result.esiConfidenceFlag && (
        <div className="banner banner-info">
          No ESI mix provided — core allocation is running on raw volume only (lower confidence than an
          acuity-weighted allocation). <EvidenceBadge status="ASSUMPTION" note="Acuity reweighting skipped: no ESI data." />
        </div>
      )}
      {!result.reconciliation.passes && (
        <div className="banner banner-error">
          Reconciliation check failed: the 168-cell allocation does not reproduce the annual budget exactly
          (gap {(result.reconciliation.gapPct * 100).toFixed(4)}%). This indicates a calculation bug — results
          below should not be trusted until this is resolved.
        </div>
      )}

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
            <div className="stat-label">Shortfall hours</div>
            <div className={`stat-value ${shortfall.length > 0 ? 'stat-warning' : ''}`}>
              {shortfall.reduce((a, s) => a + s.deficit, 0)}
            </div>
            <div className="stat-sub">{shortfall.length} (day, hour) cells short</div>
          </div>
        </div>

        <p className="wHPPV-caveat">
          A clean wHPPV number can coexist with genuinely short hours — the table below is the diagnostic that
          catches that. It is shown here, in the same unit, deliberately.
        </p>

        {shortfall.length > 0 && (
          <div className="shortfall-table-wrap">
            <table className="shortfall-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Hour</th>
                  <th>Required</th>
                  <th>Scheduled</th>
                  <th>Deficit</th>
                </tr>
              </thead>
              <tbody>
                {shortfall
                  .slice()
                  .sort((a, b) => b.deficit - a.deficit)
                  .map((s, i) => (
                    <tr key={i}>
                      <td>{DAY_LABELS[s.day]}</td>
                      <td>{s.hour.toString().padStart(2, '0')}:00</td>
                      <td>{s.requirement}</td>
                      <td>{s.scheduled}</td>
                      <td className="deficit-cell">{s.deficit}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="grid-header-row">
          <h2>Idealized staffing grid</h2>
          {gridOverride && (
            <button className="btn-link" onClick={resetGridOverride}>
              Reset to solver output
            </button>
          )}
        </div>
        <p>Edit any headcount cell — wHPPV and the shortfall table above recompute live.</p>
        <div className="staffing-grid-wrap">
          <table className="staffing-grid">
            <thead>
              <tr>
                <th>Day</th>
                {shiftMenu.map((s) => (
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
                  {shiftMenu.map((s) => (
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
      </section>
    </div>
  );
}
