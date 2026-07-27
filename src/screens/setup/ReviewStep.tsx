import { useStore } from '../../store';
import { deriveAnnualVisits } from '../../engine/allocate';
import { lookupWhppvBand } from '../../lib/edbaLookup';
import { downloadFilledConsolidatedTemplateXlsx } from '../../lib/template';

export function ReviewStep({ onEdit }: { onEdit: (step: number) => void }) {
  const {
    arrivals,
    arrivalsP75,
    annualVisitsOverride,
    wHppvTarget,
    shiftMenu,
    esiMix,
    admitRate,
    boardingDuration,
    boardingRatioTarget,
    bhBoardingRatioTarget,
    monthlyMeanBoardingDurationHours,
    dayOfWeekMeanBoardingDurationHours,
    boardingCensusMedical,
    boardingCensusBH,
    monthlyBoardingCensusMedical,
    monthlyBoardingCensusBH,
    preBedRequestCensus,
    currentStaffingGrid,
    boardingPath,
    headcountIncludesIndirectCare,
    indirectCareUpliftPct,
    flexAxes,
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
          {esiMix ? 'Provided — acuity reweighting enabled.' : 'Not provided — running on raw volume.'}
        </div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Boarding census (medical)</div>
        <div className="review-value">
          {boardingCensusMedical ? '168-cell hourly census provided — measured boarding path.' : 'Not provided.'}
        </div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Boarding census (BH)</div>
        <div className="review-value">
          {boardingCensusBH ? 'Provided — reported separately from medical/surg.' : 'Not tracked separately.'}
        </div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Admit rate</div>
        <div className="review-value">
          {boardingCensusMedical
            ? 'Not used — a measured boarding census takes precedence.'
            : admitRate !== null ? admitRate : 'Not provided — boarding coverage will be skipped.'}
        </div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Boarding duration</div>
        <div className="review-value">
          {boardingCensusMedical
            ? 'Not used — a measured boarding census takes precedence.'
            : boardingDuration !== null ? `${boardingDuration} hrs` : 'Not provided — boarding coverage will be skipped.'}
        </div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Boarding ratios</div>
        <div className="review-value">1 RN per {boardingRatioTarget} medical/surg boarders, 1 RN per {bhBoardingRatioTarget} BH boarders</div>
        <button className="btn-link" onClick={() => onEdit(2)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Boarding seasonality</div>
        <div className="review-value">
          {monthlyBoardingCensusMedical || monthlyBoardingCensusBH
            ? `Provided — monthly census (${[monthlyBoardingCensusMedical && 'medical', monthlyBoardingCensusBH && 'BH'].filter(Boolean).join(' + ')}) loaded.`
            : [monthlyMeanBoardingDurationHours && 'monthly', dayOfWeekMeanBoardingDurationHours && 'day-of-week'].filter(Boolean).length > 0
              ? `Provided — ${[monthlyMeanBoardingDurationHours && 'monthly', dayOfWeekMeanBoardingDurationHours && 'day-of-week'].filter(Boolean).join(' + ')} mean duration loaded.`
              : 'Not provided — boarding coverage ranked by shift-block only.'}
        </div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Busy-hour (P75) arrivals</div>
        <div className="review-value">
          {arrivalsP75 ? 'Provided — protecting high-variance hours' : 'Not provided — using cohort-only protection'}
        </div>
        <button className="btn-link" onClick={() => onEdit(0)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Headcount semantics</div>
        <div className="review-value">
          {headcountIncludesIndirectCare === null
            ? 'Not answered yet'
            : headcountIncludesIndirectCare
              ? `Includes charge/triage/indirect care${indirectCareUpliftPct !== null ? ` (~${indirectCareUpliftPct}% uplift)` : ''}`
              : 'Direct-care headcount only'}
        </div>
        <button className="btn-link" onClick={() => onEdit(2)}>Edit</button>
      </div>

      <div className="review-row">
        <div className="review-label">Shift-menu flexibility</div>
        <div className="review-value">
          {[flexAxes.startTimes && 'start times', flexAxes.shiftCount && 'shift count', flexAxes.shiftLengths && 'shift lengths'].filter(Boolean).length > 0
            ? `Flexible — ${[flexAxes.startTimes && 'start times', flexAxes.shiftCount && 'shift count', flexAxes.shiftLengths && 'shift lengths'].filter(Boolean).join(', ')}`
            : 'None — static menu only'}
        </div>
        <button className="btn-link" onClick={() => onEdit(2)}>Edit</button>
      </div>

      {/* Part 3 (guided-setup/export follow-up prompt, 2026-07-27; extended same day) — the
          app's only form of persistence. Includes arrivals/ESI/boarding/census, the current-
          staffing grid, and per-dataset setup decisions (boarding path, headcount semantics,
          flex axes). Tool-wide POLICY (wHPPV target, both boarding ratios, ENA floor) stays
          UI-only, set again on re-upload, never written here — see .claude/rules/
          template-parsing.md. */}
      <div className="review-export">
        <button
          className="btn-secondary"
          onClick={() =>
            downloadFilledConsolidatedTemplateXlsx({
              arrivals,
              arrivalsP75,
              esiMix,
              admitRate,
              boardingDuration,
              monthlyMeanBoardingDurationHours,
              dayOfWeekMeanBoardingDurationHours,
              boardingCensusMedical,
              boardingCensusBH,
              monthlyBoardingCensusMedical,
              monthlyBoardingCensusBH,
              preBedRequestCensus,
              shiftMenu,
              currentStaffingGrid,
              boardingPath,
              headcountIncludesIndirectCare,
              indirectCareUpliftPct,
              flexAxes,
            })
          }
        >
          Download my data file
        </button>
        <p className="degrade-note">
          Saves everything you've entered as one file. Next time, pick "I have a ShiftLens file
          from before" on the setup screen to reload it in seconds.
        </p>
      </div>
    </section>
  );
}
