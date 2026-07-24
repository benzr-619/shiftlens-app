import { useStore } from '../../store';
import { EvidenceBadge } from '../../components/EvidenceBadge';
import { deriveAnnualVisits } from '../../engine/allocate';
import { lookupWhppvBand } from '../../lib/edbaLookup';

export function VolumeStep() {
  const { arrivals, annualVisitsOverride, setAnnualVisitsOverride, wHppvTarget, setWHppvTarget } = useStore();

  const derivedAnnual = deriveAnnualVisits(arrivals);
  const effectiveAnnual = annualVisitsOverride ?? derivedAnnual;
  const band = lookupWhppvBand(effectiveAnnual);

  return (
    <>
      <section className="card">
        <h2>Annual visit volume</h2>
        <p>
          We'll estimate this from your arrivals data automatically. Only fill this in if you have your actual
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
        <h2>wHPPV target <span className="required">Required</span></h2>
        <p>
          Pre-filled at <strong>{band.medianWhppv}</strong> — the median for EDs of similar annual volume
          ({band.label} visits/year). This is what similar-sized EDs typically run at, not a mandated
          target — always editable.{' '}
          <EvidenceBadge status="CONVENTION" defaultValue={`${band.medianWhppv} (similar-volume benchmark)`} />
        </p>
        <label className="field-row">
          wHPPV target
          <input
            type="number"
            step="0.01"
            value={wHppvTarget}
            onChange={(e) => setWHppvTarget(Number(e.target.value))}
          />
        </label>

        <p className="wHPPV-caveat">
          EDs of similar volume typically run <strong>{band.p25Whppv}–{band.p75Whppv} wHPPV</strong> (national
          benchmark, approximate typical range — not a precise confidence interval around the median above).
        </p>
      </section>
    </>
  );
}
