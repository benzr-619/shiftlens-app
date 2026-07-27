import { useRef, useState } from 'react';
import { useStore } from '../../store';
import { ArrivalsGrid } from '../../components/ArrivalsGrid';
import { BoardingFork } from './BoardingFork';
import { MONTH_LABELS } from '../../engine/types';
import { downloadConsolidatedTemplateXlsx } from '../../lib/template';
import { parseUploadFile } from '../../lib/parseUpload';
import { applyParsedUpload } from './applyParsedUpload';
import { checkBoardingDurationConsistency, checkMonthlyDispersion } from '../../lib/inputIntegrity';
import { normalizeEsiMix } from '../../engine/allocate';

// Current staffing is NOT a tutorial item — it lives ONLY on `ShiftMenuStep.tsx` (outer wizard
// Step 2), and deliberately so: `CurrentStaffingGrid`'s columns ARE the shift menu, which
// doesn't exist yet at tutorial time (still the default 2-shift placeholder). Showing the same
// grid/upload here too was duplicative AND actively misleading — a real menu customized later
// would silently orphan whatever was entered against the placeholder menu. See
// .claude/rules/template-parsing.md's "one or the other" note.
const TUTORIAL_STEP_LABELS = [
  'Arrivals',
  'Busy-hour arrivals',
  'Boarding',
  'Boarding seasonality',
  'Acuity (ESI) mix',
];

/** Simple 12-cell month input row, shared by the monthly-census and monthly-duration
 * manual-entry paths on the boarding-seasonality tutorial screen. */
function MonthlyTwelveInput({ values, onChange }: { values: number[]; onChange: (next: number[]) => void }) {
  return (
    <div className="staffing-grid-wrap">
      <table className="staffing-grid">
        <thead>
          <tr>{MONTH_LABELS.map((m) => <th key={m}>{m}</th>)}</tr>
        </thead>
        <tbody>
          <tr>
            {MONTH_LABELS.map((m, i) => (
              <td key={m}>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={values[i] || ''}
                  onChange={(e) => {
                    const next = values.slice();
                    next[i] = e.target.value === '' ? 0 : Number(e.target.value);
                    onChange(next);
                  }}
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function UploadRow({ onFile }: { onFile: (f: File) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
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
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/**
 * The tutorial walkthrough (2026-07-27 guided-setup-walkthrough prompt, Part 2.2) — one data
 * item per screen, four-part structure: what this is / what to pull / enter it / skip.
 * Occupies the outer SetupScreen's Step 1 ("Data") slot when `setupMode === 'tutorial'`.
 * `onDone` advances the OUTER wizard to Volume once the last item is finished or skipped.
 */
export function TutorialFlow({ onDone }: { onDone: () => void }) {
  const {
    tutorialStep, setTutorialStep,
    arrivals, setArrivals,
    arrivalsP75, setArrivalsP75,
    boardingPath,
    monthlyBoardingCensusMedical, setMonthlyBoardingCensusMedical,
    monthlyBoardingCensusBH, setMonthlyBoardingCensusBH,
    monthlyMeanBoardingDurationHours, setMonthlyMeanBoardingDurationHours,
    dayOfWeekMeanBoardingDurationHours,
    boardingDuration,
    esiMix, setEsiMix,
  } = useStore();
  const [uploadMsgs, setUploadMsgs] = useState<{ warnings: string[]; errors: string[] } | null>(null);

  // PR K's input-integrity banners — diagnostic-only, never auto-correcting. Scoped to the
  // DERIVED path only (SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md §3.5): a measured
  // census has no scalar duration to compare against and its own monthly array isn't a
  // duration-mean, so these checks are inert (and correctly absent) on the census path.
  const durationConsistency = boardingPath === 'classic'
    ? checkBoardingDurationConsistency(boardingDuration, monthlyMeanBoardingDurationHours, dayOfWeekMeanBoardingDurationHours)
    : null;
  const monthlyDispersion = boardingPath === 'classic' ? checkMonthlyDispersion(monthlyMeanBoardingDurationHours) : null;

  async function handleFile(file: File) {
    const parsed = await parseUploadFile(file);
    setUploadMsgs({ warnings: parsed.warnings, errors: parsed.errors });
    if (parsed.errors.length === 0) applyParsedUpload(parsed, useStore.getState());
  }

  const hasArrivalsData = arrivals.some((v) => v > 0);
  const isLastStep = tutorialStep === TUTORIAL_STEP_LABELS.length - 1;
  const isRequired = tutorialStep === 0;

  function goNext() {
    if (isRequired && !hasArrivalsData) return;
    setUploadMsgs(null);
    if (isLastStep) onDone();
    else setTutorialStep(tutorialStep + 1);
  }

  function goBack() {
    setUploadMsgs(null);
    if (tutorialStep === 0) return;
    setTutorialStep(tutorialStep - 1);
  }

  function skip() {
    if (isRequired) return;
    goNext();
  }

  return (
    <section className="card tutorial-flow">
      <div className="step-indicator-title">
        Step {tutorialStep + 1} of {TUTORIAL_STEP_LABELS.length}: {TUTORIAL_STEP_LABELS[tutorialStep]}
      </div>

      {tutorialStep === 0 && (
        <div className="tutorial-item">
          <p><strong>What this is:</strong> the shape of when your patients arrive.</p>
          <p>
            <strong>What to pull:</strong> average number of patients arriving in each hour of
            the week, over the last 12 months.
          </p>
          <UploadRow onFile={handleFile} />
          {uploadMsgs && (
            <div className="upload-msgs">
              {uploadMsgs.errors.map((e, i) => <div key={i} className="msg-error">{e}</div>)}
              {uploadMsgs.warnings.map((w, i) => <div key={i} className="msg-warning">{w}</div>)}
            </div>
          )}
          <ArrivalsGrid arrivals={arrivals} onChange={setArrivals} />
          <span className="required">Required — can't be skipped</span>
        </div>
      )}

      {tutorialStep === 1 && (
        <div className="tutorial-item">
          <p><strong>What this is:</strong> how much busier your busiest days get, hour by hour.</p>
          <p>
            <strong>What to pull:</strong> the 75th-percentile arrivals for each hour — the same
            report as arrivals, with the percentile setting changed.
          </p>
          <UploadRow onFile={handleFile} />
          {uploadMsgs && (
            <div className="upload-msgs">
              {uploadMsgs.errors.map((e, i) => <div key={i} className="msg-error">{e}</div>)}
              {uploadMsgs.warnings.map((w, i) => <div key={i} className="msg-warning">{w}</div>)}
            </div>
          )}
          <ArrivalsGrid arrivals={arrivalsP75 ?? new Array(168).fill(0)} onChange={setArrivalsP75} />
          <p className="degrade-note">
            <strong>Skipping means:</strong> the tool plans to the average hour and can't protect
            genuinely volatile hours.
          </p>
        </div>
      )}

      {tutorialStep === 2 && (
        <div className="tutorial-item">
          <p><strong>What this is:</strong> patients waiting in the ED for an inpatient bed — a second, separate demand from arrivals.</p>
          <BoardingFork />
        </div>
      )}

      {tutorialStep === 3 && (
        <div className="tutorial-item">
          <p><strong>What this is:</strong> whether boarding runs heavier in some months than others.</p>
          {boardingPath === 'census' ? (
            <>
              <p><strong>What to pull:</strong> the same boarding census report, grouped by month.</p>
              <UploadRow onFile={handleFile} />
              <p className="optional-label">Mean medical boarding census by month</p>
              <MonthlyTwelveInput values={monthlyBoardingCensusMedical ?? new Array(12).fill(0)} onChange={setMonthlyBoardingCensusMedical} />
              <p className="optional-label">Mean BH boarding census by month (only if tracked separately)</p>
              <MonthlyTwelveInput values={monthlyBoardingCensusBH ?? new Array(12).fill(0)} onChange={setMonthlyBoardingCensusBH} />
            </>
          ) : boardingPath === 'classic' ? (
            <>
              <p><strong>What to pull:</strong> the same boarding-duration report, grouped by month.</p>
              <UploadRow onFile={handleFile} />
              <p className="optional-label">Mean boarding duration by month (hrs)</p>
              <MonthlyTwelveInput values={monthlyMeanBoardingDurationHours ?? new Array(12).fill(0)} onChange={setMonthlyMeanBoardingDurationHours} />
              {durationConsistency && !durationConsistency.withinTolerance && (
                <div className="banner banner-info">
                  Your mean boarding duration ({durationConsistency.scalarValue.toFixed(2)} hrs) and the
                  average of your monthly/day-of-week means ({durationConsistency.impliedValue.toFixed(2)} hrs) disagree
                  by {(durationConsistency.diffPct * 100).toFixed(0)}% — more than the ~15% this is usually within. The
                  calculation uses the overall mean boarding duration ({durationConsistency.scalarValue.toFixed(2)} hrs)
                  as the baseline for seasonality. This isn't corrected automatically — you know which number is right.
                </div>
              )}
              {monthlyDispersion && monthlyDispersion.flagged && (
                <div className="banner banner-info">
                  Your monthly boarding-duration means swing {monthlyDispersion.ratio.toFixed(1)}× ({monthlyDispersion.maxValue.toFixed(1)} hrs vs.{' '}
                  {monthlyDispersion.minValue.toFixed(1)} hrs) — a possible small-sample month rather than a data
                  error. Not refused, just flagged.
                </div>
              )}
            </>
          ) : (
            <p className="degrade-note">Boarding was skipped, so there's no seasonality to enter — moving on.</p>
          )}
          <p className="degrade-note"><strong>Skipping means:</strong> the tool treats every month alike.</p>
        </div>
      )}

      {tutorialStep === 4 && (
        <div className="tutorial-item">
          <p><strong>What this is:</strong> how sick your patients are, hour by hour.</p>
          <p>
            <strong>What to pull:</strong> average arrivals per hour split into ESI 1-2, ESI 3,
            and ESI 4-5, over the same period as arrivals.
          </p>
          <UploadRow onFile={handleFile} />
          {uploadMsgs && (
            <div className="upload-msgs">
              {uploadMsgs.errors.map((e, i) => <div key={i} className="msg-error">{e}</div>)}
              {uploadMsgs.warnings.map((w, i) => <div key={i} className="msg-warning">{w}</div>)}
            </div>
          )}
          {esiMix && (() => {
            const { adjustment } = normalizeEsiMix(arrivals, esiMix);
            if (!adjustment) return null;
            const pctBefore = (t: number) => (t > 0 ? ((adjustment.totalsBefore.esi12 + adjustment.totalsBefore.esi3 + adjustment.totalsBefore.esi45) / t) * 100 : 0);
            const arrivalsSum = arrivals.reduce((a, b) => a + b, 0);
            return (
              <div className="banner banner-info">
                Your ESI mix summed to {pctBefore(arrivalsSum).toFixed(0)}% of arrivals across{' '}
                {adjustment.adjustedCells.length} of 168 hours — arithmetically impossible for three sub-counts of one
                total, so it's automatically rescaled to sum exactly to arrivals. ESI 3 is treated as the least-biased
                category and held fixed where possible; ESI 1-2 and ESI 4-5 are scaled to make up the difference
                {adjustment.esi3ExceededArrivalsCells.length > 0 && (
                  <> ({adjustment.esi3ExceededArrivalsCells.length} hours had ESI 3 alone exceed arrivals, so all three were scaled instead)</>
                )}
                . The true answer likely sits between this and scaling all three evenly, since ESI 3 is probably
                slightly biased too — this is the one auto-correction in the app, because an un-normalized mix isn't
                just suspicious, it's impossible.
              </div>
            );
          })()}
          <p className="optional-label">ESI 1-2</p>
          <ArrivalsGrid
            arrivals={esiMix?.esi12 ?? new Array(168).fill(0)}
            onChange={(next) => setEsiMix({ esi12: next, esi3: esiMix?.esi3 ?? new Array(168).fill(0), esi45: esiMix?.esi45 ?? new Array(168).fill(0) })}
          />
          <p className="optional-label">ESI 3</p>
          <ArrivalsGrid
            arrivals={esiMix?.esi3 ?? new Array(168).fill(0)}
            onChange={(next) => setEsiMix({ esi12: esiMix?.esi12 ?? new Array(168).fill(0), esi3: next, esi45: esiMix?.esi45 ?? new Array(168).fill(0) })}
          />
          <p className="optional-label">ESI 4-5</p>
          <ArrivalsGrid
            arrivals={esiMix?.esi45 ?? new Array(168).fill(0)}
            onChange={(next) => setEsiMix({ esi12: esiMix?.esi12 ?? new Array(168).fill(0), esi3: esiMix?.esi3 ?? new Array(168).fill(0), esi45: next })}
          />
          <p className="degrade-note"><strong>Skipping means:</strong> all patients are weighted equally.</p>
        </div>
      )}

      <div className="button-row continue-row">
        {tutorialStep > 0 && <button className="btn-secondary" onClick={goBack}>Back</button>}
        {!isRequired && <button className="btn-link" onClick={skip}>Skip this item</button>}
        <button className="btn-primary btn-large" disabled={isRequired && !hasArrivalsData} onClick={goNext}>
          {isLastStep ? 'Continue' : 'Next'}
        </button>
      </div>
    </section>
  );
}
