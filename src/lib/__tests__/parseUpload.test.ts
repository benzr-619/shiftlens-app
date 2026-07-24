import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { rowsToParsedUpload, parseXlsxFile } from '../parseUpload';
import { ARRIVALS_TEMPLATE_COLUMNS, ESI_MIX_TEMPLATE_COLUMNS, SCALARS_TEMPLATE_COLUMNS, SCALARS_TEMPLATE_FIELDS } from '../template';

function workbookFile(sheets: Record<string, (string | number)[][]>): File {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([buf], 'upload.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function arrivalsRows(fill: (day: number, hour: number) => number | string): (string | number)[][] {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const rows: (string | number)[][] = [['Day', 'Hour', 'Arrivals']];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      rows.push([days[day], hour, fill(day, hour)]);
    }
  }
  return rows;
}

describe('tolerant header-based template parsing', () => {
  it('detects required columns regardless of order, casing, and spacing', () => {
    const headers = ['Arrival Count', 'Weekday', 'Hour of Day'];
    const rows = [['12', 'Monday', '9']];
    const result = rowsToParsedUpload(headers, rows);
    expect(result.errors).toHaveLength(0);
    expect(result.arrivals?.[1 * 24 + 9]).toBe(12);
  });

  it('errors clearly when required columns cannot be found at all', () => {
    const headers = ['Foo', 'Bar', 'Baz'];
    const result = rowsToParsedUpload(headers, [['1', '2', '3']]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('errors when Day/Hour are present but neither Arrivals nor ESI mix columns are', () => {
    const headers = ['Day', 'Hour', 'Notes'];
    const result = rowsToParsedUpload(headers, [['Sunday', '0', 'x']]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('parses an ESI-mix-only file (no Arrivals column) when all rows are filled', () => {
    const headers = ['Day', 'Hour', 'ESI 1-2 Count', 'ESI 3 Count', 'ESI 4-5 Count'];
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const rows = Array.from({ length: 168 }, (_, i) => {
      const day = Math.floor(i / 24);
      const hour = i % 24;
      return [days[day], String(hour), '2', '3', '5'];
    });
    const result = rowsToParsedUpload(headers, rows);
    expect(result.errors).toHaveLength(0);
    expect(result.arrivals).toBeUndefined();
    expect(result.esiMix?.esi3[0]).toBe(3);
  });

  it('ignores a partially-filled optional ESI column and warns rather than silently estimating', () => {
    const headers = ['Day', 'Hour', 'Arrivals', 'ESI 1-2 Count', 'ESI 3 Count', 'ESI 4-5 Count'];
    const rows = [
      ['Sunday', '0', '5', '1', '2', '2'],
      ['Sunday', '1', '4', '', '', ''],
    ];
    const result = rowsToParsedUpload(headers, rows);
    expect(result.esiMix).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('ESI mix'))).toBe(true);
  });

  it('accepts 3-letter day abbreviations and 1-24 hour labeling', () => {
    const headers = ['Day', 'Hour', 'Arrivals'];
    const rows = [['Sat', '24', '3']]; // hour 24 -> tolerated as hour 23
    const result = rowsToParsedUpload(headers, rows);
    expect(result.errors).toHaveLength(0);
    expect(result.arrivals?.[6 * 24 + 23]).toBe(3);
  });
});

describe('consolidated multi-tab workbook parsing', () => {
  it('populates arrivals, scalars, and both seasonality mean-duration series from one upload', async () => {
    const seasonalityRows: (string | number)[][] = [
      ['Month', 'Mean Boarding Duration by Month (hrs)', 'Day of Week', 'Mean Boarding Duration by Day of Week (hrs)'],
      ['January', 6.0, 'Sunday', 4.0],
      ['February', 5.4, 'Monday', 4.5],
      ['March', 5.7, 'Tuesday', 4.5],
      ['April', 6.0, 'Wednesday', 4.5],
      ['May', 6.0, 'Thursday', 4.5],
      ['June', 6.0, 'Friday', 5.5],
      ['July', 6.6, 'Saturday', 5.5],
      ['August', 6.3, '', ''],
      ['September', 5.7, '', ''],
      ['October', 5.7, '', ''],
      ['November', 6.0, '', ''],
      ['December', 7.8, '', ''],
    ];
    const file = workbookFile({
      Arrivals: arrivalsRows(() => 5),
      Scalars: [
        ['Field', 'Value'],
        ['Admit Rate', 0.22],
        ['Boarding Duration (hours)', 4.5],
      ],
      'Boarding Seasonality': seasonalityRows,
    });

    const result = await parseXlsxFile(file);
    expect(result.errors).toHaveLength(0);
    expect(result.arrivals?.[0]).toBe(5);
    expect(result.admitRate).toBe(0.22);
    expect(result.boardingDuration).toBe(4.5);
    expect(result.monthlyMeanBoardingDurationHours).toHaveLength(12);
    expect(result.monthlyMeanBoardingDurationHours?.[0]).toBe(6.0); // January
    expect(result.dayOfWeekMeanBoardingDurationHours).toHaveLength(7);
    expect(result.dayOfWeekMeanBoardingDurationHours?.[0]).toBe(4.0); // Sunday
  });

  it('accepts just an Arrivals tab and leaves everything else absent, no errors', async () => {
    const file = workbookFile({ Arrivals: arrivalsRows((_day, hour) => (hour >= 8 && hour <= 20 ? 8 : 2)) });
    const result = await parseXlsxFile(file);
    expect(result.errors).toHaveLength(0);
    expect(result.arrivals).toBeDefined();
    expect(result.admitRate).toBeUndefined();
    expect(result.boardingDuration).toBeUndefined();
    expect(result.monthlyMeanBoardingDurationHours).toBeUndefined();
    expect(result.dayOfWeekMeanBoardingDurationHours).toBeUndefined();
  });

  it('treats a partially-filled seasonality table as absent and warns, not a partial estimate', async () => {
    const file = workbookFile({
      Arrivals: arrivalsRows(() => 5),
      'Boarding Seasonality': [
        ['Month', 'Mean Boarding Duration by Month (hrs)', 'Day of Week', 'Mean Boarding Duration by Day of Week (hrs)'],
        ['January', 6.0, 'Sunday', 4.0],
        ['February', '', 'Monday', 4.5], // Feb blank -> partial fill
        ['March', 5.7, '', ''],
      ],
    });
    const result = await parseXlsxFile(file);
    expect(result.monthlyMeanBoardingDurationHours).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('Mean boarding duration by month'))).toBe(true);
    // Day-of-week only had 2/7 filled -> also absent + warned
    expect(result.dayOfWeekMeanBoardingDurationHours).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('Mean boarding duration by day of week'))).toBe(true);
  });

  it('errors when no tab in the workbook is recognized', async () => {
    const file = workbookFile({ Notes: [['Foo', 'Bar'], ['1', '2']] });
    const result = await parseXlsxFile(file);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('admit rate and boarding duration are independent at the parse layer (pairing is enforced downstream)', async () => {
    const file = workbookFile({
      Arrivals: arrivalsRows(() => 5),
      Scalars: [
        ['Field', 'Value'],
        ['Admit Rate', 0.3],
      ],
    });
    const result = await parseXlsxFile(file);
    expect(result.admitRate).toBe(0.3);
    expect(result.boardingDuration).toBeUndefined();
  });

  it('recognizes the actual generated template headers (Average Arrivals/ESI columns, Mean Boarding Duration)', async () => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const arrivalsTemplateRows: (string | number)[][] = [ARRIVALS_TEMPLATE_COLUMNS.slice()];
    const esiTemplateRows: (string | number)[][] = [ESI_MIX_TEMPLATE_COLUMNS.slice()];
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        arrivalsTemplateRows.push([days[day], hour, 5]);
        esiTemplateRows.push([days[day], hour, 1, 2, 2]);
      }
    }
    const scalarsTemplateRows: (string | number)[][] = [
      SCALARS_TEMPLATE_COLUMNS.slice(),
      [SCALARS_TEMPLATE_FIELDS[0], 0.25],
      [SCALARS_TEMPLATE_FIELDS[1], 5.2],
    ];
    const file = workbookFile({
      Arrivals: arrivalsTemplateRows,
      'ESI Mix': esiTemplateRows,
      Scalars: scalarsTemplateRows,
    });

    const result = await parseXlsxFile(file);
    expect(result.errors).toHaveLength(0);
    expect(result.arrivals?.[0]).toBe(5);
    expect(result.esiMix?.esi3[0]).toBe(2);
    expect(result.admitRate).toBe(0.25);
    expect(result.boardingDuration).toBe(5.2);
  });
});
