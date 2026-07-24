import { useStore } from '../../store';
import { deriveAnnualVisits } from '../../engine/allocate';
import { lookupWhppvBand } from '../../lib/edbaLookup';

export function ReviewStep({ onEdit }: { onEdit: (step: number) => void }) {
  const {
    arrivals,
    annualVisitsOverride,
    wHppvTarget,
    shiftMenu,
    esiMix,
    admitRate,
    boardingDuration,
    boardingRatioTarget,
    monthlyMeanBoardingDurationHours,
    dayOfWeekMeanBoardingDurationHours,
  } = useStore();

  const hasArrivalsData = arrivals.some((v) => v > 0);
  const derivedAnnual = deriveAnnualVisits(arrivals);
  const effectiveAnnual = annualVisitsOverride ?? derivedAnnual;
  const band = lookupWhppvBand(effectiveAnnual);

  return (
    <section className="card review-step">
      <h2>Review</h2>
      <p>Here's everything we have. Anything look off? Jump back to that step and fix it — nothing else resets.</p>

      <div className="review-row">
        <div className="review-label">Arrivals data</div>
        <div className="review-value">
          {hasArrivalsData ? '168-cell hour × day-of-week grid provided.' : <span className="msg-error">Not provided yet.</span>}
        </div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Annual visit volume</div>
        <div className="review-value">
          {annualVisitsOverride
            ? `${annualVisitsOverride.toLocaleString()} (entered directly)`
            : `${Math.round(derivedAnnual).toLocaleString()} (estimated from arrivals)`}
        </div>
        <button className="btn-link" onClick={() => onEdit(1)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">wHPPV target</div>
        <div className="review-value">
          {wHppvTarget} <span className="review-sub">(similar-volume benchmark median: {band.medianWhppv})</span>
        </div>
        <button className="btn-link" onClick={() => onEdit(1)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Shift menu</div>
        <div className="review-value">
          {shiftMenu.length === 0 ? (
            <span className="msg-error">No shifts defined yet.</span>
          ) : (
            shiftMenu
              .map((s) => `${s.label || 'Shift'} (${s.startHour.toString().padStart(2, '0')}:00, ${s.lengthHours}h)`)
              .join(', ')
          )}
        </div>
        <button className="btn-link" onClick={() => onEdit(2)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">ESI mix</div>
        <div className="review-value">
          {esiMix ? 'Provided — acuity reweighting enabled.' : 'Not provided — running on raw volume, flagged as lower-confidence.'}
        </div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Admit rate</div>
        <div className="review-value">{admitRate !== null ? admitRate : 'Not provided — boarding coverage will be skipped.'}</div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Boarding duration</div>
        <div className="review-value">
          {boardingDuration !== null ? `${boardingDuration} hrs` : 'Not provided — boarding coverage will be skipped.'}
        </div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Boarding ratio target</div>
        <div className="review-value">1 RN per {boardingRatioTarget} boarders</div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Boarding seasonality</div>
        <div className="review-value">
          {[monthlyMeanBoardingDurationHours && 'monthly', dayOfWeekMeanBoardingDurationHours && 'day-of-week'].filter(Boolean).length > 0
            ? `Provided — ${[monthlyMeanBoardingDurationHours && 'monthly', dayOfWeekMeanBoardingDurationHours && 'day-of-week'].filter(Boolean).join(' + ')} mean duration loaded.`
            : 'Not provided — boarding coverage ranked by shift-block only.'}
        </div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>
    </section>
  );
}
