# CLAUDE.md — ShiftLens

Describes **how the code works now**. The algorithm itself is separately specified in
`../ShiftLens_Algorithm_Specification_v3.docx` (one level up, outside this repo) — that document
is authoritative for every formula, threshold, and evidence-status tag.

## Read this before you start

This file is a **navigation index**, not a history. It is deliberately short so a session
doesn't spend most of its context on orientation.

| Touching... | Read first |
|---|---|
| Anything in `src/engine/` | `.claude/rules/engine-solver.md` |
| Boarding demand or coverage | `.claude/rules/boarding-seasonality.md` |
| Templates, upload parsing, setup wizard | `.claude/rules/template-parsing.md` |
| Any results panel, the heatmap, PPTX export | `.claude/rules/results-redesign.md` |
| Test fixtures or the e2e harness | `.claude/rules/synthetic-fixtures.md` |

Each of those is a **current-state** file (4-9 KB). Each has a "load-bearing history" section
naming the specific areas that have reversed direction before. **If your change touches one of
those areas, read the matching file in `docs/archive/rules/` first** — those hold the full
decision record, including why each prior shape was wrong. Everything else you can take from the
current-state file alone.

`docs/archive/specs/` holds the completed feature specs (all implemented). Source comments
reference them by bare filename — they live there now.

## [MAINTENANCE] — read before adding a single line to any doc here

**Update the current-state file in place.** Add to `docs/archive/rules/<area>.md` only when you
reversed a decision documented there and the reasoning is worth keeping — with a date and a
one-line "why the previous shape was wrong."

Do NOT append build logs, per-PR narratives, or test-count changes to any file here. Git history
already holds them, and an append-only doc becomes a changelog that every future session pays to
read. Changing behavior already documented in a current-state file requires confirmation first.

**These limits are enforced by `src/lib/__tests__/docsBudget.test.ts`** (same technique as
`copyLayer.test.ts` — a mechanical check with an instruction attached):

| Rule | Limit |
|---|---|
| `CLAUDE.md` | 16 KB |
| Any one `.claude/rules/*.md` | 12 KB |
| `CLAUDE.md` + all of `.claude/rules/` | 60 KB total |
| Markdown at the repo root | `README.md` and `CLAUDE.md` only |
| Every rules file | must contain a `docs/archive/rules/` pointer |

If that test fails, the fix is essentially never "raise the limit" — it's "move the history you
just wrote into `docs/archive/`." These files were 537 KB (~134k tokens, loaded on EVERY session
regardless of how small the change) before the 2026-08-05 split; they did not get that way by
anyone deciding they should.

---

## 1. What it is

ED RN staffing calculator for community EDs. A manager enters (or uploads) their ED's arrivals
data, a wHPPV target, and their actual shift menu. The app computes a day x shift-slot staffing
grid, honestly reports where it falls short of demand even when the aggregate number looks fine,
and separately reports a boarding coverage recommendation.

No login, no multi-user, no persistence beyond the current browser session — every calculation
re-runs from the current in-memory inputs. The one exception is `ReviewStep.tsx`'s data-file
export/re-import.

**Hard constraint through the whole app: no ED-specific data may ever appear as a seeded
default.** The one sanctioned exception is the cohort wHPPV pre-fill (`src/lib/edbaLookup.ts`) —
an aggregate across many EDs, always framed as "what similar EDs run at," always editable.

## 2. Stack

Vite + React + TypeScript. **No backend, no database, no auth** — everything computes
client-side on every input change.

- `zustand` (`src/store.ts`) — single flat store, no slices/middleware.
- `papaparse` (CSV) + `xlsx`/SheetJS (Excel) for templates and tolerant upload parsing.
- `pptxgenjs` — client-side PPTX export, dynamic `import()` so it stays out of the main bundle.
- `vitest` for engine/lib; `@playwright/test` for browser-level results verification.
- No CSS framework — hand-written `src/App.css` + `src/index.css`, theme-aware via
  `prefers-color-scheme`. Literal hex values, no token system.

**Commands:** `npm run dev` · `npm run build` (tsc -b + vite build) · `npm test` (vitest) ·
`npm run test:e2e` (Playwright, chromium) · `oxlint`.

**Always run `npm test` after any change to `src/engine/`.**

**Known dependency trade-off:** `xlsx` carries an unfixed high-severity advisory (prototype
pollution / ReDoS in formula parsing). Accepted because the app is client-only, no server ever
touches an uploaded file, and only plain data cells are read. Re-evaluate if a backend is added.

## 3. Screens

`screen: 'welcome' | 'setup' | 'dashboard'` in the store; `App.tsx` switches on it. No router.

- **Welcome** — `WelcomeScreen.tsx`.
- **Setup** — `SetupScreen.tsx`, a 4-step wizard shell (`setupStep` 0-3).
  - Step 1 `setup/SetupEntryFork.tsx` -> `TutorialFlow.tsx` / `ColleagueRequestPage.tsx` /
    'returning' re-import
  - Step 2 `setup/VolumeStep.tsx` — annual volume, wHPPV target
  - Step 3 `setup/ShiftMenuStep.tsx` — shift menu, current staffing, policy settings
  - Step 4 `setup/ReviewStep.tsx` — summary, per-field edit links, data-file export
- **Results** — `DashboardScreen.tsx`, one scrolling page, five panels. See
  `.claude/rules/results-redesign.md`.

## 4. Module map

```
src/
  engine/          — see .claude/rules/engine-solver.md
    index.ts         compute() — THE entry point; reconcile(); recomputeAfterEdit();
                     computeScenarioB()
    types.ts         all engine types + DEFAULTS (policy params, evidence-tagged)
    allocate.ts      Steps 1/1b/1c: weighted arrivals, allocation, smoothing, normalizeEsiMix
    boarding.ts      Step 2: boarding demand (measured or derived) + coverage helpers
    solver.ts        Step 3: full-coverage solve, budget trim, ENA floor, severity primitives
    backlogModel.ts  LEAF module — the backlog recurrence, in exactly one place
    backlog.ts       backlog diagnostic + summarizeBacklogSeverity
    backlogFeedback.ts  the iterative relaxation loop wrapping the trim
    demandBand.ts    cohort band floor + arrivals-volatility buffer
    exactReallocation.ts  Panel 2's hour-conserving reallocation
    edHoldSolve.ts   Panel 5's joint ED+hold coverage solve
    sandbox.ts       Panel 5's pure arithmetic
    synthesis.ts     combined arrivals+boarding reader-facing totals
    flexMenu.ts      bounded advisory alternate-shift-menu search
    bandFloor.ts / hiddenBoarding.ts / preBedRequestValidation.ts  — diagnostics
    __tests__/
  lib/
    template.ts / parseUpload.ts / parseStaffingUpload.ts   — see template-parsing.md
    edbaLookup.ts        cohort volume-band -> wHPPV lookup
    dayOrder.ts          the ONE Mon-Sun display-order helper
    narrative.ts         every templated headline as a pure function
    whenPattern.ts       "when is it worst" phrase generator
    averageDay.ts        168 -> 24 hour-of-day means
    whppvColorDomain.ts / constantsMetadata.ts / inputIntegrity.ts / pptxExport.ts
    testSeed.ts          dev-only e2e seeding hook
    __fixtures__/        see synthetic-fixtures.md
  components/
    VisualFrame.tsx      THE shared results visual, reused by all five panels
    WhppvHeatmap.tsx     7x24 heatmap
    StepBar.tsx          horizontal scroll-spy nav
    MarginalReturnsCurve.tsx / ConvexityDemo.tsx / ConceptCallout.tsx
    ArrivalsGrid.tsx / ShiftMenuEditor.tsx / CurrentStaffingGrid.tsx
    FlexAxesToggles.tsx / EvidenceBadge.tsx
  screens/           welcome, setup/, dashboard/ (Panel1-5)
  store.ts / App.tsx / main.tsx
```

**`compute()` is the one function every consumer calls. Never re-implement allocation or solve
logic inline in a component** — if a screen needs a variant, add it to `engine/`.

## 5. Engine contract

```ts
EngineInputs = {
  arrivals: number[168],       // required, index = day*24+hour, day 0 = Sunday
  wHppvTarget: number,         // required
  shiftMenu: ShiftDef[],       // required, [{id, label?, startHour, lengthHours}]
  arrivalsP75?, esiMix?, admitRate?, boardingDuration?,
  boardingCensusMedical?, boardingCensusBH?, preBedRequestCensus?,
  monthlyMeanBoardingDurationHours?, dayOfWeekMeanBoardingDurationHours?,
  annualVisits?, boardingRatioTarget?, bhBoardingRatioTarget?, hoursPerFteAnnual?,
  hoursBudgetTolerance?, acuityWeights?, smoothingWeights?, enaFloor?
}
```

Optional inputs are **all-or-nothing** and degrade gracefully. `engine/types.ts` is the canonical
shape — don't let this section drift from it.

**Authoritative vs. derived:** `arrivals`, `wHppvTarget`, `shiftMenu` and the optional inputs are
the only things a user directly edits. Everything in `EngineResult` is derived by `compute()`.
**Never hand-write a staffing grid anywhere except through `compute()` or a `gridOverride` edit.**

## 6. Hard rules

1. **No ED-specific seeded data**, anywhere — templates, defaults, fixtures. (§1)
2. **`reconcile()` must pass exactly.** Never loosen the assertion.
3. **Admit rate / boarding duration are never estimated.** `computeBoarding()` returns `null` if
   either is missing. No fallback value, ever.
4. **Boarding is never merged into `EngineResult.grid`** and is never a 168-cell staffing grid.
5. **Live-edit recompute stays cheap** — pure arithmetic, no re-solve, no solver calls.
6. **wHPPV / overcoverage / shortfall are never visually separable** — one card, one component.
7. **Shift columns sort by `startHour`; days display Mon-Sun** via `lib/dayOrder.ts`. The
   engine's `day 0 = Sunday` index never changes.
8. **Shift-hour attribution is global-week circular** — a Saturday-night shift spills into
   Sunday. (Different axis from rule 7.)
9. **The uploaded workbook carries DATA, not policy.** wHPPV target and ENA floor are UI-only.
   (Two narrow Setup Decisions exceptions — see template-parsing.md.)
10. **Copy layer:** never "budget", "severity", or "idealized" in UI text.
    `copyLayer.test.ts` enforces this.
11. **Evidence badges are inline and setup-only**, never a sidebar or modal.
12. **Three grid concepts stay distinct:** `gridOverride`, `currentStaffingGrid`,
    `sandboxEdGrid`/`sandboxHoldGrid`. (See results-redesign.md.)

## 7. Explicitly out of scope

Declined deliberately — don't build without a separate, explicit ask:

- Dollar cost / ROI layer anywhere (reaffirmed repeatedly; no salary or margin inputs exist)
- Arrivals seasonality (boarding seasonality exists; arrivals has no month dimension)
- Monte Carlo / percentile variability modeling in the core engine
- Role-level skill-mix modeling (`headcountIncludesIndirectCare` is a setup-only data-entry
  concern and is never threaded into `compute()`)
- A *general* shift-menu optimizer (`flexMenu` is a bounded advisory enumeration, not an ILP)
- Any backend, database, auth, or multi-user feature

## 8. Known gaps

- No component-level test tier between `engine`/`lib` unit tests and full-page e2e.
- Desktop viewport only — no responsive layout.
- One pre-existing e2e failure: `e2e/panel1-2.spec.ts`'s Panel 2 spec references a "Current"
  toggle tab that no longer exists in `Panel2.tsx`.
- Panel 4's marginal-returns prose and its chart come from two different engine computations
  (see results-redesign.md).
