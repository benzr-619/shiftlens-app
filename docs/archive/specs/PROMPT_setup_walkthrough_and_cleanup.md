# Claude Code prompt — guided setup walkthrough, data export, cleanup, and results copy

Paste this whole file as the opening prompt of a fresh Claude Code session.

Seven parts. Do them in order — Part 1 removes things later parts would otherwise build on
top of. Parts 5, 6 and 7 are independent of 2–4 and can be done in any order among
themselves, but do them in this pass.

---

## Read first

- `CLAUDE.md` (especially Section 6's rules and the Screen Map)
- `.claude/rules/template-parsing.md` — the one-consolidated-template rule and its history
- `.claude/rules/boarding-seasonality.md` — the boarding area of record
- `SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md` — **this file is STALE in two specific
  ways described in Part 1. Correct it as part of this work.**

There is uncommitted work in the tree from a prior session (the boarding-census measured
path). Most of it is correct and stays. Part 1 removes the parts that were a mistake.

---

## Part 1 — Deletions (do these first)

### 1.1 Remove the Settings tab from the upload entirely

A prior session added a `Settings` tab to the consolidated template carrying wHPPV target,
boarding ratios, ENA floor, and clock start. **This was wrong and must come out.** It
violates the existing documented rule that policy choices are UI fields, not template data
— `boardingRatioTarget` was deliberately kept as "the one typed field that stays, since
it's a policy choice, not data to pull" (`CLAUDE.md` Screen Map, Step 1).

Remove from `src/lib/parseUpload.ts`: `SETTINGS_HEADER_ALIASES`, `SETTINGS_FIELD_ALIASES`,
the `SettingsField` type, `looksLikeSettingsSheet`, and its branch in `parseXlsxFile`'s
dispatch. Remove the Settings sheet from `src/lib/template.ts`. Remove any parsed-settings
plumbing in `src/screens/setup/applyParsedUpload.ts` and the store.

The rule going forward, state it in `template-parsing.md`: **the uploaded file carries
data. Policy values are set in the UI.**

### 1.2 Delete `boardingCensusClockStart` everywhere

The prior spec had the tool accept an arrival-clocked boarding census and render a caveat
saying the number was overstated. **That is not an acceptable resolution.** An
arrival-clocked census includes pre-bed-request workup the arrivals grid already staffs,
overstating boarding by roughly a third (measured: 19.8 vs 14.6 mean census at a real
department), and it feeds the synthesis chapter, which is the tool's headline answer. A
warning beside a wrong number does not fix the number. The gap also cannot be corrected by
a factor — measured hour by hour it runs 0.66 at 16:00 to 0.88 at 06:00.

Delete the field from `EngineInputs`, `DEFAULTS`, `constantsMetadata.ts`, `types.ts`,
`boarding.ts`, `index.ts`, the parser, and any tests referencing it.

**Replace it with precision in the ask.** The census instructions must say exactly:

> Patients physically in the ED who have a **bed request placed** and **no inpatient bed
> assigned**, counted at each hour.

If a department's report cannot produce that, they answer **No** at the boarding fork
(Part 2.3) and use admit rate + mean boarding duration. Two clean paths, no hybrid.

### 1.3 Flag both as reversals

Both reverse decisions a prior session recorded. Note them in the commit body and in the
relevant `.claude/rules/` files, per the AUTOMATIC MAINTENANCE rule.

---

## Part 2 — The guided setup walkthrough

**The problem:** a nurse manager currently faces a multi-tab spreadsheet and has to work
out for themselves what goes where and what's optional. Setup should teach them, one data
item at a time.

### 2.1 New entry fork — the first thing in setup

Before any data entry, three cards. Store as
`setupMode: 'tutorial' | 'colleague' | 'returning' | null`.

**A. "I'll pull the data myself"** → the tutorial walkthrough (2.2). Once inside, there is
no "ask a colleague" escape hatch — it is a linear guided flow.

**B. "Someone else pulls our data for us"** → one consolidated data-request page: the
plain-language summary of every pull with its exact definition, plus a download of the
blank template. Built to be copied into an email or printed. This expands the existing
"copy this for your data team" block in `DataStep.tsx`; it is not a new idea.

**C. "I have a ShiftLens file from a previous session"** → upload, then jump straight to
the review step. This is the fast path Part 3 creates.

### 2.2 The tutorial walkthrough

One data item per screen, with a progress indicator ("Step 3 of 6"). Each screen has the
same four parts:

1. **What this is** — one plain sentence, no jargon.
2. **What to pull** — the exact definition to type into a dashboard or hand to an analyst.
3. **Enter it** — upload that item's tab, or type into the grid. Both always available.
4. **Skip** — on every optional item, with one line naming what gets lost.

Required items cannot be skipped.

| # | Item | Required? | "What to pull" |
|---|---|---|---|
| 1 | Arrivals | **Required** | Average number of patients arriving in each hour of the week, over the last 12 months. |
| 2 | Current staffing | Recommended | Your actual nurse headcount for each shift, each day. Not a report — your own schedule. Skipping means no comparison against your current schedule and no answer to "could moving hours fix this." |
| 3 | Busy-hour arrivals | Optional | The 75th-percentile arrivals for each hour — the same report as step 1 with the percentile setting changed. Skipping means the tool plans to the average hour and can't protect genuinely volatile hours. |
| 4 | Boarding | Optional, **forked** | See 2.3. |
| 5 | Boarding seasonality | Optional | The same boarding report, grouped by month. Skipping means the tool treats every month alike. |
| 6 | Acuity (ESI) mix | Optional | Average arrivals per hour split into ESI 1-2, ESI 3, and ESI 4-5, over the same period as step 1. Skipping means all patients are weighted equally. |

### 2.3 The boarding fork — one question, asked once

Step 4 opens with a single question before showing any input:

> **Can you get a boarding census report from bed management?**

- **Yes** → the Boarding Census grid, using the exact definition from 1.2. Then ask
  separately whether they track behavioral-health boarding separately; if yes, show the BH
  column, noting BH boarders are staffed at a very different ratio.
- **No** → two number fields: admit rate, and mean boarding duration in hours. Note these
  are the standard ED metrics, and that the census route is more accurate if they can get
  it later.
- **Skip** → no boarding analysis; say plainly this hides roughly half the department's
  demand.

The user must never see both the census grid and the admit-rate fields at once.

### 2.4 Policy values stay in the UI

After the walkthrough, existing steps continue: volume / wHPPV target, shift menu, review.
Add a **settings card** with boarding ratio (default 4) and BH boarding ratio (default 10,
noted as "classic range 10–12 — far less licensed RN care than med/surg"). Move
`boardingRatioTarget` out of `DataStep` into this card.

---

## Part 3 — Export your data (the round-trip)

On the review step, before continuing to results: **"Download my data file."** Generates
the same consolidated template, filled with everything entered, so next time the user picks
entry option C and reaches results in under a minute. This is also the app's only form of
persistence.

**Hard requirement: the export must round-trip through `parseXlsxFile` unchanged.** Write a
test that builds inputs, exports, re-parses, and asserts equality with the original. That
round-trip is the entire value of the feature.

**Data only, no policy values** — same rule as 1.1. On re-upload the user still passes the
wHPPV target and settings card (three fields, all defaulted). Do not add a settings sheet
to speed this up; that is exactly the mistake 1.1 removes.

Reuse `lib/template.ts`'s generation. Do not write a second exporter.

---

## Part 4 — Finish the boarding census path

Largely built already in `engine/boarding.ts`. Confirm complete and correct, finish what's
missing:

- `cellBoardingRnHours[i] = censusMedical[i] / boardingRatioTarget + (censusBH[i] ?? 0) / bhBoardingRatioTarget`
- Precedence: census present ⇒ `admitRate` / `boardingDuration` unused entirely. Assert it.
- `monthFactors` combines the two streams **weighted by RN hours**, not averaged — the
  streams have genuinely different seasonality (at a real department, medical peaks in
  January, BH in April).
- `BoardingResult` exposes `medicalWeeklyRnHours`, `bhWeeklyRnHours`, `censusSource`.
- `lib/inputIntegrity.ts` banners fire **only** on the derived path.

---

## Part 5 — ESI mix normalization

Real dashboard pulls can produce an ESI mix that does not sum to arrivals. A real
department's summed to **126%**, because the dashboard averaged only over days with a
non-zero count and dropped zero-days — the minimum value was exactly 1.00 across many
cells, which is impossible for a true hourly mean of a sparse count. It hits sparse
categories (ESI 1-2, ESI 4-5) hardest and ESI 3 least.

**New `normalizeEsiMix(arrivals, esiMix)` in `engine/allocate.ts`**, applied before acuity
weighting. Per cell: preserve ESI 3, scale ESI 1-2 and ESI 4-5 proportionally so the three
sum to arrivals. If ESI 3 alone meets or exceeds arrivals in a cell, fall back to
proportional scaling of all three **for that cell only** (did not occur in 168/168 cells of
the real dataset, but must be handled).

On the real dataset this moves 21.3 / 54.5 / 24.2 → **14.5 / 68.8 / 16.7**.

**This is the one sanctioned auto-correction in the app.** An un-normalized mix is
arithmetically impossible, not merely suspicious — that is what separates it from
`inputIntegrity.ts`'s diagnostic-only convention. Record that distinction in the rules file
so it isn't read as license to auto-correct anything else.

It must **disclose**: return an adjustment summary (total percentage adjustment, cells
touched), surface it both at the walkthrough's ESI step and on the results page, and state
the assumption — ESI 3 treated as least biased — plainly. Note honestly that the true
answer sits between this and proportional scaling, since ESI 3 is likely slightly biased
too.

---

## Part 6 — Results-page copy

### 6.1 BH boarding callout — required, not optional framing

Wherever BH boarding is reported, this must appear in substance:

> These figures describe **RN care only**. Behavioral-health boarding places a
> disproportionate burden on techs, sitters, and security, and the operational cost of
> maintaining patient and staff safety for these patients is **understated** by any
> RN-staffing view — including this one.

A 1:10 ratio correctly reflects that BH boarders draw less licensed RN time than med/surg
boarders. Reporting that number without this caveat invites exactly the wrong conclusion —
that BH boarding is cheap. Surface the medical/BH split (now on `BoardingResult`) in the
boarding chapter alongside it.

### 6.2 Evidence surface (`EvidenceSurfaceSection.tsx`)

- Data provenance moves boarding from "modeled assumption" to "your data" when
  `censusSource === 'measured'`.
- Three known-approximation entries (derived boarding census, mean-not-median duration,
  month-scope duration conflation) become **conditional on the derived path**.
- Add the bed-request definition to provenance — it is the one thing that makes a
  department's boarding number comparable to a peer's.
- Add the ESI normalization from Part 5, with its assumption stated.

### 6.3 Boarding methodology explainer (`BoardingCoverageSection.tsx`)

PR K rewrote this from apology to shopping list. On the measured path most of that shopping
list is now **satisfied** — rewrite again to say so. Keep the shopping-list framing only
for what genuinely remains derived: linear recovery, and month-scope conservation.

---

## Part 7 — Pre-bed-request census diagnostic

When `preBedRequestCensus` is supplied, compare observed non-boarding ED occupancy against
what the tool's own arrivals → `hourlyRequirement` translation implies. This is the first
correctness check the arrivals half of the engine has ever had.

Keep it deliberately small: a diagnostic on the evidence surface only. No solver
interaction, no change to any recommendation, no new headline. Expect few departments to
supply it.

---

## Constraints

- `reconcile.test.ts` must pass with a **zero-line diff**. Nothing here touches
  `annualVisits`, `annualCoreRnHoursBudget`, or `hourlyRequirement`.
- No ED-specific data as a seeded default anywhere. Ratio defaults (4, 10) are policy
  conventions, not one department's data — same category as the existing wHPPV cohort
  pre-fill.
- Every optional input must still degrade gracefully to exactly today's behavior.
- `npm run build`, `npm test`, `oxlint` clean before you finish.

## Tests

- Export → re-import round-trip equality (Part 3).
- No generated template contains a Settings sheet; no settings values are parsed.
- Measured-path conservation: `sum(cellBoardingRnHours) === sum(census)/ratio` exactly.
- Two-stream ratios: medical 1:4 and BH 1:10 combine correctly.
- Weighted `monthFactors`: two streams with opposing seasonality produce a combined factor
  between them, weighted toward the higher-RN-hour stream.
- Integrity banners do not fire on the measured path.
- `normalizeEsiMix`: sums to arrivals per cell; ESI 3 preserved; the
  ESI-3-exceeds-arrivals fallback fires correctly; the disclosure summary is accurate.
- Skipping every optional walkthrough item produces the same result as today's
  arrivals-only flow.
- Extend `syntheticDepartment.ts` with a measured-census generation mode and add a named
  profile to `namedDepartments.ts`, so the sweep covers both boarding paths.

## Documentation

Update `CLAUDE.md` (Screen Map, Feature Status, Section 6), `template-parsing.md` (the
data-vs-policy rule, the census tab, the export round-trip), `boarding-seasonality.md` (the
measured path, weighted month factors), `results-redesign.md` (Part 6's copy changes), and
correct `SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md` — its §2.1 Settings tab and §3.3
clock-start sections are now wrong.

## Still out of scope (unchanged project-level decisions, not deferrals from this pass)

Dollar/ROI cost layer · arrivals seasonality · Monte Carlo variability · any backend, auth,
or multi-user feature · any change to the solver, backlog model, or shift-fit trim.
