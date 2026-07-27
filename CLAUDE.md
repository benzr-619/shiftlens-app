# CLAUDE.md — ShiftLens

Source of truth: describes **how the code works now**. Read before touching any code.
The algorithm itself is separately specified in `../ShiftLens_Algorithm_Specification_v3.docx`
(one level up, outside this repo folder) — that document is authoritative for every
formula, threshold, and evidence-status tag. This file describes how that spec was
translated into code; it does not re-derive the math.

## [AUTOMATIC MAINTENANCE]

New area-specific detail is appended directly to a targeted `.claude/rules/<area>.md` with
a one-line pointer here — no rewrite of this file. Changing behavior already documented
here requires confirmation first.

**After every session where a bug was fixed, a spec-to-code mapping was clarified, or a
gotcha was identified: update the relevant `.claude/rules/<area>.md` file immediately —
do not wait to be asked.** If no rules file fits, create a new one under `.claude/rules/`.
This is mandatory, not optional.

Current rules files:
- `.claude/rules/engine-solver.md` — Step 3 solver internals: full-coverage greedy search,
  budget-trim (now a joint whole-week BACKLOG-minimizing trim, 2026-07-26 — five reversals of
  this one area's history, read the "Budget-capped trim" section in full before touching it —
  PR B's asymmetric abandon/recovery/drain-cap backlog model is the latest), department ENA
  floor pass, live-edit recompute, shift wraparound model (GLOBAL-WEEK circular as of PR A,
  2026-07-26 — read that section before touching shift-hour attribution), Phase 2a's
  arrivals-volatility floor buffer, Phase 2b's iterative backlog-feedback relaxation loop
- `.claude/rules/template-parsing.md` — the ONE consolidated multi-tab data template:
  per-tab alias tables, day/hour/month tolerance, all-or-nothing optional-field rule,
  no-seeded-data constraint, and the history of admit-rate/boarding-duration moving
  template→scalar→template again (read this before "fixing" that back a third time).
  **2026-07-27: gained a Boarding Census tab (the measured boarding path) + the guided setup
  walkthrough (`SetupEntryFork`/`TutorialFlow`/`ColleagueRequestPage`, replacing the deleted
  `DataStep.tsx`) + the data-export round-trip — and a Settings tab / boarding-census
  clock-start setting were both built, then REVERTED same session** — read those sections
  before reintroducing either.
- `.claude/rules/boarding-seasonality.md` — boarding hourly-census convolution (ASSUMPTION),
  the seasonality-index formula (mean-per-patient ratio against the Scalars-tab
  boardingDuration baseline), the priority-ranked (month?, day, shift) slot list, and the
  boarding coverage grid built from it. **FOURTH reversal 2026-07-24: single representative-
  week grid + month-SCOPE toggles (§2.6)** — read the last section there before touching it
  again; the removed `deriveBoardingCoverageCells`/`restrictPrioritySlotsToActivePeriods`/
  `boardingHoursCoveredByGrid`/`fundedCountToReachWhppv` are gone for a reason, don't resurrect.
  **2026-07-27 (LAST section): a MEASURED boarding census path, a new PRIMARY input alongside
  (not replacing) the derived path** — `computeBoarding` uses a directly measured census
  exclusively when present, RN-hour-weighted two-stream (medical/BH) seasonality, no
  arrival-clocked variant/clock-start setting (read why before adding one back)
- `.claude/rules/results-redesign.md` — the 2026-07-24/25 Results-page & setup redesign
  (spec `RESULTS_PAGE_REDESIGN_SPEC_2026-07-24.md`): per-section build notes for §1/§2.1/§2.2/
  §2.3/§2.4/§2.5/§2.6/§3, the resolved §5 judgment calls (backlog decay 0.85, heatmap p25-flag
  supersession), the shift-menu flexibility solver reversal, the shared `CurrentStaffingGrid`
  component + Section-1 setup grid, a STALE-DOC warning that this file's Screen Map/Feature
  Status boarding description lags the code by one revision (read boarding-seasonality.md for
  the section's current shape), the 2026-07-25 heatmap legibility rework (spec
  `HEATMAP_LEGIBILITY_SPEC_2026-07-25.md`): band-neutral asymmetric color scale, the backlog
  vertical-spine overlay, shift-boundary heatmap rules, and the Mon-Sun display-order
  convention (`lib/dayOrder.ts`), and — its LAST section — 2026-07-26 PR D
  (`SOLVER_REALISM_SPEC_2026-07-26.md`): the funding-ask surface (`FundingAskSection.tsx`,
  `EngineResult.fullCoverage`/`marginalCurve`/`marginalKneePoint`), the heatmap's SECOND color-
  mechanism reversal (per-hour band drives both cell number and color now, see Section 6), and
  a pass of results-page copy fixes (front-loaded-nursing premise, backlog-headline WHEN,
  comparison-unit consequence clause, "Hours below the peer 25th-percentile staffing floor"
  relabel) — read the relevant section before touching the heatmap, the funding-ask surface,
  or any of that copy again
- `.claude/rules/synthetic-fixtures.md` — PR E0 (`RESULTS_COMPREHENSION_SPEC_2026-07-26.md`
  §12.5): the parametric synthetic-department generator, the 245-case invariant sweep, the
  seven named §12.2 department-profile fixtures, and the (currently inert, PR-H-gated)
  `narrative.ts` sign-assuming-copy hook — read this before touching anything under
  `src/lib/__fixtures__/` or the two `synthetic*.test.ts` files

---

## Workflow note (how Ben uses this repo)

Complicated features/changes get planned in Cowork first; that planning conversation
produces a prompt that gets brought into a fresh Claude Code session to implement. Smaller
fixes are prompted directly in Claude Code without a separate planning pass. **This file
exists so a cold Claude Code session — one that never saw the planning conversation — has
enough context to implement correctly without re-deriving the engine's math or re-litigating
already-settled UI decisions.**

---

## 0. Repo Hygiene

- `.gitignore` should cover `node_modules/`, `dist/`, `.env*` if any secrets are ever added
  — currently **no backend, no env vars, no secrets**. Everything runs client-side.
- No git repo has been initialized yet in this folder as of the initial build (2026-07-12).
  Confirm before assuming git history exists.
- `npm run build` (tsc -b + vite build), `npm test` (vitest run), `npm run dev` (localhost),
  `npm run test:e2e` (Playwright, chromium — PR A0, `RESULTS_PAGE_V2_SPEC_2026-07-27.md` §8.1,
  see Section 2 below and `.claude/rules/synthetic-fixtures.md`'s Playwright section).
- Run `npm test` after any change to `src/engine/` — the reconciliation tests
  (`src/engine/__tests__/reconcile.test.ts`) are the build-in sanity check the spec calls
  out (Section 2.2): summing the 168-cell grid across a year must reproduce
  `annual_core_rn_hours_budget` **exactly**. A failing reconciliation test means a real bug
  in the allocation/smoothing math, not a tolerance issue — don't loosen the assertion.
- **Known dependency trade-off:** `xlsx` (SheetJS) carries an unfixed high-severity
  advisory (prototype pollution / ReDoS in formula parsing, no upstream fix). Accepted
  because the app is client-only, no server ever touches an uploaded file, and only plain
  data cells are read (no formula evaluation). If this changes — e.g. a backend gets added
  — re-evaluate before reusing this parsing path server-side.

---

## 1. App Overview

ED RN staffing calculator for community EDs. A manager enters (or uploads) their ED's
arrivals data, a wHPPV target, and their actual shift menu; the app computes an idealized
day × shift-slot staffing grid, honestly reports where it falls short of demand even when
the aggregate number looks fine, and separately reports a boarding coverage recommendation
— an hourly boarding-census curve (derived, not measured — see
`.claude/rules/boarding-seasonality.md`), optionally scaled by month/day-of-week
seasonality, run through the same shift-fit solver as the core grid so it comes back
expressed in the actual shift menu. Boarding coverage stays additive/separate from the core
grid (never blended into one combined headcount) — this is a 2026-07-13 reversal of the
original "boarding is never a shift grid" decision, confirmed with Ben. No login, no
multi-user, no persistence beyond the current browser session — every calculation re-runs
from the current in-memory inputs.

**Hard constraint carried through the whole app: no ED-specific data may ever appear as a
seeded default.** The one sanctioned exception is the EDBA-cohort wHPPV pre-fill
(`src/lib/edbaLookup.ts`) — a small aggregate lookup table across many EDs, not one
specific ED's data, always framed as "what similar EDs run at" and always user-editable.

---

## 2. Tech Stack

- **Vite + React + TypeScript.** No backend, no database, no auth — everything computes
  client-side, instantly, on every input change.
- **zustand** (`src/store.ts`) — single flat store, no slices/middleware. All engine inputs
  and the current screen/tab selection live here.
- **papaparse** (CSV) + **xlsx/SheetJS** (Excel) for template generation and tolerant
  upload parsing — see `.claude/rules/template-parsing.md`.
- **pptxgenjs** (2026-07-26 PR L) — client-side PPTX export (`lib/pptxExport.ts`), loaded via
  dynamic `import()` so it stays out of the main bundle until a user clicks "Export."
- **vitest** for engine/parser tests (config: `vitest.config.ts`, excludes `e2e/**` so the two
  suites stay separate). **`@playwright/test`** (2026-07-27, PR A0) for browser-level results-
  page verification — chromium only, desktop viewport, `playwright.config.ts`, `npm run
  test:e2e`; seeds a `NAMED_DEPARTMENT_PARAMS` profile via a dev-only `window.__shiftlensSeed`
  hook (`src/lib/testSeed.ts`, wired from `main.tsx` behind `import.meta.env.DEV` so it's
  compiled out of production) rather than hand-building departments in a `.spec.ts` file. See
  `.claude/rules/synthetic-fixtures.md`'s Playwright section. No component-level (React
  Testing Library-style) unit test framework wired up — browser-level e2e now fills that gap
  for anything visual.
- No CSS framework — hand-written `src/App.css` + `src/index.css`, theme-aware via
  `prefers-color-scheme`. No design tokens system; colors are literal hex values scoped to
  those two files.

---

## 3. Screen Map

| Screen | Component | Purpose |
|---|---|---|
| Welcome | `src/screens/WelcomeScreen.tsx` | App entry point — brief description + "Start Setup" button. No previous-results navigation (no persistence yet, see Section 8). |
| Setup | `src/screens/SetupScreen.tsx` | Thin 4-step wizard shell (was 5, see Section 8 2026-07-14 entry) — step indicator, Back/Next, per-step gating — renders one of the `src/screens/setup/` step components below. **2026-07-27: Step 1 is no longer `DataStep.tsx` (deleted)** — see the row below and `.claude/rules/template-parsing.md`'s "Guided setup walkthrough" section |
| — Step 1 | `src/screens/setup/SetupEntryFork.tsx` → `TutorialFlow.tsx` / `ColleagueRequestPage.tsx` | **2026-07-27, replaces the deleted `DataStep.tsx`.** Setup opens on a 3-card entry fork (`setupMode: 'tutorial' \| 'colleague' \| 'returning'`) before Step 0 renders anything. `'tutorial'` → `TutorialFlow.tsx`, a one-item-per-screen guided sub-wizard (own progress/Back/Next/Skip, occupies the outer Step 0 slot) covering arrivals/current staffing/P75/boarding (forked via `BoardingFork.tsx`)/boarding seasonality/ESI mix. `'colleague'` → `ColleagueRequestPage.tsx` (the expanded data-request-for-your-team page). `'returning'` → handled inside the fork itself: upload a previously-exported file, jump straight to Review. See `.claude/rules/template-parsing.md` |
| — Step 2 | `src/screens/setup/VolumeStep.tsx` | Annual volume override, wHPPV target pre-fill. No volume-band table anymore (removed 2026-07-14) — a single inline IQR sentence instead, framed generically ("similar-volume benchmark"), no "EDBA" branding anywhere in the UI |
| — Step 3 | `src/screens/setup/ShiftMenuStep.tsx` | `ShiftMenuEditor` wrapper (unchanged) |
| — Step 4 | `src/screens/setup/ReviewStep.tsx` | Summary of every input with per-field Edit links back to the owning step (admit rate/boarding duration/ESI mix/boarding seasonality all link back to Step 1 now); final `canContinue` gate lives in `SetupScreen.tsx`. **2026-07-27:** rows for boarding census (medical/BH)/ratios, and a "Download my data file" export button (`lib/template.ts`'s `downloadFilledConsolidatedTemplateXlsx` — data only, no policy values) — the app's only persistence, see `.claude/rules/template-parsing.md` |
| Results dashboard | `src/screens/DashboardScreen.tsx` | **Not a tab container** (since 2026-07-13) — a single scrolling page. Top to bottom: `.dashboard-topbar` ("← Back to setup" top-left + "Export to PPTX" top-right — no page `<h1>` anymore, see below), then the full-width **`.results-welcome`** section ("Your ShiftLens Results," with the `/favicon.svg` mark next to the heading — moved here from inside `CoreGridTab` 2026-07-27 — see `.claude/rules/results-redesign.md`'s PR H section), then `.dashboard-body`'s sticky **chapter rail** (2026-07-26 PR H, `ChapterRail.tsx`) alongside `.dashboard-content`. Chapter order: `CoreGridTab` → `ScenarioBSection` → `FundingAskSection` → `FinancePartnerWorksheet` → `ShiftMenuFlexibilitySection` → `HiddenBoardingSection` → `BoardingTransition` → `BoardingCoverageSection` → `SynthesisSection`, each wrapped in an `id`-carrying div the rail's 6 chapter entries target (see Section 4's Module Map note on why 6, not the spec's 9) |
| — Core grid section | `src/screens/dashboard/CoreGridTab.tsx` | **No longer opens with the welcome/orientation section** — `.results-welcome` (2026-07-26 PR H spec §6.1, rewritten FOUR times, see `.claude/rules/results-redesign.md`'s PR H section) moved OUT of this component and up into `DashboardScreen.tsx` (2026-07-27, see the Screen Map row above), so it renders full-width above the chapter rail rather than confined to this component's column. `CoreGridTab` now opens directly with `CurrentStaffingAnalysis` (§2.1) when current staffing exists; then the §2.2 **comparison unit** (idealized grid + current grid + diff, collapsed into one card, with the size-gap-vs-shape-gap reconciliation [renamed from "budget gap," PR F §3] — PR D added a severity-reduction consequence clause to its headline); then the coverage-summary (wHPPV/overcoverage [PR F: vs. CURRENT staffed hours now, suppressed with no current staffing]/"Hours below the peer 25th-percentile staffing floor" [renamed from "typical staffing range," PR D]/"Effective ED wHPPV") unit + the wHPPV heatmap. The heatmap carries the §2.4 **backlog overlay** (a left-edge vertical spine, weight scaled by magnitude — 2026-07-25, replaced the earlier amber corner-dot/bottom-bar) and the ENA-floor flag; the old single-hour p25 red-outline was superseded. **2026-07-26 PR D: the heatmap's own cell number/color mechanism reversed again — see Section 6.** The "what this schedule means" panel's realized-wHPPV range now spans the 168 hours (PR H), not 7 days, and names the hour each extreme falls on |
| — Opening analysis | `src/screens/dashboard/CurrentStaffingAnalysis.tsx` | §2.1 — templated headline (realized wHPPV vs. band), backlog "longest lean stretch" (§2.4, current grid — 2026-07-26 PR D: now names WHEN it starts/peaks, not just how long), effective-wHPPV-after-boarding + FTE-to-cover preview; CTA opener when no current staffing entered. Rendered at the top of `CoreGridTab` |
| — Scenario B | `src/screens/dashboard/ScenarioBSection.tsx` | (2026-07-26 PR F, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §5) "Could moving hours fix it?" — `engine/index.ts`'s `computeScenarioB` (parameter swap: same pipeline, budget = current grid's own hours). Every render states the arrivals-only bound loudly. Three templated branches: full-coverage, near-optimal, general. CTA when no current staffing |
| — Funding ask | `src/screens/dashboard/FundingAskSection.tsx` | (2026-07-26 PR D, change 3; **REFRAMED PR G** §7) "What this schedule costs you, and what closing the gap buys" — `EngineResult.fullCoverage` + `marginalCurve`/`marginalKneePoint` as a templated headline + inline SVG chart. **PR G: headline now LEADS with the marginal-curve KNEE (the ask that buys the most per FTE), full coverage stated as "the far end of that range"** — reverses the old full-coverage-first order, which buried the knee as an afterthought. Falls back to the old order when there's no meaningful knee. Explicit "already funds full coverage" branch when `fteDelta <= 0`. See `.claude/rules/results-redesign.md`'s PR D/PR G sections |
| — Finance-partner worksheet | `src/screens/dashboard/FinancePartnerWorksheet.tsx` | (2026-07-26 PR G §7) "Do the extra hours pay for themselves?" — the mechanism chain in the tool's own units, an explicit no-dollars statement, and a worksheet naming the FTE ask + modeled abandoned-hours reduction + the three numbers (cost/FTE, contribution margin/visit, LWBS rate) to hand a CFO. Never computes a dollar figure itself. Renders null with no funding gap or no meaningful knee |
| — Shift-menu flexibility | `src/screens/dashboard/ShiftMenuFlexibilitySection.tsx` | §2.3 — opt-in flexibility axes (shared `FlexAxesToggles`), the best bounded solver candidate side-by-side (advisory, never auto-adopted — 2026-07-26 PR D: now names WHICH hours it fixes/costs, plus a 12h→8h retention caveat), and a manual alternate-menu path (absorbed the deleted `CompareTab`). See `.claude/rules/engine-solver.md` last section |
| — Hidden-boarding diagnostic | `src/screens/dashboard/HiddenBoardingSection.tsx` | (2026-07-26 PR F §6.2) "the advocacy artifact" — `engine/hiddenBoarding.ts`'s day/night capacity-vs-arrivals-alone diagnostic + boarding need. Degrades to a PROMPT (not null) when boarding data is absent — see `.claude/rules/results-redesign.md`'s PR F section |
| — Boarding transition | `src/screens/dashboard/BoardingTransition.tsx` | §2.5 — short narrative bridge (no grid): effective wHPPV after boarding for both current & idealized, + FTE to fully cover. Renders null when boarding wasn't computed |
| — Boarding coverage section | `src/screens/dashboard/BoardingCoverageSection.tsx` | §2.6 (**fourth reversal**, 2026-07-24 — see `.claude/rules/boarding-seasonality.md` last section): ONE editable representative-week day × shift grid (small `+N`), default funded to the p25 band, **month-SCOPE toggles only** (no day toggle — zero a day by editing the cell), templated headline, live coverage %/FTE/effective-wHPPV — additive/separate from the core grid. **2026-07-26 PR K §10.4: "how is this calculated" REWRITTEN from apology to shopping list** — each derivation paragraph now names the better data that would replace it |
| — Constrained reallocation | `src/screens/dashboard/ConstrainedReallocationSection.tsx` | (2026-07-26 PR K §6.3) "If you can't get additional hours for boarding" — `engine/synthesis.ts`'s `computeCombinedReallocation` (shared with the synthesis chapter): same hours, reallocated against COMBINED arrivals+boarding demand. A named-cost COMPROMISE, never the recommendation — states the real cost on the arrivals side every render. Renders null without both current staffing and boarding data |
| — Synthesis | `src/screens/dashboard/SynthesisSection.tsx` | (2026-07-26 PR G §7) "Both budgets together" — THE ANSWER to the founding question. `engine/synthesis.ts`'s `computeSynthesis`: four numbers + a subtraction, then STOPS (spec §1(5) — no interpretive closing sentence). `gapHours` can be `<= 0`, a real ending. CTA when no current staffing |
| — Evidence surface | `src/screens/dashboard/EvidenceSurfaceSection.tsx` | (2026-07-26 PR I §8, Chapter 9) "How this works" — a branch off the main chapter arc, visually set apart (`.evidence-surface`), collapsed by default. Pipeline walkthrough, the `constantsMetadata.ts`-generated constants table, data provenance, known approximations, the reconciliation invariant as a live correctness proof, and decisions/rejected alternatives |

Navigation is a single `screen: 'welcome' | 'setup' | 'dashboard'` field in the store
(`App.tsx` switches on it, default `'welcome'`) — no router. `setupStep: number` (0-3) in
the store tracks wizard position; `setSetupStep` clamps to `[0, 3]`. The dashboard has no
tab/section navigation state at all — `DashboardScreen` renders its sections in a fixed
order (core grid → shift-menu flexibility → boarding transition → boarding coverage) on one
scroll.

---

## 4. Module Map

```
src/
  engine/
    types.ts       — all engine types + DEFAULTS (policy parameters, evidence-tagged in spec)
    allocate.ts     — Steps 1, 1b, 1c: weighted arrivals, cell-share allocation, day-of-week smoothing
    boarding.ts     — Step 2: hourly boarding-census curve (convolution, ASSUMPTION), a
                      seasonality index (mean-per-patient ratio against the boardingDuration
                      baseline), the priority-ranked (month?, day, shift) slot list, and the
                      §2.6 single-representative-week coverage helpers (`weeklyBoardingDemandByCell`,
                      `weeklyBoardingCoveredByGrid`, `annualBoardingCoveredByWeeklyGrid`,
                      `recommendWeeklyBoardingGrid`, `boardingCoverageFte`,
                      `effectiveEdWhppvAtCoverage` — ASSUMPTION) — see
                      .claude/rules/boarding-seasonality.md last section (withheld entirely if
                      admit rate/duration absent). No solved staffing grid for boarding — Section 6.
    backlog.ts      — §2.4 backlog/"falling behind" diagnostic (`computeBacklog`, ASSUMPTION,
                      circular no-reset). This specific function is diagnostic-only — never
                      imported by the solver. **2026-07-26: the SAME recurrence MODEL now also
                      feeds the Step 3 budget trim** (a deliberate reversal, see
                      `.claude/rules/engine-solver.md`) — "backlog never feeds the solver" no
                      longer holds as a blanket rule, only for this one exported function's own
                      call graph. `BacklogResult` gained a `carriedIn` field (Phase 2b) —
                      per-hour inherited backlog, powers `backlogFeedback.ts`'s floor-raising
                      step. **2026-07-26 PR B (`SOLVER_REALISM_SPEC_2026-07-26.md`): the
                      recurrence itself moved to `engine/backlogModel.ts`** (a LEAF module, no
                      engine imports) — the old single-decay model (`backlogHourlyDecay = 0.85`,
                      retired) is replaced by three named processes (`backlogAbandonRate = 0.03`,
                      `backlogRecoveryEfficiency = 0.6`, `backlogMaxDrainFraction = 0.3`); the
                      hand-duplicated local copy in `solver.ts` is gone too, both files now
                      import the shared recurrence from `backlogModel.ts`. See
                      `.claude/rules/engine-solver.md`'s "Budget-capped trim" section for the
                      full history and physics rationale. **2026-07-26 PR C: new
                      `summarizeBacklogSeverity(grid, hourlyRequirement, shifts, params?)`** —
                      scores an already-solved grid on the same convex severity objective
                      `solver.ts`'s `candidateCutCost` minimizes (imports `totalSeverity`/
                      `peakSeverityOf` from `solver.ts`); powers `EngineResult.totalBacklogHours`
                      /`totalSeverity`/`peakSeverity` and flexMenu's candidate ranking.
                      **2026-07-26 PR E (`RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §4,
                      SEVENTH shape of the trim's history) — structural/cyclical split:**
                      `BacklogResult` gained `structuralFloorByDay`/`structuralFloorMin` (the
                      ACTUAL curve's per-day trough — a budget signal) and `cyclicalBacklog` +
                      its own streak/peak fields (the SAME recurrence against capacity RESCALED
                      to match requirement's own weekly total — isolates SHAPE from SIZE).
                      `summarizeBacklogSeverity`'s `totalSeverity`/`peakSeverity` now score the
                      CYCLICAL curve (a fixed-budget trim can only fix shape, never size, so its
                      cost signal must be blind to size); `totalBacklogHours` stays actual/raw.
                      New `estimatedAbandonedHours` on both `BacklogResult` and `EngineResult`
                      (nurse-hours the recurrence's own attrition term removes — never a dollar
                      figure). `BACKLOG_CAUGHT_UP_THRESHOLD` retired as a flat bar, replaced by
                      `caughtUpThresholdForHour`/`caughtUpThresholds168` (backlogModel.ts, ~10%
                      of an hour's own requirement, floored at the old absolute value) — see
                      `.claude/rules/engine-solver.md`'s PR E section for the full validation
                      gate and the (reported, not retuned) `maxDrainFraction` investigation.
    synthesis.ts    — (2026-07-26 PR G, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §7)
                      `computeSynthesis` — the founding-question answer. Adds arrivals demand
                      (`sum(hourlyRequirement)`) and boarding demand (`BoardingResult
                      .weeklyBoardingHours`) back together FOR THE READER ONLY (never
                      `EngineResult.grid`) and reports FOUR NUMBERS + a subtraction
                      (`gapHours`, can be `<= 0` — a real ending, not an error) plus
                      `dayShareOfShortfallPct`/`gapClosedByReallocationHours` (reusing
                      `computeScenarioB`'s parameter-swap technique against a COMBINED
                      arrivals+boarding demand curve). Powers
                      `screens/dashboard/SynthesisSection.tsx`, which renders exactly this
                      arithmetic and stops — no interpretive closing sentence (spec §1(5)).
                      See `.claude/rules/results-redesign.md`'s PR G section.
    hiddenBoarding.ts — (2026-07-26 PR F, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §6.2)
                      `computeHiddenBoardingDiagnostic` — "the advocacy artifact." Per
                      (day 07-19 / night 19-07, a FIXED calendar split, not shift-menu-derived)
                      block: current capacity minus ARRIVALS-ONLY requirement, plus boarding
                      need from `BoardingResult.cellBoardingRnHours` when present (null, not
                      zero, when absent). Diagnostic-only, no solver interaction. Powers
                      `screens/dashboard/HiddenBoardingSection.tsx` — see
                      `.claude/rules/results-redesign.md`'s PR F section.
    bandFloor.ts    — (2026-07-25) `computeBandFloorViolations` — diagnostic-only (same
                      convention as computeBacklog), counts hours below `EngineResult
                      .bandFloorHourly` + longest run + which shift. Powers CoreGridTab's
                      "Hours outside your typical staffing range" stat — see
                      .claude/rules/engine-solver.md's "Budget-capped trim" section. Unaffected
                      by the 2026-07-26 trim reversal below — a different question (how far
                      outside the band vs. how much backlog).
    demandBand.ts   — (2026-07-26, Phase 2a) `deriveCohortBandFloor` (the Phase 1 p25/p75-vs-
                      lookupWhppvBand derivation, extracted from compute()) +
                      `deriveDemandVolatilityHourly`/`applyVolatilityBuffer` (this ED's own
                      p75-vs-mean arrivals spread — two independent signals, kept as separate
                      composable functions on purpose). Never touches annualVisits/
                      annualCoreRnHoursBudget/hourlyRequirement. **2026-07-26 PR C
                      (`SOLVER_REALISM_SPEC_2026-07-26.md` change 4): `applyVolatilityBuffer`
                      is now UNCLAMPED** — its old ratio-clamp-at-1 (and output clamp at
                      `hourlyRequirement`) meant volatility could only ever redistribute the
                      budget, never justify exceeding the point target; now produces
                      `protectedFloorHourly` (solver-facing, can exceed `hourlyRequirement`),
                      with the CLAMPED `bandFloorHourly` (reporting-only) derived from it by
                      clamping in `compute()`. See .claude/rules/engine-solver.md's
                      "Budget-capped trim" section (Phase 2a and PR C).
    flexMenu.ts     — §2.3 shift-menu flexibility search (`searchFlexibleMenus`, bounded/opt-in/
                      advisory, reuses solveShiftFit) — REVERSES the old no-auto-search rule, see
                      .claude/rules/engine-solver.md last section. Takes `protectedFloorHourly`
                      (PR C — was `bandFloorHourly`) + `demandVolatilityHourly` params, threaded
                      straight to `solveShiftFit` — so it automatically inherits the joint
                      convex-severity trim AND the volatility-scaled cost (both live inside
                      `solveShiftFit` itself). **2026-07-26 PR C: candidates now ranked by
                      `totalSeverity` (the actual solver objective, via `backlog.ts`'s
                      `summarizeBacklogSeverity`), not `totalShortfall`** — the latter is kept
                      on `MenuCandidate` as a display-only field. It deliberately does NOT
                      inherit Phase 2b's relaxation loop (`solveShiftFitWithBacklogFeedback` is
                      a separate function `compute()` calls instead of `solveShiftFit` —
                      flexMenu still calls the plain one-shot version) — this was flagged as an
                      open question when Phase 2b shipped; **PR C (2026-07-26) resolved it
                      permanently: candidates AND the current-menu comparison
                      (`ShiftMenuFlexibilitySection.tsx`) both stay on one-shot `solveShiftFit`
                      for good** — see engine-solver.md.
    solver.ts       — Step 3 shift-fit solve (`solveShiftFit`) for the core grid only — see
                      .claude/rules/engine-solver.md. `solveBoardingCoverage` was removed
                      2026-07-14; boarding + flexMenu reuse `shiftGlobalHours`/`solveShiftFit`
                      (renamed from `shiftHoursOfDay` in PR A, 2026-07-26 — see below).
                      **2026-07-26 REVERSAL (third shape of the trim itself):** the budget trim
                      (`trimDayToBudget`, per-day) is GONE, replaced by `trimWeekToBudget`
                      (joint over the whole week) — it minimizes marginal BACKLOG-hours
                      (`candidateCutCost`, a bounded forward simulation of the SAME recurrence
                      `backlog.ts` uses — both now import it from `engine/backlogModel.ts`, see
                      PR B below — now volatility-scaled per Phase 2a), free to allocate more
                      cuts to one day than another, with the p25-equivalent band floor demoted
                      from a cost term to a large-but-finite guardrail penalty.
                      `hourWeight`/transition-hour weighting is gone (no per-hour weight slot in
                      the new cost); `solveShiftFit` dropped its `transitionWeight`/
                      `transitionWindowHours` parameters as a result.
                      `solveFullCoverageWeek`/`enforceDepartmentFloor` are now exported too
                      (Phase 2b needs both). See engine-solver.md's "Budget-capped trim"
                      section for the full history. **2026-07-26 PR A REVERSAL:** shift-hour
                      attribution is GLOBAL-WEEK circular now, not day-local — `coverageForDay`
                      takes the whole grid + a day index (a day's early hours can be covered by
                      the PREVIOUS day's shift); `fullWeekCapacity` is the new primary capacity
                      computation; `solveFullCoverageWeek` (renamed from `solveFullCoverageDay`)
                      and `enforceDepartmentFloor` both became joint week-level passes; new
                      `coveringCellsByGlobalHour` replaces three separate hour-of-day lookups in
                      `backlog.ts`/`boarding.ts`/`bandFloor.ts`. See engine-solver.md's "Shift
                      wraparound model" section. **2026-07-26 PR C REVERSAL (sixth shape of the
                      trim): the cost function is now CONVEX severity, not linear backlog-hours.**
                      New exports `severity`/`totalSeverity`/`peakSeverityOf`/`SEVERITY_GAMMA`
                      (`severity = (backlog / max(requirement,1)) ^ 1.8`, normalized by need, not
                      raw nurse-hours). `PEAK_WEIGHT` promotes peak severity from a tie-break to
                      a real cost term. `BAND_FLOOR_BREACH_PENALTY = 1e6` is RETIRED, replaced by
                      a finite power law (`FLOOR_WEIGHT = 75`, `FLOOR_GAMMA = 2`). `trimWeekToBudget`
                      /`candidateCutCost`/`solveShiftFit` all take `protectedFloorHourly168` now
                      (renamed from `bandFloorHourly168` — the UNCLAMPED solver-facing floor, not
                      the clamped reporting curve). `CandidateCutCost.peakInWindow` renamed
                      `peakSeverityInWindow`. See engine-solver.md's "Budget-capped trim" section,
                      PR C, for the full rationale and FLOOR_WEIGHT validation.
    backlogModel.ts — (2026-07-26 PR B, `SOLVER_REALISM_SPEC_2026-07-26.md`) LEAF module (no
                      engine imports) owning the backlog recurrence in exactly one place —
                      `backlogRecurrence` (full 168-hour week) and `backlogHourStep` (single-hour
                      primitive, reused by both the full recurrence AND `solver.ts`'s windowed
                      `candidateCutCost` simulation). Replaces the retired single-decay model
                      (`backlogHourlyDecay = 0.85`) with three named processes —
                      `backlogAbandonRate`/`backlogRecoveryEfficiency`/`backlogMaxDrainFraction`
                      (`DEFAULTS` in `types.ts`) — and removes the circular-import problem that
                      previously forced a hand-duplicated copy of the recurrence in `solver.ts`.
                      Both `backlog.ts` and `solver.ts` import from it. See
                      engine-solver.md's "Budget-capped trim" section for the physics rationale.
    backlogFeedback.ts — (2026-07-26, Phase 2b) `solveShiftFitWithBacklogFeedback` — the
                      iterative relaxation loop wrapping `solver.ts`'s trim: full-coverage
                      solve once, repeated `trimWeekToBudget` against a progressively-raised
                      LOCAL protected floor (raised wherever `computeBacklog`'s new
                      `carriedIn` is material), returns whichever pass had the lowest total
                      backlog-hours (not necessarily the last — an oscillation safety net).
                      New EngineResult diagnostics: `backlogFeedbackPassCount`,
                      `backlogFeedbackStillImprovingAtCap`. Sits ABOVE both `solver.ts` and
                      `backlog.ts` (needs both) rather than either importing the other. See
                      engine-solver.md's "Budget-capped trim" section, Phase 2b — the fourth
                      reversal-in-spirit of this area ("backlog never feeds the solver").
                      **2026-07-26 PR C: its floor parameter is `protectedFloorHourly168`**
                      (renamed from `bandFloorHourly168` — the loop's local raises compose onto
                      the UNCLAMPED solver-facing floor, same reasoning as before).
    index.ts        — compute(): the single callable orchestrator; reconcile(); recomputeAfterEdit();
                      derives `bandFloorHourly`/`bandCeilingHourly`/`protectedFloorHourly`/
                      `demandVolatilityHourly` via `demandBand.ts` (cohort band composed with the
                      arrivals-volatility buffer; PR C split the composed curve into a CLAMPED
                      reporting curve and an UNCLAMPED solver-facing one — see below); calls
                      `solveShiftFitWithBacklogFeedback` (Phase 2b) instead of the plain one-shot
                      `solveShiftFit` for the primary idealized-grid solve, passing
                      `protectedFloorHourly`; computes `totalBacklogHours`/`totalSeverity`/
                      `peakSeverity` on `EngineResult` from the final solved grid (PR C change 5,
                      `backlog.ts`'s `summarizeBacklogSeverity`) — the solver's actual objective,
                      previously invisible on the results page; lostProductivity (Productivity
                      Target Buffer metric); re-exports
                      computeBacklog + computeBandFloorViolations + searchFlexibleMenus +
                      solveShiftFit/trimWeekToBudget/candidateCutCost +
                      solveShiftFitWithBacklogFeedback. No longer reads `transitionWeight`/
                      `transitionWindowHours` from inputs (2026-07-26 — solver stopped consuming
                      them; still valid unread `EngineInputs`/`DEFAULTS` fields, see
                      engine-solver.md). **2026-07-26 PR F: new `computeScenarioB(result,
                      inputs, currentStaffingGrid)`** — "the same hours, better placed" (spec
                      §5), a PARAMETER SWAP over the same `solveShiftFitWithBacklogFeedback`
                      pipeline (weeklyBudgetHours -> current grid's own weekly hours, everything
                      else fixed), via a new shared `resolveBacklogParams(inputs)` helper
                      (extracted from `compute()`, also used by `compute()` itself) so both
                      honor PR E's `lwbsRate` override identically. Returns `null` with no
                      current staffing. See results-redesign.md's PR F section.
    __tests__/      — reconcile.test.ts (Section 2.2 build-in check, still passes UNMODIFIED
                      through every reversal above), solver.test.ts, boarding.test.ts,
                      backlog.test.ts, flexMenu.test.ts, demandBand.test.ts (Phase 2a),
                      backlogFeedback.test.ts (Phase 2b)
  lib/
    template.ts      — ONE consolidated multi-tab .xlsx template (Arrivals, ESI Mix,
                       Scalars, Boarding Seasonality) — never seeds example values, see
                       .claude/rules/template-parsing.md. Replaced the old two-independent-
                       template model 2026-07-14; CSV generation for this template was
                       dropped (multi-tab data doesn't serialize meaningfully into one CSV).
    parseUpload.ts    — tolerant header-based upload parser; for `.xlsx` uploads, classifies
                       EVERY sheet in the workbook independently by which columns it has and
                       merges results (not by sheet name/position) — see
                       .claude/rules/template-parsing.md. Single-sheet CSV upload still
                       supported for the Arrivals/ESI Mix shape only.
    parseStaffingUpload.ts — (2026-07-25) separate tolerant parser for the current-staffing
                       template used on `ShiftMenuStep.tsx` — a second, independent template
                       from the one above, since it depends on `shiftMenu` which doesn't
                       exist yet at Step-1 time. Matches rows to a shift by Start Hour/Length,
                       never by the Shift label text. See .claude/rules/template-parsing.md's
                       "Current-staffing template" section.
    edbaLookup.ts     — cohort volume-band → median/p25/p75 wHPPV lookup (the one sanctioned
                       shipped default). Filename/internal naming unchanged; the UI no
                       longer says "EDBA" anywhere (2026-07-14, Section 6).
    whppvColorDomain.ts — (2026-07-25) `computeColorDomain(annualVisits, wHppvTarget)` →
                       the heatmap's neutral-band color domain (`{low, high, target,
                       isFallback}`), widened to include the user's own target, ±15%
                       fallback if no band exists. Split out of `components/WhppvHeatmap.tsx`
                       so the component file stays component-only (fast-refresh lint).
                       `CoreGridTab.tsx` computes this ONCE and passes it to both heatmap
                       instances — see Section 6.
    dayOrder.ts       — (2026-07-25) the ONE shared Mon-Sun display-order helper
                       (`DISPLAY_DAY_ORDER`/`DISPLAY_DAY_LABELS`) every day-of-week-rendering
                       component/template imports — see Section 6. Does not touch the
                       engine's day-0-is-Sunday index.
    pptxExport.ts     — (2026-07-26 PR L, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §9)
                       `exportResultsToPptx` — client-side deck export via `pptxgenjs`. Slide
                       titles pulled from `narrative.ts`'s functions; Method & Limitations
                       ALWAYS included (uses `constantsMetadata.ts`'s table); boarding/
                       constrained-reallocation slides OMITTED when boarding is absent. Loaded
                       via a dynamic `import()` from `DashboardScreen.tsx`, not a static import
                       — keeps `pptxgenjs` out of the main bundle. See results-redesign.md's
                       PR L section.
    inputIntegrity.ts — (2026-07-26 PR K, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §10)
                       `checkBoardingDurationConsistency`/`checkMonthlyDispersion` — diagnostic-
                       only, never auto-correct. Powers `screens/setup/DataStep.tsx`'s live
                       upload-integrity banners. See results-redesign.md's PR K section.
    constantsMetadata.ts — (2026-07-26 PR I, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §8,
                       Chapter 9) `buildConstantsTable()` — GENERATED FROM `DEFAULTS` AT
                       RUNTIME (throws if any `DEFAULTS` key lacks metadata), powers
                       `screens/dashboard/EvidenceSurfaceSection.tsx`'s constants table.
    narrative.ts      — (2026-07-26 PR H, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §8) every
                       templated headline as a PURE function — no JSX, no store access. Powers
                       `engine/__tests__/syntheticSweep.test.ts`'s sign-assuming-copy hook
                       (§12.5) and will be PR L's single source for PPTX slide titles. Covered
                       sections still render their own inline JSX (worded identically) rather
                       than calling these directly yet — see this file's own header and
                       `.claude/rules/results-redesign.md`'s PR H section for the full scope
                       note and why.
    whenPattern.ts    — (2026-07-27, PR A of `RESULTS_PAGE_V2_SPEC_2026-07-27.md` §5.2)
                       `namePattern(values168, direction)` — the ONE shared "when is it
                       worst" phrase generator (e.g. "weekday mornings," "Tuesdays"). A
                       5-rung ladder (block-every-day → weekday/weekend×block → single-
                       day×block → single day → fallback single hour), each rung tried in
                       order, first to clear a 50%-capture/60%-purity bar against the fixed
                       42-hour worst quartile wins. **FLAGGED FINDING:** rung 3 (single
                       day×block) is mathematically unreachable at these fixed constants —
                       see the function's own header comment and its test file for the proof
                       — implemented literally as specified rather than silently rescaled.
    __tests__/
  components/
    ConceptCallout.tsx   — (2026-07-26 PR J, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §8,
                          teaching layer) reuses the `.why-toggle`/`.why-explainer` disclosure
                          pattern for six inline concept explainers, each placed at its first
                          use across `CoreGridTab.tsx`/`ScenarioBSection.tsx`/
                          `HiddenBoardingSection.tsx`. See results-redesign.md's PR J section.
    ConvexityDemo.tsx    — (2026-07-26 PR J) THE ONE interactive — same 10 nurse-hours of
                          shortfall spread vs. concentrated, scored with the REAL `severity`
                          function from `engine/solver.ts` (not a mock). Verified in
                          `engine/__tests__/convexityDemo.test.ts`.
    ChapterRail.tsx      — (2026-07-26 PR H, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §8)
                          sticky chapter rail, `IntersectionObserver` scroll-spy, click-to-jump.
                          Renders whatever `chapters` list `DashboardScreen.tsx` passes — chapter
                          order is decided there, not here. See
                          `.claude/rules/results-redesign.md`'s PR H section for why the rail's
                          6 entries don't map 1:1 onto the spec's 9-chapter ideal yet.
    EvidenceBadge.tsx    — ESTABLISHED/CONSENSUS/CONVENTION/ASSUMPTION/OPTIONAL inline badge
                          (OPTIONAL renamed from USER INPUT 2026-07-22 — every field on these
                          screens is user input, so the badge now flags optional-vs-required
                          instead; required fields keep whatever badge they already had, no
                          new REQUIRED badge was added)
    ArrivalsGrid.tsx      — editable 24×7 hour/day grid, used as setup-screen touch-up tool
                          (Mon-Sun display columns, `lib/dayOrder.ts`)
    ShiftMenuEditor.tsx   — add/remove/edit (start, length) shift rows, reused in setup + flex section
    CurrentStaffingGrid.tsx — editable day × shift-menu current-staffing grid, store-driven; the
                          SAME component in setup (ShiftMenuStep) and results (CoreGridTab)
                          (Mon-Sun display rows, `lib/dayOrder.ts`)
    FlexAxesToggles.tsx   — §2.3 flexibility-axis checkboxes bound to store `flexAxes`; shared by
                          ShiftMenuStep (setup) + ShiftMenuFlexibilitySection (results)
    WhppvHeatmap.tsx      — 7x24 realized-wHPPV heatmap inside CoreGridTab's wHPPV unit (Mon-Sun
                          display columns); band-neutral asymmetric color scale (accepts
                          `colorDomain` as a prop, computed once by the caller — see Section 6),
                          backlog vertical-spine overlay (weight scaled by a shared `backlogMax`
                          prop) + ENA-floor flag, and shift-boundary rule rows keyed off a
                          `shiftMenu` prop (2026-07-25 heatmap legibility rework, see
                          .claude/rules/results-redesign.md's last section)
  screens/
    WelcomeScreen.tsx  — entry point, "Start Setup" button, see Screen Map above
    SetupScreen.tsx    — 4-step wizard shell, see Screen Map above
    setup/             — one component per wizard step (DataStep, VolumeStep, ShiftMenuStep,
                         ReviewStep), StepIndicator, and applyParsedUpload.ts (applies
                         whatever subset of parsed fields a single upload contains —
                         arrivals/ESI/admit rate/boarding duration/both seasonality totals)
    dashboard/          — see Screen Map above
  store.ts            — zustand store: all engine inputs + setupStep + gridOverride +
                        currentStaffingGrid + flexAxes (compareVariants removed with CompareTab)
  App.tsx / main.tsx  — screen switch, root mount
```

`compute()` in `engine/index.ts` is the one function every consumer calls — CoreGridTab,
BoardingCoverageSection, CompareTab, and (indirectly, via `recomputeAfterEdit`) the
live-edit path all go through it or its sibling. **Never re-implement allocation/solve
logic inline in a component** — if a screen needs a variant computation, add it to
`engine/`.

---

## 5. Data Model (engine contract)

```ts
EngineInputs = {
  arrivals: number[168],       // required, index = day*24+hour, day 0=Sunday
  arrivalsP75?: number[168],   // optional, all-or-nothing — busy-hour arrivals (2026-07-26,
                                // Phase 2a); NEVER touches annualVisits/hourlyRequirement, only
                                // feeds demandVolatilityHourly -> bandFloorHourly + trim cost
  annualVisits?: number,       // derived as sum(arrivals)*52 if absent
  wHppvTarget: number,         // required
  shiftMenu: ShiftDef[],       // required, [{id, label?, startHour, lengthHours}]
  esiMix?: {esi12, esi3, esi45: number[168]},   // optional, all-or-nothing, hourly (must vary by hour to matter)
  admitRate?: number | number[168],              // optional; template-only now (see Section 6); boarding withheld if absent
  boardingDuration?: number | number[168],       // optional; template-only now; boarding withheld if absent
  boardingRatioTarget?: number,                  // default 4 (1:4) — the one typed policy field left, on DataStep
  monthlyMeanBoardingDurationHours?: number[12], // optional, all-or-nothing — MEAN duration per patient that month (2026-07-22, was raw totals — see .claude/rules/boarding-seasonality.md)
  dayOfWeekMeanBoardingDurationHours?: number[7],// optional, all-or-nothing — MEAN duration per patient that day, same reasoning
  hoursBudgetTolerance?, transitionWeight?, transitionWindowHours?,
  acuityWeights?, smoothingWeights?, enaFloor?    // policy params, all have DEFAULTS
}
```

`compute(inputs) → EngineResult` returns the full 168-cell allocation, the smoothed
requirement curve, the solved grid (now produced by the Phase 2b backlog-feedback relaxation
loop, `engine/backlogFeedback.ts`, plus its `backlogFeedbackPassCount`/
`backlogFeedbackStillImprovingAtCap` diagnostics), shortfall table, overcoverage %,
reconciliation check result, (if admit rate + boarding duration present) the boarding result —
now an hourly census curve plus a `prioritySlots` list ranked by required care hours, with a
running cumulative %, see `.claude/rules/boarding-seasonality.md` — and `lostProductivity`
(null iff boarding is null). See `engine/types.ts` for the full shape — it's the canonical
reference, don't let this section drift from it.

**Authoritative vs. derived:** `arrivals`, `wHppvTarget`, `shiftMenu`, and the optional
inputs are the only things a user directly edits on the Setup screen. Everything in
`EngineResult` is derived by `compute()` — the one exception is `gridOverride` in the
store, which layers a manual headcount edit on top of the last solve and feeds
`recomputeAfterEdit()` for the cheap live recheck (no re-solve). **Never hand-write a
staffing grid anywhere except through `compute()` or a `gridOverride` edit.**

---

## 6. Rules & Conventions

**wHPPV / overcoverage / shortfall must never be visually separable.** This is a hard
requirement from the spec (5.5), not a style preference — `CoreGridTab.tsx`'s
`.wHPPV-unit` card renders all three together deliberately. If this ever gets refactored,
keep them in one card/component; don't let them become independently collapsible. The
shortfall detail inside that unit is a shift-type rollup table (see the shift-shortfall
convention below), not the raw per-hour table — that change doesn't affect this rule. A 4th
stat, ED-facing wHPPV after boarding (`lostProductivity`, see
`.claude/rules/boarding-seasonality.md`), was added to the same `.wHPPV-stats` row
(2026-07-13) — it's an addition to the unit, not a rule change; the original three still
render together. **2026-07-22 rename (labels only, calculations unchanged):** "Shortfall
hours" → "Hours Below Ideal Coverage" (subtitle: "Hours this week where staffing fell short
of the ideal target."); "ED-facing wHPPV after boarding" → "Effective ED wHPPV (accounting
for boarding)".

**2026-07-25 (REVERSAL, not a rename — see `.claude/rules/engine-solver.md`'s "Budget-capped
trim" section): "Hours Below Ideal Coverage" is RETIRED, replaced by "Hours outside your
typical staffing range".** This is the same third slot in the `.wHPPV-unit` card (the
"never visually separable" rule still holds — it renders in the same row as the others), but
it now counts hours where the idealized grid's coverage falls below `EngineResult
.bandFloorHourly` (`engine/bandFloor.ts`'s `computeBandFloorViolations`) — plus a "worst
stretch" callout (longest consecutive run below the floor + which day/shift it falls in), not
a plain count of hours below the point-target `hourlyRequirement`. **2026-07-26 (PR C,
`SOLVER_REALISM_SPEC_2026-07-26.md` change 4): `bandFloorHourly` here is specifically the
CLAMPED reporting curve — capped at `hourlyRequirement`, same as before PR C.** It is NOT the
same curve Step 3's trim itself optimizes against anymore; that's the separate, UNCLAMPED
`EngineResult.protectedFloorHourly` (volatility may raise it above `hourlyRequirement`, which
this stat's clamped curve can never express). The two are identical everywhere demand
volatility is modest and only diverge at genuinely high-volatility hours — see
`.claude/rules/engine-solver.md`'s "Budget-capped trim" section (PR C) for the full rationale.
Don't keep both stats side by side — this
replaces the old one entirely. The point-target `shortfall`/`ShortfallEntry[]` array itself is
UNCHANGED and still feeds other consumers (the idealized grid's per-day shortfall-dot marker,
`ShiftMenuFlexibilitySection.tsx`'s candidate ranking, the current-staffing comparison unit's
own "Hours below ideal coverage (current)" stat) — only this ONE named stat in `.wHPPV-unit`
was replaced.

**Shift-menu columns always render sorted by `startHour`, never in array/creation order.**
`shiftMenu` in the store is unordered (shifts get appended wherever `ShiftMenuEditor`'s
"+ Add shift" or an upload leaves them), so any UI that builds columns/headers from it must
sort a local copy by `startHour` before rendering — see `sortShiftsByStartHour()` in
`CoreGridTab.tsx`. Otherwise a mid-shift added after Day/Night tacks onto the end of the
grid instead of sitting between them. This applies to any future shift-menu-driven grid
(e.g. if Compare tab's per-variant columns are ever revisited) — it's a rendering
convention, not something `compute()` enforces, since the engine only cares about each
shift's `startHour`/`lengthHours`, not menu order.

**Day-of-week DISPLAY order is Mon-Sun everywhere (2026-07-25) — the engine's `day 0 =
Sunday` index does NOT change.** Every grid renders Mon, Tue, Wed, Thu, Fri, Sat, Sun —
weekend contiguous at the right edge — because a Sun-first grid splits the weekend (which
behaves differently in an ED) across its two opposite ends. This is a PURE render-order/
row-emission-order change: `arrivals[day*24+hour]`, every engine function, every store
field, and every parser's output all still use day 0 = Sunday, unchanged. `lib/dayOrder.ts`
exports the one shared `DISPLAY_DAY_ORDER = [1,2,3,4,5,6,0]` (engine day index to render at
each display position) + matching `DISPLAY_DAY_LABELS` — every day-of-week-rendering
component (`WhppvHeatmap`, `ArrivalsGrid`, `CurrentStaffingGrid`, `CoreGridTab`'s idealized/
diff grids, `BoardingCoverageSection`) imports this ONE helper rather than defining its own
local Mon-first ordering — that duplication is exactly how these would drift apart again, the
same lesson as the `sortShiftsByStartHour` convention above. `lib/template.ts`'s row emission
(Arrivals/ESI Mix tabs, the current-staffing template) is also Mon-first now — safe, because
`parseUpload.ts`/`parseStaffingUpload.ts` match a row to a day by NAME (`DAY_ALIASES`), never
by row position; see `.claude/rules/template-parsing.md`'s legacy-template regression test.

**Shift-hour attribution is GLOBAL-WEEK, not day-local, as of 2026-07-26 (PR A,
`SOLVER_REALISM_SPEC_2026-07-26.md`) — do not confuse with the Mon-Sun DISPLAY-order note
above, which is a different axis (render order vs. which hours a headcount counts as
covering).** A shift assigned to day `d` now covers global hours `(d*24 + startHour + i) mod
168` for `i` in `[0, lengthHours)` — circular over the FULL WEEK, matching the convention
`boarding.ts`'s convolution already used. Previously a shift wrapped back into its OWN day's
early hours when it crossed midnight (a Saturday 19:00 shift counted as covering Saturday
00:00-06:00 too) — physically wrong, since that block is really the tail of FRIDAY night's
crew; reversed as a genuine bug fix, confirmed with Ben. The UI grids DO NOT change shape
(still day × shift headcount) — only which hours a cell's headcount is counted as covering
does. `engine/solver.ts`'s `coverageForDay` now takes the whole grid + a day index (a day's
own early hours can be covered by the PREVIOUS day's shift); `fullWeekCapacity` is the new
primary capacity computation. See `.claude/rules/engine-solver.md`'s "Shift wraparound
model" section for the full mechanical detail (also touches `backlog.ts`, `boarding.ts`,
`bandFloor.ts`, `backlogFeedback.ts`).

**The shortfall diagnostic inside the wHPPV unit is a 7x24 realized-wHPPV heatmap, computed
client-side.** `CoreGridTab.tsx` (rendering via `components/WhppvHeatmap.tsx`) computes a
per-(day,hour) realized wHPPV as `(onDuty ÷ cellArrivals) × scale`, where `onDuty` comes
from `coverageForDay()` (`engine/solver.ts`) and `scale` is the same day-level scaling
factor already used for the plain-summary min/max range, just applied at hour instead of
day grain — pure display arithmetic over already-computed fields, no new engine math. Don't
move the heatmap's per-cell math into `engine/` unless a second consumer needs it. Earlier
still, this whole heatmap replaced a one-row-per-shift-type shortfall table
(`summarizeShortfallByShift()`) that rolled the per-hour `shortfall` array up by shift; that
rollup is gone, not just hidden.

**2026-07-25 heatmap legibility rework — band-neutral asymmetric color scale, replacing the
single-center diverging scale.** Full detail in `.claude/rules/results-redesign.md`'s
heatmap-legibility section; summary of the rule as it stands now:
- **Color domain is a NEUTRAL BAND, not a point.** `lib/whppvColorDomain.ts`'s
  `computeColorDomain(annualVisits, wHppvTarget)` returns `{low, high, target, isFallback}` —
  the p25–p75 `lookupWhppvBand` range, widened to `[min(p25,target), max(p75,target)]` so the
  user's own stated target never itself renders as a problem (falls back to ±15% of target
  when no usable band exists). Cells inside `[low, high]` get **no color at all**; only cells
  genuinely outside it get ink. **This band-as-color-domain is a DIFFERENT mechanism from the
  retired single-hour p25 red-outline flag described below** — read the two as unrelated, not
  as one un-reversing the other.
- **Distance is measured log-ratio from whichever band edge was crossed**, and the two sides
  are asymmetric on purpose: understaffing (lean) saturates fast (a small dip below the band
  already reads as alarming), overstaffing (rich) ramps slowly and clamps by ~2x target (past
  that it's just "overnight, plenty of staff"). Both sides use the same gamma-eased curve
  (nearly flat just outside the band, accelerating with distance) — see the named constants at
  the top of `components/WhppvHeatmap.tsx` (`COLOR_EASE_GAMMA`, `LEAN_FULL_SATURATE_RATIO`,
  `RICH_CLAMP_MULTIPLE`) — display heuristics, safe to tune, not load-bearing math. The rich
  side renders in a muted gray-blue (`RICHER_RGB`), not saturated blue, so it never visually
  competes with red for attention. Cell text auto-flips to white above a fill-alpha threshold
  (`TEXT_FLIP_ALPHA_THRESHOLD`) for contrast on dark cells.
- **Color domain (and the backlog-weight max below) must be computed ONCE, in `CoreGridTab.tsx`,
  and passed into every `WhppvHeatmap` instance as an explicit prop** (`colorDomain`,
  `backlogMax`) — `CoreGridTab`'s own heatmap and `CurrentStaffingAnalysis`'s heatmap are meant
  to read as directly comparable, so neither derives its own domain from its own cells.
- **Backlog overlay is a vertical spine on the cell's left inside edge** (`.heat-backlog-spine`),
  not the old bottom-bar + corner dot (`.heat-backlog-dot`, removed) — a backlog streak is
  consecutive HOURS, which runs vertically down a day column, so the marker now runs the same
  axis as the thing it encodes. The spine has no gap between vertically adjacent flagged cells
  (bridges the collapsed table border) so a streak reads as one continuous bracket. Width/
  opacity scale continuously with the cell's backlog value over a shared `backlogMax` (max
  peak backlog across BOTH the idealized and current grids, computed once in `CoreGridTab` —
  same per-grid-vs-shared-max reasoning as the color domain) — no new threshold;
  `BACKLOG_CAUGHT_UP_THRESHOLD` (engine/backlog.ts) is still the only gate for "is there a
  backlog at all." The ENA on-duty floor flag (red inset outline + "!", `.heat-cell-risk`) is
  unchanged and still shown independently of backlog — see the resolved call below.
- **Rules land at each distinct shift-menu `startHour`** (`.shift-boundary` rows, gutter
  labeled with the shift's `label || id`), not fixed hour marks — ties the heatmap to the one
  lever a manager actually controls. No separate 6-hourly banding.
- **2026-07-24 (resolved with Ben, spec §2.4/§5): the old single-hour p25 red-outline flag was
  SUPERSEDED by the backlog-streak overlay** — a streak is strictly more informative than a
  lone short hour; the ENA-floor flag stays (a safety minimum, orthogonal to backlog).
  `CoreGridTab` does not use a p25 value to flag an individual cell; don't reintroduce that
  specific mechanism (a per-cell binary "below p25 → red outline" check). This is unrelated to
  the 2026-07-25 p25/p75 **band-as-color-domain** above, which is a continuous coloring
  mechanism, not a flag — both can be true at once, they answer different questions.
  The backlog overlay uses the idealized grid's `computeBacklog` (`engine/backlog.ts`) for
  `CoreGridTab`'s own heatmap; the §2.1 `CurrentStaffingAnalysis` heatmap uses the current
  grid's — both feed into the one shared `backlogMax`.

**2026-07-26 PR D (`SOLVER_REALISM_SPEC_2026-07-26.md` change 4) — SECOND reversal of the
heatmap's color mechanism.** Read the 2026-07-25 block directly above (especially its
p25-flag-vs-color-domain disambiguation note) before touching this again — this is a further
data point in that same history, not a conflict with anything said there. What changed:
- **The cell's displayed NUMBER changed** from realized wHPPV (e.g. `1.2`) to
  `onDuty/requirement` (e.g. `7/9`) — an ENA-floor-style ratio every nurse reads instantly.
  Realized wHPPV moved to the tooltip (it was the primary number before, and was the least
  intuitive of the three available, dominated by the arrivals denominator).
- **The cell's COLOR is now driven by that SAME ratio**, against a PER-CELL neutral band —
  this hour's own `bandFloorHourly`/`bandCeilingHourly` (`EngineResult`), expressed as ratios
  against `requirement` with `target = 1.0` ("exactly at this hour's own point target").
  **This REPLACES the 2026-07-25 block's week-level `computeColorDomain`/
  `lib/whppvColorDomain.ts` domain as the heatmap's color driver specifically** — that function
  and its `{low, high, target, isFallback}` domain are UNCHANGED and still used elsewhere on
  the results page for narrative band language (`CurrentStaffingAnalysis.tsx`'s "below/within/
  above the band" sentence and its stat cards) — it simply no longer drives THIS heatmap's
  color. `bandCeilingHourly` finally gets a consumer it never had before this.
- `WhppvHeatmap`'s prop signature DROPPED `colorDomain` entirely — each `WhppvHeatmapCell` now
  carries its own `bandFloor`/`bandCeiling` instead of the component receiving one shared
  domain object. The "shared-domain-computed-once-in-CoreGridTab" rule from the 2026-07-25
  block still holds IN SPIRIT (there's exactly one SOURCE curve —
  `EngineResult.bandFloorHourly`/`bandCeilingHourly`, computed once by `compute()` and read
  identically by both heatmap instances) — there's just no longer a single shared prop VALUE
  to thread down, since the per-cell band varies by hour now. The legend's specific numeric
  range text is GONE (there's no longer one range to state); replaced with a sentence
  describing the per-hour mechanism.
- **Still unrelated to the 2026-07-24 single-hour p25 red-outline retirement** (the resolved
  call in the 2026-07-25 block) — that was a binary FLAG, gone for good, superseded by the
  backlog-streak overlay. This PR D change is a continuous COLOR mechanism, the second one of
  those (2026-07-25's week-level band, now this per-hour band) — flag and color-mechanism are
  still two independent axes, don't conflate a change to one with a change to the other.
  See `.claude/rules/results-redesign.md`'s PR D section for the full record.

**Collapsed-by-default "why" explainer pattern.** `CoreGridTab.tsx`'s plain-language
summary panel (target wHPPV, weekly hours vs. budget, realized wHPPV range) has a
`.why-toggle` button that expands a `.why-explainer` block in plain, non-technical language
— collapsed by default so it doesn't clutter the headline numbers. If another screen needs
a similar "here's the plain-English reason" explainer, reuse this toggle pattern rather than
inventing a new one (e.g. a modal or tooltip).

**Boarding coverage is a single representative-week day × shift-menu grid now — FOURTH
reversal of this rule, confirmed with Ben (spec §2.6, 2026-07-24).** History: "boarding is
never a shift grid" (original) → solved grid 2026-07-13 (`solveBoardingCoverage()`, deleted)
→ ranked (month?, day, shift) slot list 2026-07-14 → annual-aggregated `+N` grid 2026-07-22/23
→ **now** ONE editable representative-week grid. `BoardingCoverageSection.tsx` renders a day ×
shift-menu grid (same shape as the core grid) of small incremental headcounts, pre-filled with
the minimal plan that reaches the p25 wHPPV band (`recommendWeeklyBoardingGrid`), directly
editable. **Month toggles are SCOPE (which months the one weekly plan applies to), scaling the
stats — never the pattern; there is NO day toggle** (zero a day by editing its cells). Stats
(`annualBoardingCoveredByWeeklyGrid`, `boardingCoverageFte`, `effectiveEdWhppvAtCoverage` —
ASSUMPTION, linear recovery) come from the grid's actual contents × active-month scope. The
2026-07-22/23 helpers (`deriveBoardingCoverageCells`, `boardingHoursCoveredByGrid`,
`restrictPrioritySlotsToActivePeriods`, `fundedCountToReachWhppv`) were REMOVED — don't
resurrect them; `solveBoardingCoverage()` stays deleted too. See
`.claude/rules/boarding-seasonality.md`'s last section for the full mechanism. What's stayed
true across all reversals: boarding output is never merged into `EngineResult.grid`
(additive/separate), and never a 168-cell hourly grid. Don't merge boarding into the core grid,
and don't render a 168-cell boarding grid without checking with Ben first.

**No "EDBA" branding anywhere in the UI.** Removed 2026-07-14 (Ben's ask) — `VolumeStep.tsx`
and `ReviewStep.tsx` now say "similar-volume benchmark" / "cohort benchmark," never "EDBA."
`src/lib/edbaLookup.ts` keeps its filename and internal comments as-is — this is a UI-copy
rule, not a data-source change. The 6-band comparison table on `VolumeStep.tsx` was also
removed; only a single inline p25–p75 sentence for the user's own band remains. Don't add
the table back or reintroduce "EDBA" in user-facing text without checking with Ben first.

**Admit rate / boarding duration are never estimated.** `computeBoarding()` in
`engine/boarding.ts` returns `null` outright if either is missing — see Section 8's lesson
in the algorithm spec about a prior placeholder admit rate looking like a calculator bug.
Don't add a fallback/default value for either field, ever. **Where they live has flipped
twice** — originally template columns, walked back to scalar typed fields
(2026-07-12, "confusing which box do I use"), reversed back to template-only
(2026-07-14, Ben's ask: one consistent upload pattern for all data, no typed fields for
report-sourced numbers). Read `.claude/rules/template-parsing.md`'s history section before
"fixing" this back to typed fields a third time — the reasons for each direction were
different (redundancy-with-template vs. interaction-pattern-consistency), and both are
worth knowing before deciding again.

**One consolidated data template — one explainer, one upload, no per-field typed data
entry.** (2026-07-14, Ben's ask — a non-engineer found having arrivals/ESI go through
download-template/upload while boarding went through typed number fields confusing, for no
good reason.) `DataStep.tsx` is the only place data enters the app besides the
`ArrivalsGrid` manual touch-up and the one remaining policy field (boarding ratio target).
Arrivals, ESI mix, admit rate, boarding duration, and both boarding-seasonality totals all
come from the same multi-tab `.xlsx` (`lib/template.ts`), parsed by
`parseXlsxFile`/`lib/parseUpload.ts` classifying every sheet independently. Don't add a new
typed-field UI for a data value that could instead be a template tab — that's the exact
inconsistency this change removed.

**Evidence-status badges are inline, not in a separate panel.** Decided explicitly in the
original build conversation — `EvidenceBadge` components sit next to the field/output they
describe (`SetupScreen.tsx`, tab components), not in a sidebar or modal. If a future
session considers moving to a persistent panel, that's a re-litigation of an already-made
call — check with Ben first.

**Live-edit recompute must stay cheap.** `recomputeAfterEdit` / `recomputeFromGrid` do pure
arithmetic (sum hours, compare to `hourlyRequirement`) — no re-solve. Don't add solver
calls to the live-edit path; it would defeat the "instant" requirement from the original
spec handoff (Section 9.3).

**Store shape:** flat zustand store, one instance, no persistence. `gridOverride` is
`null` until the user hand-edits a cell; `setArrivals`/`setShiftMenu` clear it (a new
solve should replace, not merge with, a stale manual edit). `flexAxes` (§2.3, default
`NO_FLEX`) holds the shift-menu flexibility preferences, set via `setFlexAxis` from either
setup or results. `compareVariants` and its actions were removed with `CompareTab`.

**`currentStaffingGrid` (2026-07-22) is a separate concept from `gridOverride` — don't
merge them.** `gridOverride` layers a manual edit ON TOP of the solver's own recommendation
(same underlying idea, hand-corrected). `currentStaffingGrid` is a **comparison** grid —
"what are you actually staffing today" — entirely independent of the idealized
recommendation, starts `null`/blank, and is never seeded from `result.grid`. Read cells via
the same `grid[day]?.[shiftId] ?? 0` convention as everywhere else. `getCurrentStaffingResult()`
(unlike `getLiveResult()`) is unconditional — it always calls `recomputeAfterEdit` against
`currentStaffingGrid ?? {}`, since an all-zero/unset comparison grid is itself a meaningful
state to show (full idealized headcount as the diff), not an absent one to guard against.
**2026-07-24 (§1):** it's now also introduced at *setup* (`ShiftMenuStep`) via the shared
`components/CurrentStaffingGrid.tsx` — setup and results write the same store field, so a value
entered in either place shows in both. The §2.1 opening analysis and §2.2 comparison unit both
read it; an empty grid drives a CTA rather than a misleading verdict.

---

## 7. Explicitly Out of Scope (per algorithm spec Section 7 + original build prompt)

Do not build these without an explicit, separate ask — they were deliberately declined:
- Dollar cost layer for boarding (placeholder shown in `BoardingCoverageSection.tsx`; needs
  RN salary + benefit-factor inputs, not yet collected)
- Seasonality modeling for **arrivals** (boarding seasonality — monthly/day-of-week factors
  — was built 2026-07-13, see `.claude/rules/boarding-seasonality.md`; arrivals still has
  no seasonality dimension, unchanged)
- Monte Carlo / percentile-based variability modeling anywhere in the core engine
- ~~Auto-optimizing shift-menu search~~ — **REVERSED 2026-07-24 (spec §2.3, confirmed with
  Ben).** `engine/flexMenu.ts`'s `searchFlexibleMenus` now does a bounded, opt-in, advisory
  candidate search (surfaced side-by-side, never auto-adopted into the idealized grid). The
  standalone Compare section was retired and its manual side-by-side folded into the new
  `ShiftMenuFlexibilitySection`. See `.claude/rules/engine-solver.md`'s last section for the
  scoped-reversal reasoning. Still out of scope: a *general* menu optimizer (this is a bounded
  enumeration over regular tilings, not an ILP/search over arbitrary menus).
- Any backend, database, auth, or multi-user features

---

## 8. Feature Status

**Built (2026-07-12 initial build):** full calculation engine (Steps 1/1b/1c/2/3, all
spec sections), reconciliation test suite, tolerant CSV/XLSX template generator + parser,
Setup screen (upload + manual touch-up grid, wHPPV EDBA pre-fill, shift menu builder,
optional-input graceful degradation), Results dashboard with all three tabs, live-edit
recompute, inline evidence badges throughout. Verified end-to-end in a headless browser
(upload → dashboard → live-edit → boarding-withheld → compare-variant flow), zero console
errors, `npm run build` and `npm test` both clean.

**Built (2026-07-12 setup redesign):** Setup converted from a single long-scroll screen
into a 5-step wizard (`src/screens/setup/`, see Screen Map / Module Map above); the
arrivals/ESI-mix template split into two independent files with tolerant either-or-both
upload parsing; the EDBA lookup table expanded to show all 6 volume bands with p25/p75
typical range (own band highlighted) on the Volume step, not just the one pre-filled
number; setup copy rewritten from build-instruction phrasing to plain user-facing
language. Verified end-to-end in a headless browser (arrivals template upload → step
through wizard → EDBA table own-band highlight → shift menu → review step edit-links →
dashboard → boarding-withheld degrades exactly as before), zero console errors,
`npm run build` and `npm test` both clean.

**Built (2026-07-12 admit-rate/boarding-duration walk-back):** admit rate and boarding
duration moved out of the (then-named) clinical-detail template entirely and into plain
scalar number fields on Step 4 — the template's hourly-grid shape was confusing next to a
scalar-entry box for the same field, and the engine already accepted a scalar admit rate.
`boardingDuration` widened from `Cell168`-only to `number | Cell168` in
`engine/types.ts`/`engine/boarding.ts` to match `admitRate`'s existing scalar support. ESI
mix intentionally stays hourly-only (its own template) since it reweights the arrivals
curve per-cell — a scalar ESI split would be a no-op multiplier. See
`.claude/rules/template-parsing.md` for detail. Verified end-to-end (scalar admit rate +
scalar boarding duration + ESI-mix-only file upload on Step 4 → review → dashboard →
Boarding tab produces real FTE output), zero console errors, `npm run build` and
`npm test` both clean.

**Built (2026-07-12 Welcome screen + real favicon):** `WelcomeScreen.tsx` added as the new
app entry point (`screen` store field widened to `'welcome' | 'setup' | 'dashboard'`,
default `'welcome'`) — a brief app description and a "Start Setup" button, no
previous-results navigation since there's still no persistence. `public/favicon.svg`
replaced with a real ShiftLens mark (rounded-square tile, `#f5f0ff` fill, `#7c3aed`
lightning bolt) referenced from `index.html` and reused as the small logo on the Welcome
screen. `npm run build` clean, no stray Vite favicon reference remains.

**Built (2026-07-12 Core grid tab redesign):** `CoreGridTab.tsx` restructured per planning
feedback — (1) shift-menu columns now sort by `startHour` before rendering, so a
mid-shift added after Day/Night lands between them instead of at the end (see
`sortShiftsByStartHour()` and the Section 6 convention above); (2) the idealized staffing
grid moved to the top of the tab and restyled as the visual hero (`.core-grid-hero`, larger
accent border, bigger cells/font) instead of reading as one card among several; (3) a new
plain-language summary panel (`.plain-summary`) sits above the grid — target wHPPV, the
recommended schedule's weekly hours vs. budget in a plain sentence, and the realized wHPPV
range across the week (min–max, derived client-side from per-day arrivals/scheduled-hours,
scaled to reproduce the reported weekly value) — with a collapsed-by-default "why" toggle
explaining the full-coverage/budget-trim/ENA-floor tradeoff in plain language (see Section 6
"why" pattern); (4) the dense 168-row hourly shortfall table was replaced with a one-row-
per-shift-type summary (`summarizeShortfallByShift()`), each row expandable to a 7-day
breakdown — a pure client-side rollup of the existing `shortfall` array, no engine changes.
The `.wHPPV-unit` card (Realized wHPPV / Overcoverage / Shortfall hours) is unchanged and
still holds all three together per the Section 6 hard rule. Boarding and Compare tabs were
not touched. Verified end-to-end in a headless browser with a 3-shift menu added out of
order (Night, Day, Mid) — grid columns rendered Day → Mid → Night, summary panel and "why"
toggle rendered correctly, shift-type table expanded to per-day detail — zero console
errors, `npm run build` and `npm test` both clean.

**Built (2026-07-13 realized-wHPPV heatmap):** `CoreGridTab.tsx`'s shift-type shortfall
table (`summarizeShortfallByShift()`) replaced with a 7x24 hour x day realized-wHPPV
heatmap (`components/WhppvHeatmap.tsx`), still inside the `.wHPPV-unit` card per the
Section 6 hard rule — the `.wHPPV-stats` cards (Realized wHPPV / Overcoverage / Shortfall
hours) and the staffing grid above are unchanged. Color is a continuous scale centered on
`wHppvTarget`; an at-risk cell (realized wHPPV below `lookupWhppvBand(annualVisits).p25Whppv`
or on-duty headcount below the ENA floor, single hour sufficient) gets a separate red
outline + icon, never color-alone. Engine gap fix that made the ENA-floor half of that
check work live: `recomputeFromGrid`/`recomputeAfterEdit` (`engine/solver.ts` /
`engine/index.ts`) previously only rechecked `shortfall` against `hourlyRequirement` on a
manual grid edit — added a read-only, arithmetic-only `findDepartmentFloorViolations` check
(no re-solve, doesn't mutate the grid) so a manual edit that drops an hour below `enaFloor`
is caught immediately; see `.claude/rules/engine-solver.md`. New tests in
`engine/__tests__/solver.test.ts` cover the live-edit floor check;
`reconcile.test.ts` was untouched since shortfall/reconciliation math didn't change.
Verified end-to-end in a headless browser (setup wizard → dashboard → heatmap renders all
168 cells with hover detail and risk badges → zeroing a staffing-grid cell live-updates the
risk count), zero console errors, `npm run build` and `npm test` both clean.

**Built (2026-07-13 boarding-as-shift-grid + seasonality + merged dashboard):** Reverses
the "boarding is never a shift grid" decision (confirmed with Ben) — see
`.claude/rules/boarding-seasonality.md` for the full engine pipeline, summarized here: (1)
`engine/boarding.ts` now derives an hourly boarding-census curve via convolution
(`convolveBoardingCensus` — arrivals × admitRate = admission events, spread across the next
`boardingDuration` hours, circularly across the full 168-cell week, unlike the shift
solver's within-a-day model) instead of the old per-cell Little's-Law shortcut — the two
are mathematically equivalent in total (conserved-total property, tested in
`engine/__tests__/boarding.test.ts`), just redistributed in time; (2) two new optional,
all-or-nothing `EngineInputs` — `monthlyBoardingFactor: number[12]`,
`dayOfWeekBoardingFactor: number[7]` — entered as plain scalar fields on Setup Step 4
(`OptionalInputsStep.tsx`, checkbox-gated, no upload), multiplying the base curve; (3) the
(possibly factor-adjusted) curve is run through a new `solveBoardingCoverage()`
(`engine/solver.ts`) that reuses `solveShiftFit` verbatim (budget = the curve's own sum,
`enaFloor` disabled) producing 1 (flat), 1 (day-of-week), or 12 (monthly) independent
`BoardingCoverageSet`s — never merged into the core `EngineResult.grid`; (4) a new
`lostProductivity` field on `EngineResult` (Productivity Target Buffer method: wHPPV
consumed by boarding vs. left over for ED care), computed in `compute()` and surfaced as a
4th stat in `CoreGridTab.tsx`'s `.wHPPV-unit` card (Section 6's three-stats rule still
holds — this is an addition, not a rule change); (5) `DashboardScreen.tsx` no longer a tab
container — `BoardingTab.tsx` deleted, replaced by `BoardingCoverageSection.tsx` rendering
a condensed day-of-week (× month) peak-headcount table (via `coverageForDay()`, not a
second full 168-cell grid) with a collapsed-by-default "how is this calculated" explainer
(Section 6 "why" pattern); `CoreGridTab`, `BoardingCoverageSection`, and `CompareTab` (now
wrapped in its own `.card` with an `<h2>`) render as one scrolling page in that order, tab
CSS (`.tab`, `.tab-bar`) removed as dead code. New tests in
`engine/__tests__/boarding.test.ts` cover the conserved-total property, all three
granularity branches, the boarding-specific solve, and `lostProductivity`; `reconcile.test.ts`
untouched (core allocation math didn't change). Verified end-to-end in a headless browser
(setup wizard with monthly boarding factor entered, Jan set to 1.8x → dashboard renders as
one scroll → lost-productivity stat shows correct ED-facing wHPPV → boarding coverage table
shows Jan's peak headcount higher than other months, confirming the solve is actually
month-sensitive → Compare section renders at the bottom), zero console errors, `npm run
build` and `npm test` both clean.

**Built (2026-07-14 consolidated data template + priority-ranked boarding + one-page
dashboard):** Supersedes (does not reconcile with) the 2026-07-13 scalar-fields +
solved-grid boarding build — both the data-intake pattern and the boarding output shape
changed again. (1) **Data intake**: the two-independent-template model and the scalar
admit-rate/boarding-duration typed fields are gone, replaced by ONE consolidated multi-tab
`.xlsx` (`lib/template.ts`: Arrivals, ESI Mix, Scalars, Boarding Seasonality tabs) behind a
single new `DataStep.tsx` (replaces `ArrivalsStep.tsx` + `OptionalInputsStep.tsx`, both
deleted) with a plain-language explainer (what/why/what-if-blank per field) and a visually
distinct "copy this for your data team" block. `parseUpload.ts`'s `parseXlsxFile` now
classifies every sheet in an uploaded workbook independently by its columns and merges the
results — see `.claude/rules/template-parsing.md`. Boarding-seasonality inputs changed
shape too: `monthlyBoardingFactor`/`dayOfWeekBoardingFactor` (pre-computed multipliers,
typed by hand last session) are gone, replaced by `monthlyBoardingHoursTotals`/
`dayOfWeekBoardingHoursTotals` (raw totals as pulled from a report) — the engine now
derives the seasonality index itself (`total / (grand_total / periods)`). (2) **Boarding
output redesign**: `computeBoarding()` no longer runs a shift-fit solve at all —
`solveBoardingCoverage()` was deleted from `engine/solver.ts`. Instead it ranks
(month?, day, shift) slots descending by required annual care hours (reusing
`shiftHoursOfDay()` to attribute each hour's demand to its covering shift, splitting
hand-off hours evenly), with a running cumulative % of total annual boarding hours — the
primary output now, not `BoardingCoverageSet[]`/`granularity`/flat-FTE-first framing (both
removed from `BoardingResult`). Month is only a ranking dimension when
`monthlyBoardingHoursTotals` is provided (otherwise `slot.month` is `null` for all slots —
"coarser but still useful," per the ask); day-of-week ranking is always present since the
base curve is inherently day-varying even without explicit seasonality data.
`BoardingCoverageSection.tsx` shows the top 8 slots with a "show N more" expansion, not the
full list or a grid. (3) **Lost-productivity metric** (`EngineResult.lostProductivity`,
Productivity Target Buffer method) carried over unchanged from the prior build — still a
4th stat in `CoreGridTab.tsx`'s `.wHPPV-unit`. (4) **Volume step**: the 6-band EDBA
comparison table removed; replaced with one inline p25–p75 sentence for the user's own
band; all "EDBA" naming removed from user-facing copy (`edbaLookup.ts` itself untouched).
(5) Dashboard stayed a single scrolling page (unchanged from 2026-07-13); `SetupScreen.tsx`
now a 4-step wizard (Data, Volume, Shift menu, Review) instead of 5. New/rewritten tests:
`engine/__tests__/boarding.test.ts` (conserved-total property, seasonality-index derivation,
month/day-of-week ranking behavior, degrade-to-shift-block-only), `lib/__tests__/
parseUpload.test.ts` (multi-tab workbook parsing: full upload, arrivals-only subset,
partial-fill-treated-as-absent, unrecognized workbook), new `lib/__tests__/template.test.ts`
(no seeded values across all four tabs); `reconcile.test.ts` and core-grid solver tests
untouched (core allocation/solve math didn't change). Verified end-to-end in a headless
browser: downloaded template has exactly the four tabs, blank except headers; explainer and
copy-team block both render and are visually distinct; an arrivals-only upload leaves
boarding/lost-productivity absent with no console errors; a fully-filled upload (arrivals +
scalars + monthly/day-of-week seasonality) produces a priority list whose cumulative %
reaches exactly 100% at full expansion (shift menu fully tiles 24h, no gap loss) and whose
top-ranked slot correctly reflects the seasonality weighting (December, the boosted month,
ranks first); Volume step shows only the IQR sentence, no table, no "EDBA" text anywhere on
the page; dashboard renders as one scroll with no tab navigation. `npm run build` and
`npm test` (39 tests) both clean.

**Built (2026-07-22 current-staffing comparison + coverage-summary renames + incremental
boarding grid):** Three results-dashboard changes, planned in Cowork, confirmed with Ben.
(1) **Current staffing comparison**: `CoreGridTab.tsx` gained a "Current staffing" card —
a second day × shift-menu grid, user-editable, starting blank (`currentStaffingGrid` in the
store, `null` until edited, deliberately never seeded from the idealized `result.grid` —
see Section 6's store-shape rule for why this is NOT `gridOverride`), plus a diff grid
(idealized − current, `+N`/`-N` per cell), a weekly-hours-variance stat, and the current
grid's own shortfall/ENA-floor-violation numbers via the existing `recomputeAfterEdit`
arithmetic (no re-solve, no new engine math) against `currentStaffingGrid ?? {}`. (2)
**Coverage-summary renames** (labels only, calculations unchanged): "Shortfall hours" →
"Hours Below Ideal Coverage"; "ED-facing wHPPV after boarding" → "Effective ED wHPPV
(accounting for boarding)". (3) **Boarding coverage redesign**: third reversal of this
section's output shape (see `.claude/rules/boarding-seasonality.md` for the full history) —
`BoardingCoverageSection.tsx` now renders an incremental day × shift-menu grid (`+N`
nurse-shifts per cell) built by funding the top-K of the unchanged `prioritySlots` ranking
(`deriveBoardingCoverageCells`, pure aggregation, no solver call — `solveBoardingCoverage`
stays deleted), controlled by a funding slider defaulting to whatever reaches the p25 wHPPV
benchmark band (`fundedCountToReachWhppv`) with full-target wHPPV shown only as a secondary
reference, live "% of annual boarding hours covered" and "Effective ED wHPPV at this
coverage" stats (`effectiveEdWhppvAtCoverage` — **ASSUMPTION**: linear proportional
recovery, not yet validated against real data, flagged in both the rules file and the
section's "how is this calculated" explainer), and a day-of-week-only/day-of-week×month
view toggle (month view gated on `hasMonthlySeasonality`). The old ranked-table-with-
"show more" is gone entirely, not collapsed. New engine tests in `boarding.test.ts` cover
`deriveBoardingCoverageCells` (aggregated vs. single-month views, funding-count clamping),
`effectiveEdWhppvAtCoverage`, and `fundedCountToReachWhppv` (including the documented
never-returns-0 edge case). Verified end-to-end in a headless browser (Playwright):
arrivals-only flow shows the current-staffing/diff grids and renamed coverage-summary
stats correctly with boarding in its degraded "not produced" state; a full template upload
(arrivals + admit rate + mean boarding duration + monthly/day-of-week seasonality) drives
the boarding grid through its default recommended-funding state, the day-of-week×month
toggle with a December selection (correctly showing only December's funded cells), and a
full-funding slider drag (100% coverage, Effective ED wHPPV equal to the full target) —
zero console errors, `npm run build` and `npm test` (55 tests) both clean.

**Built (2026-07-24/25 Results-page & setup redesign — `RESULTS_PAGE_REDESIGN_SPEC_2026-07-24.md`):**
The full root-to-branch Results/setup redesign, in section-boundary PRs (detail in
`.claude/rules/results-redesign.md`; each verified end-to-end in headless Playwright, zero
console errors, `build`/`lint`/`test` clean throughout). **§1** optional current-staffing grid
added at setup via a shared store-driven `CurrentStaffingGrid` (setup + results write the same
field). **§2.1** `CurrentStaffingAnalysis` opening section (realized-wHPPV-vs-band headline,
backlog lean-stretch, effective-wHPPV-after-boarding preview; CTA when absent). **§2.2** the
idealized/current/diff cards collapsed into one comparison unit + the budget-gap-vs-shape-gap
reconciliation. **§2.4** backlog diagnostic — new `engine/backlog.ts` (`computeBacklog`,
ASSUMPTION, decay 0.85/hr, circular no-reset, diagnostic-only) surfaced in §2.1 + as the heatmap
overlay (superseding the p25 single-hour flag, keeping the ENA-floor flag). **§2.5**
`BoardingTransition` narrative bridge. **§2.6** boarding coverage rebuilt as a single
representative-week grid with month-SCOPE-only toggles (removed the annual-aggregation helpers).
**§2.3** `engine/flexMenu.ts` shift-menu flexibility search (bounded/opt-in/advisory — the
documented reversal, see Section 7) + `ShiftMenuFlexibilitySection` + `FlexAxesToggles`, absorbing
and deleting `CompareTab`. **§3** removals: the ESI-mix confidence banner and the standalone
Compare section. **§5** all four open judgment calls resolved with Ben. Engine test count grew to
69 (added `backlog.test.ts`, `flexMenu.test.ts`; rewrote `boarding.test.ts` to the new model). No
export feature (spec §0 deliberately declined one). CLAUDE.md refreshed to match in the same pass.

**Built (2026-07-26 Step 3 trim reversal + Phase 2 backlog/variance work —
`BACKLOG_FEEDBACK_AND_VARIANCE_SPEC_2026-07-25.md`):** Full detail in `.claude/rules/
engine-solver.md`'s "Budget-capped trim" section (now four shapes of this area's history,
each documented with its own "why"). Summary: the Step 3 budget trim was reversed from a
per-day linear-shortfall minimizer to a JOINT whole-week trim minimizing marginal
BACKLOG-hours (`engine/solver.ts`'s `trimWeekToBudget`/`candidateCutCost`), with the
p25-cohort band floor demoted from a cost term to a large-but-finite guardrail penalty — a
deliberate reversal of "backlog is diagnostic-only, never feeds the solver." **Phase 2a**
added an optional busy-hour (`arrivalsP75`) template column feeding a new
`demandVolatilityHourly` curve (`engine/demandBand.ts`) that raises the same band floor (and
the trim's marginal cost) at genuinely volatile hours — provably never touching
`annualVisits`/`annualCoreRnHoursBudget`/`hourlyRequirement`, keeping the reconciliation
invariant exactly intact. **Phase 2b** added a true backlog-FEEDBACK loop
(`engine/backlogFeedback.ts`'s `solveShiftFitWithBacklogFeedback`) — an iterative relaxation
that re-trims against a progressively-raised local floor wherever inherited backlog is
material, up to 8 passes, returning whichever pass had the lowest total backlog-hours (not
necessarily the last, an oscillation safety net) — now `compute()`'s primary idealized-grid
solve path. New `EngineResult` diagnostics: `demandVolatilityHourly`,
`backlogFeedbackPassCount`, `backlogFeedbackStillImprovingAtCap`. `flexMenu.ts`'s
bounded candidate search deliberately stays on the plain one-shot `solveShiftFit` (inherits
the trim reversal + Phase 2a's volatility cost, since those live inside `solveShiftFit`
itself, but NOT Phase 2b's relaxation loop, a separate function `compute()` calls instead) —
flagged as an open question in engine-solver.md, not silently decided. Engine test count grew
to 96 (`demandBand.test.ts`, `backlogFeedback.test.ts` new; `solver.test.ts`/
`flexMenu.test.ts` rewritten for the new signatures/objective). `reconcile.test.ts` passes
completely UNMODIFIED through every reversal in this entry — it never touches solve output in
the first place. `npm run build`/`npm test`/`oxlint` all clean throughout.

**Built (2026-07-26 solver realism, PRs A-D — `SOLVER_REALISM_SPEC_2026-07-26.md`):** four
sequenced PRs, each independently reviewable, each landed in dependency order (A changed which
hours a shift covers, so B/C were written against corrected semantics; C's severity function
runs on the backlog curve B produces; D's narrative depends on B and C's outputs). Full detail
in `.claude/rules/engine-solver.md`'s "Budget-capped trim" section (now SIX shapes of that
area's history) and `.claude/rules/results-redesign.md`'s PR D section. Summary:
- **PR A** — shift-hour attribution reversed from day-local circular to GLOBAL-WEEK circular
  (`shiftGlobalHours`, renamed from `shiftHoursOfDay`) — a Saturday-night shift no longer wraps
  back into Saturday's own early hours; it correctly spills into Sunday, and Saturday's early
  hours now correctly reflect FRIDAY night's crew. Touched `solver.ts`, `backlog.ts`,
  `boarding.ts`, `bandFloor.ts`, `backlogFeedback.ts`, and both heatmap consumers. Total
  scheduled hours unchanged by construction (pure attribution redistribution).
- **PR B** — the single-decay backlog model (`backlogHourlyDecay = 0.85`) retired for three
  named processes (`backlogAbandonRate`/`backlogRecoveryEfficiency`/`backlogMaxDrainFraction`),
  fixing the old model's unconstrained-symmetric-recovery bias (a spare nurse-hour no longer
  retires a queued nurse-hour 1:1, unboundedly). The recurrence itself moved to a new leaf
  module, `engine/backlogModel.ts`, ending the `backlog.ts`/`solver.ts` duplication.
- **PR C** — the trim's objective reversed from a LINEAR sum of marginal backlog-hours to a
  CONVEX severity function (`severity = (backlog/requirement)^1.8`), with peak severity
  promoted from a tie-break to a real cost term and the `1e6` floor-breach cliff retired for a
  finite power-law penalty (`FLOOR_WEIGHT * depth^2`). Split the composed band-floor curve into
  a clamped reporting curve (`bandFloorHourly`) and an unclamped solver-facing one
  (`protectedFloorHourly`) — a genuinely spiky hour can now be protected ABOVE the point
  target, which the old clamp could never express.
- **PR D** — the funding-ask surface (`fullCoverage`/`marginalCurve`/`marginalKneePoint` on
  `EngineResult`, `FundingAskSection.tsx`) plus a pass of results-page copy fixes across
  multiple files that had drifted false through the A/B/C reversals (the "why" explainer, the
  front-loaded-nursing premise, the backlog headline naming WHEN, the "Hours below the peer
  25th-percentile staffing floor" relabel), a second widening of the flexMenu candidate space
  (swing-shift overlays), and one new setup question (headcount semantics — display-only, not
  role modeling). The heatmap's cell number/color mechanism reversed a second time (per-hour
  band drives both now, see Section 6).

Across all four: `reconcile.test.ts` passes completely UNMODIFIED (never touches solve output).
Engine test count reached 121. `npm run build`/`npm test`/`oxlint` clean after every PR,
verified end-to-end in headless Playwright at least once per PR (heaviest for PR D, which
covered the full setup-to-results flow including the funding-ask under-budget edge case, the
flex-menu overlay search, and the current-staffing comparison narrative).

**Built (2026-07-26 PR E, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §4 — backlog realism,
SEVENTH shape of the Step 3 trim's history):** REVERSAL of part of PR B — the physics were
never wrong, the reporting layer destroyed the evidence (a real department's own current-
staffing grid genuinely clears its queue overnight every night, but the page reported
`neverClears: true` / "168 of 168 hours behind"). `BacklogResult` now splits STRUCTURAL (per-day
trough of the actual curve — a budget signal) from CYCLICAL (same recurrence against capacity
rescaled to match requirement's own weekly total — isolates shape from size); CYCLICAL now
drives the Step 3 trim's own objective (`candidateCutCost`/`summarizeBacklogSeverity` — a
fixed-budget trim can only fix shape, never size). `BACKLOG_CAUGHT_UP_THRESHOLD`'s flat 0.5-hour
bar retired for `caughtUpThresholdForHour` (~10% of an hour's own requirement) — a queue drained
to 2% of a real-world peak no longer misreads as "still behind." `maxDrainFraction = 0.3` was
investigated (swept across realistic spare-capacity levels) and REPORTED, not retuned: it
meaningfully prevents the peak-cutting bias across the realistic 4-6-nurse-hour spare range, per
the spec's own "report before you tune" instruction. New `EngineInputs.lwbsRate` (optional,
derives `abandonRate` from the department's own LWBS data) and `EngineResult.
estimatedAbandonedHours` (nurse-hours the recurrence's attrition term removes — never a dollar
figure). Full detail in `.claude/rules/engine-solver.md`'s PR E section. `reconcile.test.ts`
passes with a zero-line diff. Engine test count reached 133. `npm run build`/`npm test`/`oxlint`
clean (only the pre-existing `StepIndicator.tsx` warning).

**Built (2026-07-26 PR E0, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §12.5 — synthetic
department fixtures):** the test harness the rest of the E-L PR sequence (results-comprehension
redesign) is verified against, built first so it doesn't need retrofitting later. New
`src/lib/__fixtures__/syntheticDepartment.ts` (`generateSyntheticDepartment`, a pure parametric
generator — hour-of-day arrival shape, day-of-week amplitude, boarding seasonality, current-
staffing ratio/day-night-split or shape-follows-ideal) + `namedDepartments.ts` (the seven §12.2
department profiles as frozen parameter sets: A-G) + two new engine tests,
`syntheticSweep.test.ts` (245 parametrically-generated departments, invariants only — no crash,
no NaN/Infinity, no negative headcount, `fullCoverage >= weeklyScheduledHours` except where the
ENA floor legitimately dominates, staffing-FTE >= coverage-FTE, plus an inert PR-H-gated
`narrative.ts` sign-assuming-copy hook) and `syntheticFixtures.test.ts` (one test per named
profile asserting its qualitative conclusion, so a regression fails by profile name). Full
detail, including why `currentShapeFollowsIdeal` was added mid-build (profile G was otherwise
unreachable through the day/night-split model alone) and why no Playwright harness exists yet
in this repo, in `.claude/rules/synthetic-fixtures.md`. Engine test count reached 130.
`npm run build`/`npm test`/`oxlint` clean (only the pre-existing `StepIndicator.tsx` warning).

**Built (2026-07-26 PR F, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §3/§5/§6.2 — budget
framing, Scenario B, hidden-boarding diagnostic):** three parts. **(1)** Copy-layer rewrite —
the target-derived figure is never called a "budget" in the UI anymore (engine field names
unchanged), enforced by a live source-grep test (`src/lib/__tests__/copyLayer.test.ts`) that
already caught two of this PR's own new files using the word. Overcoverage now computes against
CURRENT staffed hours (suppressed with no current staffing, never silently falls back to
target). New delivery-premium disclosure line (shift-block granularity cost, named honestly
instead of folded into "% overcoverage"). **(2)** `engine/index.ts`'s `computeScenarioB` — "the
same hours, better placed" (spec §5), a pure parameter swap over the existing
`solveShiftFitWithBacklogFeedback` pipeline, surfaced in new `ScenarioBSection.tsx`. Every
render states its arrivals-only bound loudly — never presented as a standalone recommendation.
**(3)** New `engine/hiddenBoarding.ts`'s `computeHiddenBoardingDiagnostic` — "the advocacy
artifact" (spec §6.2): per day(07-19)/night(19-07) block, current capacity minus arrivals-only
requirement, plus boarding need when available. New `HiddenBoardingSection.tsx` DEGRADES TO A
PROMPT (not null) when boarding data is absent, per §12.2 profile D. Templated narrative with
tested mirror-branches for both directions plus a negligible case, per §12.1's generality
contract. Full detail in `.claude/rules/results-redesign.md`'s PR F section. Engine test count
reached 143 (`scenarioB.test.ts`, `hiddenBoarding.test.ts`, `copyLayer.test.ts` all new).
`npm run build`/`npm test`/`oxlint` clean (only the pre-existing `StepIndicator.tsx` warning).

**Built (2026-07-26 PR G, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §7 — synthesis chapter +
reframed funding ask):** PR F must be merged first. New `engine/synthesis.ts`'s
`computeSynthesis` — arrivals + boarding demand added back together FOR THE READER ONLY (never
`EngineResult.grid`), reporting FOUR NUMBERS + a subtraction (`gapHours`, can be `<= 0` — a real
ending) and stopping there, per spec §1(5)'s explicit instruction against an interpretive
closing sentence ("the rest is not a scheduling problem" was called out as exactly the
overcommitment to avoid). Reuses `computeScenarioB`'s parameter-swap technique against a
COMBINED arrivals+boarding demand curve for `gapClosedByReallocationHours`. New
`SynthesisSection.tsx` (rendered last in `DashboardScreen`) renders exactly this arithmetic.
Three tested endings per §12.3 (need more / enough but misplaced / already fine).
`FundingAskSection.tsx`'s headline REORDERED to lead with the marginal-curve KNEE (the ask that
buys the most per FTE) with full coverage as "the far end of that range," reversing the old
full-coverage-first order that buried the knee. New `FinancePartnerWorksheet.tsx` — the
mechanism chain in the tool's own units, an explicit no-dollars statement, and a worksheet
naming the FTE ask + a MODELED (labeled, not independently recomputed) abandoned-hours
reduction + the three numbers a CFO already owns. No dollar/ROI calculator anywhere (spec §13,
reaffirmed). Full detail in `.claude/rules/results-redesign.md`'s PR G section. Engine test
count reached 148 (`synthesis.test.ts` new). `npm run build`/`npm test`/`oxlint` clean (only the
pre-existing `StepIndicator.tsx` warning).

**Built (2026-07-26 PR H, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §8 — page architecture):**
PR G must be merged first. New `components/ChapterRail.tsx` — sticky (desktop-first, per §12.3's
mobile carve-out), `IntersectionObserver` scroll-spy, click-to-jump; `DashboardScreen.tsx` owns
the chapter list/order and wraps each top-level section in an `id`-carrying div the rail
targets. **Scope note, flagged in both files:** the rail's 6 entries match the ACTUAL top-level
sections rendered today, not a forced 1:1 mapping onto spec §8's full 9-chapter list (several
spec chapters are still bundled inside one monolithic `CoreGridTab`) — a real, deferred
follow-up. **The philosophy statement** (spec §6.1's exact quoted text as originally built,
MERGED with PR D's front-loaded-nursing premise into one banner) added near the top of
`CoreGridTab` — both were read before any recommendation, so stacking two separate banners
there was exactly the friction this redesign removes. **Rewritten FOUR times on 2026-07-27,
see `.claude/rules/results-redesign.md`'s PR H section for the full history** — the FINAL
copy is a `.results-welcome` section (real `<h2>Your ShiftLens Results</h2>` next to the app's
`/favicon.svg` mark, no border/card styling — heading text + icon added in a 5th revision the
same day) stating the product-philosophy rationale for the two-budget split, with all
backlog/task-time mechanics removed from this banner (that detail lives in
`CurrentStaffingAnalysis.tsx`'s collapsed "why" toggle). **Also moved (2026-07-27, same day) out
of `CoreGridTab` and up into `DashboardScreen.tsx`**, rendered above `.dashboard-body` so it
spans the full page width and sits above the chapter rail rather than beside it; the redundant
`<h1>ShiftLens — Results</h1>` page title that used to sit above it in `.dashboard-topbar` was
removed in the same pass (duplicative of `.results-welcome`'s own heading) — `.dashboard-topbar`
now holds only "← Back to setup" (top-left) and "Export to PPTX" (top-right). **New
`src/lib/narrative.ts`** — every templated headline as a
pure function (no JSX), covering the sections built in PRs E-G; unit-tested directly
(`lib/__tests__/narrative.test.ts`) and now genuinely exercised by `syntheticSweep.test.ts`'s
narrative hook (previously a no-op since the module didn't exist). Covered components still
render their own inline JSX rather than calling these functions yet — flagged in the file's own
header as a deliberate, temporary duplication (worded identically on both sides) rather than a
risky wholesale swap without browser access to re-verify. **Removals:** the ASSUMPTION pill on
`CurrentStaffingAnalysis.tsx`'s backlog diagnostic is gone (EvidenceBadge stays in setup); the
realized-wHPPV range now spans the 168 HOURS (not 7 days) and NAMES the hour each extreme falls
on, reusing the heatmap's own already-computed per-cell values. No engine changes. Engine/lib
test count reached 156. `npm run build`/`npm test`/`oxlint` clean (only the pre-existing
`StepIndicator.tsx` warning). **No Playwright verification was possible** (no such harness in
this repo) — rail scroll-spy/jump behavior and the merged banner's visual layout are unverified
in an actual browser this session.

**Built (2026-07-26 PR I, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §8 — evidence surface,
Chapter 9):** PR H must be merged first. New `screens/dashboard/EvidenceSurfaceSection.tsx` —
"How this works," rendered last, collapsed by default, visually set apart
(`.evidence-surface`). Six parts: a pipeline walkthrough (Steps 1/1b/1c/2/3, formula + why);
a constants table (new `lib/constantsMetadata.ts`'s `buildConstantsTable()`, GENERATED FROM
`DEFAULTS` AT RUNTIME — throws if a `DEFAULTS` key lacks metadata, so the table can't silently
go stale); data provenance (your data / peer cohort / modeled assumption — replaces the
ASSUMPTION pill PR H removed); known approximations (the 48-hour backlog window, linear
boarding recovery, month-scope conservation, circular no-reset, greedy set-cover, derived
boarding census); the reconciliation invariant presented as a LIVE correctness proof (reads
`result.reconciliation` directly, not a static claim); and decisions/rejected alternatives
(mean-not-median boarding duration, why p75 never enters the point target, severity
normalization, no dollar layer, the separate-demand thesis). Success condition, per spec: an
analyst can reconstruct the pipeline from this page alone and find nothing undisclosed. No
engine changes. Test count reached 157 (`constantsMetadata.test.ts` new). `npm run build`/
`npm test`/`oxlint` clean (only the pre-existing `StepIndicator.tsx` warning).

**Built (2026-07-26 PR J, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §8 — teaching layer):** PR
H must be merged first. New `components/ConceptCallout.tsx` (reuses the `.why-toggle` pattern)
— six inline concept explainers, each at its first use: wHPPV/front-loaded-nursing/averages-
under-staff-you-half in `CoreGridTab.tsx`, right-total-vs-shape/depth-beats-spread in
`ScenarioBSection.tsx`, two-budgets-one-department in `HiddenBoardingSection.tsx`. New
`components/ConvexityDemo.tsx` — THE ONE interactive, spread-vs-concentrated 10-nurse-hour
shortfall scored with the REAL `severity` function from `engine/solver.ts`, verified by
`engine/__tests__/convexityDemo.test.ts`. No glossary page; collapsed by default everywhere. No
engine changes beyond the new test. Test count reached 158. `npm run build`/`npm test`/`oxlint`
clean (only the pre-existing `StepIndicator.tsx` warning).

**Built (2026-07-26 PR K, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §10/§6.3 — input
integrity + boarding copy + constrained reallocation):** PR F must be merged first. New
`lib/inputIntegrity.ts` — `checkBoardingDurationConsistency`/`checkMonthlyDispersion`,
diagnostic-only, never auto-correcting, wired live into `DataStep.tsx`'s upload flow.
`CoreGridTab.tsx` gained a NEW banner reading `result.esiConfidenceFlag` (a previously-computed,
previously-unrendered field) stating the CONSEQUENCE of a missing ESI mix at results time, not
just setup time. `BoardingCoverageSection.tsx`'s "how is this calculated" explainer REWRITTEN
from apology to shopping list — every derivation paragraph now names the better data that would
replace it and roughly where it lives. `engine/synthesis.ts`'s reallocation logic extracted into
a new exported `computeCombinedReallocation` (PR G's `computeSynthesis` now calls this instead
of an inlined copy) powering new `ConstrainedReallocationSection.tsx` — "if you can't get
additional hours for boarding," a named-cost compromise, never the recommendation. Test count
reached 169 (`inputIntegrity.test.ts`, `combinedReallocation.test.ts` new). `npm run
build`/`npm test`/`oxlint` clean (only the pre-existing `StepIndicator.tsx` warning).

**Built (2026-07-26 PR L, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §9 — PPTX export):** PRs H
and I must be merged first. New dependency `pptxgenjs@4.0.1` (client-side only — `writeFile()`
triggers a browser download, nothing uploaded; no new high-severity `npm audit` findings
attributable to it). New `lib/pptxExport.ts`'s `exportResultsToPptx` — slide titles pulled from
`src/lib/narrative.ts`'s functions (the same wording the results page uses), deck order mirrors
the chapter rail, Method & Limitations ALWAYS included (uses the same
`lib/constantsMetadata.ts` table PR I's evidence surface uses), grids as native PPTX tables
(not images), speaker notes on every slide. Boarding + constrained-reallocation slides are
OMITTED (not empty-placeholder) when `result.boarding` is null. New "Export to PPTX" button in
`DashboardScreen.tsx`'s topbar, behind a dynamic `import()` so `pptxgenjs` loads into its own
chunk only when clicked (main bundle unaffected). Test count reached 173
(`pptxExport.test.ts` new — spies on `writeFile`/`addSlide` to verify slide construction and
boarding-absent skipping without ever writing a real file to disk during tests). Not verified
this session: the generated `.pptx` file was not opened in PowerPoint/Keynote (no such tooling
available in this environment). `npm run build`/`npm test`/`oxlint` clean (only the
pre-existing `StepIndicator.tsx` warning).

**Built (2026-07-27, `SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md` + same-day guided-setup/
export follow-up prompt — measured boarding census, guided setup walkthrough, data export,
ESI normalization):** full detail in `.claude/rules/boarding-seasonality.md`'s (measured path)
and `.claude/rules/template-parsing.md`'s (everything else) own sections for this date; summary:
- **Measured boarding census** — a new PRIMARY boarding input alongside (not replacing) the
  derived admit-rate/duration path. `computeBoarding` uses a directly measured 168-cell census
  (medical + optional BH, different RN ratios — default 1:4/1:10) exclusively when present, no
  blending. RN-hour-weighted two-stream monthly seasonality. Counted from BED REQUEST, never
  arrival — no clock-start setting exists (one was built and reverted same session, see below).
  `BoardingResult` gained `medicalWeeklyRnHours`/`bhWeeklyRnHours`/`censusSource`.
- **Guided setup walkthrough** — `DataStep.tsx` deleted, replaced by `SetupEntryFork.tsx`
  (3-card fork: tutorial / colleague-request / returning-upload) → `TutorialFlow.tsx` (one
  guided item per screen: arrivals, current staffing, P75, boarding [forked via
  `BoardingFork.tsx`], boarding seasonality, ESI mix) or `ColleagueRequestPage.tsx`.
- **Data export round-trip** — `ReviewStep.tsx`'s "Download my data file," the app's only
  persistence. Reuses the blank template's own generator functions fed real values; tested
  directly for exact round-trip equality (`lib/__tests__/exportRoundTrip.test.ts`).
- **ESI mix auto-normalization** — new `engine/allocate.ts`'s `normalizeEsiMix`, the one
  sanctioned auto-correction in the app (an un-normalized mix summing to e.g. 126% of arrivals
  is arithmetically impossible, not merely suspicious): preserves ESI 3, scales ESI 1-2/4-5
  proportionally (falls back to scaling all three if ESI 3 alone exceeds arrivals). Applied
  inside `weightedArrivals` before acuity weighting; disclosed at the ESI tutorial step and on
  the evidence surface.
- **Pre-bed-request census validation (§7, optional)** — new `engine/preBedRequestValidation.ts`,
  a small evidence-surface-only diagnostic comparing observed occupancy against the
  arrivals-implied curve. No solver interaction, no recommendation change.
- **Two REVERSALS within this same session, both reverted before landing:** a Settings tab
  (policy values in the upload — violated the standing data-vs-policy-in-UI rule) and a
  `boardingCensusClockStart` field with an arrival-clocked variant + caveat banner (a caveat
  beside a wrong number isn't a fix, especially feeding the synthesis chapter). Neither exists
  in the final code — see `.claude/rules/template-parsing.md`'s reversal sections before
  reintroducing either.
- Synthetic fixtures: new profile H (`measuredBoardingCensus`) + `boardingInputMode`/
  `bhCensusPresent` swept across the 240-case sweep (primes 41/43). Test count reached 196
  (`allocate.test.ts`, `exportRoundTrip.test.ts`, `preBedRequestValidation.test.ts` new; several
  existing files extended). `npm run build`/`npm test`/`oxlint` clean (only the pre-existing
  `StepIndicator.tsx` warning). No Playwright/component-test verification was possible (no such
  harness in this repo) — the guided walkthrough's screen-by-screen flow is UNVERIFIED IN AN
  ACTUAL BROWSER this session; a future session with visual access should confirm before
  treating the UI (as opposed to the engine/parser, which are fully tested) as battle-tested.

**Built (2026-07-27, PR A0 of `RESULTS_PAGE_V2_SPEC_2026-07-27.md` — Playwright browser test
harness):** the first committed browser-level test suite in this repo. `@playwright/test` +
`playwright.config.ts` (chromium, desktop viewport, `webServer` runs `npm run dev`) + `npm run
test:e2e`. A dev-only seeding hook (`src/lib/testSeed.ts`'s `window.__shiftlensSeed`, wired
from `main.tsx` behind `import.meta.env.DEV` — dead-code-eliminated from production builds)
loads a `NAMED_DEPARTMENT_PARAMS` synthetic profile straight into the store and jumps to the
results page, no stepping through setup. `e2e/smoke.spec.ts` covers all eight named profiles
(A-H): results page renders, zero console errors (hard assertion), zero uncaught page errors,
no `NaN`/`undefined`/`{{` visible in the page's own text, one full-page screenshot per profile
saved to gitignored `e2e/screenshots/` for human review. New `vitest.config.ts` (vitest
previously had no config file) excludes `e2e/**` so `npm test`/`npm run test:e2e` stay separate
suites — vitest was otherwise picking up and failing on the Playwright specs. See
`.claude/rules/synthetic-fixtures.md`'s Playwright section for the full detail. This is the
prerequisite the rest of `RESULTS_PAGE_V2_SPEC_2026-07-27.md` (PRs A-H, a five-panel results-
page rebuild) needs before any of its visual work (PR D onward) can be verified rather than
just claimed. `npm run build`/`npm test`/`oxlint`/`npm run test:e2e` all clean.

**Built (2026-07-27, PR A of `RESULTS_PAGE_V2_SPEC_2026-07-27.md` §5.1/§5.2 — backlog
reporting confirmation + pattern namer):** PR A0 must land first (verification tooling).
**§5.1:** confirmed, per the spec's own instruction, that the heatmap's backlog overlay
(`CoreGridTab.tsx`/`CurrentStaffingAnalysis.tsx`) reads `BacklogResult.backlog` (the ACTUAL
blended curve) against the old absolute `BACKLOG_CAUGHT_UP_THRESHOLD` — never migrated to PR
E's structural/cyclical split or its relative `caughtUpThresholdForHour`. This is the
mechanical cause of both the §3.1 misleading-stat bug AND the §3.2 near-uniform-spine
artifact; recorded in `.claude/rules/engine-solver.md`'s new PR A section. No engine change
was needed — `cyclicalBacklog`/`structuralFloorByDay`/`structuralFloorMin` all already exist
(PR E); only the UI never read them. The actual reporting/UI fix (replacing the stat, removing
the spine) is deferred to PRs D/E per the spec's own PR sequence — this PR only confirms and
records the finding. **§5.2:** new `src/lib/whenPattern.ts`'s `namePattern(values168,
direction)` — the shared "when is it worst" phrase generator (5-rung ladder, see Module Map
above). **Flagged finding, not silently patched:** rung 3 (single day × block) is
mathematically unreachable under the spec's own fixed thresholds for a 168-hour input —
proven directly in `src/lib/__tests__/whenPattern.test.ts` (6 tests: rungs 1/2/4, the
fallback, a direction-flip check, and a maximally-concentrated rung-3 attempt that still falls
through). Test count reached 212. `npm run build`/`npm test`/`oxlint`/`npm run test:e2e` all
clean. No UI changes in this PR (per the spec's own PR-sequence table — "Engine/lib only, no
UI").

**Built (2026-07-27, PR B of `RESULTS_PAGE_V2_SPEC_2026-07-27.md` §5.3 — full coverage over
combined demand):** new `EngineResult.fullCoverageCombined: { weeklyHours: number; grid: Grid
}` — Panel 3's ceiling ("what would it take to fully cover the department"), reusing
`solveFullCoverageWeek` verbatim against `hourlyRequirement + boarding.cellBoardingRnHours`
(no second solver). Resource-agnostic by construction (no hold/ED concept — §3.5 is
Panel-5-only). Always computed, never null — degenerately equals `fullCoverage` when boarding
is absent, the mathematically correct answer rather than a guarded special case. See
`.claude/rules/results-redesign.md`'s new "Results Page V2" section, PR B, for the full
detail including the one structural reorder this required in `compute()`. Test count reached
214 (`fullCoverageCombined.test.ts` new, including a direct capacity-vs-combined-demand
reconstruction, not just trusting the solver's own invariant). `reconcile.test.ts` passes with
a zero-line diff. `npm run build`/`npm test`/`oxlint`/`npm run test:e2e` all clean. No UI in
this PR, per the spec's own sequence.

**Not yet built:**
- Component/UI-level automated tests below the full-page e2e level (React Testing Library-
  style unit tests for a single component in isolation) — `engine`/`lib` have vitest coverage,
  the full results page now has Playwright e2e coverage (PR A0 above), but there is no
  middle tier yet.
- Mobile/responsive layout — built and verified on a standard desktop viewport only
- Dollar cost layer, arrivals seasonality, Monte Carlo — see Section 7. (Shift-menu search is now
  BUILT as a bounded advisory search — Section 7's reversal note.)
