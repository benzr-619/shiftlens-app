# Boarding hourly curve, seasonality index, and incremental coverage grid

Detail for `src/engine/boarding.ts`. This area has now reversed direction three times —
2026-07-13 turned boarding into a solved shift grid ("boarding is never a shift grid" →
false), 2026-07-14 turned it into a priority-ranked demand list instead (not a solved grid,
not a flat FTE number), and 2026-07-22 turned THAT into an incremental day × shift-menu
grid (not a solved grid — a pure aggregation over the still-unchanged ranking, see the "UI:
incremental coverage grid" section below). All three reversals were confirmed with Ben —
read this file rather than re-deriving from scratch or trying to reconcile with an older
description you might find elsewhere (e.g. stale comments, old test names in git history).

## Base hourly boarding-census curve (`convolveBoardingCensus`) — unchanged since 2026-07-13

Evidence status: **ASSUMPTION** — boarding accumulation is derived from admission-event
timing, not an independently measured hourly census. Layered on top of, not a replacement
for, the existing admit-rate/boarding-duration ASSUMPTION tags.

1. `admitEvents[cell] = arrivals[cell] * admitRate[cell]`.
2. Each cell's admission events are spread across the next `boardingDuration[cell]` hours
   (a patient admitted at hour h boards through h, h+1, ..., h+duration-1). Fractional
   duration gets a partial-weight final hour (duration=4.5 → 4 full hours + a half-weight
   5th) so the total contributed per event is exactly `duration` — this is what makes the
   conserved-total property below hold.
3. **Circular across the full 168-cell week**, not per-day. Deliberately NOT the shift
   solver's within-a-single-day model (`shiftHoursOfDay` in `engine/solver.ts`, circular
   *within a day* only, see `.claude/rules/engine-solver.md`) — boarding genuinely spills
   across day boundaries (an 11pm Monday admission boards into Tuesday); shifts are only
   administratively labeled to one day by convention.

**Conserved-total property** (tested in `engine/__tests__/boarding.test.ts`): summed across
the full circular week, `cellBoardingRnHours` totals exactly
`sum(arrivals[i] * admitRate[i] * boardingDuration[i]) / boardingRatioTarget` — the same
total the original per-cell Little's-Law shortcut (`admits_this_hour × boarding_duration`,
algorithm spec Section 4.1) produced. The convolution only redistributes *when* that total
lands, never *how much* — preserve this if this function is ever touched again.

## Seasonality index from mean boarding duration per patient (`deriveSeasonalityFactor`) — reworked 2026-07-22, supersedes the 2026-07-14 raw-totals version below

**This is the third change to how these two optional inputs are shaped** (multipliers →
raw totals → mean-per-patient). The reasoning this time is different from either prior
reversal, so it's worth reading in full before touching this again:

**Why totals were wrong:** `arrivals` is a single representative week reused for all 12
months — the model has no way to represent month-to-month *volume* seasonality (a busier
December vs. a quieter February). A raw monthly boarding-hours total conflates volume and
duration effects (`total_hours ≈ visits × admit_rate × duration`), and since the model only
has a duration lever to pull, the old formula attributed 100% of a total's seasonality to
duration — silently overstating the duration effect whenever the real driver was volume.
**Mean boarding duration per patient** isolates the one effect this model can actually
represent, by removing the volume term from the input entirely (you're asked for the
average wait per admitted patient that period, not a period sum).

**Why mean, not median:** duration multiplies directly into total boarding hours
(`hours_contributed = duration × admit_events`). A ratio of means
(`mean[period] / mean[overall]`) correctly rescales that product term. A ratio of medians
would not — the median of a product is not the product of medians, so a median-based ratio
would silently misstate the scaling even though "median" sounds like the more
robust/conservative statistic to ask for. This is a case where mean is the mathematically
correct choice, not just the easier one to compute.

**FLAG (open, not yet confirmed with Ben):** day-of-week duration factor is treated with
the identical mechanism as month — isolating "do this day's patients happen to board
longer" as distinct from day-of-week *volume* (which `arrivals` already captures on its
own, since arrivals varies by day within the single representative week). This symmetry
assumption (day behaves like a mini-month for this purpose) hasn't been explicitly signed
off — if a future session revisits day-of-week seasonality, confirm this framing is still
the intended one before extending it further.

The engine now derives the index as a ratio against the existing Scalars-tab
`boardingDuration` scalar (`EngineInputs.boardingDuration`) as the baseline, not a
self-derived grand average of the seasonality inputs themselves:

```
factor[period] = meanDuration[period] / overallBoardingDuration
```

where `overallBoardingDuration` is `boardingDuration` directly if it's a scalar (the
common case), or — if `boardingDuration` is ever an hourly `Cell168` array instead — the
admit-events-weighted mean (`sum(duration[i] * admitEvents[i]) / sum(admitEvents)`,
`overallMeanBoardingDuration()` in `boarding.ts`). That weighting choice is a judgment call
made without explicit sign-off (a plain unweighted average across the 168 cells was
rejected as very likely wrong — it would let a low-volume, unusually-long-duration hour
distort the baseline — but the specific weighting scheme itself hasn't been confirmed with
Ben; flag before relying on it in an hourly-boardingDuration scenario).

Both mean-duration arrays
(`monthlyMeanBoardingDurationHours: number[12]`, `dayOfWeekMeanBoardingDurationHours:
number[7]`) are **all-or-nothing** independently (same rule as ESI mix, unchanged) —
`deriveSeasonalityFactor` returns `undefined` if the array is the wrong length, or if
`overallBoardingDuration` itself is `<= 0` (guards the divide-by-zero case on the
*baseline*, not on the per-period array — an all-zero per-period array against a valid
positive baseline is a legitimate signal, "these patients don't board," not an absent
input; don't reintroduce the old "sum to ≤0 means absent" guard, that was a different
divide-by-zero risk specific to the old self-derived-baseline formula and doesn't apply
here). `hasMonthlySeasonality`/`hasDayOfWeekSeasonality` on `BoardingResult` reflect
whether each factor was actually derived.

Both factors compose multiplicatively onto the base curve wherever they're applied.
Absence of either defaults that dimension to a flat 1.0 no-op — unchanged from before.

---

### History (superseded): raw-totals version, 2026-07-14

The optional inputs were **raw totals as pulled from a report**
(`monthlyBoardingHoursTotals: number[12]`, `dayOfWeekBoardingHoursTotals: number[7]`), NOT
pre-computed multipliers — the prior build (2026-07-13) had the user type in multipliers
directly (`monthlyBoardingFactor`/`dayOfWeekBoardingFactor`); that shape was retired then.
The engine derived the index as `factor[i] = total[i] / (sum(totals) / periods)` — self-
baselined against the totals' own grand average, not against the Scalars-tab
`boardingDuration`. This is the version the 2026-07-22 change above replaces, for the
volume/duration-conflation reason described above — not because anything about the earlier
two reversals (multiplier-vs-total, template-vs-scalar) was wrong.

## Priority-ranked coverage slots (`rankBoardingPrioritySlots`) — the primary output, 2026-07-14

**No solved staffing grid for boarding anymore.** The 2026-07-13 build's
`solveBoardingCoverage()` (which reused `solveShiftFit`'s full-coverage/budget-trim
pipeline) has been **deleted from `engine/solver.ts`**. This isn't an oversight — the ask
changed from "give me a solved schedule for boarding" to "rank where my next dollar of
coverage buys the most value," which is a raw-demand-ranking question, not a
solved/trimmed-schedule question. Don't resurrect `solveBoardingCoverage` to "restore"
boarding-as-a-grid; that's the exact model this build replaced.

The ranking breaks the week into **(month?, day-of-week, shift) slots**:

- `month` is only a ranking dimension when `monthlyMeanBoardingDurationHours` was provided
  (12 months × 7 days × N shifts slots); otherwise every slot has `month: null` and the
  ranking is just (day × shift) — "coarser but still useful," per the ask. Day-of-week is
  **always** a ranking dimension, with or without `dayOfWeekMeanBoardingDurationHours` — the base
  convolved curve is inherently day-varying (arrivals vary by day), so day-level ranking is
  real even without explicit seasonality data; only month needs the explicit input, since
  the base curve carries no month information at all on its own.
- Each hour's demand is attributed to whichever shift(s) cover it via `shiftHoursOfDay()`
  (reused from `engine/solver.ts`, not reimplemented) — split evenly across shifts sharing
  a hand-off hour, same convention as the retired `summarizeShortfallByShift` client-side
  rollup from the core-grid heatmap history.
- Annualization: a month-split slot's hours are scaled by `WEEKS_PER_MONTH = 52/12`
  (approximation — 52 weeks spread evenly across 12 months, not calendar-accurate); a
  no-month-split slot is scaled by `52` directly.
- Slots are sorted descending by `requiredCareHours`; `cumulativePct` is a running % of the
  **analytic annual total** (computed independently, see below) — NOT the sum of the slots
  themselves.

**Why cumulative % uses an independently-computed total, not the slot sum:** if the shift
menu has a coverage gap (some hour no shift covers), that hour's demand has no slot to land
in — the slot sum would then be less than the true total. Rather than silently hide this,
`cumulativePct` is computed against the analytic total (`annualBoardingHours`, same value
used for `annualFte`/`lostProductivity`), so a shift-menu gap shows up honestly as
cumulative % capping below 100% even after funding every slot — a real signal about the
shift menu, not a rounding error. Don't "fix" this by normalizing cumulative % to the slot
sum; that would hide the gap instead of surfacing it. (In the common case — a shift menu
that fully tiles 24 hours — slot sum equals the analytic total exactly, and cumulative %
reaches 100% at the last rank; tested in `boarding.test.ts`.)

## Lost-productivity metric (`EngineResult.lostProductivity`) — unchanged since 2026-07-13

Productivity Target Buffer method (ENA-referenced): `wHppvConsumedByBoarding =
annualBoardingHours / annualVisits`; `wHppvAvailableForEdCare = wHppvTarget -
wHppvConsumedByBoarding`. Computed inside `compute()` (`engine/index.ts`), not
`computeBoarding()`, because it needs `inputs.wHppvTarget` and `annualVisits`, both already
in `compute()`'s scope. `null` iff `boarding` is `null`. Rendered as a 4th stat in
`CoreGridTab.tsx`'s `.wHPPV-unit` card — see CLAUDE.md Section 6.

## UI: incremental coverage grid (2026-07-22) — supersedes the ranked-table-with-"show more" version, third reversal of this section's shape, confirmed with Ben

**History of this specific rule** (separate from the seasonality-input history above, which
is about the *inputs*; this is about how the *output* is displayed/consumed):

1. **2026 original:** "boarding is never a shift grid" — flat FTE number only.
2. **2026-07-13:** reversed to a solved shift grid (`solveBoardingCoverage()`, since deleted).
3. **2026-07-14:** reversed again to a ranked table (Rank / When / Required care hours/yr /
   Cumulative %, top 8 with "Show N more") — explicitly NOT a grid, "that constraint
   survives from the original rule."
4. **2026-07-22 (current):** reversed a third time — `BoardingCoverageSection.tsx` now
   renders a day × shift-menu **grid**, same shape as the idealized core grid, where each
   cell shows `+N` incremental nurse-shifts. This is NOT `solveBoardingCoverage()` restored
   — no solver call is involved (see the warning against resurrecting it, above). The grid
   is a pure aggregation over the same `prioritySlots` ranking this file has described since
   2026-07-14: fund the top-K ranked slots, map each into its (day, shift[, month]) cell as
   `+1`. `rankBoardingPrioritySlots` itself is UNCHANGED by this — only how its output is
   consumed changed.

**Why grid, this time, when "never a grid" was the rule for two years:** the ranked table
answered "where's my next dollar best spent," one row at a time — useful for reading off a
priority order, but it didn't show a manager the shape of a *funded plan* the way the core
grid does. A day × shift grid lets someone compare "this is what boarding coverage looks
like" side-by-side against the idealized core grid immediately above it, in the same visual
language. This is a different problem than either prior version solved (ranking vs.
solving vs. shaping-a-plan) — read this as a genuinely new ask, not a flip-flop back to the
2026-07-13 solved-grid model.

**New engine functions (`engine/boarding.ts`), all pure aggregation/arithmetic, no solve:**

- `deriveBoardingCoverageCells(prioritySlots, fundedCount, month)` — funds the top
  `fundedCount` ranked slots and maps each into its `(day, shiftId)` cell as `+1`. Pass
  `month: null` for the aggregated "day-of-week only" view (a cell's count can exceed 1,
  summed across however many of the 12 months funded that day/shift combo); pass a specific
  month (0-11) for the "day-of-week × month" view (each cell is 0 or 1, since each
  `(month, day, shift)` triple is exactly one slot). See `BoardingCoverageCell` in
  `engine/types.ts`.
- `effectiveEdWhppvAtCoverage(wHppvTarget, wHppvConsumedByBoarding, coveredFraction)` —
  **ASSUMPTION, not yet validated against real data:** linear proportional recovery —
  funding X% of the ranking is assumed to recover exactly X% of the wHPPV boarding
  consumes, uniformly. Real recovery is very unlikely to be perfectly linear: the ranking
  funds the highest-value slots first, so early coverage plausibly recovers MORE than
  proportionally, with diminishing returns later. Treat this as a rough guide in the UI
  (labeled as such in `BoardingCoverageSection.tsx`'s "how is this calculated" explainer),
  not a validated prediction. Revisit this formula if/when real pre/post boarding-coverage
  data becomes available.
- `fundedCountToReachWhppv(prioritySlots, wHppvTarget, wHppvConsumedByBoarding, targetWhppv)`
  — smallest rank cutoff whose `effectiveEdWhppvAtCoverage` clears `targetWhppv`; monotonic
  in rank since `cumulativePct` is monotonic (see conserved-total property above), so a
  linear scan suffices. Used to set the **default funded count** to whatever reaches the
  p25 benchmark band (`lookupWhppvBand(annualVisits).p25Whppv`, `lib/edbaLookup.ts`) — a
  "recommended starting point," not zero coverage and not full (100%) funding, since full
  target wHPPV requires funding all of boarding and is shown only as a secondary reference
  line. Returns `prioritySlots.length` (fund everything) if even 100% funding can't reach
  the target (e.g. `wHppvTarget` itself is below the benchmark) — full funding is then the
  best achievable outcome, not an error. Never returns 0 — the search starts at "fund the
  top 1 slot," so if even that already clears the target, it still returns 1, not 0 (a
  minor asymmetry, documented in `boarding.test.ts`, not considered worth special-casing).

**UI (`BoardingCoverageSection.tsx`):** a slider (0 to `prioritySlots.length`) controls
`fundedCount`, defaulting to `fundedCountToReachWhppv(...)`'s result until the user drags it
(tracked via a `fundedOverride` component state, `null` = "still at the recommended
default," with a "Reset to recommended starting point" link once the user moves it). Live
stats shown alongside: % of annual boarding hours covered (`cumulativePct` at that rank) and
Effective ED wHPPV at that coverage (`effectiveEdWhppvAtCoverage`), plus the full target
wHPPV as a clearly-labeled secondary reference (not the default). A view toggle
("Day-of-week only" / "Day-of-week × month") switches the `month` argument to
`deriveBoardingCoverageCells` — the month view (with a month `<select>`) is only shown when
`boarding.hasMonthlySeasonality` is true, since without monthly seasonality data every
slot's `month` is already `null` and there's nothing to toggle. The old ranked table and its
"show more" expansion are gone entirely, not just collapsed — this is a replacement, not an
addition.

### History (superseded): slider + day/month-dropdown version, 2026-07-22

The grid above was read-only — cells showed `+N` as a label, not an input — and the
funding level was controlled by a single slider (0 to `prioritySlots.length`) plus a
Day-of-week-only/Day-of-week×month **view toggle** (a 2-button switch, the month side
paired with a `<select>` dropdown). This is the version the 2026-07-23 revision below
replaces, per Ben's feedback: it didn't let someone explore "what if I only fund weekdays"
or hand-tune specific cells, and the view toggle only ever showed ONE month at a time
rather than letting several be selected together.

## Editable grid + month/day toggle buttons (2026-07-23) — revises the 2026-07-22 grid above, same "not a solve" boundary

**What changed, concretely:**

1. **The grid is now directly editable** — same interaction as `CoreGridTab.tsx`'s
   "Current staffing" grid (a plain `<input type="number">` per cell, no read-only `+N`
   label anymore). It still initializes pre-filled with the recommended baseline (funded to
   reach the p25 wHPPV band, same `fundedCountToReachWhppv` mechanism as before), and a
   "Reset to recommended" link clears every manual edit at once. A cell the user has typed
   into keeps that value across re-renders — including when toggles below change what the
   *recommendation* would show — until the user hits reset. Tracked as component-local state
   (`cellOverrides: Record<"day::shiftId", number>` in `BoardingCoverageSection.tsx`, keyed
   the same way `deriveBoardingCoverageCells`/`boardingHoursCoveredByGrid` key their maps);
   this is NOT stored in the zustand store, unlike `gridOverride`/`currentStaffingGrid` —
   it's local to this one section's display, nothing else in the app reads it.
2. **The single view-toggle + month-dropdown is gone, replaced by two rows of independent
   on/off toggle buttons** — 12 month buttons (Jan-Dec, shown only when
   `hasMonthlySeasonality`) and 7 day-of-week buttons (Sun-Sat, always shown). Any
   combination can be active at once (not just one month at a time like the old dropdown).
   Toggling a period off means "the recommendation should act as if that period needs zero
   coverage" — its slots are excluded entirely from the ranking used to (re)compute the
   recommended baseline, and any grid cell still at its recommended (non-overridden) value
   updates live to reflect the new baseline. Cells the user has manually edited are never
   touched by a toggle change, per point 1. Deselecting every month but one reproduces the
   old dropdown's single-month view; deselecting the weekend lets you explore a
   weekday-only plan — both are just specific points in the same general toggle space now,
   not separate UI modes.
3. **Live stats (% of annual boarding hours covered, Effective ED wHPPV at this coverage)
   are computed from the grid's actual current contents, never from toggle state
   directly** — whatever mix of manually-edited and still-recommended cells is currently
   showing. This is the important invariant: if a user toggles months/days to explore a
   plan, then hand-edits a few cells, the live stats reflect exactly what's in the grid, not
   "what the toggle selection implies." The denominator for the percentage is unchanged —
   still the fixed analytic `annualBoardingHours` total, never affected by toggle state (the
   same "honest gap" convention this file has used since 2026-07-14: an unreachable 100% is
   a real signal, not something to hide by shrinking the denominator).

**New engine functions (`engine/boarding.ts`), both pure arithmetic, no solve, same
convention as `recomputeFromGrid` (`engine/solver.ts`):**

- `restrictPrioritySlotsToActivePeriods(prioritySlots, trueAnnualTotal, activeMonths, activeDays)`
  — filters `prioritySlots` down to only the given active months/days (an excluded slot is
  skipped entirely, never counted), then recomputes each surviving slot's `cumulativePct` as
  a fresh running sum over just the survivors — still divided by the SAME fixed
  `trueAnnualTotal`, not a new subset total, so an excluded period can never let the
  restricted list's cumulative % reach 100%. The output is still a plain
  `BoardingPrioritySlot[]`, so `fundedCountToReachWhppv`/`deriveBoardingCoverageCells` accept
  it unchanged — this function only changes which slots are eligible and how their
  cumulative % is measured, not the funding/aggregation logic itself. Pass
  `activeMonths: null` when month toggles aren't in play (either `hasMonthlySeasonality` is
  false, so every slot's `month` is already `null`, or the caller wants every month
  included) — don't pass a full 12-element `Set` just to mean "no filtering," `null` is the
  explicit no-op.
- `boardingHoursCoveredByGrid(grid, prioritySlots)` — the inverse direction of
  `deriveBoardingCoverageCells`: given an actual (day, shiftId) headcount grid, returns the
  annual hours of boarding demand it covers. **Deliberately takes the FULL, unrestricted
  `prioritySlots`** (never a toggle-filtered subset) — this is what makes live stats
  toggle-independent, per point 3 above. Per (day, shiftId), demand is the sum of
  `requiredCareHours` across however many slots that cell has (1 if no month split, up to 12
  if there is); one grid "unit" there is worth the AVERAGE of those slots' hours — there's
  no way to know from a bare headcount number which specific months' worth of coverage a
  manual edit was "meant" to represent, so the average is the honest arithmetic answer, not
  a guess at solver-level precision. A cell's coverage is capped at that cell's own total
  demand (typing an oversized number into one cell can't make the overall percentage read
  higher than that cell's own annual hours actually allow). `deriveBoardingCoverageCells`
  itself was NOT reframed to do this — the two functions run in opposite directions (slots
  funded → cells vs. cells → hours covered) and stayed cleaner as siblings than as one
  bidirectional function.

**UI (`BoardingCoverageSection.tsx`):** `activeMonths`/`activeDays` (component-local
`Set<number>` state, defaulting to "everything on") feed
`restrictPrioritySlotsToActivePeriods`, whose output feeds `fundedCountToReachWhppv` +
`deriveBoardingCoverageCells` to produce the recommended per-cell values. Those merge with
`cellOverrides` (override wins) into the grid actually rendered and edited. That same merged
grid, plus the full unrestricted `boarding.prioritySlots`, feeds `boardingHoursCoveredByGrid`
for the live stats — a completely separate computation path from the toggle-driven
recommendation, by design (point 3 above). The slider and its "Coverage funded: top N of M
ranked slots" label are gone; the funding level is now whatever the grid actually contains.

## Single representative-week grid + month-SCOPE toggles (2026-07-24) — FOURTH reversal, replaces everything above about the coverage OUTPUT (spec §2.6)

This is the redesign spec's §2.6. It changes how the coverage output is *shaped and consumed*,
NOT the base curve / seasonality index / `prioritySlots` ranking (all unchanged above).

**Why it changed again:** the 2026-07-22/23 grid's "day-of-week" aggregation summed a
(day, shift) combo's `+1`s across all 12 funded months, so a cell could read `+12` against a
~7-FTE headline — units that didn't reconcile and read as confusing, not informative.

**The new model:** ONE representative week's incremental headcount per (day, shift). Small
values (`+1`, `+2`), like the core grids. **Month toggles are SCOPE, not pattern** — they pick
how many months the single weekly plan is applied to and scale the stats; they never change the
grid. **Day toggles are GONE** — a day that shouldn't get coverage is edited to 0 in the grid.

**REMOVED from `engine/boarding.ts` (do NOT resurrect — replaced, not hidden):**
`deriveBoardingCoverageCells`, `restrictPrioritySlotsToActivePeriods`, `boardingHoursCoveredByGrid`,
`fundedCountToReachWhppv`, and the `BoardingCoverageCell` type. Everything the 2026-07-22/23
sections above describe about those four functions is now history. `rankBoardingPrioritySlots`
/ `prioritySlots` / `effectiveEdWhppvAtCoverage` STAY (the new model reads `prioritySlots`).

**NEW in `engine/boarding.ts` (all pure arithmetic, no solve):**
- `BoardingResult.monthFactors: number[] | null` — the 12 monthly factors (or null). Needed
  because the new model scales stats by month scope and recovers the weekly shape from the ranking.
- `weeklyBoardingDemandByCell(boarding)` → Map "day::shiftId" → representative-week RN-hours.
  Recovered from `prioritySlots`: sum a cell's annual hours across its month slots ÷ full-year
  `scopeWeeks` (so month seasonality, a SCALE effect, is divided back out — only the
  day-of-week-adjusted weekly SHAPE remains). The fixed pattern the grid is built on.
- `scopeWeeks(monthFactors, activeMonths)` (private) — factor-weighted weeks a month set implies:
  `Σ_{m∈active} monthFactors[m] × WEEKS_PER_MONTH`, or `52` when there's no monthly seasonality.
  `activeMonths: null` = all months. Full-year scope reproduces `annualBoardingHours` exactly.
- `weeklyBoardingCoveredByGrid(grid, demandByCell, shiftMenu)` — Σ per cell `min(headcount×len,
  weeklyDemand)`; a cell can't cover more boarding than it has.
- `annualBoardingCoveredByWeeklyGrid(grid, boarding, shiftMenu, activeMonths)` — weekly coverage
  × `scopeWeeks(activeMonths)`. Denominator for the % is always the full `annualBoardingHours`,
  so a toggled-off month OR a shift-menu gap honestly caps below 100% (same honest-gap convention
  the old `cumulativePct` had — preserved, just re-expressed).
- `recommendWeeklyBoardingGrid(boarding, shiftMenu, wHppvTarget, targetWhppv, consumed)` → Grid.
  Breaks each cell's weekly demand into stackable `+1` units (marginal hours each), funds
  highest-value-first until `effectiveEdWhppvAtCoverage` clears `targetWhppv` at FULL scope.
  Computed ONCE; does NOT change with month toggles. Funds ≥1 unit (never a fully empty
  recommendation — inherits the removed `fundedCountToReachWhppv`'s never-0 rule); funds the
  full-demand grid if even 100% can't reach the target.
- `boardingCoverageFte(annualHours)` = hours / 2080.

**Modeling approximation to know:** the per-cell demand cap uses the un-month-scaled weekly
demand, and month scope scales the SUM by factor-weighted weeks (not a per-month `min()`). This
conserves the annual total exactly (full grid + all months = `annualBoardingHours`) and is the
honest, simple choice for a planning tool — it can slightly over/under-state coverage within an
individual high/low-factor month, but never in aggregate. The `effectiveEdWhppvAtCoverage`
linear-recovery ASSUMPTION is unchanged (still flagged in the UI's "how is this calculated").

**UI (`BoardingCoverageSection.tsx`):** templated headline (FTE-to-fully-cover + peak-need month
+ coverage % + effective-wHPPV from→to); a single editable `.boarding-coverage-grid`
(recommended default + `cellOverrides`, "Reset to recommended"); month toggle buttons in a
`.boarding-scope` box ONLY when `hasMonthlySeasonality` (no day toggles); live stats from the
displayed grid × active-month scope. Reframed copy: the grid is the coverage NEED; hold-nurse
vs. additive-coverage vs. float/PRN is a separate tactical choice, not a per-cell implication.
