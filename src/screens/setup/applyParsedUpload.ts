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
  if (parsed.esiMix) store.setEsiMix(parsed.esiMix);
  if (parsed.admitRate !== undefined) store.setAdmitRate(parsed.admitRate);
  if (parsed.boardingDuration !== undefined) store.setBoardingDuration(parsed.boardingDuration);
  if (parsed.monthlyMeanBoardingDurationHours) store.setMonthlyMeanBoardingDurationHours(parsed.monthlyMeanBoardingDurationHours);
  if (parsed.dayOfWeekMeanBoardingDurationHours) store.setDayOfWeekMeanBoardingDurationHours(parsed.dayOfWeekMeanBoardingDurationHours);
}
