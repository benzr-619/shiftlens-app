import { describe, expect, it } from 'vitest';
import { buildConstantsTable } from '../constantsMetadata';
import { DEFAULTS } from '../../engine/types';

describe('PR I — constants table (Chapter 9)', () => {
  it('generates one row per DEFAULTS key, with a real value read live from DEFAULTS', () => {
    const rows = buildConstantsTable();
    expect(rows.length).toBe(Object.keys(DEFAULTS).length);
    for (const row of rows) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.controls.length).toBeGreaterThan(0);
      expect(row.ifMoved.length).toBeGreaterThan(0);
      expect(['ESTABLISHED', 'CONSENSUS', 'CONVENTION', 'ASSUMPTION', 'OPTIONAL']).toContain(row.evidenceTag);
      // value comes straight from the live DEFAULTS object, not a hand-copied literal.
      expect(row.value).toBe(DEFAULTS[row.key as keyof typeof DEFAULTS]);
    }
  });
});
