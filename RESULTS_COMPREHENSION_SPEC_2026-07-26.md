# ShiftLens — Results Comprehension Spec (2026-07-26)

Governing spec for PRs **E–K**, following `SOLVER_REALISM_SPEC_2026-07-26.md` (PRs A–D).

Where A–D made the *solver* more honest, E–K make the *page* answer a question.

**Revision note (2026-07-26, after running Ben's own department data through the engine and
four goal-clarifying decisions with Ben).** An earlier draft of this spec organized the page
around three scenarios and treated the core grid's night-cutting as a defect to be reconciled
away. Both were wrong. The page is organized around a **question**, and the arrivals/boarding
separation is the product's thesis, not a bug. See §1 and §6.

---

## 1. The founding question — and the four decisions that shape everything below

**Ben's own words, and the tool's actual job:**

> *"Is my department truly understaffed (because it feels like it is most days), or are our
> workflows inefficient? ... It is 'understanding' — getting a handle on your department's
> nurse staffing, in order to then make the changes that need making, whether that's
> re-allocation, improving workflows, or requesting more staff."*

This is not a scenario browser, a budget calculator, or a benchmarking dashboard. It is a
**diagnostic that hands its user understanding.** The page's job is to take a manager who
*feels* understaffed and give them a defensible answer to whether they are — and if so,
where, and how much of it they could fix themselves.

Four decisions, confirmed with Ben, that the rest of this spec resolves toward:

**(1) Primary user: the ED nurse manager / director.** They own the schedule and have to
justify it upward. When any design choice conflicts, optimize for them. Executives are the
audience for the *export* (§9), not the page.

**(2) The job is understanding, not verdict-delivery.** The reader must leave able to explain
their own staffing to someone else, in their own words. See §0-test below.

**(3) Advocacy stance — Socratic, not neutral, not preachy.** Ben:

> *"I don't think people will trust a computer that tells them the verdict even with a why.
> I want it to use numbers and the narrative sentences to get people to reach the verdict
> themselves."*

This is a real design constraint with teeth. **Sequence the evidence so the conclusion becomes
unavoidable, then let the reader say it.** The page never writes "you are understaffed." It
writes the four sentences that make the reader say it out loud — and then gives them those
sentences to forward. This is *stronger* than a verdict, not weaker: a conclusion the reader
reached is one they'll defend in a budget meeting; a conclusion the tool announced is one
they'll have to defend *the tool* for.

Practically: headlines state **what is measured** and **what it implies**, never **what to
do**. "Your days run 229 hours a week short of what arrivals alone justify" — not "you should
add day staff."

**(4) Boarding is budgeted separately and additively, on purpose — that is the thesis.**
Ben:

> *"Boarding is part of why our nursing is so poorly allocated — since those boarders are
> there overnight we need more nurses. But I want it separated out so we think about it as
> staffing for different things, and then we need to bring them together in a final summary."*

and:

> *"We need nursing leaders to understand that they are hurting the days by staffing for
> boarding overnight, and be able to advocate off of that."*

This is the philosophy the underlying budgeting-for-boarding work recommends, and it is what
makes ShiftLens different from a scheduling tool. See §6, which is the most important section
of this spec.

**(5) The page states findings. It does not build an argument.** Ben, correcting an earlier
draft of this spec:

> *"I don't want the idea of building a narrative on the results page to make the tool
> basically single-use. It's better for there to be more work left for the reader to do than
> to have the tool overcommitted to a pre-built argument. The tool is not AI — it can't
> actually perform the analytical work anew every time."*

This is the governing constraint on everything the page says, and an earlier draft violated
it. ShiftLens renders **templates**. A template that editorializes is a template that will be
confidently wrong for the first department whose shape it didn't anticipate — and being
confidently wrong once costs more trust than being modest a hundred times.

The operative rule:

> **Templates state findings. Only arithmetic composes them.**

- Every sentence must be **true on its own**, without depending on any other section's
  outcome. If a sentence would need rewriting because a *different* chapter's number changed,
  it is an argument, not a finding — cut it.
- The **order** of questions may be deliberate. The **conclusion** may not be pre-written.
  Sequencing what gets asked is design; sequencing what gets concluded is overreach.
- **Ban the "therefore" class of sentence.** No copy that says or implies *and so this means…*
  Subtraction is allowed; inference is the reader's.
- When in doubt, **show the number and stop.** Leaving the last step to the reader is the
  cheap, robust, honest option — and per decision (3) it is also the persuasive one. These
  two constraints point the same way, which is a good sign both are right.

An earlier draft of §7 ended the synthesis with *"the rest is not a scheduling problem."* That
sentence is exactly the failure mode: it presumes reallocation was tried and found wanting,
and it is simply false for a department that is adequately staffed and merely misallocated
(profile B, §12.2). It has been cut. See §7.

### The §0 test

> A nurse manager with no statistics background reads this page once, and afterward can
> explain to their CNO — **in their own words, without the tool open** — whether their
> department is understaffed, where, how much of it they can fix themselves, and what the
> rest would cost.

**Corollary (why §8 exists):** the same page must survive an analyst opening the hood. Not in
tension — a model explicable to a manager *because* its mechanics are defensible is the same
model an analyst signs off on. A page that can only do one is hiding something.

---

## 2. What's wrong today

From Ben's read-through, plus what running his data surfaced. Grouped by severity.

**Fails the founding question**
1. The page never asks or answers "understaffed or misallocated?" It presents a recommended
   grid and a funding ask. A reader can finish it without knowing which of the two they have.
2. **No budget-neutral scenario.** The only change a manager can make unilaterally, this
   week, with no ask — and the tool can't compute it. (§5)
3. **No synthesis.** Arrivals staffing and boarding staffing are never added together, so the
   reader never sees total demand vs. total staff — the actual answer to their question. (§7)
4. **The separate-budget philosophy is never stated**, so the reader hits the comparison grid,
   sees the tool cutting their nights, and concludes the tool doesn't understand their
   department. It's the correct output of a deliberate design, presented as if it were a
   neutral recommendation. (§6)

**Trust / correctness**
5. Backlog never clears — but the department *does* feel caught up overnight. Investigated
   against Ben's real data: **his intuition is right, the model already agrees with him, and
   the page throws the evidence away.** (§4)
6. The wHPPV-target-derived hours are called "the budget" and "% over budget" is reported
   against them. False. The budget is what the department is funded for today. (§3)
7. **The target-implied figure is not achievable and this is never said.** Ben's target
   implies 1,509 hrs/wk; per-hour integer rounding takes it to 1,592; 12-hour shift blocks
   take it to 1,656. The page presents 1,656 as "what the target implies" and separately
   reports 9.8% "overcoverage" as if it were a choice. (§3)
8. **Silent input inconsistency.** Ben's Scalars tab says mean boarding duration 10.02 hrs;
   his monthly means average 6.36. The engine ratios them, quietly scaling his boarding
   estimate down **37%** (17,823 hrs/yr shown; ~28,100 implied by the scalar). No warning.
   His ESI Mix tab is entirely blank, so acuity weighting is silently off. (§10)
9. **The funding ask anchors on the wrong number** — full coverage, +14.9 FTE for Ben. That is
   an unsellable figure that buries the +2.7 FTE which captures most of the benefit. (§7)

**Comprehension / structure**
10. Scrolling has broken down; no wayfinding. (§8)
11. No surface for an analyst to check the math. (§8)
12. Redundant arrivals-premise explainer at top. (§8)
13. ASSUMPTION pill is noise — always on, therefore carries no information. (§8)
14. Realized-wHPPV range computed per **day**; should be per **hour**. (§8)
15. Boarding methodology copy dwells on what's *derived* instead of naming the better data to
    go get. (§10)

**Output**
16. No export. (§9)

---

## 3. Framing: "budget" means the hours you are funded for

Four quantities are conflated under one word today. Separated permanently:

| Quantity | Ben's data | What it is | UI name |
|---|---|---|---|
| Hours funded today | 1,548 /wk | The actual constraint | **"your current staffed hours"** |
| Hours the target implies | 1,509 /wk | A benchmark-derived target | **"target-implied hours"** |
| Hours to *deliver* that target | 1,656 /wk | Target + rounding + shift blocks | **"what delivering it costs"** |
| Hours to never be short | 2,256 /wk | Upper bound | **"full-coverage hours"** |

Rules:

- **Never call the target-derived figure a budget in the UI.** Engine field names stay
  (renaming `annualCoreRnHoursBudget` churns the reconciliation vocabulary for no user-visible
  gain). Copy-layer rule, enforced by a source-grep test over `src/screens/` and
  `src/components/`.
- **Overcoverage and any "% over" is computed against current staffed hours**, with
  target-implied hours as a labelled second reference. No current staffing → **suppress the
  stat**; do not silently fall back to the target. A percentage against an unstated
  denominator is the defect.
- **Disclose the delivery premium** (row 3 minus row 2 — 147 hrs/wk, 3.7 FTE for Ben) as its
  own named line: *"whole nurses and 12-hour blocks cost 147 hours a week more than the
  target's arithmetic implies."* Today this is silently reported as 9.8% "overcoverage,"
  which reads like waste. It isn't waste; it's granularity, and it's unavoidable given the
  shift menu. Naming it honestly also **makes the shift-menu chapter matter** — a different
  menu is the only lever that reduces it.

---

## 4. The backlog defect — resolved against real data

**Ben's intuition was right. The model already agrees with him. The reporting layer destroys
the evidence.** His current grid, run through `computeBacklog`:

| | Sun | Mon | Tue | Wed | Thu | Fri | Sat |
|---|---|---|---|---|---|---|---|
| **Daily trough** (always 07:00) | 7.8 | 13.3 | 14.1 | 13.6 | 9.2 | 6.3 | **2.7** |
| **Daily peak** (18:00–20:00) | 32.7 | 44.0 | 43.5 | 39.0 | 33.4 | 27.7 | 25.2 |

The queue drains overnight **every single night**, bottoming out at 07:00, then rebuilds
through the day. That is precisely what Ben described. The page reports
`neverClears: true` and "168 of 168 hours behind" — throwing away a 41-nurse-hour cyclical
swing and a structural floor that ranges from 2.7 (Saturday) to 14.1 (Tuesday).

**Root cause is reporting plus threshold, not physics.** Three contributing factors, in order:

**(a) One number where there are two.** Report **structural** (the floor the week never drops
below — a *budget* signal) and **cyclical** (the build-and-drain swing — a *shape* signal)
separately, never summed. Cyclical is what "we feel caught up" tracks. Structural is what
"you start Tuesday already 14 nurse-hours behind" tracks — and *that* sentence is far better
advocacy than "you're always behind."

Compute cyclical against capacity **rescaled to the grid's own total scheduled hours**, so it
asks "is my shape wrong?" independent of "is my size wrong?" The trim allocates a *fixed*
budget, so its objective should be shape-sensitive and size-blind — otherwise it spends its
effort on a problem it cannot solve.

**(b) `BACKLOG_CAUGHT_UP_THRESHOLD = 0.5` is absolute and now far too small.** Unchanged since
the old model, when peaks were small. Against Ben's peak of 44, a queue that has cleared 98%
still reads "behind." Make it relative to that hour's own requirement (proposed 10%, tunable
display heuristic). Scales across department sizes, which 0.5 never did.

**(c) `maxDrainFraction = 0.3` is nearly inert.** `paydown = min(carried, spare × 0.6,
carried × 0.3)`; the `spare × 0.6` term binds until spare exceeds ~6 nurses above requirement
in one hour, which a solved grid essentially never has — the trim removes exactly that spare.
`recoveryEfficiency` is the operative limiter. PR B's physics rationale for the drain cap is
sound; its *calibration* makes it unreachable. **Report this before tuning it.**

**(d) Make `abandonRate` measurable.** New optional setup field: the department's own LWBS
rate. Derive `abandonRate` from it; absent → current default, labelled a cohort assumption
rather than their number. This converts the model's weakest guess into its only calibration
anchor. *(Open: confirm a manager can pull this easily — §12.)*

**(e) Free output, already computed and discarded:** `abandonRate × carried[h]` summed over
the week is the model's own estimate of nursing work that left. Surface as
`EngineResult.estimatedAbandonedHours`, per scenario. Denominated in something a CNO already
tracks, comparable across scenarios, and calibratable once (d) lands. Tag honestly: work
abandoned, not a patient count. **Never a dollar figure** (§11).

**Validation gate — PR E is not done until this passes.** Ben's data must reproduce: cyclical
backlog clearing overnight, structural floor separately reported at roughly 2.7–14.1 across
the week, and no "neverClears" claim. Report the numbers; don't tune until green.

---

## 5. Scenario B — "the same hours, better placed"

The only scenario with no ask attached. A manager can act on it Monday without permission,
and the tool cannot currently compute it.

**Ben's data, arrivals-only basis:**

| Scenario | Hrs/wk | FTE | Total severity | Peak backlog |
|---|---|---|---|---|
| A — today | 1,548 | 38.7 | 1,296 | 44.0 |
| **B — same hours, reallocated** | **1,548** | **38.7** | **865 (−33%)** | 25.2 |
| C — delivering the target | 1,656 | 41.4 | 158 (−88%) | 13.3 |

Mechanically a **parameter swap, not new solver logic**: run the existing pipeline with
`weeklyBudgetHours` = the current grid's own weekly scheduled hours, holding
`hourlyRequirement`, `protectedFloorHourly`, the ENA floor, and the shift menu fixed. Do not
write a second solver.

**Scenario B is computed on the arrivals budget only — and must say so, loudly.** For Ben it
moves ~168 hrs/wk off nights onto days. Against arrivals alone that is correct and is worth a
third of his queued work for free. Against *boarding*, most of those night hours are doing
real work (§6). **B is therefore presented as "what arrivals alone would justify," explicitly
bounded, with the boarding reconciliation in §7 as a required continuation — never as a
standalone recommendation to act on.** A manager who acted on B without reading §6–7 would
hurt their department, and the page is responsible for making that impossible.

Edge cases, handled explicitly, never silently:
- No current staffing → CTA, not a scenario.
- Current hours ≥ full-coverage hours → B *is* full coverage. Say so plainly ("you already
  fund enough hours to never be short — shape is the entire problem"). A great result; must
  not read as an error.
- Current hours below what the ENA floor requires → the floor pass pushes B above current
  hours. Report the overage; don't call it budget-neutral when it isn't.
- Already near-optimal → say so and mean it. A tool that always finds a problem stops being
  believed.

---

## 6. The separate-budget thesis, and the hidden-boarding diagnostic

**The most important section of this spec.** It is what makes ShiftLens a point of view rather
than a scheduler.

### 6.1 State the philosophy up front, before the first grid

ShiftLens budgets **arrivals** and **boarding** as two separate demands on the same nurses,
deliberately and additively. A reader who doesn't know this hits the comparison grid, sees the
tool cutting their nights, and concludes it doesn't understand their department — and they
stop trusting everything downstream.

So, near the top (Chapter 1), in plain language and *before* any recommendation:

> ShiftLens budgets your department twice: once for the patients who arrive, and once for
> the patients who stay. Your current schedule almost certainly blends the two — most do.
> Where the numbers below look like they're cutting your nights, that's the arrivals budget
> alone talking. Boarding gets its own budget further down, and we add them back together at
> the end.

This is an **expectation-setter, not a disclaimer**. It converts the page's most confusing
moment into its most credible one — the tool predicted, in advance, the exact objection the
reader was about to raise.

### 6.2 The hidden-boarding diagnostic — the advocacy artifact

Ben: *"we need nursing leaders to understand that they are hurting the days by staffing for
boarding overnight, and be able to advocate off of that."*

That requires a number. Compute it. **New engine output:** per hour-block, current capacity
minus arrivals-only requirement — the staffing that exists for something other than arrivals.

**Ben's department:**

| | Arrivals need | Boarding need | Total need | Staffed | vs. arrivals alone |
|---|---|---|---|---|---|
| Day (07–19) | 1,025 | 258 | 1,283 | 796 | **−229** |
| Night (19–07) | 567 | 283 | 850 | 752 | **+185** |

Boarding is **52% nocturnal**; arrivals demand is only **36%**. Boarding is exactly what makes
nights genuinely need staff.

The templated narrative — three sentences, each quotable standalone, none of which states a
verdict:

> Your nights carry **185 hours a week beyond what arrivals justify**. That isn't
> overstaffing — it's boarding, absorbed into a budget that was never sized for it, and it
> isn't even enough (boarding needs 283 hours at night). Your days run **229 hours a week
> short** of what arrivals alone justify.

The reader draws the conclusion. That is the §1(3) stance working exactly as intended: the two
numbers nearly offset, and no one has to be told what that means.

### 6.3 Boarding keeps its own chapter, at the bottom, additive

Unchanged from Ben's instruction — *"I like the clean to arrivals start up top."* The boarding
chapter is its own budget, computed and presented on its own terms, never blended into
`EngineResult.grid` (that constraint survives from the original design and is not revisited).

**New, per Ben:** a **constrained boarding reallocation** at the end of the boarding chapter —
*"if you can't get additional hours for boarding, here is the least-bad placement of what you
already have."* Same parameter-swap technique as §5, run against combined arrivals+boarding
demand at current total hours. Presented as a **compromise with its cost named**, never as the
recommendation: it necessarily takes from arrivals coverage to cover boarders, and the page
must show what that costs on the arrivals side. This is the honest version of what most
departments are already doing by accident — which is precisely why seeing it costed is
persuasive.

---

## 7. The synthesis chapter — where the founding question gets answered

Ben: *"we need to bring them together in a final summary in some way."* This chapter does not
exist today and is the reason a reader can finish the page without an answer.

**Total demand vs. total staff**, arrivals and boarding added back together, by hour block:

> Between arrivals and boarding, your department needs about **2,133 nurse-hours a week**.
> You staff **1,548**. The difference is **585 hours — 14.6 FTE** — and **83% of it falls
> between 07:00 and 19:00**. Placing your existing hours as well as possible closes **185** of
> those 585.

**Then stop.** Four numbers and a subtraction the reader can check on paper. No closing line
telling them what it means.

Per §1(5): an earlier draft ended this with *"the rest is not a scheduling problem,"* which
was called out as exactly the overcommitment to avoid — it presumes a residual exists at all,
and is false for a department that is adequately staffed and merely misallocated. The
arithmetic already carries the point for every profile in §12.2 without a single sentence
needing to change: when reallocation closes most of the gap, the numbers say so; when it
closes little, the numbers say that instead. The template does not know which happened, and
does not need to.

Then, and only then, the ask. **Reframe the funding ask away from full coverage.** For Ben the
page currently leads with +14.9 FTE (full coverage), which is unsellable and buries the +2.7
FTE that captures most of the available benefit. Lead with the **knee of the marginal curve**
— the ask that buys the most per FTE — and show full coverage as the far end of a range, not
the headline.

**"Do the extra hours pay for themselves?"** — three parts, and the page gives all three:

1. **What the tool can show:** the mechanism chain in its own units — more hours at the right
   times → less queued work → fewer abandoned nurse-hours (§4e) → fewer LWBS. Every link is a
   number the page has or gains in PR E.
2. **What it deliberately won't do:** convert that to dollars. No salary, benefit-factor, or
   per-visit margin inputs are collected, and a fabricated ROI is the first thing a finance
   partner attacks — losing that exchange costs the manager the entire argument.
3. **The finance-partner worksheet.** State the FTE ask and the modeled reduction in abandoned
   nurse-hours; name the three numbers *their* finance partner already owns — cost per FTE,
   contribution margin per treated visit, current LWBS rate — that turn it into a dollar
   figure. Framed as *"take these two numbers to your CFO and ask them for those three."*
   Unattackable, uses their assumptions, and starts the conversation with the person who
   controls the money.

---

## 8. Page architecture — chapters that follow the argument

Sticky chapter rail (left on desktop), scroll-spy, click-to-jump; single narrative scroll
preserved.

**Chapter order is a sequence of questions, not a chain of reasoning** (§1(5)). Each chapter
asks one thing and answers it with a number and a plain sentence that stands on its own. No
chapter's copy references another's outcome, and none of them knows where the reader will
land. A logical order of inquiry generalizes to any department; a pre-built argument does not:

| # | Chapter | The question it closes |
|---|---|---|
| 1 | **The question, and how we'll answer it** | What are we measuring, and what's the arrivals/boarding split? (§6.1) |
| 2 | **What your department demands** | How much nursing do your arrivals actually generate? |
| 3 | **What you staff against it** | Where does today's schedule sit against that demand? |
| 4 | **Could moving hours fix it?** | Is this a shape problem? *(Scenario B, §5)* |
| 5 | **What's left after moving them** | What isn't a shape problem? |
| 6 | **The second demand: boarding** | What else is consuming these nurses? *(§6.3)* |
| 7 | **Both budgets together** | **The answer.** *(§7)* |
| 8 | **Would a different shift pattern help?** | *(side quest — also where the §3 delivery premium gets reduced)* |
| 9 | **How this works** | *(evidence — analyst surface)* |

Chapter 8–9 visually set apart as branches. The chapter list is the export's slide-section
list (§9) — one source of truth.

**Chapter 9, the evidence surface.** Success condition: *an analyst can reconstruct the
pipeline from this page alone and find nothing undisclosed.*

1. Pipeline walkthrough — Steps 1/1b/1c/2/3, each with its formula and one sentence of why.
2. **Constants table generated from `DEFAULTS` at runtime, not transcribed.** Columns: name,
   value, what it controls, evidence tag, and the column nobody writes — *what changes if you
   move it.* Prose copies of constants drift; a generated table cannot.
3. **Data provenance** — every number classified *your data* / *peer cohort* / *modeled
   assumption*. This replaces the removed pills, and is more informative because comparative.
4. **Known approximations, stated plainly and without hedging.** At minimum: the 48-hour
   backlog simulation window under-counting marginal cost in chronic stretches; linear
   boarding recovery; month-scope conservation; circular no-reset; greedy set-cover rather
   than exact ILP; boarding census derived from admit timing rather than measured. A
   limitations list an analyst finds *complete* is worth more than one they find flattering.
5. **The reconciliation invariant** as the correctness proof it is.
6. **Decisions and their rejected alternatives** — sourced from `.claude/rules/`, which
   already records every one.

Also in this pass: remove the redundant arrivals-premise banner (its content moves to Ch. 1 as
part of §6.1); remove ASSUMPTION pills from results (provenance lives in Ch. 9 — `EvidenceBadge`
stays in *setup*, where optional-vs-required is real information); realized-wHPPV range across
the **168 hours** not the 7 days, naming the hours the extremes fall on.

### The teaching layer

Six concepts, each introduced **once**, at first point of use, in a `ConceptCallout` reusing
the existing `.why-toggle` disclosure idiom (do not invent a second one):

| Concept | Ch. | The one sentence |
|---|---|---|
| wHPPV | 2 | Nurse-hours per patient — the unit that lets you compare against other EDs. |
| Front-loaded nursing | 2 | The work lands at arrival, not at census peak — which is why demand peaks before the department *feels* busiest. |
| Averages under-staff you half the time | 2 | Staff to the average and, by construction, you're short on every busier-than-average day. |
| Right total ≠ right shape | 4 | Two schedules with identical hours can perform very differently. |
| Depth beats spread (convexity) | 4 | Being 4 short for one hour is worse than 1 short for four hours — which is why peaks get protected. |
| Two budgets, one department | 6 | Arrivals and boarding are different demands; blending them hides both. |

**One interactive, not six.** Convexity is the least intuitive and most load-bearing (it is
literally the solver's objective) and prose does it badly: a side-by-side of the same 10
nurse-hours of shortfall, spread vs. concentrated, with the real `severity` function's score
for each. Everything else stays text.

Guardrails: no glossary page (nobody reads one); collapsed by default so a returning user
isn't re-taught; every headline stays a **complete quotable sentence with numbers
interpolated** — the most effective teaching device already in the product, and what makes §9
nearly free.

---

## 9. Export to PPTX

**Prerequisite: extract every templated headline into `src/lib/narrative.ts`** — one pure
function per headline, page and deck both consuming it. Without this the deck is a second copy
of the copy and the two drift inside one PR.

- `pptxgenjs`, client-side. No backend; nothing uploaded.
- **Slide titles are the narrative sentences**, from `narrative.ts`: *"Your nights carry 185
  hours a week beyond what arrivals justify"* — never *"Boarding Analysis."* This is the
  entire point.
- Deck mirrors the chapter rail: title → demand → today's schedule against it → could moving
  hours fix it → what's left → boarding → **both budgets together** → the ask + finance-partner
  worksheet → method & limitations.
- **Method & limitations always included, never optional.** The deck that drops its
  limitations slide is the one that gets torn apart in the room.
- Grids/heatmaps as **native PPTX tables** with cell fills, not images — editable, and they
  survive being pasted into someone else's deck, which is where these slides actually end up.
- **Speaker notes carry the plain-English explanation**, from the same `ConceptCallout` text.
  The manager presenting has never given this talk before; the notes are what let them sound
  like they understand it. That is the §0 test.
- Skip boarding/shift-menu slides entirely when not computed — no empty placeholders.

---

## 10. Input integrity (new — PR K)

Ben's own upload silently produced wrong numbers in two ways. Neither was his fault and
neither was surfaced.

1. **Cross-field consistency check.** His Scalars mean boarding duration is 10.02 hrs; his
   monthly means average 6.36. The engine ratios them, scaling annual boarding **down 37%**
   (17,823 shown vs. ~28,100 implied by the scalar) with no warning. When the monthly/DOW
   means and the scalar baseline disagree by more than a tolerance (~15%), **say so, name both
   numbers, and say which one the calculation used.** Do not auto-correct — the manager knows
   which source is trustworthy and the tool does not.
2. **Outlier flagging.** His monthly means swing 4× (Jan 15.1 vs. Mar 4.0). Flag implausible
   dispersion as *possible small-sample months*, without refusing the input.
3. **Missing-input consequences, stated at results-time not just setup-time.** His ESI Mix tab
   is entirely blank, so acuity weighting is off — the results page should say, once, what
   that means for what he's reading.
4. **Rewrite boarding methodology copy from apology to shopping list.** Today it dwells on
   what's derived. Invert: state what was computed, then name the better data that would
   replace the derivation (measured hourly boarding census, actual boarding hours by month,
   real LWBS rate) and roughly where it lives. Ben: *"if there is better data / a better way
   to do this, I should look into getting it."* Apply the same inversion to every
   ASSUMPTION-flavored block on the page.

---

## 11. PR sequence

| PR | Scope | Depends on |
|---|---|---|
| **E0** | **Synthetic department fixture generator + invariant sweep (§12.5).** Build this FIRST — it is the harness every PR below is verified against, and retrofitting it later means re-verifying all of them. | A–D |
| **E** | Backlog: structural/cyclical split, relative threshold, LWBS-rate input, `estimatedAbandonedHours`, report on `maxDrainFraction`. Validate against Ben's data (§4). | E0 |
| **F** | Budget framing + delivery premium + Scenario B + hidden-boarding diagnostic (§3, §5, §6.2) | E |
| **G** | Synthesis chapter + reframed funding ask + finance-partner worksheet (§7) | F |
| **H** | Page architecture: chapter rail, reorder, §6.1 philosophy statement, `narrative.ts`, pill cleanup, hourly range (§8) | G |
| **I** | Evidence surface, Ch. 9 (§8) | H |
| **J** | Teaching layer + convexity interactive (§8) | H |
| **K** | Input integrity + boarding copy inversion + constrained boarding reallocation (§6.3, §10) | F |
| **L** | PPTX export (§9) | H, I |

E strictly first: every severity and backlog number downstream is wrong until it lands.
H before L: the export reads `narrative.ts`, which H creates.

---

## 12. Generality contract — the page must work for departments unlike this one

Every number in this spec comes from one real department. That made the diagnosis concrete
and caught four bugs that abstract reasoning would have missed. It also creates a specific
risk: **an implementer reading "days run 229 hours short, nights carry 185 extra" may build
copy, thresholds, or chapter logic that quietly assume that shape.** They must not.

**The architecture is general. The illustrations are not.** The rules below make that binding.

### 12.1 No headline may assume the sign or size of any gap

Every templated sentence needs a tested mirror. "Your nights carry 185 hours beyond what
arrivals justify" must have a sibling for the department whose nights are *short*, and one for
the department where the difference is negligible — and **negligible is real information, not
a null state.** "Your night staffing matches what arrivals justify, and boarding at night is
modest — nights are not where your problem is" is a genuinely useful sentence that a
sign-assuming implementation will never produce.

Same rule for: day-vs-night shortage direction, whether reallocation helps at all, whether
the department is above or below peer median, whether structural or cyclical backlog dominates,
and whether the synthesis gap is positive at all.

### 12.2 Department profiles that must each render correctly

At least one Playwright fixture per profile, all committed:

| | Profile | What the page must conclude |
|---|---|---|
| **A** | Under-target overall, day-short *(the source department)* | Understaffed, concentrated in daytime; reallocation partial |
| **B** | At/above target on total hours, badly shaped | **"You have enough hours; they're in the wrong places."** A first-class ending, not a degenerate case |
| **C** | Night-short rather than day-short | Same machinery, opposite direction, no copy strain |
| **D** | No boarding data (no admit rate / duration) | Single-budget page. The two-budget thesis must **degrade to a prompt** — "you're seeing half the picture; here's the data that shows the other half" — never silently vanish |
| **E** | Boarding present but short-duration / small | Hidden-boarding diagnostic ≈ 0. Must read as a finding ("your nights are staffed for arrivals, appropriately"), not an empty section |
| **F** | Low-volume ED where the ENA floor binds and per-hour rounding dominates | Delivery premium is large and mostly unavoidable; say so rather than implying waste |
| **G** | Already well-allocated and adequately staffed | **The page must be able to say "you're fine" convincingly.** A tool that always finds a problem stops being believed — and this is the profile most likely to be silently broken |

Profiles B and G are the ones to build first after A, because they are the ones the current
narrative arc implicitly assumes away.

### 12.3 The chapter arc must survive its own answer changing

§8's chapter order is an elimination argument. It must not presuppose where elimination lands:

- **Chapter 4 ("Could moving hours fix it?")** must be able to answer **yes, entirely** — and
  when it does, Chapters 5 and 7 shrink to a short confirmation rather than manufacturing a
  residual gap.
- **Chapter 7 (synthesis)** has at least three endings: *you need more*, *you have enough but
  misplaced*, *you're in good shape*. All three are written, all three are tested.
- **Chapter 6 (boarding)** must handle absent, negligible, and dominant boarding.

### 12.4 What is genuinely universal vs. what is this department's story

So an implementer can tell them apart:

**Universal — structural properties of the model, true for any ED:** measuring backlog against
a target most departments don't meet; an absolute caught-up threshold being scale-dependent;
integer nurses plus fixed shift blocks creating a delivery premium; the shape-vs-size question;
the separate arrivals/boarding budgets; every §10 input-integrity check; the evidence, teaching,
and export layers.

**This department's story — illustrative only, never encoded:** that days are short and nights
carry hidden boarding; that reallocation is worth ~33%; that boarding is 52% nocturnal; that
the department sits above peer median; that the residual gap is 14.6 FTE; the 3×12h menu and
its 147-hour delivery premium.

### 12.5 Synthetic department fixtures — build the generator, not seven hand-made files

**Yes, generate them** — and generate them *parametrically*, because hand-built fixtures get
unconsciously tuned until the output looks good, which is the failure mode they exist to catch.

Build `src/lib/__fixtures__/syntheticDepartment.ts`: a pure function taking a small parameter
set and emitting a complete valid `EngineInputs` + current-staffing grid.

Parameters: annual volume; arrival-curve shape (unimodal day-peak / bimodal / flat / evening-
skewed); day-of-week amplitude; p75-to-mean spread; admit rate; mean boarding duration; monthly
boarding dispersion; current staffing as a *ratio* to target-implied hours; current day/night
split; shift menu (2×12 / 3×12 / 3×8 / 8+12 mixed); ESI mix present or absent; boarding data
present or absent.

Two tiers of use:

**(a) A sweep, as an engine test.** A few hundred departments across the parameter grid,
asserting **invariants**, not outputs:
- `reconcile()` passes for every one — the existing correctness proof, now under adversarial
  input rather than one happy path.
- No `NaN`/`Infinity`/negative-headcount anywhere in `EngineResult`.
- Expected orderings hold where they must (e.g. full-coverage hours ≥ any trimmed solve;
  staffing FTE ≥ coverage FTE).
- **Every `narrative.ts` function returns a non-empty, grammatical sentence with no
  placeholder residue** (`undefined`, `NaN`, `-0`, an empty interpolation) — this is the test
  that actually catches sign-assuming copy, and it's cheap.
- Degenerate inputs terminate: zero arrivals in an hour, single-shift menus, volumes at both
  ends of the peer-band table, current staffing of zero.

**(b) Seven named fixtures** — one per §12.2 profile, chosen from the generator's parameter
space and *frozen* — for Playwright and visual review. Named for the conclusion they should
produce (`adequatelyStaffedBadlyShaped`, `alreadyFine`, `noBoardingData`, …) so a regression
that breaks profile G is obvious from the failing test name alone.

**What synthetic data can and cannot do — do not confuse these:**

| Validates | Does not validate |
|---|---|
| Generalizability: no crashes, no sign-assuming copy, every branch reachable, invariants hold | **Whether the model is right about a real ED** |
| That "you're fine" and "wrong shape" render as well as "understaffed" | Whether `abandonRate`, `recoveryEfficiency`, or `maxDrainFraction` are correctly calibrated |

Calibration needs real departments. Synthetic fixtures prove the page *works* for departments
unlike the source one; only real data proves it's *right* about any of them. Ship both; never
let the first substitute for the second.

**Bonus, and not a small one:** synthetic fixtures carry no real ED data, so unlike the source
department's file they **can** ship in the repo without touching the no-seeded-data constraint
(§12.6) — which is the only reason a committed per-profile fixture suite is possible at all.

### 12.6 The source data is a bug-reproduction check, not a tuning target

The §4 backlog table and §6.2 hidden-boarding numbers exist to prove specific defects are
fixed. They are **not** targets to tune constants toward. If a change makes those numbers
prettier but degrades profiles B–G, it is a regression. And per CLAUDE.md's no-seeded-ED-data
constraint, this data cannot ship in the repo — see §14 open question 5.

---

## 13. Out of scope

Unchanged from CLAUDE.md §7 unless noted:

- **Dollar/ROI layer.** Reaffirmed and strengthened (§7). The finance-partner worksheet is the
  sanctioned alternative. `estimatedAbandonedHours` must never become a dollar figure.
- **Blending boarding into `EngineResult.grid`.** The separation is the thesis (§6). The
  synthesis chapter adds them *for the reader*, never in the solved grid.
- Role-level skill-mix modeling (PR D's headcount-semantics fields stay display-only).
- Arrivals seasonality; Monte Carlo; backend/persistence/auth; a general shift-menu optimizer.
- Mobile/responsive — chapter rail is desktop-first; a narrow-viewport top bar is a
  nice-to-have, not a gate.

---

## 14. Open questions for Ben

1. **The budgeting-for-boarding source material.** Ben notes the separate-budget philosophy
   matches "the budgeting for boarding presentation that underlies the calculation." That
   document isn't in the repo. Worth adding — Chapter 9 (§8) should cite it as the provenance
   for the §6 thesis, which is otherwise the one major design stance with no written source.
2. **LWBS rate as a setup field** (§4d) — confirm a manager can pull it easily. If not, it
   becomes an optional refinement rather than the primary calibration path.
3. **Scenario B naming.** Working title "the same hours, better placed."
4. **Chapter 9 audience** — your own analytics team, or an external skeptic (consultant,
   regulator, system-office analyst)? The second needs more provenance and limitations; the
   first needs more formulas.
5. **Ben's own data as the worked example.** Every number in this spec is real, from his
   department. Useful as a regression fixture — but it is real ED data, and CLAUDE.md's
   no-seeded-ED-data constraint means it cannot ship in the repo. Confirm whether it lives as
   a local-only test fixture or not at all.
