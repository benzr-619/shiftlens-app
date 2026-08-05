# Results page & UI — current state

Live behavior only. **Full history: `docs/archive/rules/results-redesign.md`** (~184 KB — three
successive page architectures, twelve numbered reversals, and every flagged judgment call). Read
the archive before reversing anything listed under "Load-bearing history" below.

Filename kept as `results-redesign.md` because ~20 source comments reference it.

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
| 5 | Test it yourself (sandbox) | `computeSandbox`, `solveEdHoldJointCoverage`, `bestUnitToAdd/Remove` |

**Deleted, do not resurrect:** `CoreGridTab`, `CurrentStaffingAnalysis`, `ScenarioBSection`,
`HiddenBoardingSection`, `BoardingTransition`, `ConstrainedReallocationSection`,
`FundingAskSection`, `FinancePartnerWorksheet`, `SynthesisSection`, `BoardingCoverageSection`,
`ShiftMenuFlexibilitySection`, `ChapterRail`, `CompareTab`, `EvidenceSurfaceSection`.
Their content was absorbed into the five panels (or, for the evidence surface, removed from the
UI entirely on 2026-08-05 — `lib/constantsMetadata.ts` survives, consumed only by `pptxExport`).

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

## Heatmap (`WhppvHeatmap.tsx`) — current mechanism

- **Cell number** = headcount. When more than one shift covers that hour, split by shift
  (`perShift`, e.g. "7+4"), ordered by `startHour`. Realized wHPPV lives in the tooltip only.
- **Cell color** = `onDuty / requirement` against **that hour's own** band (each
  `WhppvHeatmapCell` carries its own `bandFloor` / `bandCeiling`, from
  `EngineResult.bandFloorHourly` / `bandCeilingHourly`; `target = 1.0`). Inside the band -> no
  ink at all.
- **Asymmetric ramp:** lean saturates fast (a small dip reads alarming), rich ramps slowly and
  clamps ~2x. Both gamma-eased. `RICHER_RGB` is **saturated** blue, not muted — a real
  8-nurses-against-4 hour rendered pale gray was the single most actionable finding on a real
  page, and muting made it invisible.
- **Only per-cell flag left:** the ENA on-duty floor (red inset outline + "!"), and its legend
  line renders only when some cell actually trips it. The p25 single-hour red-outline flag and
  the backlog spine overlay are both **retired**.
- **Shift-boundary rules** land at each distinct `startHour`, labeled in the gutter.
- `lib/whppvColorDomain.ts`'s week-level `computeColorDomain` still exists but no longer drives
  heatmap color — narrative band language only.

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

Scope: title -> current-staffing analysis (Panel 1) -> the user's sandbox scenario (Panel 5, or
the recommendation if `sandboxEdGrid`/`sandboxHoldGrid` are still `null`) -> the delta -> Method
& Limitations (always included). **Panels 2/3/4 are not exported.** Everything native — grids as
PPTX tables, charts via `addChart`, brand mark as a native shape. No images. Loaded via dynamic
`import()` so `pptxgenjs` stays out of the main bundle. Slide titles come from `lib/narrative.ts`,
never a second hand-written set.

## Three distinct grid concepts — don't merge them

| Field | Meaning |
|---|---|
| `gridOverride` | A manual edit layered on the solver's own recommendation. Cleared by `setArrivals`/`setShiftMenu`. |
| `currentStaffingGrid` | "What you actually staff today." Independent, starts blank, **never** seeded from `result.grid`. Written by both setup and results. |
| `sandboxEdGrid` / `sandboxHoldGrid` | Panel 5's ephemeral what-if. `null` = untouched. In the store only so `pptxExport` can read it. |

## Live inconsistency, flagged not fixed

Panel 4's "each additional shift removes roughly X hours" prose is driven by the **trim-based**
severity curve (`marginalCurve`/`marginalKneePoint`), while the chart below it is driven by the
**fill-up-from-zero** hours-covered curve (`solveFullCoverageWeekWithTrajectory`). Two different
engine computations answering adjacent questions. Not reconciled.

## Load-bearing history — read the archive first

| Area | Why |
|---|---|
| Heatmap cell number | Changed three times (wHPPV -> ratio -> headcount). |
| Heatmap rich-side color | Reversed twice. Muting it hid the most actionable finding on the page. |
| Backlog overlay | Spine added, then removed entirely — it read as a table border, not data. |
| Boarding output shape | Four reversals. See `boarding-seasonality.md`. |
| The welcome/philosophy banner | Rewritten five times. |
| "Recommended" vs. "Idealized" | R11 is repo-wide and test-enforced; the Panel 4 curve marker is a scoped exception. |

## Known gaps

- No component-level test tier. `engine`/`lib` have vitest; the full page has Playwright e2e;
  nothing in between.
- Desktop viewport only — no mobile/responsive layout.
- `e2e/panel1-2.spec.ts`'s Panel 2 spec references a "Current" toggle tab that no longer exists.
  Pre-existing failure, unrelated to any recent change.
