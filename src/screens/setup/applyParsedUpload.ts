import type { ParsedUpload } from '../../lib/parseUpload';
import type { useStore } from '../../store';
import { deriveAnnualVisits } from '../../engine/allocate';
import { lookupWhppvBand } from '../../lib/edbaLookup';

type Store = ReturnType<typeof useStore.getState>;

// One upload, one place to apply it — DataStep's single template/upload can carry
// arrivals, ESI mix, admit rate, boarding duration, and both boarding-seasonality totals
// in one action; this applies whatever subset of fields is actually present (a user can
// upload just the Arrivals tab filled in, same graceful-degradation philosophy as before).
export function applyParsedUpload(parsed: ParsedUpload, store: Store) {
  if (parsed.arrivals) {
    store.setArrivals(parsed.arrivals);
    if (!store.wHppvTouched) {
      store.setWHppvTarget(lookupWhppvBand(deriveAnnualVisits(parsed.arrivals)).medianWhppv, false);
    }
  }
  if (parsed.arrivalsP75) store.setArrivalsP75(parsed.arrivalsP75);
  if (parsed.esiMix) store.setEsiMix(parsed.esiMix);
  if (parsed.admitRate !== undefined) store.setAdmitRate(parsed.admitRate);
  if (parsed.boardingDuration !== undefined) store.setBoardingDuration(parsed.boardingDuration);
  if (parsed.monthlyMeanBoardingDurationHours) store.setMonthlyMeanBoardingDurationHours(parsed.monthlyMeanBoardingDurationHours);
  if (parsed.dayOfWeekMeanBoardingDurationHours) store.setDayOfWeekMeanBoardingDurationHours(parsed.dayOfWeekMeanBoardingDurationHours);
  if (parsed.boardingCensusMedical) store.setBoardingCensusMedical(parsed.boardingCensusMedical);
  if (parsed.boardingCensusBH) store.setBoardingCensusBH(parsed.boardingCensusBH);
  if (parsed.monthlyBoardingCensusMedical) store.setMonthlyBoardingCensusMedical(parsed.monthlyBoardingCensusMedical);
  if (parsed.monthlyBoardingCensusBH) store.setMonthlyBoardingCensusBH(parsed.monthlyBoardingCensusBH);
  if (parsed.preBedRequestCensus) store.setPreBedRequestCensus(parsed.preBedRequestCensus);
  // "Setup Decisions" tab (2026-07-27 follow-up to Part 3) — per-dataset workflow answers.
  if (parsed.boardingPath !== undefined) store.setBoardingPath(parsed.boardingPath);
  if (parsed.headcountIncludesIndirectCare !== undefined) store.setHeadcountIncludesIndirectCare(parsed.headcountIncludesIndirectCare);
  if (parsed.flexAxes) {
    store.setFlexAxis('startTimes', parsed.flexAxes.startTimes);
    store.setFlexAxis('shiftCount', parsed.flexAxes.shiftCount);
    store.setFlexAxis('shiftLengths', parsed.flexAxes.shiftLengths);
  }
  // 2026-07-28, Ben's direct ask — the two boarding nursing ratios round-trip through the
  // Setup Decisions tab now, alongside the other per-dataset workflow answers above.
  if (parsed.boardingRatioTarget !== undefined) store.setBoardingRatioTarget(parsed.boardingRatioTarget);
  if (parsed.bhBoardingRatioTarget !== undefined) store.setBhBoardingRatioTarget(parsed.bhBoardingRatioTarget);
  // 2026-07-30 — "hours per FTE," same round-trip exception as the two ratios above.
  if (parsed.fteInputMode !== undefined) store.setFteInputMode(parsed.fteInputMode);
  if (parsed.fteInputValue !== undefined) store.setFteInputValue(parsed.fteInputValue);
}
