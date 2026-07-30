# Backlog model rewrite — visits-based, stretch-to-peer-floor — 2026-07-28

Governing chat: the same Panel 1 copy-editing planning conversation that produced
`PANEL1_COPY_REVISION_SPEC_2026-07-28.md`. While working through that panel's queue-strip
copy, Ben identified a real flaw in the current backlog recurrence (the 2026-07-28
"capacity-elasticity" model documented in `.claude/rules/engine-solver.md`'s dated section)
and designed a replacement directly with him. **This is a separate, bigger, higher-stakes
change than the Panel 1 copy pass — read this file in full before touching anything.**

## Why the current model is wrong, precisely

The current recurrence (`engine/backlogModel.ts`) defines a "stretch" term as the gap between
a peer-benchmark ceiling and actual capacity: `stretch[h] = max(0, bandCeilingHourly[h] -
capacity[h])`. This is largest exactly when capacity is lowest — meaning the worse an hour is
staffed, the more backlog-clearing throughput the model assumes is available. That's
backwards: a badly understaffed hour's nurses are already consumed handling that hour's own
arrivals; the gap to a peer ceiling represents "how many more nurses a busy peer department
would have staffed," not "how much harder your actual on-duty nurses can work." The model
conflates having more staff with the staff you have working harder — those aren't the same
thing, and the old formula credits large paydown regardless of whether there's any real slack
left after covering the current hour's own demand. This produced exactly the artifact Ben
caught looking at a real department's Panel 1: a queue strip claiming to clear by 19:00 while
the heatmap read red (understaffed vs. peer band) continuously from 08:00 onward.

## The replacement model, agreed with Ben

**Core idea:** nurses can compress how much time they spend per patient, down to — but never
past — the worst pace still considered acceptable for a department of this volume, which is
this department's own peer-cohort **p25 wHPPV** (the SAME flat number that already drives the
"below/within/above the typical range" headline stat, from `lookupWhppvBand(annualVisits)
.p25Whppv`). That's the ceiling on how fast anyone can defensibly go. Beyond that pace, extra
patients simply don't get adequately seen that hour and become unmet demand carried into the
next hour.

**Use the FLAT department-level p25 number, not an hour-specific band.** This was discussed
directly with Ben — the existing per-hour band curve (`bandFloorHourly`) isn't actually a
peer number measured hour by hour; it's the same flat p25 number reallocated across hours the
same way the point-target budget is reallocated into `hourlyRequirement`, plus a separate
volatility nudge based on this department's own arrival pattern. Ben confirmed: for this
specific piece of math, use the single flat p25 value uniformly across all 168 hours. The
whole backlog model is explicitly a projection meant to capture the *relative shape* of a
schedule's shortfall, not to precisely match real-world wait times — a simpler, more legible
number is the right tradeoff here, not a more "precise"-looking one that's harder to explain.

**The recurrence, in visits (not nurse-hours):**

```
floorWhppv = lookupWhppvBand(annualVisits).p25Whppv   // one flat number, computed once

demand[h]        = arrivals[h] + backlogVisits[h-1]        // new arrivals PLUS carried-over unseen visits
maxServable[h]    = capacity[h] / floorWhppv                // most visits this hour's staffed nurse-hours
                                                              // can defensibly get through, fully stretched
served[h]         = min(demand[h], maxServable[h])
backlogVisits[h]  = demand[h] - served[h]                    // always >= 0 by construction
```

Circular over the full 168-hour week, same convention every other recurrence in this codebase
uses (no week-boundary reset — settle the wraparound with a multi-pass warm start the same
way `backlogModel.ts`'s existing recurrence does before reporting the first pass's values).

**What this replaces the old spare/stretch/paydown split with:** nothing extra is needed.
There's no separate "surplus pays down backlog at some rate" rule to invent — it falls out of
the `min()` naturally. If `capacity[h]` is generous enough that `maxServable[h] >= demand[h]`,
everything gets seen and backlog clears to exactly zero that hour, without ever needing to
invoke the full-stretch pace. If it's not enough even at full stretch, backlog carries forward,
compounding with next hour's own arrivals. This is a genuine simplification over the current
three-term formula, not just a different set of constants.

**What does NOT change:** `hourlyRequirement`, `annualCoreRnHoursBudget`, and everything the
solver designs the recommended/ideal grid toward are UNCHANGED — those still target the user's
stated wHPPV target, exactly as today. This rewrite only changes how backlog/queue REALISM is
modeled for a given, already-solved grid (current staffing, the recommendation, a sandbox
scenario, or a candidate the solver is scoring mid-trim) — it does not change what grid gets
recommended in terms of its point-target sizing. Do not let this bleed into changing
`hourlyRequirement` or the annual budget math; if something seems to require that, stop and
ask rather than assume it's in scope.

## Where this needs to land — this is genuinely engine-wide, not Panel-1-scoped

The current recurrence (`backlogModel.ts`'s `backlogHourStep`/`backlogRecurrence`) is consumed
far beyond a single display: `engine/backlog.ts`'s `computeBacklog` (the general diagnostic,
including the structural/cyclical split), `engine/solver.ts`'s `candidateCutCost`/
`trimWeekToBudget*` (the actual solver's cost function — this recurrence is what decides which
hours get cut when fitting a schedule to budget), `engine/backlogFeedback.ts`'s relaxation
loop, and `engine/sandbox.ts`'s what-if model. **All of these need to move to the new
recurrence**, not just Panel 1's queue strip — read every one of these files' current
signatures before starting, since several currently take a `bandCeilingHourly168` parameter
that this new model has no use for (it needs `arrivals168` and the single flat `floorWhppv`
value instead).

## Open integration questions — flag these back rather than silently resolving

This is more load-bearing than the Panel 1 copy pass, so the bar for stopping and asking
should be lower here. In particular:

1. **Units.** The new recurrence produces backlog in unseen VISITS. Existing consumers
   (`peakBacklog`, `longestStreakHours`, the severity objective the solver minimizes, the
   structural/cyclical split) currently expect nurse-hours. The likely clean bridge is
   converting back with the same flat rate (`unseenVisits × floorWhppv` = nurse-hour
   equivalent) wherever a downstream consumer needs hours, while the recurrence itself stays
   in visits internally. Implement that if it holds up cleanly — but if any specific consumer
   (especially the solver's `severity`/convexity objective, which is normalized by
   `hourlyRequirement`) doesn't have an obvious, honest way to consume a visits-based curve,
   stop and describe the specific mismatch rather than forcing a conversion that changes what
   that consumer is actually measuring. Ben has explicitly deferred the *displayed* unit
   question (visits vs. hours) on Panel 1 until this formula is working — don't let that
   deferred decision block finishing this engine change, just don't over-commit the display
   layer either.
2. **The structural/cyclical split.** The existing model isolates "shape" from "size" by
   rescaling capacity so its weekly total matches requirement's own total, then re-running the
   recurrence. Think through whether that rescaling concept still makes sense against a
   `min(demand, capacity/floorWhppv)`-shaped recurrence (it's no longer a simple additive
   deficit/spare/stretch decomposition) — if it doesn't translate cleanly, describe the
   mismatch and propose an option rather than picking one silently.
3. **The solver's cost function.** `candidateCutCost` currently scores candidate cuts by
   simulating a bounded window of this recurrence and measuring the severity delta. Confirm
   this still produces sensible, non-degenerate cut choices once the recurrence is
   visits-based rather than hours-based, and flag anything that looks off rather than assuming
   it's fine because the code runs without errors.

## Verification

- Full test suite (`npm test`, `npm run build`, `oxlint`, `npm run test:e2e`) — expect
  significant rewrites across `backlogModel.test.ts`, `backlog.test.ts`, `solver.test.ts`,
  `backlogFeedback.test.ts`, `sandbox.test.ts`, and the synthetic fixture sweep, the same way
  every prior backlog-model reversal in this codebase's history required a full test rewrite,
  not incremental patches.
- `reconcile.test.ts` must still pass with a zero-line diff — this recurrence has never
  touched `annualCoreRnHoursBudget`/`hourlyRequirement`/reconciliation, and this rewrite must
  not be the first time it does.
- A real numeric sanity check against the actual scenario that surfaced this bug: pull a
  representative department (an understaffed daytime stretch followed by a much better-staffed
  evening/night shift) and confirm the new recurrence's queue-clear timing now lines up with
  the heatmap's red/blue coloring in a way a reader would find intuitive — i.e., the two
  displays should no longer visibly contradict each other the way they did before this fix.
- Update `.claude/rules/engine-solver.md` with a new dated section recording this as the ninth
  shape of the backlog-recurrence history, following that file's own established convention —
  include the "why the old model was wrong" reasoning above so a future session doesn't
  accidentally reintroduce the ceiling-gap definition of stretch.

## Sequencing relative to the Panel 1 copy spec

Implement this backlog-model rewrite first, or at minimum before finalizing anything in
`PANEL1_COPY_REVISION_SPEC_2026-07-28.md` section 5 (the queue section) — that section's
copy describes behavior of the OLD recurrence and will need its example numbers/behavior
re-checked against the new model's actual output once this lands. The rest of that spec
(sections 1-4, 6-8) is independent and can proceed in either order.
