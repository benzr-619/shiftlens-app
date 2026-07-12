import * as XLSX from 'xlsx';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const TEMPLATE_COLUMNS = [
  'Day',
  'Hour',
  'Arrivals',
  'ESI 1-2 Count',
  'ESI 3 Count',
  'ESI 4-5 Count',
  'Admit Rate',
  'Boarding Duration (hrs)',
] as const;

function templateRows(): (string | number)[][] {
  const rows: (string | number)[][] = [TEMPLATE_COLUMNS.slice()];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      // Every optional column left blank — never seeded with example/placeholder values.
      rows.push([DAY_NAMES[day], hour, '', '', '', '', '', '']);
    }
  }
  return rows;
}

export function generateTemplateCsv(): string {
  const rows = templateRows();
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell);
          return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(',')
    )
    .join('\r\n');
}

export function generateTemplateXlsxBlob(): Blob {
  const ws = XLSX.utils.aoa_to_sheet(templateRows());
  ws['!cols'] = TEMPLATE_COLUMNS.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Arrivals');
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

export function downloadTemplateCsv() {
  downloadBlob(new Blob([generateTemplateCsv()], { type: 'text/csv' }), 'shiftlens_arrivals_template.csv');
}

export function downloadTemplateXlsx() {
  downloadBlob(generateTemplateXlsxBlob(), 'shiftlens_arrivals_template.xlsx');
}
