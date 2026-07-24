import { useMemo } from 'react';
import { useStore } from '../store';
import { DAY_LABELS } from '../engine/types';
import type { ShiftDef } from '../engine/types';

/** Shift-menu columns render in startHour order, not upload/creation order — a mid-shift
 * must sit between Day and Night rather than tacking onto the end. Mirrors
 * sortShiftsByStartHour() in CoreGridTab.tsx (same convention, see CLAUDE.md Section 6). */
function sortByStartHour(shifts: ShiftDef[]): ShiftDef[] {
  return [...shifts].sort((a, b) => a.startHour - b.startHour);
}

/**
 * The editable "what are you actually staffing today" grid (day × shift-menu column),
 * bound directly to the store's `currentStaffingGrid` / `setCurrentStaffingCell`.
 *
 * Deliberately store-driven and self-contained so the SAME grid can be rendered from two
 * entry points — the shift-menu setup step (where it's introduced, per redesign spec
 * Section 1) and the results page (CoreGridTab, where the diff-vs-idealized lives) — with
 * zero chance of the two drifting in shape or interaction. It reads/writes the shared
 * `currentStaffingGrid`, so an edit in either place is the same underlying value.
 *
 * Starts blank (`currentStaffingGrid` is `null` until the user types) and is never seeded
 * from the idealized `result.grid` — this is a comparison grid, not a `gridOverride` edit
 * on the recommendation. See CLAUDE.md Section 6's store-shape rule.
 */
export function CurrentStaffingGrid() {
  const { shiftMenu, currentStaffingGrid, setCurrentStaffingCell } = useStore();
  const sortedShiftMenu = useMemo(() => sortByStartHour(shiftMenu), [shiftMenu]);

  return (
    <div className="staffing-grid-wrap">
      <table className="staffing-grid">
        <thead>
          <tr>
            <th>Day</th>
            {sortedShiftMenu.map((s) => (
              <th key={s.id}>
                {s.label || s.id} ({s.startHour.toString().padStart(2, '0')}:00, {s.lengthHours}h)
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAY_LABELS.map((label, day) => (
            <tr key={day}>
              <td className="day-cell">{label}</td>
              {sortedShiftMenu.map((s) => (
                <td key={s.id}>
                  <input
                    type="number"
                    min={0}
                    value={currentStaffingGrid?.[day]?.[s.id] ?? 0}
                    onChange={(e) => setCurrentStaffingCell(day, s.id, Number(e.target.value))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
