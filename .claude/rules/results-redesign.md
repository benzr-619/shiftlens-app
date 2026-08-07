# Results page & UI — current state

Live behavior only. **Full history: `docs/archive/rules/results-redesign.md`** (~184 KB — three
page architectures, twelve numbered reversals, and every flagged judgment call). Read the
archive before reversing anything listed under "Load-bearing history" below.

Filename kept as `results-redesign.md` — ~20 source comments reference it.

---

## Page architecture: five panels, one scrolling page

`DashboardScreen.tsx`: `.dashboard-topbar` ("<- Back to setup" only) -> `.results-welcome` ->
`<StepBar>` (horizontal scroll-spy, 5 entries) -> Panel1..Panel5 -> `.export-row`.
No router, no tabs, no sidebar.

| Panel | Question | Key engine calls |
|---|---|---|
| 1 | What your department demands, and what you staff against it | `computeBacklog`, `computePerShiftDiagnostic` |
| 2 | Could moving hours fix it? | `computeScenarioB`, `computeCombinedReallocation` |
| 3 | What would it take to fully cover the department? | `fullCoverageCombined` (PR B) |
| 4 | ShiftLens Solver staffing | `result.grid`, `searchFlexibleMenus`, `solveFullCoverageWeekWithTrajectory` |
| 5 | Test it yourself (sandbox) | `computeSandbox`, `computeBacklogFromCapacity`, `bestUnitToAdd/Remove` |

2026-08-05: `computePerShiftDiagnostic`/`shiftDiagnosticSentence` (row 1) is now also called by
Panels 2, 4, and 5, each against its own active-toggle grid — see the Panel 5 section below.

**Deleted, do not resurrect:** `CoreGridTab`, `CurrentStaffingAnalysis`, `ScenarioBSection`,
`HiddenBoardingSection`, `BoardingTransition`, `ConstrainedReallocationSection`,
`FundingAskSection`, `FinancePartnerWorksheet`, `SynthesisSection`, `BoardingCoverageSection`,
`ShiftMenuFlexibilitySection`, `ChapterRail`, `CompareTab`, `EvidenceSurfaceSection`. Content was
absorbed into the five panels (evidence surface removed 2026-08-05 — `lib/constantsMetadata.ts`
now unused, since PPTX export dropped its Method & Limitations slide; see below).

## `VisualFrame` — the one shared visual, reused by all five panels

Three stacked elements on a shared x-axis: demand-vs-capacity chart (defaults to the **average
day**, 24 points; full week is an expand toggle) + queue-depth strip + `WhppvHeatmap`.

- Takes a `VisualFrameView[]`; the panel decides the toggle list. The frame doesn't know which
  panel it's in.
- Optional **controlled mode** (`activeKey` / `onActiveKeyChange`) for panels whose own
  left-column stats must track the active view (2, 4, 5). Defaults to uncontrolled (Panel 1).
- Toggling cross-fades via a CSS `key`-remount, not per-cell tweening.
- `queueDepth168: null` renders a **deliberately blank** strip — Panel 3's requirement, not a
  missing-data fallback.
- Which curve to pass: **Panel 1 passes the ACTUAL backlog curve** (per-toggle,
  `computeBacklog(currentStaffingGrid, thatToggle'sDemandCurve, ...)`), a scoped exception.
  Other panels pass the cyclical curve.
- 2026-08-05 fix — a "combined" queue-depth strip must never feed a merged demand curve straight
  into the recurrence (flat deficit-carry, previously identical across both Panel 5 toggles — a
  real bug). Net boarding's claim out of capacity FIRST, then run the real arrivals recurrence on
  what's left — `computeBacklogFromCapacity` (`engine/backlog.ts`), Panel 2 'combined' + Panel 5.

## Heatmap (`WhppvHeatmap.tsx`) — current mechanism

- **Cell number** = headcount. When more than one shift covers that hour, split by shift
  (`perShift`, e.g. "7+4"), ordered by `startHour`. Realized wHPPV (`onDuty/arrivals`) lives in
  the tooltip only.
- **Cell color** — REVERSED BACK 2026-08-05 to a **single week-level** band: each cell's own
  realized wHPPV (`onDuty/arrivals`, `null`/no ink when `arrivals` is 0) against ONE
  `computeColorDomain(annualVisits, wHppvTarget)` result (`lib/whppvColorDomain.ts`), normalized
  by `domain.target` so `ratioVisual`'s asymmetric-ramp constants apply the same way regardless
  of which panel's wHppvTarget is in play. `WhppvHeatmap` takes a `whppvBand: WhppvColorDomain`
  prop (computed once per panel, passed through `VisualFrame`'s own `whppvBand` prop). Read the
  load-bearing history entry below before reversing this again — this is the SECOND reversal,
  undoing the 2026-07-26 per-hour-band change, because a per-hour band, while the same
  underlying peer band, is rescaled by each hour's own volume — an hour named as the week's
  real wHPPV extreme in the panel's own prose (`hourlyWhppvRange`) could still land inside its
  own volume-scaled band and render uncolored, a direct prose-vs-heatmap mismatch. `EngineResult
  .bandFloorHourly`/`bandCeilingHourly` still drive `computePerShiftDiagnostic` and the solver's
  floor/ceiling reporting — unrelated to heatmap color now.
- **Asymmetric ramp:** lean saturates fast (a small dip reads alarming), rich ramps slowly and
  clamps ~2x. Both gamma-eased. `RICHER_RGB` is **saturated** blue, not muted — a real
  8-nurses-against-4 hour rendered pale gray was the single most actionable finding on a real
  page, and muting made it invisible.
- **Only per-cell flag left:** the ENA on-duty floor (red inset outline + "!"), and its legend
  line renders only when some cell actually trips it. The p25 single-hour red-outline flag and
  the backlog spine overlay are both **retired**.
- **Shift-boundary rules** land at each distinct `startHour`, labeled in the gutter.
- **Legend** states the numeric peer-typical range (`whppvBand.low`–`whppvBand.high` wHPPV) —
  restored, since there's a single range again to show.
- **Tooltips** — heatmap cells and the marginal-curve markers (`MarginalReturnsCurve.tsx`) both
  render through a shared JS-driven tooltip (`components/HoverTooltip.tsx` +
  `lib/useHoverTooltip.ts`), not native `title`/SVG `<title>` — those didn't fire reliably in
  practice. Don't reintroduce native title attributes for either without checking.

## Conventions

- **Shift columns always sort by `startHour`**, never array order (`sortShiftsByStartHour`).
- **Day-of-week DISPLAY order is Mon-Sun everywhere** via `lib/dayOrder.ts` (`DISPLAY_DAY_ORDER
  = [1,2,3,4,5,6,0]`). The engine's `day 0 = Sunday` index never changes. Every day-rendering
  component imports the one shared helper — local re-definitions are exactly how these drift.
- **Collapsed-by-default "why" explainers** (`.why-toggle` / `.why-explainer`,
  `ConceptCallout.tsx`) are the one disclosure idiom. Don't invent a modal or tooltip variant.
- **Peer-range stats are below-floor-only** — "X% of hours fall below your peer-typical floor,"
  never "outside the range." The solver minimizes queue cost, not closeness to the band, so it
  can legitimately push hours above p75; counting those as failures made a safer schedule look
  worse.
- **Evidence badges are inline**, next to the field they describe, and live on **setup screens
  only** — on results they were always-on and therefore carried no information.
- **Panel 5 alone** distinguishes ED nurses from hold nurses. Nowhere else on the page.

## Enforced by test — `src/lib/__tests__/copyLayer.test.ts`

Source-greps `src/screens` + `src/components` and fails on the bare words **"budget"**,
**"severity"**, **"idealized"** in UI text. Say "target-implied hours", "queue cost",
"recommended"/"ShiftLens Solver". Two narrow allowlist entries exist (an unavoidable import
alias; Panel 4's own `ShiftLens Idealized Staffing` H2). This guardrail has caught real drafts
three separate times — it works, keep it.

## PPTX export (`lib/pptxExport.ts`)

R13 (2026-08-07): **fixed 10-slide deck**, replacing R12's title -> current-staffing -> sandbox
-> delta -> Method & Limitations (dropped entirely). Panels 1/3/5 all feed it now: title;
current staffing (P1) + grid; WHPPV range + full-week arrivals chart; boarding impact +
full-week arrivals+boarding chart; peak lag/weekday backlog + avg-day backlog chart;
full-coverage ask (P3's `fullCoverage`/`fullCoverageCombined`) + full-week chart at full
coverage; the sandbox scenario (P5, recommendation if `sandboxEdGrid`/`sandboxHoldGrid` are
`null`) — ED(+hold) tables; comparison to current staffing + `MarginalReturnsCurve`'s coverage
curve as a native chart; P5's two full-week demand-vs-capacity views (arrivals; +boarding).

Everything native (tables, `addChart` line charts, brand mark as a shape), no images, dynamic
`import()`. Prose comes from de-personalized `lib/narrative.ts` functions (no "your"), never a
second hand-written set; static titles/labels stay literals in `pptxExport.ts`.

## Three distinct grid concepts — don't merge them

| Field | Meaning |
|---|---|
| `gridOverride` | A manual edit layered on the solver's own recommendation. Cleared by `setArrivals`/`setShiftMenu`. |
| `currentStaffingGrid` | "What you actually staff today." Independent, starts blank, **never** seeded from `result.grid`. Written by both setup and results. |
| `sandboxEdGrid` / `sandboxHoldGrid` | Panel 5's ephemeral what-if. `null` = untouched. In the store only so `pptxExport` can read it. |

## Panel 5 — mechanism x target matrix, `activeStrategy`, joint +/- control

2026-08-06: replaced 2026-08-05's stacked cards, which changed OFFERED cards with the page toggle
— Panels 2/3 behavior, not Panel 1's (toggle = lens on one selection). Mechanism and target are
now separate axes.

- **`strategyMatrix`**: one row per mechanism (Current Staffing; Re-allocated; All ED Nurses;
  Hold Nurses for Boarding), "Choose"/"Selected" per target column. The hold row is
  combined-only BY DEFINITION — arrivals column left blank, not disabled. Every row/cell is
  reachable regardless of `toggle`. A "Mixed ED + Hold" row was built and removed same-day — see
  engine-solver.md's load-bearing history for why it can't work under this model.
- **`activeStrategy`** (`'current' | 'reallocated-arrivals' | 'reallocated-combined' |
  'allEd-arrivals' | 'allEd-combined' | 'holdSplit'`) encodes mechanism+target. `changeToggle`
  NEVER touches it or either sandbox grid — it only re-scores the selected grid against a
  different demand curve (mirroring Panel 1). A manual `GridEditor` edit also never touches it.
- **"Which shifts can hold nurses work?"** renders ABOVE the matrix, unconditionally —
  `holdSplit` reads it at click time, so intent must be set first.
- **The +/- control**: single up/down by `MarginalReturnsCurve`'s "Your scenario" marker. ED
  alone under Arrivals or "All ED Nurses"; else jointly ED vs. hold via `bestUnitToAdd`/`Remove`
  — JUDGMENT CALL, not cost-normalized.
- **ED `GridEditor` delta**: `(+N)/(-N)` vs. `currentStaffingGrid`. Not on the hold table.
- **Per-shift diagnostic** (Panel 1's) replaces the old aggregate.

## Live inconsistency, flagged not fixed

Panel 4's "each additional shift removes roughly X hours" prose is driven by the **trim-based**
severity curve (`marginalCurve`/`marginalKneePoint`), while the chart below it is driven by the
**fill-up-from-zero** hours-covered curve (`solveFullCoverageWeekWithTrajectory`). Two different
computations answering adjacent questions. Not reconciled.

## Load-bearing history — read the archive first

| Area | Why |
|---|---|
| Heatmap cell number | Changed three times (wHPPV -> ratio -> headcount). |
| Heatmap rich-side color | Reversed twice. Muting it hid the most actionable finding on the page. |
| Heatmap color's reference band | Reversed twice (week-level -> per-hour -> week-level, 2026-08-05). Per-hour, while mathematically the same peer band, reads as inconsistent and can leave the prose-cited extreme hour uncolored. |
| Backlog overlay | Spine added, then removed entirely — it read as a table border, not data. |
| Boarding output shape | Four reversals. See `boarding-seasonality.md`. |
| The welcome/philosophy banner | Rewritten five times. |
| "Recommended" vs. "Idealized" | R11 is repo-wide and test-enforced; the Panel 4 curve marker is a scoped exception. |

## Known gaps

- No component-level test tier. `engine`/`lib` have vitest; the full page has Playwright e2e;
  nothing in between.
- Desktop viewport only — no mobile/responsive layout.
- `e2e/panel1-2.spec.ts`'s Panel 2 spec references a "Current" toggle tab that no longer exists.
  Pre-existing failure, unrelated to recent changes.
