# Claude Code prompts — PRs E–L

Paste one at a time into a **fresh** Claude Code session, in order. Each assumes the session
reads `CLAUDE.md`, the relevant `.claude/rules/` files, and
`RESULTS_COMPREHENSION_SPEC_2026-07-26.md`.

Don't start a PR until the previous one is merged and `npm test` / `npm run build` / `oxlint`
are clean — several depend on numbers the previous PR changes.

**Read spec §1 before any of these.** Four decisions govern everything: the primary user is
the ED nurse manager; the job is *understanding* ("am I understaffed, or misallocated?"), not
verdict-delivery; the page must lead the reader to the conclusion rather than announce it; and
arrivals/boarding are budgeted separately **on purpose** — that's the thesis, not a bug.

Every number quoted below is real, from one department (47,171 annual visits, 1,548 staffed
hrs/wk, 3×12h menu). Use them as **bug-reproduction checks — not as tuning targets, and never
as assumptions about shape.**

**Read spec §12 (generality contract) before every one of these PRs.** That department is
under-target and day-short with heavily nocturnal boarding. Most aren't. No headline may assume
the sign or size of any gap; every templated sentence needs a tested mirror; and the page must
be able to conclude "you have enough hours, they're in the wrong places" or "you're in good
shape" just as fluently as "you're understaffed." §12.2 lists seven department profiles that
each need a committed Playwright fixture — build **B** (adequately staffed, badly shaped) and
**G** (already fine) right after A, because they're the ones this narrative implicitly assumes
away.

**Read spec §1(5) before every one of these too.** The page states FINDINGS, not arguments.
Templates state findings; only arithmetic composes them. Every sentence must be true on its
own without depending on another section's outcome; ban the "and so this means…" class of
sentence entirely; when in doubt show the number and stop. This tool renders templates — a
template that editorializes will be confidently wrong for the first department whose shape it
didn't anticipate, and being confidently wrong once costs more trust than being modest a
hundred times.

---

## PR E0 — Synthetic department fixtures (do this before anything else)

```
Read CLAUDE.md and RESULTS_COMPREHENSION_SPEC_2026-07-26.md §12 in full.

Build the test harness every subsequent PR is verified against. Doing this first is the point:
retrofitting it later means re-verifying PRs E-L against it one at a time.

1. `src/lib/__fixtures__/syntheticDepartment.ts` — a PURE function taking a parameter set and
   emitting a complete valid EngineInputs + current-staffing grid. Parameters: annual volume;
   arrival-curve shape (unimodal day-peak / bimodal / flat / evening-skewed); day-of-week
   amplitude; p75-to-mean spread; admit rate; mean boarding duration; monthly boarding
   dispersion; current staffing as a RATIO to target-implied hours; current day/night split;
   shift menu (2x12 / 3x12 / 3x8 / mixed 8+12); ESI mix present or absent; boarding data
   present or absent.

   Generate PARAMETRICALLY, not by hand. Hand-built fixtures get unconsciously tuned until the
   output looks good, which is the exact failure mode they exist to catch.

2. A SWEEP TEST — a few hundred departments across the parameter grid, asserting INVARIANTS,
   never specific outputs:
   - reconcile() passes for every one (the existing correctness proof, now under adversarial
     input instead of one happy path)
   - no NaN / Infinity / negative headcount anywhere in EngineResult
   - orderings that must hold, hold (full-coverage hours >= any trimmed solve; staffing FTE >=
     coverage FTE)
   - degenerate inputs terminate: zero arrivals in an hour, single-shift menus, volumes at
     both ends of the peer-band table, current staffing of zero
   - (once PR H lands) every narrative.ts function returns a non-empty grammatical sentence
     with no placeholder residue — undefined, NaN, -0, empty interpolation. This is the test
     that actually catches sign-assuming copy, and it's cheap. Wire the hook now even if the
     module doesn't exist yet.

3. SEVEN NAMED FIXTURES, one per §12.2 profile, chosen from the generator's parameter space
   and FROZEN, for Playwright and visual review. Name them for the conclusion they should
   produce — `adequatelyStaffedBadlyShaped`, `alreadyFine`, `noBoardingData`, `nightShort`,
   `shortDurationBoarding`, `lowVolumeFloorBinds`, `underTargetDayShort` — so a regression that
   breaks profile G is obvious from the failing test name alone.

WHAT THIS DOES AND DOESN'T PROVE, and don't let anyone confuse them: synthetic data validates
GENERALIZABILITY (no crashes, no sign-assuming copy, every branch reachable, invariants hold).
It does NOT validate whether the model is RIGHT about a real ED, or whether abandonRate /
recoveryEfficiency / maxDrainFraction are correctly calibrated. That needs real departments.
Ship both; never let the first substitute for the second.

These fixtures are synthetic, so they carry no real ED data and CAN ship in the repo without
touching the no-seeded-data constraint. That's the only reason a committed per-profile suite
is possible at all.
```

---

## PR E — Backlog realism

```
Read CLAUDE.md, .claude/rules/engine-solver.md, and RESULTS_COMPREHENSION_SPEC_2026-07-26.md
§1 and §4 in full before writing any code.

Implement PR E. This is a REVERSAL of part of PR B and the SEVENTH shape of the Step 3 trim's
history — flag it as such in the PR body and in .claude/rules/engine-solver.md, following the
convention that file already uses.

THE FINDING (investigated against real department data — do not re-derive; DO reproduce it as
a test before changing anything). The model is NOT wrong about the physics. The reporting
layer destroys the evidence. Real current-staffing grid, computeBacklog output:

  day     trough (always 07:00)   peak (18:00-20:00)
  Sun            7.8                    32.7
  Mon           13.3                    44.0
  Tue           14.1                    43.5
  Wed           13.6                    39.0
  Thu            9.2                    33.4
  Fri            6.3                    27.7
  Sat            2.7                    25.2

The queue drains overnight EVERY night, bottoms out at 07:00, rebuilds through the day —
exactly what the department reports experiencing. The page reports "neverClears: true" and
"168 of 168 hours behind," throwing away a 41-nurse-hour cyclical swing and a structural floor
ranging 2.7 (Sat) to 14.1 (Tue).

IMPLEMENT:

(a) Split structural from cyclical. BacklogResult gains both; NEVER report one number.
    - structural = the floor the week's backlog never drops below. A BUDGET signal.
      "You start Tuesday already 14 nurse-hours behind" is far better advocacy than
      "you're always behind" — and it's true.
    - cyclical = backlog computed against capacity RESCALED to the grid's own total scheduled
      hours. Asks "is my shape wrong" independent of "is my size wrong."
    - CYCLICAL drives the heatmap overlay, the lean-stretch headline, and the Step 3 trim
      objective (candidateCutCost / trimWeekToBudget / summarizeBacklogSeverity). The trim
      allocates a FIXED budget, so its objective must be shape-sensitive and size-blind or it
      spends effort on a problem it cannot solve.

(b) BACKLOG_CAUGHT_UP_THRESHOLD = 0.5 is absolute and now far too small — against a peak of 44
    a 98%-cleared queue still reads "behind." Make it relative to that hour's own requirement
    (~10%, tunable display heuristic, named constant, documented as such).

(c) maxDrainFraction = 0.3 is nearly inert. paydown = min(carried, spare*0.6, carried*0.3);
    the spare*0.6 term binds until spare exceeds ~6 nurses above requirement in a single hour,
    which a solved grid essentially never has (the trim removes exactly that spare).
    recoveryEfficiency is the operative limiter. PR B's physics rationale for the drain cap is
    sound; the calibration makes it unreachable. Re-run PR B's and PR C's scenarios and REPORT
    whether the peak-cutting bias it exists to prevent is actually prevented at 0.3, and if
    not, what value does it. REPORT BEFORE YOU TUNE.

(d) abandonRate becomes measurable: new OPTIONAL setup field for the department's own LWBS
    rate, deriving abandonRate. Absent -> current default, labelled in the UI as a cohort
    assumption, not their number. Respect the no-seeded-ED-data constraint.

(e) New EngineResult.estimatedAbandonedHours = sum over the week of abandonRate * carried[h].
    Already computed and discarded today. Per scenario. It is an estimate of WORK abandoned,
    not a patient count — tag it that way. NEVER convert to dollars (spec §12).

VALIDATION GATE — PR E is not done until this passes. The real data must reproduce: cyclical
backlog clearing overnight; structural floor separately reported at roughly 2.7-14.1 across
the week; no "neverClears" claim. Report the numbers; do not tune until green.

INVARIANTS: reconcile.test.ts passes with a ZERO-LINE DIFF. annualVisits,
annualCoreRnHoursBudget, hourlyRequirement untouched.

Update .claude/rules/engine-solver.md (shape seven) + CLAUDE.md Module Map & Feature Status.
```

---

## PR F — Budget framing, Scenario B, hidden-boarding diagnostic

```
Read CLAUDE.md, .claude/rules/results-redesign.md, and RESULTS_COMPREHENSION_SPEC_2026-07-26.md
§1, §3, §5, §6 in full. PR E must be merged first.

PART 1 — BUDGET FRAMING (§3). Four quantities are conflated under one word. Real numbers:
  hours funded today            1,548/wk  -> "your current staffed hours"
  hours the target implies      1,509/wk  -> "target-implied hours"
  hours to DELIVER that target  1,656/wk  -> "what delivering it costs"
  hours to never be short       2,256/wk  -> "full-coverage hours"

- NEVER call the target-derived figure a budget in the UI. Engine field names stay unchanged.
  Copy-layer rule; enforce with a source-grep test over src/screens/ and src/components/.
- Overcoverage and any "% over" computes against CURRENT STAFFED HOURS, target-implied as a
  labelled second reference. No current staffing -> SUPPRESS the stat, never silently fall
  back to the target.
- DISCLOSE THE DELIVERY PREMIUM as its own named line: whole nurses and 12h blocks cost
  147 hrs/wk (3.7 FTE) more than the target's arithmetic implies. Today this is reported as
  9.8% "overcoverage," which reads like waste. It isn't waste, it's granularity — and naming
  it honestly is what makes the shift-menu chapter matter, since a different menu is the only
  lever that reduces it.

PART 2 — SCENARIO B (§5). A PARAMETER SWAP, not new solver logic: existing pipeline with
weeklyBudgetHours = the current grid's own weekly scheduled hours, holding hourlyRequirement,
protectedFloorHourly, the ENA floor and the shift menu fixed. Do not write a second solver.
Expected on the real data: 1,548 hrs, total severity 1,296 -> 865 (-33%), peak backlog
44.0 -> 25.2, at zero extra hours.

CRITICAL FRAMING — Scenario B is computed on the ARRIVALS budget only and must say so loudly.
On the real data it moves ~168 hrs/wk off nights onto days. Against arrivals alone that's
correct and worth a third of the queued work for free. Against BOARDING, most of those night
hours are doing real work. So B is presented as "what arrivals alone would justify,"
explicitly bounded, with the §7 synthesis as a REQUIRED continuation — never as a standalone
recommendation to act on. A manager who acted on B without reading the boarding chapters would
hurt their department; the page is responsible for making that impossible.

Edge cases, explicit not silent: no current staffing -> CTA; current hours >= full coverage ->
B IS full coverage, say so plainly (a great result, must not read as an error); current hours
below the ENA floor's requirement -> the floor pass pushes B above current hours, report the
overage; already near-optimal -> say so and mean it (a tool that always finds a problem stops
being believed).

PART 3 — THE HIDDEN-BOARDING DIAGNOSTIC (§6.2). THE ADVOCACY ARTIFACT — build this carefully.
New engine output: per hour-block, current capacity minus arrivals-only requirement — the
staffing that exists for something other than arrivals. Real data:

              arrivals need   boarding need   total need   staffed   vs arrivals alone
  Day  07-19      1,025            258          1,283        796          -229
  Night 19-07       567            283            850        752          +185

Boarding is 52% nocturnal; arrivals demand only 36%. Boarding is exactly what makes nights
genuinely need staff.

Templated narrative, three sentences, each quotable standalone, NONE of which states a
verdict:
  "Your nights carry 185 hours a week beyond what arrivals justify. That isn't overstaffing —
   it's boarding, absorbed into a budget that was never sized for it, and it isn't even enough
   (boarding needs 283 hours at night). Your days run 229 hours a week short of what arrivals
   alone justify."

The two numbers nearly offset and the reader draws the conclusion themselves. Do NOT add a
sentence telling them what it means. That restraint IS the feature (spec §1 decision 3).

Verify end-to-end in headless Playwright including all four Scenario B edge cases.
Update .claude/rules/results-redesign.md and CLAUDE.md.
```

---

## PR G — Synthesis chapter + reframed funding ask

```
Read CLAUDE.md and RESULTS_COMPREHENSION_SPEC_2026-07-26.md §1, §6, §7. PR F must be merged.

Build the synthesis — the chapter where the founding question ("am I understaffed, or
misallocated?") actually gets answered. It does not exist today, which is why a reader can
finish the page without an answer.

1. TOTAL DEMAND VS TOTAL STAFF — arrivals and boarding added back together, by hour block.
   Templated, real numbers:
     "Between arrivals and boarding, your department needs about 2,133 nurse-hours a week.
      You staff 1,548. The gap is 585 hours — 14.6 FTE — and 83% of it falls between 07:00
      and 19:00. Reallocating what you already have closes about a third of it. The rest is
      not a scheduling problem."
   That last sentence is the whole product, and it is still not a verdict — it's a subtraction
   the reader can check.

   IMPORTANT: this adds the two budgets FOR THE READER only. Boarding is still never blended
   into EngineResult.grid (spec §12) — that separation is the thesis.

2. REFRAME THE FUNDING ASK. The page currently leads with full coverage: +14.9 FTE on the real
   data. That is unsellable and it buries the +2.7 FTE that captures most of the available
   benefit. Lead with the KNEE of the marginal curve — the ask that buys the most per FTE —
   and show full coverage as the far end of a range, not the headline.

3. FINANCE-PARTNER WORKSHEET — answers "do the extra hours pay for themselves?" in three
   parts: (i) the mechanism chain in the tool's own units (more hours at the right times ->
   less queued work -> fewer abandoned nurse-hours -> fewer LWBS); (ii) an explicit statement
   that the tool does not convert this to dollars and why (no salary/margin inputs collected;
   a fabricated ROI is the first thing a finance partner attacks, and losing that exchange
   costs the manager the whole argument); (iii) the worksheet — state the FTE ask and the
   modeled reduction in abandoned nurse-hours, then name the three numbers their finance
   partner already owns (cost per FTE, contribution margin per treated visit, current LWBS
   rate) that turn it into a dollar figure. Frame as "take these two numbers to your CFO and
   ask them for those three."

DO NOT build a dollar/ROI calculator. Out of scope, reaffirmed spec §12.
```

---

## PR H — Page architecture

```
Read CLAUDE.md, .claude/rules/results-redesign.md, RESULTS_COMPREHENSION_SPEC_2026-07-26.md
§1, §6.1, §8. PR G must be merged first.

1. CHAPTER RAIL — sticky (left on desktop), scroll-spy, click-to-jump; keep the single
   narrative scroll. CHAPTER ORDER IS THE ARGUMENT'S ORDER — each chapter closes one possible
   explanation for "it feels understaffed," so the answer is reached by elimination:
     1 The question, and how we'll answer it
     2 What your department demands
     3 What you staff against it
     4 Could moving hours fix it?          (Scenario B)
     5 What's left after moving them
     6 The second demand: boarding
     7 Both budgets together                (THE ANSWER)
     8 Would a different shift pattern help? (side quest)
     9 How this works                        (evidence — stub here, built in PR I)
   Chapters 8-9 visually set apart as branches. This list is the export's slide-section list
   in PR L — one source of truth.

2. THE PHILOSOPHY STATEMENT (§6.1) — near the top of Chapter 1, BEFORE any recommendation:
     "ShiftLens budgets your department twice: once for the patients who arrive, and once for
      the patients who stay. Your current schedule almost certainly blends the two — most do.
      Where the numbers below look like they're cutting your nights, that's the arrivals
      budget alone talking. Boarding gets its own budget further down, and we add them back
      together at the end."
   This is an EXPECTATION-SETTER, not a disclaimer. It converts the page's most confusing
   moment into its most credible one: the tool predicted, in advance, the exact objection the
   reader was about to raise. Do not soften it into a footnote or a collapsed panel.

3. NARRATIVE EXTRACTION — the prerequisite for PR L; do not skip or defer.
   Extract EVERY templated headline into src/lib/narrative.ts: one pure function per headline,
   taking the values it interpolates, returning a string. Pure functions only, unit-testable,
   no JSX. Without this the deck becomes a second copy of the copy and they drift in one PR.

4. REMOVALS AND FIXES:
   - Remove the arrivals-premise banner at top (its content is now part of item 2).
   - Remove ASSUMPTION pills from the RESULTS page — always-on, therefore no information.
     EvidenceBadge STAYS in setup, where optional-vs-required is real information. Provenance
     moves to Chapter 9 plus per-section "what this is based on" lines.
   - Realized-wHPPV range across the 168 HOURS, not the 7 days. Label it hourly and NAME the
     hours the extremes fall on — a range with no location attached gets read past.

No engine math changes. Verify in Playwright: rail renders, scroll-spy tracks, jumps work,
philosophy statement above the first grid, no pills on results, hourly range names its hours.
```

---

## PR I — Evidence surface (Chapter 9)

```
Read CLAUDE.md, all four .claude/rules/*.md, RESULTS_COMPREHENSION_SPEC_2026-07-26.md §8.
PR H must be merged.

Success condition: an analyst can reconstruct the pipeline from this page alone and find
nothing undisclosed.

1. Pipeline walkthrough — Steps 1, 1b, 1c, 2, 3: the actual formula, its inputs, one sentence
   on why it's done that way.
2. Constants table GENERATED FROM `DEFAULTS` AT RUNTIME, not transcribed into prose. Columns:
   name, current value, what it controls, evidence tag, and the column nobody writes — "what
   changes if you move it." Prose copies of constants drift; a generated table cannot.
3. Data provenance — every number on the page classified: your data / peer cohort / modeled
   assumption. This replaces the pills PR H removed and is more informative because it's
   comparative.
4. Known approximations, plainly and without hedging. At minimum: the 48-hour
   BACKLOG_SIM_WINDOW_HOURS truncation under-counting marginal cost in chronic stretches;
   linear boarding recovery; month-scope conservation; circular no-reset; greedy set-cover
   rather than exact ILP; boarding census derived from admit timing rather than measured. A
   limitations list an analyst finds COMPLETE is worth more than one they find flattering.
5. The reconciliation invariant, presented as the correctness proof it is.
6. Decisions and their rejected alternatives — mean not median for boarding duration; why p75
   doesn't enter the point target; why severity is normalized by requirement rather than raw
   nurse-hours; why there's no dollar layer; AND the separate arrivals/boarding budget thesis
   (spec §6). Source from .claude/rules/, don't re-derive.

Written for an analyst but in plain sentences. Jargon density is not a credibility signal.
```

---

## PR J — Teaching layer

```
Read CLAUDE.md and RESULTS_COMPREHENSION_SPEC_2026-07-26.md §1, §8. PR H must be merged.
Can run in parallel with PR I.

Goal (spec §0): a manager with no stats background reads the page once and can afterward
explain to their CNO, IN THEIR OWN WORDS and without the tool open, whether their department
is understaffed, where, how much they can fix themselves, and what the rest costs.

1. `ConceptCallout` — collapsed by default, REUSING the existing .why-toggle disclosure
   pattern (do not invent a second idiom). Each concept appears exactly ONCE, at first use:
     wHPPV                          (Ch.2) nurse-hours per patient; the unit that lets you
                                           compare against other EDs
     Front-loaded nursing           (Ch.2) work lands at arrival, not at census peak — which
                                           is why demand peaks before the department FEELS
                                           busiest
     Averages under-staff you half  (Ch.2) staff to the average and by construction you're
       the time                            short on every busier-than-average day
     Right total != right shape     (Ch.4) two schedules with identical hours can perform
                                           very differently
     Depth beats spread (convexity) (Ch.4) 4 short for one hour is worse than 1 short for four
                                           hours — which is why peaks get protected
     Two budgets, one department    (Ch.6) arrivals and boarding are different demands;
                                           blending them hides both

2. ONE interactive, not six. Convexity is the least intuitive and most load-bearing (it is
   literally the solver's objective) and prose does it badly: a side-by-side of the same 10
   nurse-hours of shortfall, spread thin vs. concentrated, showing the severity score for
   each. Use the real `severity` function from engine/solver.ts, not a mock.

GUARDRAILS: no glossary page (nobody reads one). Collapsed by default so a returning user
isn't re-taught. Every headline stays a COMPLETE QUOTABLE SENTENCE with numbers interpolated.
```

---

## PR K — Input integrity + boarding copy + constrained boarding reallocation

```
Read CLAUDE.md, .claude/rules/boarding-seasonality.md, .claude/rules/template-parsing.md, and
RESULTS_COMPREHENSION_SPEC_2026-07-26.md §6.3, §10. PR F must be merged.

A real department's upload silently produced wrong numbers in two ways. Neither was the user's
fault; neither was surfaced.

1. CROSS-FIELD CONSISTENCY CHECK. Their Scalars mean boarding duration is 10.02 hrs; their
   monthly means average 6.36. The engine ratios them, scaling annual boarding DOWN 37%
   (17,823 hrs shown vs ~28,100 implied by the scalar) with NO warning. When the monthly/DOW
   means and the scalar baseline disagree by more than a tolerance (~15%), SAY SO, name both
   numbers, and say which one the calculation used. DO NOT auto-correct — the manager knows
   which source is trustworthy and the tool does not.

2. OUTLIER FLAGGING. Their monthly means swing 4x (Jan 15.1 vs Mar 4.0). Flag implausible
   dispersion as "possible small-sample months" without refusing the input.

3. MISSING-INPUT CONSEQUENCES AT RESULTS TIME, not just setup time. Their ESI Mix tab is
   entirely blank so acuity weighting is off; the results page should say once, plainly, what
   that means for what they're reading.

4. REWRITE BOARDING METHODOLOGY COPY FROM APOLOGY TO SHOPPING LIST. Today it dwells on what's
   derived. Invert it: state what was computed, then name the better data that would replace
   the derivation (measured hourly boarding census, actual boarding hours by month, real LWBS
   rate) and roughly where it lives. Ben: "if there is better data / a better way to do this,
   I should look into getting it rather than relying on derivation." Apply the same inversion
   to every ASSUMPTION-flavored copy block on the page.

5. CONSTRAINED BOARDING REALLOCATION (spec §6.3) — at the END of the boarding chapter:
   "if you can't get additional hours for boarding, here is the least-bad placement of what
   you already have." Same parameter-swap technique as Scenario B, run against COMBINED
   arrivals+boarding demand at current total hours. Presented as a COMPROMISE WITH ITS COST
   NAMED, never as the recommendation — it necessarily takes from arrivals coverage to cover
   boarders, and the page must show what that costs on the arrivals side. This is the honest
   version of what most departments already do by accident, which is exactly why seeing it
   costed is persuasive.
```

---

## PR L — PPTX export

```
Read CLAUDE.md and RESULTS_COMPREHENSION_SPEC_2026-07-26.md §9. PRs H and I must be merged —
this reads src/lib/narrative.ts (H) and the method content (I).

- pptxgenjs, client-side. The no-backend constraint holds; nothing is uploaded anywhere.
- SLIDE TITLES ARE THE NARRATIVE SENTENCES, pulled from src/lib/narrative.ts — the SAME
  functions the page renders. "Your nights carry 185 hours a week beyond what arrivals
  justify," never "Boarding Analysis." This is the entire point of the feature. Do not write a
  second set of titles.
- Deck mirrors the chapter rail: title -> what your department demands -> what you staff
  against it -> could moving hours fix it -> what's left -> boarding -> BOTH BUDGETS TOGETHER
  -> the ask + finance-partner worksheet -> method & limitations.
- METHOD & LIMITATIONS ALWAYS INCLUDED, never optional. The deck that drops its limitations
  slide is the one that gets torn apart in the room.
- Grids and heatmaps as NATIVE PPTX TABLES with cell fills, not images — editable, and they
  survive being pasted into someone else's deck, which is where these slides actually end up.
- SPEAKER NOTES carry the plain-English explanation for each slide, from the same
  ConceptCallout / "why" text. The manager presenting has never given this talk before; the
  notes are what let them sound like they understand it. That is the §0 test.
- Skip boarding and shift-menu slides entirely when not computed — no empty placeholders.

Verify in Playwright: click export, a .pptx downloads, opens with expected slide count and
sentence-style titles, for (a) a full dataset and (b) an arrivals-only dataset where boarding
is absent.
```
