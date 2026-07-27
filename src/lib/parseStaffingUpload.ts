import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ShiftDef, Grid } from '../engine/types';
import { matchColumn, parseDay, parseNum, isBlankRow } from './parseUpload';

// Separate from parseUpload.ts's consolidated Data-step parser — current staffing depends
// on the shift menu, which only exists from Step 3 onward, so it can't share that step's
// upload flow. See .claude/rules/template-parsing.md and lib/template.ts's staffing-template
// comment for why this is its own template/parser rather than a tab on the consolidated one.

export interface ParsedStaffingUpload {
  grid?: Grid;
  // Shift definitions the upload references (by Start Hour/Length) that weren't in the
  // shift menu passed in — recovered directly from the file's own Start Hour/Length/Shift
  // columns, since a staffing template row already fully specifies a shift. See the "recognize
  // the different shifts that get uploaded" note in .claude/rules/template-parsing.md.
  newShifts?: ShiftDef[];
  warnings: string[];
  errors: string[];
}

const STAFFING_HEADER_ALIASES: Record<string, string[]> = {
  day: ['day', 'dayofweek', 'weekday'],
  shiftLabel: ['shift', 'shiftname', 'shiftlabel'],
  startHour: ['starthour', 'shiftstart', 'start', 'starttime'],
  lengthHours: ['lengthhrs', 'lengthhours', 'shiftlength', 'length', 'durationhours', 'durationhrs', 'shiftlengthhrs'],
  headcount: ['headcount', 'count', 'staffcount', 'nurses', 'fte', 'currentstaffing', 'number', 'staffed'],
};

// Matches by Start Hour (and Length, to disambiguate two shifts sharing a start hour) —
// never by the Shift label text, so renaming that column has no effect on the match.
function findShift(shiftMenu: ShiftDef[], startHour: number, lengthHours: number | null): ShiftDef | undefined {
  const atStart = shiftMenu.filter((s) => s.startHour === startHour);
  if (atStart.length <= 1) return atStart[0];
  if (lengthHours !== null) {
    const exact = atStart.find((s) => s.lengthHours === lengthHours);
    if (exact) return exact;
  }
  return atStart[0];
}

export function looksLikeStaffingSheet(headers: string[]): boolean {
  const colMap = matchColumn(headers, STAFFING_HEADER_ALIASES);
  return colMap.day !== undefined && colMap.startHour !== undefined && colMap.headcount !== undefined;
}

let newShiftCounter = 0;

export function rowsToStaffingGrid(headers: string[], rows: (string | number)[][], shiftMenu: ShiftDef[]): ParsedStaffingUpload {
  const warnings: string[] = [];
  const errors: string[] = [];
  const colMap = matchColumn(headers, STAFFING_HEADER_ALIASES);

  if (colMap.day === undefined || colMap.startHour === undefined || colMap.headcount === undefined) {
    errors.push(
      'Could not find required columns for Day, Start Hour, and Headcount. Rename your headers to match the downloaded template, or keep the template headers as-is.'
    );
    return { warnings, errors };
  }

  // Pass 1: a staffing row already fully specifies a shift (Start Hour + Length, optionally a
  // label) — a row whose (startHour, length) doesn't match anything in `shiftMenu` isn't bad
  // data, it's a shift the app doesn't know about yet. Recover those as new ShiftDefs instead
  // of silently skipping the row (see .claude/rules/template-parsing.md). Only rows with a
  // Length value can be recovered this way — without it there's no full shift definition to
  // construct, so those still warn-and-skip as before.
  const newShiftsByKey = new Map<string, ShiftDef>();
  rows.forEach((row) => {
    if (isBlankRow(row)) return;
    if (parseNum(row[colMap.headcount]) === null) return;
    const startHourRaw = parseNum(row[colMap.startHour]);
    if (startHourRaw === null) return;
    const lengthHoursRaw = colMap.lengthHours !== undefined ? parseNum(row[colMap.lengthHours]) : null;
    if (lengthHoursRaw === null) return;
    if (findShift(shiftMenu, startHourRaw, lengthHoursRaw)) return;
    const key = `${startHourRaw}::${lengthHoursRaw}`;
    if (newShiftsByKey.has(key)) return;
    const labelRaw = colMap.shiftLabel !== undefined ? String(row[colMap.shiftLabel] ?? '').trim() : '';
    newShiftCounter++;
    newShiftsByKey.set(key, {
      id: `uploaded-shift-${newShiftCounter}`,
      label: labelRaw || undefined,
      startHour: startHourRaw,
      lengthHours: lengthHoursRaw,
    });
  });
  const newShifts = [...newShiftsByKey.values()];
  const effectiveShiftMenu = newShifts.length > 0 ? [...shiftMenu, ...newShifts] : shiftMenu;

  const grid: Grid = {};
  let filled = 0;

  rows.forEach((row, i) => {
    const rowNum = i + 2; // +1 header, +1 for 1-indexed display
    if (isBlankRow(row)) return;
    const headcountRaw = parseNum(row[colMap.headcount]);
    if (headcountRaw === null) return; // blank headcount cell — nothing to apply for this row
    const day = parseDay(row[colMap.day], warnings, rowNum);
    const startHourRaw = parseNum(row[colMap.startHour]);
    if (day === null || startHourRaw === null) return;
    const lengthHoursRaw = colMap.lengthHours !== undefined ? parseNum(row[colMap.lengthHours]) : null;
    const shift = findShift(effectiveShiftMenu, startHourRaw, lengthHoursRaw);
    if (!shift) {
      warnings.push(`Row ${rowNum}: no shift in your shift menu starts at hour ${startHourRaw}${lengthHoursRaw === null ? ' (and no Length column to recover one from)' : ''}; skipped.`);
      return;
    }
    grid[day] = { ...grid[day], [shift.id]: Math.max(0, headcountRaw) };
    filled++;
  });

  if (filled === 0) {
    errors.push(
      'No recognizable current-staffing rows found. Check that Day/Start Hour/Headcount are filled in and that Start Hour matches a shift in your shift menu.'
    );
    return { warnings, errors };
  }

  if (newShifts.length > 0) {
    warnings.push(
      `Added ${newShifts.length} shift${newShifts.length === 1 ? '' : 's'} to your shift menu from the upload: ${newShifts
        .map((s) => `${s.label || 'Shift'} (${s.startHour.toString().padStart(2, '0')}:00, ${s.lengthHours}h)`)
        .join(', ')}.`
    );
  }

  return { grid, newShifts: newShifts.length > 0 ? newShifts : undefined, warnings, errors };
}

export function parseStaffingCsvFile(file: File, shiftMenu: ShiftDef[]): Promise<ParsedStaffingUpload> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      complete: (res) => {
        const rows = res.data as (string | number)[][];
        const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
        if (nonEmpty.length < 2) {
          resolve({ warnings: [], errors: ['The uploaded file has no data rows.'] });
          return;
        }
        const [headerRow, ...dataRows] = nonEmpty;
        resolve(rowsToStaffingGrid(headerRow.map(String), dataRows, shiftMenu));
      },
    });
  });
}

export async function parseStaffingXlsxFile(file: File, shiftMenu: ShiftDef[]): Promise<ParsedStaffingUpload> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });

  // Tolerant of a stray extra tab (e.g. instructions) — same per-sheet classification
  // philosophy as the consolidated Data-step parser, scoped to this template's one shape.
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows: (string | number)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    if (nonEmpty.length < 2) continue;
    const [headerRow, ...dataRows] = nonEmpty;
    const headers = headerRow.map(String);
    if (looksLikeStaffingSheet(headers)) {
      return rowsToStaffingGrid(headers, dataRows, shiftMenu);
    }
  }

  return { warnings: [], errors: ['Could not recognize any tab in this workbook — make sure it matches the downloaded current-staffing template.'] };
}

export async function parseStaffingUploadFile(file: File, shiftMenu: ShiftDef[]): Promise<ParsedStaffingUpload> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return parseStaffingCsvFile(file, shiftMenu);
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseStaffingXlsxFile(file, shiftMenu);
  return { warnings: [], errors: ['Unsupported file type — please upload a .csv or .xlsx file.'] };
}
