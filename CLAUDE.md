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
  budget-trim ratio, department ENA floor pass, live-edit recompute, shift wraparound model
- `.claude/rules/template-parsing.md` — the ONE consolidated multi-tab data template:
  per-tab alias tables, day/hour/month tolerance, all-or-nothing optional-field rule,
  no-seeded-data constraint, and the history of admit-rate/boarding-duration moving
  template→scalar→template again (read this before "fixing" that back a third time)
- `.claude/rules/boarding-seasonality.md` — boarding hourly-census convolution (ASSUMPTION),
  the seasonality-index formula (mean-per-patient ratio against the Scalars-tab
  boardingDuration baseline), the priority-ranked (month?, day, shift) slot list, and the
  incremental day × shift-menu coverage grid built from it (third reversal of the boarding
  output's shape, 2026-07-22 — read the history there before touching it again)
- `.claude/rules/results-redesign.md` — the 2026-07-24 Results-page & setup redesign
  (`RESULTS_PAGE_REDESIGN_SPEC_2026-07-24.md`): per-section implementation notes as each PR
  lands, the shared `CurrentStaffingGrid` component + Section-1 setup grid, the pending
  Section-5 open judgment calls, and a STALE-DOC warning that this file's Screen Map/Feature
  Status boarding description lags the code by one revision (read boarding-seasonality.md for
  the section's current shape)

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
- `npm run build` (tsc -b + vite build), `npm test` (vitest run), `npm run dev` (localhost).
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
- **vitest** for engine/parser tests. No component/UI test framework wired up yet.
- No CSS framework — hand-written `src/App.css` + `src/index.css`, theme-aware via
  `prefers-color-scheme`. No design tokens system; colors are literal hex values scoped to
  those two files.

---

## 3. Screen Map

| Screen | Component | Purpose |
|---|---|---|
| Welcome | `src/screens/WelcomeScreen.tsx` | App entry point — brief description + "Start Setup" button. No previous-results navigation (no persistence yet, see Section 8). |
| Setup | `src/screens/SetupScreen.tsx` | Thin 4-step wizard shell (was 5, see Section 8 2026-07-14 entry) — step indicator, Back/Next, per-step gating — renders one of the `src/screens/setup/` step components below |
| — Step 1 | `src/screens/setup/DataStep.tsx` | **ONE consolidated data step** — plain-language explainer (what each field is, why the algorithm needs it, what happens if blank), a distinct "copy this for your data team" block, download/upload of the ONE multi-tab template (`lib/template.ts`), `ArrivalsGrid` manual touch-up, and the boarding-ratio-target policy field (the one typed field that stays, since it's a policy choice, not data to pull) — see `.claude/rules/template-parsing.md`. Replaces the old `ArrivalsStep.tsx` + `OptionalInputsStep.tsx` (both deleted 2026-07-14) |
| — Step 2 | `src/screens/setup/VolumeStep.tsx` | Annual volume override, wHPPV target pre-fill. No volume-band table anymore (removed 2026-07-14) — a single inline IQR sentence instead, framed generically ("similar-volume benchmark"), no "EDBA" branding anywhere in the UI |
| — Step 3 | `src/screens/setup/ShiftMenuStep.tsx` | `ShiftMenuEditor` wrapper (unchanged) |
| — Step 4 | `src/screens/setup/ReviewStep.tsx` | Summary of every input with per-field Edit links back to the owning step (admit rate/boarding duration/ESI mix/boarding seasonality all link back to Step 1 now); final `canContinue` gate lives in `SetupScreen.tsx` |
| Results dashboard | `src/screens/DashboardScreen.tsx` | **Not a tab container** (since 2026-07-13) — a single scrolling page rendering three section components in order, no navigation state |
| — Core grid section | `src/screens/dashboard/CoreGridTab.tsx` | The idealized staffing grid, a **Current staffing** comparison grid (user-editable, starts blank, never seeded from the idealized grid — 2026-07-22) with a diff grid (+N/−N per cell) and its own shortfall/ENA-floor numbers, and the coverage-summary (wHPPV/overcoverage/"Hours Below Ideal Coverage") unit (also carries the "Effective ED wHPPV (accounting for boarding)" stat) |
| — Boarding coverage section | `src/screens/dashboard/BoardingCoverageSection.tsx` | **Incremental day × shift-menu coverage grid** (redesigned 2026-07-22, third reversal of this section's shape — see `.claude/rules/boarding-seasonality.md`), funding a slider-controlled top-K of the still-unchanged `prioritySlots` ranking, `+N` incremental nurse-shifts per cell, day-of-week-only/day-of-week×month view toggle, live "Effective ED wHPPV at this coverage" — additive/separate from the core grid |
| — Compare section | `src/screens/dashboard/CompareTab.tsx` | Side-by-side shift-menu variants through the same solver |

Navigation is a single `screen: 'welcome' | 'setup' | 'dashboard'` field in the store
(`App.tsx` switches on it, default `'welcome'`) — no router. `setupStep: number` (0-3) in
the store tracks wizard position; `setSetupStep` clamps to `[0, 3]`. The dashboard has no
tab/section navigation state at all — `DashboardScreen` renders all three sections in a
fixed order (grid → boarding → compare) on one scroll.

---

## 4. Module Map

```
src/
  engine/
    types.ts       — all engine types + DEFAULTS (policy parameters, evidence-tagged in spec)
    allocate.ts     — Steps 1, 1b, 1c: weighted arrivals, cell-share allocation, day-of-week smoothing
    boarding.ts     — Step 2: hourly boarding-census curve (convolution, ASSUMPTION), a
                      seasonality index (mean-per-patient ratio against the boardingDuration
                      baseline), the priority-ranked (month?, day, shift) coverage-slot
                      list, and the incremental coverage-grid helpers built from it
                      (`deriveBoardingCoverageCells`, `effectiveEdWhppvAtCoverage` —
                      ASSUMPTION, `fundedCountToReachWhppv`) — see
                      .claude/rules/boarding-seasonality.md (withheld entirely if admit
                      rate/duration absent, same rule as always). No solved staffing grid
                      for boarding anymore — see Section 6.
    solver.ts       — Step 3 shift-fit solve (`solveShiftFit`) for the core grid only — see
                      .claude/rules/engine-solver.md. `solveBoardingCoverage` (a prior
                      session's boarding-specific solve) was removed 2026-07-14; boarding's
                      priority ranking reuses only `shiftHoursOfDay` from this file, not a solve.
    index.ts        — compute(): the single callable orchestrator; reconcile(); recomputeAfterEdit();
                      lostProductivity (Productivity Target Buffer metric)
    __tests__/      — reconcile.test.ts (Section 2.2 build-in check), solver.test.ts, boarding.test.ts
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
    edbaLookup.ts     — cohort volume-band → median/p25/p75 wHPPV lookup (the one sanctioned
                       shipped default). Filename/internal naming unchanged; the UI no
                       longer says "EDBA" anywhere (2026-07-14, Section 6).
    __tests__/
  components/
    EvidenceBadge.tsx    — ESTABLISHED/CONSENSUS/CONVENTION/ASSUMPTION/OPTIONAL inline badge
                          (OPTIONAL renamed from USER INPUT 2026-07-22 — every field on these
                          screens is user input, so the badge now flags optional-vs-required
                          instead; required fields keep whatever badge they already had, no
                          new REQUIRED badge was added)
    ArrivalsGrid.tsx      — editable 24×7 hour/day grid, used as setup-screen touch-up tool
    ShiftMenuEditor.tsx   — add/remove/edit (start, length) shift rows, reused in setup + compare tab
    WhppvHeatmap.tsx      — 7x24 realized-wHPPV heatmap inside CoreGridTab's wHPPV unit
  screens/
    WelcomeScreen.tsx  — entry point, "Start Setup" button, see Screen Map above
    SetupScreen.tsx    — 4-step wizard shell, see Screen Map above
    setup/             — one component per wizard step (DataStep, VolumeStep, ShiftMenuStep,
                         ReviewStep), StepIndicator, and applyParsedUpload.ts (applies
                         whatever subset of parsed fields a single upload contains —
                         arrivals/ESI/admit rate/boarding duration/both seasonality totals)
    dashboard/          — see Screen Map above
  store.ts            — zustand store: all engine inputs + setupStep + gridOverride + compareVariants
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
requirement curve, the solved grid, shortfall table, overcoverage %, reconciliation check
result, (if admit rate + boarding duration present) the boarding result — now an hourly
census curve plus a `prioritySlots` list ranked by required care hours, with a running
cumulative %, see `.claude/rules/boarding-seasonality.md` — and `lostProductivity` (null
iff boarding is null). See `engine/types.ts` for the full shape — it's the canonical
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
for boarding)". Don't confuse "Hours Below Ideal Coverage" (gap vs. `hourlyRequirement`,
this stat) with the heatmap's p25/ENA-floor risk flagging just below it — those stay
separate checks against different thresholds, this rename didn't merge them.

**Shift-menu columns always render sorted by `startHour`, never in array/creation order.**
`shiftMenu` in the store is unordered (shifts get appended wherever `ShiftMenuEditor`'s
"+ Add shift" or an upload leaves them), so any UI that builds columns/headers from it must
sort a local copy by `startHour` before rendering — see `sortShiftsByStartHour()` in
`CoreGridTab.tsx`. Otherwise a mid-shift added after Day/Night tacks onto the end of the
grid instead of sitting between them. This applies to any future shift-menu-driven grid
(e.g. if Compare tab's per-variant columns are ever revisited) — it's a rendering
convention, not something `compute()` enforces, since the engine only cares about each
shift's `startHour`/`lengthHours`, not menu order.

**The shortfall diagnostic inside the wHPPV unit is a 7x24 realized-wHPPV heatmap, computed
client-side.** `CoreGridTab.tsx` (rendering via `components/WhppvHeatmap.tsx`) computes a
per-(day,hour) realized wHPPV as `(onDuty ÷ cellArrivals) × scale`, where `onDuty` comes
from `coverageForDay()` (`engine/solver.ts`) and `scale` is the same day-level scaling
factor already used for the plain-summary min/max range, just applied at hour instead of
day grain — pure display arithmetic over already-computed fields, no new engine math.
Color is a continuous diverging scale (red = leaner, blue = richer) **centered on
`wHppvTarget`**, not an absolute judgment. A separate, non-color visual treatment (red
inset outline + a small "!" badge, both via CSS class `.heat-cell-risk`) flags any single
cell where realized wHPPV is below `lookupWhppvBand(annualVisits).p25Whppv`
(`lib/edbaLookup.ts`) or the cell's on-duty headcount is in the engine's
`enaFloorViolationsRemaining` — no consecutive-hour requirement, one hour is enough. This
replaced an earlier one-row-per-shift-type shortfall table (`summarizeShortfallByShift()`)
that rolled the per-hour `shortfall` array up by shift; that rollup is gone, not just
hidden. Don't move the heatmap's per-cell math into `engine/` unless a second consumer
needs it.

**Collapsed-by-default "why" explainer pattern.** `CoreGridTab.tsx`'s plain-language
summary panel (target wHPPV, weekly hours vs. budget, realized wHPPV range) has a
`.why-toggle` button that expands a `.why-explainer` block in plain, non-technical language
— collapsed by default so it doesn't clutter the headline numbers. If another screen needs
a similar "here's the plain-English reason" explainer, reuse this toggle pattern rather than
inventing a new one (e.g. a modal or tooltip).

**Boarding coverage is an incremental day × shift-menu grid now — third reversal of this
rule, confirmed with Ben.** "Boarding is never a shift grid" (original rule) was reversed
once, 2026-07-13, to a solved-grid model (`solveBoardingCoverage()`); reversed again,
2026-07-14, to a ranked list of (month?, day, shift) slots by required care hours (no grid
at all); reversed a third time, 2026-07-22, to a **grid** — but not the 2026-07-13 kind.
`BoardingCoverageSection.tsx` now renders a day × shift-menu grid (same shape as the
idealized core grid), each cell showing `+N` incremental nurse-shifts, funded by taking the
top-K entries off the still-unchanged `prioritySlots` ranking and mapping each into its
cell — a pure aggregation (`deriveBoardingCoverageCells`, `engine/boarding.ts`), NOT a
solver call. `solveBoardingCoverage()` stays deleted (see Section 4) — don't resurrect it;
that would be reverting to the 2026-07-13 model, which is a different thing from this grid.
A funding slider controls K, defaulting to whatever reaches the p25 wHPPV benchmark band
(`fundedCountToReachWhppv`), with full (100%) funding available but not the default. A view
toggle switches between an aggregated "day-of-week only" grid and a "day-of-week × month"
grid (one month at a time via a `<select>`, only shown when `hasMonthlySeasonality`). See
`.claude/rules/boarding-seasonality.md` for the full mechanism, including the
`effectiveEdWhppvAtCoverage` ASSUMPTION (linear proportional recovery, not yet validated).
What's stayed true across all three reversals: boarding output is never merged into
`EngineResult.grid` (it's additive/separate, rendered in its own section), and it has never
become a second full **168-cell hourly** grid — the day × shift-menu grid is coarser than
that, same as the core grid above it. Don't merge boarding into the core grid, and don't
render a 168-cell boarding grid without checking with Ben first.

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
solve should replace, not merge with, a stale manual edit).

**`currentStaffingGrid` (2026-07-22) is a separate concept from `gridOverride` — don't
merge them.** `gridOverride` layers a manual edit ON TOP of the solver's own recommendation
(same underlying idea, hand-corrected). `currentStaffingGrid` is a **comparison** grid —
"what are you actually staffing today" — entirely independent of the idealized
recommendation, starts `null`/blank, and is never seeded from `result.grid`. Read cells via
the same `grid[day]?.[shiftId] ?? 0` convention as everywhere else. `getCurrentStaffingResult()`
(unlike `getLiveResult()`) is unconditional — it always calls `recomputeAfterEdit` against
`currentStaffingGrid ?? {}`, since an all-zero/unset comparison grid is itself a meaningful
state to show (full idealized headcount as the diff), not an absent one to guard against.

---

## 7. Explicitly Out of Scope (per algorithm spec Section 7 + original build prompt)

Do not build these without an explicit, separate ask — they were deliberately declined:
- Dollar cost layer for boarding (placeholder shown in `BoardingCoverageSection.tsx`; needs
  RN salary + benefit-factor inputs, not yet collected)
- Seasonality modeling for **arrivals** (boarding seasonality — monthly/day-of-week factors
  — was built 2026-07-13, see `.claude/rules/boarding-seasonality.md`; arrivals still has
  no seasonality dimension, unchanged)
- Monte Carlo / percentile-based variability modeling anywhere in the core engine
- Auto-optimizing shift-menu search (Compare section is user-driven side-by-side only)
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

**Not yet built:**
- Any form of persistence (every reload starts from empty state)
- Component/UI-level automated tests (only `engine/` and `lib/parseUpload.ts`/`lib/template.ts`
  have vitest coverage)
- Mobile/responsive layout — built and verified on a standard desktop viewport only
- Dollar cost layer, arrivals seasonality, Monte Carlo, menu auto-search — see Section 7 above
