# Synthetic department fixtures (PR E0, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §12.5)

Built ahead of PRs E-L specifically so the rest of that sequence gets verified against one
harness from the start, instead of retrofitting it later (re-verifying E-L against it one at a
time is strictly worse than building it first).

## What exists

- `src/lib/__fixtures__/syntheticDepartment.ts` — `generateSyntheticDepartment(params)`, a
  PURE (deterministic, no `Date.now()`/`Math.random()`) function taking a
  `SyntheticDepartmentParams` object and returning `{ inputs: EngineInputs, currentStaffingGrid:
  Grid }`. Generated PARAMETRICALLY (hour-of-day shape curves, day-of-week multiplier, boarding
  seasonality as a sine swing) — never hand-tuned to look good, since that's the exact failure
  mode this harness exists to catch. "Pure" doesn't mean "never calls `compute()`" — deriving
  the current-staffing grid's absolute hours needs the target-implied weekly budget, which only
  `compute()` knows how to derive; it's still deterministic and side-effect-free.
  - Parameters cover: annual volume, arrival-curve shape (`unimodalDay`/`bimodal`/`flat`/
    `eveningSkewed`), day-of-week amplitude, p75-to-mean spread (`arrivalsP75`), admit rate,
    mean boarding duration, monthly boarding dispersion, current staffing as a ratio to
    target-implied hours, current day/night split, shift menu preset (`2x12`/`3x8`/`3x12`/
    `mixed8and12`/`1x24`, or a literal `ShiftDef[]`), ESI mix present/absent, boarding data
    present/absent, and an optional `currentShapeFollowsIdeal` flag.
  - `currentShapeFollowsIdeal` (added while building profile G, see below): when true, the
    current-staffing grid is built by scaling the IDEALIZED solved grid itself, rather than a
    uniform day/night-hours split. **Why it exists:** the uniform-split model gives every day
    of a shift the same headcount, which can never track an hour-varying requirement curve
    closely — so "already well-allocated" (profile G) was structurally unreachable through the
    day/night-split path alone. This is a legitimate added point in the parameter space (a
    third way to describe "how similar is current shape to ideal"), not a special case bolted
    on for one fixture — any future profile needing a well-shaped current grid should use it too.
- `src/lib/__fixtures__/namedDepartments.ts` — `NAMED_DEPARTMENT_PARAMS`, the seven §12.2
  profiles as frozen parameter sets: `underTargetDayShort` (A), `adequatelyStaffedBadlyShaped`
  (B), `nightShort` (C), `noBoardingData` (D), `shortDurationBoarding` (E),
  `lowVolumeFloorBinds` (F), `alreadyFine` (G). Illustrate the ARCHITECTURE (per §12.4), not any
  one department's story — don't hand-edit a fixture's numbers to make a failing assertion
  pass; fix the generator or re-pick parameters instead.
- `src/engine/__tests__/syntheticSweep.test.ts` — a 245-department sweep (240 decorrelated
  parameter combinations via `pick(arr, i, primeStride)` + 5 explicit degenerate cases: a
  forced-zero arrivals hour, a single-shift `1x24` menu, volumes at both extremes of the peer-
  band table, and current staffing of zero). Asserts INVARIANTS only, never specific outputs:
  `reconcile().passes`, no NaN/Infinity anywhere in `EngineResult` (recursive walk), no negative
  grid headcount, `fullCoverage.weeklyHours >= weeklyScheduledHours` (except when the ENA
  department floor dominates everywhere — see the guard below), and `annualStaffingHoursForWeeklyGrid
  >= annualBoardingCoveredByWeeklyGrid` whenever boarding was computed. Runs at a 30s test
  timeout (245 full engine solves, each internally running `compute()` twice — once inside the
  generator to derive the current-staffing scale, once in the test itself — is genuinely slow
  at the default 5s vitest timeout, not a hang).
  - **The `fullCoverage >= weeklyScheduledHours` guard, and why it's not a bug in the test:**
    `fullCoverage` (`solveFullCoverageWeek`) targets `hourlyRequirement` only and ignores the
    ENA floor; `enforceDepartmentFloor` runs AFTER the trim and can push scheduled hours back
    ABOVE `fullCoverage` at genuinely low volume (documented in `.claude/rules/
    engine-solver.md`'s §5.6 section: "if you see it firing in production data, that's a real
    low-volume-hour situation, not a bug"). The sweep skips this one assertion when
    `hourlyRequirement` is at/below `enaFloor` everywhere — exactly profile F's territory, not a
    weakening of the invariant for normal-volume departments.
  - **The `narrative.ts` hook is wired but a no-op today.** `src/lib/narrative.ts` doesn't exist
    until PR H — the test does a best-effort dynamic import (a NON-LITERAL specifier, so `tsc
    -b` doesn't fail trying to resolve a module that isn't built yet) and silently returns if it
    fails. Once PR H lands, this starts exercising every exported narrative function against 20
    sweep cases, checking for empty strings and placeholder residue (`undefined`, `NaN`, `-0`, or
    unfilled `{{...}}` interpolation) — per §12.5, this is "the test that actually catches
    sign-assuming copy." Don't delete this hook as dead code; it's intentionally inert until
    PR H, not unused.
- `src/engine/__tests__/syntheticFixtures.test.ts` — one test per named profile, asserting the
  qualitative CONCLUSION that profile should produce (e.g. profile A's current hours are under
  target AND day-gap > night-gap; profile G's current-grid severity is within 50% of the
  idealized grid's own severity; profile D's `boarding`/`lostProductivity` are both `null`).
  Named so a regression that breaks one profile fails by NAME, per §12.5's explicit ask.

## What this proves and doesn't (§12.5's table — restated here so it isn't lost)

| Validates | Does not validate |
|---|---|
| Generalizability: no crashes, no sign-assuming copy (once PR H wires narrative.ts), every branch reachable, invariants hold | Whether the model is RIGHT about a real ED |
| That "you're fine" and "wrong shape" render as well as "understaffed" (profiles G, B) | Whether `abandonRate`/`recoveryEfficiency`/`maxDrainFraction` are correctly calibrated |

Calibration needs real department data (§12.6) — never tune an engine constant to make this
sweep or the seven fixtures prettier; a change that does so while regressing real-department
behavior is a regression, not progress.

## Measured boarding census path (2026-07-27) — profile H + sweep coverage

`SyntheticDepartmentParams` gained `boardingInputMode: 'derived' | 'measured'` (default
`'derived'`, so every pre-existing profile/test is behavior-unchanged) and `bhCensusPresent`.
On `'measured'`, `admitRate`/`meanBoardingDurationHours` are reused as the census's
approximate MAGNITUDE parameters rather than adding a parallel knob set — see
`.claude/rules/boarding-seasonality.md`'s measured-path section for the exact generation
formula. New named profile `measuredBoardingCensus` (H) in `namedDepartments.ts`, with its own
test in `syntheticFixtures.test.ts` asserting `censusSource === 'measured'`, both
`medicalWeeklyRnHours`/`bhWeeklyRnHours` non-null, and the precedence property (mutating
admitRate/boardingDuration produces byte-identical output). `syntheticSweep.test.ts`'s
240-case sweep also picks `boardingInputMode`/`bhCensusPresent` per case (new prime strides
41/43, decorrelated from every other axis) — both boarding paths are now swept for
crash/NaN/invariant safety, not just exercised by the one named profile.

## Playwright harness (PR A0, `RESULTS_PAGE_V2_SPEC_2026-07-27.md` §8.1) — supersedes the stale note below

**This section used to say no Playwright harness existed. It now does.** `@playwright/test` +
`playwright.config.ts` (chromium only, desktop viewport, `webServer` running `npm run dev` on
port 5173) + `npm run test:e2e`. Built exactly per the committed-fixture ask this file's older
note flagged: it loads `NAMED_DEPARTMENT_PARAMS` straight into the store, no second hand-built
department in a `.spec.ts` file.

- **`src/lib/testSeed.ts`** — installs `window.__shiftlensSeed(params)`, a dev-only hook wired
  from `main.tsx` behind `if (import.meta.env.DEV)` (a compile-time constant Vite replaces with
  `false` in production, dead-code-eliminating the whole dynamic import from the shipped
  bundle — verified: `dist/assets/*.js` after `npm run build` contains no reference to
  `testSeed` or `__shiftlensSeed`). Calls `generateSyntheticDepartment(params)` and writes every
  field into the zustand store via the existing setters, then jumps straight to
  `screen: 'dashboard'` — no stepping through setup.
- **`e2e/seed.ts`** — `seedAndGoToResults(page, params)`, the one shared helper every spec
  calls; imports `SyntheticDepartmentParams` as a type only (no runtime engine code needed in
  the Node/Playwright process).
- **`e2e/smoke.spec.ts`** — one test per `NAMED_DEPARTMENT_PARAMS` entry (currently A-H, all
  eight): seeds the profile, asserts `.dashboard-screen` is visible, asserts the page's own text
  contains no `NaN`/`undefined`/`{{` (unfilled template residue), and — the hard assertion,
  never weakened to a warning — asserts **zero** console errors and zero uncaught page errors.
  Saves a full-page screenshot per profile to `e2e/screenshots/` (gitignored) for human review.
- **`vitest.config.ts`** (new — vitest previously had no config file at all) excludes `e2e/**`
  from vitest's default `*.spec.ts` glob, so `npm test` and `npm run test:e2e` stay two
  genuinely separate suites; without this, vitest was picking up and failing on the Playwright
  specs (wrong environment, no browser).
- Per-panel specs are added by each later PR (D onward) alongside the panel they cover, per
  the spec's §8.1 list (toggle-switches-view, frame's-three-elements-present, Panel 3's queue
  strip is empty, Panel 1's effective-wHPPV view is not, Panel 5's hold-nurse-surplus/heavy-BH
  findings) — see that PR's own section below/in `results-redesign.md` for what actually landed.

The seven (now eight, with profile H) named fixtures remain the source of truth these specs load
— don't hand-build a ninth department anywhere under `e2e/`.
