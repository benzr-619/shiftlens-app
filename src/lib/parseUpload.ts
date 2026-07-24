import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { DAY_NAMES } from './template';
import { MONTH_NAMES } from '../engine/types';

export interface ParsedUpload {
  arrivals?: number[]; // 168 cells, index = day*24+hour — present only if a sheet had an Arrivals column
  esiMix?: { esi12: number[]; esi3: number[]; esi45: number[] };
  admitRate?: number;
  boardingDuration?: number;
  monthlyMeanBoardingDurationHours?: number[]; // 12 mean-duration-per-patient values (Jan-Dec), all-or-nothing
  dayOfWeekMeanBoardingDurationHours?: number[]; // 7 mean-duration-per-patient values (Sun-Sat), all-or-nothing
  warnings: string[];
  errors: string[];
  filledCells: number; // arrivals cells actually populated, out of 168 (0 if no Arrivals column)
}

// Tolerant header-based column detection: normalize (lowercase, strip non-alphanumerics)
// and match against known aliases per sheet shape, so column order/casing/spacing/
// punctuation don't matter. `matchColumn` is generic over the alias table — each of the
// four tabs in the consolidated template (Arrivals, ESI Mix, Scalars, Boarding
// Seasonality) is classified and parsed independently by which columns it actually has,
// not by tab name or position. See .claude/rules/template-parsing.md.
const HEADER_ALIASES: Record<string, string[]> = {
  day: ['day', 'dayofweek', 'weekday'],
  hour: ['hour', 'hourofday', 'hr'],
  arrivals: ['arrivals', 'arrivalcount', 'volume', 'count', 'visits', 'averagearrivals', 'avgarrivals', 'meanarrivals'],
  esi12: [
    'esi12', 'esi12count', 'esihigh', 'esi1and2', 'esi1and2count',
    'averageesi12count', 'avgesi12count', 'averageesi1and2count', 'avgesi1and2count',
  ],
  esi3: ['esi3', 'esi3count', 'esimid', 'averageesi3count', 'avgesi3count'],
  esi45: [
    'esi45', 'esi45count', 'esilow', 'esi4and5', 'esi4and5count', 'esifasttrack',
    'averageesi45count', 'avgesi45count', 'averageesi4and5count', 'avgesi4and5count',
  ],
};

const SCALARS_HEADER_ALIASES: Record<string, string[]> = {
  field: ['field', 'fieldname', 'parameter', 'item', 'label'],
  value: ['value', 'val', 'amount', 'number'],
};

const SCALAR_FIELD_ALIASES: Record<string, 'admitRate' | 'boardingDuration'> = {
  admitrate: 'admitRate',
  admissionrate: 'admitRate',
  admitpercentage: 'admitRate',
  admissionpercentage: 'admitRate',
  boardingduration: 'boardingDuration',
  boardingdurationhours: 'boardingDuration',
  averageboardingduration: 'boardingDuration',
  avgboardingduration: 'boardingDuration',
  avgboardingdurationhours: 'boardingDuration',
  meanboardingduration: 'boardingDuration',
  meanboardingdurationhrs: 'boardingDuration',
  meanboardingdurationhours: 'boardingDuration',
};

const SEASONALITY_HEADER_ALIASES: Record<string, string[]> = {
  month: ['month', 'monthname'],
  monthlyMeanBoardingDurationHours: [
    'meanboardingdurationbymonthhrs',
    'meanboardingdurationbymonth',
    'monthlymeanboardingduration',
    'monthlymeanboardingdurationhours',
    'monthlyaverageboardingduration',
    'monthlyavgboardingduration',
    'avgboardingdurationmonth',
    'averageboardingdurationmonth',
  ],
  seasonDay: ['dayofweek', 'weekday', 'day'],
  dayOfWeekMeanBoardingDurationHours: [
    'meanboardingdurationbydayofweekhrs',
    'meanboardingdurationbydayofweek',
    'dayofweekmeanboardingduration',
    'dayofweekmeanboardingdurationhours',
    'dayofweekaverageboardingduration',
    'dayofweekavgboardingduration',
    'avgboardingdurationday',
    'averageboardingdurationday',
    'weekdaymeanboardingduration',
  ],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchColumn(headers: string[], aliasTable: Record<string, string[]>): Record<string, number> {
  const normalized = headers.map(normalizeHeader);
  const map: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(aliasTable)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

const DAY_ALIASES: Record<string, number> = {};
DAY_NAMES.forEach((name, i) => {
  DAY_ALIASES[name.toLowerCase()] = i;
  DAY_ALIASES[name.slice(0, 3).toLowerCase()] = i;
});

const MONTH_ALIASES: Record<string, number> = {};
MONTH_NAMES.forEach((name, i) => {
  MONTH_ALIASES[name.toLowerCase()] = i;
  MONTH_ALIASES[name.slice(0, 3).toLowerCase()] = i;
});

function parseDay(raw: string | number, warnings: string[], rowNum: number): number | null {
  if (typeof raw === 'number') {
    if (raw >= 0 && raw <= 6) return raw;
    if (raw >= 1 && raw <= 7) return raw - 1;
    warnings.push(`Row ${rowNum}: numeric day "${raw}" out of range, skipped`);
    return null;
  }
  const key = String(raw).trim().toLowerCase();
  if (key in DAY_ALIASES) return DAY_ALIASES[key];
  warnings.push(`Row ${rowNum}: could not recognize day "${raw}", skipped`);
  return null;
}

function parseMonth(raw: string | number, warnings: string[], rowNum: number): number | null {
  if (typeof raw === 'number') {
    if (raw >= 1 && raw <= 12) return raw - 1;
    if (raw >= 0 && raw <= 11) return raw;
    warnings.push(`Row ${rowNum}: numeric month "${raw}" out of range, skipped`);
    return null;
  }
  const key = String(raw).trim().toLowerCase();
  if (key in MONTH_ALIASES) return MONTH_ALIASES[key];
  warnings.push(`Row ${rowNum}: could not recognize month "${raw}", skipped`);
  return null;
}

function parseHour(raw: string | number, warnings: string[], rowNum: number): number | null {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (Number.isFinite(n) && n >= 0 && n <= 23) return Math.floor(n);
  if (Number.isFinite(n) && n >= 1 && n <= 24) return Math.floor(n) - 1; // tolerate 1-24 hour labeling
  warnings.push(`Row ${rowNum}: could not recognize hour "${raw}", skipped`);
  return null;
}

function parseNum(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === '' || raw === null) return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

function isBlankRow(row: (string | number)[]): boolean {
  return row.every((c) => c === undefined || String(c).trim() === '');
}

/** Arrivals / ESI Mix tab shape — Day + Hour required, Arrivals and/or ESI columns optional. */
export function rowsToParsedUpload(headers: string[], rows: (string | number)[][]): ParsedUpload {
  const warnings: string[] = [];
  const errors: string[] = [];
  const colMap = matchColumn(headers, HEADER_ALIASES);

  if (colMap.day === undefined || colMap.hour === undefined) {
    errors.push(
      'Could not find required columns for Day and Hour. Rename your headers to match the downloaded template, or keep the template headers as-is.'
    );
    return { warnings, errors, filledCells: 0 };
  }

  const hasArrivalsCol = colMap.arrivals !== undefined;
  const hasEsiCol = colMap.esi12 !== undefined || colMap.esi3 !== undefined || colMap.esi45 !== undefined;

  if (!hasArrivalsCol && !hasEsiCol) {
    errors.push(
      'This tab has Day and Hour columns but no Arrivals or ESI mix columns. Check it matches the Arrivals or ESI Mix tab of the data template.'
    );
    return { warnings, errors, filledCells: 0 };
  }

  const arrivals = new Array(168).fill(0);
  const filled = new Array(168).fill(false);
  const esi12 = new Array(168).fill(0);
  const esi3 = new Array(168).fill(0);
  const esi45 = new Array(168).fill(0);
  let esiRowsFound = 0;

  rows.forEach((row, i) => {
    const rowNum = i + 2; // +1 header, +1 for 1-indexed display
    const day = parseDay(row[colMap.day], warnings, rowNum);
    const hour = parseHour(row[colMap.hour], warnings, rowNum);
    if (day === null || hour === null) return;
    const idx = day * 24 + hour;

    if (hasArrivalsCol) {
      const arrivalsVal = parseNum(row[colMap.arrivals]);
      if (arrivalsVal !== null) {
        arrivals[idx] = arrivalsVal;
        filled[idx] = true;
      }
    }

    if (colMap.esi12 !== undefined && colMap.esi3 !== undefined && colMap.esi45 !== undefined) {
      const a = parseNum(row[colMap.esi12]);
      const b = parseNum(row[colMap.esi3]);
      const c = parseNum(row[colMap.esi45]);
      if (a !== null && b !== null && c !== null) {
        esi12[idx] = a;
        esi3[idx] = b;
        esi45[idx] = c;
        esiRowsFound++;
      }
    }
  });

  const filledCells = filled.filter(Boolean).length;
  if (hasArrivalsCol && filledCells < 168) {
    warnings.push(`${168 - filledCells} of 168 hour x day-of-week cells had no Arrivals value; treated as 0.`);
  }

  const result: ParsedUpload = { warnings, errors, filledCells };
  if (hasArrivalsCol) result.arrivals = arrivals;

  // Only surface ESI mix if it was populated consistently — a partially-filled optional
  // column is more likely a data-entry mistake than an intentional sparse input.
  if (esiRowsFound === 168) result.esiMix = { esi12, esi3, esi45 };
  else if (esiRowsFound > 0) warnings.push(`ESI mix only populated for ${esiRowsFound}/168 rows; ignored — fill every row or leave entirely blank.`);

  return result;
}

/** Scalars tab shape — Field/Value pairs; Admit Rate and Boarding Duration matched by field-name alias. */
function rowsToScalars(headers: string[], rows: (string | number)[][]): { admitRate?: number; boardingDuration?: number; warnings: string[] } {
  const warnings: string[] = [];
  const colMap = matchColumn(headers, SCALARS_HEADER_ALIASES);
  const result: { admitRate?: number; boardingDuration?: number } = {};
  if (colMap.field === undefined || colMap.value === undefined) return { ...result, warnings };

  rows.forEach((row) => {
    if (isBlankRow(row)) return;
    const fieldRaw = row[colMap.field];
    if (fieldRaw === undefined || String(fieldRaw).trim() === '') return;
    const canonical = SCALAR_FIELD_ALIASES[normalizeHeader(String(fieldRaw))];
    if (!canonical) return; // unrecognized field row — tolerant of extra rows, e.g. instructions
    const v = parseNum(row[colMap.value]);
    if (v !== null) result[canonical] = v;
  });

  return { ...result, warnings };
}

/**
 * Boarding Seasonality tab shape — one 4-column row set covering two independent small
 * tables (Month/Mean Boarding Duration by Month, Day of Week/Mean Boarding Duration by Day
 * of Week) rather than two stacked blocks, so it parses as a single tolerant row scan. Both
 * fields are MEAN boarding duration per patient (hours) for that period, not totals — see
 * .claude/rules/boarding-seasonality.md. Both all-or-nothing, independently — a
 * partially-filled one is treated as absent + warned, same reasoning as ESI mix.
 */
function rowsToSeasonality(
  headers: string[],
  rows: (string | number)[][]
): { monthlyMeanBoardingDurationHours?: number[]; dayOfWeekMeanBoardingDurationHours?: number[]; warnings: string[] } {
  const warnings: string[] = [];
  const colMap = matchColumn(headers, SEASONALITY_HEADER_ALIASES);
  const hasMonthCols = colMap.month !== undefined && colMap.monthlyMeanBoardingDurationHours !== undefined;
  const hasDowCols = colMap.seasonDay !== undefined && colMap.dayOfWeekMeanBoardingDurationHours !== undefined;

  const monthlyMeans = new Array(12).fill(0);
  const monthlyFound = new Array(12).fill(false);
  const dowMeans = new Array(7).fill(0);
  const dowFound = new Array(7).fill(false);

  rows.forEach((row, i) => {
    const rowNum = i + 2;
    if (hasMonthCols) {
      const monthRaw = row[colMap.month];
      if (monthRaw !== undefined && String(monthRaw).trim() !== '') {
        const m = parseMonth(monthRaw, warnings, rowNum);
        const v = parseNum(row[colMap.monthlyMeanBoardingDurationHours]);
        if (m !== null && v !== null) {
          monthlyMeans[m] = v;
          monthlyFound[m] = true;
        }
      }
    }
    if (hasDowCols) {
      const dayRaw = row[colMap.seasonDay];
      if (dayRaw !== undefined && String(dayRaw).trim() !== '') {
        const d = parseDay(dayRaw, warnings, rowNum);
        const v = parseNum(row[colMap.dayOfWeekMeanBoardingDurationHours]);
        if (d !== null && v !== null) {
          dowMeans[d] = v;
          dowFound[d] = true;
        }
      }
    }
  });

  const result: { monthlyMeanBoardingDurationHours?: number[]; dayOfWeekMeanBoardingDurationHours?: number[] } = {};

  const monthlyCount = monthlyFound.filter(Boolean).length;
  if (monthlyCount === 12) result.monthlyMeanBoardingDurationHours = monthlyMeans;
  else if (monthlyCount > 0) warnings.push(`Mean boarding duration by month only filled for ${monthlyCount}/12 months; ignored — fill every month or leave entirely blank.`);

  const dowCount = dowFound.filter(Boolean).length;
  if (dowCount === 7) result.dayOfWeekMeanBoardingDurationHours = dowMeans;
  else if (dowCount > 0) warnings.push(`Mean boarding duration by day of week only filled for ${dowCount}/7 days; ignored — fill every day or leave entirely blank.`);

  return { ...result, warnings };
}

function looksLikeArrivalsOrEsiSheet(headers: string[]): boolean {
  const colMap = matchColumn(headers, HEADER_ALIASES);
  return colMap.day !== undefined && colMap.hour !== undefined;
}

function looksLikeScalarsSheet(headers: string[]): boolean {
  const colMap = matchColumn(headers, SCALARS_HEADER_ALIASES);
  return colMap.field !== undefined && colMap.value !== undefined;
}

function looksLikeSeasonalitySheet(headers: string[]): boolean {
  const colMap = matchColumn(headers, SEASONALITY_HEADER_ALIASES);
  return colMap.month !== undefined || colMap.seasonDay !== undefined;
}

export function parseCsvFile(file: File): Promise<ParsedUpload> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      complete: (res) => {
        const rows = res.data as (string | number)[][];
        const [headerRow, ...dataRows] = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
        resolve(rowsToParsedUpload(headerRow.map(String), dataRows));
      },
    });
  });
}

/**
 * Multi-tab workbook parse — each sheet is classified independently by which columns it
 * has (not by sheet name or position), and results are merged. Supports uploading the full
 * consolidated template, or just a subset of tabs (e.g. only Arrivals filled in) — same
 * graceful-degradation philosophy as before. See .claude/rules/template-parsing.md.
 */
export async function parseXlsxFile(file: File): Promise<ParsedUpload> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const merged: ParsedUpload = { warnings: [], errors: [], filledCells: 0 };
  let recognizedAny = false;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows: (string | number)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    if (nonEmpty.length < 2) continue; // empty or header-only tab, nothing to parse
    const [headerRow, ...dataRows] = nonEmpty;
    const headers = headerRow.map(String);

    if (looksLikeArrivalsOrEsiSheet(headers)) {
      const parsed = rowsToParsedUpload(headers, dataRows);
      merged.warnings.push(...parsed.warnings.map((w) => `${sheetName}: ${w}`));
      merged.errors.push(...parsed.errors.map((e) => `${sheetName}: ${e}`));
      if (parsed.arrivals) {
        merged.arrivals = parsed.arrivals;
        merged.filledCells = parsed.filledCells;
      }
      if (parsed.esiMix) merged.esiMix = parsed.esiMix;
      recognizedAny = true;
    } else if (looksLikeScalarsSheet(headers)) {
      const parsed = rowsToScalars(headers, dataRows);
      merged.warnings.push(...parsed.warnings.map((w) => `${sheetName}: ${w}`));
      if (parsed.admitRate !== undefined) merged.admitRate = parsed.admitRate;
      if (parsed.boardingDuration !== undefined) merged.boardingDuration = parsed.boardingDuration;
      recognizedAny = true;
    } else if (looksLikeSeasonalitySheet(headers)) {
      const parsed = rowsToSeasonality(headers, dataRows);
      merged.warnings.push(...parsed.warnings.map((w) => `${sheetName}: ${w}`));
      if (parsed.monthlyMeanBoardingDurationHours) merged.monthlyMeanBoardingDurationHours = parsed.monthlyMeanBoardingDurationHours;
      if (parsed.dayOfWeekMeanBoardingDurationHours) merged.dayOfWeekMeanBoardingDurationHours = parsed.dayOfWeekMeanBoardingDurationHours;
      recognizedAny = true;
    }
    // else: unrecognized tab — tolerated silently (e.g. a stray notes/instructions tab)
  }

  if (!recognizedAny) {
    merged.errors.push('Could not recognize any tab in this workbook — make sure it matches the downloaded data template.');
  }
  return merged;
}

export async function parseUploadFile(file: File): Promise<ParsedUpload> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return parseCsvFile(file);
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseXlsxFile(file);
  return { warnings: [], errors: ['Unsupported file type — please upload a .csv or .xlsx file.'], filledCells: 0 };
}
