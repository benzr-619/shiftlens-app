// Shared per-shift headcount breakdown builder — pulled out of `Panel1.tsx` (2026-07-28,
// Panel 2 heatmap rework) once Panel 2 became a second consumer, same convention as
// `lib/queuePattern.ts`/`lib/dayOrder.ts`/`lib/averageDay.ts`.
import type { Grid, ShiftDef } from '../engine/types';
import { coveringCellsByGlobalHour } from '../engine/solver';

/** For every global hour, the per-shift headcount breakdown (ordered by startHour) of
 * whichever grid cells structurally cover it, reusing `coveringCellsByGlobalHour` (the same
 * attribution convention as everywhere else in this app). */
export function buildPerShiftBreakdown(shiftMenu: ShiftDef[], grid: Grid): Array<Array<{ label: string; headcount: number }>> {
  const covering = coveringCellsByGlobalHour(shiftMenu);
  const shiftById = new Map(shiftMenu.map((s) => [s.id, s]));
  return covering.map((covers) =>
    covers
      .map(({ day, shiftId }) => {
        const shift = shiftById.get(shiftId);
        return { label: shift?.label || shiftId, headcount: grid[day]?.[shiftId] ?? 0, startHour: shift?.startHour ?? 0 };
      })
      .sort((a, b) => a.startHour - b.startHour)
      .map(({ label, headcount }) => ({ label, headcount }))
  );
}
