import { DAY_LABELS } from '../engine/types';

/** Editable hour x day-of-week grid — the touch-up tool layered on top of a template upload. */
export function ArrivalsGrid({ arrivals, onChange }: { arrivals: number[]; onChange: (next: number[]) => void }) {
  const max = Math.max(1, ...arrivals);

  function setCell(day: number, hour: number, value: number) {
    const next = arrivals.slice();
    next[day * 24 + hour] = Math.max(0, value);
    onChange(next);
  }

  return (
    <div className="arrivals-grid-wrap">
      <table className="arrivals-grid">
        <thead>
          <tr>
            <th className="hour-col">Hour</th>
            {DAY_LABELS.map((d) => (
              <th key={d}>{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 24 }, (_, hour) => (
            <tr key={hour}>
              <td className="hour-col">{hour.toString().padStart(2, '0')}:00</td>
              {DAY_LABELS.map((_, day) => {
                const v = arrivals[day * 24 + hour];
                const intensity = v / max;
                return (
                  <td key={day} style={{ backgroundColor: `rgba(99,102,241,${0.08 + intensity * 0.5})` }}>
                    <input
                      type="number"
                      min={0}
                      value={v || ''}
                      placeholder="0"
                      onChange={(e) => setCell(day, hour, Number(e.target.value))}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
