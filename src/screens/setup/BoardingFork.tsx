import { useRef, useState } from 'react';
import { useStore } from '../../store';
import { ArrivalsGrid } from '../../components/ArrivalsGrid';
import { downloadConsolidatedTemplateXlsx } from '../../lib/template';
import { parseUploadFile } from '../../lib/parseUpload';
import { applyParsedUpload } from './applyParsedUpload';

/**
 * The boarding fork (2026-07-27 guided-setup-walkthrough prompt, Part 2.3) — ONE question,
 * asked once, before any boarding input is shown. The user must never see both the census
 * grid and the admit-rate fields at once — `boardingPath` is a tri-state selector for exactly
 * that reason, not two independent booleans.
 */
export function BoardingFork() {
  const {
    boardingPath, setBoardingPath,
    boardingCensusMedical, setBoardingCensusMedical,
    boardingCensusBH, setBoardingCensusBH,
    admitRate, setAdmitRate,
    boardingDuration, setBoardingDuration,
  } = useStore();
  const [trackBH, setTrackBH] = useState(boardingCensusBH !== null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadMsgs, setUploadMsgs] = useState<{ warnings: string[]; errors: string[] } | null>(null);

  async function handleFile(file: File) {
    const parsed = await parseUploadFile(file);
    setUploadMsgs({ warnings: parsed.warnings, errors: parsed.errors });
    if (parsed.errors.length === 0) applyParsedUpload(parsed, useStore.getState());
  }

  if (boardingPath === null) {
    return (
      <div className="boarding-fork-question">
        <p><strong>Can you get a boarding census report from bed management?</strong></p>
        <p className="degrade-note">
          A boarding census counts patients physically in the ED who have a bed request placed
          and no inpatient bed assigned, at each hour — a bed-management or capacity-dashboard
          report, not the standard ED metrics.
        </p>
        <div className="button-row">
          <button className="btn-primary" onClick={() => setBoardingPath('census')}>Yes, I can get that</button>
          <button className="btn-secondary" onClick={() => setBoardingPath('classic')}>
            No — I have admit rate / boarding duration instead
          </button>
          <button className="btn-link" onClick={() => setBoardingPath('skip')}>Skip boarding entirely</button>
        </div>
      </div>
    );
  }

  if (boardingPath === 'skip') {
    return (
      <div className="boarding-fork-answer">
        <p className="degrade-note">
          Skipping boarding hides roughly half your department's true demand — the boarding
          coverage recommendation and the "both budgets together" chapter won't be produced.
        </p>
        <button className="btn-link" onClick={() => setBoardingPath(null)}>Change my answer</button>
      </div>
    );
  }

  if (boardingPath === 'census') {
    const medical = boardingCensusMedical ?? new Array(168).fill(0);
    const bh = boardingCensusBH ?? new Array(168).fill(0);
    return (
      <div className="boarding-fork-answer">
        <p>
          <strong>Boarding census — medical/surg.</strong> Patients physically in the ED who
          have a bed request placed and no inpatient bed assigned, counted at each hour,
          averaged over the last 12 months.
        </p>
        <div className="button-row">
          <button className="btn-secondary" onClick={downloadConsolidatedTemplateXlsx}>Download the Boarding Census tab (.xlsx)</button>
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
            {uploadMsgs.errors.map((e, i) => <div key={i} className="msg-error">{e}</div>)}
            {uploadMsgs.warnings.map((w, i) => <div key={i} className="msg-warning">{w}</div>)}
          </div>
        )}
        <ArrivalsGrid arrivals={medical} onChange={setBoardingCensusMedical} />

        <label className="field-row">
          <input
            type="checkbox"
            checked={trackBH}
            onChange={(e) => {
              setTrackBH(e.target.checked);
              if (!e.target.checked) setBoardingCensusBH(null);
            }}
          />
          Do you track behavioral-health boarding separately?
        </label>
        {trackBH && (
          <>
            <p className="degrade-note">
              BH boarders are staffed at a very different ratio from medical/surg boarders — far
              less licensed RN time per patient. Tracking it separately lets the results page
              report each accurately.
            </p>
            <ArrivalsGrid arrivals={bh} onChange={setBoardingCensusBH} />
          </>
        )}

        <button className="btn-link" onClick={() => setBoardingPath(null)}>Change my answer</button>
      </div>
    );
  }

  // boardingPath === 'classic'
  return (
    <div className="boarding-fork-answer">
      <p>
        These are the standard ED boarding metrics. The census route above is more accurate if
        you can get it later — you can always come back and switch.
      </p>
      <label className="field-row">
        Admit rate (fraction of ED patients admitted, 0-1)
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          value={admitRate ?? ''}
          placeholder="e.g. 0.22"
          onChange={(e) => setAdmitRate(e.target.value === '' ? null : Number(e.target.value))}
        />
      </label>
      <label className="field-row">
        Mean boarding duration (hours per admitted patient)
        <input
          type="number"
          min={0}
          step={0.1}
          value={boardingDuration ?? ''}
          placeholder="e.g. 5.2"
          onChange={(e) => setBoardingDuration(e.target.value === '' ? null : Number(e.target.value))}
        />
      </label>
      <button className="btn-link" onClick={() => setBoardingPath(null)}>Change my answer</button>
    </div>
  );
}
