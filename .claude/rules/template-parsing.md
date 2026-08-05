# Templates, upload parsing, and setup flow — current state

Live behavior only. **Full history: `docs/archive/rules/template-parsing.md`** — where admit
rate / boarding duration live has flipped twice, and a Settings tab plus a boarding clock-start
setting were both built and reverted. Read the archive before moving any of those.

---

## Core philosophy: tolerant, header-based

Rename columns, reorder them, vary casing — the parser still finds them. Deliberate
friendliness-vs-robustness trade for a non-analyst ED manager handing the template to whoever
pulls the export. Don't quietly tighten it.

- `matchColumn(headers, aliasTable)` — normalizes (lowercase, strip non-alphanumerics), matches
  per-field alias lists. Each sheet shape has its **own** alias table, so "Day of Week" on the
  seasonality tab can't collide with "Day" on the arrivals tab.
- Day: full name / 3-letter / numeric 0-6 or 1-7. Hour: 0-23 or 1-24 (24 -> 23). Month: name /
  abbreviation / 1-12 (0-11 tolerated). All in `DAY_ALIASES` / `MONTH_ALIASES` / `parseHour()` —
  extend there, never inline in a row loop.
- Old header spellings stay in the alias tables forever. Someone's saved spreadsheet uses them.

## The consolidated template — ONE `.xlsx`, six tabs (`lib/template.ts`)

| Tab | Columns | Notes |
|---|---|---|
| Arrivals | Day, Hour, Average Arrivals, P75 Arrivals | 168 rows. P75 optional/all-or-nothing. |
| ESI Mix | Day, Hour, Average ESI 1-2 / 3 / 4-5 Count | 168 rows, optional, all-or-nothing. |
| Boarding Census | Day, Hour, Medical / BH / Pre-Bed-Request Census | 168 rows, each column independently all-or-nothing. **Preferred boarding input.** |
| Scalars | Field, Value | Admit Rate, Mean Boarding Duration (hrs). Independently optional here; the both-or-neither pairing is enforced in `computeBoarding()`. |
| Boarding Seasonality | Month / mean-duration + census columns; Day of Week / mean-duration | One flat row-scan, not two stacked blocks. Census columns win when both present. |
| Setup Decisions | Decision, Value | See below. |

**Never seed example values in any tab.** Hard constraint — no ED-specific data may ship as a
default. Every row is blank except its label column.

"Average ___" headers and "Mean Boarding Duration" are deliberate: each of the 168 cells is a
period average, not one week's snapshot (`annualVisits = sum(arrivals) * 52` only makes sense
that way), and duration must be a **mean**, not a median, for total-hours conservation.

## Per-tab classification, not per-file

`parseXlsxFile` iterates **every sheet** independently, classifying by which columns it has —
never by sheet name or position. Subset uploads, renamed tabs, reordered tabs, extra stray tabs
all work. Only if *no* sheet is recognized does it error. `looksLikeBoardingCensusSheet` is
checked **before** the generic arrivals/ESI detector (both share Day+Hour; the more specific
detector must win).

Single-sheet CSV upload still works, arrivals/ESI shape only.

## All-or-nothing optional fields

ESI mix, P75 arrivals, each census column, and both seasonality arrays: accepted only if
**every** row has a value. A partially-filled optional field is treated as absent with a
warning, never half-applied — a sparse field is far more likely a data-entry mistake than
intent. Don't change to best-effort partial fill.

## Second template: current staffing (`parseStaffingUpload.ts`)

Separate from the consolidated one **because it depends on `shiftMenu`, which doesn't exist yet
at Step 1** — chicken-and-egg, so it can't be a seventh tab. Lives on `ShiftMenuStep.tsx`.

- Rows match a shift by **Start Hour + Length**, never by the Shift label text (labels change).
- A row whose (startHour, length) matches nothing is **recovered as a new shift**
  (`newShifts`, id `uploaded-shift-N`), not skipped — it's usually a shift the app doesn't know
  about yet. Only a row with no Length column at all warns-and-skips.
- `setCurrentStaffingGrid` **merges** cell-by-cell onto existing values (unlike `setArrivals`,
  which replaces) so a partial upload doesn't clobber hand-entered cells.

## Data vs. policy — the rule a reverted Settings tab exists to enforce

**The uploaded workbook carries DATA. Policy values are set in the UI, never parsed from a
workbook.** wHPPV target, ENA floor: UI only, never exported. A Settings tab carrying all of
them was built and reverted.

Two narrow, deliberate exceptions round-trip through the **Setup Decisions** tab, because they're
per-dataset workflow answers or near-fixed clinical conventions rather than dials someone
reconsiders each pass: `boardingPath`, `headcountIncludesIndirectCare`, the three `flexAxes`,
`boardingRatioTarget` / `bhBoardingRatioTarget`, and `fteInputMode` / `fteInputValue`. The tab is
`Decision`/`Value` shaped on purpose, so it can't collide with Scalars or resurrect the Settings
shape. Don't extend this list without an explicit ask.

Policy fields live in `ShiftMenuStep.tsx`'s "Staffing Policy Settings" card.

## Export round-trip — the app's only persistence

`ReviewStep.tsx`'s "Download my data file" reuses the **same** tab generators as the blank
template, fed real values — so the export has exactly the shape `parseXlsxFile` already parses,
with no second exporter to drift. Round-trip equality is the entire value of the feature and is
tested directly (`exportRoundTrip.test.ts`). Re-import via `SetupEntryFork`'s 'returning' path
calls `parseStaffingUploadFile` a **second** time against the same file for the Current Staffing
tab; a missing tab there is a silent expected case.

## Setup flow

`SetupEntryFork.tsx` (3 cards) -> `TutorialFlow.tsx` (guided, one item per screen: Arrivals,
Busy-hour arrivals, Boarding, Boarding seasonality, ESI mix — **five items, current staffing is
not one of them**, it lives on Step 3 where the shift menu already exists) / `ColleagueRequestPage
.tsx` / 'returning' upload-then-jump-to-Review.

`BoardingFork.tsx` asks one question before showing any boarding input — census / admit-rate /
skip — so the user can never see both the census grid and the admit-rate fields at once. Its
"No" branch is the one sanctioned exception to "no typed fields for report-sourced numbers":
two scalars with no natural grid shape. Not license to add more.

## Mon-Sun row emission is display-only

`lib/template.ts` emits rows Mon-first via `lib/dayOrder.ts`. Zero effect on parsing — rows match
days by NAME, never position. Backed by a regression test that parses a hand-built Sun-first
workbook and a Mon-first one and asserts identical output.

## One sanctioned auto-correction

`normalizeEsiMix` (`engine/allocate.ts`) — an ESI mix summing to 126% of arrivals is
arithmetically impossible, not merely suspicious. Preserves ESI 3, scales 1-2/4-5
proportionally. Disclosed in the UI. `lib/inputIntegrity.ts`'s two checks are diagnostic-only
and **never** auto-correct.
