# Step 3 solver internals

Detail for `src/engine/solver.ts`. Read this before touching the shift-fit solve — the
algorithm choices here are deliberate engineering decisions, not the only valid approach,
and re-deriving them from scratch will likely diverge from what's tested.

## Full-coverage solve (5.2, `solveFullCoverageDay`)

Per day, per shift, headcount starts at 0. Repeatedly: find the hour with the largest
deficit, then among shifts covering that hour, bump the one whose hours overlap the most
currently-deficient hours (not just that one hour). This is a greedy set-cover heuristic,
not an exact ILP solve — the spec calls it "solvable by direct search at this scale," and
at 2-6 shifts/day this greedy approach converges to a full-coverage solution in practice.
It is only used as an upper bound feeding the budget trim, never shown to the user directly.

## Budget-capped trim (5.3, `trimDayToBudget`)

Runs independently per day. The weekly cap (`weeklyBudgetHours * (1 + tolerance)`) is
allocated across days **proportional to each day's own full-coverage hours** (see
`solveShiftFit`) — a day with heavier natural demand gets a bigger slice of the cap. This
proportional allocation is an engineering choice not explicit in the spec; if a future
version wants day-level cap parity instead, this is the place to change it.

Each trim step removes one headcount unit from whichever (shift) minimizes
`addedWeightedShortfall / shift.lengthHours` — cheapest hours to cut, in shortfall terms.
"Weighted" uses `hourWeight()` (5.4 transition-hour weighting), not raw deficit.

## Department-level ENA floor (5.6, `enforceDepartmentFloor`)

Runs **after** the budget trim, as a final pass — it can push scheduled hours back above
the cap. This is intentional: the floor is a safety minimum, not a budget target, so it
takes priority. If a day's total on-duty headcount at any hour is below `enaFloor`
(default 2), the shift with the most overlapping low hours gets bumped repeatedly until
satisfied. At NYPW's tested volume this never triggers — if you see it firing in production
data, that's a real low-volume-hour situation, not a bug.

## Live-edit recompute (`recomputeFromGrid`, exported from `engine/index.ts` as
`recomputeAfterEdit`)

Deliberately **not** transition-weighted — it's the cheap arithmetic recheck described in
spec 9.3 (sum hours, compare grid coverage to `hourlyRequirement`), not a re-solve. Don't
add transition weighting back into this path; that would make "live" edits expensive again,
defeating the point.

`recomputeFromGrid` also runs a **read-only** 5.6 department-floor check
(`findDepartmentFloorViolations`, private to `solver.ts`) and returns
`enaFloorViolationsRemaining` alongside `weeklyScheduledHours`/`shortfall` — added so a
manual grid edit that drops an hour's on-duty headcount below `enaFloor` gets flagged live,
not just at the next full solve. This is deliberately **not** `enforceDepartmentFloor`
reused: that function mutates the grid to fix violations (correct during the initial solve,
5.2→5.3→5.6 pipeline), but silently bumping headcount back up on every keystroke would
fight the user's own edit. The live-edit path only reports; it never adds staff back. Same
arithmetic-only convention as the rest of this function — no re-solve, no shift-hours
iteration beyond `coverageForDay`.

`recomputeAfterEdit` (in `engine/index.ts`) resolves `enaFloor` the same way `compute()`
does — `inputs.enaFloor ?? DEFAULTS.enaFloor` — so a live edit is checked against the same
floor the last full solve used, not a hardcoded 2.

## Shift wraparound model

A shift is treated as covering hours circularly **within a single day** (`shiftHoursOfDay`),
not spilling into the next calendar day of the week. A 7p–7a shift assigned to "Monday"
covers Monday hours 19–23 and Monday hours 0–6 — i.e. it's solved as if each day's 24-hour
requirement curve is its own closed loop. This matches how real EDs label an overnight
shift under one day and keeps the "N unknowns per day" complexity the spec describes. If
you ever need true cross-midnight day-to-day spillover, this model needs to change —
it currently does not do that.
