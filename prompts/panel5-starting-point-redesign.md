# Prompt for Claude Code — Panel 5 starting-point selector redesign

Redesign Panel 5's ("Test it yourself") starting-point card selector. Read
`.claude/rules/results-redesign.md` (Panel 5 section) and `.claude/rules/engine-solver.md` first —
this touches the sandbox/starting-point wiring documented there.

## The problem

Right now Panel 5's stacked cards (Current Staffing / Re-allocated Current Staffing / ShiftLens
Solver Staffing, plus a combined-only Mixed ED + Hold card) change *which cards are even offered*
depending on the page's Arrivals / Arrivals + Boarding toggle, and "Re-allocated" and "Solver
Staffing" mean a different underlying computation per toggle state (`computeScenarioB` vs.
`computeCombinedReallocation`, etc.).

That makes Panel 5 behave like Panels 2/3 (the toggle changes what's being recommended), but it
should instead behave like Panel 1 (the toggle is a pure lens: same selected grid, scored against
either demand curve). The fix is to separate two questions that are currently conflated:

1. **Which starting grid do I want to test?** — a mechanism choice, made explicitly via cards.
2. **Which demand do I want to score that grid against?** — the existing page-level toggle,
   which should now just re-render `VisualFrame`/`computeBacklog` for whatever grid is currently
   selected, without changing the selection or re-deriving a different grid.

## First: verify what actually exists before building the UI

Before touching any component, confirm which of these seven grids are real, already-computed
outputs today, and which would need new plumbing:

- Current staffing (exists — `currentStaffingGrid`, no target)
- Re-allocated, arrivals-only target (`computeScenarioB` or equivalent)
- Re-allocated, combined target (`computeCombinedReallocation`)
- ShiftLens solver, all-ED, arrivals-only target (`result.grid` — check this is really
  arrivals-only per engine-solver.md's hard rule 4, "boarding is never merged into
  `EngineResult.grid`")
- ShiftLens solver, all-ED, combined target — **flag if this doesn't exist today**. Hard rule 4
  says the core grid is never solved against a boarding-merged target, so this cell may currently
  have no backing computation. Don't invent a new solver path without checking with me first —
  report back what you find instead of assuming it should be built.
- ShiftLens solver, hold nurses for boarding (ED solved for arrivals + a separate hold-only
  solve) — combined-only, no arrivals-only variant
- ShiftLens solver, mixed ED + hold (`solveEdHoldJointCoverage`) — combined-only, no
  arrivals-only variant

Report back on which of these seven are real vs. missing before writing any UI code.

## The redesign

Replace the flat card stack with a grouped matrix: mechanism (row) x target (column, only where
both targets are meaningful). Concretely:

- **Current staffing** — single row, no target column, always available, no dependency on the
  page toggle.
- **Re-allocated current staffing** — one row, two selectable options (arrivals-only /
  combined), each a small "Choose" control rather than two separate full cards.
- **ShiftLens solver — all ED nurses** — one row, two selectable options, same pattern (pending
  the verification step above).
- **ShiftLens solver — hold nurses for boarding** — one row, single option, no target column
  (combined-only by definition — don't render a disabled arrivals-only cell, just omit the
  column for this row).
- **ShiftLens solver — mixed ED + hold** — one row, single option, same treatment.

All five rows/options should be visible and selectable regardless of the current page toggle
state — nothing should appear/disappear when the toggle flips. `activeStrategy` needs to expand
to encode both mechanism and target (e.g. `'reallocated-arrivals' | 'reallocated-combined' |
'allEd-arrivals' | 'allEd-combined' | 'holdSplit' | 'mixed'` alongside `'current'`).

Once a mechanism+target is selected, that grid stays selected when the user flips the page-level
Arrivals / Arrivals + Boarding toggle — the toggle only changes what `VisualFrame` scores it
against (mirroring how Panel 1 already does this), never which grid is active. This is the whole
point: a user can build "re-allocated for arrivals only" and then flip to the combined view to see
exactly what boarding costs a plan that never accounted for it.

Keep the existing "each card is a starting point — pre-fills the grid(s) below, still
hand-editable afterward" framing; the `GridEditor` delta-vs-`currentStaffingGrid` behavior and the
non-baseline treatment of the hold table are unchanged.

## Explicitly out of scope for this task

- Don't touch Panels 1-4 or their toggles/copy.
- Don't add a page-level toggle change or move the toggle's position.
- Don't write intro copy for other panels.
- If the "solver, all-ED, combined target" computation turns out not to exist, stop and report
  back rather than deciding how to build it.

## Verification

- `npm test` after any engine/lib touch.
- Confirm `npm run test:e2e` panel 5 coverage still passes (or note if a seed/fixture needs
  updating for the new `activeStrategy` values).
- Manually check: selecting a grid, then flipping the page toggle, does not change the selected
  grid or which row is highlighted — only the scored numbers/heatmap.
