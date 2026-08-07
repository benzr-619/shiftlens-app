import { useState } from 'react';
import { useStore } from '../../store';
import { EvidenceBadge } from '../../components/EvidenceBadge';
import { deriveAnnualVisits } from '../../engine/allocate';
import { EDBA_VOLUME_BANDS, lookupWhppvBand } from '../../lib/edbaLookup';

export function VolumeStep() {
  const { arrivals, annualVisitsOverride, setAnnualVisitsOverride, wHppvTarget, setWHppvTarget } = useStore();

  const derivedAnnual = deriveAnnualVisits(arrivals);
  const effectiveAnnual = annualVisitsOverride ?? derivedAnnual;
  const band = lookupWhppvBand(effectiveAnnual);
  const [whyOpen, setWhyOpen] = useState(false);

  return (
    <>
      <section className="card">
        <h2>Annual visit volume</h2>
        <p>
          We'll estimate this from your arrivals data. Only fill this in if you have your actual
          annual visit count and want to use that instead.{' '}
          <EvidenceBadge status="OPTIONAL" />
        </p>
        <label className="field-row">
          Annual visits
          <input
            type="number"
            placeholder={`${Math.round(derivedAnnual).toLocaleString()} (derived)`}
            value={annualVisitsOverride ?? ''}
            onChange={(e) => setAnnualVisitsOverride(e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
      </section>

      <section className="card">
        <h2>WHPPV target <span className="required">Required</span></h2>
        <p className="whppv-explainer">
          <strong>WHPPV</strong> (worked hours per patient visit) is nursing hours per patient arrival, the
          core productivity target this tool staffs to. Lower means leaner staffing, higher means more
          cushion.
        </p>
        <button className="btn-link why-toggle" onClick={() => setWhyOpen((v) => !v)}>
          {whyOpen ? 'Hide' : 'Why WHPPV?'}
        </button>
        {whyOpen && (
          <div className="why-explainer">
            <p>
              It's a standard metric in emergency nursing budgets, but it's important to know it has
              limitations. A department can be right at its WHPPV target and still be understaffed at
              specific hours, or run into trouble from higher acuity, throughput bottlenecks, or boarding.
              The volume-band comparisons below are also limited: they reflect a department's typical WHPPV
              across the year, not how evenly those hours are spread across seasons, days of the week, or
              hours of the day. Still, ShiftLens relies on WHPPV because it's the industry standard, backed
              by ENA, cleaner than metrics like nurse-to-patient ratios that carry too much operational
              noise, and easier to understand and communicate than more complex predictive models.
            </p>
          </div>
        )}
        <p>
          Pre-filled at the median for EDs of similar annual volume.
        </p>
        <label className="field-row">
          WHPPV target
          <input
            type="number"
            step="0.01"
            value={wHppvTarget}
            onChange={(e) => setWHppvTarget(Number(e.target.value))}
          />
        </label>

        <table className="volume-band-table">
          <thead>
            <tr>
              <th>Annual visits</th>
              <th>p25 WHPPV</th>
              <th>Median WHPPV</th>
              <th>p75 WHPPV</th>
            </tr>
          </thead>
          <tbody>
            {EDBA_VOLUME_BANDS.map((b) => (
              <tr key={b.label} className={b === band ? 'volume-band-own' : undefined}>
                <td>{b.label}</td>
                <td>{b.p25Whppv}</td>
                <td>{b.medianWhppv}</td>
                <td>{b.p75Whppv}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
