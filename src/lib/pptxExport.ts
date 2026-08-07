// PR H (RESULTS_PAGE_V2_SPEC_2026-07-27.md §7) — REWRITE, replacing the PR L export built for
// the pre-V2 nine-chapter architecture. Client-side only (pptxgenjs), nothing uploaded anywhere
// — the no-backend constraint holds. Slide titles/prose pull from `src/lib/narrative.ts` where a
// matching function exists — never a second, hand-written set of templated sentences. Purely
// static titles/labels (no computed values) are written directly here, matching this file's
// existing convention.
//
// R13 (2026-08-07) — fixed 10-slide structure, REPLACING R12's title -> current-staffing ->
// sandbox -> delta -> Method & Limitations narrowing. Method & Limitations is dropped entirely.
// The new deck pulls numbers from Panels 1, 3, and 5 (previously Panels 2/3/4 were deliberately
// not exported — that note in .claude/rules/results-redesign.md is now stale and updated
// alongside this file):
//   1. Title
//   2. Current staffing — Panel 1's realized-WHPPV/weekly-hours headline. Visual: staffing grid.
//   3. Hour-to-hour WHPPV range. Visual: full week, arrivals demand vs. staffed capacity.
//   4. Boarding impact. Visual: full week, arrivals + boarding demand vs. staffed capacity.
//   5. Peak lag + weekday backlog pattern. Visual: average-day backlog curve.
//   6. What full coverage would take (Panel 3's fullCoverageCombined). Visual: full week,
//      arrivals + boarding demand vs. staffed capacity AT full coverage.
//   7. The user's recommended-changes sandbox grid (Panel 5), or the recommendation if the
//      sandbox is untouched, per the same fallback R12 established.
//   8. Sandbox-vs-current-staffing comparison. Visual: % demand covered vs. total shifts/week
//      (the same curve MarginalReturnsCurve plots), as a native chart.
//   9. Panel 5's demand-vs-capacity, arrivals only, full week.
//  10. Panel 5's demand-vs-capacity, arrivals + boarding, full week.
//
// EVERYTHING NATIVE, NO IMAGES: grids are native PPTX tables (`addTable`, colored cell fills —
// a simple lean/rich heuristic against each cell's own band, not a pixel-for-pixel copy of the
// web heatmap's color math) and every demand/capacity/coverage visual is a native PPTX chart
// (`addChart`), not a screenshot.
//
// BRANDING: the app has no design-tokens system — the only brand asset is the favicon mark
// (purple #7C3AED on a pale #F5F0FF tile). The deck derives its theme from that mark plus the
// heatmap's own red/blue scale (lean = red, rich = blue) so the deck and the page read as
// visibly the same product: a title slide with a simple native-shape mark and one accent color.
import PptxGenJS from 'pptxgenjs';
import { DAY_LABELS, DEFAULTS, type EngineInputs, type EngineResult, type Grid, type ShiftDef } from '../engine/types';
import { computeBacklog } from '../engine';
import { fullWeekCapacity, solveFullCoverageWeekWithTrajectory } from '../engine/solver';
import { recommendWeeklyBoardingGrid } from '../engine/boarding';
import { computeSandbox } from '../engine/sandbox';
import { lookupWhppvBand } from './edbaLookup';
import { averageDay } from './averageDay';
import { computeQueuePattern, queuePatternSentence, WEEKDAY_DAYS, averageOverDays } from './queuePattern';
import {
  currentStaffingSummarySentence,
  whppvRangeSentence,
  boardingImpactSentence,
  peakLagSentence,
  fullCoverageAskSentence,
  sandboxComparisonSentence,
  type WhppvPosition,
} from './narrative';

const ACCENT = '7C3AED';
const ACCENT_BG = 'F5F0FF';
const MUTED = '6B7280';
const LEAN = 'C23B3B';
const RICH = '2563EB';
// Pale tint of --warning (#e8c468) — the web app's own demand-vs-capacity gap shading
// (VisualFrame.tsx's `gapAbove`, filled `var(--warning)` at low opacity). Solid, not alpha —
// see `demandCapacityChart`'s header comment for why alpha isn't used here.
const GAP_FILL = 'F6E6BE';

function sortShiftsByStartHour(shifts: ShiftDef[]): ShiftDef[] {
  return [...shifts].sort((a, b) => a.startHour - b.startHour);
}

function totalWeeklyHours(grid: Grid, shiftMenu: ShiftDef[]): number {
  let total = 0;
  for (let day = 0; day < 7; day++) {
    for (const s of shiftMenu) total += (grid[day]?.[s.id] ?? 0) * s.lengthHours;
  }
  return total;
}

function totalHeadcountUnits(grid: Grid, shiftMenu: ShiftDef[]): number {
  let total = 0;
  for (let day = 0; day < 7; day++) {
    for (const s of shiftMenu) total += grid[day]?.[s.id] ?? 0;
  }
  return total;
}

function hasAnyStaffing(grid: Grid | null): boolean {
  return !!grid && Object.values(grid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));
}

function whppvPosition(value: number, p25: number, p75: number): WhppvPosition {
  return value < p25 ? 'below' : value > p75 ? 'above' : 'within';
}

interface HourlyWhppvExtreme {
  value: number;
  day: number;
  hour: number;
}

/** Local copy of the same min/max-realized-WHPPV helper Panel 1/3/5 each keep their own copy
 * of (repo convention — see those files' own copies). */
function hourlyWhppvRange(capacity168: number[], arrivals168: number[]): { min: HourlyWhppvExtreme | null; max: HourlyWhppvExtreme | null } {
  let min: HourlyWhppvExtreme | null = null;
  let max: HourlyWhppvExtreme | null = null;
  for (let g = 0; g < 168; g++) {
    const cellArrivals = arrivals168[g] ?? 0;
    if (cellArrivals <= 0) continue;
    const value = (capacity168[g] ?? 0) / cellArrivals;
    const day = Math.floor(g / 24);
    const hour = g % 24;
    if (!min || value < min.value) min = { value, day, hour };
    if (!max || value > max.value) max = { value, day, hour };
  }
  return { min, max };
}

/** Local copy of Panel 5's own `pctDemandCovered` helper. */
function pctDemandCovered(capacity168: number[], demand168: number[]): number {
  const total = demand168.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let covered = 0;
  for (let g = 0; g < 168; g++) covered += Math.min(capacity168[g] ?? 0, demand168[g] ?? 0);
  return Math.max(0, Math.min(100, (covered / total) * 100));
}

interface Cell {
  text: string;
  options: Record<string, unknown>;
}

/** Native table with a simple per-cell fill: below its own hour's band floor reads lean (red
 * tint), above the ceiling reads rich (blue tint) — a simplified, not pixel-exact, echo of the
 * web heatmap's color logic (WhppvHeatmap.tsx), which this deck deliberately doesn't try to
 * reproduce exactly. */
function gridToTableRows(grid: Grid, shiftMenu: ShiftDef[], bandFloor168?: number[], bandCeiling168?: number[]): Cell[][] {
  const sorted = sortShiftsByStartHour(shiftMenu);
  const header: Cell[] = [
    { text: 'Day', options: { bold: true, fill: { color: 'EEEEEE' } } },
    ...sorted.map((s) => ({
      text: `${s.label || s.id} (${s.startHour.toString().padStart(2, '0')}:00, ${s.lengthHours}h)`,
      options: { bold: true, fill: { color: 'EEEEEE' } },
    })),
  ];
  const rows: Cell[][] = [header];
  for (let day = 0; day < 7; day++) {
    rows.push([
      { text: DAY_LABELS[day], options: { bold: true } },
      ...sorted.map((s) => {
        const headcount = grid[day]?.[s.id] ?? 0;
        let fill: { color: string } | undefined;
        if (bandFloor168 && bandCeiling168) {
          // Approximate this cell's own global hour as the shift's start hour that day — a
          // simplification (a shift covers many hours; the table shows one headcount per
          // cell, so there's no single "the" hour to check against a per-hour band exactly).
          const g = (day * 24 + s.startHour) % 168;
          if (headcount < (bandFloor168[g] ?? 0)) fill = { color: 'FBE2E2' };
          else if (headcount > (bandCeiling168[g] ?? 0)) fill = { color: 'DCE7FB' };
        }
        return { text: String(headcount), options: fill ? { fill } : {} };
      }),
    ]);
  }
  return rows;
}

function markShape(pptx: PptxGenJS, slide: PptxGenJS.Slide, x: number, y: number, size: number) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w: size, h: size, fill: { color: ACCENT }, rectRadius: 0.15 });
  slide.addText('S', { x, y, w: size, h: size, fontSize: size * 28, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
}

function slideHeader(pptx: PptxGenJS, title: string): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  slide.addText(title, { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 18, bold: true, color: ACCENT });
  return slide;
}

function titleSlide(pptx: PptxGenJS) {
  const slide = pptx.addSlide();
  slide.background = { color: ACCENT_BG };
  markShape(pptx, slide, 0.6, 0.6, 0.9);
  slide.addText('ShiftLens', { x: 0.5, y: 1.9, w: 9, h: 1, fontSize: 36, bold: true, color: ACCENT });
  slide.addText('ED Nurse Staffing Understood', { x: 0.5, y: 2.9, w: 9, h: 0.5, fontSize: 16, color: MUTED });
  slide.addNotes('ShiftLens splits nurse staffing into two separate demands: arrivals and boarding — modeled and reported separately, then added back together.');
}

/** Hour-of-day (0-23) set of every shift's start and end hour — the shift menu applies
 * identically every day (`ShiftDef` has no day-of-week variation), so this is computed once
 * and reused across all 7 days. */
function shiftBoundaryHours(shiftMenu: ShiftDef[]): Set<number> {
  const hours = new Set<number>();
  for (const s of shiftMenu) {
    hours.add(((s.startHour % 24) + 24) % 24);
    hours.add((((s.startHour + s.lengthHours) % 24) + 24) % 24);
  }
  return hours;
}

/** Full-week (168) category labels, text only at shift start/end hours — every other slot is
 * an empty string. Paired with `catAxisLabelFrequency: '1'` (show every category, but most are
 * blank) and `catAxisMajorTickMark: 'none'` (no per-hour dash marks), the axis then reads as
 * ticked only where a shift actually starts or ends, not at an arbitrary fixed interval. The
 * day name itself only appears on that day's FIRST tick (e.g. "Sun 07:00", then bare "19:00"
 * for the rest of Sunday) — repeating it at every boundary hour within the same day was
 * redundant clutter once ticks were already this sparse. */
function fullWeekLabels(boundaryHours: Set<number>): string[] {
  const out: string[] = [];
  for (let day = 0; day < 7; day++) {
    let dayLabeled = false;
    for (let hour = 0; hour < 24; hour++) {
      if (!boundaryHours.has(hour)) {
        out.push('');
        continue;
      }
      const hourLabel = `${hour.toString().padStart(2, '0')}:00`;
      out.push(dayLabeled ? hourLabel : `${DAY_LABELS[day]} ${hourLabel}`);
      dayLabeled = true;
    }
  }
  return out;
}

/** A manual color-swatch legend row, matching the web app's own convention
 * (`VisualFrame.tsx`'s `.frame-chart-legend` — a hand-drawn legend outside the chart, never
 * pptxgenjs's automatic one) — needed here because the automatic legend would otherwise also
 * list `demandCapacityChart`'s internal "Baseline"/"Gap" series, which exist only to draw the
 * shaded band and mean nothing to a reader. */
function chartLegend(pptx: PptxGenJS, slide: PptxGenJS.Slide, y: number, items: Array<{ label: string; color: string }>) {
  let x = 0.5;
  for (const item of items) {
    slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.16, h: 0.12, fill: { color: item.color }, line: { type: 'none' } });
    slide.addText(item.label, { x: x + 0.22, y: y - 0.07, w: 2, h: 0.26, fontSize: 9, color: MUTED });
    x += 2.2;
  }
}

const NO_GRID = { style: 'none' as const };

/** Demand vs. capacity, gap shaded — matches `VisualFrame.tsx`'s `DemandCapacityChart`, which
 * draws two lines plus fills only the band BETWEEN them (`gapAbove`/`gapBelow`), not the full
 * area under either curve. Native pptx charts have no "fill between two series" primitive, so
 * this is a stacked-area + line combo: an invisible `baseline` series (`min(demand,capacity)`)
 * with a visible `gap` series (`abs(demand-capacity)`) stacked on top of it — their sum is
 * exactly `max(demand,capacity)`, so the visible band's top edge lands exactly on whichever
 * line is higher, same as the web version. The two crisp lines are drawn on top via a second,
 * un-stacked series in the same combo chart. Solid fill colors, not alpha — combining
 * `chartColorsOpacity` (a single number, applied to ALL series in a data block) with a
 * genuinely-transparent baseline and a tinted gap isn't expressible in one option, so the
 * baseline is opaque white (blends into the slide's own white background) and the gap uses a
 * pre-mixed pale tint (`GAP_FILL`) instead. */
function demandCapacityChart(pptx: PptxGenJS, slide: PptxGenJS.Slide, labels: string[], demand: number[], capacity: number[], y: number) {
  chartLegend(pptx, slide, y, [
    { label: 'Demand', color: LEAN },
    { label: 'Staffed capacity', color: RICH },
  ]);
  const baseline = demand.map((d, i) => Math.min(d, capacity[i] ?? 0));
  const gap = demand.map((d, i) => Math.abs(d - (capacity[i] ?? 0)));
  const comboTypes: PptxGenJS.IChartMulti[] = [
    {
      type: 'area',
      data: [
        { name: 'Baseline', labels, values: baseline },
        { name: 'Gap', labels, values: gap },
      ],
      options: { chartColors: ['FFFFFF', GAP_FILL] },
    },
    {
      type: 'line',
      data: [
        { name: 'Demand', labels, values: demand },
        { name: 'Staffed capacity', labels, values: capacity },
      ],
      // No per-point markers — reads as a plain continuous line, matching the web app's own
      // demand/capacity curves (straight M/L polylines with no dots at each hour). `lineSmooth`
      // is deliberately left off too: the web curves are straight segments between real hourly
      // values, not a spline — smoothing would visually invent values between real points.
      options: { chartColors: [LEAN, RICH], lineDataSymbol: 'none' as const },
    },
  ];
  slide.addChart(comboTypes, undefined as unknown as any[], {
    x: 0.5,
    y: y + 0.32,
    w: 9,
    h: 2.3,
    barGrouping: 'stacked',
    showLegend: false,
    catAxisLabelFontSize: 7,
    valAxisLabelFontSize: 8,
    // Every category slot is considered (not skipped by a fixed interval) — most are blank
    // strings (see `fullWeekLabels`), so only shift start/end hours end up with visible text.
    catAxisLabelFrequency: '1',
    catAxisMajorTickMark: 'none',
    catGridLine: NO_GRID,
    valGridLine: NO_GRID,
  });
}

/** @param tickEveryCategory when true (the hour-based backlog chart, whose `labels` are
 * `fullWeekLabels`'s sparse shift-boundary-only strings), every category slot is considered so
 * the blanks stay blank and only boundary hours get a visible tick — matching
 * `demandCapacityChart`. When false (the shift-count-based coverage curve, slide 8, whose
 * labels are all real numbers with nothing to sparsify), falls back to a fixed skip interval. */
function singleSeriesChart(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  name: string,
  labels: string[],
  values: number[],
  y: number,
  color: string,
  tickEveryCategory: boolean
) {
  slide.addChart(pptx.ChartType.line, [{ name, labels, values }], {
    x: 0.5,
    y,
    w: 9,
    h: 2.4,
    chartColors: [color],
    showLegend: true,
    legendPos: 'b',
    catAxisLabelFontSize: 8,
    valAxisLabelFontSize: 8,
    catAxisLabelFrequency: tickEveryCategory ? '1' : '2',
    catAxisMajorTickMark: tickEveryCategory ? 'none' : undefined,
    lineDataSymbol: 'none',
    catGridLine: NO_GRID,
    valGridLine: NO_GRID,
  });
}

// --- Slide 2: current staffing ---

function currentStaffingSlide(pptx: PptxGenJS, currentStaffingGrid: Grid, sortedShiftMenu: ShiftDef[], result: EngineResult, realized: number, weeklyHours: number, position: WhppvPosition) {
  const slide = slideHeader(pptx, 'Current staffing');
  slide.addText(currentStaffingSummarySentence(realized, weeklyHours, position), { x: 0.5, y: 1, w: 9, h: 0.8, fontSize: 14 });
  slide.addTable(gridToTableRows(currentStaffingGrid, sortedShiftMenu, result.bandFloorHourly, result.bandCeilingHourly), { x: 0.5, y: 1.9, w: 9, fontSize: 10 });
  slide.addNotes('The staffing grid mirrors Panel 1 on the results page — cell fill echoes (not exactly reproduces) the web heatmap.');
}

// --- Slide 3: hour-to-hour WHPPV range ---

function hourlyRangeSlide(pptx: PptxGenJS, result: EngineResult, currentCapacity: number[], arrivals: number[], realized: number, sortedShiftMenu: ShiftDef[]) {
  const slide = slideHeader(pptx, 'Hour-to-hour range');
  const { min, max } = hourlyWhppvRange(currentCapacity, arrivals);
  const sentence = min && max
    ? whppvRangeSentence(min.value, min, max.value, max, realized)
    : 'No hours had both arrivals and staffed capacity to compare, so no hour-to-hour range is available.';
  slide.addText(sentence, { x: 0.5, y: 1, w: 9, h: 0.9, fontSize: 14 });
  demandCapacityChart(pptx, slide, fullWeekLabels(shiftBoundaryHours(sortedShiftMenu)), result.hourlyRequirement, currentCapacity, 2.1);
  slide.addNotes('Full week, arrivals only — Panel 1\'s "Arrivals" toggle, un-averaged.');
}

// --- Slide 4: boarding impact ---

function boardingImpactSlide(
  pptx: PptxGenJS,
  result: EngineResult,
  currentCapacity: number[],
  combinedRequirement: number[],
  wHppvTarget: number,
  realized: number,
  band: { p25Whppv: number; p75Whppv: number },
  sortedShiftMenu: ShiftDef[]
) {
  const slide = slideHeader(pptx, 'Boarding impact');
  if (result.boarding) {
    const consumed = result.lostProductivity?.wHppvConsumedByBoarding ?? 0;
    const pctOfTotal = result.annualVisits > 0 && wHppvTarget > 0 ? (consumed / wHppvTarget) * 100 : 0;
    const effectiveWhppv = realized - consumed;
    const effectivePosition = whppvPosition(effectiveWhppv, band.p25Whppv, band.p75Whppv);
    slide.addText(boardingImpactSentence(result.boarding.weeklyBoardingHours, pctOfTotal, consumed, effectiveWhppv, effectivePosition), {
      x: 0.5,
      y: 1,
      w: 9,
      h: 1,
      fontSize: 14,
    });
  } else {
    slide.addText('Boarding data isn\'t available for this export, so arrivals + boarding matches arrivals alone below.', {
      x: 0.5,
      y: 1,
      w: 9,
      h: 0.6,
      fontSize: 14,
      color: MUTED,
    });
  }
  demandCapacityChart(pptx, slide, fullWeekLabels(shiftBoundaryHours(sortedShiftMenu)), combinedRequirement, currentCapacity, 2.1);
  slide.addNotes('Full week, arrivals + boarding — Panel 1\'s "Arrivals + Boarding" toggle, un-averaged.');
}

// --- Slide 5: peak lag + weekday backlog pattern ---

function lagBacklogSlide(pptx: PptxGenJS, result: EngineResult, currentStaffingGrid: Grid, currentCapacity: number[], arrivals: number[], sortedShiftMenu: ShiftDef[]) {
  const slide = slideHeader(pptx, 'Lag and backlog');
  const avgDemand = averageDay(result.hourlyRequirement);
  const avgCapacity = averageDay(currentCapacity);
  const peakDemandHour = avgDemand.indexOf(Math.max(...avgDemand));
  const peakCapacityHour = avgCapacity.indexOf(Math.max(...avgCapacity));
  const rampGap = (peakCapacityHour - peakDemandHour + 24) % 24;

  const backlog = computeBacklog(currentStaffingGrid, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv);
  const avgBacklogWeekday = averageOverDays(backlog.backlog, WEEKDAY_DAYS);
  const avgRequirementWeekday = averageOverDays(result.hourlyRequirement, WEEKDAY_DAYS);
  const weekdayPattern = computeQueuePattern(avgBacklogWeekday, avgRequirementWeekday);

  slide.addText(
    `${peakLagSentence(peakDemandHour, peakCapacityHour, rampGap)} ${queuePatternSentence(weekdayPattern, 'On weekdays, ', result.floorWhppv)}`,
    { x: 0.5, y: 1, w: 9, h: 1.3, fontSize: 14 }
  );
  // Full week, not averaged — consistent with every other chart in the deck (slides 3/4/6/9/10
  // are all full-week already; this used to be the one averaged-to-24-points exception).
  singleSeriesChart(pptx, slide, 'Backlog (nurse-hours)', fullWeekLabels(shiftBoundaryHours(sortedShiftMenu)), backlog.backlog, 2.5, LEAN, true);
  slide.addNotes('Full week backlog curve, arrivals only — the queue-depth strip on Panel 1\'s "Arrivals" toggle.');
}

// --- Slide 6: what full coverage would take ---

function fullCoverageSlide(pptx: PptxGenJS, result: EngineResult, inputs: EngineInputs, currentStaffingGrid: Grid, sortedShiftMenu: ShiftDef[], combinedRequirement: number[]) {
  const slide = slideHeader(pptx, 'What would full coverage take?');
  const hoursPerFteAnnual = inputs.hoursPerFteAnnual ?? DEFAULTS.hoursPerFteAnnual;
  const additionalShiftsPerWeek = totalHeadcountUnits(result.fullCoverage.grid, sortedShiftMenu) - totalHeadcountUnits(currentStaffingGrid, sortedShiftMenu);
  const staffedHours = totalWeeklyHours(currentStaffingGrid, sortedShiftMenu);
  const arrivalsFteDelta = ((result.fullCoverage.weeklyHours - staffedHours) * 52) / hoursPerFteAnnual;
  const boardingFteDelta = ((result.fullCoverageCombined.weeklyHours - result.fullCoverage.weeklyHours) * 52) / hoursPerFteAnnual;
  slide.addText(fullCoverageAskSentence(additionalShiftsPerWeek, arrivalsFteDelta, boardingFteDelta), { x: 0.5, y: 1, w: 9, h: 1, fontSize: 14 });
  const fullCoverageCapacity = fullWeekCapacity(result.fullCoverageCombined.grid, sortedShiftMenu);
  demandCapacityChart(pptx, slide, fullWeekLabels(shiftBoundaryHours(sortedShiftMenu)), combinedRequirement, fullCoverageCapacity, 2.1);
  slide.addNotes('Full week, arrivals + boarding, at full coverage — Panel 3\'s "Arrivals + Boarding" toggle, un-averaged.');
}

// --- Slide 7: recommended changes ---

function resolveSandboxGrids(
  result: EngineResult,
  inputs: EngineInputs,
  sortedShiftMenu: ShiftDef[],
  sandboxEdGrid: Grid | null,
  sandboxHoldGrid: Grid | null
): { edGrid: Grid; holdGrid: Grid; untouched: boolean } {
  const untouched = !hasAnyStaffing(sandboxEdGrid) && !hasAnyStaffing(sandboxHoldGrid);
  if (!untouched) {
    return { edGrid: sandboxEdGrid ?? {}, holdGrid: sandboxHoldGrid ?? {}, untouched };
  }
  // Prefill with the recommendation, all as ED nurses — per the spec's explicit instruction
  // ("if the sandbox is untouched, prefill it with the recommendation and label those slides
  // as the tool's recommendation rather than blocking the export").
  const band = lookupWhppvBand(result.annualVisits);
  const boardingGrid =
    result.boarding && result.lostProductivity
      ? recommendWeeklyBoardingGrid(result.boarding, sortedShiftMenu, inputs.wHppvTarget, band.p25Whppv, result.lostProductivity.wHppvConsumedByBoarding)
      : {};
  const edGrid: Grid = {};
  for (let day = 0; day < 7; day++) {
    edGrid[day] = {};
    for (const s of sortedShiftMenu) edGrid[day][s.id] = (result.grid[day]?.[s.id] ?? 0) + (boardingGrid[day]?.[s.id] ?? 0);
  }
  return { edGrid, holdGrid: {}, untouched };
}

function recommendedChangesSlide(pptx: PptxGenJS, edGrid: Grid, holdGrid: Grid, untouched: boolean, sortedShiftMenu: ShiftDef[]) {
  const slide = slideHeader(pptx, 'My recommended changes');
  if (untouched) {
    slide.addText("No sandbox scenario was entered — this reflects the tool's recommendation, all as ED nurses.", {
      x: 0.5,
      y: 0.95,
      w: 9,
      h: 0.4,
      fontSize: 12,
      color: MUTED,
    });
  }
  const gridTop = untouched ? 1.5 : 1.1;
  slide.addText('ED nurses', { x: 0.5, y: gridTop, w: 9, h: 0.35, fontSize: 13, bold: true });
  slide.addTable(gridToTableRows(edGrid, sortedShiftMenu), { x: 0.5, y: gridTop + 0.35, w: 9, fontSize: 9 });
  if (hasAnyStaffing(holdGrid)) {
    const holdTop = gridTop + 0.35 + 2.6;
    slide.addText('Hold nurses', { x: 0.5, y: holdTop, w: 9, h: 0.35, fontSize: 13, bold: true });
    slide.addTable(gridToTableRows(holdGrid, sortedShiftMenu), { x: 0.5, y: holdTop + 0.35, w: 9, fontSize: 9 });
    slide.addNotes('Hold nurses cover medical/surg boarders only, never BH boarders or arrivals.');
  }
}

// --- Slide 8: comparison vs. current staffing ---

function comparisonSlide(
  pptx: PptxGenJS,
  sortedShiftMenu: ShiftDef[],
  currentStaffingGrid: Grid,
  currentCapacity: number[],
  edGrid: Grid,
  holdGrid: Grid,
  combinedCapacity168: number[],
  combinedRequirement: number[]
) {
  const slide = slideHeader(pptx, 'Comparison to current staffing');
  const currentPctCovered = pctDemandCovered(currentCapacity, combinedRequirement);
  const scenarioPctCovered = pctDemandCovered(combinedCapacity168, combinedRequirement);
  const additionalEdShiftsPerWeek = totalHeadcountUnits(edGrid, sortedShiftMenu) - totalHeadcountUnits(currentStaffingGrid, sortedShiftMenu);
  const additionalHoldShiftsPerWeek = totalHeadcountUnits(holdGrid, sortedShiftMenu);
  slide.addText(sandboxComparisonSentence(scenarioPctCovered - currentPctCovered, additionalEdShiftsPerWeek, additionalHoldShiftsPerWeek), {
    x: 0.5,
    y: 1,
    w: 9,
    h: 1,
    fontSize: 14,
  });

  const totalDemandHours = combinedRequirement.reduce((a, b) => a + b, 0);
  const trajectory = totalDemandHours > 0 ? solveFullCoverageWeekWithTrajectory(combinedRequirement, sortedShiftMenu).trajectory : [];
  const points = [{ x: 0, y: 0 }, ...trajectory.map((p) => ({ x: p.cumulativeShifts, y: Math.max(0, Math.min(100, (p.hoursCovered / totalDemandHours) * 100)) }))];
  if (points.length >= 2) {
    // Shift-count x-axis, not hour-of-day — no shift boundaries to sparsify against, so this
    // keeps the fixed-interval tick behavior rather than `demandCapacityChart`'s sparse one.
    singleSeriesChart(pptx, slide, '% of demand covered', points.map((p) => String(p.x)), points.map((p) => p.y), 2.1, RICH, false);
  }
  slide.addNotes('Same curve MarginalReturnsCurve plots on Panel 5 — % of total (arrivals + boarding) demand covered as total scheduled shifts increase.');
}

// --- Slides 9/10: Panel 5's full-week demand-vs-capacity views ---

function fullWeekViewSlide(pptx: PptxGenJS, title: string, demand: number[], capacity: number[], sortedShiftMenu: ShiftDef[]) {
  const slide = slideHeader(pptx, title);
  demandCapacityChart(pptx, slide, fullWeekLabels(shiftBoundaryHours(sortedShiftMenu)), demand, capacity, 1.1);
}

export interface PptxExportInputs {
  result: EngineResult;
  inputs: EngineInputs;
  currentStaffingGrid: Grid;
  wHppvTarget: number;
  arrivals: number[];
  shiftMenu: ShiftDef[];
  sandboxEdGrid?: Grid | null;
  sandboxHoldGrid?: Grid | null;
}

/**
 * Builds and downloads the results deck. Client-side only — nothing is uploaded anywhere.
 * R13: title -> current staffing -> hour-to-hour range -> boarding impact -> lag/backlog ->
 * full-coverage ask -> recommended changes (Panel 5's sandbox, or the recommendation) ->
 * comparison to current staffing -> Panel 5's two full-week views. Fixed 10 slides.
 */
export async function exportResultsToPptx({
  result,
  inputs,
  currentStaffingGrid,
  wHppvTarget,
  arrivals,
  shiftMenu,
  sandboxEdGrid = null,
  sandboxHoldGrid = null,
}: PptxExportInputs): Promise<void> {
  const pptx = new PptxGenJS();
  const sortedShiftMenu = sortShiftsByStartHour(shiftMenu);
  const band = lookupWhppvBand(result.annualVisits);
  const boardingCurve = result.boarding?.cellBoardingRnHours ?? null;
  const combinedRequirement = result.hourlyRequirement.map((v, i) => v + (boardingCurve ? boardingCurve[i] : 0));

  const currentCapacity = fullWeekCapacity(currentStaffingGrid, sortedShiftMenu);
  const weeklyHours = totalWeeklyHours(currentStaffingGrid, sortedShiftMenu);
  const weeklyArrivals = arrivals.reduce((a, b) => a + b, 0);
  const realized = weeklyArrivals > 0 ? weeklyHours / weeklyArrivals : 0;
  const position = whppvPosition(realized, band.p25Whppv, band.p75Whppv);

  titleSlide(pptx);
  currentStaffingSlide(pptx, currentStaffingGrid, sortedShiftMenu, result, realized, weeklyHours, position);
  hourlyRangeSlide(pptx, result, currentCapacity, arrivals, realized, sortedShiftMenu);
  boardingImpactSlide(pptx, result, currentCapacity, combinedRequirement, wHppvTarget, realized, band, sortedShiftMenu);
  lagBacklogSlide(pptx, result, currentStaffingGrid, currentCapacity, arrivals, sortedShiftMenu);
  fullCoverageSlide(pptx, result, inputs, currentStaffingGrid, sortedShiftMenu, combinedRequirement);

  const { edGrid, holdGrid, untouched } = resolveSandboxGrids(result, inputs, sortedShiftMenu, sandboxEdGrid, sandboxHoldGrid);
  recommendedChangesSlide(pptx, edGrid, holdGrid, untouched, sortedShiftMenu);

  const edCapacity = fullWeekCapacity(edGrid, sortedShiftMenu);
  const holdCapacityRaw = fullWeekCapacity(holdGrid, sortedShiftMenu);
  const boarding = result.boarding;
  const combined = boarding?.cellBoardingRnHours ?? new Array(168).fill(0);
  const medWeekly = boarding?.medicalWeeklyRnHours ?? null;
  const bhWeekly = boarding?.bhWeeklyRnHours ?? null;
  const medFraction = medWeekly !== null && bhWeekly !== null && medWeekly + bhWeekly > 0 ? medWeekly / (medWeekly + bhWeekly) : 1;
  const medBoarding168 = combined.map((v) => v * medFraction);
  const bhBoarding168 = combined.map((v) => v * (1 - medFraction));
  const sandbox = computeSandbox(result.hourlyRequirement, medBoarding168, bhBoarding168, arrivals, edCapacity, holdCapacityRaw);
  const combinedCapacity168 = edCapacity.map((v, i) => v + sandbox.holdApplied[i]);

  comparisonSlide(pptx, sortedShiftMenu, currentStaffingGrid, currentCapacity, edGrid, holdGrid, combinedCapacity168, combinedRequirement);

  fullWeekViewSlide(pptx, 'Arrivals: demand vs. staffed capacity', result.hourlyRequirement, edCapacity, sortedShiftMenu);
  fullWeekViewSlide(pptx, 'Arrivals + Boarding: demand vs. staffed capacity', combinedRequirement, combinedCapacity168, sortedShiftMenu);

  await pptx.writeFile({ fileName: 'ShiftLens-Results.pptx' });
}
