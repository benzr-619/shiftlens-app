import { describe, expect, it } from 'vitest';
import { generateFilledConsolidatedTemplateXlsxBlob, type ExportableSetupData } from '../template';
import { parseXlsxFile } from '../parseUpload';
import { parseStaffingUploadFile } from '../parseStaffingUpload';
import type { ShiftDef } from '../../engine/types';

// Part 3 (guided-setup/export follow-up prompt, 2026-07-27) — "download my data file" is the
// app's only form of persistence, so export -> re-import MUST round-trip exactly. This is the
// entire value of the feature; a silent mismatch here would be a data-loss bug.
function blobToFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type });
}

function seeded168(seed: number): number[] {
  return Array.from({ length: 168 }, (_, i) => Math.round((Math.sin(i * 0.37 + seed) + 1.3) * 10 * 100) / 100);
}
function seeded12(seed: number): number[] {
  return Array.from({ length: 12 }, (_, i) => Math.round((Math.sin(i * 0.9 + seed) + 1.5) * 5 * 100) / 100);
}

describe('export -> re-import round trip', () => {
  it('round-trips a full dataset (arrivals, P75, ESI, boarding census incl. BH, seasonality, scalars) unchanged', async () => {
    const data: ExportableSetupData = {
      arrivals: seeded168(1),
      arrivalsP75: seeded168(2),
      esiMix: { esi12: seeded168(3), esi3: seeded168(4), esi45: seeded168(5) },
      admitRate: 0.23,
      boardingDuration: 5.4,
      monthlyMeanBoardingDurationHours: seeded12(6),
      dayOfWeekMeanBoardingDurationHours: seeded12(7).slice(0, 7),
      boardingCensusMedical: seeded168(8),
      boardingCensusBH: seeded168(9),
      monthlyBoardingCensusMedical: seeded12(10),
      monthlyBoardingCensusBH: seeded12(11),
      preBedRequestCensus: seeded168(12),
    };

    const blob = generateFilledConsolidatedTemplateXlsxBlob(data);
    const reparsed = await parseXlsxFile(blobToFile(blob, 'export.xlsx'));

    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.arrivals).toEqual(data.arrivals);
    expect(reparsed.arrivalsP75).toEqual(data.arrivalsP75);
    expect(reparsed.esiMix).toEqual(data.esiMix);
    expect(reparsed.admitRate).toBe(data.admitRate);
    expect(reparsed.boardingDuration).toBe(data.boardingDuration);
    expect(reparsed.monthlyMeanBoardingDurationHours).toEqual(data.monthlyMeanBoardingDurationHours);
    expect(reparsed.dayOfWeekMeanBoardingDurationHours).toEqual(data.dayOfWeekMeanBoardingDurationHours);
    expect(reparsed.boardingCensusMedical).toEqual(data.boardingCensusMedical);
    expect(reparsed.boardingCensusBH).toEqual(data.boardingCensusBH);
    expect(reparsed.monthlyBoardingCensusMedical).toEqual(data.monthlyBoardingCensusMedical);
    expect(reparsed.monthlyBoardingCensusBH).toEqual(data.monthlyBoardingCensusBH);
    expect(reparsed.preBedRequestCensus).toEqual(data.preBedRequestCensus);
  });

  it('round-trips the current-staffing grid (own tab) and setup decisions (own tab) unchanged', async () => {
    const shiftMenu: ShiftDef[] = [
      { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 },
      { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 },
    ];
    const currentStaffingGrid = {
      0: { day: 5, night: 4 },
      1: { day: 6, night: 3 },
      2: { day: 6, night: 3 },
      3: { day: 6, night: 3 },
      4: { day: 6, night: 3 },
      5: { day: 5, night: 4 },
      6: { day: 5, night: 4 },
    };
    const data: ExportableSetupData = {
      arrivals: seeded168(40),
      shiftMenu,
      currentStaffingGrid,
      boardingPath: 'census',
      headcountIncludesIndirectCare: true,
      flexAxes: { startTimes: true, shiftCount: false, shiftLengths: true },
      boardingRatioTarget: 5,
      bhBoardingRatioTarget: 12,
      fteInputMode: 'annual',
      fteInputValue: 1872,
    };

    const blob = generateFilledConsolidatedTemplateXlsxBlob(data);
    const file = blobToFile(blob, 'export.xlsx');

    const reparsed = await parseXlsxFile(file);
    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.boardingPath).toBe('census');
    expect(reparsed.headcountIncludesIndirectCare).toBe(true);
    expect(reparsed.flexAxes).toEqual({ startTimes: true, shiftCount: false, shiftLengths: true });
    expect(reparsed.boardingRatioTarget).toBe(5);
    expect(reparsed.bhBoardingRatioTarget).toBe(12);
    expect(reparsed.fteInputMode).toBe('annual');
    expect(reparsed.fteInputValue).toBe(1872);

    // Empty menu passed in -> both shifts must be recovered from the file's own Start
    // Hour/Length columns (proves the shift-recovery fix works end to end on an export, not
    // just on a hand-built upload) — the recovered shifts get NEW generated ids, so compare
    // by (startHour, headcount) rather than by the original 'day'/'night' ids.
    const staffingReparsed = await parseStaffingUploadFile(file, []);
    expect(staffingReparsed.errors).toHaveLength(0);
    expect(staffingReparsed.newShifts).toHaveLength(2);
    const idByStartHour = new Map(staffingReparsed.newShifts!.map((s) => [s.startHour, s.id]));
    const dayId = idByStartHour.get(7)!;
    const nightId = idByStartHour.get(19)!;
    for (let day = 0; day < 7; day++) {
      const expected = currentStaffingGrid[day as keyof typeof currentStaffingGrid];
      expect(staffingReparsed.grid![day]).toEqual({ [dayId]: expected.day, [nightId]: expected.night });
    }
  });

  it('round-trips a minimal arrivals-only dataset — every optional field stays absent, not falsely populated', async () => {
    const data: ExportableSetupData = { arrivals: seeded168(20) };
    const blob = generateFilledConsolidatedTemplateXlsxBlob(data);
    const reparsed = await parseXlsxFile(blobToFile(blob, 'export.xlsx'));

    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.arrivals).toEqual(data.arrivals);
    expect(reparsed.arrivalsP75).toBeUndefined();
    expect(reparsed.esiMix).toBeUndefined();
    expect(reparsed.admitRate).toBeUndefined();
    expect(reparsed.boardingDuration).toBeUndefined();
    expect(reparsed.monthlyMeanBoardingDurationHours).toBeUndefined();
    expect(reparsed.dayOfWeekMeanBoardingDurationHours).toBeUndefined();
    expect(reparsed.boardingCensusMedical).toBeUndefined();
    expect(reparsed.boardingCensusBH).toBeUndefined();
    expect(reparsed.monthlyBoardingCensusMedical).toBeUndefined();
    expect(reparsed.monthlyBoardingCensusBH).toBeUndefined();
    expect(reparsed.preBedRequestCensus).toBeUndefined();
    expect(reparsed.fteInputMode).toBeUndefined();
    expect(reparsed.fteInputValue).toBeUndefined();
  });

  it('the export never carries tool-wide policy values — no Settings sheet (Setup Decisions is per-dataset workflow answers, not policy)', async () => {
    const data: ExportableSetupData = { arrivals: seeded168(30), admitRate: 0.2, boardingDuration: 4 };
    const blob = generateFilledConsolidatedTemplateXlsxBlob(data);
    const XLSX = await import('xlsx');
    const buf = await blob.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    expect(wb.SheetNames).toEqual(['Arrivals', 'ESI Mix', 'Boarding Census', 'Scalars', 'Boarding Seasonality', 'Setup Decisions']);
    expect(wb.SheetNames).not.toContain('Settings');
    expect(wb.SheetNames).not.toContain('Current Staffing'); // no shiftMenu passed -> no staffing tab written
  });
});
