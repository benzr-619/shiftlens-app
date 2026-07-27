import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { generateStaffingTemplateXlsxBlob } from '../template';
import { rowsToStaffingGrid } from '../parseStaffingUpload';
import type { ShiftDef } from '../../engine/types';

const shiftMenu: ShiftDef[] = [
  { id: 'shift-1', label: 'Day', startHour: 7, lengthHours: 12 },
  { id: 'shift-2', label: 'Night', startHour: 19, lengthHours: 12 },
];

describe('staffing template round-trip', () => {
  it('generates a blank template with no seeded values', async () => {
    const blob = generateStaffingTemplateXlsxBlob(shiftMenu);
    const buf = await blob.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    expect(wb.SheetNames).toEqual(['Current Staffing']);
    const rows: (string | number)[][] = XLSX.utils.sheet_to_json(wb.Sheets['Current Staffing'], { header: 1, defval: '' });
    expect(rows[0]).toEqual(['Day', 'Shift', 'Start Hour', 'Length (Hrs)', 'Headcount']);
    expect(rows.length).toBe(1 + 7 * 2); // header + 7 days x 2 shifts
    rows.slice(1).forEach((r) => expect(r[4]).toBe('')); // headcount blank
    // Mon-first row emission (weekend contiguous) — display-only, matching is by name/Start Hour.
    const dayBlockStarts = [0, 2, 4, 6, 8, 10, 12].map((i) => rows[1 + i][0]);
    expect(dayBlockStarts).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  });

  it('parses filled-in rows back into a Grid keyed by shift id', () => {
    const headers = ['Day', 'Shift', 'Start Hour', 'Length (Hrs)', 'Headcount'];
    const rows: (string | number)[][] = [
      ['Sunday', 'Day', 7, 12, 3],
      ['Sunday', 'Night', 19, 12, 2],
      ['Monday', 'Day', 7, 12, ''], // blank headcount — should be skipped
    ];
    const result = rowsToStaffingGrid(headers, rows, shiftMenu);
    expect(result.errors).toEqual([]);
    expect(result.grid).toEqual({
      0: { 'shift-1': 3, 'shift-2': 2 },
    });
  });

  it('renamed Shift label does not break matching (keys off Start Hour/Length)', () => {
    const headers = ['Day of Week', 'Shift Name', 'Start Hour', 'Length (Hrs)', 'Headcount'];
    const rows: (string | number)[][] = [['Wed', 'Whatever I call it', 19, 12, 4]];
    const result = rowsToStaffingGrid(headers, rows, shiftMenu);
    expect(result.errors).toEqual([]);
    expect(result.grid).toEqual({ 3: { 'shift-2': 4 } });
  });

  it('errors when required columns are missing', () => {
    const result = rowsToStaffingGrid(['Foo', 'Bar'], [['a', 'b']], shiftMenu);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.grid).toBeUndefined();
  });

  // A staffing row already fully specifies a shift (Start Hour + Length) — a row referencing a
  // shift the current menu doesn't have yet should recover it, not silently skip the row.
  describe('recovers shifts the current menu is missing (Start Hour + Length in the row itself)', () => {
    it('adds a new shift and assigns its headcount, instead of skipping the row', () => {
      const headers = ['Day', 'Shift', 'Start Hour', 'Length (Hrs)', 'Headcount'];
      const rows: (string | number)[][] = [
        ['Sunday', 'Mid', 11, 8, 5],
        ['Sunday', 'Day', 7, 12, 3],
      ];
      const result = rowsToStaffingGrid(headers, rows, shiftMenu);
      expect(result.errors).toEqual([]);
      expect(result.newShifts).toHaveLength(1);
      expect(result.newShifts![0]).toMatchObject({ label: 'Mid', startHour: 11, lengthHours: 8 });
      const newId = result.newShifts![0].id;
      expect(result.grid).toEqual({ 0: { [newId]: 5, 'shift-1': 3 } });
      expect(result.warnings.some((w) => w.includes('Added 1 shift'))).toBe(true);
    });

    it('dedupes repeated (Start Hour, Length) pairs across days into one new shift', () => {
      const headers = ['Day', 'Shift', 'Start Hour', 'Length (Hrs)', 'Headcount'];
      const rows: (string | number)[][] = [
        ['Sunday', 'Mid', 11, 8, 5],
        ['Monday', 'Mid', 11, 8, 4],
        ['Tuesday', 'Mid', 11, 8, 6],
      ];
      const result = rowsToStaffingGrid(headers, rows, shiftMenu);
      expect(result.newShifts).toHaveLength(1);
      const newId = result.newShifts![0].id;
      expect(result.grid).toEqual({ 0: { [newId]: 5 }, 1: { [newId]: 4 }, 2: { [newId]: 6 } });
    });

    it('still warns and skips a row with no Length column to recover a full shift definition from', () => {
      const headers = ['Day', 'Start Hour', 'Headcount'];
      const rows: (string | number)[][] = [['Sunday', 11, 5]];
      const result = rowsToStaffingGrid(headers, rows, shiftMenu);
      expect(result.grid).toBeUndefined();
      expect(result.errors.length).toBeGreaterThan(0); // no rows filled at all -> the "no rows found" error
    });
  });
});
