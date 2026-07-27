# Phase 2 spec: variance-aware demand + true backlog feedback loop

Planned in Cowork 2026-07-25, to be implemented in Claude Code **after** the Phase 1
backlog-aware trim build (joint whole-week trim minimizing total backlog-hours, band floor
as a large-finite-cost guardrail, peak-backlog tie-break) has landed and been tested —
regardless of what Phase 1's results look like. This file is the durable record of what
Phase 2 is and why, so a cold Claude Code session has full context without re-deriving it.

Two independent problems, bundled here because they were diagnosed together, but sequenced
and built as two separate pieces of work:

- **2a — mean-arrival trap.** The engine sizes everything off a pure hourly mean
  (`arrivals: number[168]`), so any hour with real variance around that mean is understaffed
  roughly half the time by construction. Backlog math (Phase 1 or 2b) only handles what
  happens *after* a shortfall — it doesn't reduce how often shortfalls happen in the first
  place. Only a variance signal fixes that.
- **2b — backlog doesn't feed back into demand.** Phase 1 uses backlog only as a *cost
  signal* for choosing which hours to cut from an already-fixed budget — it never actually
  asks for more capacity at the hours that need to drain a queue. The original intuition
  (arrivals + decayed backlog = effective demand, decay because staff can absorb some of a
  shortfall through working harder rather than carrying the full patient-load forward) needs
  to actually reach the requirement curve, not just the trim's cut-selection.

---

## 2a. Percentile-informed arrivals buffer

**New optional input:** `arrivalsP75: number[168]` (naming TBD at implementation time —
could generalize to a configurable percentile later, but ship p75 first). All-or-nothing
optional, same convention as ESI mix / boarding-seasonality means (`template-parsing.md`'s
all-or-nothing rule) — a partially-filled column is treated as fully absent, not
partially applied.

**Where it lives:** a new optional column on the existing **Arrivals** tab of the
consolidated template (`lib/template.ts`), alongside `Average Arrivals` — NOT a new tab.
This matches the "one consolidated template" rule (`.claude/rules/template-parsing.md`) —
don't add a 5th tab for one more optional column when the existing Arrivals tab already
carries `Day`/`Hour`/`Average Arrivals`. Header alias table extension in `parseUpload.ts`
(`HEADER_ALIASES`), same tolerant matching philosophy as everything else in that file.

**Policy decision on how it's used — resolved here, don't re-litigate at implementation
time:** p75 arrivals do **NOT** touch `annualVisits`, `annualCoreRnHoursBudget`, or
`hourlyRequirement`. Those stay exactly as they are today, derived from mean arrivals only.
This is deliberate: it keeps the reconciliation invariant (`reconcile.test.ts` — the grid
must sum to the annual budget exactly) completely untouched, and keeps wHPPV's own
definition (nurse-hours per average visit) intact — don't redefine wHPPV against a buffered
number.

Instead, p75 arrivals feed a **new derived curve**, working name `demandVolatilityHourly
[168]` — a per-cell measure of how much a cell's p75 exceeds its mean (e.g. `(p75[cell] -
mean[cell]) / mean[cell]`, a coefficient-of-variation-style proxy; exact formula is an
implementation-time detail, not a policy call worth pre-deciding here). This curve is used
in exactly one place: **it raises `bandFloorHourly` at high-volatility hours** (the same
curve Phase 1's trim guardrail already reads) — a cell with high p75-vs-mean spread becomes
more expensive/protected to cut into during trim than a low-variance cell requiring the same
raw headcount, even though the point-target requirement is unchanged for both. Do NOT
conflate this with the *existing* `bandFloorHourly` derivation (which comes from
`lookupWhppvBand`'s cohort-wide p25/p75 **wHPPV** benchmark — a completely different data
source, someone else's EDs, not this ED's own hourly variance). Both end up composing into
the same `bandFloorHourly` curve, but from two independent signals — keep the derivation
functions separate (e.g. `deriveCohortBandFloor` + `applyVolatilityBuffer`), don't merge
them into one opaque function.

**Why this design, not the alternatives:** replacing the mean with p75 outright was
rejected — too conservative, and breaks wHPPV's own definition. Blending mean and p75
directly into the point target was also rejected — it would silently inflate the annual
budget derivation and break reconciliation. Feeding it into the floor only is the version
that's both correct (it changes *where* the fixed budget gets protected, not *how much*
budget there is) and cheap to build (reuses the exact `bandFloorHourly` consumer Phase 1
already wired through the trim).

**Also feed into Phase 1's backlog-cost objective:** once `demandVolatilityHourly` exists, a
cut at a high-volatility hour should carry a higher marginal-backlog-cost than the same raw
cut at a low-volatility hour, since it's more likely to actually manifest as real backlog in
practice (the mean-only backlog cost function can't see this on its own). Implementation
detail (a multiplier on the marginal cost, most likely), not a new formula from scratch —
sequence this after Phase 1's trim exists so it's a genuine extension, not a rewrite.

---

## 2b. True backlog-feedback loop (effective workload → demand)

**The gap this closes:** Phase 1 treats `hourlyRequirement` as fixed and only changes which
hours trim chooses to cut, using backlog as a selection criterion. It never actually asks
for *more* capacity at hours following a shortfall. This phase makes the requirement curve
itself backlog-aware: effective demand at hour *h* = that hour's own demand **plus decayed
backlog carried in from h-1** (same 0.85/hr decay Phase 1 and the existing diagnostic both
use — decay representing that staff can absorb part of a shortfall through working harder,
not a literal 1:1 patient carryover; this was confirmed as the right modeling choice, don't
switch to a literal queueing-capacity-only drain model).

**The hard part, and why it can't be a one-pass formula:** effective demand at hour h
depends on backlog at h-1, which depends on whether h-1 was adequately staffed, which was
itself a solver decision made using whatever effective demand existed for h-1. This is
circular — it requires an **iterative relaxation**, not a closed-form curve:

1. Run the full Phase 1 pipeline once (full-coverage solve → whole-week backlog-cost trim →
   ENA floor) to get a baseline grid.
2. Compute backlog on that grid (`computeBacklog`, unchanged).
3. Wherever inherited backlog at an hour exceeds a materiality threshold (reuse
   `BACKLOG_CAUGHT_UP_THRESHOLD`), locally raise that hour's *protected floor* (not the
   global annual budget) by the decayed backlog amount for the next pass.
4. Re-run the trim step (not the full pipeline — same total annual budget, same candidates)
   against the updated floors. Because the total budget is fixed, the trim has to find
   offsetting cuts elsewhere — and because it's still minimizing total backlog-hours, it
   should naturally prefer taking those offsetting cuts from hours that don't themselves
   compound into new backlog.
5. Repeat until either the total backlog-hours metric stops improving, or a fixed iteration
   cap is hit (starting point: 6-10 passes — cheap at 168-hour scale). Track total
   backlog-hours at every pass and **return the best pass seen, not necessarily the last**
   — this is a relaxation, not a provably-convergent fixed point, and a safety net against
   oscillation (pass N's fix undoing pass N-1's fix) is cheap insurance.

**This resolves the budget-tension explicitly, in favor of keeping the budget fixed:** the
annual hours total stays exactly what `wHppvTarget` implies (same reconciliation invariant
as always) — what changes is the internal distribution, which now actively trades hours
from elsewhere in the week to boost hours that are draining a queue, rather than only
avoiding hours that would create one. If a future session or Ben decides the budget itself
should be allowed to flex upward in a chronically-backlogged week, that's a DIFFERENT,
bigger decision (breaks the reconciliation invariant on purpose) — don't make that call
silently inside this phase; it needs its own explicit sign-off if it ever comes up.

**New diagnostics to expose, not just internal state:** how many relaxation passes ran and
whether the metric was still improving when the cap was hit (a chronically-backlogged
scenario that never converges in the pass budget is itself a signal worth surfacing to the
manager, not silently swallowing it into whatever the last pass produced).

**Test priorities:** a synthetic chronic-shortfall scenario (verify the loop actually moves
hours toward the backlog-generating period across passes, and that total budget is
unchanged before/after); a near-budget-exhausted scenario (verify the floor-as-large-cost
guardrail from Phase 1 still holds under the added pressure of locally-raised floors); an
oscillation case if one can be constructed (verify the best-pass-wins safety net actually
fires); reconciliation still exact.

---

## Sequencing

Build 2a before 2b. It's smaller, independently valuable, lower-risk, and it changes the
same `bandFloorHourly` curve that 2b's inner relaxation loop already depends on — so 2b
should be built against the *volatility-aware* floor, not the cohort-only one, to avoid
redoing 2b's tuning once 2a lands. Both phases assume Phase 1 (currently building) is
already merged and its tests are green.
