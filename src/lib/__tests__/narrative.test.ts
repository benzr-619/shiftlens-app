import { describe, expect, it } from 'vitest';
import {
  scheduleMeansOvercoverageSentence,
  deliveryPremiumSentence,
  whppvRangeSentence,
  comparisonHeadlineSentence,
  scenarioBHeadlineSentence,
  shiftDiagnosticSentence,
  synthesisHeadlineSentence,
  fundingAskAlreadyFundedSentence,
  fundingAskKneeLeadSentence,
} from '../narrative';
import type { ShiftDiagnosticGroup } from '../../engine/hiddenBoarding';
import type { ScenarioBResult } from '../../engine';
import type { SynthesisResult } from '../../engine/synthesis';

describe('narrative.ts — pure headline functions', () => {
  it('scheduleMeansOvercoverageSentence: over and under both render, never the banned word "budget"', () => {
    const over = scheduleMeansOvercoverageSentence(1656, 1509);
    expect(over).toContain('over target-implied hours');
    expect(over.toLowerCase()).not.toContain('budget');
    const under = scheduleMeansOvercoverageSentence(1400, 1509);
    expect(under).toContain('under target-implied hours');
  });

  it('deliveryPremiumSentence: null below the noise floor, a real sentence above it', () => {
    expect(deliveryPremiumSentence(1509.2, 1509, [12, 12])).toBeNull();
    const s = deliveryPremiumSentence(1656, 1509, [12, 12]);
    expect(s).not.toBeNull();
    expect(s).toContain('147 hours a week');
    expect(s!.toLowerCase()).not.toContain('budget');
  });

  it('deliveryPremiumSentence: a non-default hoursPerFteAnnual scales the reported FTE figure consistently', () => {
    const defaultSentence = deliveryPremiumSentence(1656, 1509, [12, 12]); // 147 hrs/wk premium, default 2080 hrs/yr -> 3.7 FTE
    const hoursPerFteAnnual36x52 = 36 * 52; // 1872
    const customSentence = deliveryPremiumSentence(1656, 1509, [12, 12], hoursPerFteAnnual36x52);
    expect(defaultSentence).toContain('3.7 FTE');
    // 147 * 52 / 1872 = 4.08... -> 4.1 FTE, strictly more than the default's 3.7 FTE.
    expect(customSentence).toContain('4.1 FTE');
  });

  it('whppvRangeSentence: names both hours', () => {
    const s = whppvRangeSentence(1.1, { day: 6, hour: 7 }, 2.3, { day: 1, hour: 19 }, 1.5);
    expect(s).toContain('Sat 07:00');
    expect(s).toContain('Mon 19:00');
    expect(s).toContain('1.10 wHPPV');
    expect(s).toContain('2.30 wHPPV');
  });

  it('comparisonHeadlineSentence: all four gapKind branches produce distinct, non-empty text', () => {
    const none = comparisonHeadlineSentence(1500, 1500, 'none', 0, 0, null);
    const size = comparisonHeadlineSentence(1400, 1500, 'size', 100, 5, 20);
    const shape = comparisonHeadlineSentence(1500, 1500, 'shape', 5, 80, 15);
    const both = comparisonHeadlineSentence(1400, 1500, 'both', 100, 80, 30);
    for (const s of [none, size, shape, both]) expect(s.length).toBeGreaterThan(0);
    expect(none).toContain('no total-hours or shape gap');
    expect(size).toContain('total-hours gap');
    expect(shape).toContain('shape gap');
    expect(both).toContain('both a total-hours gap and a shape gap');
  });

  it('scenarioBHeadlineSentence: full-coverage, near-optimal, and general branches all distinct', () => {
    const base: ScenarioBResult = {
      grid: {},
      weeklyScheduledHours: 1000,
      currentTotalWeeklyHours: 1000,
      totalBacklogHours: 0,
      totalSeverity: 50,
      peakSeverity: 5,
      isFullCoverage: false,
      overageFromFloor: 0,
    };
    const fullCoverage = scenarioBHeadlineSentence({ ...base, isFullCoverage: true }, 200);
    expect(fullCoverage).toContain('shape is the entire problem');

    const nearOptimal = scenarioBHeadlineSentence({ ...base, totalSeverity: 195 }, 200);
    expect(nearOptimal).toContain('already close to the best placement');

    const general = scenarioBHeadlineSentence({ ...base, totalSeverity: 50 }, 200);
    expect(general).toContain('cut modeled queued-arrivals-work by roughly');
  });

  it('shiftDiagnosticSentence: sign-aware net = staffed - arrivalDemand - boardingDemand, singular/plural, boarding-absent, and both surplus branches (2026-08-05 boarding-capacity-fix)', () => {
    const understaffedSingle: ShiftDiagnosticGroup = {
      shiftIds: ['night'],
      labels: ['Night'],
      arrivalsStatus: 'understaffed',
      staffedHours: 400,
      requiredHours: 567,
      surplus: 0,
      boardingNeedHours: 283,
      boardingCovered: false,
    };
    const s1 = shiftDiagnosticSentence(understaffedSingle);
    expect(s1).toBe(
      'On average, Night shift runs 167 nursing hours short of arrivals demand alone. Boarding adds another 283 hours of demand on the same nurses, widening the shortfall to 450 hours total.'
    );

    const understaffedNoBoarding: ShiftDiagnosticGroup = { ...understaffedSingle, boardingNeedHours: null, boardingCovered: null };
    const s2 = shiftDiagnosticSentence(understaffedNoBoarding);
    expect(s2).toBe('On average, Night shift is understaffed for arrivals.');

    // arrivalsNet = 900 - 700 = 200 (ahead); boardingNeed 350 > 200 -> leaves a shortfall.
    const overstaffedPluralNotCovered: ShiftDiagnosticGroup = {
      shiftIds: ['day', 'evening'],
      labels: ['Day', 'Evening'],
      arrivalsStatus: 'overstaffed',
      staffedHours: 900,
      requiredHours: 700,
      surplus: 200,
      boardingNeedHours: 350,
      boardingCovered: false,
    };
    const s3 = shiftDiagnosticSentence(overstaffedPluralNotCovered);
    expect(s3).toBe(
      'On average, Day and Evening shifts run 200 nursing hours ahead of arrivals demand alone. Boarding claims 350 of that surplus first, leaving 150 hours of a shortfall.'
    );

    // Same arrivalsNet, smaller boarding claim -> leaves a cushion instead.
    const overstaffedCovered: ShiftDiagnosticGroup = { ...overstaffedPluralNotCovered, boardingNeedHours: 50, boardingCovered: true };
    const s4 = shiftDiagnosticSentence(overstaffedCovered);
    expect(s4).toBe(
      'On average, Day and Evening shifts run 200 nursing hours ahead of arrivals demand alone. Boarding claims 50 of that surplus first, leaving 150 hours of cushion.'
    );

    const threeShifts: ShiftDiagnosticGroup = {
      ...understaffedSingle,
      shiftIds: ['a', 'b', 'c'],
      labels: ['Day', 'Evening', 'Night'],
    };
    expect(shiftDiagnosticSentence(threeShifts)).toContain('On average, Day, Evening, and Night shifts run 167 nursing hours short');
  });

  it('synthesisHeadlineSentence: positive, negative, and near-zero gap all produce distinct endings (§12.3)', () => {
    const positive: SynthesisResult = {
      arrivalsWeeklyHours: 1509,
      boardingWeeklyHours: 624,
      totalDemandWeeklyHours: 2133,
      currentStaffedWeeklyHours: 1548,
      gapHours: 585,
      gapFte: 14.6,
      dayShareOfShortfallPct: 83,
      gapClosedByReallocationHours: 185,
      boardingDataPresent: true,
    };
    const s1 = synthesisHeadlineSentence(positive);
    expect(s1).toContain('needs about 2133 nurse-hours');
    expect(s1).toContain('585 hours — 14.6 FTE');
    expect(s1).toContain('83% of it falls between 07:00 and 19:00');
    expect(s1).toContain('closes 185 of those 585');

    const negative: SynthesisResult = { ...positive, gapHours: -100, gapFte: -2.5, dayShareOfShortfallPct: null, gapClosedByReallocationHours: 0 };
    const s2 = synthesisHeadlineSentence(negative);
    expect(s2).toContain('already staff 100 hours a week more');
    expect(s2).not.toMatch(/means|therefore|so you/i); // §1(5): no interpretive closing sentence

    const zero: SynthesisResult = { ...positive, gapHours: 0.1, gapFte: 0, dayShareOfShortfallPct: null, gapClosedByReallocationHours: 0 };
    const s3 = synthesisHeadlineSentence(zero);
    expect(s3).toContain('match total demand almost exactly');

    const noBoarding: SynthesisResult = { ...positive, boardingDataPresent: false, boardingWeeklyHours: null, totalDemandWeeklyHours: 1509 };
    expect(synthesisHeadlineSentence(noBoarding)).toContain('only half the picture');
  });

  it('fundingAsk sentences: already-funded and knee-lead both produce non-empty, budget-free text', () => {
    const s1 = fundingAskAlreadyFundedSentence(1600, 1.4, 1.5);
    expect(s1).toContain('no funding ask to make here');
    expect(s1.toLowerCase()).not.toContain('budget');

    const s2 = fundingAskKneeLeadSentence(2.7, 68, 2256, 14.9, 2.1, 1.5, 81, 'Fri 18:00');
    expect(s2).toContain('2.7 FTE');
    expect(s2).toContain('68%');
    expect(s2).toContain('81-hour Fri 18:00 stretch');
    expect(s2.toLowerCase()).not.toContain('budget');
  });
});
