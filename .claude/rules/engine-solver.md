# Step 3 solver internals

Detail for `src/engine/solver.ts`. Read this before touching the shift-fit solve — the
algorithm choices here are deliberate engineering decisions, not the only valid approach,
and re-deriving them from scratch will likely diverge from what's tested.

## Full-coverage solve (5.2, `solveFullCoverageWeek` — renamed from `solveFullCoverageDay` in PR A, 2026-07-26, see the "Shift wraparound model" section below)

For every (day, shift) slot, headcount starts at 0. Repeatedly: find the GLOBAL hour (0-167)
with the largest deficit, then among (day, shift) candidates covering that hour, bump the
one whose hours overlap the most currently-deficient global hours (not just that one hour).
This is a greedy set-cover heuristic, not an exact ILP solve — the spec calls it "solvable
by direct search at this scale," and at 2-6 shifts/day this greedy approach converges to a
full-coverage solution in practice. It is only used as an upper bound feeding the budget
trim, never shown to the user directly. **Became a JOINT whole-week solve in PR A** (was
per-day before) — required once a shift's coverage could spill across a day boundary, since
a day's own early-hour deficit may only be solvable by bumping the PREVIOUS day's shift.
Provably a no-op vs. the old per-day algorithm for any menu with no midnight-crossing shift.

## Budget-capped trim (5.3) — SIXTH shape, now a joint whole-week CONVEX-SEVERITY minimizer

This section has now taken SIX shapes (the first three below, then Phase 2b, then PR B, then
PR C). Read the history before touching it again — each reversal solved a real problem the
previous shape had, and the reasons differ, so "revert to an earlier version" is not a safe
default without re-reading why it changed last time.

### History

1. **Original — per-day linear shortfall.** `trimDayToBudget` ran independently per day; the
   weekly cap (`weeklyBudgetHours * (1 + tolerance)`) was allocated across days **proportional
   to each day's own full-coverage hours** (a day with heavier natural demand got a bigger
   slice); each trim step removed one headcount unit from whichever shift minimized
   `addedWeightedShortfall / shift.lengthHours` against the point-target requirement curve,
   weighted by `hourWeight()` (5.4 transition-hour weighting).
2. **2026-07-25 — band-floor deadband, still per-day.** REVERSED the objective from "minimize
   linear shortfall" to "avoid pushing any hour below its typical staffing band" — the old
   linear sum had no preference between concentrating a cut into one badly-outlier hour versus
   spreading it thinly across several, since the sum was identical either way. Introduced
   `EngineResult.bandFloorHourly`/`bandCeilingHourly` (p25/p75-equivalent curves, same
   allocation pipeline as `hourlyRequirement`, clamped against it) and a convex deadband cost
   (`floorCost`, `(floor - coverage) ^ 1.8`, zero at/above the floor) — still per-day, still
   `hourWeight`-multiplied. Superseded below; `bandFloorHourly`/`bandCeilingHourly` themselves
   are NOT superseded — see the current shape.

### Current shape (2026-07-26) — joint whole-week, minimizes actual BACKLOG

**REVERSES the "backlog is diagnostic-only, never feeds the solver" rule** stated (until this
change) throughout this file, `.claude/rules/results-redesign.md`'s backlog section, and
`engine/backlog.ts`'s own header comment. Confirmed intentional with Ben — same category as
the shift-menu-flexibility reversal below, flagged in the commit/PR body accordingly.

- **Why:** even the band-floor deadband (previous shape) only ever asked "is this ONE hour,
  right now, below its own static floor?" — it had no memory of how shortfall actually
  accumulates and decays hour to hour (the thing `computeBacklog`, engine/backlog.ts, already
  models). Two hours can look identically "just above the floor" while one of them is sitting
  on top of an unresolved multi-hour hole and the other isn't — the floor-only view can't tell
  the difference; the backlog model can.
- **Joint over the whole week, no fixed per-day split.** `trimDayToBudget` (per-day) is GONE,
  replaced by `trimWeekToBudget` (`engine/solver.ts`) — one greedy loop over all 168 hours at
  once. Each step considers EVERY (day, shift) with headcount > 0 as a candidate single-unit
  cut, anywhere in the week, and removes whichever one is cheapest — free to take more cuts
  from one day and fewer from another if that's what minimizes total backlog, no longer
  constrained to a day's proportional share of the cap. Stops once total scheduled hours
  reaches `capHours = weeklyBudgetHours * (1 + tolerance)` — same cap formula as before.
- **Cost = marginal backlog-hours, via a BOUNDED forward simulation, not a full recompute per
  candidate.** `candidateCutCost(day, shift, capacity, baselineBacklog, hourlyRequirement168,
  bandFloorHourly168, decay)` reuses the EXACT SAME 0.85/hr circular-no-reset decay recurrence
  `computeBacklog` uses (reimplemented locally as `backlogFromCapacity` — `solver.ts` can't
  import `computeBacklog` directly, since `backlog.ts` already imports `fullWeekCapacity`/
  `coveringCellsByGlobalHour` FROM `solver.ts` [PR A renames — see "Shift wraparound model"
  below], and the reverse import would be circular; keep the two formulas in sync if the
  decay model ever changes). A single headcount cut only perturbs capacity within the ≤24
  hours a single (day, shift) candidate covers — under PR A those hours may straddle a day
  boundary rather than sitting entirely within one calendar day, but the count is still
  bounded by `lengthHours <= 24` — and the recurrence's dependence on any one hour fades
  `BACKLOG_SIM_WINDOW_HOURS = 48` hours (one day's span plus a full decay tail) from the
  earliest perturbed hour, seeded from the CURRENT baseline's own carry-in, rather than
  recomputing the full 168-hour backlog from scratch. The expensive full recompute
  (`fullWeekCapacity` + `backlogFromCapacity`, together O(168)) happens ONCE per outer trim
  iteration (the grid actually changed), never once per candidate — that's the performance
  trap the reversal was scoped to avoid.
- **Band floor is a large but FINITE guardrail penalty, NOT a hard exclusion.** First
  implemented as an infinite/exclusion rule, then corrected before landing: a true hard block
  can make the trim loop stall before reaching `capHours` in a genuinely low-volume scenario
  where the budget can only be met by cutting below the floor somewhere — and a stall there
  would mean the schedule never actually reaches its budget cap. So a candidate that would push
  any of its hours below `bandFloorHourly168` is charged `BAND_FLOOR_BREACH_PENALTY = 1e6`
  (a tunable constant) times how far below the floor it would go, ADDED to its backlog-hours
  cost — large enough to dominate any ordinary cost in every normal case, but finite, so an
  extreme scenario can still breach the floor as a last resort rather than never finishing.
  Tested directly (`solver.test.ts`): a scenario where the floor equals current headcount
  everywhere (zero slack, every cut breaches) still reaches a `capHours = 0` cap exactly.
- **Tie-break: lower resulting peak backlog wins.** When two candidates cost the same
  (within `1e-9`), `trimWeekToBudget` prefers whichever leaves the lower `peakInWindow` (the
  max backlog value reached within `candidateCutCost`'s simulated window) — comparing just the
  window is sufficient since the baseline's peak OUTSIDE the window is identical across every
  candidate evaluated that iteration.
- **`hourWeight`/transition-hour weighting is GONE, not just unused.** The new cost function is
  a direct physical measure (marginal backlog-hours) fully specified with no per-hour weight
  slot, so `hourWeight()` was deleted from `solver.ts` (dead code under this repo's
  `noUnusedLocals`/`noUnusedParameters` TS settings) and `solveShiftFit`'s signature dropped
  its `transitionWeight`/`transitionWindowHours` parameters entirely — updated at all three
  call sites (`engine/index.ts`'s `compute()`, `flexMenu.ts`'s `searchFlexibleMenus`,
  `ShiftMenuFlexibilitySection.tsx`'s manual-menu solve) plus `flexMenu.test.ts`.
  `EngineInputs.transitionWeight`/`transitionWindowHours` and their `DEFAULTS` entries were
  DELIBERATELY LEFT IN `types.ts` — removing type-level fields nobody asked to remove felt like
  a bigger, separate decision than this reversal's scope, so they're flagged here as currently
  unconsumed by the engine rather than silently deleted. Revisit if a future session wants to
  either restore a use for them or formally retire them from `EngineInputs`.
- **Does NOT touch:** `annualCoreRnHoursBudget` (still the single `wHppvTarget` point), the
  reconciliation check (`reconcile()`, still keys off `cellCoreHours`/`annualBudget` computed
  before any solve happens at all — `reconcile.test.ts` passes completely unmodified, it never
  touches `solveShiftFit`'s output), `solveFullCoverageWeek` (renamed from
  `solveFullCoverageDay` in PR A — still the 5.2 upper bound the joint trim starts from), or
  `enforceDepartmentFloor` (still runs LAST, after the trim,
  unchanged — see below). `bandFloorHourly`/`bandCeilingHourly` themselves (how they're
  derived, clamped) are UNCHANGED from the 2026-07-25 shape; only what they're USED FOR
  changed (cost term → guardrail penalty).
- **`engine/bandFloor.ts`'s `computeBandFloorViolations` is untouched** — still a plain
  diagnostic (count of hours below `bandFloorHourly` + longest streak + which shift), still
  powers `CoreGridTab.tsx`'s "Hours outside your typical staffing range" stat. It answers a
  different question than the trim's new cost function ("how far outside my BAND am I" vs.
  "how much BACKLOG am I carrying") and both are legitimate, independent signals.
- **OPEN QUESTION, flagged rather than silently decided:** `flexMenu.ts`'s
  `searchFlexibleMenus` calls `solveShiftFit` directly to solve each candidate alternate menu —
  since `solveShiftFit` now has only ONE trim algorithm (there is no parallel "old floor-only"
  code path left to opt out of), every flex-menu candidate is automatically solved with the new
  backlog-minimizing trim too. This wasn't a separate design decision so much as a direct
  consequence of replacing the trim in place rather than maintaining two parallel
  implementations — confirm with Ben whether flex-menu candidates should ever be evaluated
  differently (e.g. against the plain point-target shortfall only, for comparison speed or
  interpretability) before assuming this is the intended long-term behavior.
- **Tests** (`engine/__tests__/solver.test.ts`, replaced describe block): (1) the budget/
  tolerance invariant still holds (unchanged bound, reached via the new objective); (2) the
  `bandFloorHourly`/`bandCeilingHourly` clamp tests carry over unchanged from the 2026-07-25
  shape; (3) a hand-constructed scenario (an 8-hour "target" shift cut on a day whose
  9th hour is an ordinary requirement-matching hour vs. the identical cut on a day whose 9th
  hour is a huge excess-capacity "recovery" hour) proves the compounding-vs-isolated claim
  directly via `candidateCutCost` — both cuts look identically "free" under a floor-only view
  (`bandFloorHourly` is 0 throughout that test), yet the unresolved (compounding) cut costs
  strictly more backlog-hours than the one a nearby recovery hour absorbs; (4) the band-floor
  breach-is-a-penalty test described above; (5) a cross-day allocation test — two days start
  with IDENTICAL full-coverage hours, but one has a dampening excess-capacity hour nearby and
  the other doesn't; after `trimWeekToBudget`, the cheaper day absorbs strictly more cuts than
  the untouched day, which the old fixed-proportional-per-day split could never have produced.
  `candidateCutCost` and `trimWeekToBudget` are both newly exported from `solver.ts`
  specifically for these tests (alongside the pre-existing `coverageForDay`/`shiftGlobalHours`/
  `findDepartmentFloorViolations`).

### Phase 2a (2026-07-26, same day) — arrivals-variance buffer composes onto the SAME floor

`BACKLOG_FEEDBACK_AND_VARIANCE_SPEC_2026-07-25.md`'s "2a" section — the "mean-arrival trap"
fix. Sized-off-a-pure-mean scheduling understaffs any hour with real variance around that
mean roughly half the time by construction; nothing in Phase 1 (or Phase 2b, see below)
reduces how OFTEN a shortfall happens in the first place — only a variance signal does.

- **New optional input:** `EngineInputs.arrivalsP75?: Cell168` — this ED's own busy-hour
  (p75) arrivals count per cell, alongside the required mean `arrivals`. All-or-nothing
  optional, template-only (Arrivals tab, NOT a 5th tab — see `.claude/rules/
  template-parsing.md`).
- **Hard rule, do not relitigate:** `arrivalsP75` NEVER touches `annualVisits`,
  `annualCoreRnHoursBudget`, or `hourlyRequirement`. Those stay derived from mean arrivals
  only — this preserves wHPPV's own definition (nurse-hours per AVERAGE visit) and keeps the
  reconciliation invariant (`reconcile()`, `reconcile.test.ts`) completely untouched; a test
  in `engine/__tests__/demandBand.test.ts` asserts byte-identical `annualVisits`/
  `annualCoreRnHoursBudget`/`hourlyRequirement`/`reconciliation` with and without
  `arrivalsP75` on the same arrivals, specifically to guard this rule.
- **Two independent signals, composed, not merged** (`engine/demandBand.ts`):
  - `deriveCohortBandFloor(weighted, annualVisits, smoothingWeights, hourlyRequirement)` —
    the Phase 1 (2026-07-25) p25/p75-cohort-wHPPV-vs-`lookupWhppvBand` derivation, extracted
    verbatim out of `compute()`, unchanged in behavior.
  - `deriveDemandVolatilityHourly(arrivals, arrivalsP75)` — THIS ED's own per-cell
    `(p75 - mean) / mean` ratio (never negative; 0 when `arrivalsP75` is absent — full
    graceful degradation to Phase 1's cohort-only floor). A completely different data
    source from the cohort function above (this ED's own hourly spread vs. OTHER EDs'
    aggregate wHPPV benchmark) — kept as a separate function on purpose.
  - `applyVolatilityBuffer(cohortBandFloor, demandVolatilityHourly, hourlyRequirement)` —
    linear interpolation toward `hourlyRequirement`: `floor + clamp(volatility, 0, 1) *
    (hourlyRequirement - floor)`. Volatility 0 → cohort floor unchanged; volatility ≥ 1 (p75
    at/above double the mean) → floor reaches `hourlyRequirement` itself, the strongest
    protection this mechanism expresses. `VOLATILITY_RATIO_CLAMP_MAX = 1`, a tunable
    heuristic, not load-bearing.
  - `compute()` (`engine/index.ts`) composes: `cohortBandFloor = deriveCohortBandFloor(...)`
    → `demandVolatilityHourly = deriveDemandVolatilityHourly(...)` →
    `bandFloorHourly = applyVolatilityBuffer(cohortBandFloor, demandVolatilityHourly,
    hourlyRequirement)`. `EngineResult.bandFloorHourly` is still the SAME field name/consumer
    as Phase 1 (Step 3's trim guardrail, `computeBandFloorViolations`'s "Hours outside your
    typical staffing range" stat) — both automatically pick up the volatility buffer with no
    call-site changes. `EngineResult.demandVolatilityHourly` is a NEW field (all-zero when
    `arrivalsP75` is absent).
- **Also scales the Step 3 trim's marginal-backlog cost, not just the floor:**
  `candidateCutCost` (`engine/solver.ts`) takes a new `demandVolatilityHourly168` parameter
  and multiplies the marginal backlog-hours delta by `1 + VOLATILITY_COST_WEIGHT *
  avgVolatilityOverPerturbedHours` (`VOLATILITY_COST_WEIGHT = 1`, tunable) — a cut at a
  high-volatility hour is charged more because it's more likely to actually manifest as real
  backlog than the mean-only simulation alone can see. Deliberately NOT applied to the
  band-floor breach penalty (already informed by volatility indirectly, since the floor
  curve itself is buffered). `solveShiftFit`/`trimWeekToBudget`/`searchFlexibleMenus`
  (`flexMenu.ts`) all gained this parameter — threaded through every call site (`compute()`,
  `ShiftMenuFlexibilitySection.tsx`'s manual solve, `flexMenu.test.ts`).
- **Why NOT the alternatives** (from the spec, worth keeping so this isn't re-litigated):
  replacing the mean with p75 outright breaks wHPPV's own definition and is needlessly
  conservative; blending mean and p75 directly into the point target would silently inflate
  the annual budget and break reconciliation. Feeding it into the floor (+ trim cost) only
  changes WHERE the fixed budget gets protected, never HOW MUCH budget there is.
- **Tests:** `engine/__tests__/demandBand.test.ts` (volatility derivation, buffer
  composition/clamping, the annualVisits/budget/hourlyRequirement-untouched invariant) +
  a `solver.test.ts` addition (identical cut costs more at a high- vs. zero-volatility hour).

### Phase 2b (2026-07-26, same day) — true backlog-FEEDBACK loop (`engine/backlogFeedback.ts`)

**REVERSES "Phase 1 only uses backlog as a cost signal for choosing which hours to cut — it
never actually asks for more capacity at the hours that need to drain a queue."** This is the
FOURTH reversal-in-spirit of this section (linear shortfall → band-floor deadband → joint
whole-week backlog-cost trim → this iterative relaxation ON TOP of it) — same category as the
shift-menu-flexibility reversal below, confirmed intentional.

- **The gap this closes:** effective demand at hour *h* depends on backlog carried in from
  *h-1*, which depends on whether *h-1* was adequately staffed, which was itself a solver
  decision made using whatever effective demand existed for *h-1*. Circular — not a
  closed-form curve. Phase 1/2a change WHICH hours get cut and how expensive a cut looks;
  neither ever asks the requirement curve itself for more capacity at a draining hour.
- **Why an iterative relaxation, not a bigger formula:** because of the circularity above,
  you can't compute "effective demand including feedback" in one pass — you have to solve,
  measure what actually happened, adjust, and re-solve. `solveShiftFitWithBacklogFeedback`
  (`engine/backlogFeedback.ts`, a NEW file — needs both `solver.ts`'s trim and `backlog.ts`'s
  `computeBacklog`, and since `backlog.ts` already imports FROM `solver.ts`, this new file
  sits ABOVE both rather than either importing the other):
  1. Full-coverage solve ONCE (`solveFullCoverageWeek`, renamed from `solveFullCoverageDay`
     in PR A, still exported) — the fixed 5.2 upper bound, identical every pass.
  2. Trim to the SAME fixed `capHours` against the current protected floor
     (`trimWeekToBudget`) — pass 1 uses the ordinary (2a-composed) `bandFloorHourly`.
  3. `computeBacklog` on that pass's grid. Wherever a hour's INHERITED backlog
     (`BacklogResult.carriedIn`, a NEW per-hour field — see `backlog.ts`, additive/
     non-breaking) meets/exceeds `BACKLOG_CAUGHT_UP_THRESHOLD`, raise THAT hour's protected
     floor, for the NEXT pass, by the carried-in amount — cumulative pass over pass.
     Deliberately uses `carriedIn` (backlog flowing IN), not the hour's own total `backlog`
     value (which would double-count that hour's own freshly-generated shortfall on top of
     what it inherited).
  4. Re-run ONLY the trim (step 2) against the raised floor — NOT the full-coverage solve
     again (fixed, same every pass) and NOT the ENA floor (deferred to the very end, see
     below) — same total budget, same candidates, per the spec's explicit resolution of the
     budget-tension question (the annual total never flexes; only the internal distribution
     does — a bigger, separate decision needs its own sign-off if it ever comes up).
  5. Repeat (steps 2-4) up to `maxPasses` (default 8, spec's own 6-10 starting point, "cheap
     at 168-hour scale") or until the floor stops changing anywhere (converged — no hour has
     material inherited backlog left to protect against). Track total backlog-hours EVERY
     pass and return whichever pass had the LOWEST total — **not necessarily the last**. This
     is a relaxation, not a provably convergent fixed point; pass N can undo pass N-1's
     improvement (verified directly — see tests below).
  - **Deliberately NOT clamped to `hourlyRequirement`**, unlike the 2a cohort/volatility
    floor — this floor is actively asking for MORE than the point target to drain a queue,
    which is the entire point of the mechanism. Don't "fix" this to match 2a's clamp
    convention; they answer different questions (2a protects a typical range, 2b actively
    pays down debt).
  - **ENA floor (5.6) applied ONCE, at the very end,** to whichever pass's grid wins — not
    repeated inside the loop. Keeps every pass's backlog measurement directly comparable
    (same post-processing state) and the floor essentially never fires anyway (see the 5.6
    section below).
  - **New diagnostics on `EngineResult`:** `backlogFeedbackPassCount` and
    `backlogFeedbackStillImprovingAtCap` (true iff the pass cap was hit while the metric was
    STILL improving — a chronically-backlogged scenario that never converges within the pass
    budget is a real signal, not something to silently swallow into the last pass's output).
    The full per-pass history (`totalBacklogHoursByPass`) is available on
    `BacklogFeedbackResult.feedback` for anyone calling `solveShiftFitWithBacklogFeedback`
    directly (tests do); not surfaced on `EngineResult` itself, to keep that type's diagnostic
    surface to the two numbers actually meant for the UI/future use.
  - **`compute()` (`engine/index.ts`) now calls `solveShiftFitWithBacklogFeedback` instead of
    the plain one-shot `solveShiftFit`** for the primary idealized-grid solve. Fixed budget
    throughout (same `weeklyBudgetHours`/`hoursBudgetTolerance` every pass) — this does NOT
    change `annualCoreRnHoursBudget`, `reconcile()`, or the reconciliation invariant at all
    (`reconcile()` never touches solve output in the first place — see the Phase 1 section
    above; `reconcile.test.ts` passes completely unmodified).
  - **RESOLVED 2026-07-26 (PR C, `SOLVER_REALISM_SPEC_2026-07-26.md` change 5) — was an OPEN
    QUESTION, now a permanent decision:** `flexMenu.ts`'s `searchFlexibleMenus` and
    `ShiftMenuFlexibilitySection.tsx`'s manual-menu solve STAY on the plain one-shot
    `solveShiftFit`, not the relaxation loop — evaluating up to 45 bounded candidates (flexMenu)
    through an 8-pass relaxation each would be a real cost multiplier for a bounded/advisory
    search that's explicitly not meant to be the primary schedule. PR C also made the CURRENT
    menu's comparison-table numbers use the same one-shot solve (previously it alone got the
    relaxation loop via `result`, an unfair comparison — see PR C's change 5 below) — so as of
    PR C, every side of this comparison (current menu, search candidates, manual menu) is on
    one-shot `solveShiftFit`, uniformly and permanently. Do not resurrect the relaxation loop
    for any of these without a new, separate decision.
  - **Tests** (`engine/__tests__/backlogFeedback.test.ts`), all built around one shared
    scenario (day 0 has a chronic peak whose backlog spills toward hour 9, a genuine
    excess-capacity recovery point once hour 9's own high requirement forces a big
    `recovery`-shift headcount that "spills over" onto its low-requirement neighbor hour 8):
    (1) chronic-shortfall — the loop's final grid differs from a bare pass-1 trim, total
    backlog-hours strictly improves, and `weeklyScheduledHours` never exceeds the SAME
    `capHours` used by pass 1; (2) near-budget-exhausted — a zero-slack floor
    (`bandFloorHourly == starting headcount everywhere`) still reaches an extreme `capHours =
    0` cap exactly, proving the floor-as-penalty (not exclusion) behavior survives the added
    pressure of cumulative pass-over-pass floor raises; (3) oscillation — a specific budget
    value for the same scenario (found empirically, documented in the test) produces a
    genuinely non-monotonic `totalBacklogHoursByPass` series (pass 1 improves, pass 2
    regresses, later passes never recover to pass 1's level) — the test asserts the returned
    grid's actual backlog total matches the SERIES MINIMUM, strictly better than the LAST
    pass, directly proving the best-pass-wins fallback fires and matters (a naive "return the
    last pass" implementation would have returned a worse result here).
  - **A note on why "moves hours toward the backlog-generating period" needed real
    reallocation to demonstrate, not just a bigger number:** for a perfectly periodic,
    chronically-negative-deficit scenario (every hour short, never a moment of true excess
    capacity anywhere in the whole circular week), total backlog-hours is mathematically
    INVARIANT to how a fixed total deficit is distributed within the period — the `max(0,
    ·)` clamp is what makes redistribution matter at all (it's 1-Lipschitz/non-expansive, so
    a fixed total deficit's sum-of-backlog is provably unchanged unless some hour's clamp
    state flips between "always positive" and "sometimes hits zero"). The test scenario's
    genuine excess-capacity recovery point (hour 9's spillover onto hour 8) is what makes
    real improvement possible at all — a scenario without ANY true recovery point anywhere
    would show a perfectly flat `totalBacklogHoursByPass` series despite the grid visibly
    changing pass to pass, which is correct behavior, not a bug (confirmed by hand while
    building these tests — worth knowing if a future session tries to construct a new
    scenario and gets confused by a flat series).

### PR B (2026-07-26, `SOLVER_REALISM_SPEC_2026-07-26.md`) — asymmetric backlog recovery, recurrence moved to one shared leaf module

**This is the FIFTH shape of this area's history** (linear shortfall → band-floor deadband →
joint whole-week backlog-cost trim → Phase 2b's iterative relaxation on top of it → THIS
physics + structural change to the recurrence itself, underneath all of the above). Confirmed
intentional with Ben. Two separable problems, both addressed:

**Problem 1 (structural) — the recurrence existed twice.** `computeBacklog` (`backlog.ts`) and
a hand-duplicated `backlogFromCapacity` (`solver.ts`) each ran the identical formula, kept in
sync only by a comment asking future sessions to remember. Tolerable for a one-line formula;
not tolerable once the formula grew to five lines and three constants. Fixed by extracting the
recurrence into a new LEAF module, `engine/backlogModel.ts` — no engine imports (it operates on
plain `number[]` capacity/requirement arrays, not `Grid`/`ShiftDef`) — which is what actually
breaks the circular-import problem that forced the duplication in the first place
(`backlog.ts` imports `fullWeekCapacity`/`coveringCellsByGlobalHour` FROM `solver.ts`; now
`solver.ts` also imports the recurrence from `backlogModel.ts`, a module neither of them owns,
so there's no cycle). `backlogModel.ts` exports two things: `backlogRecurrence` (the full
168-hour circular recurrence, used by `computeBacklog`) and `backlogHourStep` (the single-hour
primitive `backlogRecurrence` is itself built from) — `solver.ts`'s `candidateCutCost` needs
the single-hour primitive directly for its BOUNDED WINDOW simulation (a subset of hours, not
the full week), so it calls `backlogHourStep` per simulated hour rather than re-deriving a
third copy of the formula. A structural regression guard (`backlogModel.test.ts`) source-greps
both `backlog.ts` and `solver.ts` to confirm they import from `./backlogModel` and don't
contain a reinlined copy of the formula.

**Problem 2 (physics) — the single-decay model was false in a specific, consequential way.**
The retired formula, `backlog[h] = max(0, backlog[h-1]*0.85 + (req[h]-cap[h]))`, collapsed
three distinct processes into one blended constant and modeled recovery as UNCONSTRAINED and
SYMMETRIC — one spare nurse-hour retired exactly one nurse-hour of queued backlog, without
limit. That's physically false: backlog in an ED is usually bed- and provider-limited, not
nurse-limited, and care delivered hours late already produced its harm (a late assessment
doesn't un-happen just because a nurse becomes free). The visible, previously-undocumented-as-
a-problem consequence: `candidateCutCost` scored a cut as nearly free whenever a LATER
excess-capacity hour could "absorb" it fully — so the joint trim (Phase 1 above) systematically
preferred to cut AT OR BEFORE A PEAK whenever slack existed afterward, exactly the schedule an
experienced charge nurse would reject on sight. New recurrence, three named processes (full
formula and rationale in `backlogModel.ts`'s header — read it in full before touching this
again):
```
carried[h]  = backlog[h-1] * (1 - abandonRate)     // passive attrition — this IS LWBS
newWork[h]  = max(0, req[h] - cap[h])
spare[h]    = max(0, cap[h] - req[h])
paydown[h]  = min( carried[h], spare[h] * recoveryEfficiency, carried[h] * maxDrainFraction )
backlog[h]  = carried[h] + newWork[h] - paydown[h]
```
New `DEFAULTS` (`types.ts`), replacing the retired `backlogHourlyDecay`:
`backlogAbandonRate = 0.03` (measurable from a real ED's own LWBS rate, unlike the other two —
the old 0.85 decay implied 15%/hr simply vanishing, far too forgiving as an LWBS proxy),
`backlogRecoveryEfficiency = 0.6` (a spare nurse-hour retires LESS than an hour of queued work
— catch-up loses batching, adds re-triage/reassessment), `backlogMaxDrainFraction = 0.3` (hard
per-hour drain ceiling regardless of spare staff — beds/providers/imaging gate it; THIS is the
term that fixes the peak-cutting bias above).

**Refactor verified behavior-preserving BEFORE the physics changed.** `backlogModel.test.ts`'s
first describe block proves, over 20 random capacity/requirement arrays, that with
`abandonRate=0.15, recoveryEfficiency=1, maxDrainFraction=1` the new recurrence is
ALGEBRAICALLY IDENTICAL to the old `max(0, b*0.85 + req - cap)` formula — not approximately;
per-hour, `paydown = min(carried, spare, carried) = min(carried, spare)` and the case split on
sign of `(req-cap)` reproduces the old formula exactly in both branches (proof sketch in that
test file). This test was landed and passing BEFORE the `DEFAULTS` constants changed, per the
PR's own requirement — the equivalence and the physics change are two separably-verified steps,
not one commit.

**Settle-pass count increased 2 → 6, a REQUIRED consequence of the physics change, not a
stylistic tweak.** The two-pass circular settle (unchanged since the backlog diagnostic's
original 2026-07-24 build) relies on the per-lap decay being small enough that a zero-seed
start converges to the true fixed point within two passes. The old model's per-lap decay was
`0.85^168 ≈ 4e-13` — comfortably negligible in one extra pass. The new model's WORST-CASE
per-lap decay (pure attrition, no paydown anywhere) is `0.97^168 ≈ 0.006` — two passes leaves a
~0.6% residual at the wraparound point, large enough to be visible in tests and (more
importantly) in the actual reported peak-backlog/streak numbers. Verified empirically that 6
passes converges to full floating-point precision even in that worst case; both
`backlogModel.ts`'s `backlogRecurrence` and `computeBacklog`'s two-pass-settle framing in
comments were updated together (`SETTLE_PASSES = 6`). **A consequence worth knowing:** because
the circular recurrence is a genuine self-consistent fixed point (not just "this hour's own
deficit"), a single deficit spike with no capacity anywhere else converges to
`spike / (1 - RETENTION^168)`, not `spike` itself — under the old model this correction was
unmeasurably small (~4e-13); under the new model it's a real ~0.6% uplift. `backlog.test.ts`
was rewritten to assert against this closed form directly, not the naive "≈ spike" the old
tests asserted.

**BAND_FLOOR_BREACH mechanism, `hourWeight`, band-floor guardrail, tie-break, cross-day
allocation** — all UNCHANGED by PR B; only the backlog-cost NUMBER those mechanisms consume
changed, not how they use it.

**BACKLOG_SIM_WINDOW_HOURS = 48 caveat — flagged, not silently resolved.** The window's
original justification ("the old decay rate makes any one hour's influence vanish within 24-48
hours, so a bounded resimulation closely approximates the true full-week backlog") is NO LONGER
TRUE under the new `abandonRate = 0.03`: pure attrition alone leaves ~23% of a perturbation's
effect still present at 48 hours (`0.97^48 ≈ 0.23`), only nearby excess capacity (via
`maxDrainFraction`/`recoveryEfficiency`) drains it faster than that. In a genuinely chronic,
no-recovery-nearby stretch, this window can meaningfully UNDER-count a cut's true marginal
cost. This PR left the window size AS-IS (widening it toward full accuracy — e.g. ~130 hours to
match the old model's negligible-tail standard — would mean giving up most of the O(WINDOW) vs.
O(168) performance benefit the window exists for, a bigger tradeoff than this PR's scope) —
every candidate compared within the same outer trim iteration is truncated by roughly the same
proportional amount, so the RELATIVE ranking (all `trimWeekToBudget` actually needs to pick the
cheapest cut) is less affected than the absolute magnitude, but this is a real approximation
gap, not a proven-negligible one anymore. Revisit if a realistic scenario is ever found where
the trim visibly makes a wrong call because of it.

**`BACKLOG_CAUGHT_UP_THRESHOLD = 0.5` — checked against a realistic scenario, NOT retuned.**
Per the spec's explicit instruction, this constant was left alone and instead checked: a
Friday-evening-arrivals-surge scenario (day/night 12h menu, `wHppvTarget = 0.5`) produced
`peakBacklog ≈ 12.7` nurse-hours and a `longestStreakHours = 81` — over three FULL DAYS
before the department reads as "caught up" anywhere, with the Friday-night tail still above
threshold well into Saturday MORNING (hour 8-9). Under the old model, a comparable spike would
have cleared in well under a day (0.85/hr decay vs. the new ~0.97/hr-in-the-absence-of-recovery
rate). This is very likely the correct, honest output for THIS model (the whole point of PR B
is that recovery now genuinely requires spare capacity, not just elapsed time) — but it's worth
flagging that a fixed 0.5-nurse-hour absolute threshold, unchanged since the old model where
typical peaks were much smaller, may now read as an unusually aggressive "still behind" signal
against typical peak magnitudes 2-3x higher than before. Not changed in this PR — a threshold
retune is exactly the kind of thing the spec asked to be reported rather than silently done.

**DECLINED (recorded so it is not re-litigated): a rework/degradation term.** Waiting patients
generating EXTRA nursing work the longer they wait (re-triage, reassessment, complications) is
real but second-order and harder to defend with the evidence this tool already leans on.
Explicitly out of scope for PR B — if revisited, it would add a FOURTH term to the recurrence
above, not replace any of the three that exist now.

**Framing (carried into UI copy per the governing spec):** backlog is best understood as
un-started FRONT-LOADED ARRIVAL WORK — i.e. the waiting room — the direct antecedent of LWBS.
This is why `abandonRate` is the one parameter of the three that's plausibly measurable from a
real ED's own LWBS-rate data, unlike the other two.

**Tests:** `backlogModel.test.ts` (new) — the equivalence proof, invariants (`backlog[h] >= 0`
always, zero-deficit-everywhere ⇒ zero-backlog-everywhere), and the structural "lives in exactly
one place" source-grep guard. `backlog.test.ts` — rewritten numeric assertions (steady state is
now `1/abandonRate`, not `1/(1-decay)`; the Sat→Sun-boundary and excess-capacity-paydown tests
use the true closed-form converged values, not the old model's negligible-residual
approximation); the shift-attribution and lone-vs-compounding-streak tests were UNCHANGED
(their claims don't depend on which decay model is in use — `generatedBacklog` is `max(0,
deficit)` regardless of params, and streak-length/peak comparisons stay directionally true).
`solver.test.ts`'s compounding-vs-isolated and cross-day-allocation tests pass UNCHANGED in
claim (just take a `BacklogRecurrenceParams` object instead of a bare decay number) — both
directional claims (`compound.cost > isolated.cost`, cheaper day absorbs more cuts) still hold
under the new bounded-recovery physics, verified numerically, not assumed.
`backlogFeedback.test.ts`'s oscillation test needed a NEW budget value (50 → 70) — the old
value was empirically found to oscillate under the retired model and no longer does under the
new paydown dynamics; re-swept empirically against the same scenario to find a budget that
still exercises the best-pass-not-last fallback under the new physics. **STALE as of PR C
below — that budget value moved AGAIN (70 → 65) when the trim's cost function changed a
second time.** This is a general property of this specific test, not a one-time fluke: it
pins a budget value empirically found to oscillate for a hand-built scenario, so ANY future
change to the trim's cost function may require re-sweeping it again. If you touch
`candidateCutCost`'s cost formula, re-run `backlogFeedback.test.ts` and re-sweep if it fails.

### PR C (2026-07-26, `SOLVER_REALISM_SPEC_2026-07-26.md`) — convex severity objective, peak term, retired 1e6 floor cliff

**This is the SIXTH shape of this area's history.** PROBLEM: `candidateCutCost` minimized a
LINEAR sum of marginal backlog-hours (even after PR B's physics rewrite, the SUM itself was
still linear) — ten nurse-hours of backlog concentrated in one hour scored IDENTICALLY to one
nurse-hour spread across ten. Every outcome an ED actually cares about (wait times, LWBS,
safety events, whether a nurse resigns) is CONVEX in shortfall depth — queueing systems degrade
nonlinearly as utilization approaches one — so a linear objective was indifferent between
"shallow everywhere" and "catastrophic on Friday," and would trade the latter for small gains
elsewhere. Confirmed: this is a REGRESSION the history file hadn't flagged as such — the
2026-07-25 band-floor deadband (`(floor - coverage)^1.8`) WAS genuinely convex; moving to
backlog as the variable (the THIRD shape) was the right change, but the curvature was dropped
along the way. PR C takes it back, applied to the better variable.

**CHANGE 1 — convex severity, normalized by need.** New exported primitives in
`engine/solver.ts`: `severity(backlog, requirement) = (backlog / max(requirement, 1)) ^
SEVERITY_GAMMA`, `SEVERITY_GAMMA = 1.8`. Normalized by `hourlyRequirement`, NOT raw
nurse-hours — two nurses short at an hour needing ten is a bad hour, two short at an hour
needing three is a crisis, and raw nurse-hours can't distinguish them (exactly why the old
objective was willing to flatten peaks). `max(requirement, 1)` guards the divisor for
requirement-0 cells (overnight hours in very low-volume EDs) without a separate branch.
`candidateCutCost`'s cost is now `Σ_window (severity_after[h] - severity_before[h]) * (1 +
VOLATILITY_COST_WEIGHT * avgVolatility)` — same windowed-simulation/volatility-scaling
machinery as before (PR B/Phase 2a), just scored in severity units instead of raw backlog-hours.
`totalSeverity`/`peakSeverityOf` (also exported) score an arbitrary already-computed backlog
curve on the same objective, for consumers that need to evaluate a SOLVED grid rather than a
single candidate cut (`EngineResult.totalSeverity`/`peakSeverity`, flexMenu ranking — change 5).

**CHANGE 2 — peak promoted from tie-break to cost term.** `PEAK_WEIGHT = 0.3`; cost gains `+
PEAK_WEIGHT * (peakSeverity_after - peakSeverity_before)` (peak measured within the same
simulated window). A convex SUM alone will still trade one catastrophic shift for diffuse small
gains if the arithmetic works out — managers, regulators and plaintiffs' attorneys care about
the worst night, not the average night. The existing lower-peak-severity tie-break is KEPT on
top of this (for cost-ties the weighted term itself doesn't fully resolve) —
`CandidateCutCost.peakInWindow` renamed `peakSeverityInWindow` (now severity units, not raw
backlog, consistent with the rest of the objective).

**CHANGE 3 — retired `BAND_FLOOR_BREACH_PENALTY = 1e6`.** Replaced by a smooth, steeper,
still-finite power law: `floorPenalty[h] = FLOOR_WEIGHT * max(0, floor[h] - cap[h]) ^
FLOOR_GAMMA`, `FLOOR_WEIGHT = 75`, `FLOOR_GAMMA = 2`. The flat `1e6 * depth` model scored a
1-unit and a 10-unit breach as proportionally identical (10x); the new model makes a DEEP breach
cost quadratically more than a shallow one, which the old cliff could not express at all — one
smooth cost surface instead of two regimes (ordinary cost vs. the cliff), while keeping the
finiteness that was the whole reason 1e6 replaced literal infinity in the first place.
**FLOOR_WEIGHT=75 validation (verified, not assumed — reported per the spec's explicit ask):**
(1) *not too low* — `solver.test.ts`'s new PR C describe block constructs a candidate that is
CHEAPER on severity terms alone (a 1-unit breach at a high-requirement hour, tiny normalized
severity) than a non-breaching alternative (a 1-unit real deficit at a low-requirement hour,
large normalized severity) and shows the floor penalty (75) still flips the total cost in favor
of the non-breaching cut — the weight genuinely dominates a real severity advantage, not just a
token one. (2) *not too high (reinvents the cliff)* — the existing zero-slack test (floor ==
starting headcount everywhere, `capHours = 0`) still reaches the cap EXACTLY; this holds by
construction for ANY finite weight (a finite cost never blocks the trim from continuing once
every remaining candidate breaches), so this direction of the spec's caution is structurally
guaranteed rather than something FLOOR_WEIGHT's specific magnitude could get wrong — only an
INFINITE penalty could reinvent the cliff, and 75 is not that.

**CHANGE 4 — split `bandFloorHourly` (reporting) from `protectedFloorHourly` (solver-facing).**
`bandFloorHourly` (`EngineResult`) stays clamped to `hourlyRequirement`, unchanged in VALUE for
any hour where volatility ratio was already <= 1 — but is now REPORTING-ONLY
(`computeBandFloorViolations`'s "Hours outside your typical staffing range" stat). New
`protectedFloorHourly` (`EngineResult`) is UNCLAMPED — used ONLY by the solver's floor penalty
(`candidateCutCost`/`trimWeekToBudget`) and `backlogFeedback.ts`'s relaxation floor. Why: Phase
2a's `applyVolatilityBuffer` clamped its own ratio at 1 AND its output at `hourlyRequirement` —
since the formula interpolates BETWEEN the cohort floor and `hourlyRequirement`, that clamp
meant demand volatility could only ever REDISTRIBUTE the fixed budget toward spiky hours, never
justify staffing one ABOVE the mean-derived target, which is what a buffer is supposed to do.
`engine/demandBand.ts`'s `applyVolatilityBuffer` now has NO ratio clamp — a cell whose p75 is
3x its mean (ratio 2) gets `floor + 2*(hourlyRequirement-floor)`, genuinely above
`hourlyRequirement`, scaling continuously with how spiky the data is. This is safe specifically
BECAUSE change 3 also retired the 1e6 cliff for a finite power-law penalty — an unusually high
floor from a genuine data outlier now just costs more to breach, it doesn't make the trim
infeasible, so there's no correctness reason left to cap the floor's magnitude. `bandFloorHourly`
is derived by clamping `protectedFloorHourly` to `hourlyRequirement` in `compute()`
(`engine/index.ts`), not computed independently — the two curves are identical everywhere
volatility ratio <= 1, and only diverge at genuinely high-volatility hours.
`solveShiftFitWithBacklogFeedback`'s floor-raising step (Phase 2b) composes onto
`protectedFloorHourly` now, same reasoning as before ("deliberately NOT clamped ... this floor
is actively asking for MORE than the point target").

**CHANGE 5 — objective made visible; flex comparison made fair.** `EngineResult` gained
`totalBacklogHours`/`totalSeverity`/`peakSeverity` (via `engine/backlog.ts`'s new
`summarizeBacklogSeverity(grid, hourlyRequirement, shifts, params?)`, computed once in
`compute()` against the FINAL solved grid) — the solver's actual objective was previously
invisible on the results page, making the grid unexplainable by construction. **Fairness fix in
`ShiftMenuFlexibilitySection.tsx`:** the current menu used to be scored via `result` — the
primary idealized-grid solve, run through Phase 2b's 8-pass relaxation loop — while every
candidate/manual menu was scored via a plain one-shot `solveShiftFit`. The current menu was
getting a strictly better solver than its challengers. Fixed by solving the current menu
ONE-SHOT too, in this component, FOR THE COMPARISON TABLE ONLY — the idealized grid elsewhere on
the results page still uses the relaxation path via `getResult()`, unaffected. Deliberately did
NOT put flexMenu candidates through the relaxation loop instead (the other possible fix) — 45
candidates × 8 passes is a real cost multiplier for an advisory search; this resolves the open
question flagged in this file's Phase 2a section, recorded as: candidates AND the current-menu
comparison both stay on one-shot `solveShiftFit`, permanently. `flexMenu.ts`'s
`searchFlexibleMenus` now ranks candidates by `totalSeverity` (the actual solver objective, via
`summarizeBacklogSeverity`), not `totalShortfall` — `MenuCandidate.totalShortfall` is kept as a
DISPLAY COLUMN only. The comparison headline copy was reworded to lead with severity (what
changed) rather than implying "fewer gaps," since a severity-better candidate can occasionally
have an equal or slightly higher shortfall-hour COUNT if it trades a few shallow hours for
resolving one deep one.

**Existing tests re-verified against the new cost function, not adjusted until passing (per the
spec's explicit instruction) — one genuinely stopped being true, reported plainly:**
- The compounding-vs-isolated test (PR B/Phase 1 era) passes UNCHANGED — `compound.cost >
  isolated.cost` still holds under the convex objective.
- The cross-day-allocation test's CORE claim (day 0's dampening point makes it strictly cheaper,
  so it absorbs strictly MORE cuts than an equal-start day) still holds. Its STRONGER,
  more-specific assertion — that the untouched day stays at EXACTLY its starting hours — does
  NOT hold anymore, and this was verified to be a genuine behavior change, not a fluke: under
  the old linear model, once day 0's free dampening capacity was exhausted (3 cuts), the last 2
  of 5 needed cuts landed on day 0's OTHER shift only because of iteration-order tie-breaking
  (the trim's day-loop visits day 0 first, and the old cost function scored those 2 remaining
  cuts as genuinely IDENTICAL everywhere once the dampening ran out). Under PR C's convex
  severity + peak term, that tie no longer resolves the same way — the model finds it slightly
  cheaper to SPREAD the last 2 cuts to two different days (1 and 6) rather than stack a second
  and third cut onto day 0 itself, avoiding compounding two perturbations on the same day. This
  reads as a MORE correct convex-objective behavior, not a bug — but it is a real behavior
  change from the old model, and the test's over-specific assertion was rewritten to match,
  with the finding stated plainly in the test's own comment.
- `backlogFeedback.test.ts`'s oscillation test needed a THIRD budget value (65) — see the note
  at the end of the PR B section above.

### PR E (2026-07-26, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §4) — SEVENTH shape: STRUCTURAL vs. CYCLICAL, size-blind trim objective, relative caught-up threshold

**REVERSES part of PR B** (not the physics — the physics was never wrong — the REPORTING
layer that destroyed the evidence). THE FINDING (investigated against a real department's own
current-staffing grid, reproduced here with INVENTED numbers of the same real-world scale/shape
— see `backlog.test.ts`'s "PR E — structural/cyclical split (validation gate)" describe block
and §12.6/§14 open question 5 for why the literal real numbers can't ship in this repo): the
recurrence's physics were correct — the queue drains overnight EVERY night, bottoms out at a
genuinely low but non-zero, DAY-VARYING floor, and rebuilds through the day, exactly matching
what the department reports living through. But the page reported `neverClears: true` and
`168 of 168 hours behind`, because (1) ONE blended `backlog` curve conflated a real STRUCTURAL
floor (a budget/sizing signal — "you start Tuesday already behind") with the CYCLICAL swing
around it (a shape signal, independent of total budget size), and (2) `BACKLOG_CAUGHT_UP_
THRESHOLD`'s flat 0.5 nurse-hour bar was calibrated against peaks an order of magnitude smaller
than PR B's own physics now produces — a queue drained to 2% of a real peak still read as
"still behind."

**(a) Structural vs. cyclical split, on `BacklogResult` (`engine/backlog.ts`):**
- `structuralFloorByDay: number[7]` — the MINIMUM the ACTUAL backlog curve reaches each day
  (typically at its own trough hour). A BUDGET signal — "you start Tuesday already 14
  nurse-hours behind" is genuinely better advocacy than "you're always behind," and it's true.
  `structuralFloorMin` is the minimum across the whole week. **Never report one blended number
  again** — always the per-day array alongside any single "floor" figure.
- `cyclicalBacklog: Cell168` (+ its own `cyclicalLongestStreakHours`/`cyclicalLongestStreak
  Start`/`cyclicalNeverClears`/`cyclicalPeakBacklog`/`cyclicalPeakAt`) — the SAME recurrence,
  run against capacity RESCALED so its weekly total matches the requirement curve's own weekly
  total (`backlogModel.ts`'s new `rescaleCapacityToRequirementTotal`). This isolates SHAPE from
  SIZE: a department that's genuinely under-target in aggregate shows real ACTUAL backlog but a
  much smaller CYCLICAL curve (most of its problem is size); a department that's adequately
  staffed in aggregate but badly allocated shows real ACTUAL backlog with a CYCLICAL curve
  close to it (most of its problem is shape). Proven directly in `backlog.test.ts`: a flat
  (no-shape) uniformly-under-target department shows real `peakBacklog > 0` but
  `cyclicalPeakBacklog ≈ 0` (rescaling a flat capacity curve up to match a flat requirement
  curve makes them identical everywhere — a pure-size department has ~zero shape problem, and
  the cyclical view says so).
- **CYCLICAL now drives the Step 3 trim's own objective** (`engine/solver.ts`'s
  `candidateCutCost`/`trimWeekToBudgetCore`, and `backlog.ts`'s `summarizeBacklogSeverity`) —
  the REASON, not just a display preference: the trim allocates a FIXED total budget (it can
  only ever redistribute hours, never add to the total), so its own cost signal must be blind
  to SIZE (a question answered elsewhere — the funding-ask surface, PR G's synthesis) and
  sensitive only to SHAPE, or it spends effort trying to fix a problem it structurally cannot
  solve. Mechanically: `trimWeekToBudgetCore` computes `{ rescaled: cyclicalCapacity, scale }`
  from `rescaleCapacityToRequirementTotal` ONCE per outer iteration (same "expensive recompute
  once per iteration, not per candidate" discipline as everything else in this loop) and passes
  BOTH raw `capacity` and `cyclicalCapacity`/`scale` into `candidateCutCost`. **The floor-breach
  check stays against RAW capacity** (a real physical "can I actually staff this low"
  constraint, not a shape concept) — only the severity-delta simulation uses the rescaled
  curve, converting a real 1-headcount-unit cut into its size-normalized equivalent
  (`capacityScale` nurse-hours) for that simulation. `summarizeBacklogSeverity`'s
  `totalSeverity`/`peakSeverity` now score the CYCLICAL curve; `totalBacklogHours` STAYS the
  actual/raw total (a size-sensitive number on purpose, for consumers that want the real
  total). The trim-trajectory recorder (`trimWeekToBudgetWithTrajectory`'s `onBeforeCut` hook)
  receives the now-cyclical `baselineBacklog` too, so the funding-ask's
  `longestLeanStretchHours`/`Start` (PR D) are cyclical-driven as well, per spec.
  - **Existing tests, re-verified not silently patched:** all 6 direct `candidateCutCost` unit
    tests in `solver.test.ts` (compounding-vs-isolated, volatility, band-floor-breach) pass
    `capacity` for BOTH the raw and cyclical args with `capacityScale: 1` (i.e. no rescale) —
    these tests hand-construct capacity/requirement specifically to isolate
    `candidateCutCost`'s OTHER logic (compounding/peak/volatility/floor), not the rescale
    itself; the rescale is exercised at the `trimWeekToBudget`/integration level instead. All
    121+ pre-existing tests passed UNCHANGED after this reversal — the rescale factor is close
    to 1 for most hand-built scenarios (their total capacity was already close to their total
    requirement), so this is a low-blast-radius change in practice, verified empirically by
    running the full suite rather than assumed.

**(b) `BACKLOG_CAUGHT_UP_THRESHOLD` retired as an absolute bar, replaced by
`caughtUpThresholdForHour(requirement)` (`backlogModel.ts`):** `max(BACKLOG_CAUGHT_UP_
ABSOLUTE_FLOOR = 0.5, BACKLOG_CAUGHT_UP_RELATIVE_FRACTION = 0.1 * requirement)` — ~10% of THAT
HOUR's own requirement, floored at the old absolute value so a near-zero-requirement hour
doesn't get a degenerate near-zero threshold (which would make every nonzero backlog value read
as "still behind," the opposite failure mode). `longestStreakAboveThreshold` (`backlogModel.ts`)
now accepts either a scalar OR a per-hour array (backward compatible). Every consumer of the old
flat constant moved to the per-hour version: `computeBacklog`'s own `neverClears`/
`longestStreakHours` (measured against the ACTUAL curve, same relative bar now applied to the
CYCLICAL curve's own streak fields), `solver.ts`'s trim-trajectory recorder, and
`backlogFeedback.ts`'s per-hour `carriedIn` floor-raising check. `BACKLOG_CAUGHT_UP_THRESHOLD`
itself stays exported (now just `BACKLOG_CAUGHT_UP_ABSOLUTE_FLOOR` under an old name) so nothing
importing it breaks at the type level — new code should use `caughtUpThresholdForHour`/
`caughtUpThresholds168`. This is what makes `neverClears` trustworthy again at real-world peak
magnitudes (a queue 98% cleared from a peak of 44 no longer reads as "still behind").

**(c) `maxDrainFraction = 0.3` — REPORTED, not retuned, per the spec's explicit instruction.**
Empirical finding (candidateCutCost swept across `maxDrainFraction ∈ {0.1, 0.3, 0.6, 1.0}` at
several spare-capacity levels near a recovery hour, realistic-scale carried backlog ~12-15
nurse-hours matching PR B's own reported realistic peak): **the spec's own hypothesis — "nearly
inert, since spare rarely exceeds ~6 nurses in a solved grid" — is only true at VERY small
residual spare (≤2 nurse-hours).** At spare = 4-6 nurse-hours (a perfectly plausible post-trim
residual, not an edge case), moving `maxDrainFraction` from 0.3 up to 0.6/1.0 still changes the
isolated-cut cost by 10-45% — i.e. **0.3 IS doing real protective work against the peak-cutting
bias in the realistic 4-6-nurse-hour spare range**, not just at the extremes. It only becomes
genuinely inert (recoveryEfficiency's `spare * 0.6` term already binds regardless of
`maxDrainFraction`'s value) when spare is very small. Conclusion: the peak-cutting bias IS
meaningfully prevented at 0.3 across the range of spare capacity a solved grid actually
produces — **left unchanged at 0.3**, per the spec's own "report before you tune" instruction;
this is a report of what already works, not a case for retuning.

**(d) `abandonRate` becomes measurable — `EngineInputs.lwbsRate?: number` (0-1).** New OPTIONAL
setup field for the department's own LWBS rate. `engine/index.ts`'s `compute()` derives a
`BacklogRecurrenceParams` object once (`abandonRate: inputs.lwbsRate ?? DEFAULTS.
backlogAbandonRate`, `recoveryEfficiency`/`maxDrainFraction` stay at their `DEFAULTS` — not
(yet) plausibly measurable from a real ED's own data, unlike abandonRate) and threads it through
every backlog-consuming call (`solveShiftFitWithBacklogFeedback`, `trimWeekToBudgetWithTrajectory`,
`summarizeBacklogSeverity`, the new `estimatedAbandonedHours` computation) — previously these
all fell back to each module's own internal `DEFAULT_BACKLOG_PARAMS`, with no way for a real
department's own LWBS data to reach them at all. Absent -> unchanged default behavior, labelled
in the UI as a cohort assumption (not this department's own number) when surfaced — respects the
no-seeded-ED-data constraint (no fallback derived FROM the absence of this field, ever).

**(e) `EngineResult.estimatedAbandonedHours: number`** — sum over the week of `abandonRate *
backlog[hour-1]` (the nurse-hours of queued work the recurrence's own passive-attrition term
already removes every hour, previously computed inside the recurrence and discarded). Computed
in `compute()` via a second (cheap, pure-arithmetic) `computeBacklog` call against the FINAL
solved grid — kept separate from `summarizeBacklogSeverity`'s return shape so that function's
OTHER callers (flexMenu ranking, etc.) don't gain a field they don't need. An ESTIMATE of WORK
abandoned (queued nurse-hours that left the system via attrition), NOT a patient count — **never
convert to a dollar figure** (spec §12/§13; the finance-partner worksheet, PR G, is the
sanctioned alternative — it explicitly declines to do this conversion itself either).

**Invariants held throughout:** `reconcile.test.ts` passes with a ZERO-LINE DIFF (never touches
solve output). `annualVisits`/`annualCoreRnHoursBudget`/`hourlyRequirement` untouched by any of
the above. All 121 pre-existing tests pass UNCHANGED (verified, not assumed) plus 12 new ones
(`backlog.test.ts`'s two new describe blocks) — test count reached 133.

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

## Shift wraparound model — REVERSED 2026-07-26 (PR A, SOLVER_REALISM_SPEC_2026-07-26.md)

**History:** a shift used to be treated as covering hours circularly **within a single
day** (`shiftHoursOfDay`), not spilling into the next calendar day of the week. A 7p–7a
shift assigned to "Monday" covered Monday hours 19–23 **and Monday hours 0–6** — i.e. it
was solved as if each day's 24-hour requirement curve was its own closed loop. This was
wrong in a specific, high-visibility way: Monday's 00:00-06:00 block is physically the TAIL
of SUNDAY night's crew, not a second block of Monday's own overnight shift (which hasn't
started yet at 00:00 Monday — its first hour is 19:00). The old model forced one
headcount decision to serve both Monday's own evening peak AND Sunday-into-Monday's early
hours, at exactly the boundary (Friday-into-Saturday, the busiest overnight in a typical
week) an experienced charge nurse would check first — producing a permanently wrong grid
there. Confirmed as a genuine bug (not a stylistic call) and reversed with Ben.

**Current model: circular over the FULL WEEK, not per-day.** A shift assigned to day `d`
covers global hours `(d*24 + startHour + i) mod 168` for `i` in `[0, lengthHours)` —
`shiftHoursOfDay` (day-local) is renamed `shiftGlobalHours(day, shift)` (`engine/solver.ts`,
private) since the day-local reading is now actively misleading. This is the SAME
week-circular convention `boarding.ts`'s convolution already used — the core grid was the
odd one out, not the other way around. Only wraps at the week boundary itself (Saturday,
day 6, spilling into Sunday, day 0) — a real, if rare, edge case (a Saturday-night shift's
tail genuinely does land on Sunday morning).

**What this touches, mechanically:**
- `coverageForDay` changed signature from `(headcount, shifts)` (one day's own headcount
  object) to `(grid, shifts, day)` (the WHOLE grid + a day index) — a day's own early hours
  can now be covered by the PREVIOUS day's shift, so per-day-independent coverage is no
  longer correct in general; it's now a thin slice of `fullWeekCapacity`.
- `fullWeekCapacity(grid, shifts)` is the new primary — computes all 168 global hours'
  capacity directly from the whole grid; `coverageForDay` derives from it.
- `solveFullCoverageDay` (5.2, per-day) is GONE, replaced by `solveFullCoverageWeek`
  (JOINT over the whole week) — required because a day's own deficit may only be solvable
  by bumping the PREVIOUS day's shift now. Provably a no-op vs. the old per-day algorithm
  when no shift in the menu crosses midnight (each day's greedy trajectory is unaffected by
  interleaving with any other day in that case) — proven by a direct regression test in
  `solver.test.ts`'s PR A describe block.
- `enforceDepartmentFloor` (5.6) and `findDepartmentFloorViolations` (the live-edit
  read-only check) both became JOINT week-level passes for the same reason — a violation at
  a day's early hour may need fixing on the previous day's shift.
- `candidateCutCost`'s `perturbedHours` now comes straight from `shiftGlobalHours(day,
  shift)` (already global — no more `.map((h) => day*24+h)` needed).
- New `coveringCellsByGlobalHour(shifts)` (168-array of `{day, shiftId}` lists): for every
  global hour, which (day, shift) GRID CELL structurally covers it — i.e. which cell you'd
  actually need to bump to add capacity there. Used by `backlog.ts`'s per-shift
  inherited-vs-generated attribution, `boarding.ts`'s priority-slot ranking (a census hour's
  demand now lands in the ACTUAL covering cell, which may be the previous calendar day's
  shift for a spillover hour — the day-of-week seasonality factor still applies to the
  census hour's own calendar day, unaffected), and `bandFloor.ts`'s "worst stretch" shift
  label. This replaces the old hour-of-day-only lookups those three files each had.
- `computeBacklog` (`backlog.ts`) and `computeBandFloorViolations` (`bandFloor.ts`) both
  moved their capacity computation from a per-day `coverageForDay` loop to a single
  `fullWeekCapacity` call.

**What did NOT change:** the UI grids stay day × shift-slot in shape — only which HOURS a
cell's headcount is counted as covering changed. Total scheduled hours is still exactly `Σ
headcount × lengthHours`, unaffected by attribution (tested directly). `trimWeekToBudget`'s
own logic is unchanged — it just now consumes a correctly-computed `fullWeekCapacity`.
Boarding's `hourToShiftShares` is gone (folded into the shared `coveringCellsByGlobalHour`),
but its hand-off-hour even-split convention is unchanged.

If you ever need to reason about "does this shift wrap," length is clamped to `[1, 24]`
(`ShiftMenuEditor.tsx`), so a shift's coverage spans at most one day boundary — spillover
candidates are always either "this day" or "the previous day," never further.

## Shift-menu flexibility search (`flexMenu.ts`, 2026-07-24) — REVERSES the "no auto-search" decision

`searchFlexibleMenus` (`engine/flexMenu.ts`) is a NEW solver capability that **reverses the
long-standing "Auto-optimizing shift-menu search" out-of-scope decision** (CLAUDE.md
Section 7 / algorithm spec Section 7). Confirmed intentional with Ben 2026-07-24 (spec §2.3).
Read this before touching it — the reversal is deliberately SCOPED so it doesn't become the
general optimizer the original decision declined:

- **Opt-in per axis.** Nothing searches unless the user enables one of three flexibility axes
  (`FlexAxes`: `startTimes` / `shiftCount` / `shiftLengths`), captured at setup
  (`ShiftMenuStep`, store `flexAxes`, default all-off) and adjustable on the results page.
  All-off = static: the idealized grid uses the user's own menu, never a silent substitute.
- **Bounded enumeration, not optimization.** Candidates are regular tilings over
  `CANDIDATE_COUNTS` (2/3/4) × `CANDIDATE_LENGTHS` (8/10/12) × `CANDIDATE_OFFSETS` (5 anchors)
  — ≤ 45, deduped, each solved through the EXISTING `solveShiftFit` at the SAME budget. No new
  solve logic; it's a fan-out over the current one. Ranked by least total shortfall, then
  fewest hours.
- **Count/length are physically coupled.** A length L only tiles 24h with count ≥ 24/L, so the
  count set is derived PER length (see the comment in `searchFlexibleMenus`): shift-count axis →
  try 2/3/4 (filtered to those that tile); else exploring lengths → each length's natural
  minimal tiling count (8h→3, 10h→3, 12h→2); neither → hold current count. This is what lets
  "flexible shift length" alone surface 8s/10s that a fixed 2-shift count could never tile —
  don't "simplify" it back to independent count/length loops or 8h candidates silently vanish.
- **Advisory only — NEVER auto-adopted.** `ShiftMenuFlexibilitySection.tsx` shows the best
  candidate as a side-by-side comparison table only if it genuinely beats current; otherwise it
  says the current menu is already efficient. The idealized grid is never mutated. This
  preserves the "numbers, not a verdict" principle. The old `CompareTab.tsx` (user-driven
  side-by-side variants) was DELETED and its manual path folded into this section.
- When touching this, keep the reversal flagged in the commit/PR body (spec §4.2 requirement).
