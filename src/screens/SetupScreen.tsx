import { useRef, useState } from 'react';
import { useStore } from '../store';
import { ArrivalsGrid } from '../components/ArrivalsGrid';
import { ShiftMenuEditor } from '../components/ShiftMenuEditor';
import { EvidenceBadge } from '../components/EvidenceBadge';
import { downloadTemplateCsv, downloadTemplateXlsx } from '../lib/template';
import { parseUploadFile } from '../lib/parseUpload';
import { deriveAnnualVisits } from '../engine/allocate';
import { lookupWhppvBand } from '../lib/edbaLookup';

export function SetupScreen() {
  const {
    arrivals,
    setArrivals,
    annualVisitsOverride,
    setAnnualVisitsOverride,
    wHppvTarget,
    wHppvTouched,
    setWHppvTarget,
    shiftMenu,
    setShiftMenu,
    esiMix,
    setEsiMix,
    admitRate,
    setAdmitRate,
    boardingDuration,
    setBoardingDuration,
    boardingRatioTarget,
    setBoardingRatioTarget,
    setScreen,
  } = useStore();

  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadMsgs, setUploadMsgs] = useState<{ warnings: string[]; errors: string[] } | null>(null);
  const [showGrid, setShowGrid] = useState(false);

  const derivedAnnual = deriveAnnualVisits(arrivals);
  const effectiveAnnual = annualVisitsOverride ?? derivedAnnual;
  const band = lookupWhppvBand(effectiveAnnual);
  const hasArrivalsData = arrivals.some((v) => v > 0);

  async function handleFile(file: File) {
    const parsed = await parseUploadFile(file);
    setUploadMsgs({ warnings: parsed.warnings, errors: parsed.errors });
    if (parsed.errors.length === 0) {
      setArrivals(parsed.arrivals);
      if (parsed.esiMix) setEsiMix(parsed.esiMix);
      if (parsed.admitRate) {
        // engine accepts scalar or per-cell; store scalar UI takes the mean as a starting point
        const mean = parsed.admitRate.reduce((a, b) => a + b, 0) / parsed.admitRate.length;
        setAdmitRate(mean);
      }
      if (parsed.boardingDuration) setBoardingDuration(parsed.boardingDuration);
      setShowGrid(true);
      if (!wHppvTouched) {
        setWHppvTarget(lookupWhppvBand(deriveAnnualVisits(parsed.arrivals)).medianWhppv, false);
      }
    }
  }

  const canContinue = hasArrivalsData && shiftMenu.length > 0 && wHppvTarget > 0;

  return (
    <div className="screen setup-screen">
      <h1>ShiftLens — Setup</h1>
      <p className="subtitle">Enter your ED's data. Nothing here is pre-filled with another ED's numbers.</p>

      <section className="card">
        <h2>1. Arrivals <span className="required">Required</span></h2>
        <p>
          The 168-cell hour × day-of-week grid of <strong>median</strong> arrival counts — the core demand signal.
          Download the template, hand it to whoever can pull an hourly arrivals export, then upload it back here.
        </p>
        <div className="button-row">
          <button className="btn-secondary" onClick={downloadTemplateCsv}>Download template (.csv)</button>
          <button className="btn-secondary" onClick={downloadTemplateXlsx}>Download template (.xlsx)</button>
          <button className="btn-primary" onClick={() => fileInput.current?.click()}>Upload filled template</button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </div>

        {uploadMsgs && (
          <div className="upload-msgs">
            {uploadMsgs.errors.map((e, i) => (
              <div key={i} className="msg-error">{e}</div>
            ))}
            {uploadMsgs.warnings.map((w, i) => (
              <div key={i} className="msg-warning">{w}</div>
            ))}
          </div>
        )}

        <button className="btn-link" onClick={() => setShowGrid((v) => !v)}>
          {showGrid ? 'Hide' : hasArrivalsData ? 'Touch up' : 'Enter manually'} the grid
        </button>
        {showGrid && <ArrivalsGrid arrivals={arrivals} onChange={setArrivals} />}
      </section>

      <section className="card">
        <h2>2. Annual visit volume</h2>
        <p>
          Auto-derived from the arrivals grid (× 52) unless you enter a figure directly.{' '}
          <EvidenceBadge status="USER INPUT" />
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
        <h2>3. wHPPV target <span className="required">Required</span></h2>
        <p>
          Pre-filled at <strong>{band.medianWhppv}</strong> — the median for EDs in the{' '}
          <strong>{band.label}</strong> annual-volume band (n={band.nEdYears} ED-years, EDBA cohort). This is what
          similar EDs run at, not a mandated target — always editable.{' '}
          <EvidenceBadge status="CONVENTION" defaultValue={`${band.medianWhppv} (EDBA cohort)`} />
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
      </section>

      <section className="card">
        <h2>4. Shift menu <span className="required">Required</span></h2>
        <p>Define your ED's actual shift structure — no assumption about 8s vs. 12s or shift count.</p>
        <ShiftMenuEditor menu={shiftMenu} onChange={setShiftMenu} />
      </section>

      <section className="card">
        <h2>Optional inputs</h2>
        <p>Each degrades gracefully if left blank — nothing is estimated from a hidden placeholder.</p>

        <div className="optional-input">
          <div className="optional-label">
            Admit rate <EvidenceBadge status="USER INPUT" note="Never a hardcoded placeholder — boarding output is withheld entirely if absent." />
          </div>
          <input
            type="number"
            step="0.01"
            min={0}
            max={1}
            placeholder="e.g. 0.20 (fraction admitted)"
            value={admitRate ?? ''}
            onChange={(e) => setAdmitRate(e.target.value === '' ? null : Number(e.target.value))}
          />
          {admitRate === null && <span className="degrade-note">Boarding summary will not be produced.</span>}
        </div>

        <div className="optional-input">
          <div className="optional-label">
            Boarding duration by hour × day{' '}
            <EvidenceBadge status="USER INPUT" note="Populate via the template upload; boarding output withheld if absent." />
          </div>
          <span className="degrade-note">
            {boardingDuration ? 'Loaded from your uploaded template.' : 'Not provided — boarding summary will not be produced.'}
          </span>
        </div>

        <div className="optional-input">
          <div className="optional-label">
            Boarding ratio target{' '}
            <EvidenceBadge status="CONVENTION" defaultValue="1:4 (adjustable 1:4–6)" />
          </div>
          <label className="field-row">
            1 RN per
            <input
              type="number"
              min={4}
              max={6}
              value={boardingRatioTarget}
              onChange={(e) => setBoardingRatioTarget(Number(e.target.value))}
            />
            boarders
          </label>
        </div>

        <div className="optional-input">
          <div className="optional-label">
            ESI mix by hour × day{' '}
            <EvidenceBadge status="USER INPUT" note="Enables acuity reweighting (Step 1b); core allocation runs on raw volume otherwise, shown with a confidence flag." />
          </div>
          <span className="degrade-note">
            {esiMix ? 'Loaded from your uploaded template.' : 'Not provided — core allocation will run on raw volume, flagged as lower-confidence.'}
          </span>
        </div>
      </section>

      <div className="button-row continue-row">
        <button className="btn-primary btn-large" disabled={!canContinue} onClick={() => setScreen('dashboard')}>
          Continue to results
        </button>
        {!canContinue && <span className="degrade-note">Need arrivals data, a wHPPV target, and at least one shift.</span>}
      </div>
    </div>
  );
}
