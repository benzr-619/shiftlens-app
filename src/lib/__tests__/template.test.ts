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
  it('ships all five tabs — no Settings tab (policy values are UI fields, not upload data)', async () => {
    const sheets = await sheetsOf(generateConsolidatedTemplateXlsxBlob());
    expect(Object.keys(sheets)).toEqual([
      'Arrivals', 'ESI Mix', 'Boarding Census', 'Scalars', 'Boarding Seasonality',
    ]);
  });

  it('Boarding Census tab is blank except Day/Hour labels', async () => {
    const sheets = await sheetsOf(generateConsolidatedTemplateXlsxBlob());
    const [header, ...rows] = sheets['Boarding Census'];
    expect(rows).toHaveLength(168);
    for (const row of rows) {
      for (let c = 2; c < header.length; c++) expect(row[c]).toBe('');
    }
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
    // ESI Mix has no P75 column — every value column is an average.
    const esiHeader = sheets['ESI Mix'][0];
    for (let c = 2; c < esiHeader.length; c++) {
      expect(String(esiHeader[c])).toMatch(/average/i);
    }
    // Arrivals: "Average Arrivals" is an average; the optional 2026-07-26 "P75 Arrivals"
    // column is deliberately NOT an average (a busy-hour percentile) — see Phase 2a.
    const arrivalsHeader = sheets['Arrivals'][0];
    expect(String(arrivalsHeader[2])).toMatch(/average/i);
    expect(String(arrivalsHeader[3])).toMatch(/p75/i);
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
    expect(header[5]).toMatch(/mean boarding duration/i);
    expect(header[5]).not.toMatch(/total/i);
    // 2026-07-27: gained the two monthly census columns (measured-path seasonality).
    expect(header[2]).toMatch(/medical boarding census/i);
    expect(header[3]).toMatch(/bh boarding census/i);
  });

  it('Arrivals/ESI Mix tabs emit rows Mon-first (weekend contiguous), not Sun-first', async () => {
    const sheets = await sheetsOf(generateConsolidatedTemplateXlsxBlob());
    for (const tab of ['Arrivals', 'ESI Mix']) {
      const [, ...rows] = sheets[tab];
      // 24 hours per day block, in Mon,Tue,Wed,Thu,Fri,Sat,Sun order.
      const dayBlockStarts = [0, 24, 48, 72, 96, 120, 144].map((i) => rows[i][0]);
      expect(dayBlockStarts).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    }
  });

  it('Boarding Seasonality tab lists 12 months and 7 days with blank values', async () => {
    const sheets = await sheetsOf(generateConsolidatedTemplateXlsxBlob());
    const [, ...rows] = sheets['Boarding Seasonality'];
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r[0])).toEqual([
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ]);
    expect(rows.slice(0, 7).map((r) => r[4])).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    for (const row of rows) {
      expect(row[1]).toBe(''); // monthly mean duration blank
      expect(row[2]).toBe(''); // monthly mean medical census blank
      expect(row[3]).toBe(''); // monthly mean BH census blank
      expect(row[5]).toBe(''); // day-of-week mean duration blank
    }
  });
});
