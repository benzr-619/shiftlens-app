import type { ShiftDef } from '../engine/types';

let nextId = 1;

export function ShiftMenuEditor({ menu, onChange }: { menu: ShiftDef[]; onChange: (m: ShiftDef[]) => void }) {
  function update(id: string, patch: Partial<ShiftDef>) {
    onChange(menu.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function remove(id: string) {
    onChange(menu.filter((s) => s.id !== id));
  }
  function add() {
    onChange([...menu, { id: `shift-new-${nextId++}`, label: '', startHour: 7, lengthHours: 8 }]);
  }

  return (
    <div className="shift-menu-editor">
      {menu.map((s) => (
        <div key={s.id} className="shift-row">
          <input
            className="shift-label"
            type="text"
            placeholder="Label (optional)"
            value={s.label ?? ''}
            onChange={(e) => update(s.id, { label: e.target.value })}
          />
          <label>
            Start
            <select value={s.startHour} onChange={(e) => update(s.id, { startHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h.toString().padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          <label>
            Length (hrs)
            <input
              type="number"
              min={1}
              max={24}
              value={s.lengthHours}
              onChange={(e) => update(s.id, { lengthHours: Math.max(1, Math.min(24, Number(e.target.value))) })}
            />
          </label>
          <button type="button" className="btn-icon" onClick={() => remove(s.id)} aria-label="Remove shift">
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={add}>
        + Add shift
      </button>
    </div>
  );
}
