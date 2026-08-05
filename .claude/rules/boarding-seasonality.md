# Boarding — current state

Live behavior only. **Full history: `docs/archive/rules/boarding-seasonality.md`** — the output
shape of this area has reversed FOUR times (never-a-grid -> solved grid -> ranked slot list ->
annual `+N` grid -> single representative week). Read the archive before changing the output
shape again.

---

## Two input paths. Measured wins absolutely, no blending.

`computeBoarding` (`engine/boarding.ts`) returns `null` outright if it has neither path's inputs.
**Never add a fallback or estimated default for admit rate or boarding duration** — a placeholder
admit rate once made the whole calculator look broken.

### 1. Measured census (PREFERRED) — `censusSource: 'measured'`

```
cellBoardingRnHours[i] = boardingCensusMedical[i] / boardingRatioTarget
                       + (boardingCensusBH?.[i] ?? 0) / bhBoardingRatioTarget
```

No convolution, no duration spreading. Total conservation is true by construction. Defaults:
medical 1:4, BH 1:10 (BH boarders draw far less licensed RN time — CONVENTION, not
peer-benchmarked).

**Load-bearing clock definition — do NOT add a clock-start setting.** The census must count
patients physically in the ED *with a bed request placed and no inpatient bed assigned*, at each
hour. An arrival-clocked count includes pre-bed-request workup the arrivals grid already staffs,
overstating boarding by roughly a third — and not by a flat factor (measured 0.66 at 16:00 vs.
0.88 at 06:00), so no correction multiplier would work either. An arrival-clocked variant with a
caveat banner was built and reverted: a warning beside a wrong number isn't a fix, especially
when it drives the tool's headline. A department that can't produce this uses path 2.

**Seasonality** is per-stream, combined RN-hour-weighted (not a plain average — the two streams
are genuinely uncorrelated in real data):
`monthFactors[m] = (medIdx[m]*medicalWeeklyRnHours + bhIdx[m]*bhWeeklyRnHours) / (med + bh)`.
No monthly *medical* census -> no month dimension at all (`monthFactors: null`). BH present but
no monthly BH array -> BH contributes a flat 1.0 index, still carrying its RN-hour weight.
`hasDayOfWeekSeasonality` is unconditionally true — the 168-cell census already *is* the real
day-of-week shape.

### 2. Derived (fallback) — `censusSource: 'derived'`

Needs admit rate **and** mean boarding duration (both-or-neither, enforced here, not at parse
time). `convolveBoardingCensus`: `arrivals * admitRate` = admission events, spread across the
next `boardingDuration` hours (fractional duration gets a partial-weight final hour), **circular
across the full 168-cell week**.

**Conserved-total property** (tested): summed across the week, `cellBoardingRnHours` totals
exactly `sum(arrivals * admitRate * boardingDuration) / boardingRatioTarget`. The convolution
redistributes *when*, never *how much*. Preserve this.

**Seasonality index** = `meanDuration[period] / overallBoardingDuration` — a ratio of **means**,
not medians (duration multiplies directly into total hours; the median of a product is not the
product of medians). Inputs are *mean duration per patient*, never raw totals: arrivals is one
representative week reused for all 12 months, so a total would conflate volume seasonality (which
this model can't represent) with duration seasonality (which it can). Both arrays are
all-or-nothing.

## Output shape — one representative week

- `weeklyBoardingDemandByCell(boarding, shiftMenu?)` -> Map `"day::shiftId"` -> weekly RN-hours.
  On the measured path with a `shiftMenu`, reads `cellBoardingRnHours` directly via
  `coveringCellsByGlobalHour`; otherwise recovers it from `prioritySlots`.
- `recommendWeeklyBoardingGrid(...)` — pre-fills the minimal plan reaching the p25 wHPPV band.
  Always funds >=1 unit; funds everything if the target is unreachable.
- `scopeWeeks(monthFactors, activeMonths)` — factor-weighted weeks. **Month toggles are SCOPE**
  (how many months the one weekly plan applies to, scaling the stats), never the pattern. There
  are no day toggles — zero a day by editing its cell.
- `annualBoardingCoveredByWeeklyGrid` (coverage, capped per cell at that cell's own demand) vs.
  `annualStaffingHoursForWeeklyGrid` (uncapped scheduled hours). The gap is real "efficiency
  overhead" — fixed 8/10/12h blocks can't trim to continuous hourly demand. Invariant: staffing
  >= coverage, always.
- Denominator for "% covered" is always the full `annualBoardingHours`. A toggled-off month or a
  shift-menu gap honestly caps the percentage below 100%. **Don't normalize this away** — the
  gap is the signal.

## Two hard rules that survived all four reversals

1. Boarding output is **never merged into `EngineResult.grid`** — always additive/separate.
2. Boarding is **never a 168-cell hourly staffing grid**. Check with Ben first.

## ASSUMPTION, flagged in the UI, not yet validated

`effectiveEdWhppvAtCoverage` assumes **linear proportional recovery** — funding X% of the
ranking recovers exactly X% of the wHPPV boarding consumes. Real recovery is very unlikely to be
linear (the ranking funds highest-value slots first). Revisit if real pre/post data appears.

## Do NOT resurrect (removed for cause)

`solveBoardingCoverage`, `deriveBoardingCoverageCells`, `restrictPrioritySlotsToActivePeriods`,
`boardingHoursCoveredByGrid`, `fundedCountToReachWhppv`, `BoardingCoverageCell`.
