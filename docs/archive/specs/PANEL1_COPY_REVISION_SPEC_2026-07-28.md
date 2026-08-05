# Panel 1 ("Your current staffing") copy & queue-curve revision — 2026-07-28

Governing chat: a Cowork planning conversation working through Panel 1's copy line by line.
Everything in this file was decided with Ben directly — nothing here is a re-derivation.
**Scope: Panel 1 only** (`screens/dashboard/Panel1.tsx` and whatever engine/lib helpers it
needs). Do not touch Panel2/3/4/5, StepBar, or VisualFrame's shared mechanics beyond what's
strictly required to drop one toggle option (Section 6). Ben is auditing this panel once it's
built, then will scope Panel 2 onward in a separate chat — don't get ahead of that.

**How to work:** implement everything below end to end — code, tests (`npm test`, `npm run
build`, `oxlint`, `npm run test:e2e`), a Playwright screenshot review of the rendered panel,
and a `.claude/rules/` update per this repo's own AUTOMATIC MAINTENANCE convention in
CLAUDE.md. Work autonomously; Ben is stepping away and does not want check-ins for
confirmation. **Only stop and ask if you hit a genuine ambiguity this spec doesn't resolve**
— not for implementation-level judgment calls already described here.

**Before writing anything:** read the current source of `Panel1.tsx`, `engine/hiddenBoarding.ts`
(if it still exists), `components/WhppvHeatmap.tsx`, `components/VisualFrame.tsx`,
`engine/backlog.ts`, `lib/whenPattern.ts`, and `lib/averageDay.ts`. CLAUDE.md warns its own
docs can lag the code by a revision — verify every claim below against the actual current
source rather than trusting this file's description of "what exists today."

---

## 1. Realized wHPPV headline — drop the peer-band numbers, drop percentile framing

Current: "Your current staffing realizes 1.71 wHPPV, running within the peer band
(1.53–2.06 for your volume) at 1548 hours/week."

Replace with a categorical (below / within / above) comparison against the peer band —
**no raw band numbers restated, no percentile computed.** An earlier draft of this considered
naming a percentile position; Ben decided that overweights the comparative position — just
say whether it's in range.

Template (three branches on band position, reuse whatever band-position logic already
determines below/within/above for this stat — don't invent a new comparison):

- Within band: "Your current staffing realizes {wHPPV} wHPPV at {hours} hours/week — within
  the typical range for departments your size. Averaged across the week, your staffed hours
  look reasonable for your volume."
- Below band: "...— below the typical range for departments your size. Averaged across the
  week, your staffed hours run light for your volume."
- Above band: "...— above the typical range for departments your size. Averaged across the
  week, your staffed hours run rich for your volume."

**"Week," not "year":** confirmed with Ben. Everything driving this stat (arrivals, the
solved grid) comes from one representative week, reused as a stand-in for a typical week —
"year" would falsely imply annual variation this tool doesn't model for arrivals.

## 2. Boarding ratio line — plain statement, nothing else

Current: a full sentence describing the ratios, followed by a paragraph warning that RN-only
figures understate BH boarding's true operational cost.

Replace with a single plain line stating the ratios only — **no warning/understatement
callout on this page at all** (it already lives on the setup page; don't add a pointer back
to it either, Ben doesn't want the reference). Pull the actual configured values
(`boardingRatioTarget`/`bhBoardingRatioTarget`) — don't hardcode example numbers.

Something like: "Medical boarding is staffed at 1:{boardingRatioTarget}, behavioral-health
boarding at 1:{bhBoardingRatioTarget}."

## 3. Remove the "effective wHPPV after boarding" paragraph entirely

Current: "Of the nursing time per visit you staff, {X} wHPPV effectively remains for your ED
patients once boarding is accounted for. This number is not compared to the peer band
above..."

Delete this paragraph outright — Ben considers it duplicative with the wHPPV-band line
(Section 1) and whatever the reworked queue section (Section 5) now conveys about the
department's overall situation. No replacement text needed.

## 4. Day/night paragraph → real per-shift diagnostic

**This is the one genuine engine change in this spec, not just copy.** The current text is
two hardcoded sentences keyed to a fixed 07:00–19:00 / 19:00–07:00 calendar split
(`engine/hiddenBoarding.ts`'s day/night blocks), which doesn't generalize to an 8-8 split, a
3x8 menu, or any shift structure that doesn't happen to land on a 12-hour clock boundary.

**Rebuild this per actual shift in the shift menu**, not fixed calendar blocks. For each
shift `s` in the (already sorted-by-startHour) shift menu:

- `staffedHours(s)` = total hours `s` is staffed across the representative week (headcount ×
  `s.lengthHours`, summed over the 7 days), from `currentStaffingGrid`.
- `requiredHours(s)` = sum of `hourlyRequirement` over the global hours `s` covers (reuse
  `shiftGlobalHours`/`coveringCellsByGlobalHour` — the same attribution convention already
  used for boarding priority ranking and the backlog shift-diagnostics, don't invent a new
  one).
- **Arrivals status** — compare `staffedHours(s)` against the sum of `bandFloorHourly`/
  `bandCeilingHourly` over those same covered hours (the same per-hour peer band already
  driving the heatmap's color, not a new arbitrary threshold): below the floor-sum →
  `understaffed`; above the ceiling-sum → `overstaffed`; between → `appropriate`.
- **Boarding coverage** (only when `result.boarding` is present) — `surplus(s) = max(0,
  staffedHours(s) - requiredHours(s))`; `boardingNeed(s)` = sum of
  `boarding.cellBoardingRnHours` over `s`'s covered hours; `boardingCovered(s) = surplus(s)
  >= boardingNeed(s)`.

**Merge shifts that would produce an identical sentence.** Group shifts by the tuple
`(arrivalsStatus, boardingCovered)` — when boarding is absent, group by `arrivalsStatus`
alone. Shifts in the same group get combined into one sentence, joining their labels ("Day
and Evening are...", or a comma-separated list + "and" for 3+), with their `staffedHours`/
`requiredHours`/`surplus`/`boardingNeed` summed across the group for the numeric clause.

**Template** (per group):

"{Shift name(s)} {is/are} {understaffed / overstaffed / staffed about right} for arrivals on
an average shift, {and/but} {doesn't/does} have enough nursing hours left over to also cover
{its/their} boarding load."

Conditional trailing clause, only appended when `arrivalsStatus === 'overstaffed'`:
- if `boardingCovered` is false: "The extra {surplus} hours {it carries/they carry} don't
  fully close the {boardingNeed} hours of boarding demand there."
- if `boardingCovered` is true: "and those extra hours are enough to cover it."

When `result.boarding` is null, drop the "and/but does/doesn't cover boarding" clause
entirely — render just "{Shift name(s)} {is/are} {understaffed / overstaffed / staffed about
right} for arrivals on an average shift." — same graceful-degradation convention the rest of
this app already follows for boarding-absent states.

**Gate this whole section on `hasCurrentStaffing`**, same as the rest of Panel 1 — there's no
current-staffing grid to diagnose without it.

## 5. Queue section — real backlog, not shape-only; average-day description; honest framing

### 5a. Which curve

Panel 1's queue strip currently draws (or per the spec history, is supposed to draw) the
CYCLICAL backlog curve. **Change it to the ACTUAL curve** (`BacklogResult.backlog`, not
`.cyclicalBacklog`) — Ben wants this panel to describe the department's real, current
situation, not a shape-only hypothetical. Compute it per Panel 1's own toggle (Arrivals /
Boarding / Combined — see Section 6 for which toggles remain) by pairing
`currentStaffingGrid`'s actual capacity with that toggle's own demand curve — i.e.
`computeBacklog(currentStaffingGrid, thatTogglesRequirementCurve, shiftMenu,
bandCeilingHourly)`, reading `.backlog`/`.longestStreakStart`/`.peakAt`/`.longestStreakHours`
(the actual fields), never the `.cyclical*` ones.

**This is a scoped, deliberate exception to how the rest of the results page currently
treats the queue strip** (elsewhere it's meant to isolate shape from size). A memory note
already records that Ben intends to extend this "real curve for whatever grid is currently
shown" treatment to other panels in future chats — don't take this as license to change
Panel 2 onward in this same pass.

### 5b. The sentence — average-day pattern, not per-specific-day

The old sentence named specific different days for build vs. peak (e.g. "builds ... around
Tue 08:00, peaks around Mon 10:00") — confusing and not what Ben wants. Replace with a
description of the **average day**: compute the mean backlog value at each hour-of-day
across all 7 days (reuse `lib/averageDay.ts`'s `averageDay()` directly on `backlog.backlog`)
and describe build/peak/clear from that 24-point curve:

- **Build** = the first hour where the averaged curve starts a sustained climb away from its
  own daily low point.
- **Peak** = the hour of the averaged curve's maximum, plus the nurse-hours value there.
- **Clear** = the first hour after the peak where the averaged curve returns to near its own
  daily low point (reuse the existing relative "caught up" logic —
  `caughtUpThresholdForHour`-style, ~10% of that hour's own averaged requirement — applied to
  the averaged curve, not a new absolute threshold).
- **If it never returns to near-baseline** before the day resets, say so honestly instead of
  naming a fabricated clear time — e.g. "...and doesn't fully clear before building again the
  next day." Don't force a clear-time onto a chronically-behind department.

**Weekday vs. weekend split:** compute this same averaged-day curve separately for
weekday (Mon–Fri) and weekend (Sat–Sun) subsets. If the two differ meaningfully — flagged as
a first-pass default, tune later if it misfires: peak hour differs by more than ~3 hours, OR
peak magnitude differs by more than ~40% — describe them as two separate sentences (weekday
pattern, weekend pattern). Otherwise, one combined sentence for the whole week is enough.
Document this threshold in the `.claude/rules/` update (Section 8) as a tunable display
heuristic, not load-bearing math — same convention this codebase already uses for similar
constants.

Frame the sentence as a model, not an observation: "Based on your schedule, the queue is
modeled to build starting around {X}, peak around {Y} (about {Z} nurse-hours behind), and
come back down by around {W}" (or the never-clears variant above).

### 5c. Replace the long "compressed care, not a queue" callout

The current callout claims nurses "don't let a line form, they go faster," implying the
model doesn't already account for that — false as of the 2026-07-28 backlog-recurrence
rewrite, which explicitly models bounded catch-up capacity ("stretch," capped at the peer
p75-equivalent ceiling) on top of ordinary idle capacity ("spare"). Replace with something
short and accurate:

"This is a modeled estimate based on your schedule and demand — not measured wait-room data.
It already assumes your nurses can absorb some of a backlog by working through it, up to a
limit; what's shown here is what's left beyond that."

Keep this in the surrounding prose paragraph, not packed onto the chart itself (see 5d).

### 5d. Chart/strip labeling — minimal, keep it small

Ben flagged this chart is small and can get cluttered fast. Keep chart-level labeling to the
minimum needed to be legible, and let the prose paragraphs (5b/5c above) carry the fuller
explanation rather than captioning the chart itself:

- Demand-vs-capacity chart: a compact two-item legend (small colored swatch + one word each
  for "Demand" / "Capacity"), one y-axis label ("Nurse-hours"), and a handful of x-axis tick
  marks (e.g. 12a/6a/12p/6p for the default average-day view; more when the "full week"
  toggle is expanded) rather than labeling every hour.
- Queue strip: one short label ("Your current backlog") — no inline caption explaining the
  mechanism; that lives in the 5c paragraph above/near the frame, not on the strip itself.

## 6. Drop the "Effective wHPPV" toggle

Remove this `VisualFrameView` from Panel 1 entirely — Ben doesn't find the inverted
wHPPV-vs-target chart useful, and its heatmap is identical to the Combined view's anyway (no
unique heatmap data lost by removing it). Remove the toggle button, its capacity-line
inversion logic, and any explanatory copy that only exists for it. Panel 1 keeps three
toggles: Arrivals, Boarding, Combined.

## 7. Heatmap — show per-shift split when multiple shifts cover an hour

For any global hour covered by more than one shift (this department runs three overlapping
12s, so this is common, not an edge case), show each covering shift's own headcount rather
than one summed number — e.g. "7+4" instead of "11," ordered by each shift's `startHour`.
Single-shift hours keep showing one plain number, unchanged. Put the total plus a
labeled per-shift breakdown in the cell's hover tooltip so nothing is lost, just not
front-and-center in the cell text. Use `coveringCellsByGlobalHour` to get the per-shift
headcounts for a given hour — same attribution convention as everywhere else in this app.

Ben's own words: try it, and if it reads as too busy once rendered, he'll ask to revert to a
plain sum — so build it, then include a screenshot in your verification pass so this
judgment call can actually be reviewed rather than assumed fine.

## 8. Heatmap legend rewrite

Replace the current legend text. Drop the old "Color is against each hour's OWN typical
range (peer 25th–75th percentile)..." explanatory line and the old three-swatch
leaner/typical/richer wording. New legend content:

- "Each cell shows the number of nurses on duty, split by shift when more than one covers
  that hour." (ties to Section 7)
- Color explanation, phrased relative to the band, not with absolute wHPPV numbers (the band
  varies by hour, so a single fixed number in the legend would be inaccurate — this mirrors
  why the legend previously had its numeric range removed): "Red = fewer nurses than typical
  for that hour, judged against your peer group's typical range for that specific hour —
  not one number for the whole week. Blue = more than typical. The further off, the more
  color; hours close to typical stay pale."
- "! Under the ENA on-duty floor" — **only render this legend line when at least one cell in
  the currently-displayed grid actually has that flag.** Hide it otherwise; no reason to
  explain a symbol nobody sees on this department's data.

**Confirm the underlying color mechanism already matches this description** (per-hour band,
asymmetric ramp, subtle near the band, more saturated further out) before treating this as
copy-only — if the rendered heatmap doesn't already behave this way, flag it, don't silently
reimplement the color math to match new legend text without checking first.

---

## Verification checklist (don't skip any of these)

- `npm run build`, `npm test`, `oxlint`, `npm run test:e2e` all clean.
- A Playwright screenshot of Panel 1 in at least two states: current staffing entered (all
  three toggles), and current staffing absent (confirms the CTA/empty state still renders
  sensibly with nothing above referencing removed content).
- Confirm the per-shift day/night rewrite renders sensibly for both a 2-shift menu (Day/
  Night) and a 3-shift overlapping menu (this department's own 3x12) — the merge-when-
  identical logic should collapse the 2-shift case correctly and handle the 3-shift case
  without producing three near-duplicate sentences unless they're genuinely different.
- Confirm the heatmap split-shift cells and the new legend render together correctly, and
  that the ENA-floor legend line actually disappears on a dataset with zero flagged cells.
- Update `.claude/rules/results-redesign.md` (a new dated section, following this file's own
  convention) with what changed, the weekday/weekend split threshold chosen, and the merge
  logic for the per-shift diagnostic — plus CLAUDE.md's Module/Screen Map entries for
  `Panel1.tsx` and `engine/hiddenBoarding.ts` if their shape changed enough to need it.
