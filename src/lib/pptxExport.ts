// PR L (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §9) — PPTX export. Client-side only
// (pptxgenjs), nothing uploaded anywhere — the no-backend constraint holds. Slide titles are
// pulled from `src/lib/narrative.ts` — the SAME functions the results page renders (or, for
// sections not yet migrated over to calling narrative.ts directly, the SAME wording those
// components use, per narrative.ts's own documented scope note) — never a second, hand-written
// set of titles.
import PptxGenJS from 'pptxgenjs';
import { DAY_LABELS, type EngineInputs, type EngineResult, type Grid, type ShiftDef } from '../engine/types';
import {
  computeScenarioB,
  computeHiddenBoardingDiagnostic,
  computeSynthesis,
  computeCombinedReallocation,
  summarizeBacklogSeverity,
} from '../engine';
import { buildConstantsTable } from './constantsMetadata';
import {
  scheduleMeansOvercoverageSentence,
  deliveryPremiumSentence,
  comparisonHeadlineSentence,
  scenarioBHeadlineSentence,
  hiddenBoardingNightSentence,
  hiddenBoardingDaySentence,
  synthesisHeadlineSentence,
  fundingAskAlreadyFundedSentence,
  fundingAskKneeLeadSentence,
  type GapKind,
} from './narrative';

const ACCENT = '7C3AED';
const MUTED = '6B7280';

function sortShiftsByStartHour(shifts: ShiftDef[]): ShiftDef[] {
  return [...shifts].sort((a, b) => a.startHour - b.startHour);
}

interface Cell {
  text: string;
  options: Record<string, unknown>;
}

function gridToTableRows(grid: Grid, shiftMenu: ShiftDef[]): Cell[][] {
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
      ...sorted.map((s) => ({ text: String(grid[day]?.[s.id] ?? 0), options: {} })),
    ]);
  }
  return rows;
}

function totalWeeklyHours(grid: Grid, shiftMenu: ShiftDef[]): number {
  let total = 0;
  for (let day = 0; day < 7; day++) {
    for (const s of shiftMenu) total += (grid[day]?.[s.id] ?? 0) * s.lengthHours;
  }
  return total;
}

function titleSlide(pptx: PptxGenJS, wHppvTarget: number) {
  const slide = pptx.addSlide();
  slide.addText('ShiftLens — Results', { x: 0.5, y: 1.8, w: 9, h: 1, fontSize: 32, bold: true, color: ACCENT });
  slide.addText(`Target: ${wHppvTarget} weighted hours per patient visit (wHPPV)`, {
    x: 0.5,
    y: 2.8,
    w: 9,
    h: 0.5,
    fontSize: 16,
    color: MUTED,
  });
  slide.addNotes(
    'This deck mirrors the ShiftLens results page. Each slide title is one of the page\'s own quotable, ' +
      'numbers-first sentences — read it aloud, it stands on its own.'
  );
}

function demandSlide(pptx: PptxGenJS, result: EngineResult, inputs: EngineInputs) {
  const slide = pptx.addSlide();
  const title = scheduleMeansOvercoverageSentence(result.weeklyScheduledHours, result.weeklyBudgetHours);
  slide.addText(title, { x: 0.5, y: 0.3, w: 9, h: 1, fontSize: 20, bold: true, color: ACCENT });
  const premium = deliveryPremiumSentence(
    result.weeklyScheduledHours,
    result.weeklyBudgetHours,
    inputs.shiftMenu.map((s) => s.lengthHours)
  );
  let y = 1.5;
  if (premium) {
    slide.addText(premium, { x: 0.5, y, w: 9, h: 0.8, fontSize: 14, color: MUTED });
    y += 0.9;
  }
  slide.addTable(gridToTableRows(result.grid, inputs.shiftMenu), { x: 0.5, y, w: 9, fontSize: 11, autoPage: false });
  slide.addNotes(
    'This is the idealized schedule the engine recommends against your own arrivals data and wHPPV target. ' +
      'The delivery premium (if shown) is shift-block granularity, not waste — whole nurses and fixed-length ' +
      'shifts can never exactly hit a continuous target.'
  );
}

function staffedAgainstItSlide(
  pptx: PptxGenJS,
  result: EngineResult,
  inputs: EngineInputs,
  currentStaffingGrid: Grid,
  hasCurrentStaffing: boolean
) {
  const slide = pptx.addSlide();
  if (!hasCurrentStaffing) {
    slide.addText('What you staff against it', { x: 0.5, y: 0.3, w: 9, h: 1, fontSize: 20, bold: true, color: ACCENT });
    slide.addText('No current staffing was entered for this export.', { x: 0.5, y: 1.5, w: 9, h: 0.6, fontSize: 14, color: MUTED });
    slide.addNotes('No current-staffing grid was entered when this deck was generated.');
    return;
  }
  const currentTotal = totalWeeklyHours(currentStaffingGrid, inputs.shiftMenu);
  let underHours = 0;
  let overHours = 0;
  for (let day = 0; day < 7; day++) {
    for (const s of inputs.shiftMenu) {
      const diff = ((result.grid[day]?.[s.id] ?? 0) - (currentStaffingGrid[day]?.[s.id] ?? 0)) * s.lengthHours;
      if (diff > 0) underHours += diff;
      else overHours += -diff;
    }
  }
  const sizeGapHours = underHours - overHours;
  const shapeGapHours = Math.min(underHours, overHours);
  const absSizeGap = Math.abs(sizeGapHours);
  const totalMismatch = absSizeGap + shapeGapHours;
  const gapKind: GapKind = totalMismatch < 1 ? 'none' : shapeGapHours < 0.2 * totalMismatch ? 'size' : absSizeGap < 0.2 * totalMismatch ? 'shape' : 'both';
  const title = comparisonHeadlineSentence(currentTotal, result.weeklyScheduledHours, gapKind, sizeGapHours, shapeGapHours, null);
  slide.addText(title, { x: 0.5, y: 0.3, w: 9, h: 1.3, fontSize: 18, bold: true, color: ACCENT });
  slide.addTable(gridToTableRows(currentStaffingGrid, inputs.shiftMenu), { x: 0.5, y: 1.8, w: 9, fontSize: 11, autoPage: false });
  slide.addNotes(
    'This is what the department actually staffs today, compared against the idealized grid on the previous ' +
      'slide. A size gap means the wrong total hours; a shape gap means the right total in the wrong shifts.'
  );
}

function scenarioBSlide(pptx: PptxGenJS, result: EngineResult, inputs: EngineInputs, currentStaffingGrid: Grid) {
  const slide = pptx.addSlide();
  const scenarioB = computeScenarioB(result, inputs, currentStaffingGrid);
  if (!scenarioB) {
    slide.addText('Could moving hours fix it?', { x: 0.5, y: 0.3, w: 9, h: 1, fontSize: 20, bold: true, color: ACCENT });
    slide.addText('No current staffing was entered for this export.', { x: 0.5, y: 1.5, w: 9, h: 0.6, fontSize: 14, color: MUTED });
    slide.addNotes('Scenario B needs current staffing to compute — none was entered.');
    return;
  }
  const currentSeverity = summarizeBacklogSeverity(currentStaffingGrid, result.hourlyRequirement, inputs.shiftMenu).totalSeverity;
  const title = scenarioBHeadlineSentence(scenarioB, currentSeverity);
  slide.addText(title, { x: 0.5, y: 0.3, w: 9, h: 1.5, fontSize: 18, bold: true, color: ACCENT });
  slide.addText('Computed on the ARRIVALS budget only — never a standalone recommendation without reading the boarding slide.', {
    x: 0.5,
    y: 2,
    w: 9,
    h: 0.6,
    fontSize: 12,
    italic: true,
    color: MUTED,
  });
  slide.addTable(
    [
      [
        { text: 'Hours (unchanged)', options: { bold: true } },
        { text: 'Severity, today', options: { bold: true } },
        { text: 'Severity, reallocated', options: { bold: true } },
      ],
      [
        { text: scenarioB.currentTotalWeeklyHours.toFixed(0) },
        { text: currentSeverity.toFixed(0) },
        { text: scenarioB.totalSeverity.toFixed(0) },
      ],
    ],
    { x: 0.5, y: 2.8, w: 9, fontSize: 12 }
  );
  slide.addNotes(
    'Scenario B answers "what would my current hours justify against arrivals alone" — a manager can act on ' +
      'this Monday with no additional funding ask. It never sees boarding; read the boarding slide before acting.'
  );
}

function fundingAskSlide(pptx: PptxGenJS, result: EngineResult, wHppvTarget: number) {
  const slide = pptx.addSlide();
  const { fullCoverage, marginalCurve, marginalKneePoint } = result;
  const alreadyFunded = fullCoverage.fteDelta <= 0;
  let title: string;
  if (alreadyFunded) {
    title = fundingAskAlreadyFundedSentence(fullCoverage.weeklyHours, fullCoverage.impliedWhppv, wHppvTarget);
  } else {
    const worstPoint = marginalCurve.length > 0 ? marginalCurve[marginalCurve.length - 1] : null;
    const kneePointData = marginalKneePoint !== null ? marginalCurve.find((p) => p.cumulativeHoursAdded === marginalKneePoint) ?? null : null;
    const kneeFte = marginalKneePoint !== null ? (marginalKneePoint * 52) / 2080 : null;
    const pctSeverityRemoved =
      kneePointData && worstPoint && worstPoint.totalSeverity > 0
        ? Math.max(0, Math.min(100, ((worstPoint.totalSeverity - kneePointData.totalSeverity) / worstPoint.totalSeverity) * 100))
        : null;
    const worstStretchLabel = worstPoint?.longestLeanStretchStart
      ? `${DAY_LABELS[worstPoint.longestLeanStretchStart.day]} ${worstPoint.longestLeanStretchStart.hour.toString().padStart(2, '0')}:00`
      : null;
    title =
      kneeFte !== null && pctSeverityRemoved !== null
        ? fundingAskKneeLeadSentence(
            kneeFte,
            pctSeverityRemoved,
            fullCoverage.weeklyHours,
            fullCoverage.fteDelta,
            fullCoverage.impliedWhppv,
            wHppvTarget,
            worstPoint?.longestLeanStretchHours ?? null,
            worstStretchLabel
          )
        : `Full coverage of every hour would take ${fullCoverage.weeklyHours.toFixed(0)} hrs/week.`;
  }
  slide.addText(title, { x: 0.5, y: 0.3, w: 9, h: 2, fontSize: 16, bold: true, color: ACCENT });
  slide.addNotes(
    'The ask leads with the knee of the marginal-return curve — the FTE ask that buys the most per FTE — not ' +
      'full coverage. Full coverage is shown as the far end of the range, not the headline.'
  );
}

function financeWorksheetSlide(pptx: PptxGenJS, result: EngineResult) {
  const slide = pptx.addSlide();
  slide.addText('Do the extra hours pay for themselves?', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 20, bold: true, color: ACCENT });
  slide.addText(
    [
      { text: 'More hours at the right times -> less queued work -> fewer abandoned nurse-hours -> fewer LWBS.\n', options: { fontSize: 14 } },
      {
        text: `Today, the model estimates about ${result.estimatedAbandonedHours.toFixed(0)} nurse-hours a week of queued care are abandoned to attrition.\n\n`,
        options: { fontSize: 14 },
      },
      {
        text: 'This tool does not convert this to a dollar figure — no salary, benefit-factor, or per-visit-margin inputs are collected.\n\n',
        options: { fontSize: 12, italic: true, color: MUTED },
      },
      {
        text: 'Take the FTE ask and the modeled abandoned-hours reduction to your CFO, and ask them for: cost per FTE, contribution margin per treated visit, and your current LWBS rate.',
        options: { fontSize: 14 },
      },
    ],
    { x: 0.5, y: 1.2, w: 9, h: 4 }
  );
  slide.addNotes('This worksheet deliberately stops short of a dollar figure — see the slide text for why.');
}

function boardingSlide(pptx: PptxGenJS, result: EngineResult, inputs: EngineInputs, currentStaffingGrid: Grid) {
  const diagnostic = computeHiddenBoardingDiagnostic(
    result.hourlyRequirement,
    currentStaffingGrid,
    inputs.shiftMenu,
    result.boarding?.cellBoardingRnHours ?? null
  );
  const slide = pptx.addSlide();
  const nightText = hiddenBoardingNightSentence(diagnostic.night, diagnostic.boardingDataPresent);
  const dayText = hiddenBoardingDaySentence(diagnostic.day, diagnostic.boardingDataPresent);
  slide.addText('The second demand: boarding', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 20, bold: true, color: ACCENT });
  slide.addText(`${nightText}\n\n${dayText}`, { x: 0.5, y: 1.1, w: 9, h: 2, fontSize: 14 });
  slide.addTable(
    [
      [
        { text: '', options: { bold: true } },
        { text: 'Arrivals need', options: { bold: true } },
        { text: 'Boarding need', options: { bold: true } },
        { text: 'Staffed', options: { bold: true } },
        { text: 'vs. arrivals alone', options: { bold: true } },
      ],
      ...[diagnostic.day, diagnostic.night].map((b) => [
        { text: b.label },
        { text: b.arrivalsNeedHours.toFixed(0) },
        { text: (b.boardingNeedHours ?? 0).toFixed(0) },
        { text: b.staffedHours.toFixed(0) },
        { text: `${b.vsArrivalsAlone > 0 ? '+' : ''}${b.vsArrivalsAlone.toFixed(0)}` },
      ]),
    ],
    { x: 0.5, y: 3.2, w: 9, fontSize: 12 }
  );
  slide.addNotes(
    'ShiftLens budgets arrivals and boarding separately. Where nights look staffed beyond what arrivals justify, ' +
      'that\'s usually boarding, absorbed into a schedule never sized for it — not overstaffing.'
  );
}

function constrainedReallocationSlide(pptx: PptxGenJS, result: EngineResult, inputs: EngineInputs, currentStaffingGrid: Grid) {
  const realloc = computeCombinedReallocation(result, inputs, currentStaffingGrid);
  if (!realloc) return;
  const slide = pptx.addSlide();
  const arrivalsCost = Math.max(0, realloc.arrivalsShortfallHoursAfter - realloc.arrivalsShortfallHoursBefore);
  slide.addText("If you can't get additional hours for boarding", { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 18, bold: true, color: ACCENT });
  slide.addText('A compromise, not a recommendation — it takes from arrivals coverage to cover boarders.', {
    x: 0.5,
    y: 1.1,
    w: 9,
    h: 0.5,
    fontSize: 12,
    italic: true,
    color: MUTED,
  });
  slide.addTable(
    [
      [{ text: 'Combined shortfall, today', options: { bold: true } }, { text: 'Combined shortfall, reallocated', options: { bold: true } }, { text: 'Cost on arrivals side', options: { bold: true } }],
      [
        { text: realloc.shortfallHoursBefore.toFixed(0) },
        { text: realloc.shortfallHoursAfter.toFixed(0) },
        { text: arrivalsCost.toFixed(0) },
      ],
    ],
    { x: 0.5, y: 1.8, w: 9, fontSize: 12 }
  );
  slide.addNotes('Same total hours, reallocated against combined arrivals+boarding demand — the cost on the arrivals side is named, never hidden.');
}

function synthesisSlide(pptx: PptxGenJS, result: EngineResult, inputs: EngineInputs, currentStaffingGrid: Grid) {
  const synthesis = computeSynthesis(result, inputs, currentStaffingGrid);
  const slide = pptx.addSlide();
  slide.addText('Both budgets together', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 20, bold: true, color: ACCENT });
  if (!synthesis) {
    slide.addText('No current staffing was entered for this export.', { x: 0.5, y: 1.5, w: 9, h: 0.6, fontSize: 14, color: MUTED });
    slide.addNotes('The synthesis needs current staffing to compute — none was entered.');
    return;
  }
  slide.addText(synthesisHeadlineSentence(synthesis), { x: 0.5, y: 1.2, w: 9, h: 2.5, fontSize: 16 });
  slide.addNotes(
    'Four numbers and a subtraction — this is the whole answer to "am I understaffed, or misallocated." No ' +
      'interpretive sentence follows; the arithmetic speaks for every department shape.'
  );
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
}

/**
 * Builds and downloads the results deck. Client-side only — nothing is uploaded anywhere.
 * Skips the Scenario B / boarding / constrained-reallocation slides' DATA (not always the
 * slide itself — see each slide function) when the underlying data isn't computed; the
 * Method & Limitations slide is ALWAYS included, per spec §9.
 */
export async function exportResultsToPptx({ result, inputs, currentStaffingGrid, wHppvTarget }: PptxExportInputs): Promise<void> {
  const pptx = new PptxGenJS();
  const hasCurrentStaffing =
    !!currentStaffingGrid && Object.values(currentStaffingGrid).some((row) => row && Object.values(row).some((v) => (v ?? 0) > 0));

  titleSlide(pptx, wHppvTarget);
  demandSlide(pptx, result, inputs);
  staffedAgainstItSlide(pptx, result, inputs, currentStaffingGrid, hasCurrentStaffing);
  scenarioBSlide(pptx, result, inputs, currentStaffingGrid);
  fundingAskSlide(pptx, result, wHppvTarget);
  financeWorksheetSlide(pptx, result);
  if (result.boarding) {
    boardingSlide(pptx, result, inputs, currentStaffingGrid);
    if (hasCurrentStaffing) constrainedReallocationSlide(pptx, result, inputs, currentStaffingGrid);
  }
  synthesisSlide(pptx, result, inputs, currentStaffingGrid);
  methodSlide(pptx, result); // ALWAYS included, never optional

  await pptx.writeFile({ fileName: 'ShiftLens-Results.pptx' });
}
