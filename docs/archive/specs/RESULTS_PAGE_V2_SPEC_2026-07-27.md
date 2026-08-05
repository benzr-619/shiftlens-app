# Results Page V2 — five panels, one repeated visual frame, a sandbox

**Status:** governing spec for the next work block. Planned with Ben in Cowork on 2026-07-27;
this document is the handoff into Claude Code. Read `CLAUDE.md` and every file in
`.claude/rules/` before starting — this spec assumes that context and does not restate the
engine's math.

**Read this section first.** This spec reverses a number of decisions that are documented in
`.claude/rules/` with their own reasoning. Every reversal is listed explicitly in §2. They were
made deliberately, with Ben, after looking at the rendered page against a real department's
data. Implement them; do not "correct" them back to what the rules files say. Update the
relevant rules file in the same PR, per `CLAUDE.md`'s AUTOMATIC MAINTENANCE section.

---

## 1. Why this exists

The results page is accurate and unreadable. Ben's assessment, verbatim in substance: *"there
is a lot that's good on the current page but it feels jumbled up and long. So much is built on
comparison so different sections shouldn't come with brand new visual/stats language — things
should get repeated for easy comparison."*

Three concrete failures, all confirmed against a real rendered page:

1. **Every section invents its own visual and stat vocabulary.** The reader re-learns how to
   read the page in each chapter, and cannot compare across chapters because nothing is drawn
   the same way twice.
2. **Some stats are meaningless to the reader.** "Total severity" is the solver's internal
   objective. It is not a number a nurse manager can act on or quote, and it appears in the UI.
3. **At least one stat is actively misleading.** The page reports "Longest lean stretch: all
   week / never fully clears" for a department that genuinely does catch up overnight. See §3.1
   — this is a reporting bug, not a modeling one, and the engine already computes the fix.

The page is being rebuilt as **five panels sharing one visual frame**, with a fixed stat
vocabulary reused in every panel, and a final interactive panel where the manager builds the
ask they will actually present.

**The governing test for every change in this spec:** could a nurse manager read this page
once and afterwards explain to their CNO, in their own words and their own numbers, whether the
department is understaffed, where, how much of it they can fix themselves, and what the rest
costs? Anything that does not serve that is cut.

---

## 2. Reversals — flag each of these in its PR body

Each of these contradicts something currently documented in `.claude/rules/` or `CLAUDE.md`.
All are intentional and confirmed with Ben.

| # | Reversal | Currently documented in |
|---|---|---|
| R1 | Heatmap cell **number** goes from `onDuty/requirement` (e.g. `7/13`) to **headcount only**. Color continues to encode the ratio. This is the THIRD change to this mechanism. | `CLAUDE.md` §6, PR D block |
| R2 | The "richer than typical" color goes back to a **saturated blue**, reversing the deliberate muting. | `CLAUDE.md` §6, 2026-07-25 block (`RICHER_RGB`) |
| R3 | The **backlog spine overlay is removed from the heatmap entirely**. Backlog gets its own aligned strip chart. | `results-redesign.md`, heatmap legibility §1/§2 |
| R4 | Backlog reported to the user is the **cyclical** curve; the **structural** floor is stated separately as a sentence. The blended actual curve is no longer surfaced as "longest lean stretch." | `engine-solver.md` PR E (engine already supports this; only reporting changes) |
| R5 | **"Effective wHPPV after boarding" is no longer compared to the peer band.** The number itself stays. | `CLAUDE.md` §6 |
| R6 | The recommended-staffing grid displays **arrivals nurses, boarding nurses, and their sum**. This is a display-level sum only; `EngineResult.grid` stays arrivals-only. FIFTH movement of this rule. | `boarding-seasonality.md`, `CLAUDE.md` §6 ("don't merge boarding into the core grid without checking with Ben" — checked, approved) |
| R7 | **"Severity" is removed from the UI entirely.** It remains the solver's internal objective. | `results-redesign.md` PR C/PR D |
| R8 | **`FinancePartnerWorksheet.tsx` and `FundingAskSection.tsx` are deleted.** Their useful content is absorbed into Panel 3 (cost of full coverage) and Panel 4 (benefit per added shift). | `results-redesign.md` PR G |
| R9 | `HiddenBoardingSection`, `BoardingTransition`, `SynthesisSection`, `ScenarioBSection`, `ConstrainedReallocationSection`, `BoardingCoverageSection`, `ShiftMenuFlexibilitySection` cease to exist as standalone sections. Their content is redistributed into the five panels (§4). Their **engine functions are kept and reused**. | `CLAUDE.md` §3 Screen Map |
| R10 | The left **`ChapterRail` becomes a top step bar** (`StepBar`), freeing full page width for the visuals. | `results-redesign.md` PR H |
| R11 | **"Idealized" is renamed "recommended"** everywhere in the UI. Engine field names unchanged. | throughout |
| R12 | **PPTX export moves to the bottom of the page** and its scope narrows to current-state + the user's sandbox scenario + the delta. Panels 2, 3 and 4 are not exported. | `results-redesign.md` PR L |

---

## 3. Decisions already made — do not re-litigate

### 3.1 The backlog reporting bug

Against a real department (see the numbers below), the page reports `LONGEST LEAN STRETCH: all
week / never fully clears`. Ben's response: *"my department usually does catch up overnight."*

He is right, and so is the engine. Summing one day of that department's own current-staffing
grid: requirement ≈ 241 nurse-hours, capacity ≈ 221. The department is short roughly **20
nurse-hours every day in aggregate**. A queue cannot return to zero when the hours were never
there. So "never clears" is arithmetically true and communicatively useless — **it reports a
sizing problem in the language of a shape problem.**

`engine/backlog.ts` already splits these (PR E): `structuralFloorByDay` / `structuralFloorMin`
(the trough of the actual curve — a sizing signal) and `cyclicalBacklog` + its own streak/peak
fields (the same recurrence against capacity rescaled to match requirement's own weekly total —
a shape signal). **The engine is correct; only the reporting layer is wrong.** No engine change
is required for this beyond exposing the right fields to the UI.

Replace the single stat with two sentences, both of which are true and quotable:

> You are short about **20 nurse-hours a day** against arrivals alone, so you begin each day
> already behind.
>
> Within a day, the queue builds from **08:00**, peaks around **11:00**, and would clear
> overnight if the day itself were fully staffed.

The second sentence is the cyclical curve. It is what makes the first sentence credible instead
of alarmist.

### 3.2 The heatmap is carrying too much

The current heatmap encodes three variables per cell: a fraction, a color, and a backlog spine.
In the rendered page the spine appears on essentially every cell at near-uniform weight, which
reads as a table border artifact rather than data. Reducing to two variables (headcount +
color) and giving backlog its own chart is R1/R3.

Also visible in that render and worth fixing: the department runs **8 nurses against a
requirement of 4 at 04:00** — double-staffed, rendered in pale gray, effectively invisible.
That is arguably the single most actionable fact on the page. R2 exists because of this.

And: **capacity sits flat at ~7 from midnight through 10:00 while requirement climbs from 4 to
15.** The staffing ramp is roughly four hours late. No stat on the current page says this. It is
the whole story of that department and it should be Panel 1's headline sentence. A
demand-vs-capacity line chart shows it in one glance; a grid never will.

### 3.3 wHPPV framing

- **One wHPPV compared to the peer band**: total staffed hours ÷ visits. Both this number and
  the peer band include boarding work, so the comparison is apples-to-apples. This is the only
  band comparison on the page.
- **Effective wHPPV (after boarding) is kept** as a productivity statement — of the nursing time
  per visit you staff, this much is left for the ED patient. It is **not** compared to the band,
  and a single line must say why: peer numbers include their own boarding, so a
  boarding-stripped number is not comparable to them.
- **Boarding is also stated as a demand fact**: "boarding demands the equivalent of 0.50 wHPPV,
  about 29% of your department's total nursing demand." Express it as a percentage as well as a
  decimal.
- **Never attribute today's actual staffed hours between arrivals and boarding.** The department
  staffs one pool; any split would be invented.

### 3.4 The combined engine is an effective-wHPPV smoother — explain it that way

Effective wHPPV at an hour is `(capacity − boarding demand) ÷ arrivals`. Holding that constant
at target `w` means `capacity = arrivals × w + boarding demand` — which is exactly the sum of
the two demand curves. **Summing arrivals demand and boarding demand already smooths effective
wHPPV.** This has always been true and has never been explained to the user.

It also means **there is no new target parameter to invent** for the combined view: it is the
same `wHppvTarget` the user already set, because that target is defined as nursing time per ED
visit and boarding is priced by ratio instead.

Copy for this, in Panels 3 and 4:

> Staffing for both demands means holding your nursing time per ED patient steady at your
> target, hour by hour, and adding whatever boarding needs on top. Today that number swings —
> your ED patients get less nursing attention in the hours you are holding the most boarders.

**Honest caveat that must be stated, not omitted:** acuity weighting (§1b) and day-of-week
smoothing (§1c) mean effective wHPPV comes out flat in *acuity-adjusted* terms, not literally
flat. Do not claim perfect flatness.

### 3.5 Hold nurses vs ED nurses is a SANDBOX-ONLY concept

**This distinction must not appear in Panels 1–4.** Everywhere except the sandbox, boarding
demand and arrivals demand are both simply nursing demand in nurse-hours, and the solver looks
for the number of nurses needed to cover it. There is no nurse-type modeling in the engine's
main path.

The distinction exists in Panel 5 only, because it is **a distinction in the ask, not in the
math**: is the manager asking for a bigger pool of ED nurses (their own budget, flexible across
both demands), or for hold nurses from the hospital's float pool (likely outside their budget,
but only able to cover med/surg boarders)? The sandbox exists so they can price both versions
of the ask before walking into the room.

Note for Panel 4: its arrivals/boarding split of the recommendation is a **demand
decomposition** — how many recommended nurses exist because of arrivals and how many because of
boarding. It is not a nurse-type split. Word it so no future session implements it as one.

---

## 4. The five panels

Page order, top to bottom. Each panel is approximately one viewport tall, two columns: **words
and stats on the left, one fixed visual frame on the right.**

### The visual frame — build once, reuse five times

The frame's shape never changes across the page. Only the data loaded into it changes, driven
by **one toggle per panel**. Three stacked elements sharing a single x-axis:

1. **Demand vs. capacity chart.** Two lines — what demand requires, what is staffed — with the
   gap shaded. Default view is the **average day (24 hours)**; the full 168-hour week is an
   expansion, not the default.
2. **Queue depth strip**, directly beneath, same x-axis. Draws the **cyclical** curve (R4), with
   the structural floor drawn as a horizontal baseline so the two-sentence framing in §3.1 has a
   picture attached.
3. **Heatmap**, below. Existing component, modified per R1/R2/R3.

**Toggling animates the transition between states.** Animate the *data*, not the page — cells
cross-fade, lines tween. Three heatmaps side by side is worse than one heatmap that morphs
between three states: the eye detects change in place far better than it compares grids across
a gap, and it costs no vertical space. This is the core layout idea; do not implement the
toggle as static side-by-side panes.

The repetition is not only aesthetic. By Panel 5 the reader already knows how to read every
chart, which is what allows the sandbox to work without instructions.

### The fixed stat vocabulary

These are the only summary stats on the page. The same wording is reused in every panel where
they appear.

- **Hours below need per week** (replaces every "severity" figure — R7)
- **Worst unbroken stretch**, named with the pattern namer (§5.2)
- **wHPPV**, and **effective wHPPV**
- **Nurse-hours short per day** (structural), and **when the queue builds / peaks / clears**
  (cyclical)

---

### Panel 1 — What your department demands, and what you staff against it

Absorbs today's `CurrentStaffingAnalysis`, the coverage-summary stats, and
`HiddenBoardingSection` (the "is boarding budgeted for at all" question belongs here, not four
sections later).

**Left column:**
- Headline: hours staffed per week, wHPPV, and whether it is below/within/above the peer band —
  one band comparison only.
- **The late-ramp sentence** (§3.2). Name when demand peaks and when staffing peaks.
- Boarding demand split **medical vs BH**, with the ratios stated plainly (1:4 and 1:10) and why
  they differ. Keep the existing required callout that RN-only figures understate BH boarding's
  true operational cost.
- Effective wHPPV, with the no-band-comparison caveat (§3.3).
- Whether boarding is currently staffed for at all — the hidden-boarding day/night diagnostic,
  reworded into this panel's voice.
- The two backlog sentences (§3.1).
- **The queue-honesty callout**, which must appear on this page. Use this copy or something very
  close to it:

  > This queue assumes every patient gets the full nursing time your target implies. In reality,
  > when you are short, nurses do not let a line form — they go faster. So the backlog shown here
  > usually is not a visible waiting room. It is care compressed, checks skipped, and breaks
  > missed. It shows up as burnout, turnover, and patients who leave before being seen, not as a
  > queue anyone can point to.

**Toggle:** Arrivals · Boarding · Combined · **Effective wHPPV**

The effective-wHPPV view renders mottled here — ED patients get materially less nursing
attention in boarding-heavy hours. It goes flat in Panels 3 and 4. That contrast is the clearest
single demonstration of what the recommendation buys, and it only works because the frame
repeats.

### Panel 2 — Could moving hours fix it?

Reuses `computeScenarioB` (arrivals only) and `computeCombinedReallocation` (arrivals +
boarding) unchanged. No new engine work.

**Left column:** hours below need and worst stretch, updating with the toggle. Plus the honest
cost sentence, stated on **every** render, not once: reallocating to cover boarding makes the
arrivals picture worse, and the panel must name what that costs.

**Toggle:** Current · Reallocated for arrivals · Reallocated for arrivals + boarding

Keep the existing arrivals-only bound disclosure on the middle option.

### Panel 3 — What would it take to fully cover the department?

New. The honest ceiling: total nurses required so arrivals demand and boarding demand are both
fully met, with no shortfall anywhere. **No hold/ED decomposition here** (§3.5) — one number,
one grid.

**The queue strip goes blank in this panel.** After two panels of watching a queue build, the
strip is empty. Preserve that; it is the most persuasive frame on the page and it is free.

**This number will be large and unsellable, and that is its job.** State it plainly, then hand
off immediately: this is the ceiling, not the ask; the next panel is what is worth asking for
and why. Without that handoff the reader bounces off the number and never reaches Panel 4.

**The two-bar comparison lives here**: total demand (arrivals + boarding, stacked) next to hours
staffed today. One image, the founding question answered. This replaces `SynthesisSection`'s
paragraph.

### Panel 4 — Recommended staffing

Today's "idealized" grid, renamed (R11), and framed as the rational budgeted model sitting
between today and the Panel 3 ceiling.

**Left column:**
- How many extra nursing shifts per week versus current staffing, and where they land.
- **Benefit per additional shift** — reframed from the existing marginal curve. Not FTE, not
  severity: "each additional 12-hour nurse shift you add removes roughly X hours of unmet need,
  and the first N shifts do most of the work." This absorbs the entire useful content of the
  deleted funding-ask section (R8).
- **Shift-menu flexibility**, collapsed, at the bottom of this panel — "and here is whether a
  different shift menu gets you closer for the same hours." Existing `searchFlexibleMenus`
  unchanged.

**Toggle:** Nurses for arrivals · Nurses for boarding · Combined (R6 — display-level sum only)

The panel's primary visual beyond the frame is the **diff**: which shifts gain nurses.

### Panel 5 — Test it yourself

New. Two editable day × shift grids, live-updating, no solver call.

- **"ED nurses"** — your budget, flex across both demands.
- **"Hold nurses"** — hospital float pool, cover **med/surg boarders only**.

State plainly why the two grids exist: they are two different asks, to two different people,
out of two different budgets (§3.5).

**Prefill buttons:**
1. My current staffing (into ED nurses; hold nurses zero)
2. The recommendation, all as ED nurses
3. The recommendation, with boarding covered by hold nurses

Buttons 2 and 3 are the two versions of the ask, side by side.

**A finding this panel will surface that no other panel can:** a department with heavy BH
boarding gets much less out of the hold-nurse ask, because hold nurses cannot cover BH boarders.
Someone testing that scenario watches their coverage barely move. That is a real result, not a
model quirk — do not smooth it over.

---

## 5. Engine and library work

### 5.1 Backlog reporting (no new math)

Surface `cyclicalBacklog` + its streak/peak fields and `structuralFloorByDay` /
`structuralFloorMin` to the UI. The queue strip draws cyclical; the structural floor is a
horizontal baseline and a sentence. Remove the blended-actual "longest lean stretch / never
clears" stat from the page.

Confirm which curve and which threshold the heatmap overlay was using before deleting it, and
record the finding in `.claude/rules/engine-solver.md` — if it was the actual curve against the
old absolute threshold, that is the mechanical cause of the bug in §3.1 and is worth writing
down.

### 5.2 Pattern namer — new `src/lib/whenPattern.ts`

One shared helper. Every "when is it worst" sentence on the page uses it; no component invents
its own phrasing.

**Input:** 168 values plus a direction (lower-is-worse or higher-is-worse).
**Output:** a human phrase — "weekday mornings", "Saturday nights", "Tuesdays".

**Algorithm.** Take the worst quartile (42 hours). Fixed time blocks: overnight 23–06, morning
07–11, afternoon 12–16, evening 17–22. Try descriptions in this order and return the **first**
that captures ≥50% of the worst-quartile hours while being ≥60% pure (that share of the hours it
names are themselves in the worst quartile):

1. A block, every day — "mornings"
2. Weekday/weekend × block — "weekday mornings"
3. One day × block — "Saturday nights"
4. One day — "Tuesdays"
5. Fall back to naming the single worst hour, as today

Preferring the broadest passing description is what makes it read like a person talking. For the
department in §3.1 this yields "weekday mornings," which is correct.

Unit-test the ladder directly, including a case for each rung and a case that falls through to
the fallback.

### 5.3 Full coverage over combined demand

Extend the existing `solveFullCoverageWeek` path to run against the combined
`hourlyRequirement + cellBoardingRnHours` curve for Panel 3. Reuse; do not write a second
solver. Resource-agnostic — no hold/ED concept (§3.5).

### 5.4 Sandbox model — new `src/engine/sandbox.ts`

Pure arithmetic, no solve. Fits the existing cheap-live-recompute convention
(`recomputeAfterEdit`) and must update on every keystroke.

```
holdApplied[h]     = min(hold[h], medBoarding[h])
holdSurplus[h]     = max(0, hold[h] - medBoarding[h])
residualDemand[h]  = arrivalsRequirement[h]
                   + (medBoarding[h] - holdApplied[h])
                   + bhBoarding[h]
unmet[h]           = max(0, residualDemand[h] - edNurses[h])
spare[h]           = max(0, edNurses[h] - residualDemand[h])
```

Queue depth runs the existing `backlogModel.ts` recurrence over `residualDemand` vs `edNurses`
capacity — one queue, because ED nurses are one pooled resource.

Effective wHPPV per hour = `(edNurses[h] − unabsorbed med boarding[h] − bhBoarding[h]) ÷
arrivals[h]`. It can go negative; report it honestly rather than silently clamping the
underlying value (clamping for *display* colour is fine).

**Two hard rules:**
- **Do not attribute `unmet` between arrivals and boarding.** ED nurses are pooled; any split is
  invented. Show one combined coverage picture.
- **`holdSurplus` is a real finding and must be surfaced** — hold nurses staffed against boarders
  who are not there. It is the honest cost of the cheaper-looking ask.

Test: hold nurses never reduce BH or arrivals shortfall; surplus hold nurses appear as surplus,
not as coverage; a full-coverage input produces zero unmet and a flat queue.

### 5.5 Copy-layer rules

Extend `src/lib/__tests__/copyLayer.test.ts`. It already forbids the bare word "budget" in
`src/screens/` and `src/components/`. Add:
- **"severity"** — forbidden in UI source (R7).
- **"idealized"** — forbidden in UI source (R11).

Engine identifiers are unaffected in both cases; the test is word-boundary based and does not
match camelCase members.

---

## 6. Layout shell

- `ChapterRail` → `StepBar`, a slim top bar with five steps (R10). Same scroll-spy and
  click-to-jump behaviour; horizontal.
- Five panel wrappers, roughly viewport height, two-column (words left, frame right).
- The visual frame is one component taking a list of views; each view supplies its own
  capacity/demand/queue/heatmap data. The panel decides the view list; the frame does not know
  which panel it is in.
- Desktop-first, consistent with the rest of the app. A narrow-viewport stack is acceptable but
  is not a gate.

---

## 7. PPTX export

Moves to the bottom of the page, after Panel 5 (R12) — you export after you have tested your own
scenario, not before you have read anything.

**Scope narrows.** The deck is: title → current-staffing analysis (Panel 1's content) → the
user's sandbox scenario → the delta between them → Method & Limitations. **Panels 2, 3 and 4 are
not exported.** The deck is what the manager wants to present, not a dump of the tool.

- If the sandbox is untouched, prefill it with the recommendation and label those slides as the
  tool's recommendation rather than blocking the export.
- **Everything stays native — no images.** Heatmaps become PPTX tables with coloured cell fills
  (same colours as the page, still editable). The demand-vs-capacity chart, queue strip and
  two-bar comparison are native chart types in `pptxgenjs`. Nothing renders as a flat screenshot.
- Method & Limitations stays mandatory, using the generated constants table, per the existing
  rule.
- Slide titles continue to come from `src/lib/narrative.ts` — never a second hand-written set.

**Branding.** The app has no design tokens; the only brand asset is the favicon mark (purple
`#7c3aed` on a pale `#f5f0ff` tile). Derive the deck theme from that mark plus the heatmap's
existing red/blue scale, so deck and page are visibly the same product: title slide with the
mark, one accent colour, section dividers matching the panels, generous white space.

---

## 8. Suggested PR sequence

Each PR should build, test and lint clean, and update the relevant `.claude/rules/` file in the
same commit.

| PR | Scope |
|---|---|
| A0 | **Browser test harness (§8.1). Build this first** — everything from PR D onward is visual and this repo has never had a way to verify visual work. |
| A | Backlog reporting fix (§5.1) + pattern namer (§5.2). Engine/lib only, no UI. |
| B | Full coverage over combined demand (§5.3). Engine only. |
| C | Sandbox model (§5.4) + tests. Engine only, no UI. |
| D | Layout shell: `StepBar`, five panel wrappers, the visual frame component, heatmap changes R1/R2/R3. |
| E | Panels 1 and 2. Deletes `HiddenBoardingSection`, `BoardingTransition`, `ScenarioBSection`, `ConstrainedReallocationSection` as standalone sections. |
| F | Panels 3 and 4. Deletes `FundingAskSection`, `FinancePartnerWorksheet`, `SynthesisSection`, `BoardingCoverageSection`; folds `ShiftMenuFlexibilitySection` into Panel 4. |
| G | Panel 5 sandbox UI. |
| H | PPTX rewrite (§7). |

`EvidenceSurfaceSection` stays as-is, collapsed, at the very bottom, below the export. It is off
the main arc and it is what protects the tool when a number is challenged.

### 8.1 PR A0 — the browser test harness

Every "verified end-to-end in headless Playwright" note in `.claude/rules/` refers to ad-hoc
manual checking during a session. There is no committed harness, no `playwright` devDependency
and no config. This spec is the most visual work this repo has taken on, so the harness is a
prerequisite, not a nice-to-have.

Build it to load the existing synthetic fixtures — **do not hand-build departments in a
`.spec.ts` file**, which is exactly the duplication `.claude/rules/synthetic-fixtures.md` warns
against:

- Add `@playwright/test` + a config (chromium only, desktop viewport, `webServer` running
  `npm run dev`).
- A seeding path so a test can load a `NAMED_DEPARTMENT_PARAMS` profile straight into the
  zustand store and land on the results page without stepping through setup — e.g. a
  dev-only query param or a `window.__shiftlensSeed(params)` hook compiled out of production
  builds. Keep it out of the shipped bundle; it must not become a route into seeded ED data.
- `npm run test:e2e` script.
- A smoke spec covering every named profile (A–H): results page renders, **zero console
  errors**, no `NaN`/`undefined`/`{{` visible in the DOM.
- Per-panel specs added by each later PR: the panel renders, its toggle switches views, the
  frame's three elements are present, and the panel-specific assertions this spec calls for —
  Panel 3's queue strip is empty, Panel 1's effective-wHPPV view is not, Panel 5's hold-nurse
  surplus appears when hold nurses exceed medical boarding, and a heavy-BH profile shows
  hold nurses barely moving coverage.
- Screenshot capture on failure, and a full-page screenshot per panel saved to a gitignored
  directory so a human can review the visual result afterwards.

Console-error-free is a hard assertion, not a warning — it is the check that has caught the most
in this repo's history.

---

## 9. Invariants

Unchanged by everything in this spec, and each must be verified rather than assumed:

- `reconcile.test.ts` passes with a zero-line diff. Nothing here touches allocation math.
- `annualVisits`, `annualCoreRnHoursBudget` and `hourlyRequirement` are untouched.
- `EngineResult.grid` stays arrivals-only. R6 is a display-level sum, computed in the component.
- No ED-specific data as a seeded default, anywhere. The sandbox's prefills read the user's own
  current staffing or the tool's own recommendation — never a shipped example department.
- No dollar or ROI figure anywhere in the tool.

---

## 10. Open items

1. ~~No browser verification exists in this repo.~~ **RESOLVED — build it, as PR A0 (§8.1).**
   Never claim visual verification that did not happen; if a check could not run, say so in the
   PR body.
2. **Animation performance** on the toggle transitions with a 168-cell heatmap has not been
   assessed. If it is janky, drop to a cross-fade rather than per-cell tweening.
3. **The two-bar comparison's scale** when boarding is absent (a department that skipped
   boarding entirely) needs a defined degraded state, not a half-empty chart.

---

## 11. Running this unattended

This spec is written to be executed end to end in one session without a human present. Work
through PRs A0 → H in order, and do not stop between them to ask whether to continue.

**After every PR, without being asked:**

1. `npm run build`, `npm test`, `oxlint`, and (from PR A0 onward) `npm run test:e2e` must all be
   clean. The only acceptable pre-existing warning is `StepIndicator.tsx`'s fast-refresh one.
2. Update the relevant `.claude/rules/<area>.md` file, and `CLAUDE.md` where this spec changes
   something already documented there. This is mandatory per `CLAUDE.md`'s AUTOMATIC MAINTENANCE
   section — not deferred to the end.
3. Commit, with any §2 reversals named explicitly in the commit body.

**When to stop and leave the work for a human**, rather than pressing on:

- A PR cannot be made green after a genuine attempt. Leave the branch as-is with a written
  account of what failed and what you tried. Do not weaken or delete a failing assertion to
  proceed — in particular, never loosen `reconcile.test.ts`; a failure there is a real bug.
- The spec is ambiguous or contradicts the code in a way that changes the outcome. Record the
  ambiguity, pick the reading most consistent with §1's governing test, and flag it in the PR
  body rather than silently choosing.
- You find yourself wanting to reverse something in §2. Do not. Note the objection and continue
  as specified; those were decided deliberately with the rendered page in hand.

**Do not** re-plan the spec, re-order the PRs, or expand scope. If something in §10 blocks you,
implement the simplest defensible version and flag it.

**Leave behind, at the end:** a short written summary of what landed per PR, every place you
flagged an ambiguity, and any visual behaviour that remains unverified.
