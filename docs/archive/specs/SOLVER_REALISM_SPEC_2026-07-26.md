# Solver realism & explainability — sequenced work spec (2026-07-26)

Planned in Cowork with Ben. Four separable PRs, in dependency order. Each block below is a
self-contained prompt for a fresh Claude Code session.

**Governing premise (do not "fix" this):** ShiftLens deliberately models nursing demand as
front-loaded at arrival — triage, access, labs, meds, initial assessment — and therefore
allocates hours by arrival share with **no length-of-stay convolution in the core grid**.
LOS in a real ED is driven substantially by physicians, ancillary services, and throughput,
none of which nurse staffing controls. Adding an LOS/census convolution would silently
charge nursing for radiology turnaround and destroy the tool's value in a funding
conversation. `boarding.ts` convolves over duration because admitted holds are the one
population whose LOS genuinely *is* nurse-driven. **This asymmetry is intentional and
confirmed with Ben — do not add an LOS kernel to `allocate.ts`.**

The consequence: the model is **normative** (what staffing should look like if surrounding
operations are right), not descriptive. Backlog is therefore best understood as
**un-started front-loaded arrival work — i.e. the waiting room**, which is the direct
antecedent of LWBS. Use that framing in code comments and UI copy.

**Ordering rationale.** PR A changes which hours a shift covers, so doing it first means
B and C are written once against correct semantics. B must precede C (the convex objective
is computed on the backlog curve B produces). D is last because its narrative depends on
B and C's outputs.

**Invariants that hold across all four PRs** — restate these in every PR body:
- `src/engine/__tests__/reconcile.test.ts` must pass **completely unmodified**. It never
  touches solve output. If it fails, something touched `annualVisits` /
  `annualCoreRnHoursBudget` / `cellCoreHours`, which none of this work may do.
- Total scheduled hours is always `Σ headcount × lengthHours` — independent of which hours
  a shift covers, which cost function is used, or how backlog is modeled.
- The ENA department floor (5.6) remains the ONLY mechanism permitted to push scheduled
  hours above `capHours`.
- No ED-specific data may ever appear as a seeded default.
- `npm run build`, `npm test`, and `oxlint` clean at the end of every PR.

---

## PR A — Shift hours become global week hours (fixes overnight attribution)

```
Read CLAUDE.md, .claude/rules/engine-solver.md (in full), and
.claude/rules/boarding-seasonality.md before starting. Read SOLVER_REALISM_SPEC_2026-07-26.md
in the repo root — this prompt implements its PR A.

PROBLEM. `shiftHoursOfDay` in src/engine/solver.ts wraps a shift's hours circularly WITHIN
a single day. A Saturday 19:00 12-hour shift therefore covers Sat 19:00-23:00 AND Sat
00:00-06:00. In reality those two blocks are worked by different crews on different nights:
Sat 00:00-06:00 is the tail of FRIDAY night. The model forces one headcount to serve both,
at the most volume-variable boundary in the week (Friday-into-Saturday is typically the
busiest overnight). This produces a permanently wrong grid at exactly the hours an
experienced charge nurse will check first.

CHANGE. Move shift-hour attribution from day-local to global week hours:
a shift starting at `startHour` on day `d` covers global hours
`(d*24 + startHour + i) mod 168` for i in [0, lengthHours). Circular over the WEEK, not
the day — the same convention `boarding.ts`'s convolution already uses, which is why the
core grid is currently the odd one out.

Call sites to update (search for every use, don't assume this list is complete):
- `shiftHoursOfDay` itself — returns global hours; rename if the day-local reading is now
  misleading.
- `coverageForDay` — becomes a week-level capacity function. `fullWeekCapacity` already
  works in global space and should become the primary; day-level views derive from it.
- `enforceDepartmentFloor` and `findDepartmentFloorViolations` — currently iterate per day
  with day-local coverage; both must become week-level passes.
- `candidateCutCost`'s `perturbedHours` computation in solver.ts.
- `computeBacklog` in backlog.ts.
- `rankBoardingPrioritySlots` in boarding.ts (hand-off hour even-split convention is
  unchanged; only which global hour maps to which shift changes).
- Every UI consumer of `coverageForDay`: CoreGridTab.tsx, CurrentStaffingAnalysis.tsx.

The UI grids DO NOT change shape — still day x shift headcount. Only which hours a cell's
staff is counted as covering changes. Expect the heatmap to visibly shift: Saturday
00:00-06:00 will now reflect Friday night's crew. That is the payoff, not a regression.

INVARIANTS.
- reconcile.test.ts passes unmodified.
- Total scheduled hours (Σ headcount × lengthHours) is numerically UNCHANGED for any given
  grid — this change redistributes attribution, never the total. Assert this directly in a
  test: build a grid, compute weekly hours under the new model, confirm it equals
  headcount-times-length by hand.
- Boarding's conserved-total property (boarding.test.ts) still holds.
- The full-coverage solve still fully covers every hour (no gaps introduced at the week
  wraparound).
- A non-wrapping shift menu (e.g. all shifts 07:00 8h / 15:00 8h) must produce IDENTICAL
  output to before this change — add a regression test proving the change is a no-op when
  no shift crosses midnight.

TESTS. Add to solver.test.ts: a two-shift 07:00/19:00 12h menu where Friday's requirement
curve is much heavier than Saturday's; assert that Saturday 00:00-06:00 coverage now tracks
FRIDAY's night headcount, not Saturday's. This is the whole point of the PR and should fail
against the current code.

DOCS. This changes behavior documented in .claude/rules/engine-solver.md's "Shift wraparound
model" section, which explicitly says the model does NOT do cross-midnight spillover. Ben
has confirmed this reversal. Rewrite that section with the new model and the reasoning
above; note in CLAUDE.md Section 6 that day-attribution is now global-week. Flag the
reversal prominently in the commit body.
```

---

## PR B — Asymmetric backlog recovery, in one shared module

```
Read CLAUDE.md, .claude/rules/engine-solver.md (in full), and
SOLVER_REALISM_SPEC_2026-07-26.md's PR B. PR A (global shift hours) must already be merged.

PROBLEM 1 (structural). The backlog recurrence exists TWICE — `computeBacklog` in
engine/backlog.ts and `backlogFromCapacity` in engine/solver.ts — with a comment asking
future sessions to keep them in sync. That was tolerable for a one-line formula. This PR
makes it a five-line model with three constants, so the duplication must go first.

PROBLEM 2 (physics). The current recurrence
  backlog[h] = max(0, backlog[h-1] * 0.85 + (req[h] - cap[h]))
collapses three different processes into one constant, and models recovery as unconstrained
and symmetric: one spare nurse-hour retires exactly one nurse-hour of backlog, without
limit. That is false. Backlog in an ED is usually bed- and provider-limited, not
nurse-limited, and care delivered three hours late already produced its harm. The visible
consequence (documented in engine-solver.md's own test descriptions) is that
`candidateCutCost` scores a cut as nearly free when a later excess-capacity hour can
"absorb" it — so the trim systematically prefers to CUT AT OR BEFORE A PEAK when there is
slack afterward. That is precisely the schedule an experienced charge nurse would reject.

CHANGE 1. Create `src/engine/backlogModel.ts` — a LEAF module with no engine imports (it
takes capacity and requirement arrays, not grids). It owns the recurrence and its constants.
Both backlog.ts and solver.ts import from it. This also cleanly removes the circular-import
problem that forced the duplication (backlog.ts imports coverage helpers FROM solver.ts).

CHANGE 2. Replace the single-decay recurrence with:

  carried[h]  = backlog[h-1] * (1 - abandonRate)
  newWork[h]  = max(0, req[h] - cap[h])
  spare[h]    = max(0, cap[h] - req[h])
  paydown[h]  = min( carried[h],
                     spare[h] * recoveryEfficiency,
                     carried[h] * maxDrainFraction )
  backlog[h]  = carried[h] + newWork[h] - paydown[h]

New DEFAULTS constants (replacing `backlogHourlyDecay`, which is retired):
  backlogAbandonRate      = 0.03   // work that LEAVES the system per hour — this is LWBS.
                                   // Unlike the other two this is measurable in a real ED's
                                   // own data, so it can eventually carry a stronger
                                   // evidence tag than ASSUMPTION. The old 0.85 decay
                                   // implied 15%/hr simply vanishing — far too forgiving.
  backlogRecoveryEfficiency = 0.6  // a spare nurse-hour retires LESS than an hour of queued
                                   // work: catch-up loses batching, adds re-triage and
                                   // reassessment.
  backlogMaxDrainFraction = 0.30   // hard ceiling on queue drainage per hour regardless of
                                   // spare staff — beds, providers and imaging gate it.
                                   // THIS is the term that fixes the peak-cutting bias.

Keep the existing two-pass circular settle (seed backlog[167] so the Sat->Sun carry is real)
and the no-week-boundary-reset rule — both unchanged.

DELIBERATELY NOT IN SCOPE: a rework/degradation term (waiting patients generating extra
nursing work). It is real but second-order and harder to defend. Record it as explicitly
declined in engine-solver.md, not silently omitted.

INVARIANTS.
- reconcile.test.ts passes unmodified.
- backlog[h] >= 0 for all h, always.
- Zero deficit everywhere => zero backlog everywhere.
- EQUIVALENCE TEST (do this one first, it validates the refactor before the physics change):
  with abandonRate = 0.15, recoveryEfficiency = 1, maxDrainFraction = 1, the new recurrence
  is ALGEBRAICALLY IDENTICAL to the old `max(0, b*0.85 + req - cap)`. Prove it with a test
  over random capacity/requirement arrays asserting exact equality against the old formula.
  Land that test passing BEFORE changing the default constants.
- The recurrence lives in exactly one place. Add a test or lint note that fails if a second
  implementation appears.

EXPECT THE OUTPUT TO GET WORSE, AND SAY SO. Streaks will lengthen, `neverClears` will fire
more often, peak backlog will rise. That is the model becoming honest. `BACKLOG_CAUGHT_UP_
THRESHOLD` (0.5) will likely need recalibrating — check it against a realistic scenario and
report what you found rather than silently retuning it. Existing backlog.test.ts cases
asserting specific streak lengths or the geometric steady state 1/(1-decay) will need
rewriting; rewrite them against the new model rather than loosening assertions.

DOCS. Update .claude/rules/engine-solver.md's "Budget-capped trim" section and
backlog.ts's header. This is a change to already-documented behavior — Ben has confirmed it.
Note the new framing explicitly: backlog = un-started front-loaded arrival work = the
waiting room = LWBS antecedent.
```

---

## PR C — Convex objective, peak term, and retiring the 1e6 cliff

```
Read CLAUDE.md, .claude/rules/engine-solver.md (in full), and
SOLVER_REALISM_SPEC_2026-07-26.md's PR C. PRs A and B must already be merged.

PROBLEM. `candidateCutCost` minimizes a LINEAR sum of marginal backlog-hours. Ten
nurse-hours of backlog in one hour scores identically to one nurse-hour across ten hours.
Every outcome an ED actually cares about — wait times, LWBS, safety events, whether a nurse
resigns — is CONVEX in shortfall depth; queueing systems degrade nonlinearly as utilization
approaches one. So the current objective is indifferent between "shallow everywhere" and
"catastrophic on Friday," and will trade the latter for small gains elsewhere.

This is a regression the history file does not flag as such: the 2026-07-25 band-floor
deadband used `(floor - coverage)^1.8` and was genuinely convex. Moving to backlog was the
right change of VARIABLE; the curvature was dropped along the way. This PR takes it back,
applied to the better variable.

CHANGE 1 — convex severity, normalized by need.

  severity[h] = ( backlog[h] / max(hourlyRequirement[h], 1) ) ^ SEVERITY_GAMMA
  SEVERITY_GAMMA = 1.8

  cost = Σ_window ( severity_after[h] - severity_before[h] ) * (1 + VOLATILITY_COST_WEIGHT * avgVolatility)

Normalize by `hourlyRequirement`, NOT raw nurse-hours. Two nurses short at an hour needing
ten is a bad hour; two short at an hour needing three is a crisis. Raw nurse-hours cannot
distinguish them, which is exactly why the current trim is willing to flatten peaks. Guard
the divisor for requirement = 0 (overnight cells in very low-volume EDs).

CHANGE 2 — promote peak from tie-break to cost term.
`peakInWindow` is currently only a tie-break. Make it a weighted component:

  cost += PEAK_WEIGHT * ( peakSeverity_after - peakSeverity_before )
  PEAK_WEIGHT = 0.3

Managers, regulators and plaintiffs' attorneys care about the worst night, not the average
night. A convex sum alone will still trade one catastrophic shift for diffuse small gains if
the arithmetic works out. Keep the existing lower-peak tie-break as well.

CHANGE 3 — retire BAND_FLOOR_BREACH_PENALTY = 1e6.
Replace the discontinuous cliff with the same convex shape, steeper:

  floorPenalty[h] = FLOOR_WEIGHT * max(0, floor[h] - cap[h]) ^ FLOOR_GAMMA
  FLOOR_WEIGHT = 75, FLOOR_GAMMA = 2

This gives one smooth cost surface instead of two regimes, makes a DEEP breach much worse
than a shallow one (which `1e6 * depth` does not), keeps the finiteness that was the whole
reason 1e6 replaced infinity, and removes a magic number. Verify the existing zero-slack
test (floor == starting headcount everywhere, capHours = 0) still reaches the cap exactly —
if FLOOR_WEIGHT is too low the trim will breach too readily, too high and you have
reinvented the cliff. Report the value you settled on and why.

CHANGE 4 — split the two floor curves.
`bandFloorHourly` currently serves two consumers with incompatible semantics: the solver's
protected floor and `computeBandFloorViolations`' reporting stat. Phase 2a's
`applyVolatilityBuffer` clamps it at `hourlyRequirement`, which means demand volatility can
only ever REDISTRIBUTE the budget toward spiky hours — it can never justify staffing a spiky
hour above the mean-derived target, which is what a buffer is for. Introduce:
  - `bandFloorHourly` — clamped as today, used ONLY for the reporting stat.
  - `protectedFloorHourly` — UNCLAMPED (volatility may raise it above hourlyRequirement),
    used ONLY by the solver's floor penalty and by backlogFeedback's relaxation floor.
Both on EngineResult. This stays budget-neutral: capHours is unchanged, only where
protection lands changes.

CHANGE 5 — make the objective visible and the flex comparison fair.
- Expose `totalBacklogHours` and `peakSeverity` on EngineResult. The solver's actual
  objective is currently invisible on the results page, which makes the grid unexplainable
  by construction.
- ShiftMenuFlexibilitySection.tsx currently compares a CURRENT menu solved by
  `solveShiftFitWithBacklogFeedback` (8-pass relaxation, via compute()) against CANDIDATES
  solved by one-shot `solveShiftFit`. The current menu gets a better solver than its
  challengers. Fix by solving the current menu one-shot too, FOR THE COMPARISON TABLE ONLY
  (the idealized grid keeps the relaxation path). Do not put candidates through the
  relaxation loop — 45 candidates x 8 passes is a real cost multiplier for an advisory
  search. This resolves the open question flagged in engine-solver.md; record the decision.
- Rank flexMenu candidates on the SAME objective the solver minimizes (total severity), not
  on total shortfall. Keep shortfall as a display column only.

INVARIANTS.
- reconcile.test.ts passes unmodified.
- capHours = 0 is still reachable exactly (the floor penalty stays finite).
- Cost is monotone non-decreasing in breach depth and in resulting backlog.
- The existing cross-day allocation test and compounding-vs-isolated test in solver.test.ts
  should still express true claims — rewrite them for the new cost function rather than
  deleting them; if either no longer holds, say so explicitly rather than adjusting the
  scenario until it passes.

TESTS. Add: two candidate cuts with EQUAL total marginal backlog-hours but different
distribution (one deep hole vs. several shallow ones) — assert the convex objective strictly
prefers the shallow spread, which the old linear cost could not distinguish at all.

DOCS. Update .claude/rules/engine-solver.md's "Budget-capped trim" section (this is the
fifth shape of that area — keep the history intact) and CLAUDE.md's Section 6 note on the
"Hours outside your typical staffing range" stat, which now reads from the clamped
reporting curve specifically.
```

---

## PR D — Funding-ask surface + results-page explanation rewrite

```
Read CLAUDE.md, .claude/rules/results-redesign.md, and
SOLVER_REALISM_SPEC_2026-07-26.md's PR D. PRs A, B and C must already be merged.

PROBLEM. The tool computes the answer to "do I need more staff?" and throws it away.
`solveFullCoverageDay` produces the never-short-at-any-hour grid; both `solveShiftFit` and
`solveShiftFitWithBacklogFeedback` discard it. So the tool's only possible answer is "here
is how to spend what your own wHPPV target implies" — which a CFO defuses by questioning the
target. Separately, several results-page numbers state a value without a comparison or a
consequence, and the app's own "why" explainer describes an objective the solver abandoned
two reversals ago.

CHANGE 1 — record the trim trajectory (this is nearly free).
`trimWeekToBudget` already walks from full coverage down to capHours one cut at a time,
cheapest-first. Record at each cut: cumulative hours removed, resulting total severity,
resulting longest lean stretch. Because the trim is greedy-cheapest-first, reading that log
BACKWARDS gives marginal value in decreasing order — a genuine diminishing-returns curve for
free, with the right shape already guaranteed. Do NOT assert strict monotonicity in a test
(the greedy re-evaluates every step, so small non-monotonicities are possible and are not
bugs).

CHANGE 2 — new EngineResult fields:
  fullCoverage: { weeklyHours, impliedWhppv, fteDelta }   // fteDelta = (fullCoverageHours - capHours) * 52 / 2080
  marginalCurve: Array<{ cumulativeHoursAdded, totalSeverity, longestLeanStretchHours }>
  marginalKneePoint: number | null   // where marginal return flattens; null if no clear knee

EDGE CASE: full coverage may be UNDER budget (a generous wHPPV target in a low-volume ED).
Then fteDelta <= 0 and the UI must say "your budget already funds full coverage" rather than
rendering a negative ask. Handle explicitly, test it.

CHANGE 3 — new results section: "What this schedule costs you, and what closing the gap buys."
Templated headline in the same pattern as the existing ones, e.g.:

  "Full coverage of every hour would take {X} hrs/week. Your budget funds {Y} — a {gap}-hour
   gap, about {fte} FTE, equivalent to running at {impliedWhppv} wHPPV instead of your
   {target} target. But you don't need all of it: the first {kneeFte} FTE remove {pct}% of
   the modeled backlog and eliminate the {n}-hour {day} {time} stretch. Past about {kneeFte}
   FTE, each additional FTE buys progressively less."

Plus the marginal curve as a small chart. This is the artifact a manager screenshots into an
email to a CNO, and nothing on the current page does that job. It survives both standard
rebuttals: "you always want more" (no — here is where returns flatten) and "you're within
normal for peers" (the ask is tied to a named, dated stretch of understaffing, not a
benchmark).

CHANGE 4 — heatmap: change the cell number, make color and number agree.
- Cell shows `onDuty / requirement` ("7/9"). Any nurse reads that instantly. Demote per-hour
  realized wHPPV to the tooltip — it is currently the primary number and is the least
  intuitive of the three available, because it is dominated by the arrivals denominator.
- Drive COLOR from the same ratio, with the neutral band taken from the per-hour
  `bandFloorHourly` / `bandCeilingHourly` curves rather than the week-level wHPPV band. This
  is a strictly better band (hour-specific, not week-average), makes number and color encode
  the same thing, and finally gives `bandCeilingHourly` the consumer it has never had.
- Keep everything else from the 2026-07-25 legibility rework: asymmetric lean/rich ramps,
  the backlog spine, shift-boundary rules, the shared-domain-computed-once-in-CoreGridTab
  rule. Read .claude/rules/results-redesign.md's last section before touching any of it.

CHANGE 5 — explanation fixes, all copy-level:
- REWRITE the "Why might this run over or under budget?" explainer in CoreGridTab.tsx. It
  still says the solver cuts "the hours that are cheapest to lose (the ones that create the
  least shortfall)." That has been false through multiple reversals and is now the most
  user-visible correctness defect in the app. New text should say, in plain language: the
  solver removes whichever shift-hour would add the least *queued patient work*, weighted so
  that deep holes count far more than shallow ones, and never cutting below the peer-
  benchmark floor unless the budget makes it unavoidable.
- ADD the front-loaded-nursing premise, near the top of the results page:
  "This schedule staffs to when patients arrive, because most nursing work happens in the
   first hour of a visit. If your department feels busiest later in the day, that's
   throughput — and it shows up below as backlog, not as more nurses."
  Without this, a manager whose census peaks at 18:00 sees a grid peaking at 13:00 and
  concludes the tool is broken within thirty seconds.
- Backlog headline must state WHEN. `computeBacklog` returns `longestStreakStart` and
  CurrentStaffingAnalysis.tsx does not use it. "Six hours" is unactionable; "Friday 16:00
  through 22:00" is a staffing decision. Reframe in waiting-room terms: "By 18:00 Friday,
  roughly {n} nurse-hours of arrival work is queued — about where patients start leaving
  without being seen."
- Comparison unit must state what the gap BUYS. It currently says "you need 84 more hours"
  and stops. Add the consequence clause, now computable from the marginal curve.
- Relabel "Hours outside your typical staffing range" -> it counts only hours BELOW, and the
  range is the peer cohort's 25th percentile, not this ED's own history. Say so plainly
  ("hours below the peer 25th-percentile staffing floor"). A manager who discovers mid-
  meeting that their benchmark is the bottom quartile loses the room; one who framed it that
  way from the start owns it.
- Surface `backlogFeedbackStillImprovingAtCap` — it means THIS GRID DID NOT CONVERGE and is
  currently rendered nowhere. A short caveat line is enough.
- Flexibility section: state WHICH hours a candidate improves ("fixes Friday 16:00-21:00,
  costs you Sunday overnight"), and add an explicit retention caveat on any 12h->8h
  suggestion.

CHANGE 6 — widen the flexMenu candidate space beyond uniform tilings.
`buildTiling` only generates regular tilings: same length, evenly spaced, five anchor
offsets. Real ED menus are irregular by design, and the single most common correct answer to
a unimodal arrival curve is a mid/swing shift layered over existing 12s. The search cannot
currently propose one. Add a bounded family of "current menu + one overlay shift" candidates
(a few lengths x a few start hours, still bounded and still deduped) so a swing shift is
reachable. Keep the total candidate count bounded and the search opt-in and advisory —
the reversal's scope (engine-solver.md's last section) is unchanged.

CHANGE 7 — headcount semantics (one setup question, not role modeling).
Add to setup: "Does your headcount include charge and triage nurses?" plus a single
indirect-care uplift percentage. An ENA floor of 2 reads as unserious to anyone running a
real community ED, and "is a 5 five bedside RNs or five bodies?" is the cheapest available
fix for "this grid looks wrong to me." Do NOT build role-level modeling.

INVARIANTS.
- reconcile.test.ts passes unmodified.
- Recording the trim trajectory must not change the trim's OUTPUT — assert the resulting
  grid is byte-identical with and without trajectory recording.
- `fullCoverage.weeklyHours >= weeklyScheduledHours` in all normal cases; handle the
  under-budget case explicitly rather than assuming it.

DOCS. Add a new section to .claude/rules/results-redesign.md. Update CLAUDE.md's Screen Map
(new results section) and Section 6 (heatmap cell number + color source changed; note this
is the SECOND change to the heatmap's color mechanism and read the existing p25-flag-vs-
color-domain disambiguation note before writing, so a future session doesn't read it as a
conflict).
```

---

## Recorded decisions (so they are not re-litigated)

- **No LOS convolution in the core grid, ever** — see the governing premise above.
- **No rework/degradation term in the backlog model** — real but second-order, declined in
  PR B.
- **flexMenu candidates stay on one-shot `solveShiftFit`**, not the relaxation loop; the
  current menu is solved one-shot too for comparison fairness (PR C, change 5). This closes
  the open question flagged in engine-solver.md.
- **No role-level skill-mix modeling** — one setup question plus an uplift percentage
  (PR D, change 7).
- **No discrete-event simulation.** Everything above is arithmetic over curves the engine
  already computes.
