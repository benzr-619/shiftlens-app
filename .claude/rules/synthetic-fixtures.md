# Test fixtures & harnesses — current state

Fuller version (with the build rationale for each piece): `docs/archive/rules/synthetic-fixtures.md`.

---

## `src/lib/__fixtures__/syntheticDepartment.ts`

`generateSyntheticDepartment(params)` — PURE and deterministic (no `Date.now()`, no
`Math.random()`), returns `{ inputs: EngineInputs, currentStaffingGrid: Grid }`. Generated
**parametrically** (hour-of-day shape curves, day-of-week multiplier, sine boarding seasonality)
— never hand-tuned to look good, since that's the exact failure mode the harness exists to
catch. It does call `compute()` internally to derive the current-staffing grid's absolute hours;
that's still side-effect-free.

Parameters: annual volume, arrival shape (`unimodalDay`/`bimodal`/`flat`/`eveningSkewed`),
day-of-week amplitude, p75 spread, admit rate, mean boarding duration, monthly dispersion,
current-staffing ratio + day/night split, shift-menu preset (`2x12`/`3x8`/`3x12`/`mixed8and12`/
`1x24` or a literal `ShiftDef[]`), ESI present, boarding present, `boardingInputMode`
(`derived`/`measured`), `bhCensusPresent`, and `currentShapeFollowsIdeal` (scales the *idealized*
grid — the uniform day/night split can never track an hour-varying curve, so "already
well-allocated" is unreachable without it).

## `namedDepartments.ts` — eight frozen profiles

A `underTargetDayShort` · B `adequatelyStaffedBadlyShaped` · C `nightShort` · D `noBoardingData` ·
E `shortDurationBoarding` · F `lowVolumeFloorBinds` · G `alreadyFine` · H `measuredBoardingCensus`.

They illustrate the **architecture**, not any one department's story. **Don't hand-edit a
fixture's numbers to make a failing assertion pass** — fix the generator or re-pick parameters.

## Three test layers

| Layer | What | Command |
|---|---|---|
| `syntheticSweep.test.ts` | 245 departments (240 decorrelated param combos via prime strides + 5 degenerate cases). **Invariants only**, never specific outputs: `reconcile().passes`, no NaN/Infinity anywhere in `EngineResult`, no negative headcount, `fullCoverage >= weeklyScheduledHours`, `annualStaffingHours >= annualBoardingCovered`. 30s timeout — it's genuinely slow, not hung. | `npm test` |
| `syntheticFixtures.test.ts` | One test per named profile, asserting that profile's qualitative conclusion — so a regression fails **by profile name**. | `npm test` |
| `e2e/*.spec.ts` | Playwright, chromium, desktop viewport. Seeds a profile via the dev-only `window.__shiftlensSeed` hook (`src/lib/testSeed.ts`, behind `import.meta.env.DEV`, dead-code-eliminated from production) and jumps straight to results. Asserts **zero** console errors (hard assertion), zero page errors, no `NaN`/`undefined`/`{{` in page text. Screenshots to gitignored `e2e/screenshots/`. | `npm run test:e2e` |

`vitest.config.ts` excludes `e2e/**` so the two suites stay separate — without it vitest picks up
and fails on the Playwright specs.

**Don't hand-build a ninth department under `e2e/`** — load a named fixture.

## The `fullCoverage >= weeklyScheduledHours` guard

Skipped when `hourlyRequirement` is at/below `enaFloor` for **some** hour (`.some`, not
`.every` — a mixed-volume department can trip it partially). `enforceDepartmentFloor` runs after
the trim and can legitimately push hours above `fullCoverage` at low volume. Real behavior, not
a bug.

## What this proves, and doesn't

Validates: no crashes, no NaN, every branch reachable, invariants hold, and that "you're fine"
and "wrong shape" render as well as "understaffed" (profiles G, B).

Does **not** validate whether the model is right about a real ED, or whether the backlog model's
compression mechanics are correctly calibrated. Calibration needs real department data.
**Never tune an engine constant to make this sweep or the eight fixtures prettier.**
