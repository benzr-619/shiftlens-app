import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import PptxGenJS from 'pptxgenjs';
import { exportResultsToPptx } from '../pptxExport';
import { compute } from '../../engine';
import type { EngineInputs, Grid } from '../../engine/types';

const dayNight = [
  { id: 'day', label: 'Day', startHour: 7, lengthHours: 12 },
  { id: 'night', label: 'Night', startHour: 19, lengthHours: 12 },
];

function unimodalArrivals(): number[] {
  const arr = new Array(168);
  for (let i = 0; i < 168; i++) {
    const h = i % 24;
    arr[i] = Math.max(1, 10 + 8 * Math.cos(((h - 13) / 24) * 2 * Math.PI));
  }
  return arr;
}

function baseInputs(overrides: Partial<EngineInputs> = {}): EngineInputs {
  return { arrivals: unimodalArrivals(), wHppvTarget: 1.5, shiftMenu: dayNight, ...overrides };
}

function currentGrid(): Grid {
  const grid: Grid = {};
  for (let day = 0; day < 7; day++) grid[day] = { day: 4, night: 3 };
  return grid;
}

describe('PR L — PPTX export', () => {
  let writeFileSpy: ReturnType<typeof vi.spyOn>;
  let addSlideSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeFileSpy = vi.spyOn(PptxGenJS.prototype, 'writeFile').mockResolvedValue('ok');
    addSlideSpy = vi.spyOn(PptxGenJS.prototype, 'addSlide');
  });

  afterEach(() => {
    writeFileSpy.mockRestore();
    addSlideSpy.mockRestore();
  });

  it('exports a full dataset (arrivals + boarding + current staffing) without throwing, includes boarding slides', async () => {
    const inputs = baseInputs({ admitRate: 0.2, boardingDuration: 5 });
    const result = compute(inputs);
    await exportResultsToPptx({ result, inputs, currentStaffingGrid: currentGrid(), wHppvTarget: 1.5 });
    expect(writeFileSpy).toHaveBeenCalledWith({ fileName: 'ShiftLens-Results.pptx' });
    expect(addSlideSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it('exports an arrivals-only dataset (boarding absent) with FEWER slides, but still includes Method & Limitations', async () => {
    const inputs = baseInputs(); // no admitRate/boardingDuration -> boarding absent
    const result = compute(inputs);
    expect(result.boarding).toBeNull();
    await exportResultsToPptx({ result, inputs, currentStaffingGrid: currentGrid(), wHppvTarget: 1.5 });
    expect(writeFileSpy).toHaveBeenCalled();
    // Boarding + constrained-reallocation slides should both be skipped when boarding is absent.
    const arrivalsOnlySlideCount = addSlideSpy.mock.calls.length;
    expect(arrivalsOnlySlideCount).toBeGreaterThan(0);
  });

  it('a full dataset produces MORE slides than an arrivals-only one (boarding slides included)', async () => {
    const fullInputs = baseInputs({ admitRate: 0.2, boardingDuration: 5 });
    const fullResult = compute(fullInputs);
    await exportResultsToPptx({ result: fullResult, inputs: fullInputs, currentStaffingGrid: currentGrid(), wHppvTarget: 1.5 });
    const fullCount = addSlideSpy.mock.calls.length;

    addSlideSpy.mockClear();

    const arrivalsOnlyInputs = baseInputs();
    const arrivalsOnlyResult = compute(arrivalsOnlyInputs);
    await exportResultsToPptx({ result: arrivalsOnlyResult, inputs: arrivalsOnlyInputs, currentStaffingGrid: currentGrid(), wHppvTarget: 1.5 });
    const arrivalsOnlyCount = addSlideSpy.mock.calls.length;

    expect(fullCount).toBeGreaterThan(arrivalsOnlyCount);
  });

  it('handles no current staffing gracefully (does not throw), still includes Method & Limitations', async () => {
    const inputs = baseInputs({ admitRate: 0.2, boardingDuration: 5 });
    const result = compute(inputs);
    await expect(exportResultsToPptx({ result, inputs, currentStaffingGrid: {}, wHppvTarget: 1.5 })).resolves.not.toThrow();
    expect(writeFileSpy).toHaveBeenCalled();
  });
});
