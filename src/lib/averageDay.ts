// Split out of components/VisualFrame.tsx (same reasoning as lib/whppvColorDomain.ts's own
// header note) — a component file that exports a non-component function trips oxlint's
// react(only-export-components) fast-refresh rule.

/** Mean across the 7 days at each hour-of-day — 168 values in, 24 out. Used by `VisualFrame`
 * for its default "average day" view (§4) and by panels needing the same reduction (e.g. the
 * late-ramp sentence, §3.2), so there's exactly one copy of this arithmetic. */
export function averageDay(values168: number[]): number[] {
  const out = new Array(24).fill(0);
  for (let hour = 0; hour < 24; hour++) {
    let sum = 0;
    for (let day = 0; day < 7; day++) sum += values168[day * 24 + hour] ?? 0;
    out[hour] = sum / 7;
  }
  return out;
}
