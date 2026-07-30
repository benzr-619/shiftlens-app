import { useState } from 'react';
import { useStore } from '../../store';
import { buildConstantsTable } from '../../lib/constantsMetadata';
import { normalizeEsiMix } from '../../engine/allocate';
import { computePreBedRequestValidation } from '../../engine/preBedRequestValidation';

/**
 * PR I (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §8, Chapter 9 — "How this works") — the
 * evidence surface. Success condition (spec's own words): an analyst can reconstruct the
 * pipeline from this page alone and find nothing undisclosed. Written for an analyst but in
 * plain sentences — jargon density is not a credibility signal.
 *
 * A branch off the main chapter arc (spec §8), rendered last, visually set apart via
 * `.evidence-surface` (a muted background + a top rule) rather than styled as just another
 * card in the narrative flow.
 */
export function EvidenceSurfaceSection() {
  const { getResult, arrivals, esiMix, preBedRequestCensus, wHppvTarget } = useStore();
  const result = getResult();
  const [open, setOpen] = useState(false);
  const constantsRows = buildConstantsTable();
  const censusSource = result.boarding?.censusSource ?? null;
  const esiAdjustment = esiMix ? normalizeEsiMix(arrivals, esiMix).adjustment : null;
  const preBedValidation = computePreBedRequestValidation(preBedRequestCensus ?? undefined, result.hourlyRequirement, wHppvTarget);

  return (
    <section className="card evidence-surface">
      <button className="btn-link why-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide how this works' : 'How this works (for analysts)'}
      </button>

      {open && (
        <div className="evidence-surface-body">
          {/* 1. Pipeline walkthrough */}
          <h3>The pipeline</h3>
          <ol className="pipeline-walkthrough">
            <li>
              <strong>Step 1 — cell-share allocation.</strong> Arrivals are weighted by ESI acuity (when provided),
              then the annual core-hours total (visits × wHPPV target) is allocated across the 168 hour-of-week
              cells in proportion to each cell's share of weighted arrivals. Why: nursing work is front-loaded at
              arrival, not spread evenly across a visit's length of stay — so demand should track WHEN patients
              arrive, not when the department feels busiest.
            </li>
            <li>
              <strong>Step 1b — day-of-week smoothing.</strong> Each cell's allocation is blended with its neighbors
              on adjacent days (a weighted average, center + 2×neighbor). Why: a raw arrivals-proportional
              allocation is jagged in a way no real schedule can track hour to hour; smoothing produces a
              requirement curve a shift-based staffing plan can actually fit.
            </li>
            <li>
              <strong>Step 1c — cohort/volatility band.</strong> A separate p25/p75 cohort-benchmark band, further
              raised at hours with high busy-hour (p75) arrivals spread when that data is provided. Why: staffing
              to the mean under-covers roughly half of all instances by construction — the band protects genuinely
              volatile hours without inflating the annual total.
            </li>
            <li>
              <strong>Step 2 — boarding census (a separate demand).</strong> Admission events (arrivals × admit rate)
              are convolved forward across each patient's expected boarding duration, circularly over the full
              week. Why: boarding accumulates AFTER arrival and persists for hours, unlike core ED nursing work —
              modeled as a separate, additive demand, never blended into the core grid (the separate-demand
              thesis, spec §6).
            </li>
            <li>
              <strong>Step 3 — shift-fit solve.</strong> A greedy full-coverage search finds the minimum staff that
              covers every hour, then a joint whole-week trim removes headcount one unit at a time — whichever cut
              adds the least convex "queue cost" (queued backlog normalized by that hour's own requirement) — until
              the schedule fits the target-implied hours plus a small tolerance, protected by a peer-benchmark
              floor. Why: an integer, shift-block schedule can never exactly hit a continuous target; the trim
              finds the least-bad way to fit one to the other.
            </li>
          </ol>

          {/* 2. Constants table — GENERATED from DEFAULTS at runtime, see lib/constantsMetadata.ts */}
          <h3>Constants</h3>
          <div className="staffing-grid-wrap">
            <table className="staffing-grid constants-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Current value</th>
                  <th>What it controls</th>
                  <th>Evidence</th>
                  <th>What changes if you move it</th>
                </tr>
              </thead>
              <tbody>
                {constantsRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value)}</td>
                    <td>{row.controls}</td>
                    <td>{row.evidenceTag}</td>
                    <td>{row.ifMoved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 3. Data provenance — 2026-07-27: boarding moves to "your data" when measured. */}
          <h3>Where every number on this page comes from</h3>
          <table className="staffing-grid provenance-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Examples on this page</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Your data</td>
                <td>
                  Arrivals, ESI mix, shift menu, current staffing
                  {censusSource === 'measured'
                    ? ', your measured boarding census (medical/surg and BH if tracked separately)'
                    : ', admit rate, boarding duration'}
                </td>
              </tr>
              <tr>
                <td>Peer cohort</td>
                <td>The wHPPV benchmark band (p25/median/p75 by volume band) used for the target pre-fill and the staffing-floor comparison</td>
              </tr>
              <tr>
                <td>Modeled assumption</td>
                <td>
                  The backlog recurrence's catch-up capacity (bounded at what the busiest peer quartile would staff),
                  {censusSource === 'measured' ? '' : ' the boarding census convolution,'} and effective-wHPPV-at-coverage's
                  linear recovery assumption
                </td>
              </tr>
              {censusSource === 'measured' && (
                <tr>
                  <td>Definition that makes this comparable to a peer's</td>
                  <td>
                    Your boarding census is counted from <strong>bed request</strong> (patients with a bed request
                    placed and no inpatient bed assigned) — not from ED arrival, which would double-count
                    pre-bed-request workup the arrivals grid already staffs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {esiAdjustment && (
            <p className="degrade-note">
              Your ESI mix was auto-rescaled to sum to arrivals ({esiAdjustment.adjustedCells.length} of 168 hours
              adjusted) — the one sanctioned auto-correction in the app, since an un-normalized mix is arithmetically
              impossible, not merely suspicious. ESI 3 was treated as the least-biased category and held fixed where
              possible; the true answer likely sits between this and scaling all three evenly.
            </p>
          )}

          {/* 4. Known approximations — three entries conditional on the DERIVED boarding path
              (2026-07-27): a measured census has no admit-timing derivation, no duration-vs-
              median ambiguity, and no duration-conflated month index. */}
          <h3>Known approximations</h3>
          <ul>
            <li>
              The Step 3 trim's marginal-cost simulation is truncated to a 48-hour window per candidate —
              accurate for the RELATIVE ranking the trim needs, but can under-count a cut's true marginal cost in
              a genuinely chronic, no-recovery-nearby stretch (see engine-solver.md's PR B section).
            </li>
            <li>Boarding coverage's "effective wHPPV at this coverage" assumes linear proportional recovery — real recovery likely front-loads value on the highest-ranked slots, with diminishing returns.</li>
            <li>Boarding's month-scope scaling conserves the ANNUAL total exactly, but can slightly over/under-state coverage within any one individual month.</li>
            <li>The backlog recurrence is circular with no reset — a genuinely chronic hole has no natural "zero" to restart from, by design (matches how a real queue behaves), but means a single bad week never fully clears within the model.</li>
            <li>The full-coverage search (5.2) and the shift-menu flexibility search are both bounded greedy/enumeration heuristics, not an exact solve (ILP) — sufficient at this scale (2-6 shifts/day) per the governing algorithm spec, not a proof of global optimality.</li>
            {censusSource !== 'measured' && (
              <>
                <li>Boarding census is DERIVED from admit-event timing (a convolution), not a directly measured hourly census — see boarding-seasonality.md.</li>
                <li>Boarding's monthly seasonality index is derived from MEAN DURATION per patient, a proxy for true seasonal volume — the census path avoids this by indexing the census itself directly.</li>
              </>
            )}
          </ul>

          {/* 5. Reconciliation invariant */}
          <h3>The reconciliation check</h3>
          <p>
            Summing the 168-cell allocation across a full year reproduces the annual target-implied hours exactly
            — this is the build-in correctness proof every solve is checked against, unaffected by any downstream
            trimming or backlog modeling (it runs before the solver even sees the grid).
          </p>
          <p className={result.reconciliation.passes ? 'stat-value' : 'stat-value stat-negative'}>
            {result.reconciliation.passes ? 'Passes' : 'FAILING'} — gap {(result.reconciliation.gapPct * 100).toFixed(6)}%
            ({result.reconciliation.annualFromGrid.toFixed(1)} vs. {result.reconciliation.annualBudget.toFixed(1)} target hours)
          </p>

          {/* §7 pre-bed-request census validation (optional, 2026-07-27) — the first
              correctness check the ARRIVALS half of the engine has ever had. Small on purpose:
              a diagnostic here only, no solver interaction, no change to any recommendation. */}
          {preBedValidation && (
            <>
              <h3>Pre-bed-request census validation</h3>
              <p>
                You provided an observed non-boarding ED occupancy census. Compared against what
                the arrivals -&gt; requirement translation implies (nurse-hours divided back down
                by your wHPPV target, a rough visit-equivalent proxy — not an exact occupancy
                model): mean observed <strong>{preBedValidation.meanObserved.toFixed(1)}</strong>{' '}
                vs. mean implied <strong>{preBedValidation.meanImplied.toFixed(1)}</strong>,
                shape correlation <strong>{preBedValidation.correlation.toFixed(2)}</strong>{' '}
                (1.0 = perfectly track each other hour to hour, 0 = unrelated).
              </p>
            </>
          )}

          {/* 6. Decisions and rejected alternatives */}
          <h3>Decisions and rejected alternatives</h3>
          <ul>
            {censusSource !== 'measured' && (
              <li><strong>Mean, not median, for boarding duration.</strong> Duration multiplies directly into total boarding hours — a ratio of means correctly rescales that product term; a ratio of medians would not (the median of a product isn't the product of medians).</li>
            )}
            <li><strong>p75 (busy-hour) arrivals never enter the point target.</strong> They only raise the protective floor and the trim's marginal cost at volatile hours — folding p75 into the point target itself would silently inflate the annual total-hours figure and break the reconciliation check above.</li>
            <li><strong>Queue cost is normalized by requirement, not raw nurse-hours.</strong> Two nurses short at an hour needing ten is a bad hour; two short at an hour needing three is a crisis — raw nurse-hours can't tell the difference, which is exactly why an earlier, linear version of this objective was willing to flatten real peaks.</li>
            <li><strong>No dollar layer, anywhere.</strong> No salary, benefit-factor, or per-visit-margin inputs are collected — a fabricated ROI is the first thing a finance partner attacks. Panel 4's benefit-per-shift framing names the three numbers a CFO already owns instead, in the tool's own units.</li>
            <li><strong>Arrivals and boarding are modeled as two separate demands, additively.</strong> A reader who doesn't know this sees the tool cutting their nights and concludes it doesn't understand their department. The two are added back together only for the reader, in the synthesis chapter — never inside the solved grid itself.</li>
            <li><strong>ESI 3 as the unbiased anchor for auto-normalization.</strong> An inference from one department's data (its dashboard's zero-day-dropping artifact hit sparse ESI 1-2/4-5 hardest, ESI 3 least) — not a proven universal. If a different bias pattern shows up elsewhere, this should be revisited before hard-coding it further.</li>
          </ul>
        </div>
      )}
    </section>
  );
}
