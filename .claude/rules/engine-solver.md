# Engine & solver — current state

Live behavior only. **Full decision history: `docs/archive/rules/engine-solver.md`** (~107 KB,
nine successive shapes of the backlog model, every reversal with its reasoning). Read the
archive before changing anything in the "Load-bearing history" table at the bottom of this file;
otherwise this file is enough.

---

## Pipeline (`engine/index.ts`'s `compute()` is the only entry point)

1. **Steps 1/1b/1c** (`allocate.ts`) — weighted arrivals (ESI acuity weights, auto-normalized
   via `normalizeEsiMix`), cell-share allocation to a 168-cell `hourlyRequirement`, day-of-week
   smoothing. `annualVisits = sum(arrivals) * 52`; `annualCoreRnHoursBudget = annualVisits *
   wHppvTarget`.
2. **Step 2** (`boarding.ts`) — boarding demand. See `.claude/rules/boarding-seasonality.md`.
3. **Step 3** (`backlogFeedback.ts` -> `solver.ts`) — fit the user's shift menu to demand:
   full-coverage solve -> budget-capped trim -> ENA floor pass.
4. **`reconcile()`** — summing the 168-cell grid across a year must reproduce
   `annualCoreRnHoursBudget` **exactly**. `__tests__/reconcile.test.ts` is the build-in sanity
   check. It has never needed modification through any solver change — if it fails, that's a
   real bug in allocation math, not a tolerance issue. Never loosen it.

## Step 3, mechanically

- **Full coverage** (`solveFullCoverageWeek`) — greedy set-cover over all 168 global hours at
  once. Repeatedly: find the hour with the largest deficit, bump whichever (day, shift)
  candidate covering it overlaps the most currently-deficient hours. An upper bound feeding the
  trim, never shown to the user directly.
- **Budget trim** (`trimWeekToBudget`) — joint over the whole week, no per-day split. Each step
  removes the single headcount unit with the lowest `candidateCutCost`, until scheduled hours
  reach `weeklyBudgetHours * (1 + tolerance)`.
- **Cost function** — convex severity, not linear backlog-hours:
  `severity(backlog, requirement) = (backlog / max(requirement, 1)) ^ 1.8`. Normalized by need,
  so two nurses short at an hour needing three costs far more than two short at an hour needing
  ten. Plus `PEAK_WEIGHT * peak-severity delta`, a volatility multiplier, and a finite power-law
  floor-breach penalty (`FLOOR_WEIGHT = 75`, `FLOOR_GAMMA = 2` — finite on purpose, so an
  extreme budget can still breach the floor rather than stalling the loop).
  Cost is scored on the **cyclical** backlog curve (shape), never the actual one (size) — a
  fixed-budget trim can only fix shape.
- **Backlog feedback** (`solveShiftFitWithBacklogFeedback`) — wraps the trim in an iterative
  relaxation: solve, measure inherited backlog (`carriedIn`), raise the protected floor where
  it's material, re-trim, up to 8 passes. Returns whichever pass had the lowest total backlog,
  **not necessarily the last** (it can oscillate). This is `compute()`'s primary solve path.
- **ENA floor** (`enforceDepartmentFloor`) — runs last, can push hours back above the cap. Safety
  minimum, not a budget target. Rarely fires except at genuinely low volume.

## Backlog model (`backlogModel.ts`) — visits-based compression

Nurses compress pace down to, but never past, the department's own peer-cohort p25 wHPPV
(`EngineResult.floorWhppv`). Per hour, in visits:

```
demand[h]        = arrivals[h] + backlogVisits[h-1]
maxServable[h]   = capacity[h] / floorWhppv
backlogVisits[h] = max(0, demand[h] - maxServable[h])
```

Bridged to nurse-hours by `* floorWhppv` at every consumer boundary — `backlogHourStepHours` /
`backlogRecurrence` are what real consumers call. Algebraically equivalent, in hours, to
`max(0, arrivals[h]*floorWhppv + backlogHours[h-1] - capacity[h])`.

- Circular over the full 168-hour week, `SETTLE_PASSES = 6`.
- **`NO_COMPRESSION_FLOOR_WHPPV = 1`** — for demand curves with no honest "visits" concept
  (boarding, combined arrivals+boarding, the sandbox's blended `residualDemand`), pass this plus
  the demand curve itself as `arrivals`. Degenerates to plain deficit-carries-forward.
- **Structural vs. cyclical** — `BacklogResult` carries both. Structural (`structuralFloorByDay`)
  is the actual curve's per-day trough, a *budget/size* signal. Cyclical (`cyclicalBacklog`) runs
  the same recurrence against capacity rescaled to match the requirement's own weekly total,
  isolating *shape* from size. Never report one blended number as "how far behind you are."
- **"Caught up"** is relative, not absolute: `caughtUpThresholdForHour(requirement)` is ~10% of
  that hour's own requirement, floored at 0.5.
- No abandonment/LWBS term exists. Nothing is ever abandoned.

## Shift-hour attribution — GLOBAL WEEK, circular

A shift assigned to day `d` covers global hours `(d*24 + startHour + i) mod 168`. A Saturday
19:00 shift spills into **Sunday**, not back into Saturday's own early hours.
`coveringCellsByGlobalHour(shifts)` is the one shared lookup (hand-off hours split evenly);
`fullWeekCapacity(grid, shifts)` is the primary capacity computation. Shift length is clamped
`[1, 24]`, so coverage spans at most one day boundary.

*(Separate axis from Mon-Sun display order — that's render order only, see CLAUDE.md.)*

## Other solver-adjacent functions

| Function | File | What it does |
|---|---|---|
| `reallocateHoursExact` | `exactReallocation.ts` | Panel 2. Hill-climbing over gcd-based hour-neutral **trades** — total hours conserved **exactly**, by construction. Never adds/removes, never runs the ENA floor (that could only add hours). Shift *count* is deliberately not a second constraint. |
| `solveEdHoldJointCoverage` | `edHoldSolve.ts` | Joint ED+hold full-coverage greedy fill, no trim phase. **Not currently called by any Panel 5 button** — a from-scratch full-coverage fill doesn't match the trim's own budget-capped `result.grid`, so it would silently diverge from what Panel 4 shows as the recommendation. Still exported/tested; a candidate for a future "solve from a restricted shift menu, honoring the budget" ask, not today's. |
| `bestUnitToAdd` / `bestUnitToRemove` | `solver.ts` | Panel 5's +/- controls. Extracted from `solveFullCoverageWeek`'s and `trimWeekToBudgetCore`'s own selection loops — not duplicates. |
| `searchFlexibleMenus` | `flexMenu.ts` | Bounded, opt-in, advisory alternate-shift-menu search (<=57 candidates). Never auto-adopted. Overlay (swing-shift) candidates gated on `axes.shiftCount`; overlay *lengths* on `axes.shiftLengths`. Stays on one-shot `solveShiftFit`, never the relaxation loop. |
| `computeSandbox` | `sandbox.ts` | Panel 5 arithmetic, pure/no-solve. Nets hold + ED into ONE `residualDemand`/`unmet`/`spare` — **never attributed by source**. `holdSurplus` always surfaced. |
| `computeBacklog`, `computeBandFloorViolations`, `computePerShiftDiagnostic` | `backlog.ts`, `bandFloor.ts`, `hiddenBoarding.ts` | Diagnostic-only, read an already-solved grid. |
| `recomputeAfterEdit` | `index.ts` | Live-edit recheck. **Pure arithmetic, no re-solve** — never add a solver call to this path. Reports ENA-floor violations, never auto-fixes them. |

## Two floor curves — don't confuse them

- **`protectedFloorHourly`** — solver-facing, **unclamped**. Volatility can push it *above*
  `hourlyRequirement`. Used by the trim's floor penalty and the feedback loop.
- **`bandFloorHourly`** — reporting-only, clamped to `hourlyRequirement`. Identical to the above
  wherever volatility is modest.

`bandCeilingHourly` is reporting/heatmap-color only — no role in the backlog recurrence.

## Known approximations (live, disclosed, deliberately not fixed)

- `BACKLOG_SIM_WINDOW_HOURS = 48` — `candidateCutCost` simulates a bounded window, not the full
  week. Can under-count a cut's true cost in a chronically-short stretch. Relative ranking (all
  the trim needs) is less affected than absolute magnitude.
- Greedy set-cover, not an exact ILP.
- `WEEKS_PER_MONTH = 52/12`, not calendar-accurate.
- Panel 5 splits medical/BH boarding by a uniform proportional ratio — the engine only exposes a
  combined per-hour curve.

## Load-bearing history — read `docs/archive/rules/engine-solver.md` before touching these

| Area | Why |
|---|---|
| The backlog recurrence | Nine shapes. Two were retired for being *backwards*, not merely imprecise. |
| The budget trim's cost function | Six shapes. Convexity was added, dropped, re-added to a better variable. |
| Shift wraparound | Reversed from day-local to global-week as a genuine bug fix. |
| flexMenu existing at all | Reverses a documented "no auto-optimizing search" decision. |
| Backlog feeding the solver | Reverses "backlog is diagnostic-only." |

Constants named `*_GAMMA`, `*_WEIGHT`, `*_THRESHOLD`, `COLOR_*` are tunable display/cost
heuristics. `floorWhppv`, `SEVERITY_GAMMA`, the reconciliation identity, and the ENA floor are
not.
