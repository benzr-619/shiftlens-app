# ShiftLens — Results Page & Setup Redesign Spec

**Date:** 2026-07-24
**Status:** Planned in Cowork, ready for a Claude Code implementation pass. This is a root-to-branch redesign of the Results dashboard — sections should be rebuilt to match the narrative below, not preserved just because they exist today. Cross-reference against the current `CLAUDE.md` / `.claude/rules/*.md` for exact current-state mechanics before touching code; this doc supersedes the *shape* of the results page but the underlying engine math (allocation, solver, boarding convolution) is unchanged except where explicitly called out below.

---

## 0. Why this redesign — read this first, everything else answers to it

**This section is the point of the whole document.** Everything from Section 1 onward is one set of ideas for accomplishing this "why," arrived at in a planning conversation — none of it is sacred, including anything about how setup or the results page work today. If an implementation detail below stops serving what's written here, change the detail, don't preserve it out of inertia. When in doubt about a design choice not explicitly specified, resolve it by asking "which option better serves understanding or communication, per this section" rather than "which is closer to the current build."

ShiftLens is almost never used to design a department from scratch — a manager already has a staffing pattern. The tool's job is to help them **understand** that pattern: how it compares to what the math says demand requires, how budget/productivity is actually spread across the week, and where boarding is quietly eating capacity. A goal that wasn't explicit before but is now central: the page should build enough understanding that a manager can use it to **communicate** — explaining staffing decisions to their own staff, and making a numbers-based case to their boss for budget or headcount changes. No export feature is being built for this — the page itself needs to teach the story well enough that the manager can carry the insights into their own conversation or deck.

Two goals, restated plainly, that every section should be checked against:
1. **Understanding** — help the manager see where budget/productivity is going, where the idealized recommendation and their actual staffing diverge and why, and where boarding is a real, quantified drag on capacity.
2. **Communication** — every section should produce something a manager could say out loud or paste into a message, not just a number they'd have to interpret for someone else first.

Everything below should read as one continuous story, top to bottom, even though the story changes shape depending on what the user has entered (current staffing provided or not, ESI or not, monthly seasonality or not, etc).

---

## 1. Setup flow changes

- Add an **optional current-staffing grid** to the shift-menu setup step (`ShiftMenuStep.tsx` or wherever shift menu is finalized) — same shape as the existing per-shift grid (day × shift-menu column), blank by default. This is a genuinely new capture point; today current staffing is only entered on the results page.
- The results page's opening section depends on whether this was filled in (see Section 2.1). If skipped, the results page shows a lightweight "add baseline grid for comparison" CTA in that slot instead, not a full analysis block.
- Editing this grid later should still be possible from the results page (see 2.1) — setup is where it's *introduced*, not the only place it can be touched.

**ESI mix:** keep it exactly as-is in the engine, template, and setup flow (`acuityWeights`, `esiMix`, the ESI Mix template tab — no removal). Only the results-page confidence-caveat banner ("No ESI mix provided — core allocation is running on raw volume only") goes away — see Section 3.

**Shift-menu flexibility preferences (feeds Section 2.3):** on the same shift-menu setup step, ask the user which flexibility axes they're open to for the idealized recommendation — static (none), flexible start times, flexible shift count, flexible shift length (8s/10s/12s), any combination. This is captured once at setup, not discovered/toggled only on the results page — the results page's flexibility feature (2.3) reads this preference as its starting state, though it should probably still be adjustable from the results page too, not locked in from setup alone.

---

## 2. Results page — top to bottom

**Unified design pattern, applies to every subsection below (2.1, 2.2, 2.5, 2.6):** each section opens with a short, *templated* one- or two-line headline — a fixed sentence structure with numbers interpolated, not freely generated prose — followed by supporting stat cards and/or a grid as the detail layer. This is the same mechanism the current "What this schedule means" panel already uses successfully; the change is extending it everywhere instead of leaving some sections as bare stat-card grids and others as prose. Reasoning: a templated headline is quotable/communicable on its own (serves the communication goal directly — a manager can lift the sentence into an email), and stays robust under live editing since it's not generating new language on every keystroke, just swapping numbers into a fixed structure. Free-form generated narrative (the kind that would produce genuinely analytical takes like "you're overstaffed at night to compensate for morning shortfalls") is explicitly out of scope — that requires real analysis/AI, not just data — so don't build toward that; the templated-headline pattern is the ceiling for this version.

### 2.1 Opening section: current staffing, analyzed

If a current-staffing grid was provided (setup or a prior session), the page opens with an analysis of it — not the idealized grid. Content:

- **Current realized wHPPV** — is it inside, above, or below the target/benchmark band, stated plainly.
- **The range of realized wHPPV across the week** — where and how often the department is running lean, framed with the operational reality that ED backlogs feed forward (a short hour doesn't just cost that hour — the unmet demand queues into the next one, and it's genuinely hard to recover mid-shift; the usual recovery point is an overnight arrivals drop). This is the entry point for the backlog/streak diagnostic (Section 2.4) rather than a repeat of the single-hour heatmap flag.
- **Effective wHPPV accounting for boarding**, and the **additional FTE it would take to fully cover boarding** — this previews the boarding section (2.5) but belongs here too since it's part of "how is my current staffing actually doing."

If no current-staffing grid was provided, this slot instead shows a short CTA — "Add your current staffing to see how it compares" — with an inline entry point (doesn't force a trip back to setup), and the page proceeds directly to the idealized grid.

### 2.2 Idealized grid, shown against current

The idealized grid is still live-editable (unchanged interaction from today), but now it's presented explicitly as a comparison against current staffing, not a standalone hero grid:

- Idealized grid + diff-vs-current, both visible together (not a separate "Current staffing" card lower on the page followed by a separate diff grid — collapse this into one comparison unit).
- All the diff/comparison stats (weekly hours vs. current, hours below ideal coverage, ENA floor violations, etc.) recompute live as either grid is edited.
- Add a **total-hours reconciliation** callout distinct from the cell-by-cell diff — explicitly answer "is this a *budget* gap (same shape, wrong total) or a *shape* gap (right total, wrong distribution)?" This is new: today only the cell diff exists, which conflates the two. A manager needs to know which kind of gap they have because the fix (and the ask to their boss) differs completely.

### 2.3 Shift-menu flexibility (replaces "Compare shift menus")

The standalone "Compare shift menus" section at the bottom of the page is retired — this feature absorbs it, positioned right alongside the idealized grid since it's really the same question ("is this grid as good as it could be").

- Default: the idealized grid always uses the user's **current shift menu structure** (start times, count, lengths) — never silently substitutes something else.
- User can opt into flexibility along three independent axes: different start times, a different number of shift types, different lengths (8s/10s/12s). These preferences are first captured on the shift-menu setup step (Section 1) so the results page opens already reflecting what the user said they're open to — but should remain adjustable here too, not locked in from setup alone. Toggling any of these on tells the solver it's allowed to search there.
- When flexibility is enabled, the solver **highlights** whether a more efficient spread of the *same budgeted hours* exists — shown as a comparison/option (e.g., a candidate alternate menu with its own solved metrics side-by-side), never auto-adopted into the idealized grid. This preserves the core "numbers, not a verdict" principle used everywhere else on the page.
- Also preserve the old section's manual mode: a user can define an arbitrary alternate menu by hand (e.g., "what if we ran 10s") and see it solved and compared, independent of whether solver-suggested flexibility is on. Both paths feed the same give-and-take pattern: algorithm/solver proposes, user adjusts, numbers update live.

### 2.4 Backlog / "falling behind" diagnostic (cross-cutting)

New engine concept, diagnostic only — does not feed into the solver or any budget-trim/allocation logic.

- **Formula:** rolling backlog per hour, `backlog[h] = max(0, backlog[h-1]*decay + demand[h] - capacity[h])` — carries forward across the full week with **no boundary reset** (a Saturday-night backlog can carry into Sunday), and **decays** over time rather than being a hard, undecaying queue. (Exact decay rate/mechanism is an open implementation call — see Section 5.)
- Computable against any grid (current or idealized), using whatever demand/capacity values already feed that grid's shortfall math — no new demand model needed.
- Surfaces as: longest backlog streak, roughly when it typically clears ("the overnight reset"), and which shifts are inheriting a prior shift's backlog vs. generating their own.
- Used narratively in Section 2.1 (current staffing's weekly pattern) and as a diagnostic overlay on the wHPPV heatmap — reconcile with (likely supersede, see Section 5) the existing single-hour p25/ENA-floor risk flag, since a lone short hour reads very differently from an hour that's still digging out of a two-hour hole.

### 2.5 Boarding transition

A short section whose entire job is the pivot from "here's your ED-arrivals staffing picture" to "here's what boarding costs you on top of that":

- Effective wHPPV after boarding, for both current and idealized staffing (not just idealized, as today).
- Additional FTE needed to fully cover boarding, stated plainly, as the bridge into the next section.
- No grid here — this is a short, narrative bridge, not a data section.

### 2.6 Boarding coverage recommendation

Full redesign of today's "Boarding coverage" section — replaces the annual-aggregated incremental-nurse-shift grid entirely (units didn't reconcile with the annual FTE stat — e.g. a single day showing 20 "incremental nurse-shifts" against a 6.84 FTE headline was actively confusing, not just a display nit).

- **One templated headline line**, same pattern as every other section (see the design-pattern note at the top of Section 2) — e.g. *"Covering boarding fully would take about 6.8 extra nursing FTE. The need is heaviest in [season]. Adding staffing per the plan below would cover [X]% of annual boarding hours and raise effective ED wHPPV from [current] to [Y]."*
- **One weekly grid**, shaped exactly like the idealized/current grids (day × shift-menu column), showing a **single representative week's incremental headcount** (e.g. "+1", "+2") — this is the same grid regardless of which months are toggled on. The grid's *shape* (which days/shifts get extra coverage) is informed by seasonality data in generating the default recommendation (so if winter drives the need, the default pattern can lean toward e.g. nights Mon–Wed), but the grid does not change per season — there is no "winter plan" vs. "summer plan" pair of grids.
- **No separate day-of-week toggle** — since it's already a single week-shaped grid, a day that shouldn't get extra coverage is just edited to 0 directly in the grid, same interaction as any other cell edit. Only a **month toggle** is needed, controlling scope of application ("which months am I applying this weekly plan to"), not the pattern itself. The resulting %-of-annual-boarding-hours-covered, FTE, and effective-wHPPV stats scale with however many months are currently toggled on and whatever the grid's cells (including any manually zeroed-out days) actually contain.
- **Default funded level:** since covering boarding year-round usually isn't realistic, default the grid to the **minimal added coverage needed to bring effective wHPPV back above the p25 benchmark band** (reuse the existing `fundedCountToReachWhppv` mechanism, adapted to this single-grid model) — framed as a recommended starting point, not a floor or a ceiling. Full year-round/100% coverage remains available as a reference point but not the default.
- Grid is directly editable, same interaction as the current-staffing and idealized grids — live stats recompute as the user hand-adjusts.
- Explicitly reframe away from "hold nurses vs. additive ED coverage" as a per-shift decision — that distinction is a staffing *tactic* choice the manager makes given the recommended coverage need, not something the grid should imply cell-by-cell. Keep the existing "how is this calculated" explainer, updated for the new mechanism.

---

## 3. Explicit removals

- The top-of-page ESI-mix confidence-caveat banner ("No ESI mix provided — core allocation is running on raw volume only"). ESI mix itself, and the underlying acuity-weighted allocation, stay in the engine/template unchanged — this is a UI-copy removal only, not an engine change.
- The standalone "Compare shift menus" section — absorbed into 2.3.
- The old boarding "Explore coverage for specific months/days" annual-aggregated grid and its month-single-select/day-toggle mechanism as built today — replaced by 2.6's single-week-grid-plus-scope-toggles model.
- The separate "Current staffing" card + separate "Difference (idealized − current)" grid as two distinct blocks — collapsed into one comparison unit per 2.2 (the underlying grids/diff math survive, just the layout doesn't stay split).

---

## 4. New/changed engine work required

1. **Backlog/streak diagnostic** (Section 2.4) — new pure function(s) in `engine/`, diagnostic-only, no solver interaction. Needs its own evidence-status tag (this is a modeling ASSUMPTION, same rigor as the boarding convolution).
2. **Shift-menu flexibility search** (Section 2.3) — new solver capability: given a budget and a set of flexibility axes (start time / shift count / shift length), search for a candidate alternate menu and return it alongside its solved metrics for comparison. This is a genuine reversal of the previously-documented "no auto-optimizing shift-menu search" decision (`CLAUDE.md` Section 7) — confirmed intentional by Ben in this planning conversation, but flag it prominently in the PR/commit since it contradicts a documented prior decision.
3. **Boarding weekly-grid redesign** (Section 2.6) — replaces `deriveBoardingCoverageCells`'s annual-aggregation model with a single-week generation function whose *pattern* is informed by seasonality-weighted ranking but whose *application* is scope-scaled by month/day toggles. `restrictPrioritySlotsToActivePeriods` and `boardingHoursCoveredByGrid` (added 2026-07-23) are probably close to reusable for the "scope toggles scale the stats" half of this — the part that needs new logic is generating one representative weekly pattern instead of a per-month-cell grid.
4. **Total-hours reconciliation stat** (Section 2.2) — likely simple arithmetic (aggregate variance vs. cell-by-cell variance), not a new modeling concept, but needs a clear "budget gap vs. shape gap" framing in the UI copy.

---

## 5. Open implementation judgment calls (flag for review, don't silently decide)

- **Backlog decay mechanism:** Ben confirmed it should decay and not reset at a week boundary, but the exact decay function (rate, whether it's a fixed fraction per hour, whether capacity above demand actively pays it down faster than passive decay, etc.) hasn't been specified. Propose a simple, explainable formula and confirm with Ben before finalizing — don't let this quietly become a load-bearing number without sign-off, same caution the codebase already applies to `effectiveEdWhppvAtCoverage`.
- **Heatmap risk flag vs. backlog streak:** decide whether the backlog diagnostic supersedes the existing single-hour p25/ENA-floor red-outline flag, or layers alongside it as a second indicator. Leaning toward supersede (a streak is strictly more informative), but confirm.
- **"Hours below ideal coverage" stat's fate:** not explicitly revisited in this redesign conversation — likely still useful as a headline number even once the backlog diagnostic exists (they answer different questions: total shortfall hours vs. how backlog compounds), but check it doesn't end up redundant/contradictory once backlog streaks are visible.
- **Current-staffing grid's presence on the results page:** confirm it's shown read/edit alongside the idealized grid in 2.2 (this doc assumes so, since the diff needs both), not display-only text stats with editing only possible back in setup.

---

## 6. Suggested Claude Code kickoff prompt

*(Paste this into a fresh Claude Code session once ready to build — recommend splitting into a few smaller PRs rather than one giant one, roughly along the section boundaries above.)*

> Read `RESULTS_PAGE_REDESIGN_SPEC_2026-07-24.md` at the repo root in full before starting. This is a root-to-branch redesign of the Results dashboard, planned in a Cowork session — sections should be rebuilt to match the new narrative, not preserved out of inertia. Cross-reference `CLAUDE.md` and `.claude/rules/*.md` for current-state engine mechanics before changing anything (the underlying allocation/solver/boarding-convolution math is unchanged except where the spec explicitly calls out new engine work in Section 4).
>
> Start with [pick one]: (a) the setup-flow current-staffing-grid addition (Section 1) since other sections depend on it, or (b) the ESI-mix banner removal and old-section removals (Section 3) as a low-risk warm-up, or (c) the boarding section redesign (Section 2.6) as the most self-contained rework.
>
> Flag Section 5's open judgment calls back to me before finalizing rather than silently picking an answer — especially the backlog decay formula and the shift-menu-flexibility solver reversal, since the latter contradicts a previously documented "no auto-optimizing shift-menu search" decision in `CLAUDE.md` Section 7.
>
> After any session where you resolve one of Section 5's open calls, or discover a spec-to-code translation gotcha, update `.claude/rules/<area>.md` per the AUTOMATIC MAINTENANCE convention at the top of `CLAUDE.md`.
