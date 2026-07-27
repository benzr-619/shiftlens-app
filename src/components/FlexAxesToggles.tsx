import { useStore } from '../store';
import type { FlexAxes } from '../engine';

const AXES: Array<{ key: keyof FlexAxes; label: string }> = [
  { key: 'startTimes', label: 'Different start times' },
  { key: 'shiftCount', label: 'A different number of shifts' },
  { key: 'shiftLengths', label: 'Different shift lengths (8s / 10s / 12s)' },
];

/**
 * The three shift-menu flexibility axes (§2.3), bound directly to the store's `flexAxes`.
 * Store-driven and shared so the SAME control appears on the shift-menu setup step (where the
 * preference is introduced, §1) and on the results page (ShiftMenuFlexibilitySection) — a
 * change in either place is the same value. Default all-off = "static": the idealized grid
 * uses the user's own menu, never a silent substitute.
 */
export function FlexAxesToggles() {
  const { flexAxes, setFlexAxis } = useStore();
  return (
    <div className="flex-axes">
      {AXES.map((a) => (
        <label key={a.key} className="flex-axis-option">
          <input type="checkbox" checked={flexAxes[a.key]} onChange={(e) => setFlexAxis(a.key, e.target.checked)} />
          <span>{a.label}</span>
        </label>
      ))}
    </div>
  );
}
