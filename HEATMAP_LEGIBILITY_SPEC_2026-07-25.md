# Heatmap legibility rework — 2026-07-25

Planned in Cowork with Ben. Paste this whole file as the opening prompt of a fresh Claude Code
session. Read `CLAUDE.md` and `.claude/rules/results-redesign.md` first — this builds directly on
the §2.1/§2.4 heatmap work described there.

**Scope:** display/presentation only. No changes to `engine/` math, `hourlyRequirement`,
`computeBacklog`'s recurrence, the solver, or any parser's day-index semantics. The only new
shared module is a day *display-order* helper. Per CLAUDE.md Section 6's heatmap convention, the
per-cell realized-wHPPV arithmetic stays client-side in the components — don't move it into
`engine/`.

**Two things that will look like they violate existing rules. They don't. Read these before
starting:**

1. `CLAUDE.md` Section 6 and `.claude/rules/results-redesign.md` both say *"don't reintroduce a
   p25 single-hour flag."* That rule is about the old **binary red-outline risk flag** on
   individual cells, which the backlog overlay superseded. This spec uses p25/p75 as a
   **continuous color domain** — a neutral band, not a flag. That is a different mechanism and is
   explicitly approved. Update both files' wording so the next session isn't confused by the same
   apparent conflict.
2. Day-of-week display order changes to Mon–Sun. The engine's `day 0 = Sunday` indexing does
   **not** change anywhere. See §5 for the exact boundary.

---

## 1. Backlog overlay: fix the axis

**Problem:** a backlog streak is *consecutive hours*, which runs vertically down a day column. The
current marker is a bar on the cell's **bottom edge** plus a corner dot, so adjacent flagged cells
merge into horizontal lines running across days — perpendicular to the thing being encoded. A
streak is visually unreadable.

**Change:** replace the bottom bar + corner dot with a **vertical spine on the cell's left inside
edge**. Consecutive backlog hours in the same column then form one continuous bracket that reads
as a single object, and the streak length is directly legible as the bracket's height.

- Remove `.heat-backlog-dot` and the bottom-bar rule from `.heat-cell-backlog`.
- The spine must not break between vertically adjacent flagged cells — no vertical gap, no
  per-cell inset at top/bottom. Adjacent cells should look like one continuous bar.
- Keep the existing ENA-floor indicator (red inset outline + "!") exactly as-is. It's an absolute
  safety check, orthogonal to backlog — resolved call #3 in `results-redesign.md`. The combined
  `.heat-cell-risk.heat-cell-backlog` case must still show both.

## 2. Backlog marker weight by magnitude

**Problem:** ~99 of 168 cells carry the flag. At that density it carries no information.

**Change:** no new threshold. Keep `BACKLOG_CAUGHT_UP_THRESHOLD = 0.5` as the existing gate for
"is there any backlog at all," and scale the **spine's width and opacity continuously** with the
cell's backlog value above it. A trivially-behind hour gets a hairline; a deep hole gets a thick,
opaque bar. Streaks then self-identify by both height and weight without an arbitrary length cut.

**Normalization — important:** do **not** normalize against each grid's own `peakBacklog`. The
§2.1 current-staffing heatmap and the idealized heatmap are meant to be read side by side, and
per-grid normalization would make the same visual weight mean different backlog magnitudes in
each. Compute one shared max across both grids' backlog results and pass it into both. Same
problem, same fix as §6.

## 3. Color scale: neutral band, log-ratio domain, asymmetric ramps

This is the largest change. Four separate corrections:

### 3a. Neutral band instead of a point center

The current scale centers on `wHppvTarget` as a single value, so every cell is "off target" by
construction and the entire grid is colored. But the target is a **cohort average pulled from
other departments' annual data** (`lib/edbaLookup.ts`) — it is not a granular hour-of-week
standard, and hour-to-hour variance around it is *expected and normal*, which is exactly why the
p25–p75 range exists.

**Change:** cells whose realized wHPPV falls **inside the p25–p75 band render with no color at
all** (plain background). Ink only appears outside the band. Most of the daytime field should go
blank, leaving genuinely lean hours as the only red on the page.

- Band comes from `lookupWhppvBand(annualVisits)` → `p25Whppv` / `p75Whppv`.
- **Judgment call, implement as stated but flag it in the PR body:** the user's own
  `wHppvTarget` may sit outside the cohort band. When it does, widen the neutral band to include
  it — `[min(p25, target), max(p75, target)]` — so a user's own stated target never renders as a
  problem. Silently coloring a manager's chosen target red would be indefensible.
- If `lookupWhppvBand` returns nothing (no `annualVisits`, lookup miss), fall back to ±15% of
  `wHppvTarget` as the neutral band and say so in the legend.

### 3b. Log-ratio domain

wHPPV is a ratio measure; the current scale treats distance from target additively. With target
1.66 and data spanning 0.7–4.6, the rich side must cover +2.9 while the lean side covers −0.96 —
so the overnight hours become one undifferentiated saturated slab and the whole daytime range,
where every real decision lives, compresses into near-identical pinks. 0.9 vs 1.2 is a large
operational difference and currently looks the same.

**Change:** drive color from `log(realized / bandEdge)` — distance measured from whichever band
edge was crossed, not from the target point. "Half the target" and "double the target" then sit
equally far from neutral.

### 3c. Asymmetric ramps

Understaffing is a safety, quality and patient-experience problem. Overstaffing is a budget and
efficiency problem. They are not equivalent at equal distance, and the scale should say so.

- **Below p25 (lean):** saturate **fast**. A small dip below the band is already meaningful.
- **Above p75 (rich):** ramp **slowly**, clamp early (suggest ~2× target — beyond that it's just
  "overnight, plenty of staff" and needs no further shades).
- **Both sides nonlinear:** nearly flat just outside the band, accelerating with distance. Being
  slightly outside the band is unremarkable; being far outside is the signal. A gamma/ease-in
  curve on the normalized distance is fine — pick one, put the exponent in a single named
  constant, and note in a comment that it's a display heuristic and safe to tune.

### 3d. Rich side gets a different hue, not just a different intensity

**Change:** the rich side becomes a **muted gray-blue**, not the current saturated blue. Visible
as "you're spending money here," but visually subordinate to red so overstaffing never competes
for attention with understaffing. Confirmed with Ben.

### 3e. Legend and text contrast

- Legend currently reads `target 1.663` — false precision on a soft number. Replace with the
  **band**, rounded to 2dp: e.g. `Typical range for similar EDs: 1.42 – 1.94`. Keep the
  "similar-volume benchmark" framing — **no "EDBA" text anywhere in the UI** (CLAUDE.md Section 6).
- Label the three zones in plain language: leaner than typical / within typical range / richer
  than typical.
- Cell text must auto-flip to white on dark cells based on background luminance. Currently dark
  text sits on saturated fills.

**Not changing:** the per-cell wHPPV numbers stay visible on every cell. Ben wants them.

## 4. Day-of-week display order → Mon–Sun

**Problem:** Sunday and Saturday currently sit at opposite edges, splitting the weekend — which
behaves differently in an ED — into two fragments the eye can't join.

**Change:** every grid renders **Mon, Tue, Wed, Thu, Fri, Sat, Sun**, weekend contiguous at the
right edge. Ben chose the widest scope: **all display grids plus the setup entry grid and the
downloadable templates.**

**Hard boundary — the engine index does not change.** `day 0 = Sunday` remains the canonical
index throughout `arrivals[day*24+hour]`, every engine function, every store field, and every
parser's output. This is purely a render-order and row-emission-order change.

- Add **one** shared helper (suggest `src/lib/dayOrder.ts`) exporting the display order
  `[1,2,3,4,5,6,0]` and matching labels. Every grid imports it. Do **not** let components each
  define their own local ordering — that is exactly how these drift apart.
- Apply to: `WhppvHeatmap`, the idealized/current/diff grids in `CoreGridTab`,
  `CurrentStaffingGrid` (shared by setup and results), `ArrivalsGrid`, and
  `BoardingCoverageSection`'s weekly grid.
- Templates (`lib/template.ts`): emit rows Mon-first in both the consolidated template's Arrivals
  and ESI Mix tabs and the current-staffing template.
- **Parsers need no change** — `parseUpload.ts` and `parseStaffingUpload.ts` match days by name
  via `DAY_ALIASES`, never by row position. **Add a regression test proving a Sun-first legacy
  template still parses to identical output**, since users may re-upload an old saved copy. This
  test is the thing that keeps the change safe; don't skip it.

## 5. Rules at shift boundaries, not arbitrary hour marks

**Change:** draw the heatmap's horizontal rules at **each distinct `startHour` in the shift
menu**, not every N hours. This ties the heatmap to the one lever the manager actually controls —
"the 7a–7p shift runs lean" instead of "hours 9–14 are red."

- Derive from `shiftMenu` sorted by `startHour` (CLAUDE.md Section 6's sorting convention), and
  **dedupe** — overlapping shifts (a swing shift) mean boundaries won't cleanly partition the
  column, so emit a rule at each distinct start hour rather than assuming N clean blocks.
- Label the left gutter with the shift's `label || id` at its start row.
- An overnight shift wraps within the day under the `shiftHoursOfDay` within-a-day circular model
  (see `.claude/rules/engine-solver.md`), so its block splits at the top and bottom of the column.
  The column's top edge already reads as a boundary, so this needs no special handling — just
  don't try to draw a contiguous block for it.
- Do not also add 6-hourly banding. The shift rules replace it.

## 6. Shared color domain across both heatmaps

**Problem:** `CoreGridTab` (idealized grid) and `CurrentStaffingAnalysis` (current grid) both
render the shared `WhppvHeatmap`, and the §2.1 follow-up note in `results-redesign.md` says they
are meant to read as *directly comparable*. If each derives its color domain from its own data,
the same color means different things in each and the comparison is actively misleading.

**Change:** compute the color domain (and the §2 backlog weight max) **once**, in `CoreGridTab`,
and pass it into both instances as an explicit prop. Neither instance may derive its own domain
from its own cells.

---

## Maintenance (mandatory, per CLAUDE.md's AUTOMATIC MAINTENANCE block)

In the same pass, not a follow-up:

- `.claude/rules/results-redesign.md` — add a section for this rework. Record that the p25/p75
  **color domain** is distinct from the retired p25 **binary flag**, so the next session doesn't
  read the old warning as forbidding this.
- `CLAUDE.md` Section 6 — the heatmap convention paragraph currently describes a continuous
  diverging scale centered on `wHppvTarget` and warns against reintroducing p25. Rewrite to
  describe the band-neutral asymmetric scale and narrow the warning to the binary flag. Ben has
  confirmed this change to already-documented behavior.
- `CLAUDE.md` Section 6 — add the Mon–Sun display-order convention and its hard boundary against
  the `day 0 = Sunday` engine index.
- `.claude/rules/template-parsing.md` — note the Mon-first row emission and the legacy Sun-first
  regression test.

## Verification

- `npm run build`, `npm test`, `oxlint` all clean (only the known pre-existing `StepIndicator.tsx`
  fast-refresh warning).
- New test: legacy Sun-first template parses identically (§4).
- Headless Playwright, with screenshots captured for Ben to eyeball — the point of this work is
  visual, so assertions alone aren't sufficient evidence:
  - A dataset where most daytime hours fall inside the band → most of the grid renders **blank**,
    not pink. If it's still broadly colored, 3a is wrong.
  - A deep-lean cell reads clearly more alarming than an equally-distant rich cell.
  - A multi-hour backlog run renders as one continuous vertical bracket, with weight varying
    across cells of differing magnitude.
  - Both heatmaps on the same page, same underlying value → identical color.
  - Columns render Mon→Sun in every grid; rules land on shift start hours with gutter labels.
  - Zero console errors.
