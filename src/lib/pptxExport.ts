// PR H (RESULTS_PAGE_V2_SPEC_2026-07-27.md §7) — REWRITE, replacing the PR L export built for
// the pre-V2 nine-chapter architecture. Client-side only (pptxgenjs), nothing uploaded anywhere
// — the no-backend constraint holds. Slide titles still pull from `src/lib/narrative.ts` where
// a matching function exists — never a second, hand-written set of titles.
//
// SCOPE NARROWS (R12): title → current-staffing analysis (Panel 1's content) → the user's
// sandbox scenario (Panel 5) → the delta between them → Method & Limitations. Panels 2, 3 and 4
// are DELIBERATELY NOT exported — the deck is what a manager wants to present, not a dump of
// every panel on the page. If the sandbox is untouched (both grids all-zero/null), it's
// prefilled with the recommendation and slides are labeled as the tool's recommendation rather
// than the user's own scenario, per the spec's explicit instruction.
//
// EVERYTHING NATIVE, NO IMAGES: grids are native PPTX tables (`addTable`, colored cell fills —
// a simple lean/rich heuristic against each cell's own band, not a pixel-for-pixel copy of the
// web heatmap's color math) and the demand-vs-capacity/delta visuals are native PPTX charts
// (`addChart`), not screenshots.
//
// BRANDING: the app has no design-tokens system — the only brand asset is the favicon mark
// (purple #7C3AED on a pale #F5F0FF tile). The deck derives its theme from that mark plus the
// heatmap's own red/blue scale (lean = red, rich = blue) so the deck and the page read as
// visibly the same product: a title slide with a simple native-shape mark, one accent color,
// and a matching section-divider slide before each of the three main sections.
import PptxGenJS from 'pptxgenjs';
import { DAY_LABELS, type EngineInputs, type EngineResult, type Grid, type ShiftDef } from '../engine/types';
import { computeBacklog, computePerShiftDiagnostic } from '../engine';
import { fullWeekCapacity } from '../engine/solver';
import { recommendWeeklyBoardingGrid } from '../engine/boarding';
import { computeSandbox } from '../engine/sandbox';
import { lookupWhppvBand } from './edbaLookup';
import { averageDay } from './averageDay';
import { buildConstantsTable } from './constantsMetadata';
import { shiftDiagnosticSentence } from './narrative';

const ACCENT = '7C3AED';
const ACCENT_BG = 'F5F0FF';
const MUTED = '6B7280';
const LEAN = 'C23B3B';
const RICH = '2563EB';

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

function hasAnyStaffing(grid: Grid | null): boolean {
  return !!grid && Object.values(grid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));
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

function titleSlide(pptx: PptxGenJS, wHppvTarget: number) {
  const slide = pptx.addSlide();
  slide.background = { color: ACCENT_BG };
  markShape(pptx, slide, 0.6, 0.6, 0.9);
  slide.addText('Your ShiftLens Results', { x: 0.5, y: 1.9, w: 9, h: 1, fontSize: 32, bold: true, color: ACCENT });
  slide.addText(`Target: ${wHppvTarget} weighted hours per patient visit (wHPPV)`, { x: 0.5, y: 2.9, w: 9, h: 0.5, fontSize: 16, color: MUTED });
  slide.addNotes('ShiftLens splits nurse staffing into two separate demands: arrivals and boarding — modeled and reported separately, then added back together.');
}

function sectionDivider(pptx: PptxGenJS, title: string, subtitle?: string) {
  const slide = pptx.addSlide();
  slide.background = { color: ACCENT_BG };
  slide.addText(title, { x: 0.5, y: 2.2, w: 9, h: 1, fontSize: 28, bold: true, color: ACCENT, align: 'center' });
  if (subtitle) slide.addText(subtitle, { x: 0.5, y: 3.2, w: 9, h: 0.6, fontSize: 14, color: MUTED, align: 'center' });
}

function lineChart(pptx: PptxGenJS, slide: PptxGenJS.Slide, demand: number[], capacity: number[], y: number) {
  const labels = demand.map((_, i) => `${i}:00`);
  slide.addChart(
    pptx.ChartType.line,
    [
      { name: 'Demand', labels, values: demand },
      { name: 'Staffed capacity', labels, values: capacity },
    ],
    {
      x: 0.5,
      y,
      w: 9,
      h: 2.6,
      chartColors: [LEAN, RICH],
      showLegend: true,
      legendPos: 'b',
      catAxisLabelFontSize: 8,
      valAxisLabelFontSize: 8,
    }
  );
}

function currentStaffingSlides(pptx: PptxGenJS, result: EngineResult, currentStaffingGrid: Grid, arrivals: number[], shiftMenu: ShiftDef[]) {
  sectionDivider(pptx, 'Your current staffing', 'What your department demands, and what you staff against it');

  const sortedShiftMenu = sortShiftsByStartHour(shiftMenu);
  const capacity = fullWeekCapacity(currentStaffingGrid, sortedShiftMenu);
  const weeklyHours = totalWeeklyHours(currentStaffingGrid, sortedShiftMenu);
  const weeklyArrivals = arrivals.reduce((a, b) => a + b, 0);
  const realized = weeklyArrivals > 0 ? weeklyHours / weeklyArrivals : 0;
  const band = lookupWhppvBand(result.annualVisits);
  const position = realized < band.p25Whppv ? 'below' : realized > band.p75Whppv ? 'above' : 'within';

  const avgDemand = averageDay(result.hourlyRequirement);
  const avgCapacity = averageDay(capacity);
  const peakDemandHour = avgDemand.indexOf(Math.max(...avgDemand));
  const peakCapacityHour = avgCapacity.indexOf(Math.max(...avgCapacity));

  const headlineSlide = pptx.addSlide();
  headlineSlide.addText('What your department demands, and what you staff against it', { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 18, bold: true, color: ACCENT });
  headlineSlide.addText(
    `Realized ${realized.toFixed(2)} wHPPV, running ${position} the peer band (${band.p25Whppv.toFixed(2)}-${band.p75Whppv.toFixed(2)}) at ${weeklyHours.toFixed(0)} hours/week. ` +
      `On an average day, demand peaks around ${peakDemandHour}:00, staffing peaks around ${peakCapacityHour}:00.`,
    { x: 0.5, y: 1.1, w: 9, h: 1.2, fontSize: 14 }
  );
  lineChart(pptx, headlineSlide, avgDemand, avgCapacity, 2.5);
  headlineSlide.addNotes('The demand-vs-capacity chart mirrors Panel 1 on the results page, averaged across the week.');

  if (result.boarding) {
    const perShift = computePerShiftDiagnostic(
      result.hourlyRequirement,
      currentStaffingGrid,
      sortedShiftMenu,
      result.bandFloorHourly,
      result.bandCeilingHourly,
      result.boarding.cellBoardingRnHours
    );
    const slide = pptx.addSlide();
    slide.addText('The second demand: boarding', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 18, bold: true, color: ACCENT });
    const consumed = result.lostProductivity?.wHppvConsumedByBoarding ?? 0;
    slide.addText(
      `Boarding demands the equivalent of ${consumed.toFixed(2)} wHPPV. ${perShift.groups.map(shiftDiagnosticSentence).join(' ')}`,
      { x: 0.5, y: 1.1, w: 9, h: 3, fontSize: 13 }
    );
    slide.addNotes('Effective wHPPV is never compared to the peer band — peer figures include their own boarding load.');
  }

  const backlog = computeBacklog(currentStaffingGrid, arrivals, result.hourlyRequirement, sortedShiftMenu, result.floorWhppv);
  const structuralShort = -backlog.structuralFloorMin;
  const backlogSlide = pptx.addSlide();
  backlogSlide.addText('Where your staffing runs lean', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 18, bold: true, color: ACCENT });
  backlogSlide.addText(
    structuralShort > 0.5
      ? `You are short about ${structuralShort.toFixed(0)} nurse-hours a day against arrivals alone, so you begin each day already behind.`
      : "Your staffing doesn't leave you starting any day already behind — what backlog exists is shape, not size.",
    { x: 0.5, y: 1.1, w: 9, h: 1, fontSize: 14 }
  );
  backlogSlide.addNotes('Structural (sizing) and cyclical (shape) are reported separately — never the old blended "never clears" stat.');

  const gridSlide = pptx.addSlide();
  gridSlide.addText('Your current staffing grid', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true, color: ACCENT });
  gridSlide.addTable(gridToTableRows(currentStaffingGrid, sortedShiftMenu, result.bandFloorHourly, result.bandCeilingHourly), { x: 0.5, y: 1, w: 9, fontSize: 10 });
}

function sandboxSlides(
  pptx: PptxGenJS,
  result: EngineResult,
  inputs: EngineInputs,
  arrivals: number[],
  shiftMenu: ShiftDef[],
  sandboxEdGrid: Grid | null,
  sandboxHoldGrid: Grid | null
): { unmet: number } {
  const sortedShiftMenu = sortShiftsByStartHour(shiftMenu);
  const untouched = !hasAnyStaffing(sandboxEdGrid) && !hasAnyStaffing(sandboxHoldGrid);

  let edGrid = sandboxEdGrid ?? {};
  let holdGrid = sandboxHoldGrid ?? {};
  if (untouched) {
    // Prefill with the recommendation, all as ED nurses — per the spec's explicit instruction
    // ("if the sandbox is untouched, prefill it with the recommendation and label those slides
    // as the tool's recommendation rather than blocking the export").
    const band = lookupWhppvBand(result.annualVisits);
    const boardingGrid =
      result.boarding && result.lostProductivity
        ? recommendWeeklyBoardingGrid(result.boarding, sortedShiftMenu, inputs.wHppvTarget, band.p25Whppv, result.lostProductivity.wHppvConsumedByBoarding)
        : {};
    edGrid = {};
    for (let day = 0; day < 7; day++) {
      edGrid[day] = {};
      for (const s of sortedShiftMenu) edGrid[day][s.id] = (result.grid[day]?.[s.id] ?? 0) + (boardingGrid[day]?.[s.id] ?? 0);
    }
    holdGrid = {};
  }

  sectionDivider(
    pptx,
    untouched ? "The tool's recommendation" : 'Your scenario',
    untouched ? 'No sandbox scenario was entered — this is the recommendation, all as ED nurses' : 'Test it yourself'
  );

  const edCapacity = fullWeekCapacity(edGrid, sortedShiftMenu);
  const holdCapacity = fullWeekCapacity(holdGrid, sortedShiftMenu);
  const boarding = result.boarding;
  const combined = boarding?.cellBoardingRnHours ?? new Array(168).fill(0);
  const medWeekly = boarding?.medicalWeeklyRnHours ?? null;
  const bhWeekly = boarding?.bhWeeklyRnHours ?? null;
  const medFraction = medWeekly !== null && bhWeekly !== null && medWeekly + bhWeekly > 0 ? medWeekly / (medWeekly + bhWeekly) : 1;
  const medBoarding168 = combined.map((v) => v * medFraction);
  const bhBoarding168 = combined.map((v) => v * (1 - medFraction));
  const sandbox = computeSandbox(result.hourlyRequirement, medBoarding168, bhBoarding168, arrivals, edCapacity, holdCapacity);
  const unmetTotal = sandbox.unmet.reduce((a, b) => a + b, 0);
  const holdSurplusTotal = sandbox.holdSurplus.reduce((a, b) => a + b, 0);

  const chartSlide = pptx.addSlide();
  chartSlide.addText('Demand vs. staffed capacity', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true, color: ACCENT });
  lineChart(pptx, chartSlide, averageDay(sandbox.residualDemand), averageDay(edCapacity), 1);
  chartSlide.addText(
    `Hours below need this week: ${unmetTotal.toFixed(0)}.${holdSurplusTotal >= 0.5 ? ` Hold-nurse surplus: ${holdSurplusTotal.toFixed(0)} hours.` : ''}`,
    { x: 0.5, y: 3.9, w: 9, h: 0.6, fontSize: 13, color: MUTED }
  );

  const edSlide = pptx.addSlide();
  edSlide.addText('ED nurses', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true, color: ACCENT });
  edSlide.addTable(gridToTableRows(edGrid, sortedShiftMenu), { x: 0.5, y: 1, w: 9, fontSize: 10 });

  if (hasAnyStaffing(holdGrid)) {
    const holdSlide = pptx.addSlide();
    holdSlide.addText('Hold nurses', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true, color: ACCENT });
    holdSlide.addTable(gridToTableRows(holdGrid, sortedShiftMenu), { x: 0.5, y: 1, w: 9, fontSize: 10 });
    holdSlide.addNotes('Hold nurses cover medical/surg boarders only, never BH boarders or arrivals.');
  }

  return { unmet: unmetTotal };
}

function deltaSlide(pptx: PptxGenJS, currentUnmet: number, scenarioUnmet: number) {
  sectionDivider(pptx, 'The delta');
  const slide = pptx.addSlide();
  slide.addText('Hours below need: today vs. this scenario', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 18, bold: true, color: ACCENT });
  slide.addChart(
    pptx.ChartType.bar,
    [{ name: 'Hours below need', labels: ['Today', 'This scenario'], values: [currentUnmet, scenarioUnmet] }],
    { x: 1.5, y: 1.1, w: 6, h: 3.2, chartColors: [LEAN], showValue: true, valAxisLabelFontSize: 10, catAxisLabelFontSize: 10 }
  );
  slide.addNotes('Same shared frame the results page uses throughout — every chart on this page and in this deck reads the same way.');
}

function methodSlide(pptx: PptxGenJS, result: EngineResult) {
  const slide = pptx.addSlide();
  slide.addText('Method & limitations', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 20, bold: true, color: ACCENT });
  const constantsRows = buildConstantsTable();
  slide.addTable(
    [
      [
        { text: 'Constant', options: { bold: true, fill: { color: 'EEEEEE' } } },
        { text: 'Value', options: { bold: true, fill: { color: 'EEEEEE' } } },
        { text: 'Evidence', options: { bold: true, fill: { color: 'EEEEEE' } } },
      ],
      ...constantsRows.map((row) => [
        { text: row.label },
        { text: typeof row.value === 'object' ? JSON.stringify(row.value) : String(row.value) },
        { text: row.evidenceTag },
      ]),
    ],
    { x: 0.5, y: 1, w: 9, fontSize: 10 }
  );
  const reconciliationLine = `Reconciliation check: ${result.reconciliation.passes ? 'passes' : 'FAILING'} (gap ${(result.reconciliation.gapPct * 100).toFixed(4)}%)`;
  slide.addText(reconciliationLine, { x: 0.5, y: 5.2, w: 9, h: 0.4, fontSize: 12, color: result.reconciliation.passes ? MUTED : 'CC0000' });
  slide.addNotes(
    'Known approximations: a 48-hour backlog simulation window per trim candidate; linear boarding-recovery ' +
      'assumption; annual-exact month-scope conservation; circular no-reset backlog; greedy set-cover, not exact ' +
      'ILP; boarding census derived from admit timing, not directly measured. This slide is never skipped.'
  );
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
 * R12: title -> current-staffing analysis (Panel 1) -> sandbox scenario (Panel 5) -> the delta
 * -> Method & Limitations. Panels 2/3/4 are deliberately NOT exported. Method & Limitations is
 * ALWAYS included, never optional.
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

  titleSlide(pptx, wHppvTarget);

  if (hasAnyStaffing(currentStaffingGrid)) {
    currentStaffingSlides(pptx, result, currentStaffingGrid, arrivals, shiftMenu);
  } else {
    sectionDivider(pptx, 'Your current staffing', 'No current staffing was entered for this export');
  }

  const { unmet: scenarioUnmet } = sandboxSlides(pptx, result, inputs, arrivals, shiftMenu, sandboxEdGrid, sandboxHoldGrid);

  const currentCapacity = fullWeekCapacity(currentStaffingGrid, sortShiftsByStartHour(shiftMenu));
  const currentUnmet = result.hourlyRequirement.reduce((acc, req, i) => acc + Math.max(0, req - (currentCapacity[i] ?? 0)), 0);
  deltaSlide(pptx, currentUnmet, scenarioUnmet);

  methodSlide(pptx, result); // ALWAYS included, never optional

  await pptx.writeFile({ fileName: 'ShiftLens-Results.pptx' });
}
