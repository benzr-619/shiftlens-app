import { describe, expect, it } from 'vitest';
import { rowsToParsedUpload } from '../parseUpload';

describe('tolerant header-based template parsing', () => {
  it('detects required columns regardless of order, casing, and spacing', () => {
    const headers = ['Arrival Count', 'Weekday', 'Hour of Day'];
    const rows = [['12', 'Monday', '9']];
    const result = rowsToParsedUpload(headers, rows);
    expect(result.errors).toHaveLength(0);
    expect(result.arrivals[1 * 24 + 9]).toBe(12);
  });

  it('errors clearly when required columns cannot be found at all', () => {
    const headers = ['Foo', 'Bar', 'Baz'];
    const result = rowsToParsedUpload(headers, [['1', '2', '3']]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('ignores a partially-filled optional column and warns rather than silently estimating', () => {
    const headers = ['Day', 'Hour', 'Arrivals', 'Admit Rate'];
    const rows = [
      ['Sunday', '0', '5', '0.2'],
      ['Sunday', '1', '4', ''],
    ];
    const result = rowsToParsedUpload(headers, rows);
    expect(result.admitRate).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('Admit rate'))).toBe(true);
  });

  it('accepts 3-letter day abbreviations and 1-24 hour labeling', () => {
    const headers = ['Day', 'Hour', 'Arrivals'];
    const rows = [['Sat', '24', '3']]; // hour 24 -> tolerated as hour 23
    const result = rowsToParsedUpload(headers, rows);
    expect(result.errors).toHaveLength(0);
    expect(result.arrivals[6 * 24 + 23]).toBe(3);
  });
});
