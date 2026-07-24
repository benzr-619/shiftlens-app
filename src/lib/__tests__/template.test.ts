import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { generateConsolidatedTemplateXlsxBlob } from '../template';

async function sheetsOf(blob: Blob): Promise<Record<string, (string | number)[][]>> {
  const buf = await blob.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const out: Record<string, (string | number)[][]> = {};
  for (const name of wb.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
  }
  return out;
}

describe('consolidated data template — no seeded example values', () => {
  it('ships all four tabs', async () => {
    const sheets = await sheetsOf(generateConsolidatedTemplateXlsxBlob());
    expect(Object.keys(sheets)).toEqual(['Arrivals', 'ESI Mix', 'Scalars', 'Boarding Seasonality']);
  });

  it('Arrivals/ESI Mix tabs are blank except Day/Hour labels', async () => {
    const sheets = await sheetsOf(generateConsolidatedTemplateXlsxBlob());
    for (const tab of ['Arrivals', 'ESI Mix']) {
      const [header, ...rows] = sheets[tab];
      expect(rows).toHaveLength(168);
      for (const row of rows) {
        for (let c = 2; c < header.length; c++) {
          expect(row[c]).toBe('');
        }
      }
    }
  });

  it('Arrivals/ESI Mix value columns are explicitly labeled as averages, not raw single-week counts', async () => {
    const sheets = await sheetsOf(generateConsolidatedTemplateXlsxBlob());
    for (const tab of ['Arrivals', 'ESI Mix']) {
      const [header] = sheets[tab];
      for (let c = 2; c < header.length; c++) {
        expect(String(header[c])).toMatch(/average/i);
      }
    }
  });

  it('Scalars tab lists both fields with blank values, boarding duration labeled as a mean', async () => {
    const sheets = await sheetsOf(generateConsolidatedTemplateXlsxBlob());
    const [, ...rows] = sheets['Scalars'];
    expect(rows.map((r) => r[0])).toEqual(['Admit Rate', 'Mean Boarding Duration (hrs)']);
    for (const row of rows) expect(row[1]).toBe('');
  });

  it('Boarding Seasonality tab columns are labeled as mean duration per patient, not totals', async () => {
    const sheets = await sheetsOf(generateConsolidatedTemplateXlsxBlob());
    const [header] = sheets['Boarding Seasonality'];
    expect(header[1]).toMatch(/mean boarding duration/i);
    expect(header[1]).not.toMatch(/total/i);
    expect(header[3]).toMatch(/mean boarding duration/i);
    expect(header[3]).not.toMatch(/total/i);
  });

  it('Boarding Seasonality tab lists 12 months and 7 days with blank values', async () => {
    const sheets = await sheetsOf(generateConsolidatedTemplateXlsxBlob());
    const [, ...rows] = sheets['Boarding Seasonality'];
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r[0])).toEqual([
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ]);
    expect(rows.slice(0, 7).map((r) => r[2])).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    for (const row of rows) {
      expect(row[1]).toBe(''); // monthly mean duration blank
      expect(row[3]).toBe(''); // day-of-week mean duration blank
    }
  });
});
