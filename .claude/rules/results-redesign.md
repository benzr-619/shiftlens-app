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

**Follow-up, 2026-07-25:** `ShiftMenuStep.tsx` also gained a download-template/upload path
for current staffing, alongside the direct-entry grid — see `.claude/rules/
template-parsing.md`'s "Current-staffing template" section for the full detail (why it's a
second, separate template rather than a fifth consolidated-template tab, and the new
`lib/parseStaffingUpload.ts` / store `setCurrentStaffingGrid` merge behavior).

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
**ASSUMPTION**-tagged. **This specific function is diagnostic-only — never imported by
`solver.ts`/`compute()`'s solve path; it reads an already-solved/edited grid.** Callable
against ANY grid (idealized or current), like `recomputeFromGrid`. **2026-07-26 update:** the
Step 3 trim now DOES feed on this same decay model (a deliberate reversal, see
`.claude/rules/engine-solver.md`'s "Budget-capped trim" section) — via its own local
reimplementation of the identical recurrence (`solver.ts` can't import `computeBacklog`
itself without a circular dependency). So "never feeds the solver" is no longer true of the
backlog MODEL as a whole, only of this literal exported function.

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

**Follow-up, 2026-07-25 — CURRENT-grid heatmap added to §2.1 (not just the current-grid
narrative stats):** `CurrentStaffingAnalysis.tsx` renders its own `WhppvHeatmap` (same shared
`components/WhppvHeatmap.tsx` CoreGridTab uses for the idealized grid — same legend/color
scale, so the two read as directly comparable), below the stat-card row and above the
collapsed "why" toggle. Per-cell realized wHPPV is derived the SAME way CoreGridTab derives it
for the idealized grid — `coverageForDay(currentStaffingGrid?.[day] ?? {}, sortedShiftMenu)` ÷
cell arrivals × a scale factor centered on the reported weekly `realizedWHppv` — just run
against `currentStaffingGrid` instead of the solved grid. No second `computeBacklog` call was
added for the overlay: it reuses the SAME `backlog` (current-grid) result this component
already computes for the narrative stats above it. The ENA-floor overlay reuses
`current.enaFloorViolationsRemaining` from the existing `getCurrentStaffingResult()` call —
also not recomputed. All pure client-side display arithmetic, no engine changes (consistent
with CLAUDE.md Section 6's heatmap convention, now with a second consumer).

A companion shift/day strengths-weaknesses paragraph (templated rollup of over/understaffed
hours by shift-type/day, tying the leanest cell to the "longest lean stretch" stat above) was
built and then DELIBERATELY REMOVED same-day, per Ben's call: it read as "a lot of words saying
nothing" that the heatmap (plus the existing headline/stat cards) already covers, and money was
better spent on heatmap legibility than a fourth restatement of the same shortfall. Don't
re-add a text rollup of this shape without checking first — if the heatmap needs to say more,
prefer improving the heatmap itself over adding parallel prose.

**Verified end-to-end (Playwright, headless), 2026-07-25:** CSV-arrivals upload → no current
staffing → CTA card renders, zero `.whppv-heatmap-wrap` nodes inside `.current-analysis`
(confirms no heatmap in the CTA state). Current-staffing grid filled with a mixed
over/under/zero pattern (14 cells, 2-shift default menu) → full analysis renders, "Where your
current schedule runs lean or rich" heading + a 168-cell heatmap appear, legend shows the same
ENA-floor/backlog items as the idealized heatmap. Zero console errors both states. `npm test`
78, `build`/`lint` clean (only the pre-existing StepIndicator warning).

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

**Follow-up, 2026-07-25 (§2.6.1, additive — not another reversal):** added a second "Actual FTE
to staff this plan" figure alongside the existing coverage FTE, so imperfect shift-block
coverage (fixed 8/10/12h shifts overshooting a cell's exact demand) shows up as visible
"efficiency overhead" instead of being invisible inside a demand-capped number. New engine fns
`weeklyStaffingHoursForGrid` / `annualStaffingHoursForWeeklyGrid`; `scopeWeeks` promoted from
private to exported so both annualizers share one scope formula. Full detail (including the
staffing-FTE == coverage-FTE edge case and its test) is in `boarding-seasonality.md`'s §2.6.1,
now the file's actual last section.

**Verified end-to-end (Playwright, headless):** flat-seasonality upload → single grid, small
headcounts (max +1, not months-summed), NO month box, NO day toggles, editing reveals reset;
monthly-seasonality upload → 12 month toggles, headline names the peak-need month (December),
toggling 6 months off scales coverage % down (44%→20%) while the grid pattern stays. Zero
console errors. `npm test` 62 (boarding tests rewritten to the new model: 24 in boarding.test.ts),
`build`/`lint` clean.

## Section 2.3 — shift-menu flexibility search (built 2026-07-25) — THE SOLVER REVERSAL

Full engine detail in `.claude/rules/engine-solver.md`'s last section (the reversal of "no
auto-optimizing shift-menu search"). Summary of the UI/wiring half:

- **New engine** `engine/flexMenu.ts` (`searchFlexibleMenus`, `FlexAxes`, `NO_FLEX`,
  `MenuCandidate`) — bounded, opt-in, advisory, reuses `solveShiftFit`. 7 tests in
  `flexMenu.test.ts`. Exported from `engine/index.ts`.
- **Store:** `flexAxes: FlexAxes` (default `NO_FLEX`) + `setFlexAxis`. Removed
  `compareVariants`/`CompareVariant`/`addCompareVariant`/`removeCompareVariant`/`updateCompareVariant`.
- **Shared control** `components/FlexAxesToggles.tsx` (store-driven checkboxes) used BOTH at
  setup (`ShiftMenuStep`, the deferred §1 capture — now built) and on results.
- **Results section** `screens/dashboard/ShiftMenuFlexibilitySection.tsx` — the axis toggles,
  the best solver candidate side-by-side (only when it beats current; else "already efficient"),
  and a manual alternate-menu path (`ShiftMenuEditor` + solved comparison, absorbing the old
  Compare tab). Never auto-adopts. Rendered in `DashboardScreen` right after `CoreGridTab`.
- **`CompareTab.tsx` DELETED** (the last §3 removal). Its manual side-by-side lives in the flex
  section now.
- **CLAUDE.md §7 updated atomically** (the reversal line) as part of this build + the full
  maintenance refresh (Ben directed "continue through the plan and maintenance" 2026-07-25).

**Verified end-to-end (Playwright, headless):** setup shift-menu step shows 3 axis checkboxes;
enabling one persists to the results page (shared store); an enabled axis surfaces a candidate
comparison table OR an "already efficient" note; manual mode opens an editor + comparison;
toggling live works; the old `.compare-columns` section is gone. Zero console errors.
`npm test` 69, `build`/`lint` clean.

## ✅ REDESIGN COMPLETE (2026-07-25) — every section of the spec is built

§1, §2.1, §2.2, §2.3, §2.4 (engine + UI), §2.5, §2.6, §3 (all removals), §4 (all engine work),
§5 (all four judgment calls resolved). CLAUDE.md was refreshed to match (Screen/Module maps,
Section 6 rules, Section 7 reversal, Feature Status, store shape). No export feature was built
(spec §0 explicitly didn't want one — the page teaches the story itself). Nothing outstanding
from the spec. Future boarding/solver edits: read `boarding-seasonality.md` + `engine-solver.md`
last sections first (both reversed direction in this pass).

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
   `0.85` lives as a single tunable `DEFAULTS` constant. Diagnostic-only at the time this call
   was resolved (2026-07-24) — never fed the solver or any budget-trim/allocation logic (spec
   §2.4/§4.1). **SUPERSEDED 2026-07-26:** the budget trim now deliberately DOES feed on this
   same decay model — see `.claude/rules/engine-solver.md`'s "Budget-capped trim" section for
   that reversal. The decay formula/constant itself (`0.85`, no boundary reset) is unchanged;
   only "never feeds the solver" no longer holds. **Gotcha:** "no boundary
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

**IMPORTANT — do not confuse with the 2026-07-25 heatmap legibility rework below:** call #3
above retired a *binary per-cell flag* ("is this one hour below p25? outline it red"). The
2026-07-25 rework (last section of this file) makes p25/p75 the heatmap's *continuous color
domain* — a neutral band, not a flag. These are different mechanisms answering different
questions; the rework does NOT un-resolve call #3, and call #3 does NOT forbid the rework.
Read the last section before assuming a conflict.

## Heatmap legibility rework (2026-07-25) — spec `HEATMAP_LEGIBILITY_SPEC_2026-07-25.md`

Display/presentation only — no `engine/` changes. Per CLAUDE.md Section 6's heatmap
convention, per-cell realized-wHPPV arithmetic stays client-side in the components; this
rework doesn't move any of that into `engine/`. Full narrative rationale is in the spec file
(repo root); this section is the code-mapping/gotcha record for future sessions, same as
every other section of this file.

**Two things that look like rule violations and aren't — read this before "fixing" either:**
1. **p25/p75 as a color domain is not the retired p25 flag.** See the boxed note directly
   above — call #3 (single-hour binary flag, GONE) and the neutral-band color domain
   (continuous, THIS rework) are unrelated mechanisms that happen to share a data source
   (`lookupWhppvBand`). CLAUDE.md Section 6 and this file's call #3 were both worded loosely
   enough to read as a blanket "never use p25 on the heatmap again" — they're now reworded to
   say specifically what's retired (the flag) vs. what isn't (p25/p75 as band edges).
2. **Day-of-week display order changed to Mon-Sun; the engine's `day 0 = Sunday` index did
   NOT.** This is a pure render/row-emission-order change — see CLAUDE.md Section 6's new
   Mon-Sun paragraph and `.claude/rules/template-parsing.md`'s note on the legacy-template
   regression test. Nothing in `arrivals[day*24+hour]` semantics moved.

**§1 — Backlog overlay axis fix.** The old marker (`.heat-cell-backlog` bottom box-shadow bar
+ `.heat-backlog-dot` corner dot, both REMOVED) put a horizontal line on a cell's bottom edge
— perpendicular to what it encodes, since a backlog streak is consecutive HOURS, which run
vertically down a day column. Replaced with `.heat-backlog-spine`, an absolutely-positioned
div on the cell's left inside edge, `top: -1px; bottom: -1px` so it overlaps the collapsed
table border and bridges seamlessly into the same spine on a vertically adjacent flagged
cell — a streak then reads as one continuous bracket, no per-cell gap. The ENA-floor red
inset outline + "!" (`.heat-cell-risk`) is completely unchanged; the combined case (both
flags on one cell) just renders both DOM elements independently now rather than needing a
combined CSS selector (`.heat-cell-risk.heat-cell-backlog` was deleted — it had nothing left
to do once the spine moved off `box-shadow` and onto its own element).

**§2 — Backlog weight by magnitude, one shared max.** No new threshold —
`BACKLOG_CAUGHT_UP_THRESHOLD` (engine/backlog.ts, unchanged) still gates "is there a backlog
at all." Above that gate, the spine's `width`/`opacity` scale linearly with
`cell.backlog / backlogMax` (inline styles, computed in `WhppvHeatmap.tsx`'s render — not a
CSS class, since the weight is per-cell continuous data). **`backlogMax` is the max
`peakBacklog` across BOTH the idealized grid's `computeBacklog` result AND the current-staffing
grid's** — computed once in `CoreGridTab.tsx` (`currentBacklogForMax`, a second `computeBacklog`
call purely to fold its peak into the shared max; cheap pure arithmetic, not a second real
diagnostic) and passed as a `backlogMax` prop into both `WhppvHeatmap` instances. Per-grid
normalization was explicitly rejected (spec §2): the two heatmaps are meant to be read side by
side, and a per-grid max would make the same visual weight mean different backlog magnitudes
in each — same reasoning as §6's shared color domain, below.

**§3 — Color scale: neutral band, log-ratio domain, asymmetric ramps.** The largest change,
all in `lib/whppvColorDomain.ts` (`computeColorDomain`, exported type `WhppvColorDomain`) +
`components/WhppvHeatmap.tsx` (`cellVisual`, the named constants at its top). Detail already
captured in CLAUDE.md Section 6's heatmap paragraph (band widening to include the user's own
target, ±15% fallback, log-ratio distance from the crossed edge, asymmetric lean-fast/
rich-slow gamma-eased ramps, muted gray-blue rich hue, white-text-flip threshold) — this file
doesn't re-duplicate all of it, just the gotchas: `computeColorDomain` lives in its own
`lib/` file, NOT in `WhppvHeatmap.tsx` itself, specifically so the component file only exports
components (a function export there trips the `react(only-export-components)` fast-refresh
oxlint rule — the same category of warning as the pre-existing `StepIndicator.tsx` one; don't
reintroduce a second one by moving `computeColorDomain` back). The rich-side clamp anchor
(~2x target) and lean-side saturate point (half the lower band edge) are independently-tunable
named constants, not derived from each other — see the comment block above them.

**§5 — Shift-boundary rules replace fixed hour marks.** `WhppvHeatmap.tsx`'s
`shiftBoundariesByHour(shiftMenu)` builds an `hour -> label[]` map from the (already
CoreGridTab/CurrentStaffingAnalysis-sorted) `shiftMenu` prop; any hour row matching a distinct
`startHour` gets the `.shift-boundary` CSS class (top border rule) and its gutter cell shows
the shift's `label || id` under the hour. Overlapping (swing) shifts just add another label at
their own start hour — no special partition logic, and an overnight shift's within-day-circular
model (`.claude/rules/engine-solver.md`) needs no special handling since the column's top edge
already reads as a boundary. No 6-hourly banding was added; the shift rules replace that idea
entirely, they don't coexist with it.

**§6 — Shared domain, both instances.** `CoreGridTab.tsx` is now the ONE place that calls
`computeColorDomain` and computes `backlogMax` — both are passed as explicit props into its
own `<WhppvHeatmap>` call AND into `<CurrentStaffingAnalysis colorDomain={...}
backlogMax={...} />`, which forwards them to its own `<WhppvHeatmap>` call. `
CurrentStaffingAnalysis.tsx` no longer imports `lookupWhppvBand` itself — its "below/within/
above the typical band" narrative language now reads `colorDomain.low`/`colorDomain.high`
directly, so the heatmap's color and the narrative's band language can never drift apart from
each other, on top of never drifting between the two heatmap instances.

**§4 — Mon-Sun display order, everywhere.** New shared `src/lib/dayOrder.ts`
(`DISPLAY_DAY_ORDER = [1,2,3,4,5,6,0]`, `DISPLAY_DAY_LABELS`) — every day-of-week-rendering
surface imports this one helper instead of defining a local Mon-first ordering:
`WhppvHeatmap`, `ArrivalsGrid`, `CurrentStaffingGrid`, `CoreGridTab`'s idealized + diff grids,
`BoardingCoverageSection`, and `lib/template.ts`'s Arrivals/ESI Mix/current-staffing row
emission. The engine's `day 0 = Sunday` index is untouched everywhere — this is a pure
render/row-emission reorder. Parsers needed NO changes (`parseUpload.ts`/
`parseStaffingUpload.ts` match a row to a day by NAME via `DAY_ALIASES`, never by row
position) — proven by a new regression test
(`lib/__tests__/parseUpload.test.ts`, "§4 regression") that uploads a hand-built legacy
Sun-first arrivals workbook and a Mon-first one with the same underlying data and asserts
identical parsed output. `lib/__tests__/template.test.ts` and
`lib/__tests__/staffingTemplate.smoke.test.ts` each gained a row-order assertion confirming
the generated templates themselves are Mon-first.

**Verification (headless Playwright, screenshots captured for Ben):** a dataset with most
daytime hours inside the band renders mostly blank (not pink) — confirms §3a; a deep-lean
cell reads more alarming than an equally-distant rich cell — confirms §3c; a multi-hour
backlog run renders as one continuous vertical bracket with visibly varying weight — confirms
§1/§2; both heatmaps render identical color for the identical underlying value — confirms §6;
columns render Mon→Sun in every grid; shift-start-hour rules show gutter labels; zero console
errors. `npm run build`, `npm test` (80), `oxlint` clean (only the pre-existing
`StepIndicator.tsx` fast-refresh warning).

## PR D (2026-07-26, `SOLVER_REALISM_SPEC_2026-07-26.md`) — funding-ask surface + explanation rewrite

Last of the four sequenced solver-realism PRs (A: global shift hours → B: asymmetric backlog
recovery → C: convex objective → **D: this section**). Two halves: a new "what does closing
the gap buy" surface, and a pass of copy fixes across the results page that had drifted false
through the A/B/C reversals above.

**Change 1-2 — trim trajectory + `EngineResult.fullCoverage`/`marginalCurve`/`marginalKneePoint`.**
`engine/solver.ts`'s `trimWeekToBudget` was refactored into a shared `trimWeekToBudgetCore`
(the exact same loop, unchanged) plus an optional `onBeforeCut` hook called once per outer
iteration, BEFORE that iteration's cut, with the pre-cut `(capacity, baselineBacklog,
scheduledHours)` state. The public `trimWeekToBudget` never passes the hook (so its own
behavior is untouched by construction — proven directly, not just argued, by
`solver.test.ts`'s byte-identical-grid test). `trimWeekToBudgetWithTrajectory` is the only
caller that does, recording one `MarginalCurvePoint` per cut:
`{ cumulativeHoursAdded, totalSeverity, longestLeanStretchHours, longestLeanStretchStart }`
(the last field is a PR D addition beyond the spec's literal 3-field list — needed so the
funding-ask headline can NAME a stretch, not just count its hours; `longestStreakAboveThreshold`
already computed the position, so exposing it was free). Read BACKWARDS (last point → first),
this is a diminishing-returns curve, guaranteed by construction since the trim is
cheapest-cut-first — no fitting or smoothing.

**Where the trajectory is computed — a decision the spec left open, resolved and flagged
(same category as the flexMenu/relaxation-loop question above):** `compute()`
(`engine/index.ts`) computes `fullCoverage`/`marginalCurve`/`marginalKneePoint` via a
SEPARATE, plain ONE-SHOT `solveFullCoverageWeek` + `trimWeekToBudgetWithTrajectory` call —
deliberately NOT threaded through the Phase 2b relaxation loop (`solveShiftFitWithBacklogFeedback`)
that produces the primary idealized grid. Same reasoning as PR C's flexMenu decision: this is
an ADVISORY curve (what does more budget buy), not the primary schedule, and running the
8-pass relaxation loop just to trace a marginal curve would be a real cost multiplier the
curve's own consumers don't need. This means `fullCoverage`/`marginalCurve` are computed
against a plain one-shot trim, while `grid`/`weeklyScheduledHours` come from the relaxation
loop — the two can diverge slightly in principle (different internal floor-raising), though
`fullCoverage.weeklyHours` itself (from `solveFullCoverageWeek` alone, no trim involved) is
unaffected either way.

**`findMarginalKneePoint`** — classic geometric "elbow" heuristic (max perpendicular distance
from the chord connecting the trajectory's first and last point), not a rate threshold or
curve fit. Returns null below 3 points or when the max bend is under 2% of the chord length
(`KNEE_MIN_BEND_FRACTION`, a tunable display heuristic).

**Edge case, handled explicitly, tested:** a generous `wHppvTarget` can make full coverage
cost LESS than budget (`fullCoverage.fteDelta <= 0`) — a real state (a low-volume ED with a
generous target), not an error. `FundingAskSection.tsx` renders a distinct "your budget
already funds full coverage" branch, no chart, no negative ask. Verified live via Playwright
during this build (a flat low-arrivals dataset with `wHppvTarget: 1.7` actually hit this
branch, not just in unit tests).

**New component `screens/dashboard/FundingAskSection.tsx`** (change 3) — templated headline
per the spec's exact pattern, plus a self-contained inline SVG line chart (no charting
library) of the marginal curve, read right-to-left ("your budget" → "full coverage"), with a
dashed marker at the knee point when one exists. Rendered in `DashboardScreen.tsx` between
`CoreGridTab` and `ShiftMenuFlexibilitySection`.

**Change 4 — heatmap: SECOND reversal of the color mechanism.** Read the existing
"two things that look like rule violations and aren't" note above (2026-07-25 section) before
touching this again — this is now a THIRD data point in that same history, not a conflict
with it. Summary of what actually changed:
- Cell's displayed NUMBER changed from realized wHPPV (`1.2`) to `onDuty/requirement` (`7/9`)
  — demonstrably more intuitive (an ENA-floor-style ratio every nurse reads instantly), and
  realized wHPPV moved to the tooltip.
- Cell's COLOR is now driven by that SAME ratio (`onDuty/requirement`), against a per-cell
  neutral band derived from THIS HOUR's own `bandFloorHourly`/`bandCeilingHourly` (expressed as
  ratios against `requirement`, with `target = 1.0` — "exactly at this hour's own point
  target" replaces "at the week's wHPPV target" as the reference point). This is DIFFERENT
  from the 2026-07-25 rework's week-level `computeColorDomain`/`lib/whppvColorDomain.ts`
  domain — that mechanism is UNCHANGED and still drives narrative band language elsewhere
  (`CurrentStaffingAnalysis.tsx`'s "below/within/above the band" sentence, its stat cards) —
  it just no longer drives THIS heatmap's color. `bandCeilingHourly` finally gets a consumer
  it never had.
- `WhppvHeatmap`'s prop signature dropped `colorDomain` entirely (no longer needed — the band
  is now per-cell, carried on each `WhppvHeatmapCell` as `bandFloor`/`bandCeiling`). The
  legend's numeric range text ("Typical range: 1.2–2.1") is GONE — there is no longer one
  single range to show, since it varies by cell — replaced with a sentence describing the
  per-hour mechanism itself. `computeColorDomain` is unchanged and still exported from
  `lib/whppvColorDomain.ts` for the two components that still need week-level narrative text.
- The "shared-domain-computed-once-in-CoreGridTab" rule is preserved IN SPIRIT: the underlying
  `bandFloorHourly`/`bandCeilingHourly` curves are still `EngineResult` fields computed once by
  `compute()` and read identically by both `CoreGridTab`'s own heatmap and
  `CurrentStaffingAnalysis`'s — there's no longer a single shared prop VALUE to pass down (each
  cell carries its own), but there's exactly one SOURCE curve, same invariant.

**Change 5 — explanation fixes, all copy-level, no engine changes:**
- **`CoreGridTab.tsx`'s "why" explainer REWRITTEN.** The old text ("cutting the hours that are
  cheapest to lose, the ones that create the least shortfall") had been false since the
  2026-07-25 band-floor-deadband reversal and false in a DIFFERENT way after every reversal
  since (PR A/B/C) — the single most user-visible correctness defect on the page. New copy:
  the solver removes whichever shift-hour adds the least queued patient work, weighted so a
  deep hole counts far more than several shallow ones, never cutting below the peer-benchmark
  floor unless the budget makes it unavoidable. Matches PR C's actual objective exactly.
- **Front-loaded-nursing premise added** near the top of the results page (a fixed banner,
  above the §2.1 current-staffing analysis) — the governing premise from
  `SOLVER_REALISM_SPEC_2026-07-26.md` stated in plain language, so a manager whose census
  peaks at 18:00 doesn't conclude the tool is broken when the grid peaks at 13:00.
- **Backlog headline states WHEN**, not just how long. `computeBacklog`'s `longestStreakStart`
  was computed since 2026-07-24 and never read by any consumer until now.
  `CurrentStaffingAnalysis.tsx`'s headline and "Longest lean stretch" stat card both now name
  the day/hour a lean stretch starts (and, when there's a genuine peak, the day/hour it peaks
  and roughly how many nurse-hours are queued there) — reframed in waiting-room terms per the
  spec's governing premise (backlog = un-started front-loaded arrival work = the direct
  antecedent of LWBS).
- **Comparison unit states what the gap BUYS**, not just its size. `CoreGridTab.tsx`'s
  budget/shape headline gained a consequence clause: current-grid total severity vs.
  idealized-grid total severity (`EngineResult.totalSeverity`, PR C), both computed on the
  SAME convex objective the solver minimizes — a direct before/after, not a re-derivation from
  the funding-ask marginal curve (which answers a different question: budget vs. full
  coverage, not current-staffing vs. idealized). `engine/backlog.ts`'s
  `summarizeBacklogSeverity` is called a second time here (client-side, against
  `currentStaffingGrid`) for this specific comparison.
- **"Hours outside your typical staffing range" relabeled** to "Hours below the peer
  25th-percentile staffing floor" — states plainly what it counts (below only, never above)
  and against what (the PEER cohort's 25th percentile, not this ED's own history — "typical
  staffing range" implied the latter). Calculation is UNCHANGED (`computeBandFloorViolations`
  against `bandFloorHourly`, the clamped reporting curve) — copy-only.
- **`backlogFeedbackStillImprovingAtCap` surfaced** — a short caveat line in the "why"
  explainer when Phase 2b's relaxation loop hit its pass cap while still improving (a
  chronically-backlogged scenario that never converged). Previously computed and rendered
  nowhere.
- **Flexibility section states WHICH hours a candidate improves/costs.**
  `ShiftMenuFlexibilitySection.tsx` gained a `biggestSwing` helper (pure client-side arithmetic
  over two already-computed backlog curves — current-menu-one-shot vs. best-candidate) that
  names the single biggest-improvement and biggest-regression hour ("Fixes around Fri 18:00
  [...], costs you around Sun 02:00 [...]"). Also added an explicit retention caveat whenever a
  suggested menu trims a 12h shift down to 8h shifts — a bigger rotation-pattern change than
  the hours-and-coverage numbers alone would suggest.

**Change 6 — flexMenu swing-shift overlay family.** `engine/flexMenu.ts`'s `buildTiling` only
ever produced REGULAR tilings (same length, evenly spaced) — it could never propose a
mid/swing shift layered over the existing menu, "the single most common correct answer to a
unimodal arrival curve" per the spec. New `buildOverlayMenu(currentMenu, length, startHour)` +
bounded `OVERLAY_LENGTHS` (4/6/8h) × `OVERLAY_OFFSETS` (9/11/13/15) family, ≤12 candidates,
tried alongside the regular-tiling family whenever ANY flex axis is enabled (gated on
`anyAxis`, same as the existing "static = no search" contract — an all-off `FlexAxes` still
returns exactly one candidate, unchanged). `searchFlexibleMenus` was refactored to a shared
`trySolve` helper so the two candidate families (tiling + overlay) don't duplicate the
solve-and-score logic. New bound: ≤57 candidates total (was ≤45), still deduped, still bounded.

**Change 7 — headcount semantics, ONE setup question, explicitly NOT role-level modeling.**
New store fields `headcountIncludesIndirectCare: boolean | null` / `indirectCareUpliftPct:
number | null` (both null until answered, no ED-specific default) and a new setup card in
`ShiftMenuStep.tsx` ("Does your headcount include charge and triage nurses?" + an uplift %
field shown only when the answer is "yes"). **DISPLAY-ONLY by design** — neither field is
threaded into `EngineInputs`/`compute()`; they never change `hourlyRequirement`, the grid, the
ENA floor, or any solved number. This was a deliberate scope boundary (the spec explicitly
declined role-level skill-mix modeling) — if a future session is tempted to wire these into
the engine "to make the ENA floor more accurate," that's exactly the modeling the spec
declined; don't, without a new, separate decision.

**Invariants verified:** `reconcile.test.ts` — zero-line diff (untouched by any PR D change).
Recording the trim trajectory does not change the trim's OUTPUT — proven directly (byte-
identical grid with/without recording), not just argued, since both paths share the exact same
`trimWeekToBudgetCore` loop and the recording hook only READS state, never influences the
cut-selection logic. `fullCoverage.weeklyHours >= weeklyScheduledHours` holds in the normal
(budget-constrained) case; the under-budget edge case is handled explicitly and tested at both
the engine level (`solver.test.ts`) and verified live in the browser (see above).

**Verified end-to-end (headless Playwright, this build):** full setup flow (manual arrivals
grid → shift menu → current staffing → headcount-semantics question → review) through to
results, zero console errors in every state exercised: default results page, current-staffing
filled in (triggers `CurrentStaffingAnalysis`'s full narrative + heatmap + the comparison
unit's severity-reduction consequence clause), a flex axis toggled (triggers the swing-shift
overlay search + the "fixes X, costs Y" headline + `MetricsCompare`), and the funding-ask
section's "already funds full coverage" edge-case branch (hit by an actual dataset, not just
forced in a unit test). `npm run build`, `npm test` (121), `oxlint` clean (only the
pre-existing `StepIndicator.tsx` fast-refresh warning) throughout.

## PR F (2026-07-26, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md`) — budget framing, Scenario B, hidden-boarding diagnostic

Three parts, built in the spec's §3/§5/§6.2 order. PR E must be merged first (Scenario B and
the hidden-boarding diagnostic both read `EngineResult` fields PR E didn't touch, but the copy
rewrite in Part 1 touches several of the same strings PR D's copy pass last touched).

### Part 1 — budget framing (§3): four quantities, one word retired from the UI

**Rule:** never call the target-derived figure ("budget") a *budget* in the UI. Engine field
names (`weeklyBudgetHours`, `annualCoreRnHoursBudget`) are UNCHANGED — this is copy-layer only.
Enforced by a new **source-grep test**, `src/lib/__tests__/copyLayer.test.ts`: strips comments
from every `.tsx`/`.ts` file under `src/screens/` and `src/components/`, then fails on any
remaining bare word "budget" (word-boundary regex — does NOT false-positive on camelCase
identifiers like `weeklyBudgetHours`, since there's no boundary between "y" and "B"). This is a
LIVE guardrail, not a one-time cleanup — it already caught two of this PR's own new files
(`ScenarioBSection.tsx`, `HiddenBoardingSection.tsx`) using the word in fresh copy, exactly as
designed.

**Renames, all copy-only, in `CoreGridTab.tsx`/`FundingAskSection.tsx`/
`ShiftMenuFlexibilitySection.tsx`/`DataStep.tsx`:**
- "your weekly budget" -> "target-implied hours" everywhere (the "why this runs over/under"
  toggle, the reconciliation-failure banner, the why-explainer paragraphs).
- The `gapKind` union (`CoreGridTab.tsx`'s size-vs-shape reconciliation) renamed `'budget'` ->
  `'size'` (also the CSS class `.reconciliation-budget` -> `.reconciliation-size`, `App.css`) —
  a code-identifier rename, not just a display-string one, so the copy-grep test doesn't need a
  JSX-vs-code exception carve-out anywhere in this file. `budgetGapHours`/`absBudgetGap` ->
  `sizeGapHours`/`absSizeGap`.
- `FundingAskSection.tsx`: "your budget" (chart axis label + prose) -> "today" / "what
  delivering your target costs" (row 3 of the four-quantity table, not row 2 — the chart's left
  endpoint is `capHours` ≈ delivery cost, not the raw target-implied figure).
- `ShiftMenuFlexibilitySection.tsx`: local variable `budget` -> `targetImpliedHours`; "same
  budget"/"budgeted hours" -> "same target-implied hours" in both the intro paragraph and the
  candidate-comparison headline.

**New rule: overcoverage computes against CURRENT STAFFED HOURS, never falls back silently.**
`CoreGridTab.tsx`'s Coverage-summary "Overcoverage" stat previously always read
`result.overcoveragePct` (engine field, always vs. target-implied hours, regardless of whether
current staffing existed). Now: `overcoveragePctVsCurrent` (new local, current-grid total hours
vs. idealized weekly hours) is the PRIMARY number, target-implied hours shown as a labelled
secondary reference, and the stat is **suppressed entirely** (an em-dash + a prompt, `.stat-
muted` — new CSS class, `App.css`) when no current staffing is entered, rather than silently
reading against the target. `result.overcoveragePctVsTarget` (renamed from `overcoveragePct`
locally, engine field itself unchanged) stays the driver for the "What this schedule means"
panel's own sentence, which is legitimately about target math regardless of current staffing.

**New: the delivery-premium disclosure.** `CoreGridTab.tsx`'s "What this schedule means" panel
gained a line naming `weeklyScheduledHours - weeklyBudgetHours` (row 3 minus row 2 of the
four-quantity table) as its own honest figure — "whole nurses and N-hour shift blocks cost X
hours a week (Y FTE) more than the target's arithmetic implies... a different shift menu is the
one lever that reduces it" — rather than letting it stay folded into a bare "% overcoverage"
that reads like waste. Shown only when the premium exceeds 0.5 hrs (avoids noise on an exact-fit
schedule).

### Part 2 — Scenario B (§5): "the same hours, better placed"

**`engine/index.ts`'s `computeScenarioB(result, inputs, currentStaffingGrid)`** — a PARAMETER
SWAP, not a second solver, per the spec's explicit instruction: calls the EXACT SAME
`solveShiftFitWithBacklogFeedback` pipeline `compute()` uses for the primary grid, with
`weeklyBudgetHours` replaced by the current grid's own total weekly hours — `hourlyRequirement`/
`protectedFloorHourly`/`demandVolatilityHourly`/the ENA floor/the shift menu are all read
straight off the already-computed `result`/`inputs`, never re-derived. A new shared
`resolveBacklogParams(inputs)` helper (extracted from `compute()`) so both `compute()` and
`computeScenarioB` use identical backlog physics (including PR E's `lwbsRate` override) for the
same department. Returns `null` when there's no current staffing (spec: "CTA, not a scenario").

**Edge cases, all handled by the SAME pipeline naturally, not special-cased in
`computeScenarioB` itself** (the trim's own `while (hours > capHours)` loop and
`enforceDepartmentFloor`'s unconditional final pass already produce the right behavior — the
function just reports it): `isFullCoverage` (current hours already >= full-coverage hours —
the trim loop simply never fires) and `overageFromFloor` (current hours below what the ENA
floor needs — `enforceDepartmentFloor` pushes the actual solved hours above the nominal budget;
reported as a real, named overage, never called "hour-neutral" when it isn't).

**CRITICAL FRAMING (spec §5, a UI responsibility, not something the engine function enforces):**
Scenario B is computed on the ARRIVALS budget only. `ScenarioBSection.tsx` (new, rendered in
`DashboardScreen` between `CoreGridTab` and `FundingAskSection`) states this bound in its own
banner **every render**, not as a one-time disclaimer, and frames every outcome as "what
arrivals alone would justify" — never as a standalone recommendation. Three templated headline
branches (full-coverage, near-optimal difference < 5%, and the general case) — all three
written and tested, per §12.3's "chapter 4 must be able to answer yes, entirely" requirement.

**Tests:** `engine/__tests__/scenarioB.test.ts` (6) — null on no current staffing; the parameter-
swap invariant (solved hours land near the current total, not the target); severity reduction
for a badly-shaped current grid; both edge cases; and an "already near-optimal" case with a
NOTE on why the assertion is "not dramatically worse" rather than "identical or better" — the
8-pass relaxation heuristic (`backlogFeedback.ts`) is not guaranteed monotonic across different
effective budgets (the current grid's actual total can differ from the target-implied figure
by the delivery premium), so re-solving at a slightly different budget can occasionally land on
a slightly worse local optimum. This is the same documented oscillation property Phase 2b's own
history already flags, not a bug introduced here.

### Part 3 — the hidden-boarding diagnostic (§6.2): "the advocacy artifact"

**New engine module `engine/hiddenBoarding.ts`, `computeHiddenBoardingDiagnostic`.** Per
(day/night) hour-block, current capacity minus ARRIVALS-ONLY requirement — "the staffing that
exists for something other than arrivals." Day = 07:00-19:00, Night = 19:00-07:00 — a FIXED
calendar convention, deliberately NOT derived from the shift menu (the same day/night split
applies regardless of whether the department runs 8h/10h/12h blocks). Reads `hourlyRequirement`
(already arrivals-only by construction — the separate-budget thesis never touches it) and the
current-staffing grid's actual capacity (`fullWeekCapacity`, same helper every other diagnostic
in this codebase uses, now also exported from `solver.ts`'s existing export block — no new
solver code). Boarding need per block comes from `BoardingResult.cellBoardingRnHours` (the base
weekly representative-week curve, pre-seasonality — matching `hourlyRequirement`'s own
granularity). `boardingNeedHours`/`totalNeedHours` are `null` when boarding data is absent
(never silently computed as zero or falls back to arrivals-only without saying so).

**New section `HiddenBoardingSection.tsx`** (rendered in `DashboardScreen` between
`ShiftMenuFlexibilitySection` and `BoardingTransition`) — per §12.2 profile D, this section
**degrades to a prompt when boarding data is absent, it does NOT return null** (unlike
`BoardingTransition`, which silently renders nothing in that state) — the whole point of this
section is surfacing that half the picture is missing, so silently vanishing would defeat it.

**Templated narrative, three tested mirror-branches per direction (§12.1: no headline may
assume the sign of the gap) — `nightSentence`/`daySentence` helpers, written as PURE functions
already in the shape `src/lib/narrative.ts` will hold once PR H extracts every templated
headline into that one module:**
- Night: (a) staffed beyond arrivals + boarding data present -> "carries N hours beyond
  arrivals... isn't even enough" (or "covers most of what boarding needs," when it does); (b)
  short of arrivals -> the mirror, naming the shortfall AND what boarding still needs on top;
  (c) negligible either direction -> "matches what arrivals justify... nights are not where
  your problem is" (§12.1's own example sentence, verbatim) — negligible is a real, tested
  finding, not a null state. All three repeat with a "boarding data absent" variant that
  degrades gracefully instead of asserting a boarding-specific claim it can't support.
- Day: short of arrivals / beyond arrivals / roughly matching — same three-way split, mirrored.

**Tests:** `engine/__tests__/hiddenBoarding.test.ts` (3) — boarding-absent fields are `null`
(never zero); a hand-built scenario reproducing spec §6.2's QUALITATIVE shape (nights staffed
beyond arrivals need, days short of it) with INVENTED numbers (the real department's own table
can't ship in this repo per §12.6/§14 open question 5 — same constraint PR E's validation gate
observed); and a degenerate zero-current-staffing case (finite, non-NaN, both blocks read
negative).

**Invariants:** no engine changes to `hourlyRequirement`/`annualCoreRnHoursBudget`/
reconciliation from any of the three parts. `reconcile.test.ts` untouched.
`npm run build`/`npm test` (143)/`oxlint` clean (only the pre-existing `StepIndicator.tsx`
warning) throughout all three parts.

## PR G (2026-07-26, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md`) — synthesis chapter + reframed funding ask

PR F must be merged first (reuses `computeScenarioB`'s parameter-swap technique and PR E's
`estimatedAbandonedHours`).

### The synthesis chapter (§7) — where the founding question gets answered

**New `engine/synthesis.ts`, `computeSynthesis(result, inputs, currentStaffingGrid)`.** Adds
arrivals demand (`sum(hourlyRequirement)`) and boarding demand (`BoardingResult
.weeklyBoardingHours`, when present) back together FOR THE READER ONLY — never touches
`EngineResult.grid` (the separate-budget thesis, spec §6/§12, is unchanged by this). Returns
`null` with no current staffing (CTA, not a synthesis).

**Four numbers and a subtraction, then STOP (spec §1(5)):** `totalDemandWeeklyHours`,
`currentStaffedWeeklyHours`, `gapHours` (= their difference — can be `<= 0`, a REAL ending, not
an error), `gapFte`. Plus two supporting numbers: `dayShareOfShortfallPct` (what fraction of the
COMBINED day+night shortfall against current staffing falls in the daytime 07-19 block) and
`gapClosedByReallocationHours` (how much of a positive `gapHours` reallocating the SAME current
hours — against the COMBINED arrivals+boarding demand curve — could close, computed via a
shared parameter-swap solve, capped at `max(0, gapHours)` so the display never claims closing
more than the gap itself). **`SynthesisSection.tsx` renders exactly this arithmetic and NOTHING
else** — no interpretive closing sentence. An earlier draft ending with "the rest is not a
scheduling problem" was explicitly flagged (spec §1(5)) as presuming a residual exists at all —
false for a department that's adequately staffed and merely misallocated. The arithmetic itself
already carries the point for every §12.2 profile without the sentence needing to change.

**Three tested endings (§12.3), `engine/__tests__/synthesis.test.ts`:** (1) positive `gapHours`
— "you need more"; (2) `gapHours <= 0` with a badly-shaped current grid — "you have enough,
they're in the wrong places" (`gapClosedByReallocationHours` is `0` here by construction — no
positive gap to close, even though shape is still bad; the reader gets that from the
comparison-unit card above, not this chapter); (3) no boarding data, current hours matching
arrivals need closely — "you're in good shape" (degrades to arrivals-only demand, per §12.2
profile D, never silently omitting the fact that it's half the picture — the headline says so
explicitly when `boardingDataPresent` is false).

**Reused primitive, not duplicated:** the reallocation solve inside `computeSynthesis` is the
SAME parameter-swap technique `computeScenarioB` (PR F) uses, just against a COMBINED
(arrivals+boarding) demand curve instead of arrivals alone, and using that combined curve
itself as the protected floor (no separate cohort-band concept applies to a synthetic combined
curve). This is also the mechanism PR K's "constrained boarding reallocation" (§6.3) needs —
when that PR lands, extend `computeSynthesis`'s reallocation call site or extract it into its
own named export rather than re-deriving a third copy of this solve.

**Rendered in `DashboardScreen`** at the very end (`SynthesisSection`, after
`BoardingCoverageSection`) — matches the eventual chapter order PR H will formalize
("both budgets together" is the last true content chapter before the branches).

### Reframed funding ask (§7, second half)

**`FundingAskSection.tsx`'s headline REORDERED** to lead with the KNEE of the marginal curve
(the ask that buys the most per FTE) when one exists, with full coverage stated as "the far end
of that range" rather than the headline. The OLD order (full coverage first, knee mentioned as
an afterthought — "But you don't need all of it...") led with an unsellable number and buried
the one that mattered; for the source department this was +14.9 FTE vs. the +2.7 FTE knee.
Falls back to the old full-coverage-first framing only when there's no meaningful knee (`<3`
marginal-curve points or a flat curve, `findMarginalKneePoint` returns `null`) — a real,
tested degenerate case, not a bug. The "already funds full coverage" branch is UNCHANGED (no
knee question applies when there's no gap to ask for at all).

**New `FinancePartnerWorksheet.tsx`** (rendered right after `FundingAskSection` in
`DashboardScreen`) — "do the extra hours pay for themselves," three parts per spec: (1) the
mechanism chain in the tool's own units (more hours -> less queued work -> fewer abandoned
nurse-hours, PR E's `estimatedAbandonedHours` -> fewer LWBS); (2) an explicit, prominent
statement that the tool does NOT convert this to a dollar figure and why (no salary/benefit-
factor/margin inputs collected; a fabricated ROI is the first thing a finance partner attacks);
(3) the worksheet itself, in a visually distinct bordered box (`.finance-worksheet-box`,
`App.css`) — the FTE ask + a MODELED (explicitly labeled as such, not independently
recomputed) reduction in abandoned nurse-hours, then the three numbers to hand a CFO: cost per
FTE, contribution margin per treated visit, current LWBS rate. Renders `null` when there's no
funding gap at all (`fullCoverage.fteDelta <= 0`) or no meaningful knee — same gating as the
reframed headline above, so the worksheet never appears without an ask to attach it to.

**Approximation flagged, not hidden:** the modeled abandoned-hours reduction scales
`estimatedAbandonedHours` (today, against the CURRENT solved grid) by the SAME
severity-reduction percentage the knee-point ask achieves — it is NOT computed against an
actual grid solved at the knee-point budget (the trim's marginal-curve trajectory doesn't
expose a grid per point, only aggregate severity/backlog numbers). Labeled "a modeled estimate,
not an independent recomputation" in the worksheet copy itself. Revisit if the marginal-curve
recorder (`solver.ts`'s `trimWeekToBudgetWithTrajectory`) is ever extended to expose a grid or
backlog curve per point.

**Reaffirmed out of scope (spec §13), still true after this PR:** no dollar/ROI calculator
anywhere. `estimatedAbandonedHours` is never converted to a dollar figure by this tool, in this
worksheet or elsewhere.

**Tests:** `engine/__tests__/synthesis.test.ts` (5). `reconcile.test.ts` untouched.
`npm run build`/`npm test` (148)/`oxlint` clean (only the pre-existing `StepIndicator.tsx`
warning) throughout.

## PR H (2026-07-26, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md`) — page architecture

PR G must be merged first (the chapter rail wraps sections PR F/G added).

### Chapter rail (§8)

**New `components/ChapterRail.tsx`** — sticky (desktop; stacks above content below a 900px
breakpoint, per spec §12.3's explicit mobile carve-out: "a narrow-viewport top bar is a
nice-to-have, not a gate"), `IntersectionObserver`-based scroll-spy, click-to-jump
(`scrollIntoView`). Takes a `chapters: ChapterRailEntry[]` prop — `DashboardScreen.tsx` owns the
actual chapter list/order, the rail only renders and tracks it.

**SCOPE NOTE, flagged in both files' own comments:** the spec's §8 chapter list has 9 entries;
several of those (the opening current-staffing analysis, the idealized-vs-current comparison,
the coverage summary) are still bundled inside the ONE monolithic `CoreGridTab` component. The
rail's 6 entries (`ch-current-staffing`, `ch-scenario-b`, `ch-funding-ask`, `ch-shift-menu`,
`ch-boarding`, `ch-synthesis`) match the ACTUAL top-level sections `DashboardScreen` renders,
not a forced 1:1 mapping onto the spec's 9-chapter ideal. Splitting `CoreGridTab` into its true
sub-chapters is a real, separate refactor — deferred, not silently glossed over. Each `<div
id="...">` wrapper in `DashboardScreen.tsx` is a scroll-spy/jump target; the id list there and
`ChapterRail`'s `chapters` prop must stay in sync (both defined in the one `CHAPTERS` constant).

### The philosophy statement / welcome section (§6.1) — FOUR revisions, read all of them before touching this again

**Revision 1 (2026-07-26, original build).** `CoreGridTab.tsx`'s two top banners MERGED into
one (`.philosophy-statement`, two `<p>`s) — the two-budget expectation-setter (spec §6.1's
exact quoted text, stated first) and PR D's front-loaded-nursing premise (stated second).
REMOVAL rationale (spec §8's "remove the arrivals-premise banner... its content is now part of
item 2"): both banners render before any recommendation, unconditionally, every load —
stacking two separate banners there is exactly the kind of front-loaded friction this redesign
exists to remove. **This is an expectation-setter, not a disclaimer** — do not soften into a
collapsed panel or footnote (spec's own explicit instruction, and it still holds through every
revision below).

**Revision 2 (2026-07-27, first rewrite).** The spec's original text opened with a specific
directional example — "where the numbers below look like they're cutting your nights" —
phrased as if it were a finding about the department currently on screen. It wasn't: the
banner is static, unconditional text shown to every department regardless of shape, so stating
one specific direction read as overcommitted to data the banner never actually looked at.
Rewritten to a generic welcome/orientation framing ("most ED schedules blend the two", no
department-specific claim), stating the page's reading order and folding the two-budgets
concept into that orientation rather than a standalone disclaimer.

**Revision 3 (2026-07-27, same day, hedged rewrite).** A follow-up pass softened revision 2's
generic claim into an explicitly hedged one ("your ED might normally lump these together — if
so, ...") rather than asserting a pattern across ED schedules at all. Still kept the backlog/
task-time mechanism (staffing sized to arrival, busier-later-in-visit shows up as backlog) in
this banner's own body text.

**Revision 4 (2026-07-27, same day).** Replaces revisions 1-3 with fixed copy, per direct ask,
changing three things at once (superseded on heading text/branding only by revision 5 below —
the body paragraph and visual treatment described here are still current):
1. **Adds the explicit product-philosophy rationale** revisions 1-3 never stated outright —
   *why* ShiftLens splits arrivals and boarding into two budgets in the first place ("gives a
   clearer picture of how nursing time is actually being consumed, and makes it easier to
   communicate when and why your staffing falls short"), not just that it does.
2. **Names the mechanism differently per budget** — ED/arrivals workload lands upfront at
   visit start; boarding workload is budgeted via inpatient nursing ratios instead. This is a
   more precise (and more different-per-budget) statement than revisions 1-3's shared
   "staffs to when patients arrive" framing, which described only the arrivals side.
3. **Drops backlog/task-time mechanics from this banner entirely.** Revisions 1-3 all carried
   some version of "a department busier later in a visit's course sees that show up as backlog,
   not headcount" in the banner body itself. Revision 4 removes that thread completely — it
   already lives in `CurrentStaffingAnalysis.tsx`'s collapsed "why" toggle (the feed-forward/
   originates-vs-inherits explainer, §2.1) and in the "Front-loaded nursing" `ConceptCallout` in
   this same file's plain-summary panel (§8 teaching layer, PR J) — so keeping a third copy in
   the welcome banner was redundant, not reinforcing.

**Visual treatment changed too, not just copy.** Revisions 1-3 kept the original `.banner
banner-info philosophy-statement` treatment (bordered, tinted, same visual family as the
ESI/reconciliation banners above it). Revision 4 replaces this with a real heading (`<h2>Welcome
to the Results Page</h2>`) inside a new `.results-welcome` section — deliberately NOT `.card`
(no border, so it doesn't read as another chapter alongside `.comparison-unit`/
`.current-analysis`) and NOT `.banner` (no longer a caveat-style callout — it's a welcome).
`.results-welcome` uses `--bg-card-muted` (a background close to the page's own `--bg` in both
themes, distinct from `.card`'s brighter `--bg-card`) and a 40px bottom margin to create real
whitespace before the first chapter card ("Your current staffing, analyzed"). New CSS in
`App.css`; `.philosophy-statement`'s CSS rule was removed (no longer referenced anywhere in
`src/`). Copy/CSS-only change throughout all four revisions — no engine/store impact, `npm
test` a no-op every time.

**Placement moved to `DashboardScreen.tsx`, same day (2026-07-27, immediately after revision
4 above shipped).** `.results-welcome` originally rendered as the first thing inside
`CoreGridTab.tsx` — which put it INSIDE `.dashboard-content`, the flex:1 column beside the
sticky `.chapter-rail` (`.dashboard-body`'s two-column layout, PR H). That confined it to the
content column's width, not the full page width, and put it below the rail's own top edge, not
above it. Moved to `DashboardScreen.tsx`, rendered directly inside `.dashboard-screen` — ABOVE
`.dashboard-body` entirely, so it now spans the full page width and sits above the chapter rail,
not beside it. `CoreGridTab.tsx` keeps a short comment marking where it used to render and
pointing here, so a future session doesn't accidentally re-add a second copy inside the chapter
content. **Ordering on the page, top to bottom, is now:** "← Back to setup" (top-left,
`.dashboard-topbar`) → `.results-welcome` (full width) → `.dashboard-body` (sticky chapter rail
+ scrolling chapter content).

**The redundant page title was also retired in this same pass.** `DashboardScreen.tsx`'s
`.dashboard-topbar` used to open with `<h1>ShiftLens — Results</h1>`, immediately followed by
`.results-welcome`'s own "Welcome to the Results Page" — two page-level titles stacked directly
on top of each other. The `<h1>` is gone; `.dashboard-topbar` now holds only the "← Back to
setup" button (moved to be the topbar's FIRST child, so `justify-content: space-between` puts
it at the top-left) and the "Export to PPTX" button (still on the right, unchanged). No CSS
changes were needed for this — `.dashboard-topbar`'s existing flex/space-between rule already
produces the right layout once the `<h1>` is simply removed from the JSX.

**Revision 5 (2026-07-27, same day) — heading text + branding, following the `<h1>` removal
above.** Once the page-level `<h1>ShiftLens — Results</h1>` was retired, the results page had
no product branding anywhere on it at all. Two changes, both in `DashboardScreen.tsx`/`App.css`,
copy/CSS-only:
1. **Heading text changed** from "Welcome to the Results Page" to **"Your ShiftLens Results"** —
   names the product and makes clear these are *this department's* results, not a generic page
   title.
2. **The `/favicon.svg` mark** (the same rounded-square-tile lightning-bolt asset
   `WelcomeScreen.tsx` already uses at 56px as `.welcome-logo`) is now rendered inline next to
   the heading at 32px (new `.results-welcome-icon`, wrapped with the `<h2>` in a new
   `.results-welcome-header` flex row, `gap: 12px`). `alt=""` — the icon is decorative next to a
   heading that already states the same thing in text, so a repeated "ShiftLens" in the
   accessibility tree would be redundant, not informative (same convention as any icon-plus-
   label pairing elsewhere in this app). No new asset was added; this reuses the one mark the
   app already ships.

Body paragraph copy (the two-budget product-philosophy text) is UNCHANGED by this revision —
only the heading and its accompanying icon changed.

### Narrative extraction (`src/lib/narrative.ts`)

Every function is PURE — `(values) -> string`, no JSX, no store access, unit-tested directly
(`lib/__tests__/narrative.test.ts`, 8 tests) and exercised by `engine/__tests__/
syntheticSweep.test.ts`'s narrative hook (now a REAL check, not a no-op — see that file's
updated comment). Covers: the coverage-summary overcoverage/delivery-premium/wHPPV-range
sentences (`CoreGridTab.tsx`), the comparison-unit headline (`gapKind`-branched), Scenario B's
three branches, the hidden-boarding night/day sentences (both directions + negligible, per
§12.1), the synthesis headline (three §12.3 endings), and the funding-ask's two branches.

**SCOPE NOTE, flagged in the file's own header — read before assuming this is fully wired up:**
the covered components still render their OWN JSX inline (with `<strong>` emphasis these
plain-text functions don't reproduce) rather than calling these functions directly. Swapping
already-verified, live UI copy over to a plain-text renderer without a way to visually
re-verify emphasis/layout in this session (no Playwright installed — see
`.claude/rules/synthetic-fixtures.md`) was judged a worse risk than a documented, temporary
duplication, WORDED IDENTICALLY on both sides. These functions exist today for (1) the sweep's
narrative hook and (2) PR L's PPTX export, which needs a single source for slide titles. Wire a
component over to call its narrative.ts function the next time that section's copy changes —
that closes the duplication section by section, not in one large risky pass. Two small helper
wrappers (`scheduleMeansOvercoverageFromResult`, `deliveryPremiumFromResult`) exist specifically
so the sweep's `(result, inputs)`-only hook has at least a few real functions to exercise;
most others need additional context (a grid, a current-staffing grid) that hook can't supply
and are silently skipped by its own tolerant try/catch — expected, not a gap.

### Removals and fixes

- **ASSUMPTION pill removed from the RESULTS page.** `CurrentStaffingAnalysis.tsx`'s
  `<EvidenceBadge status="ASSUMPTION">` on the backlog diagnostic is gone (always-on, therefore
  no information, per spec). `EvidenceBadge` STAYS on setup screens (optional-vs-required IS
  real information there). Provenance for this diagnostic moves to Chapter 9 (PR I) — not yet
  built; until then this specific ASSUMPTION tag has no on-page equivalent, which is the
  intended state per spec (a stopgap "what this is based on" line was considered and deferred
  to avoid duplicating PR I's actual evidence surface).
- **Realized-wHPPV range now spans the 168 HOURS, not the 7 days, and NAMES the hours the
  extremes fall on.** `CoreGridTab.tsx`'s range sentence used to compute a per-DAY min/max
  (7 values) with no location attached — "a range with no location attached gets read past"
  (spec's own words). Now reuses the SAME per-cell `whppv` values already computed for the
  168-cell heatmap (`heatmapCells`) to find the true min/max hour and names it
  ("around Sat 07:00") — no new computation, no engine changes, pure display arithmetic over an
  already-computed array.

**Invariants:** no engine math changes anywhere in this PR. `reconcile.test.ts` untouched.
`npm run build`/`npm test` (156)/`oxlint` clean (only the pre-existing `StepIndicator.tsx`
warning) throughout. No Playwright verification was possible (no such harness in this repo,
per `.claude/rules/synthetic-fixtures.md`) — rail scroll-spy/jump behavior and the merged
banner's visual layout are UNVERIFIED IN A BROWSER this session; a future session with visual
access should confirm before treating this as fully done.

## PR I (2026-07-26, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md`) — evidence surface (Chapter 9)

PR H must be merged first (reads `src/lib/narrative.ts`'s existence conceptually, though this
PR doesn't call into it directly — the constants table follows the same "generated, not
transcribed" principle narrative.ts follows for copy).

**Success condition (spec's own words): an analyst can reconstruct the pipeline from this page
alone and find nothing undisclosed.**

**New `screens/dashboard/EvidenceSurfaceSection.tsx`** — Chapter 9, "How this works," rendered
last, collapsed by default (same `.why-toggle` pattern every other collapsed explainer in this
app uses — CLAUDE.md Section 6). Visually set apart via `.evidence-surface` (muted background +
top rule, `App.css`) rather than styled as another narrative card — spec §8's own instruction
that branches off the main chapter arc read differently from the argument itself.

Six parts, all in one component:
1. **Pipeline walkthrough** — Steps 1/1b/1c/2/3, each with its formula, inputs, and one "why"
   sentence, in plain prose (written for an analyst, but jargon density is explicitly NOT a
   credibility signal per the spec).
2. **Constants table — new `lib/constantsMetadata.ts`, `buildConstantsTable()`.** GENERATED
   FROM `DEFAULTS` AT RUNTIME, not transcribed into prose — the function iterates
   `Object.keys(DEFAULTS)` and throws if any key lacks a hand-written `METADATA` entry (label /
   what it controls / evidence tag / what changes if you move it), so a constant added to
   `DEFAULTS` without documentation fails loudly rather than silently rendering an incomplete
   table. The VALUE column always reads the live `DEFAULTS` object — a prose copy of a constant
   can drift when the constant's default changes; this can't, since it's the same object.
3. **Data provenance** — every number classified into one of three buckets (your data / peer
   cohort / modeled assumption), replacing the ASSUMPTION pill PR H removed from the results
   page — more informative because it's comparative, not just a binary flag.
4. **Known approximations** — the spec's own minimum list, verbatim in spirit: the 48-hour
   `BACKLOG_SIM_WINDOW_HOURS` truncation, linear boarding recovery, month-scope conservation
   (annual-exact, can drift within any one month), circular no-reset, greedy set-cover (not
   exact ILP), and boarding census being derived from admit timing rather than measured.
5. **The reconciliation invariant**, presented as the correctness proof it is — live numbers
   (`result.reconciliation`), not a static claim, so a genuine reconciliation failure (the
   existing error banner elsewhere on the page) is also visible here in its proper framing.
6. **Decisions and rejected alternatives** — mean-not-median for boarding duration, why p75
   never enters the point target, why severity normalizes by requirement not raw nurse-hours,
   why there's no dollar layer, and the separate-demand thesis (arrivals/boarding) — sourced
   from `.claude/rules/`'s own history rather than re-derived from scratch.

**Copy-layer note:** several early drafts of this section's prose used "budget"/"budgeted" in
the generic sense ("boarding census (separate budget)", "arrivals and boarding are budgeted
separately") — caught by PR F's copy-grep test (`copyLayer.test.ts`) and reworded to "a separate
demand"/"modeled as two separate demands" rather than added to that test's narrow philosophy-
statement allowlist, since these weren't spec-mandated exact quotes the way §6.1's text is.

**Tests:** `lib/__tests__/constantsMetadata.test.ts` — one row per `DEFAULTS` key, every field
non-empty, the value read live (not a copied literal). `reconcile.test.ts` untouched — this PR
made no engine changes.

`npm run build`/`npm test` (157)/`oxlint` clean (only the pre-existing `StepIndicator.tsx`
warning). No Playwright verification possible (no such harness in this repo) — the collapsed/
expanded toggle and table layout are unverified in an actual browser this session.

## PR J (2026-07-26, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md`) — teaching layer

PR H must be merged first (reuses the `.why-toggle` pattern established there/earlier). Can run
in parallel with PR I — no shared files.

**Goal (spec §0): a manager with no stats background reads the page once and can afterward
explain to their CNO, in their own words, whether their department is understaffed, where, how
much they can fix themselves, and what the rest costs.**

**New `components/ConceptCallout.tsx`** — REUSES the existing `.why-toggle`/`.why-explainer`
disclosure pattern (CLAUDE.md Section 6) rather than inventing a second idiom; collapsed by
default so a returning user isn't re-taught. Six concepts, each placed at its FIRST use:

| Concept | Where |
|---|---|
| wHPPV | `CoreGridTab.tsx`, "What this schedule means" panel |
| Front-loaded nursing | same panel |
| Averages under-staff you half the time | same panel |
| Right total != right shape | `ScenarioBSection.tsx` |
| Depth beats spread (convexity) | `ScenarioBSection.tsx` |
| Two budgets, one department | `HiddenBoardingSection.tsx` |

**New `components/ConvexityDemo.tsx`** — THE ONE interactive, per the spec's explicit
instruction (convexity is the least intuitive AND most load-bearing concept — it's literally
the Step 3 trim's objective, and prose does it badly). Two fixed scenarios, same 10 nurse-hours
of shortfall against the same 10-nurse-hour requirement baseline: spread across 4 hours (2.5
each) vs. concentrated in 1 hour (10). Uses the REAL `severity` function imported from
`engine/solver.ts` — not a mock — so the numbers shown are exactly what the Step 3 trim itself
would compute for these two shapes. `engine/__tests__/convexityDemo.test.ts` verifies the
pedagogical claim the component makes (concentrated scores higher/worse) actually holds under
the real function, not just asserted in prose.

**Guardrails honored:** no glossary page (nobody reads one — six inline callouts instead);
collapsed by default everywhere; every headline stays a complete, quotable sentence with
numbers interpolated (the callouts add explanation ALONGSIDE headlines, never replace one).

**Tests:** `engine/__tests__/convexityDemo.test.ts` (1). No engine changes elsewhere.
`npm run build`/`npm test` (158)/`oxlint` clean (only the pre-existing `StepIndicator.tsx`
warning). No Playwright verification possible — the six callouts' collapsed/expanded behavior
and the convexity demo's bar rendering are unverified in an actual browser this session.

## PR K (2026-07-26, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md`) — input integrity + boarding copy + constrained boarding reallocation

PR F must be merged first (`computeCombinedReallocation` extends PR G's synthesis primitive,
which itself reused PR F's `computeScenarioB` technique).

### 1-2. Input integrity checks (§10)

**New `lib/inputIntegrity.ts`** — two pure, diagnostic-only functions, NEVER auto-correcting:
- `checkBoardingDurationConsistency(scalarBoardingDuration, monthlyMeans, dayOfWeekMeans)` —
  compares the Scalars-tab scalar duration against the plain average of the per-period means;
  flags when they disagree by more than ~15% (`CONSISTENCY_TOLERANCE`, a display heuristic).
  Falls back to day-of-week means when monthly means are absent. Returns `null` when there's
  nothing to compare (matches the engine's own graceful-degradation convention). The message
  this powers names BOTH numbers and says which one the calculation actually uses (the scalar
  — see `engine/boarding.ts`'s `overallMeanBoardingDuration`) rather than auto-correcting either.
- `checkMonthlyDispersion(monthlyMeans)` — flags implausible month-to-month swings (>= 3x,
  `DISPERSION_RATIO_THRESHOLD`) as "possible small-sample months," without refusing the input.

Both wired into `screens/setup/DataStep.tsx`, rendered live (recomputed from current store
state, not just at the moment of upload) right below the existing data-status list — surfaced
where the data enters, since that's where it's actionable.

**Tests:** `lib/__tests__/inputIntegrity.test.ts` (7) — reproduces the QUALITATIVE shape of the
real defect (scalar ~10hrs vs. monthly-average ~6.4hrs, a ~37% gap) with INVENTED numbers (the
real figures can't ship per §12.6/§14 open question 5), plus within-tolerance, day-of-week
fallback, null-guard, and both dispersion-flagged/not-flagged cases.

### 3. Missing-input consequences at results time (§10.3)

**`CoreGridTab.tsx` gains a NEW banner reading `result.esiConfidenceFlag`** — this is NOT a
resurrection of the 2026-07-24-removed "no ESI mix" caveat banner (that one just stated the
absence); this one states the CONSEQUENCE for what's being read ("hours where sicker patients
tend to arrive may be under-weighted relative to what they actually need"). `esiConfidenceFlag`
was already computed by `compute()` and simply not rendered anywhere since that removal — this
PR gives it a consumer again, reworded per spec's explicit ask (missing-input consequences
belong at results time, not only setup time).

### 4. Boarding methodology copy rewrite (§10.4) — apology to shopping list

**`BoardingCoverageSection.tsx`'s "How is this calculated?" explainer REWRITTEN.** Every
ASSUMPTION-flavored paragraph now follows the same inversion: state what was COMPUTED, then
name the BETTER DATA that would replace the derivation and roughly where it lives (bed-
management/ADT systems for a real hourly census; finance/throughput reporting for real monthly
boarding hours; a real before/after coverage comparison to calibrate the linear-recovery
assumption) — Ben's own framing: *"if there is better data / a better way to do this, I should
look into getting it rather than relying on derivation."* The stale "a dollar cost layer is
designed but not yet built" line (contradicted by spec §13's reaffirmed no-dollar-layer stance)
was replaced with a pointer to the finance-partner worksheet (PR G) instead.

### 5. Constrained boarding reallocation (§6.3)

**`engine/synthesis.ts`'s reallocation logic EXTRACTED into a new exported
`computeCombinedReallocation(result, inputs, currentStaffingGrid)`** (was inlined in PR G's
`computeSynthesis`, which now calls this shared function instead of re-deriving it) — the same
parameter-swap technique as `computeScenarioB` (spec §5), against the COMBINED
arrivals+boarding demand curve, at the CURRENT total hours. Returns `null` with no current
staffing. New fields beyond what `computeSynthesis` needed:
`arrivalsShortfallHoursBefore`/`After` — the shortfall against ARRIVALS ALONE before/after
reallocation, whose difference is the real, named COST this reallocation imposes on arrivals
coverage.

**New `screens/dashboard/ConstrainedReallocationSection.tsx`**, rendered at the END of the
boarding chapter (after `BoardingCoverageSection`, still inside `ch-boarding`) — presented as a
COMPROMISE WITH ITS COST NAMED, every render, never as the recommendation (a banner states this
plainly, matching `ScenarioBSection`'s "every render, not once" convention). Renders `null`
without both current staffing AND boarding data (this is specifically an arrivals-vs-boarding
trade-off question, which doesn't exist without both demands present).

**Tests:** `engine/__tests__/combinedReallocation.test.ts` (4) — null with no current staffing;
combined shortfall improves for a badly-shaped grid; a real, finite, non-negative cost on the
arrivals side; and scheduled hours never meaningfully exceed the current total (a placement
change, not a funding ask — same "full coverage costs less than current" edge case Scenario B
already handles is a real, separate state, not tested for near-equality here).

**Invariants:** no changes to `hourlyRequirement`/reconciliation. `reconcile.test.ts` untouched.
`npm run build`/`npm test` (169)/`oxlint` clean (only the pre-existing `StepIndicator.tsx`
warning) throughout. No Playwright verification possible — the new DataStep banners and the
constrained-reallocation section's layout are unverified in an actual browser this session.

## PR L (2026-07-26, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md`) — PPTX export

PRs H and I must be merged first (reads `src/lib/narrative.ts` and the method-content shape).

**New dependency: `pptxgenjs@4.0.1`** (client-side, no backend — `writeFile()` triggers a
browser download; nothing is uploaded anywhere). No new high-severity `npm audit` findings
attributable to it (the two existing high-severity advisories — `xlsx`, and `postcss` via
`vite` — both pre-date this PR).

**New `lib/pptxExport.ts`, `exportResultsToPptx({ result, inputs, currentStaffingGrid,
wHppvTarget })`.** Slide titles are pulled from `src/lib/narrative.ts` — the SAME functions
(`scenarioBHeadlineSentence`, `hiddenBoardingNightSentence`/`DaySentence`,
`synthesisHeadlineSentence`, `fundingAskKneeLeadSentence`/`AlreadyFundedSentence`,
`comparisonHeadlineSentence`, `scheduleMeansOvercoverageSentence`, `deliveryPremiumSentence`) —
never a second, hand-written set of titles. This is the reason PR H's narrative extraction
exists in the first place.

**Deck order mirrors the chapter rail:** title → what your department demands → what you staff
against it → could moving hours fix it (Scenario B) → what this costs/what it buys (funding ask
+ finance-partner worksheet) → the second demand: boarding (SKIPPED — both the boarding slide
AND the constrained-reallocation slide — when `result.boarding` is null; no empty placeholder)
→ both budgets together (synthesis) → **Method & Limitations, ALWAYS included, never
optional** (a constants table via `lib/constantsMetadata.ts`'s `buildConstantsTable()` — the
SAME generated-from-`DEFAULTS` table PR I's evidence surface uses — plus the reconciliation
check's live pass/fail state).

**Grids as NATIVE PPTX TABLES** (`slide.addTable`, with header cell fills), not images —
editable and they survive being pasted into someone else's deck. `gridToTableRows` (shared
helper) renders both the idealized and current-staffing grids this way.

**Speaker notes** (`slide.addNotes`) on every slide — plain-English explanation matching the
same content the page's `ConceptCallout`/"why" text carries (PR J), so a manager presenting for
the first time has something to say out loud, not just numbers to point at.

**No current staffing:** most slides render a plain "no current staffing was entered for this
export" line instead of throwing — verified directly (`pptxExport.test.ts`'s fourth test).
**No boarding data:** the boarding + constrained-reallocation slides are OMITTED from the deck
entirely (not rendered empty) — verified by asserting a full dataset produces strictly MORE
`addSlide()` calls than an arrivals-only one.

**Export entry point:** `DashboardScreen.tsx` gained an "Export to PPTX" button in the topbar
(`.dashboard-topbar-actions`), calling `exportResultsToPptx` with the current store state.

**Tests:** `lib/__tests__/pptxExport.test.ts` (4) — spies on `PptxGenJS.prototype.writeFile`
(mocked, so no file is actually written during tests) and `addSlide` (NOT mocked — real slide
construction still runs, only call-count is tracked) to verify: a full dataset exports without
throwing; an arrivals-only dataset (boarding absent) still exports and still includes Method &
Limitations; the full dataset produces strictly more slides than the arrivals-only one (proving
boarding slides are actually skipped, not just documented as skippable); and a no-current-
staffing dataset doesn't throw.

**Not verified this session:** the actual generated `.pptx` file's slide COUNT/titles were not
opened in PowerPoint/Keynote (no such tooling available in this environment) — the test suite
verifies the JS-level construction (slide count, no exceptions, `writeFile` invoked with the
right filename) but not the binary file's own structural validity beyond what `pptxgenjs`
itself guarantees.

**Invariants:** no engine changes. `reconcile.test.ts` untouched. `npm run
build`/`npm test` (173)/`oxlint` clean (only the pre-existing `StepIndicator.tsx` warning).
`DashboardScreen.tsx`'s `handleExport` uses a dynamic `import('../lib/pptxExport')` (not a
static top-level import) specifically so `pptxgenjs` (~400KB minified) loads into its own
chunk, fetched only when a user actually clicks "Export" — the main bundle is unaffected by
this dependency's size.

## Guided setup + measured boarding census (2026-07-27, `SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md` + same-day follow-up prompt) — Part 6 results-page copy

Full engine/parser/template detail is in `.claude/rules/boarding-seasonality.md`'s and
`.claude/rules/template-parsing.md`'s own measured-path sections; this entry covers just the
Part 6 results-page copy changes.

- **BH boarding understatement callout** — `BoardingCoverageSection.tsx`, rendered whenever
  `boarding.bhWeeklyRnHours !== null`: a medical-vs-BH RN-hours/week split line, then a
  required (not optional-framing) banner stating these figures are RN-only and BH boarding's
  true operational cost (techs/sitters/security) is understated by any RN-staffing view.
- **Boarding methodology explainer** (the PR K apology→shopping-list rewrite) — its first
  ("Computed: an hourly boarding-census curve...") and third ("month toggles are
  scope...Better data...") paragraphs now branch on `boarding.censusSource === 'measured'`:
  each says **Satisfied** instead of naming better data to chase, since the measured path
  already IS that better data. The linear-recovery and coverage-vs-staffing-FTE paragraphs are
  UNCHANGED regardless of path — they're not about where the census comes from.
- **Evidence surface (`EvidenceSurfaceSection.tsx`)** — the "Your data" provenance row lists
  the measured census (medical + BH if tracked) instead of admit rate/boarding duration when
  `censusSource === 'measured'`; a new provenance row states the bed-request clock definition
  explicitly ("the one thing that makes a department's boarding number comparable to a
  peer's," per spec) whenever measured; the "modeled assumption" row drops "the boarding
  census convolution" on the measured path. Three known-approximation bullets (derived
  boarding census, mean-not-median duration in Decisions, the duration-conflated month index)
  are now conditional — hidden when `censusSource === 'measured'`, since none apply. A new
  Decisions bullet documents ESI-3-as-unbiased-anchor as an inference from one department's
  data, not a proven universal (mirrors the existing open question in
  `.claude/rules/template-parsing.md`).
- **ESI normalization disclosure (Part 5)** — `normalizeEsiMix`'s adjustment summary is
  surfaced in TWO places: `TutorialFlow.tsx`'s ESI tutorial step (item 6), computed live from
  the arrivals/esiMix currently in the store, and `EvidenceSurfaceSection.tsx` (a `degrade-note`
  paragraph right after the provenance table) — both read the SAME `normalizeEsiMix(arrivals,
  esiMix)` call, so the two disclosures can't drift apart. States plainly that ESI 3 is treated
  as least-biased and that the true answer likely sits between this and even scaling.
- **Pre-bed-request census validation (§7, optional)** — new `engine/
  preBedRequestValidation.ts`'s `computePreBedRequestValidation`, rendered as its own small
  subsection in `EvidenceSurfaceSection.tsx` only when `preBedRequestCensus` was supplied.
  Compares observed non-boarding occupancy against `hourlyRequirement / wHppvTarget` (a rough
  visit-equivalent proxy, explicitly labeled as such, not an exact occupancy model) via mean
  comparison + Pearson correlation. Diagnostic only — no solver interaction, no headline, no
  change to any recommendation, per the spec's explicit "keep it small" instruction.

**Setup-side changes (not results-page, noted here for completeness — full detail in
`.claude/rules/template-parsing.md`'s "Guided setup walkthrough" section):** `DataStep.tsx` is
deleted, replaced by `SetupEntryFork.tsx` (`setupMode` fork) → `TutorialFlow.tsx` (guided,
one item per screen) / `ColleagueRequestPage.tsx` / the 'returning' upload-then-jump-to-Review
path inside the fork itself. `BoardingFork.tsx` is the tutorial's boarding-path question. A
Settings tab and a `boardingCensusClockStart` field were both built earlier in this same
session and then REVERTED — see `.claude/rules/template-parsing.md`'s reversal sections for
why, and don't reintroduce either without checking first. `ReviewStep.tsx` gained a "Download
my data file" export (Part 3, the app's only persistence) — see template-parsing.md's export
section for the round-trip guarantee and test.

---

## Results Page V2 (`RESULTS_PAGE_V2_SPEC_2026-07-27.md`) — five panels, one visual frame, a sandbox

The next full rebuild of this results page, superseding almost everything documented above in
this file about the current chapter-by-chapter architecture (`CoreGridTab`/`ScenarioBSection`/
`FundingAskSection`/etc.) — see the spec's own §2 for the full reversal list (R1-R12), each
confirmed with Ben after reviewing the rendered page against a real department's data. PRs land
in the sequence the spec's §8 table specifies (A0 → H); this section accrues one entry per PR,
same convention as the rest of this file. **Read the spec in full before touching any PR in this
sequence** — it is the governing document, not a paraphrase of it.

### PR A0 — Playwright browser test harness

Full detail lives in `.claude/rules/synthetic-fixtures.md`'s Playwright section (the harness is
fixture-adjacent, not results-page-specific) — `@playwright/test`, `npm run test:e2e`, the
`window.__shiftlensSeed` dev-only hook, `e2e/smoke.spec.ts` covering all eight named profiles.
Built first per the spec's own instruction, since every PR from D onward is visual and this repo
had never had a way to verify visual work before this.

### PR A — backlog reporting confirmation + pattern namer

Full detail lives in `.claude/rules/engine-solver.md`'s new "PR A" section (the backlog-curve/
threshold finding is solver-adjacent) and `src/lib/whenPattern.ts`'s own header (the pattern-namer
ladder + its flagged rung-3-unreachability finding). Engine/lib only, no UI — the actual heatmap/
stat changes this finding motivates land in PRs D/E.

### PR B — full coverage over combined demand (§5.3)

New `EngineResult.fullCoverageCombined: { weeklyHours: number; grid: Grid }` (`engine/index.ts`)
— Panel 3's ceiling. Reuses `solveFullCoverageWeek` verbatim against the COMBINED demand curve
(`hourlyRequirement + boarding.cellBoardingRnHours` when boarding is present) — no second solver,
per the spec's explicit instruction. **Resource-agnostic by construction**: `solveFullCoverageWeek`
has no concept of ED-vs-hold nurses (§3.5 is a Panel-5-only distinction) — it only ever asks "how
many total nurse-hours, placed where, cover this demand curve with zero shortfall anywhere."

**Always computed, never null** — a deliberate choice over returning `null` when boarding is
absent. With no boarding data the combined curve degenerately equals `hourlyRequirement` alone,
so `fullCoverageCombined.weeklyHours === fullCoverage.weeklyHours` exactly — the mathematically
correct answer for "zero boarding demand," not a special case needing a guard. Consumers that
need to know whether boarding was actually included should check `result.boarding` (already
nullable), not infer it from whether this field differs from `fullCoverage`.

Computed AFTER `boarding` in `compute()`'s body (moved from where `fullCoverage`, the
arrivals-only version, is computed — that one still runs before `boarding` since it doesn't need
it) — the one structural change this PR made to `engine/index.ts`'s existing code, since the
combined curve needs `boarding.cellBoardingRnHours` to exist first.

**Tests** (`engine/__tests__/fullCoverageCombined.test.ts`, 4): the no-boarding degenerate-equality
case; strictly-greater-than-arrivals-only when boarding is present; a direct reconstruction of
capacity from the returned grid, confirming it never falls short of the combined demand curve at
any of the 168 hours (not just trusting the solver's own invariant); and confirmation that
`annualVisits`/`annualCoreRnHoursBudget`/`hourlyRequirement`/`reconciliation` are completely
untouched by any of this. `reconcile.test.ts` itself passes with a zero-line diff.
