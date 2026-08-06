// PR H (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §8) — every templated headline as a pure
// function: no JSX, no store access, just (values) -> string. Two reasons this exists as one
// module rather than staying inline in each component: (1) PR L's PPTX export uses these SAME
// functions for slide titles — without this, the deck becomes a second copy of the copy and
// the two drift the first time either changes; (2) `engine/__tests__/syntheticSweep.test.ts`
// exercises every export here against ~20 parametrically-generated departments, checking for
// empty strings and placeholder residue (`undefined`, `NaN`, `-0`, unfilled `{{...}}`) — the
// test §12.5 calls "the one that actually catches sign-assuming copy."
//
// SCOPE (not exhaustive — flagged, not hidden): this extraction covers the sections built or
// touched in PRs E-G (Scenario B, the hidden-boarding diagnostic, the synthesis chapter, the
// funding-ask headline, the core-grid comparison headline, the wHPPV-range sentence), WORDED
// IDENTICALLY to what those components currently render inline via JSX. Older sections
// (`CurrentStaffingAnalysis`, `BoardingTransition`, `BoardingCoverageSection`,
// `ShiftMenuFlexibilitySection`) still generate their headline text inline and have NOT been
// mirrored here yet — a real follow-up, not an oversight.
//
// CURRENT STATE (flagged, not silently glossed over): the components covered above still
// render their OWN JSX (with <strong> emphasis this file's plain-text functions don't
// reproduce) rather than calling these functions directly — swapping live, already-verified UI
// copy over to a plain-text renderer without a way to visually re-verify emphasis/layout in
// this session was judged a worse risk than a documented, temporary duplication. These
// functions exist today for: (1) `engine/__tests__/syntheticSweep.test.ts`'s narrative hook,
// which DOES call them; (2) PR L's PPTX export, which will use them as the single source for
// slide titles. The NEXT time any covered section's copy changes, switch that component to
// call its narrative.ts function instead of hand-editing its inline JSX string — that is what
// closes the duplication for good, section by section, rather than in one large risky pass.

import { DEFAULTS, type EngineResult, type EngineInputs } from '../engine/types';
import type { ShiftDiagnosticGroup } from '../engine/hiddenBoarding';
import type { ScenarioBResult } from '../engine';
import type { SynthesisResult } from '../engine/synthesis';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtDayHour(at: { day: number; hour: number }): string {
  return `${DAY_LABELS[at.day]} ${at.hour.toString().padStart(2, '0')}:00`;
}

// --- Coverage-summary / "what this schedule means" (CoreGridTab.tsx) ---

export function scheduleMeansOvercoverageSentence(weeklyScheduledHours: number, weeklyBudgetHours: number): string {
  const pct = weeklyBudgetHours > 0 ? (weeklyScheduledHours - weeklyBudgetHours) / weeklyBudgetHours : 0;
  const overUnder = pct >= 0 ? `${(pct * 100).toFixed(0)}% over` : `${Math.abs(pct * 100).toFixed(0)}% under`;
  return `The recommended schedule runs ${weeklyScheduledHours.toFixed(0)} hours/week, which is ${overUnder} target-implied hours (${weeklyBudgetHours.toFixed(0)} target-implied hrs/week).`;
}

export function deliveryPremiumSentence(
  weeklyScheduledHours: number,
  weeklyBudgetHours: number,
  shiftLengths: number[],
  hoursPerFteAnnual: number = DEFAULTS.hoursPerFteAnnual
): string | null {
  const premiumHours = weeklyScheduledHours - weeklyBudgetHours;
  if (premiumHours <= 0.5) return null;
  const premiumFte = (premiumHours * 52) / hoursPerFteAnnual;
  return `Whole nurses and ${shiftLengths.join('/')}-hour shift blocks cost ${premiumHours.toFixed(0)} hours a week (${premiumFte.toFixed(1)} FTE) more than the target's arithmetic implies. That's granularity, not waste — a different shift menu is the one lever that reduces it.`;
}

export function whppvRangeSentence(
  minWHppv: number,
  minAt: { day: number; hour: number },
  maxWHppv: number,
  maxAt: { day: number; hour: number },
  realizedWHppv: number
): string {
  return `Across the 168 hours of the week, the schedule actually realizes as low as ${minWHppv.toFixed(2)} wHPPV (around ${fmtDayHour(minAt)}) and as high as ${maxWHppv.toFixed(2)} wHPPV (around ${fmtDayHour(maxAt)}), even though the weekly average lands at ${realizedWHppv.toFixed(2)}.`;
}

// --- Comparison unit (idealized vs. current) — CoreGridTab.tsx ---

export type GapKind = 'none' | 'size' | 'shape' | 'both';

export function comparisonHeadlineSentence(
  currentWeeklyHours: number,
  idealizedWeeklyHours: number,
  gapKind: GapKind,
  sizeGapHours: number,
  shapeGapHours: number,
  severityReductionPct: number | null
): string {
  const absSizeGap = Math.abs(sizeGapHours);
  let core = `Your current staffing runs ${currentWeeklyHours.toFixed(0)} hrs/week against the idealized ${idealizedWeeklyHours.toFixed(0)} hrs/week`;
  if (gapKind === 'none') {
    core += ' — the two line up, with no total-hours or shape gap to close.';
  } else if (gapKind === 'size') {
    core += ` — a ${absSizeGap.toFixed(0)}-hr ${sizeGapHours > 0 ? 'shortfall' : 'surplus'} spread roughly evenly across the week. This is mainly a total-hours gap: the shape is about right, you just need ${sizeGapHours > 0 ? 'more' : 'fewer'} total hours.`;
  } else if (gapKind === 'shape') {
    core += ` — about the same total, but ${shapeGapHours.toFixed(0)} hrs sit in the wrong shifts. This is mainly a shape gap: right total, wrong distribution — redistributing hours, not adding more, is the fix.`;
  } else {
    core += ` — a ${absSizeGap.toFixed(0)}-hr ${sizeGapHours > 0 ? 'shortfall' : 'surplus'}, and on top of that ${shapeGapHours.toFixed(0)} hrs sit in the wrong shifts. This is both a total-hours gap and a shape gap — you need a different total and a different distribution.`;
  }
  if (gapKind !== 'none' && sizeGapHours > 0 && severityReductionPct !== null && severityReductionPct >= 1) {
    core += ` Closing it would cut modeled queued-patient-work by roughly ${severityReductionPct.toFixed(0)}% on the same scale this schedule is optimized against.`;
  }
  return core;
}

// --- Scenario B (ScenarioBSection.tsx) ---

export function scenarioBHeadlineSentence(scenarioB: ScenarioBResult, currentSeverity: number): string {
  if (scenarioB.isFullCoverage) {
    return `Your current ${scenarioB.currentTotalWeeklyHours.toFixed(0)} hrs/week already fund enough hours to never be short against arrivals alone — shape is the entire problem, not size. Reallocating them removes essentially all of the queued arrivals work, at zero additional cost.`;
  }
  const severityReductionPct =
    currentSeverity > 0 ? Math.max(0, Math.min(100, ((currentSeverity - scenarioB.totalSeverity) / currentSeverity) * 100)) : 0;
  if (severityReductionPct < 5) {
    return `Your current ${scenarioB.currentTotalWeeklyHours.toFixed(0)} hrs/week are already close to the best placement possible for that total against arrivals — this isn't a shape problem worth chasing further. If your department still feels short, the answer likely isn't in this scenario.`;
  }
  return `Keeping your same ${scenarioB.currentTotalWeeklyHours.toFixed(0)} hrs/week but placing them where arrivals actually need them would cut modeled queued-arrivals-work by roughly ${severityReductionPct.toFixed(0)}% — from ${currentSeverity.toFixed(0)} down to ${scenarioB.totalSeverity.toFixed(0)} on the same severity scale the schedule is optimized against, at zero additional hours.`;
}

// --- Per-shift arrivals/boarding diagnostic (PANEL1_COPY_REVISION_SPEC_2026-07-28.md §4) ---
// Supersedes the old fixed day/night (07-19/19-07) sentence pair — one sentence per MERGED
// shift group now, since the diagnostic is rebuilt per actual shift in the shift menu rather
// than a fixed calendar split. See engine/hiddenBoarding.ts's header for the full model.

function joinShiftNames(labels: string[]): string {
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

// 2026-08-05 rewrite (ShiftLens boarding-vs-arrivals-capacity fix) — sign-aware, one formula:
// net = staffed − arrivalDemand − boardingDemand. The old copy framed boarding as drawing on
// whatever nursing capacity arrivals leave over ("left over to also cover") — backwards:
// boarding patients are already physically present and draw on the same nurses concurrently
// with arrivals, not after them. This treats boarding's claim as coming FIRST against
// arrivals-net (staffed − arrivalDemand), reporting the group's own signed shortfall/surplus
// before and after that claim, rather than a covered/not-covered boolean.
export function shiftDiagnosticSentence(group: ShiftDiagnosticGroup): string {
  const plural = group.labels.length > 1;
  const names = joinShiftNames(group.labels);
  const isAre = plural ? 'are' : 'is';
  const shiftWord = plural ? 'shifts' : 'shift';
  const runWord = plural ? 'run' : 'runs';
  const verdict =
    group.arrivalsStatus === 'understaffed' ? 'understaffed' : group.arrivalsStatus === 'overstaffed' ? 'overstaffed' : 'staffed about right';

  if (group.boardingNeedHours === null) {
    return `On average, ${names} ${shiftWord} ${isAre} ${verdict} for arrivals.`;
  }

  // arrivalsNet > 0 means staffed hours exceed arrivals demand alone (a surplus/"ahead");
  // <= 0 means staffed hours fall short of arrivals demand alone (a shortfall).
  const arrivalsNet = group.staffedHours - group.requiredHours;
  const boardingNeed = group.boardingNeedHours;
  const net = arrivalsNet - boardingNeed;

  if (arrivalsNet <= 0) {
    const shortHours = Math.abs(arrivalsNet);
    const totalShortfall = shortHours + boardingNeed;
    return `On average, ${names} ${shiftWord} ${runWord} ${shortHours.toFixed(0)} nursing hours short of arrivals demand alone. Boarding adds another ${boardingNeed.toFixed(0)} hours of demand on the same nurses, widening the shortfall to ${totalShortfall.toFixed(0)} hours total.`;
  }

  const cushionOrShortfall = net >= 0 ? 'cushion' : 'a shortfall';
  return `On average, ${names} ${shiftWord} ${runWord} ${arrivalsNet.toFixed(0)} nursing hours ahead of arrivals demand alone. Boarding claims ${boardingNeed.toFixed(0)} of that surplus first, leaving ${Math.abs(net).toFixed(0)} hours of ${cushionOrShortfall}.`;
}

// --- Synthesis chapter (SynthesisSection.tsx) ---

export function synthesisHeadlineSentence(synthesis: SynthesisResult): string {
  const gapIsPositive = synthesis.gapHours > 0.5;
  const gapIsNegative = synthesis.gapHours < -0.5;

  const demandSentence = synthesis.boardingDataPresent
    ? `Between arrivals and boarding, your department needs about ${synthesis.totalDemandWeeklyHours.toFixed(0)} nurse-hours a week.`
    : `Against arrivals alone, your department needs about ${synthesis.totalDemandWeeklyHours.toFixed(0)} nurse-hours a week — boarding data isn't available, so this is only half the picture.`;

  let tail = '';
  if (gapIsPositive) {
    const dayShare =
      synthesis.dayShareOfShortfallPct !== null ? ` — and ${synthesis.dayShareOfShortfallPct.toFixed(0)}% of it falls between 07:00 and 19:00` : '';
    tail = ` The difference is ${synthesis.gapHours.toFixed(0)} hours — ${synthesis.gapFte.toFixed(1)} FTE${dayShare}. Placing your existing hours as well as possible closes ${synthesis.gapClosedByReallocationHours.toFixed(0)} of those ${synthesis.gapHours.toFixed(0)}.`;
  } else if (gapIsNegative) {
    tail = ` You already staff ${Math.abs(synthesis.gapHours).toFixed(0)} hours a week more than that total, in aggregate.`;
  } else {
    tail = ' Your total hours match total demand almost exactly.';
  }

  return `${demandSentence} You staff ${synthesis.currentStaffedWeeklyHours.toFixed(0)}.${tail}`;
}

// --- Funding ask (FundingAskSection.tsx) ---

export function fundingAskAlreadyFundedSentence(fullCoverageWeeklyHours: number, impliedWhppv: number, wHppvTarget: number): string {
  return `Full coverage of every hour would take ${fullCoverageWeeklyHours.toFixed(0)} hrs/week — and what delivering your target already funds covers that (equivalent to running at ${impliedWhppv.toFixed(2)} wHPPV, at or below your ${wHppvTarget} target). There's no funding ask to make here; the idealized grid above already covers every hour without trimming.`;
}

export function fundingAskKneeLeadSentence(
  kneeFte: number,
  pctSeverityRemoved: number,
  fullCoverageWeeklyHours: number,
  fteDelta: number,
  impliedWhppv: number,
  wHppvTarget: number,
  worstStretchHours: number | null,
  worstStretchLabel: string | null
): string {
  let stretchClause = '';
  if (worstStretchHours !== null && worstStretchHours >= 168) {
    stretchClause = ' and ends the week-long stretch where backlog never fully clears';
  } else if (worstStretchLabel && worstStretchHours !== null && worstStretchHours > 0) {
    stretchClause = ` and eliminates the ${worstStretchHours}-hour ${worstStretchLabel} stretch`;
  }
  return `The ask that buys the most: about ${kneeFte.toFixed(1)} FTE removes roughly ${pctSeverityRemoved.toFixed(0)}% of the modeled queued-patient-work${stretchClause}. Past about ${kneeFte.toFixed(1)} FTE, each additional FTE buys progressively less — full coverage of every hour, the far end of that range, would take ${fullCoverageWeeklyHours.toFixed(0)} hrs/week in total (${fteDelta.toFixed(1)} FTE above what delivering your target costs today), equivalent to running at ${impliedWhppv.toFixed(2)} wHPPV instead of your ${wHppvTarget} target.`;
}

// --- Best-effort (result, inputs)-only entry points, for the synthetic sweep's narrative hook
// (engine/__tests__/syntheticSweep.test.ts) — most functions above need additional context
// (a grid, a current-staffing grid) the sweep's generic (result, inputs) call can't supply, so
// this is a small set that CAN be driven from (result, inputs) alone.

export function scheduleMeansOvercoverageFromResult(result: EngineResult, _inputs: EngineInputs): string {
  return scheduleMeansOvercoverageSentence(result.weeklyScheduledHours, result.weeklyBudgetHours);
}

export function deliveryPremiumFromResult(result: EngineResult, inputs: EngineInputs): string | null {
  return deliveryPremiumSentence(
    result.weeklyScheduledHours,
    result.weeklyBudgetHours,
    inputs.shiftMenu.map((s) => s.lengthHours),
    inputs.hoursPerFteAnnual ?? DEFAULTS.hoursPerFteAnnual
  );
}
