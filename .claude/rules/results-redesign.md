# Results Page & Setup redesign (2026-07-24 spec) — implementation notes

Tracks the root-to-branch Results-dashboard + setup redesign specced in
`RESULTS_PAGE_REDESIGN_SPEC_2026-07-24.md` (repo root). The spec's Section 0 is the
governing "why" (understanding + communication); Sections 1–2.6 are one candidate design
for it, explicitly not sacred. Being built in a few smaller PRs along section boundaries.
This file accrues per-section implementation detail + spec-to-code gotchas as each lands.

## STALE-DOC WARNING: CLAUDE.md's boarding description is behind the code (found 2026-07-24)

CLAUDE.md's **Screen Map** and **Feature Status** describe the boarding coverage section as
the **2026-07-22 read-only `+N`-label grid + funding slider + view-toggle-with-month-dropdown**
version — now **two revisions stale**. The current code is the **§2.6 single-representative-week
grid + month-SCOPE toggles** (2026-07-24, see below and `.claude/rules/boarding-seasonality.md`'s
latest section). **For the boarding section's current shape, trust `boarding-seasonality.md`'s
LAST section + the code, NOT CLAUDE.md's Screen Map/Feature Status.** CLAUDE.md's
already-documented boarding text still hasn't been rewritten (that needs Ben's confirmation per
AUTOMATIC MAINTENANCE — flag it if doing a CLAUDE.md refresh pass). Test count is also well
ahead of CLAUDE.md (62 as of 2026-07-24 after the §2.6 test rewrite; CLAUDE.md says 55).

## Section 1 — current-staffing grid added to setup (built 2026-07-24)

**What was built:** the optional current-staffing grid (previously only on the results page)
now also appears on the shift-menu setup step (`ShiftMenuStep.tsx`), so it's *introduced* at
setup but still editable on the results page.

- New shared component `src/components/CurrentStaffingGrid.tsx` — a store-driven editable
  day × shift-menu grid bound to `currentStaffingGrid` / `setCurrentStaffingCell`. Both
  entry points (setup step + `CoreGridTab.tsx`) render this SAME component, so they can
  never drift in shape/interaction and an edit in either place is the same underlying store
  value. `CoreGridTab.tsx`'s previously-inline current-staffing input grid was replaced by
  this component (behavior-preserving; the diff grid + stats below it are untouched, since
  they'll be reworked in spec 2.2). `setCurrentStaffingCell` was dropped from CoreGridTab's
  store destructure (now unused there — the component owns the write).
- Grid sorts columns by `startHour` (same convention as CLAUDE.md Section 6 /
  `sortShiftsByStartHour`), duplicated as a small local `sortByStartHour` in the component.
- Optional: it does NOT gate the setup "Next" button — `SetupScreen.tsx`'s step-2 gate is
  still just `shiftMenu.length > 0`. Starts blank (`currentStaffingGrid` stays `null` until
  the user types), never seeded from `result.grid`.
- Store already had `currentStaffingGrid`/`setCurrentStaffingCell`/`resetCurrentStaffingGrid`
  from the 2026-07-22 results-page build — no store changes were needed; setup just reuses
  them.

**Verified end-to-end (Playwright, headless):** setup grid renders (7×2=14 inputs for the
default 2-shift menu), a value entered at setup persists into the results-page grid via the
shared store, the results-page grid stays editable, zero console/page errors. `npm run
build`, `npm test` (68), `oxlint` (only a pre-existing `StepIndicator.tsx` fast-refresh
warning) all clean.

**Deliberately DEFERRED from Section 1 this session:** the **shift-menu flexibility-preference
capture** (static / flexible start times / flexible shift count / flexible shift length),
which Section 1 also asks to add to the shift-menu setup step. It feeds spec Section 2.3,
whose solver capability is a documented reversal of CLAUDE.md Section 7's "no auto-optimizing
shift-menu search" — flagged for Ben's confirmation before building (spec Section 5). Not
built until that's confirmed, to avoid shipping a setup control wired to a solver path that
may change shape. `ReviewStep.tsx` was also left as-is (no current-staffing summary line
added) — optional, out of this PR's scope.

## Section 2.2 — idealized-vs-current comparison unit + budget/shape reconciliation (built 2026-07-24)

**What was built (all in `CoreGridTab.tsx`, no engine changes — pure display arithmetic per
spec §4.4):**

- The separate `.core-grid-hero` (idealized) card and `.current-staffing-card` (current +
  diff) card are **collapsed into one `.comparison-unit` card**: templated headline →
  reconciliation callout → both grids side by side (`.comparison-grids` >
  `.comparison-grid-block` ×2) → diff grid. The idealized grid is no longer a visual "hero"
  — it's a peer of the current grid (spec §2.2: "not a standalone hero grid"). Dead CSS
  removed: `.core-grid-hero`, `.staffing-grid-hero` (no longer referenced). `.current-staffing-card`
  CSS stays — still used by the **setup** grid (`ShiftMenuStep.tsx`).
- **Total-hours reconciliation (the genuinely new bit):** classifies the divergence from
  current as a BUDGET gap (wrong total, right shape) vs. a SHAPE gap (right total, wrong
  distribution) — because the fix and the boss-ask differ (spec §2.2). Arithmetic over the
  two grids:
  - `underHours` = Σ over cells where idealized > current of `(ideal−current)·shiftLength`
  - `overHours`  = Σ over cells where current > idealized of `(current−ideal)·shiftLength`
  - `budgetGapHours = underHours − overHours` (net; equals idealized weekly hrs − current
    weekly hrs by construction) — the budget component.
  - `shapeGapHours = min(underHours, overHours)` — the offsetting/redistribution component
    (hours you'd move between shifts even if totals matched).
  - `gapKind`: `'none'` if total mismatch < 1 hr; else whichever of budget/shape is <20% of
    the total is "minor" → `'budget'` / `'shape'`; else `'both'`. The 20% threshold is a
    display heuristic, not load-bearing engine math — safe to tune.
- **Templated headline** (fixed sentence, numbers interpolated — quotable into a boss-ask,
  spec §0 communication goal), one variant per `gapKind`. This extends the same
  templated-headline pattern the `.plain-summary` "What this schedule means" panel already
  uses (spec §2 design-pattern note).
- **Empty-state:** when no current staffing has been entered (`hasCurrentStaffing` = any
  current cell > 0), the callout/headline are replaced by a `.comparison-cta` prompt rather
  than a misleading verdict against a blank grid — a lightweight stand-in for the fuller
  §2.1 CTA (not the whole of §2.1, which is still unbuilt). The current grid is always shown
  (it IS the inline entry point), so entering staffing here or at setup both populate the
  same `currentStaffingGrid`.
- The redundant "Hours vs. idealized" stat was dropped (the Budget-gap callout now owns that
  number); "Hours below ideal coverage (current)" and "ENA floor violations (current)" moved
  into the reconciliation callout. The `.wHPPV-unit` card below (realized wHPPV / overcoverage
  / shortfall + heatmap) is untouched — CLAUDE.md §6's never-separable rule still holds.

**Verified end-to-end (Playwright, headless):** comparison unit renders with both grids as
peers + diff grid; empty current → CTA and no callout; copying idealized→current classifies
`'none'` ("line up"); one cell over → `'budget'`; the diff grid and classification recompute
live when EITHER grid is edited; round-trips back to `'none'`; zero console errors. `npm run
build`, `npm test` (68), `oxlint` (only the pre-existing StepIndicator warning) all clean.

**Not done in this PR (still open in §2.2's neighborhood):** the full §2.1 opening
current-staffing analysis (realized wHPPV vs. band, lean-hour range feeding the §2.4 backlog
diagnostic, effective-wHPPV-after-boarding preview) — the empty-state CTA here is only a
placeholder for §2.1's absent-grid branch. `ReviewStep.tsx` still has no current-staffing
summary line.

## Section 2.4 — backlog diagnostic ENGINE (built 2026-07-24; UI not yet wired)

The pure engine function §4.1 calls out. `src/engine/backlog.ts`, `computeBacklog(grid,
hourlyRequirement, shifts, decay?)` → `BacklogResult`. Re-exported from `engine/index.ts`.
**ASSUMPTION**-tagged. **Diagnostic-only — never imported by `solver.ts`/`compute()`'s solve
path; it reads an already-solved/edited grid.** Callable against ANY grid (idealized or
current), like `recomputeFromGrid`.

- Recurrence exactly as resolved: `backlog[h] = max(0, backlog[h-1]·0.85 + (hourlyRequirement[h]
  − onDutyHeadcount[h]))`, circular over 168h. `DEFAULTS.backlogHourlyDecay = 0.85`
  (`engine/types.ts`). Capacity via `coverageForDay` (reused, not reimplemented).
- **Circular-no-reset implementation:** two full passes over the 168h recurrence — the first
  seeds `backlog[167]` so the Sat→Sun carry into `backlog[0]` is real, not 0. `carriedIn` is
  captured in the final pass so it stays consistent with `backlog` except at the single
  wraparound point (residual ~0.85^167 ≈ 1e-12). Tested directly (deficit only at hour 167 →
  `backlog[0] == 5·0.85`).
- **Outputs:** `backlog[168]`, `longestStreakHours` + `longestStreakStart` (circular run
  detection over a doubled index space so a Sat→Sun-wrapping streak isn't missed),
  `neverClears` (chronic hole → streak 168, no reset hour), `typicalClearHour` (the
  "overnight reset" — hour-of-day caught up on ≥4/7 days), `peakBacklog`/`peakAt`, and
  `shiftDiagnostics[]` (per-shift inherited-vs-generated).
- **Inherited-vs-generated attribution** is a pure PER-HOUR decomposition (carried-in =
  `min(carriedIn[h], backlog[h])`; generated = `max(0, deficit[h])`), attributed to covering
  shift(s) split evenly at hand-off hours via `shiftHoursOfDay` — the SAME even-split
  convention boarding's slot ranking uses. This deliberately avoids any cross-midnight "shift
  span" ambiguity (overnight shifts cover non-contiguous global hours under the within-day
  model — see `.claude/rules/engine-solver.md`), so no span/contiguity logic is needed.
- **Thresholds that are display heuristics, NOT load-bearing math** (safe to tune):
  `BACKLOG_CAUGHT_UP_THRESHOLD = 0.5` nurse-hours (below this an hour reads as caught up);
  the ≥4/7-days rule for calling an hour the reliable reset.
- Tests: `engine/__tests__/backlog.test.ts` (6) — zero-deficit, geometric steady state
  `1/(1-decay)`, circular no-reset + wrapping streak, active-paydown-beats-passive-decay,
  shift attribution, lone-hour-vs-compounding-hole. `npm test` 74 total, `build`/`lint` clean.

**§2.4 UI wiring — DONE 2026-07-24 (see the §2.1 entry below).** The diagnostic now surfaces
in two places: the §2.1 opening analysis (current-grid backlog) and the wHPPV heatmap overlay
(idealized-grid backlog).

## Section 2.1 — opening current-staffing analysis + heatmap backlog overlay (built 2026-07-24)

New component `src/screens/dashboard/CurrentStaffingAnalysis.tsx`, rendered at the TOP of
`CoreGridTab.tsx` (after the ESI/reconciliation banners, before `.plain-summary`) so the page
opens with an analysis of CURRENT staffing, not the idealized grid (spec §2.1). Store-driven;
computes its own `getCurrentStaffingResult()` + `computeBacklog(currentStaffingGrid, …)`.

- **Two states:** with current staffing entered (`hasCurrentStaffing` = any cell > 0) → full
  analysis; otherwise → a `.current-analysis-cta` opener ("Start with your current staffing")
  and the page proceeds to the idealized recommendation. (This is the real §2.1 absent-grid
  branch; the §2.2 comparison-unit empty-state CTA remains as its own inline prompt lower down
  — the two are different spots, intentionally.)
- **Content (templated headline + stat cards, per the §2 design pattern):** realized wHPPV vs.
  the `lookupWhppvBand` p25–p75 band (below/within/above), weekly realized-wHPPV range
  (current grid, same scaling math as CoreGridTab's idealized range), the §2.4 backlog
  "longest lean stretch" + overnight-reset hour, and — when boarding exists — effective wHPPV
  after boarding (`realized − wHppvConsumedByBoarding`) + `boarding.annualFte` to fully cover
  it (previews §2.5). A collapsed-by-default `.why-toggle` explains shortfall-feeds-forward +
  which shift originates vs. inherits the hole (from `backlog.shiftDiagnostics`). ASSUMPTION
  `EvidenceBadge` on the section header.
- **Backlog note:** the §2.1 narrative uses the CURRENT grid's backlog; the heatmap overlay
  (below) uses the IDEALIZED grid's backlog. Two separate `computeBacklog` calls on purpose —
  they answer different questions ("how is my real schedule doing" vs. "where does even the
  recommendation run behind").

**Heatmap overlay (`WhppvHeatmap.tsx` + `CoreGridTab.tsx`) — resolved call #3 implemented:**
the `WhppvHeatmapCell` `atRisk`/single-`riskReasons` flag was split. The **single-hour p25
red-outline is GONE** (superseded by the backlog overlay); the **ENA on-duty floor flag stays**
(red inset outline + "!" — a safety check, not a backlog signal). New per-cell fields
`belowFloor`, `backlog`, `inBacklogStreak` (`= backlog >= BACKLOG_CAUGHT_UP_THRESHOLD`).
Backlog cells get an amber corner dot + amber bottom-bar (`.heat-cell-backlog` /
`.heat-backlog-dot`; a `.heat-cell-risk.heat-cell-backlog` combined rule keeps both outlines
when a cell is both). Legend updated to the two separate items. **Gotcha for future edits:**
`CoreGridTab` had a now-removed `p25Whppv`/`lookupWhppvBand` usage — don't reintroduce a
p25-single-hour heatmap flag; that's the exact thing the backlog overlay replaced.

**Verified end-to-end (Playwright, headless):** no-current → CTA opener, full analysis absent;
with (understaffed) current → analysis heading, headline names realized wHPPV + band position,
ASSUMPTION badge, realized/lean-stretch stat cards, feed-forward "why" explainer; heatmap
legend shows ENA-floor + backlog items and no "p25 band" text; 99 backlog dots rendered
(overlay wiring works). Zero console errors. `npm test` 74, `build`/`lint` clean (only the
pre-existing StepIndicator warning).

## Section 3 (ESI banner) + Section 2.5 (boarding transition) — built 2026-07-24

**§3 ESI-banner removal (UI-copy only):** the top-of-`CoreGridTab` "No ESI mix provided — core
allocation is running on raw volume only" banner is gone, along with CoreGridTab's now-unused
`EvidenceBadge` import. `result.esiConfidenceFlag` is still COMPUTED (engine unchanged) — just
no longer rendered. ESI mix, acuity weighting, the ESI Mix template tab, and the setup flow
are all untouched (spec §1/§3 are explicit: engine keeps ESI, only this banner goes). Don't
reintroduce the banner. The other §3 removals are NOT done here — the Compare section retires
into §2.3 (not yet built), and the split current/diff cards already collapsed in §2.2.

**§2.5 boarding transition bridge:** new `src/screens/dashboard/BoardingTransition.tsx`,
rendered in `DashboardScreen` BETWEEN `CoreGridTab` and `BoardingCoverageSection`. A short
NARRATIVE bridge — no grid — pivoting from the ED-arrivals picture to what boarding costs.
Shows effective wHPPV after boarding for BOTH idealized (`idealizedRealized − consumed`) and
current (`current.realizedWHppv − consumed`, only when current staffing exists) staffing, plus
`boarding.annualFte` to fully cover it as the bridge line into §2.6. **Renders `null` when
`result.boarding` is null** (the boarding section's own "Not produced" note covers that state).
`consumed` = `result.lostProductivity.wHppvConsumedByBoarding` (guaranteed non-null whenever
boarding is). Note: this is a THIRD independent surfacing of effective-wHPPV-after-boarding —
the `.wHPPV-unit` stat (target-based `wHppvAvailableForEdCare`), the §2.1 current-staffing
card, and now this bridge (realized-based, both grids). Intentional per spec §2.1/§2.5; don't
"dedupe" them, they answer different framings.

**Verified end-to-end (Playwright, headless):** manual no-ESI/no-boarding flow → ESI banner
absent + bridge absent + boarding "Not produced"; uploaded filled template (arrivals + Scalars
admit-rate/duration) + current staffing → ESI banner absent, bridge renders with both
idealized & current effective-wHPPV stats and the FTE bridge line. Zero console errors. `npm
test` 74, `build`/`lint` clean.

## Section 2.6 — boarding coverage redesign (built 2026-07-24)

The fourth reversal of the boarding-output shape — full detail in
`.claude/rules/boarding-seasonality.md`'s LAST section (the engine model change lives there, as
the boarding area of record). Summary: replaced the annual-aggregated grid (whose day-of-week
view summed a cell's `+1`s across 12 funded months → the confusing `+12`-vs-~7-FTE mismatch)
with ONE editable representative-week grid; month toggles are SCOPE (which months the plan
applies to, scaling the stats), day toggles removed (zero a day by editing the cell), templated
headline, default funded to the p25 band, "how is this calculated" explainer updated + reframed
away from per-cell hold-vs-additive. Removed engine fns `deriveBoardingCoverageCells` /
`restrictPrioritySlotsToActivePeriods` / `boardingHoursCoveredByGrid` / `fundedCountToReachWhppv`
+ `BoardingCoverageCell` type; added `weeklyBoardingDemandByCell` / `weeklyBoardingCoveredByGrid`
/ `annualBoardingCoveredByWeeklyGrid` / `recommendWeeklyBoardingGrid` / `boardingCoverageFte` +
`BoardingResult.monthFactors`. Kept `prioritySlots` (the new model reads it) + `effectiveEdWhppvAtCoverage`.

**Verified end-to-end (Playwright, headless):** flat-seasonality upload → single grid, small
headcounts (max +1, not months-summed), NO month box, NO day toggles, editing reveals reset;
monthly-seasonality upload → 12 month toggles, headline names the peak-need month (December),
toggling 6 months off scales coverage % down (44%→20%) while the grid pattern stays. Zero
console errors. `npm test` 62 (boarding tests rewritten to the new model: 24 in boarding.test.ts),
`build`/`lint` clean.

## Section 5 judgment calls — ALL RESOLVED with Ben (2026-07-24)

All four open calls were surfaced with concrete recommendations and signed off by Ben this
session. These are now decisions, not open questions — build to them.

1. **Backlog decay formula (2.4) — RESOLVED: `DECAY = 0.85`/hr + active paydown.**
   `backlog[h] = max(0, backlog[h-1]·0.85 + (hourlyRequirement[h] − onDutyHeadcount[h]))`,
   circular over 168h with NO week-boundary reset. ~15%/hr passive dissipation (~4.3h
   half-life); excess-capacity hours actively pay backlog down via the signed deficit term
   (no separate paydown mechanism needed — it's already in the formula). Reuses existing
   shortfall math (`hourlyRequirement` + on-duty coverage), no new demand model. **ASSUMPTION**
   evidence tag (same rigor as the boarding convolution / `effectiveEdWhppvAtCoverage`).
   `0.85` lives as a single tunable `DEFAULTS` constant. Diagnostic-only — NEVER feeds the
   solver or any budget-trim/allocation logic (spec §2.4/§4.1). **Gotcha:** "no boundary
   reset" + circular ⇒ run the 168h recurrence TWICE (a settle pass to seed `backlog[167]`,
   then the reported pass) so the Sat→Sun carry is stable rather than seeded from 0.
   (Ben's pick over the stickier 0.90/hr alternative.)

2. **Shift-menu flexibility solver reversal (2.3) — RESOLVED: PROCEED, scoped tight.**
   This DOES reverse CLAUDE.md §7's "no auto-optimizing shift-menu search (Compare section is
   user-driven side-by-side only)" — confirmed intentional. Scope that keeps the reversal
   honest but bounded: **per-axis opt-in** (start times / shift count / shift length), a
   **bounded candidate enumeration** (e.g. all-8s/10s/12s; a small start-time offset set; ±1
   shift count) each solved through the EXISTING `solveShiftFit` at the **same budget**,
   surfaced as a **side-by-side candidate, NEVER auto-adopted** into the idealized grid
   (preserves "numbers, not a verdict"). It's a user-triggered *advisory* search, not a
   silent optimizer — that's the precise boundary of the reversal. **Must flag prominently in
   that PR's commit/body.** Manual hand-defined alternate-menu path (spec §2.3) is preserved
   alongside. When built, update CLAUDE.md §7 (needs Ben confirm to change that documented
   line — now have it) + `.claude/rules/engine-solver.md`.

3. **Heatmap risk flag vs. backlog streak (2.4) — RESOLVED: split, don't blanket-supersede.**
   The backlog-streak overlay **supersedes the single-hour p25 red-outline** (a streak is
   strictly more informative than a lone short hour). But the **ENA-floor violation flag
   STAYS** — it's an absolute safety-minimum check, orthogonal to demand backlog, and must
   not vanish into a backlog concept. So: p25-single-hour flag → replaced by streak overlay;
   ENA-floor flag → preserved as its own indicator. (Refinement on the spec's "likely
   supersede," which lumped p25 and ENA-floor together.)

4. **"Hours below ideal coverage" stat (2.2) — RESOLVED: KEEP.** Different question than
   backlog (total shortfall *magnitude* vs. whether shortfall *compounds over time*).
   Complementary, not redundant — just make the copy distinguish them.
