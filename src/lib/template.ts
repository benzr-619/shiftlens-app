import * as XLSX from 'xlsx';
import { MONTH_NAMES } from '../engine/types';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ONE consolidated multi-tab workbook — replaces the old two-independent-templates model
// (arrivals-only + ESI-mix-only) and the scalar admit-rate/boarding-duration typed fields.
// One explainer, one template, one upload — see .claude/rules/template-parsing.md for why.
// Arrivals/ESI Mix columns are explicitly labeled "Average" — the engine's math
// (annualVisits = sum(arrivals) * 52) treats each hour-of-week cell as a period average,
// not one arbitrary week's raw counts. See .claude/rules/template-parsing.md.
export const ARRIVALS_TEMPLATE_COLUMNS = ['Day', 'Hour', 'Average Arrivals'] as const;
export const ESI_MIX_TEMPLATE_COLUMNS = ['Day', 'Hour', 'Average ESI 1-2 Count', 'Average ESI 3 Count', 'Average ESI 4-5 Count'] as const;
export const SCALARS_TEMPLATE_COLUMNS = ['Field', 'Value'] as const;
export const SCALARS_TEMPLATE_FIELDS = ['Admit Rate', 'Mean Boarding Duration (hrs)'] as const;
export const SEASONALITY_TEMPLATE_COLUMNS = [
  'Month',
  'Mean Boarding Duration by Month (hrs)',
  'Day of Week',
  'Mean Boarding Duration by Day of Week (hrs)',
] as const;

function hourGridRows(columns: readonly string[]): (string | number)[][] {
  const rows: (string | number)[][] = [columns.slice()];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      // Every non-Day/Hour column left blank — never seeded with example/placeholder values.
      rows.push([DAY_NAMES[day], hour, ...columns.slice(2).map(() => '')]);
    }
  }
  return rows;
}

function scalarsRows(): (string | number)[][] {
  return [SCALARS_TEMPLATE_COLUMNS.slice(), ...SCALARS_TEMPLATE_FIELDS.map((f) => [f, ''])];
}

/**
 * Two small tables in one sheet, laid out as one 4-column row set rather than stacked
 * blocks — 12 rows (months), with the day-of-week columns populated for the first 7 and
 * left blank after, so both tables parse as one tolerant row-by-row scan (no positional/
 * block parsing needed). See .claude/rules/template-parsing.md.
 */
function seasonalityRows(): (string | number)[][] {
  const rows: (string | number)[][] = [SEASONALITY_TEMPLATE_COLUMNS.slice()];
  for (let i = 0; i < 12; i++) {
    rows.push([MONTH_NAMES[i], '', i < 7 ? DAY_NAMES[i] : '', '']);
  }
  return rows;
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
