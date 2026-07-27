import { useRef, useState } from 'react';
import { useStore } from '../../store';
import { parseUploadFile } from '../../lib/parseUpload';
import { parseStaffingUploadFile } from '../../lib/parseStaffingUpload';
import { applyParsedUpload } from './applyParsedUpload';

/**
 * The first thing setup shows (2026-07-27 guided-setup-walkthrough prompt, Part 2.1) — three
 * cards, before any data entry. Picking a card sets `setupMode`, which everything downstream
 * (SetupScreen's Step 1 routing) reads. Once inside 'tutorial' there is no "ask a colleague"
 * escape hatch — it's a linear guided flow, per spec.
 */
export function SetupEntryFork() {
  const { setSetupMode, setSetupStep } = useStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadMsgs, setUploadMsgs] = useState<{ warnings: string[]; errors: string[] } | null>(null);

  async function handleReturningFile(file: File) {
    const parsed = await parseUploadFile(file);
    // The current-staffing grid lives on its own "Current Staffing" tab within the SAME
    // exported file (lib/template.ts's generateFilledConsolidatedTemplateXlsxBlob) — a
    // different shape from the consolidated data tabs, so it needs its own parser call.
    // Passing the CURRENT (still-default) shiftMenu is fine: the file's own Start Hour/Length
    // columns fully specify each shift, so parseStaffingUploadFile recovers any the default
    // menu doesn't have yet (see .claude/rules/template-parsing.md's shift-recovery fix).
    // A missing/absent "Current Staffing" tab is an expected, silent case here (current
    // staffing was always optional) — only its own warnings surface, and only when it
    // actually found a tab to parse; its errors (e.g. "no recognizable tab in this workbook")
    // would otherwise misleadingly read as a problem with the whole import.
    const staffingParsed = await parseStaffingUploadFile(file, useStore.getState().shiftMenu);
    setUploadMsgs({
      warnings: [...parsed.warnings, ...(staffingParsed.grid ? staffingParsed.warnings : [])],
      errors: parsed.errors,
    });
    if (parsed.errors.length === 0) {
      applyParsedUpload(parsed, useStore.getState());
      if (staffingParsed.grid) {
        if (staffingParsed.newShifts?.length) {
          useStore.getState().setShiftMenu([...useStore.getState().shiftMenu, ...staffingParsed.newShifts]);
        }
        useStore.getState().setCurrentStaffingGrid(staffingParsed.grid);
      }
      setSetupMode('returning');
      setSetupStep(3); // jump straight to Review
    }
  }

  return (
    <section className="card setup-entry-fork">
      <h2>Let's get your data in</h2>
      <p>Pick whichever fits how you're getting your ED's data today.</p>

      <div className="entry-fork-cards">
        <div className="entry-fork-card">
          <h3>I'll pull the data myself</h3>
          <p>
            A short guided walkthrough — one thing at a time, with the exact definition to type
            into your dashboard for each. Good if you have access to your ED's reports yourself.
          </p>
          <button className="btn-primary" onClick={() => setSetupMode('tutorial')}>
            Start the walkthrough
          </button>
        </div>

        <div className="entry-fork-card">
          <h3>Someone else pulls our data for us</h3>
          <p>
            A single page summarizing every data item with its exact definition, plus a blank
            template — built to paste into an email or ticket for your data team.
          </p>
          <button className="btn-secondary" onClick={() => setSetupMode('colleague')}>
            Build the data request
          </button>
        </div>

        <div className="entry-fork-card">
          <h3>I have a ShiftLens file from before</h3>
          <p>
            Upload a data file you exported from a previous session and jump straight to
            reviewing it.
          </p>
          <button className="btn-secondary" onClick={() => fileInput.current?.click()}>
            Upload and review
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleReturningFile(f);
              e.target.value = '';
            }}
          />
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
        </div>
      </div>
    </section>
  );
}
