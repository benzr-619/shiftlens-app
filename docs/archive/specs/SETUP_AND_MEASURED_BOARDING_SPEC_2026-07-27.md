# Setup redesign + measured boarding census — SPEC 2026-07-27

Governing spec for the next change set. Written after auditing a real department's
(NYP-W) full-year data pulls, which exposed both a correctness defect in the boarding
model and an opportunity to simplify what the tool asks users for.

> **CORRECTION (same day, guided-setup/export follow-up prompt) — §2.1's Settings tab and
> §3.3's clock-start setting were both built against this spec and then REVERTED.** Both
> sections below are now WRONG and describe something that does not exist in the code:
> - **§2.1's Settings tab** (wHPPV target, both ratios, clock start, LWBS rate, ENA floor as
>   an uploaded `Setting`/`Value` sheet) violated the standing rule that policy values are UI
>   fields, not template data (`boardingRatioTarget` was already documented as "the one typed
>   field that stays, since it's a policy choice, not data to pull"). There is no Settings
>   tab. Both ratios live in `ShiftMenuStep.tsx`'s Settings card; wHPPV target/ENA floor/LWBS
>   rate are set elsewhere in the UI (wHPPV target on `VolumeStep.tsx`; ENA floor and LWBS
>   rate have no dedicated UI field as of this correction — pre-existing gaps, not part of
>   this spec's ask).
> - **§3.3's clock-start setting** (`boardingCensusClockStart: 'bedRequest' | 'arrival'`, with
>   a non-dismissable caveat banner on the arrival-clocked branch) was rejected as an
>   acceptable resolution — a caveat beside a wrong number doesn't fix the number, especially
>   feeding the synthesis chapter (the tool's headline answer). There is no clock-start field
>   anywhere in the code. The census is REQUIRED to be counted from bed request — see the
>   precise definition inlined in §1's table below (unchanged) and
>   `.claude/rules/boarding-seasonality.md`'s measured-path section for the full reasoning.
>
> Trust `.claude/rules/template-parsing.md` and `.claude/rules/boarding-seasonality.md` over
> §2.1/§3.3 below, which are left in place as historical record of what was tried and reverted
> rather than rewritten in place.

Read `.claude/rules/boarding-seasonality.md` and `.claude/rules/template-parsing.md`
before implementing. This spec **adds a new primary input path** to the boarding half of
the engine; it does **not** delete the existing derived path.

---

## 0. The governing why

Two findings from real data, both load-bearing:

**1. The derived boarding curve has the wrong shape, not just the wrong magnitude.**
`computeBoarding` derives the boarding census by convolving arrivals × admit rate over a
mean duration. That makes boarding shape a *function of arrivals shape*. Measured census
from a real department peaks at **15:00** and troughs on **Saturday** — driven by when
inpatient beds free up, which is close to uncorrelated with when patients walk in. No
amount of tuning the convolution produces that curve, because the information isn't in
arrivals.

**2. Boarding census is directly measurable, and the measurement is unambiguous where
every derived input was not.** One 24×7 grid replaces admit rate, mean boarding duration,
monthly duration means, day-of-week duration means, the convolution, the seasonality
index, and both input-integrity banners.

**Constraint carried through:** most departments will reach for admit rate before they
reach for a census report. The derived path stays as a first-class fallback. This is a new
*preferred* path, not a replacement.

---

## 1. What the tool asks users for (the audited list)

This is the complete surface. Every item is either universal, hand-entered, or a toggle on
a report the user already ran — except one, called out explicitly.

### Tier 1 — required

| Input | Shape | Notes |
|---|---|---|
| Arrivals, mean | 24 × 7 grid | Universal. Most standard ED report that exists. |
| Shift menu | list of (start hour, length) | Typed, not pulled. |
| wHPPV target | one number | Pre-filled from peer cohort, user-adjustable. |

### Tier 2 — strongly recommended

| Input | Shape | Unlocks |
|---|---|---|
| Current staffing | day × shift headcount | Scenario B, synthesis, hidden-boarding, current-vs-ideal comparison. ~14–28 hand-typed cells. |
| **Boarding census — medical** | 24 × 7 grid | The measured boarding path. **The one genuinely demanding ask in this list** — needs a bed-management/capacity dashboard. |
| ↳ fallback | admit rate + mean boarding duration | The classic numbers. Existing derived path, unchanged. |
| Boarding seasonality | 12 monthly mean census values | Same census report grouped by month. |
| ↳ fallback | 12 monthly mean boarding durations | Existing input, unchanged. |

### Tier 3 — optional

| Input | Shape | Notes |
|---|---|---|
| BH boarding census | 24 × 7 grid + 12 monthly | Only where BH boarding is material. |
| Arrivals p75 | 24 × 7 grid | Percentile toggle on a report already run. |
| ESI mix | 3 × (24 × 7) grids | Available, but prone to the zero-day artifact — see §5. |
| LWBS rate | one % | Only tunes `abandonRate`. Genuinely skippable. |
| Pre-bed-request census | 24 × 7 grid | Validation only — see §7. |

### Settings, not asks

Defaults with plain-language framing. **These are not data pulls** — no manager keeps them
on a dashboard, and asking for them as data was a design error.

| Setting | Default | UI framing |
|---|---|---|
| Boarding nurse:patient ratio | 4 | "How many boarding patients can one nurse reasonably cover?" |
| BH boarding nurse:patient ratio | **10** | "Classic range is 10–12 — far less licensed RN care than med/surg." |
| Boarding census clock start | `bedRequest` | Radio. See §3.3 — load-bearing. |
| ENA department floor | 2 | Existing. |
| Headcount semantics | unanswered | Existing (PR D). |

**The whole template collapses to one shape: everything the user provides is a 24 × 7
grid**, plus two small tables (12 monthly values, day × shift staffing) and a settings
list. One parser path, one mental model.

---

## 2. Template changes (`lib/template.ts`, `lib/parseUpload.ts`)

### 2.1 New/changed tabs

- **Arrivals** — unchanged (`Day`, `Hour`, `Average Arrivals`, `P75 Arrivals`).
- **ESI Mix** — unchanged shape.
- **Boarding Census** *(NEW)* — `Day`, `Hour`, `Medical Boarding Census`,
  `BH Boarding Census`, `Pre-Bed-Request Census`. 168 rows. Each column independently
  all-or-nothing (§2.2).
- **Boarding Seasonality** — gains `Mean Medical Boarding Census` / `Mean BH Boarding
  Census` columns alongside the existing mean-duration columns. Both sets optional; the
  census columns win when present.
- **Scalars** — unchanged (admit rate, mean boarding duration) but **relabeled as the
  fallback path** in the template's own copy and in `DataStep`.
- **Settings** *(NEW)* — `Setting`, `Value`. Carries wHPPV target, both ratios, clock
  start, LWBS rate, ENA floor. Ratios ship **with their defaults pre-filled** — this is
  the one sanctioned exception to the no-seeded-values rule, and it is not ED-specific
  data (same category as the EDBA wHPPV pre-fill). Everything else ships blank.

Mon-first row emission, same as every other tab (`lib/dayOrder.ts`).

### 2.2 All-or-nothing, per column

Each census column is independently all-or-nothing across its 168 rows, matching the
existing ESI/p75 rule. A partially-filled census column is treated as absent with a
warning. Medical and BH are independent: medical-only is a normal, fully supported state
(BH census is then absent, **not** zero-by-assumption — see §3.4).

### 2.3 Parser

`parseXlsxFile`'s per-sheet classification is unchanged in approach: a new
`looksLikeBoardingCensusSheet` detector plus a `BOARDING_CENSUS_HEADER_ALIASES` table, and
a `looksLikeSettingsSheet` detector reusing the existing `Field`/`Value` scalar machinery.
Do not extend `HEADER_ALIASES` — each shape keeps its own table, per the existing
collision-avoidance convention.

---

## 3. Engine changes

### 3.1 New `EngineInputs` fields

```ts
boardingCensusMedical?: Cell168        // mean concurrent boarding census, from bed request
boardingCensusBH?: Cell168
boardingCensusClockStart?: 'bedRequest' | 'arrival'   // default 'bedRequest'
monthlyBoardingCensusMedical?: number[12]
monthlyBoardingCensusBH?: number[12]
bhBoardingRatioTarget?: number         // DEFAULTS.bhBoardingRatioTarget = 10
preBedRequestCensus?: Cell168          // validation only, §7
```

`DEFAULTS` gains `bhBoardingRatioTarget = 10`. It needs a `constantsMetadata.ts` entry or
`buildConstantsTable()` throws — that guard is working as intended, don't bypass it.

### 3.2 `computeBoarding` gains a measured path

Two paths, explicit precedence: **if `boardingCensusMedical` is present, use the measured
path and ignore `admitRate`/`boardingDuration` entirely.** No blending, no partial
composition. The derived path is untouched.

Measured path, per cell `i` of 168:

```
cellBoardingRnHours[i] = boardingCensusMedical[i] / boardingRatioTarget
                       + (boardingCensusBH?.[i] ?? 0) / bhBoardingRatioTarget
```

That's the whole computation. No convolution, no admit events, no duration spreading.

**Conserved-total property (measured path):** `sum(cellBoardingRnHours)` equals
`sum(census) / ratio` exactly, by construction. Assert it directly — it's trivially true,
which is the point: the derived path needed a test to prove conservation held through the
convolution; here it holds by definition.

**`BoardingResult` gains a per-stream breakdown** so the results page can report BH
separately (§6.1):

```ts
medicalWeeklyRnHours: number | null
bhWeeklyRnHours: number | null
censusSource: 'measured' | 'derived'
```

`prioritySlots`, `weeklyBoardingDemandByCell`, `weeklyBoardingCoveredByGrid`,
`annualBoardingCoveredByWeeklyGrid`, `recommendWeeklyBoardingGrid`, `boardingCoverageFte`,
`effectiveEdWhppvAtCoverage`, `scopeWeeks`, and every §2.6/§2.6.1 helper all read
`cellBoardingRnHours` / `monthFactors` and therefore work **unchanged**. Do not rewrite
them.

**One simplification to make while you're in there:** under the measured path,
`weeklyBoardingDemandByCell` should read `cellBoardingRnHours` directly via
`coveringCellsByGlobalHour` rather than recovering weekly demand from `prioritySlots` by
dividing `scopeWeeks` back out. That round-trip exists because the derived path's
representative week was entangled with month scaling; under measured census the 168-cell
grid already *is* the representative week. Keep the derived path's existing recovery logic
as-is.

### 3.3 Clock start is load-bearing — warn, never correct

Measured census must be counted **from bed request** (or admit decision), not from ED
arrival. Counted from arrival, it includes pre-bed-request workup that the arrivals grid
already staffs, and that time gets double-counted into the synthesis chapter.

Real magnitude of the error, from NYP-W: census from arrival averages **19.8**; true
post-bed-request boarding averages **14.6**. A 36% overstatement.

**Do not build a correction factor.** The gap is not a scalar — measured hour by hour it
runs **0.66 at 16:00 to 0.88 at 06:00**, because overnight nearly everyone present is
already boarding while daytime patients are still in workup. A flat correction would
distort the very shape this whole change exists to get right.

When `boardingCensusClockStart === 'arrival'`: compute normally, and surface a prominent,
non-dismissable caveat on the boarding chapter stating that boarding demand is overstated
by an unknown amount and that some of these hours are already counted in the arrivals
grid. Same no-auto-correct convention as `lib/inputIntegrity.ts`.

### 3.4 Seasonality under the measured path — **kept, not dropped**

Monthly seasonality is a core property of boarding and stays fully modeled.

Per stream, derive an index against that stream's own mean:

```
medIdx[m] = monthlyBoardingCensusMedical[m] / mean(monthlyBoardingCensusMedical)
bhIdx[m]  = monthlyBoardingCensusBH[m]      / mean(monthlyBoardingCensusBH)
```

`BoardingResult.monthFactors[m]` is the **RN-hour-weighted** combination, not a plain
average — the two streams carry different RN weight per patient (1:4 vs 1:10):

```
monthFactors[m] = (medIdx[m] * medicalWeeklyRnHours + bhIdx[m] * bhWeeklyRnHours)
                / (medicalWeeklyRnHours + bhWeeklyRnHours)
```

This matters empirically, not just in principle. At NYP-W the two streams are **not
correlated**: medical census swings 1.85× and peaks in January; BH swings 1.6× and peaks
in April. Averaging their indices unweighted would misstate both.

Absent monthly census → flat 1.0, same graceful degradation as today. If BH census exists
but its monthly array doesn't, BH contributes a flat index (not zero weight).

`scopeWeeks` and the §2.6 month-SCOPE toggles are unchanged.

### 3.5 Retired only on the measured path

When `censusSource === 'measured'`: the convolution, the admit-rate/duration inputs, the
duration-based seasonality index, `overallMeanBoardingDuration`, and both
`inputIntegrity.ts` checks are all inert. They remain fully live on the derived path. The
integrity banners must be **scoped to the derived path** — firing them against a
measured-census department would be a bug.

---

## 4. Setup screen changes

- `DataStep.tsx` gains a **Boarding** section presenting the two paths in order: measured
  census first, framed as "if you can get it," with the derived scalars underneath as
  "if you can't." Both live in the same one consolidated template — no new typed fields
  for data values (the 2026-07-14 rule holds).
- New **Settings card** carrying both ratios, the clock-start radio, ENA floor, and LWBS
  rate. Framed as policy, with defaults visible and a one-line explanation each. The BH
  ratio's explanation names the 10–12 range explicitly.
- `ReviewStep.tsx` gains rows for the census grids, both ratios, and clock start, each
  with an Edit link back to its owning step.
- The boarding-ratio-target field moves out of `DataStep` into the Settings card — it was
  always a policy choice sitting in a data step.

---

## 5. ESI normalization (independent, can land first)

Real pulls can produce an ESI mix that does not sum to arrivals. NYP-W's summed to
**126%**, because the dashboard averaged only over days with a non-zero count — the
minimum value is exactly 1.00 across many cells, which is impossible for a true hourly
mean of a sparse count. It hits sparse categories (ESI 1-2, ESI 4-5) hardest and ESI 3
least.

**New `normalizeEsiMix(arrivals, esiMix)` (in `engine/allocate.ts`), applied before acuity
weighting.** Per cell: preserve ESI 3, scale ESI 1-2 and ESI 4-5 proportionally so the
three sum to arrivals. If ESI 3 alone meets or exceeds arrivals in a cell, fall back to
proportional scaling of all three for that cell (did not occur in 168/168 NYP-W cells, but
must be handled).

On NYP-W this moves 21.3 / 54.5 / 24.2 → **14.5 / 68.8 / 16.7**.

**This is the one sanctioned auto-correction in the app** — an un-normalized mix is
arithmetically impossible, not merely suspicious, which is what separates it from
`inputIntegrity.ts`'s diagnostic-only convention. It must **disclose**: return an
adjustment summary, surface it at setup *and* on the results page, and state the
assumption (ESI 3 treated as least biased) plainly. Note honestly that the true answer
sits between this and proportional scaling, since ESI 3 is likely slightly biased too.

---

## 6. Results page changes

### 6.1 BH boarding gets its own callout — and an explicit understatement warning

Wherever BH boarding is reported, this must appear, in substance:

> These figures describe **RN care only**. Behavioral-health boarding places a
> disproportionate burden on techs, sitters, and security, and the operational cost of
> maintaining patient and staff safety for these patients is **understated** by any
> RN-staffing view — including this one.

This is not optional framing. A 1:10 ratio correctly reflects that BH boarders draw less
licensed RN time than med/surg boarders, and reporting that number without the caveat
invites exactly the wrong conclusion — that BH boarding is cheap.

### 6.2 Evidence surface (`EvidenceSurfaceSection.tsx`)

Data provenance moves boarding from "modeled assumption" to "your data" when
`censusSource === 'measured'`. Three known-approximation entries (derived boarding census,
mean-not-median duration, month-scope duration conflation) become conditional on the
derived path. Add the clock-start definition to provenance — it's the one thing that makes
a department's boarding number comparable to a peer's.

### 6.3 Boarding methodology copy (`BoardingCoverageSection.tsx`)

PR K rewrote this explainer from apology to shopping list. On the measured path most of
that shopping list is **satisfied** — rewrite again to say so, and keep the shopping-list
framing only for what remains derived (linear recovery, month-scope conservation).

---

## 7. Pre-bed-request census (optional, validation only)

When `preBedRequestCensus` is supplied, the tool can compare observed non-boarding ED
occupancy against what its own arrivals → `hourlyRequirement` translation implies. This is
the first correctness check the arrivals half of the engine has ever had.

Scope it deliberately small: a diagnostic on the evidence surface, no solver interaction,
no change to any recommendation. Expect few departments to supply it.

---

## 8. Test requirements

- Measured-path conservation: `sum(cellBoardingRnHours) === sum(census)/ratio` exactly.
- Precedence: census present ⇒ `admitRate`/`boardingDuration` provably unused (assert
  identical output with those inputs mutated).
- Two-stream ratio arithmetic: medical at 1:4 and BH at 1:10 combine correctly.
- Weighted `monthFactors`: two streams with *opposing* seasonality produce a combined
  factor between them, weighted toward the higher-RN-hour stream.
- BH census absent ⇒ BH contributes zero hours, no NaN, `bhWeeklyRnHours === null`.
- `normalizeEsiMix`: sums to arrivals per cell; ESI 3 preserved; the ESI-3-exceeds-arrivals
  fallback fires correctly.
- Integrity banners do **not** fire on the measured path.
- `reconcile.test.ts` must pass with a **zero-line diff** — none of this touches
  `annualVisits`, `annualCoreRnHoursBudget`, or `hourlyRequirement`.
- Extend `syntheticDepartment.ts` with a `measuredBoardingCensus` generation mode and add
  a named profile to `namedDepartments.ts` exercising it, so the sweep covers both paths.

---

## 9. PR sequencing

| PR | Scope | Depends on |
|---|---|---|
| **M** | Template + parser + `EngineInputs`/`DEFAULTS` fields. Inputs parsed and stored, not yet consumed. | — |
| **N** | `computeBoarding` measured path + two-stream ratios + weighted `monthFactors` + tests. | M |
| **O** | `normalizeEsiMix` + disclosure. Fully independent. | — |
| **P** | Setup UI: boarding section, Settings card, clock-start radio, ReviewStep rows. | M |
| **Q** | Results copy: BH callout + understatement warning, evidence surface, boarding methodology rewrite, integrity-banner scoping. | N, P |
| **R** | Pre-bed-request validation diagnostic. Optional, defer freely. | N |

---

## 10. Open questions

1. **BH ratio default of 10** is Ben's call (classic range 10–12). Not peer-benchmarked —
   flag as CONVENTION, not ESTABLISHED, in the constants table.
2. **Does the derived path stay indefinitely?** Yes for now. Revisit only if real
   deployment shows most departments can get census after all.
3. **ESI 3 as the unbiased anchor** is an inference from one department's data. If a second
   department shows a different bias pattern, revisit before hard-coding it further.
4. **`Mean Boarders` reported `Measure = Mean` in its filter but "Median Daily Census" in
   its column sub-header.** Confirmed as mean by Ben. Worth a template note asking users to
   supply a mean, since the same dashboard ambiguity will hit other departments.
