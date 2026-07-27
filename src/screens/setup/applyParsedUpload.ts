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
  if (parsed.indirectCareUpliftPct !== undefined) store.setIndirectCareUpliftPct(parsed.indirectCareUpliftPct);
  if (parsed.flexAxes) {
    store.setFlexAxis('startTimes', parsed.flexAxes.startTimes);
    store.setFlexAxis('shiftCount', parsed.flexAxes.shiftCount);
    store.setFlexAxis('shiftLengths', parsed.flexAxes.shiftLengths);
  }
}
