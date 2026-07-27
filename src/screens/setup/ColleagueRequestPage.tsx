import { useRef, useState } from 'react';
import { useStore } from '../../store';
import { downloadConsolidatedTemplateXlsx } from '../../lib/template';
import { parseUploadFile } from '../../lib/parseUpload';
import { applyParsedUpload } from './applyParsedUpload';

// Expands DataStep's old "copy this for your data team" block (2026-07-27 guided-setup
// prompt, Part 2.1B) into its own page — the full audited data list (§1 of
// SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md), each item's exact definition, plus the
// blank template download. Once the data comes back, the SAME upload control here applies it
// and the wizard continues normally (Next -> Volume).
const DATA_TEAM_COPY = `Subject: ED staffing data request

Could you pull the following for the ED? A blank template with these exact fields is attached — fill in whichever rows you have; leave the rest blank.

Please pull items 1-3 and 6-7 over the SAME reporting period — the most recent 12 months — so the numbers stay consistent with each other.

1. Average arrivals by hour of day and day of week (required) — for each of the 168 hour/day-of-week combinations, the average count of ED arrivals over the most recent 12 months, not one specific week's raw counts.
2. Your current nurse staffing by shift, each day (recommended) — this is your own schedule, not a report.
3. Busy-hour (75th-percentile) arrivals by hour and day of week (optional) — same report as item 1, with the percentile setting changed to P75.
4. Boarding census (preferred, if available) — patients physically in the ED who have a bed request placed and no inpatient bed assigned, counted at each hour, for each of the 168 hour/day-of-week combinations, averaged over the last 12 months. If behavioral-health boarding is tracked separately, please pull that as its own column too.
   OR, if that report isn't available: admit rate (the overall percentage of ED patients admitted to the hospital) and mean boarding duration (the average number of hours an admitted patient waits in the ED for an inpatient bed) — both over the same 12-month period.
5. Boarding seasonality (optional) — the same boarding report from item 4, grouped by month instead of by hour/day.
6. Average ESI/acuity mix by hour of day and day of week (optional) — average counts of ESI 1-2, ESI 3, and ESI 4-5 patients for the same 168 cells, over the same period as item 1.`;

export function ColleagueRequestPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadMsgs, setUploadMsgs] = useState<{ warnings: string[]; errors: string[] } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleFile(file: File) {
    const parsed = await parseUploadFile(file);
    setUploadMsgs({ warnings: parsed.warnings, errors: parsed.errors });
    if (parsed.errors.length === 0) applyParsedUpload(parsed, useStore.getState());
  }

  async function copyDataTeamText() {
    await navigator.clipboard.writeText(DATA_TEAM_COPY);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="card data-team-copy-block">
      <h2>Data request for your team</h2>
      <p>
        Here's the request, formatted to paste into an email or ticket to whoever pulls reports
        for you. Download the blank template below and attach it.
      </p>
      <pre className="data-team-copy-text">{DATA_TEAM_COPY}</pre>
      <div className="button-row">
        <button className="btn-secondary" onClick={copyDataTeamText}>
          {copied ? 'Copied!' : 'Copy to clipboard'}
        </button>
        <button className="btn-secondary" onClick={downloadConsolidatedTemplateXlsx}>Download blank template (.xlsx)</button>
      </div>

      <h3>When the data comes back</h3>
      <p>Upload the filled template here — whichever tabs your colleague filled in.</p>
      <div className="button-row">
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
    </section>
  );
}
