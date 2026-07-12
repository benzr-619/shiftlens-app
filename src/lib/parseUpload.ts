import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { DAY_NAMES } from './template';

export interface ParsedUpload {
  arrivals: number[]; // 168 cells, index = day*24+hour
  esiMix?: { esi12: number[]; esi3: number[]; esi45: number[] };
  admitRate?: number[]; // 168 cells, present only if every row had a value
  boardingDuration?: number[];
  warnings: string[];
  errors: string[];
  filledCells: number; // arrivals cells actually populated, out of 168
}

// Tolerant header-based column detection: normalize (lowercase, strip non-alphanumerics)
// and match against known aliases, so column order/casing/spacing/punctuation don't matter.
const HEADER_ALIASES: Record<string, string[]> = {
  day: ['day', 'dayofweek', 'weekday'],
  hour: ['hour', 'hourofday', 'hr'],
  arrivals: ['arrivals', 'arrivalcount', 'volume', 'count', 'visits'],
  esi12: ['esi12', 'esi12count', 'esihigh', 'esi1and2', 'esi1and2count'],
  esi3: ['esi3', 'esi3count', 'esimid'],
  esi45: ['esi45', 'esi45count', 'esilow', 'esi4and5', 'esi4and5count', 'esifasttrack'],
  admitRate: ['admitrate', 'admissionrate', 'admits'],
  boardingDuration: ['boardingduration', 'boardingdurationhrs', 'boardingdurationhours', 'boardhours', 'boardingtime'],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchColumn(headers: string[]): Record<string, number> {
  const normalized = headers.map(normalizeHeader);
  const map: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
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

export function rowsToParsedUpload(headers: string[], rows: (string | number)[][]): ParsedUpload {
  const warnings: string[] = [];
  const errors: string[] = [];
  const colMap = matchColumn(headers);

  if (colMap.day === undefined || colMap.hour === undefined || colMap.arrivals === undefined) {
    errors.push(
      'Could not find required columns for Day, Hour, and Arrivals. Rename your headers to match the downloaded template, or keep the template headers as-is.'
    );
    return { arrivals: new Array(168).fill(0), warnings, errors, filledCells: 0 };
  }

  const arrivals = new Array(168).fill(0);
  const filled = new Array(168).fill(false);
  const esi12 = new Array(168).fill(0);
  const esi3 = new Array(168).fill(0);
  const esi45 = new Array(168).fill(0);
  const admitRate = new Array(168).fill(0);
  const boardingDuration = new Array(168).fill(0);
  let esiRowsFound = 0;
  let admitRowsFound = 0;
  let boardingRowsFound = 0;

  rows.forEach((row, i) => {
    const rowNum = i + 2; // +1 header, +1 for 1-indexed display
    const day = parseDay(row[colMap.day], warnings, rowNum);
    const hour = parseHour(row[colMap.hour], warnings, rowNum);
    if (day === null || hour === null) return;
    const idx = day * 24 + hour;

    const arrivalsVal = parseNum(row[colMap.arrivals]);
    if (arrivalsVal !== null) {
      arrivals[idx] = arrivalsVal;
      filled[idx] = true;
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

    if (colMap.admitRate !== undefined) {
      const v = parseNum(row[colMap.admitRate]);
      if (v !== null) {
        admitRate[idx] = v;
        admitRowsFound++;
      }
    }

    if (colMap.boardingDuration !== undefined) {
      const v = parseNum(row[colMap.boardingDuration]);
      if (v !== null) {
        boardingDuration[idx] = v;
        boardingRowsFound++;
      }
    }
  });

  const filledCells = filled.filter(Boolean).length;
  if (filledCells < 168) {
    warnings.push(`${168 - filledCells} of 168 hour x day-of-week cells had no Arrivals value; treated as 0.`);
  }

  const result: ParsedUpload = { arrivals, warnings, errors, filledCells };
  // Only surface an optional field if it was populated consistently — a partially-filled
  // optional column is more likely a data-entry mistake than an intentional sparse input.
  if (esiRowsFound === 168) result.esiMix = { esi12, esi3, esi45 };
  else if (esiRowsFound > 0) warnings.push(`ESI mix only populated for ${esiRowsFound}/168 rows; ignored — fill every row or leave entirely blank.`);

  if (admitRowsFound === 168) result.admitRate = admitRate;
  else if (admitRowsFound > 0) warnings.push(`Admit rate only populated for ${admitRowsFound}/168 rows; ignored — fill every row or leave entirely blank.`);

  if (boardingRowsFound === 168) result.boardingDuration = boardingDuration;
  else if (boardingRowsFound > 0) warnings.push(`Boarding duration only populated for ${boardingRowsFound}/168 rows; ignored — fill every row or leave entirely blank.`);

  return result;
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

export async function parseXlsxFile(file: File): Promise<ParsedUpload> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: (string | number)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  const [headerRow, ...dataRows] = nonEmpty;
  return rowsToParsedUpload(headerRow.map(String), dataRows);
}

export async function parseUploadFile(file: File): Promise<ParsedUpload> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return parseCsvFile(file);
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseXlsxFile(file);
  return { arrivals: new Array(168).fill(0), warnings: [], errors: ['Unsupported file type — please upload a .csv or .xlsx file.'], filledCells: 0 };
}
