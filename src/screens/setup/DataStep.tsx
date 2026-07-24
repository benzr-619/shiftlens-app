import { useRef, useState } from 'react';
import { useStore } from '../../store';
import { ArrivalsGrid } from '../../components/ArrivalsGrid';
import { EvidenceBadge } from '../../components/EvidenceBadge';
import { downloadConsolidatedTemplateXlsx } from '../../lib/template';
import { parseUploadFile } from '../../lib/parseUpload';
import { applyParsedUpload } from './applyParsedUpload';

const DATA_TEAM_COPY = `Subject: ED staffing data request

Could you pull the following for the ED? Ideally as a single spreadsheet — a blank template with these exact fields is attached. Fill in whichever rows you have; leave the rest blank.

Please pull items 1-4 over the SAME reporting period (ideally a full year, or as much history as you have) so the numbers stay consistent with each other.

1. Average arrivals by hour of day and day of week (required) — for each of the 168 hour/day-of-week combinations, the AVERAGE count of ED arrivals across the full reporting period — not one specific week's raw counts.
2. Average ESI/acuity mix by hour of day and day of week (optional) — average counts of ESI 1-2, ESI 3, and ESI 4-5 patients for the same 168 cells, over the same period as arrivals above.
3. Admit rate (optional) — the overall percentage of ED patients admitted to the hospital, over the same period as arrivals above (not a single day's or week's rate).
4. Mean boarding duration (optional) — the average number of hours an admitted patient waits in the ED for an inpatient bed, over the same period as arrivals above. This should be a mean/average, not a median.
5. Mean boarding duration by month, Jan-Dec (optional) — for each month, the average boarding duration (in hours) per admitted patient that month. This should be a mean/average, not a median, and not a total for the month.
6. Mean boarding duration by day of week, Sun-Sat (optional) — same as above, broken out by day of week instead of month.`;

export function DataStep() {
  const {
    arrivals,
    setArrivals,
    esiMix,
    admitRate,
    boardingDuration,
    monthlyMeanBoardingDurationHours,
    dayOfWeekMeanBoardingDurationHours,
    boardingRatioTarget,
    setBoardingRatioTarget,
  } = useStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadMsgs, setUploadMsgs] = useState<{ warnings: string[]; errors: string[] } | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasArrivalsData = arrivals.some((v) => v > 0);

  async function handleFile(file: File) {
    const parsed = await parseUploadFile(file);
    setUploadMsgs({ warnings: parsed.warnings, errors: parsed.errors });
    if (parsed.errors.length === 0) {
      applyParsedUpload(parsed, useStore.getState());
      if (parsed.arrivals) setShowGrid(true);
    }
  }

  async function copyDataTeamText() {
    await navigator.clipboard.writeText(DATA_TEAM_COPY);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <section className="card">
        <h2>Your ED's data</h2>
        <p>
          One template, one upload — everything below lives in the same spreadsheet. Download it, fill in
          whatever you have, and upload it back here. Nothing here is required except arrivals; skip anything
          you don't track and the tool will tell you what that changes.
        </p>

        <ul className="data-explainer-list">
          <li>
            <strong>Average arrivals by hour and day of week</strong> <span className="required">Required</span>
            <p>
              For each hour/day-of-week slot, the <strong>average</strong> number of patients who arrive
              then — computed across as full a period as you have (ideally a year), not one specific week's
              raw counts. Everything else this tool calculates is built from this — without it, nothing else
              can run.
            </p>
          </li>
          <li>
            <strong>Average ESI / acuity mix by hour</strong> <EvidenceBadge status="OPTIONAL" note="Reweights the staffing curve toward hours with sicker patients." />
            <p>
              Some hours run sicker than others. Provide this and the tool shifts staffing toward the hours
              that need it most. Leave it blank and it assumes acuity is flat across the day — a reasonable
              estimate, just a bit rougher. Pull this over the <strong>same period</strong> as arrivals above,
              so the two stay consistent with each other.
            </p>
          </li>
          <li>
            <strong>Admit rate and mean boarding duration</strong>{' '}
            <EvidenceBadge status="OPTIONAL" note="Only useful as a pair — we won't guess at one if only the other is given." />
            <p>
              Together these tell us how many patients end up boarding (waiting in the ED for an inpatient
              bed) and for how long. Provide both and we'll estimate boarding coverage. Provide only one and
              boarding gets left out of your results entirely — we won't guess at the missing number.
              Admit rate should be the overall rate across the <strong>same period</strong> as arrivals above,
              not a single day's or week's rate. Boarding duration should be an <strong>average</strong>
              (mean) across all boarded patients in that period, not a median.
            </p>
          </li>
          <li>
            <strong>Mean boarding duration by month and by day of week</strong>{' '}
            <EvidenceBadge status="OPTIONAL" note="Sharpens WHEN boarding coverage matters most, instead of spreading one flat number across the year." />
            <p>
              If some months or days of the week have longer average boarding waits than others, this lets us
              prioritize coverage for those higher-impact times — a January surge, a weekend backlog — instead
              of one flat number spread evenly across the year. <strong>Enter an average (mean) boarding
              duration per patient for that month/day</strong> — the same kind of number as the overall
              boarding duration above, just broken out by period. Not a total, and not a median.
            </p>
          </li>
        </ul>

        <div className="button-row">
          <button className="btn-secondary" onClick={downloadConsolidatedTemplateXlsx}>Download data template (.xlsx)</button>
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

        <ul className="data-status-list">
          <li>Arrivals: {hasArrivalsData ? 'loaded' : 'not provided yet'}</li>
          <li>ESI mix: {esiMix ? 'loaded — acuity reweighting enabled' : 'not provided — running on raw volume'}</li>
          <li>
            Admit rate / boarding duration:{' '}
            {admitRate !== null && boardingDuration !== null
              ? 'loaded — boarding coverage will be calculated'
              : 'not provided — boarding coverage will be skipped'}
          </li>
          <li>
            Boarding seasonality:{' '}
            {monthlyMeanBoardingDurationHours || dayOfWeekMeanBoardingDurationHours
              ? `loaded (${[monthlyMeanBoardingDurationHours && 'monthly', dayOfWeekMeanBoardingDurationHours && 'day-of-week'].filter(Boolean).join(' + ')})`
              : 'not provided — boarding coverage ranked by shift-block only'}
          </li>
        </ul>

        <button className="btn-link" onClick={() => setShowGrid((v) => !v)}>
          {showGrid ? 'Hide' : hasArrivalsData ? 'Touch up' : 'Enter manually'} the arrivals grid
        </button>
        {showGrid && <ArrivalsGrid arrivals={arrivals} onChange={setArrivals} />}

        <div className="optional-input">
          <div className="optional-label">
            Boarding ratio target <EvidenceBadge status="CONVENTION" defaultValue="1:4 (adjustable 1:4–6)" />
          </div>
          <p>This one's a policy choice, not something to pull from a report — how many boarders one RN covers.</p>
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
      </section>

      <section className="card data-team-copy-block">
        <h2>Copy this for your data team</h2>
        <p>
          A tighter version of the same asks, formatted to paste into an email or ticket to whoever pulls
          reports for you.
        </p>
        <pre className="data-team-copy-text">{DATA_TEAM_COPY}</pre>
        <button className="btn-secondary" onClick={copyDataTeamText}>
          {copied ? 'Copied!' : 'Copy to clipboard'}
        </button>
      </section>
    </>
  );
}
