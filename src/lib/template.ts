import * as XLSX from 'xlsx';
import { MONTH_NAMES } from '../engine/types';
import type { Grid, ShiftDef } from '../engine/types';
import type { FlexAxes } from '../engine/flexMenu';
import { DISPLAY_DAY_ORDER } from './dayOrder';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ONE consolidated multi-tab workbook — replaces the old two-independent-templates model
// (arrivals-only + ESI-mix-only) and the scalar admit-rate/boarding-duration typed fields.
// One explainer, one template, one upload — see .claude/rules/template-parsing.md for why.
// Arrivals/ESI Mix columns are explicitly labeled "Average" — the engine's math
// (annualVisits = sum(arrivals) * 52) treats each hour-of-week cell as a period average,
// not one arbitrary week's raw counts. See .claude/rules/template-parsing.md.
// 2026-07-26 (Phase 2a, BACKLOG_FEEDBACK_AND_VARIANCE_SPEC_2026-07-25.md): an optional 4th
// column, all-or-nothing (same rule as ESI mix) — the busy-hour (p75) arrivals count per
// cell, alongside the required mean. Lives on the SAME Arrivals tab (not a 5th tab) per the
// one-consolidated-template rule, see .claude/rules/template-parsing.md.
export const ARRIVALS_TEMPLATE_COLUMNS = ['Day', 'Hour', 'Average Arrivals', 'P75 Arrivals'] as const;
export const ESI_MIX_TEMPLATE_COLUMNS = ['Day', 'Hour', 'Average ESI 1-2 Count', 'Average ESI 3 Count', 'Average ESI 4-5 Count'] as const;
export const SCALARS_TEMPLATE_COLUMNS = ['Field', 'Value'] as const;
export const SCALARS_TEMPLATE_FIELDS = ['Admit Rate', 'Mean Boarding Duration (hrs)'] as const;
export const SEASONALITY_TEMPLATE_COLUMNS = [
  'Month',
  'Mean Boarding Duration by Month (hrs)',
  'Mean Medical Boarding Census by Month',
  'Mean BH Boarding Census by Month',
  'Day of Week',
  'Mean Boarding Duration by Day of Week (hrs)',
] as const;

// 2026-07-27 (SETUP_AND_MEASURED_BOARDING_SPEC_2026-07-27.md §2.1, revised same day per the
// guided-setup/export follow-up prompt) — the new, PREFERRED boarding path: a directly
// measured hourly census. Precise definition (load-bearing, not a paraphrase): patients
// physically in the ED who have a bed request placed and no inpatient bed assigned, counted
// at each hour. A department that can't produce exactly that uses the admit-rate + mean
// boarding-duration fallback instead (Scalars tab) — there is no arrival-clocked variant and
// no clock-start setting; see .claude/rules/boarding-seasonality.md's measured-path section
// for why a "counted from arrival, here's a caveat" compromise was rejected. Each of the three
// census columns is independently all-or-nothing across its 168 rows (§2.2), same rule as ESI
// mix/P75 arrivals.
export const BOARDING_CENSUS_TEMPLATE_COLUMNS = [
  'Day',
  'Hour',
  'Medical Boarding Census',
  'BH Boarding Census',
  'Pre-Bed-Request Census',
] as const;

// `fillArrays[i]` supplies the values for `columns[2 + i]` (the Day/Hour columns are never
// filled from data). `undefined`/absent arrays render blank, same as the plain blank
// template — this is what lets `hourGridRows` serve both the blank-template generator and
// the Part 3 "download my data file" export from the SAME function, rather than a second
// hand-maintained copy that could drift.
function hourGridRows(columns: readonly string[], fillArrays?: Array<number[] | null | undefined>): (string | number)[][] {
  const rows: (string | number)[][] = [columns.slice()];
  // Row emission order is Mon-first (DISPLAY_DAY_ORDER) — display-only; the parser matches
  // rows to days by NAME (DAY_ALIASES in parseUpload.ts), never by row position, so this has
  // no effect on parsing — see .claude/rules/template-parsing.md.
  for (const day of DISPLAY_DAY_ORDER) {
    for (let hour = 0; hour < 24; hour++) {
      const idx = day * 24 + hour;
      const values = columns.slice(2).map((_, i) => {
        const arr = fillArrays?.[i];
        return arr ? arr[idx] : '';
      });
      rows.push([DAY_NAMES[day], hour, ...values]);
    }
  }
  return rows;
}

function scalarsRows(admitRate?: number | null, boardingDuration?: number | null): (string | number)[][] {
  const values = [admitRate, boardingDuration];
  return [SCALARS_TEMPLATE_COLUMNS.slice(), ...SCALARS_TEMPLATE_FIELDS.map((f, i) => [f, values[i] ?? ''])];
}

/**
 * Two small tables in one sheet, laid out as one 6-column row set rather than stacked
 * blocks — 12 rows (months), with the day-of-week columns populated for the first 7 and
 * left blank after, so both tables parse as one tolerant row-by-row scan (no positional/
 * block parsing needed). See .claude/rules/template-parsing.md.
 * 2026-07-27: gained the two monthly census columns (measured-path seasonality, §3.4) —
 * the census columns win over the duration-mean columns when both are present.
 */
function seasonalityRows(fill?: {
  monthlyMeanBoardingDurationHours?: number[] | null;
  monthlyBoardingCensusMedical?: number[] | null;
  monthlyBoardingCensusBH?: number[] | null;
  dayOfWeekMeanBoardingDurationHours?: number[] | null;
}): (string | number)[][] {
  const rows: (string | number)[][] = [SEASONALITY_TEMPLATE_COLUMNS.slice()];
  for (let i = 0; i < 12; i++) {
    rows.push([
      MONTH_NAMES[i],
      fill?.monthlyMeanBoardingDurationHours?.[i] ?? '',
      fill?.monthlyBoardingCensusMedical?.[i] ?? '',
      fill?.monthlyBoardingCensusBH?.[i] ?? '',
      i < 7 ? DAY_NAMES[i] : '',
      i < 7 ? (fill?.dayOfWeekMeanBoardingDurationHours?.[i] ?? '') : '',
    ]);
  }
  return rows;
}

/**
 * Boarding Census tab (NEW, 2026-07-27) — the measured-boarding primary path. 168 rows, each
 * of the three census columns independently all-or-nothing. See .claude/rules/
 * boarding-seasonality.md and .claude/rules/template-parsing.md.
 */
function boardingCensusRows(fillArrays?: Array<number[] | null | undefined>): (string | number)[][] {
  return hourGridRows(BOARDING_CENSUS_TEMPLATE_COLUMNS, fillArrays);
}

// Current-staffing template — separate from the consolidated Step-1 data template above,
// since it depends on the shift menu, which isn't defined yet at Step-1 time (see
// .claude/rules/template-parsing.md's history note before "fixing" this back into one
// template). Matching on upload keys off Start Hour/Length (Hrs), not the Shift label —
// the label column is a human-readable convenience only, so renaming it doesn't break the
// upload, same alias-tolerant philosophy as everywhere else in this file.
export const STAFFING_TEMPLATE_COLUMNS = ['Day', 'Shift', 'Start Hour', 'Length (Hrs)', 'Headcount'] as const;

function staffingRows(shiftMenu: ShiftDef[], grid?: Grid | null): (string | number)[][] {
  const rows: (string | number)[][] = [STAFFING_TEMPLATE_COLUMNS.slice()];
  const sorted = [...shiftMenu].sort((a, b) => a.startHour - b.startHour);
  // Mon-first row order (DISPLAY_DAY_ORDER), display-only — parseStaffingUpload.ts matches
  // rows to a shift by Start Hour/Length and to a day by name, never by position.
  for (const day of DISPLAY_DAY_ORDER) {
    for (const s of sorted) {
      // Headcount blank for the plain blank template; filled from `grid` for the Part 3
      // export (2026-07-27) — same function serves both, like hourGridRows above.
      const headcount = grid?.[day]?.[s.id];
      rows.push([DAY_NAMES[day], s.label || s.id, s.startHour, s.lengthHours, headcount ?? '']);
    }
  }
  return rows;
}

// Setup Decisions tab (2026-07-27, follow-up to Part 3) — workflow ANSWERS specific to this
// department's data (which boarding path was used, headcount semantics, which flex axes were
// explored), NOT tool-wide policy constants. Deliberately distinct from the REVERTED Settings
// tab (wHPPV target/ratios/ENA floor — see .claude/rules/template-parsing.md's
// reversal section): those stay UI-only, set fresh on every setup pass; these are closer to
// data than policy — answers about how THIS dataset should be read, lost otherwise on
// re-import (the boarding fork would have to be re-answered even though the underlying
// census/admit-rate data reloaded fine). Header is 'Decision', not 'Field'/'Setting', so this
// can't collide with the Scalars tab or accidentally resurrect the Settings-tab shape.
export const DECISIONS_TEMPLATE_COLUMNS = ['Decision', 'Value'] as const;
export const DECISIONS_TEMPLATE_FIELDS = [
  'Boarding Path',
  'Headcount Includes Indirect Care',
  'Flexible Start Times',
  'Flexible Shift Count',
  'Flexible Shift Lengths',
  // 2026-07-28, Ben's direct ask — the two boarding nursing ratios, so a re-imported dataset
  // doesn't reset them to the DEFAULTS (4/10). Deliberately scoped to ONLY these two fields —
  // wHPPV target and ENA floor still never appear in any exported file (see
  // .claude/rules/template-parsing.md's Settings-tab reversal section for why that line
  // otherwise holds).
  'Boarding Ratio (RN : Medical Boarders)',
  'BH Boarding Ratio (RN : BH Boarders)',
  // 2026-07-30 — same scoped exception as the two ratios above: "hours per FTE" is a
  // near-fixed department convention (a 3x12 vs. 4x10 rotation), not a policy dial someone
  // reconsiders fresh each setup pass, so it round-trips here rather than resetting to the
  // 40 hrs/week default on re-import. Both the mode AND the raw value are stored (not just
  // the derived annual figure) so the setup field redisplays exactly as entered.
  'Hours Per FTE Mode',
  'Hours Per FTE Value',
] as const;

export interface SetupDecisionsData {
  boardingPath?: 'census' | 'classic' | 'skip' | null;
  headcountIncludesIndirectCare?: boolean | null;
  flexAxes?: FlexAxes | null;
  boardingRatioTarget?: number | null;
  bhBoardingRatioTarget?: number | null;
  fteInputMode?: 'weekly' | 'annual' | null;
  fteInputValue?: number | null;
}

function decisionsRows(data: SetupDecisionsData): (string | number)[][] {
  const boolStr = (v: boolean | null | undefined) => (v === null || v === undefined ? '' : v ? 'yes' : 'no');
  const values: (string | number)[] = [
    data.boardingPath ?? '',
    boolStr(data.headcountIncludesIndirectCare),
    boolStr(data.flexAxes?.startTimes),
    boolStr(data.flexAxes?.shiftCount),
    boolStr(data.flexAxes?.shiftLengths),
    data.boardingRatioTarget ?? '',
    data.bhBoardingRatioTarget ?? '',
    data.fteInputMode ?? '',
    data.fteInputValue ?? '',
  ];
  return [DECISIONS_TEMPLATE_COLUMNS.slice(), ...DECISIONS_TEMPLATE_FIELDS.map((f, i) => [f, values[i]])];
}

function addSheet(wb: XLSX.WorkBook, rows: (string | number)[][], sheetName: string) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = rows[0].map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

export function generateConsolidatedTemplateXlsxBlob(): Blob {
  const wb = XLSX.utils.book_new();
  addSheet(wb, hourGridRows(ARRIVALS_TEMPLATE_COLUMNS), 'Arrivals');
  addSheet(wb, hourGridRows(ESI_MIX_TEMPLATE_COLUMNS), 'ESI Mix');
  addSheet(wb, boardingCensusRows(), 'Boarding Census');
  addSheet(wb, scalarsRows(), 'Scalars');
  addSheet(wb, seasonalityRows(), 'Boarding Seasonality');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadConsolidatedTemplateXlsx() {
  downloadBlob(generateConsolidatedTemplateXlsxBlob(), 'shiftlens_data_template.xlsx');
}

// Part 3 (guided-setup/export follow-up prompt, 2026-07-27), extended same day — "download my
// data file," the app's only form of persistence. Reuses the SAME tab-generation functions the
// blank templates use (`hourGridRows`/`seasonalityRows`/`scalarsRows`/`boardingCensusRows`/
// `staffingRows`), just fed with real values instead of blanks, so the exported file has
// EXACTLY the shape `parseXlsxFile`/`parseStaffingUploadFile` already know how to read.
// **Tool-wide POLICY constants (wHPPV target, both boarding ratios, ENA floor) still never
// go in this file** — that's the standing rule the reverted Settings tab violated (see
// .claude/rules/template-parsing.md). What DOES belong here, added in this same-day
// extension: the current-staffing grid (genuinely data — what you actually staff, not a tool
// setting) and the "Setup Decisions" tab — per-dataset workflow ANSWERS (which boarding path,
// headcount semantics, flex axes explored) that are closer to data-about-this-department than
// adjustable tool policy, and were being silently lost on re-import before this extension.
export interface ExportableSetupData extends SetupDecisionsData {
  arrivals: number[];
  arrivalsP75?: number[] | null;
  esiMix?: { esi12: number[]; esi3: number[]; esi45: number[] } | null;
  admitRate?: number | null;
  boardingDuration?: number | null;
  monthlyMeanBoardingDurationHours?: number[] | null;
  dayOfWeekMeanBoardingDurationHours?: number[] | null;
  boardingCensusMedical?: number[] | null;
  boardingCensusBH?: number[] | null;
  monthlyBoardingCensusMedical?: number[] | null;
  monthlyBoardingCensusBH?: number[] | null;
  preBedRequestCensus?: number[] | null;
  // 2026-07-27 (follow-up to Part 3) — the current-staffing grid, and the shift menu it's
  // keyed against (needed to write Start Hour/Length per row; on re-import
  // `parseStaffingUploadFile` recovers any shifts not already in the importing session's menu
  // straight from those columns — see .claude/rules/template-parsing.md's shift-recovery fix).
  shiftMenu?: ShiftDef[];
  currentStaffingGrid?: Grid | null;
}

export function generateFilledConsolidatedTemplateXlsxBlob(data: ExportableSetupData): Blob {
  const wb = XLSX.utils.book_new();
  addSheet(wb, hourGridRows(ARRIVALS_TEMPLATE_COLUMNS, [data.arrivals, data.arrivalsP75]), 'Arrivals');
  addSheet(
    wb,
    hourGridRows(ESI_MIX_TEMPLATE_COLUMNS, [data.esiMix?.esi12, data.esiMix?.esi3, data.esiMix?.esi45]),
    'ESI Mix'
  );
  addSheet(
    wb,
    boardingCensusRows([data.boardingCensusMedical, data.boardingCensusBH, data.preBedRequestCensus]),
    'Boarding Census'
  );
  addSheet(wb, scalarsRows(data.admitRate, data.boardingDuration), 'Scalars');
  addSheet(
    wb,
    seasonalityRows({
      monthlyMeanBoardingDurationHours: data.monthlyMeanBoardingDurationHours,
      monthlyBoardingCensusMedical: data.monthlyBoardingCensusMedical,
      monthlyBoardingCensusBH: data.monthlyBoardingCensusBH,
      dayOfWeekMeanBoardingDurationHours: data.dayOfWeekMeanBoardingDurationHours,
    }),
    'Boarding Seasonality'
  );
  if (data.shiftMenu && data.shiftMenu.length > 0) {
    addSheet(wb, staffingRows(data.shiftMenu, data.currentStaffingGrid), 'Current Staffing');
  }
  addSheet(wb, decisionsRows(data), 'Setup Decisions');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadFilledConsolidatedTemplateXlsx(data: ExportableSetupData) {
  downloadBlob(generateFilledConsolidatedTemplateXlsxBlob(data), 'shiftlens_data_export.xlsx');
}

export function generateStaffingTemplateXlsxBlob(shiftMenu: ShiftDef[]): Blob {
  const wb = XLSX.utils.book_new();
  addSheet(wb, staffingRows(shiftMenu), 'Current Staffing');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadStaffingTemplateXlsx(shiftMenu: ShiftDef[]) {
  downloadBlob(generateStaffingTemplateXlsxBlob(shiftMenu), 'shiftlens_current_staffing_template.xlsx');
}
