import { useRef, useState } from 'react';
import { useStore } from '../../store';
import { ShiftMenuEditor } from '../../components/ShiftMenuEditor';
import { CurrentStaffingGrid } from '../../components/CurrentStaffingGrid';
import { FlexAxesToggles } from '../../components/FlexAxesToggles';
import { EvidenceBadge } from '../../components/EvidenceBadge';
import { downloadStaffingTemplateXlsx } from '../../lib/template';
import { parseStaffingUploadFile } from '../../lib/parseStaffingUpload';

export function ShiftMenuStep() {
  const {
    shiftMenu,
    setShiftMenu,
    currentStaffingGrid,
    setCurrentStaffingGrid,
    resetCurrentStaffingGrid,
    boardingRatioTarget,
    setBoardingRatioTarget,
    bhBoardingRatioTarget,
    setBhBoardingRatioTarget,
    headcountIncludesIndirectCare,
    setHeadcountIncludesIndirectCare,
    indirectCareUpliftPct,
    setIndirectCareUpliftPct,
  } = useStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadMsgs, setUploadMsgs] = useState<{ warnings: string[]; errors: string[] } | null>(null);

  async function handleFile(file: File) {
    const parsed = await parseStaffingUploadFile(file, shiftMenu);
    setUploadMsgs({ warnings: parsed.warnings, errors: parsed.errors });
    if (parsed.errors.length === 0) {
      // A staffing row already fully specifies a shift (Start Hour + Length) — if the upload
      // references shifts the current menu doesn't have yet, add them rather than silently
      // dropping those rows. See parseStaffingUpload.ts's rowsToStaffingGrid.
      if (parsed.newShifts?.length) setShiftMenu([...shiftMenu, ...parsed.newShifts]);
      if (parsed.grid) setCurrentStaffingGrid(parsed.grid);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Shift menu <span className="required">Required</span></h2>
        <p>Tell us the shifts your ED actually runs — we don't assume 8s vs. 12s or any particular shift count.</p>
        <ShiftMenuEditor menu={shiftMenu} onChange={setShiftMenu} />

        <div className="flex-axes-setup">
          <h3>
            Open to alternatives? <EvidenceBadge status="OPTIONAL" note="Optional — leave all unchecked to keep the idealized grid on your exact menu." />
          </h3>
          <p>
            Your idealized staffing always uses the menu above — this only controls whether we also search for a
            more efficient spread of the same hours. Pick any axes you're open to, or none; you can change this
            later.
          </p>
          <FlexAxesToggles />
        </div>
      </section>

      <section className="card current-staffing-card">
        <div className="grid-header-row">
          <h2>Your current staffing <EvidenceBadge status="OPTIONAL" note="Optional — provide it to compare your actual schedule against the recommendation." /></h2>
          {currentStaffingGrid && (
            <button className="btn-link" onClick={resetCurrentStaffingGrid}>
              Clear
            </button>
          )}
        </div>
        <p>
          Optional, but recommended: tell us how many nurses you actually staff on each shift today. On the
          results page we'll open with an analysis of this grid and show, cell by cell, where your current
          schedule and the idealized recommendation diverge. Skip it and the results page will start from the
          idealized grid instead, with a link to add this later. Enter it directly in the grid below, or —
          for a longer shift menu — download a template, fill it in, and upload it back.
        </p>

        <div className="button-row">
          <button className="btn-secondary" onClick={() => downloadStaffingTemplateXlsx(shiftMenu)} disabled={shiftMenu.length === 0}>
            Download staffing template (.xlsx)
          </button>
          <button className="btn-primary" onClick={() => fileInput.current?.click()} disabled={shiftMenu.length === 0}>
            Upload filled template
          </button>
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
        {shiftMenu.length === 0 && <p className="msg-warning">Add at least one shift above before downloading or uploading a staffing template.</p>}

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

        <CurrentStaffingGrid />
      </section>

      <section className="card">
        <div className="optional-input">
          <div className="optional-label">
            Boarding Staffing Ratios <span className="review-sub">(settings, not data — defaults shown)</span>
          </div>
          <p>
            Enter the nursing ratios used by your institution's inpatient floors, to estimate
            the nursing hours being spent covering boarders.
          </p>
          <label className="field-row">
            1 RN per
            <input
              type="number"
              min={1}
              value={boardingRatioTarget}
              onChange={(e) => setBoardingRatioTarget(Number(e.target.value))}
            />
            medical/surg boarders
          </label>
          <label className="field-row">
            1 RN per
            <input
              type="number"
              min={1}
              value={bhBoardingRatioTarget}
              onChange={(e) => setBhBoardingRatioTarget(Number(e.target.value))}
            />
            behavioral-health boarders <span className="degrade-note">(classic range 10-12 — far less licensed RN care than med/surg)</span>
          </label>
        </div>
      </section>

      <section className="card">
        <div className="optional-input">
          <div className="optional-label">
            Headcount semantics <EvidenceBadge status="OPTIONAL" note="Optional — helps us frame the grid's numbers correctly for you, doesn't change any calculation." />
          </div>
          <p>
            A headcount of "5" reads very differently depending on who counts toward it. This doesn't change any
            number on the results page — it only shapes how we describe it, so the grid doesn't read as wrong when
            it's really just counting differently than you expected.
          </p>
          <label className="field-row">
            <span>Does the headcount you enter (shift menu, current staffing) include charge and triage nurses?</span>
            <select
              value={headcountIncludesIndirectCare === null ? '' : headcountIncludesIndirectCare ? 'yes' : 'no'}
              onChange={(e) => setHeadcountIncludesIndirectCare(e.target.value === '' ? null : e.target.value === 'yes')}
            >
              <option value="">Not sure / prefer not to say</option>
              <option value="no">No — my headcount is bedside RNs only</option>
              <option value="yes">Yes — it includes charge/triage/other indirect-care roles</option>
            </select>
          </label>
          {headcountIncludesIndirectCare === true && (
            <label className="field-row">
              About what share of that headcount is indirect care (charge, triage, etc.), roughly?
              <input
                type="number"
                min={0}
                max={100}
                value={indirectCareUpliftPct ?? ''}
                placeholder="e.g. 15"
                onChange={(e) => setIndirectCareUpliftPct(e.target.value === '' ? null : Number(e.target.value))}
              />
              %
            </label>
          )}
        </div>
      </section>
    </>
  );
}
