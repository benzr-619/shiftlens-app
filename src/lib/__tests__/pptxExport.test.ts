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

describe('PR H/R13 — PPTX export (fixed 10-slide deck)', () => {
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

  it('exports exactly 10 slides for a full dataset (arrivals + boarding + current staffing)', async () => {
    const inputs = baseInputs({ admitRate: 0.2, boardingDuration: 5 });
    const result = compute(inputs);
    await exportResultsToPptx({
      result,
      inputs,
      currentStaffingGrid: currentGrid(),
      wHppvTarget: 1.5,
      arrivals: inputs.arrivals,
      shiftMenu: dayNight,
    });
    expect(writeFileSpy).toHaveBeenCalledWith({ fileName: 'ShiftLens-Results.pptx' });
    expect(addSlideSpy.mock.calls.length).toBe(10);
  });

  it('exports exactly 10 slides for an arrivals-only dataset (boarding absent)', async () => {
    const inputs = baseInputs(); // no admitRate/boardingDuration -> boarding absent
    const result = compute(inputs);
    expect(result.boarding).toBeNull();
    await exportResultsToPptx({
      result,
      inputs,
      currentStaffingGrid: currentGrid(),
      wHppvTarget: 1.5,
      arrivals: inputs.arrivals,
      shiftMenu: dayNight,
    });
    expect(writeFileSpy).toHaveBeenCalled();
    expect(addSlideSpy.mock.calls.length).toBe(10);
  });

  it('handles no current staffing gracefully (does not throw), still exports 10 slides', async () => {
    const inputs = baseInputs({ admitRate: 0.2, boardingDuration: 5 });
    const result = compute(inputs);
    await expect(
      exportResultsToPptx({ result, inputs, currentStaffingGrid: {}, wHppvTarget: 1.5, arrivals: inputs.arrivals, shiftMenu: dayNight })
    ).resolves.not.toThrow();
    expect(writeFileSpy).toHaveBeenCalled();
    expect(addSlideSpy.mock.calls.length).toBe(10);
  });

  it('an untouched sandbox (no sandboxEdGrid/sandboxHoldGrid) exports without throwing, prefilled with the recommendation', async () => {
    const inputs = baseInputs({ admitRate: 0.2, boardingDuration: 5 });
    const result = compute(inputs);
    await expect(
      exportResultsToPptx({
        result,
        inputs,
        currentStaffingGrid: currentGrid(),
        wHppvTarget: 1.5,
        arrivals: inputs.arrivals,
        shiftMenu: dayNight,
        sandboxEdGrid: null,
        sandboxHoldGrid: null,
      })
    ).resolves.not.toThrow();
    expect(writeFileSpy).toHaveBeenCalled();
    expect(addSlideSpy.mock.calls.length).toBe(10);
  });

  it('a real sandbox scenario (ED + hold grids provided) exports without throwing', async () => {
    const inputs = baseInputs({ admitRate: 0.2, boardingDuration: 5 });
    const result = compute(inputs);
    const edGrid: Grid = {};
    const holdGrid: Grid = {};
    for (let day = 0; day < 7; day++) {
      edGrid[day] = { day: 5, night: 4 };
      holdGrid[day] = { day: 1, night: 1 };
    }
    await expect(
      exportResultsToPptx({
        result,
        inputs,
        currentStaffingGrid: currentGrid(),
        wHppvTarget: 1.5,
        arrivals: inputs.arrivals,
        shiftMenu: dayNight,
        sandboxEdGrid: edGrid,
        sandboxHoldGrid: holdGrid,
      })
    ).resolves.not.toThrow();
    expect(writeFileSpy).toHaveBeenCalled();
    expect(addSlideSpy.mock.calls.length).toBe(10);
  });

});
