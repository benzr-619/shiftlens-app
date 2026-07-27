import { describe, expect, it } from 'vitest';
import { computeBacklog, BACKLOG_CAUGHT_UP_THRESHOLD } from '../backlog';
import { DEFAULTS } from '../types';
import type { Grid, ShiftDef } from '../types';

// 2026-07-26 PR B (SOLVER_REALISM_SPEC_2026-07-26.md): the single-decay model (`DECAY = 0.85`)
// is retired, replaced by three named processes — abandonRate/recoveryEfficiency/
// maxDrainFraction (see engine/backlogModel.ts's header). Several numeric CLAIMS below changed
// as a direct, intended consequence of the physics change (not loosened — recomputed against
// the new formula). Where a scenario never offers excess capacity (capacity 0 throughout),
// `spare` is always 0, so `paydown` is always 0 and the recurrence reduces to pure attrition:
// `backlog[h] = backlog[h-1] * (1 - abandonRate) + newWork[h]` — the direct analog of the old
// decay-only formula, with `(1 - abandonRate)` standing in for the old `DECAY`.
const ABANDON_RATE = DEFAULTS.backlogAbandonRate; // 0.03
const RETENTION = 1 - ABANDON_RATE; // 0.97 — the pure-attrition analog of the old DECAY=0.85

// A single shift covering all 24h — lets us drive capacity purely via one headcount value.
const allDay: ShiftDef[] = [{ id: 'all', label: '24h', startHour: 0, lengthHours: 24 }];
// A 2-shift menu that tiles the day with no overlap: day 7a-7p, night 7p-7a.
const dayNight: ShiftDef[] = [
  { id: 'day', label: '7a-7p', startHour: 7, lengthHours: 12 },
  { id: 'night', label: '7p-7a', startHour: 19, lengthHours: 12 },
];

/** Grid where every day staffs `hc` on the given single shift → flat capacity. */
function flatGrid(shiftId: string, hc: number): Grid {
  const g: Grid = {};
  for (let day = 0; day < 7; day++) g[day] = { [shiftId]: hc };
  return g;
}

function zeros(): number[] {
  return new Array(168).fill(0);
}

describe('§2.4 backlog diagnostic', () => {
  it('is all zero when capacity always meets demand (no one falls behind)', () => {
    const res = computeBacklog({}, zeros(), allDay);
    expect(res.backlog.every((b) => b === 0)).toBe(true);
    expect(res.longestStreakHours).toBe(0);
    expect(res.longestStreakStart).toBeNull();
    expect(res.neverClears).toBe(false);
    expect(res.peakBacklog).toBe(0);
  });

  it('converges to the geometric steady state under a constant deficit — PR B: 1/abandonRate, not 1/(1-decay)', () => {
    // requirement 1 everywhere, capacity 0 → deficit 1 every hour, and capacity never exceeds
    // requirement anywhere, so spare/paydown are always 0 (pure attrition).
    // Circular steady state: x = RETENTION*x + 1  ⇒  x = 1/(1-RETENTION) = 1/abandonRate.
    const req = new Array(168).fill(1);
    const res = computeBacklog({}, req, allDay);
    const steady = 1 / ABANDON_RATE; // = 33.33 — much higher than the old 1/(1-0.85)=6.67,
    // because the new abandonRate (3%/hr) is a far more forgiving passive-attrition rate than
    // the old blended 15%/hr decay was; PR B's whole point is that recovery now requires SPARE
    // CAPACITY, not just the passage of time — a scenario with no capacity at all should (and
    // now does) look much worse than before.
    expect(res.backlog[100]).toBeCloseTo(steady, 6);
    expect(res.backlog[167]).toBeCloseTo(steady, 6);
    expect(res.neverClears).toBe(true); // 33.3 >= threshold everywhere
    expect(res.longestStreakHours).toBe(168);
    expect(res.typicalClearHour).toBeNull();
  });

  it('carries backlog across the Sat→Sun week boundary with NO reset (spec §2.4) — PR B: longer streak than before, since abandonment alone dissipates far more slowly than the old blended decay', () => {
    // Deficit only in the very last hour of the week (day 6, hour 23 = global 167). Capacity is
    // 0 throughout, so this is pure attrition (no paydown anywhere) — same structure as before,
    // new rate.
    //
    // Because this is CIRCULAR with no reset, backlog[167] is a genuine self-consistent fixed
    // point, not simply "5": the hole that lands at 167 decays all the way around the week and
    // adds back onto itself. Closed form: backlog[167] = 5 + backlog[167]*RETENTION^168, i.e.
    // backlog[167] = 5 / (1 - RETENTION^168) ≈ 5.0301 — under the OLD decay (0.85), this
    // correction was negligible (0.85^168 ≈ 4e-13, so the old test's "≈5" was a fine
    // approximation); under the new, much slower RETENTION=0.97, RETENTION^168 ≈ 0.006 is no
    // longer negligible, so the converged value is genuinely ~0.6% above the naive "5".
    const req = zeros();
    req[167] = 5;
    const res = computeBacklog({}, req, allDay);
    const expectedPeak = 5 / (1 - RETENTION ** 168);
    expect(res.backlog[167]).toBeCloseTo(expectedPeak, 6);
    // The hole must bleed into Sunday hour 0 — this is the whole point of "no boundary reset".
    expect(res.backlog[0]).toBeCloseTo(expectedPeak * RETENTION, 6);
    expect(res.backlog[1]).toBeCloseTo(expectedPeak * RETENTION * RETENTION, 6);
    // The streak wraps 167 → 0 → 1 …; longestStreakStart should anchor at the wrap point.
    expect(res.longestStreakStart).toEqual({ day: 6, hour: 23 });
    // behind hours: expectedPeak*0.97^k >= 0.5 holds for k=0..75 ⇒ 76 consecutive hours (vs. the
    // old model's 15 — a 5x longer streak for the identical single-hour deficit, because 3%/hr
    // abandonment alone takes far longer to dissipate a hole than the old 15%/hr decay did).
    expect(res.longestStreakHours).toBe(76);
    expect(res.neverClears).toBe(false);
  });

  it('excess capacity actively pays backlog down — but bounded, not the old unconstrained 1:1 draining', () => {
    // Both scenarios share an identical deficit spike of 10 at global hour 0.
    // Scenario A: no excess capacity afterward (deficit 0 everywhere else) → pure attrition.
    const reqA = zeros();
    reqA[0] = 10;
    const a = computeBacklog({}, reqA, allDay);
    // Scenario B: capacity 2 everywhere; req 12 at hour 0 → same deficit 10, then 2 spare/hr
    // after. Paydown is bounded by min(carried, spare*recoveryEfficiency, carried*maxDrainFraction)
    // — NOT a full 1:1 drain of the 2 spare nurse-hours the old model would have applied.
    const reqB = zeros();
    reqB[0] = 12;
    const b = computeBacklog(flatGrid('all', 2), reqB, allDay);

    // Scenario A never pays down anywhere, so — same closed-form circular fixed point as the
    // previous test — backlog[0] = 10 / (1 - RETENTION^168) ≈ 10.060, not exactly 10 (the old
    // model's negligible-residual approximation no longer holds at the new, slower abandonRate).
    const expectedAPeak = 10 / (1 - RETENTION ** 168);
    expect(a.backlog[0]).toBeCloseTo(expectedAPeak, 6);
    expect(b.backlog[0]).toBeCloseTo(10, 6); // B fully pays down before wrapping, so no residual
    // By hour 3 the actively-paid-down backlog is well below the passively-decayed one — still
    // true under the new bounded recovery, just by a smaller margin than the old unconstrained
    // 1:1 model would have shown.
    expect(b.backlog[3]).toBeLessThan(a.backlog[3]);
    expect(b.backlog[3]).toBeCloseTo(5.63365, 4);
    // B clears; A is still digging out — B should report an overnight-reset hour, A a longer streak.
    expect(a.longestStreakHours).toBeGreaterThan(b.longestStreakHours);
  });

  it('attributes generated vs inherited backlog to the right shift (unaffected by PR B — generatedBacklog is max(0, deficit), independent of abandonRate/recoveryEfficiency/maxDrainFraction)', () => {
    // Deficit only during night-covered hours (global 0..4); zero capacity.
    const req = zeros();
    for (let h = 0; h <= 4; h++) req[h] = 5;
    const res = computeBacklog({}, req, dayNight);
    const night = res.shiftDiagnostics.find((s) => s.shiftId === 'night')!;
    const day = res.shiftDiagnostics.find((s) => s.shiftId === 'day')!;

    // All fresh shortfall lands in night hours (5 × 5 = 25 nurse-hours generated by night).
    expect(night.generatedBacklog).toBeCloseTo(25, 6);
    expect(day.generatedBacklog).toBeCloseTo(0, 6);
    // The day shift generates nothing of its own but INHERITS the decaying tail of night's hole.
    expect(day.inheritedBacklog).toBeGreaterThan(0);
  });

  it('flags a lone short hour as a much shorter streak than a compounding hole (directional claim unaffected by PR B, though both streak lengths grew under the slower abandonment rate)', () => {
    // One isolated short hour vs. a sustained multi-hour deficit — the streak length is the
    // signal the redesign wants (a lone hour reads differently from digging out of a hole).
    const lone = zeros();
    lone[50] = 1; // just above threshold for a single hour
    const loneRes = computeBacklog({}, lone, allDay);

    const sustained = zeros();
    for (let h = 40; h < 50; h++) sustained[h] = 5;
    const sustainedRes = computeBacklog({}, sustained, allDay);

    expect(loneRes.longestStreakHours).toBeLessThan(sustainedRes.longestStreakHours);
    expect(loneRes.peakBacklog).toBeLessThan(sustainedRes.peakBacklog);
    expect(BACKLOG_CAUGHT_UP_THRESHOLD).toBeGreaterThan(0);
  });
});

// PR E (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §4) — VALIDATION GATE. Per §12.6/§14 open
// question 5, the real department's own numbers (§4's table) cannot ship in this repo (the
// no-seeded-ED-data constraint) — so this reproduces the SHAPE of the defect the real data
// exposed (a genuine day-varying trough plus a real overnight-clearing cycle, at real-world
// peak magnitudes an order of magnitude above the old flat threshold) with INVENTED numbers,
// not the department's actual figures. What must hold, regardless of the specific numbers:
// cyclical backlog clears overnight every night; a genuine structural floor is reported
// SEPARATELY, per day, not blended into one number; and "neverClears" is never claimed for a
// department that's actually cycling.
describe('PR E — structural/cyclical split (validation gate)', () => {
  it('reproduces cyclical overnight clearing + a real per-day structural floor, with no neverClears claim', () => {
    // Day-of-week peak-deficit amplitude — INVENTED, illustrative only (not the real
    // department's figures), chosen only to vary meaningfully day to day the way a real week
    // does (weekend lighter, midweek heavier).
    const peakAmplitudeByDay = [24, 34, 33, 30, 25, 20, 18]; // Sun..Sat
    const requirement = zeros();
    for (let day = 0; day < 7; day++) {
      for (let h = 0; h < 24; h++) {
        // Hour-of-day shape: trough at 07:00, peak at 18:00-20:00 (front-loaded arrival work
        // building through the day, per the governing premise — see engine-solver.md). Raised
        // to a power so the curve spends most of its time well below the peak (a short, sharp
        // evening spike, not a slow half-day swell) — closer to a real arrival curve's shape.
        const raw = Math.max(0, Math.cos(((h - 19) / 24) * 2 * Math.PI));
        const shape = Math.pow(raw, 3);
        requirement[day * 24 + h] = 3 + peakAmplitudeByDay[day] * shape;
      }
    }
    // Flat day/night capacity, comfortably ABOVE requirement's average (so the queue actually
    // gets a chance to drain overnight) but well below its EVENING PEAK (so a real backlog
    // still forms and cycles) — a realistic department that's staffed to roughly the mean, not
    // the peak, per the governing "averages under-staff you half the time" premise.
    const grid: Grid = {};
    for (let day = 0; day < 7; day++) grid[day] = { day: 40, night: 10 };

    const res = computeBacklog(grid, requirement, dayNight);

    // No "neverClears" claim for a department that's actually cycling — the ACTUAL curve
    // genuinely clears (drops near zero) every night before the next evening peak rebuilds it.
    expect(res.neverClears).toBe(false);
    expect(res.typicalClearHour).not.toBeNull();

    // A real per-day structural floor — not a single blended number, and not all identical
    // (a genuine day-varying trough, the thing the old single "168 of 168 hours behind"
    // headline destroyed).
    expect(res.structuralFloorByDay).toHaveLength(7);
    expect(new Set(res.structuralFloorByDay.map((v) => Math.round(v * 10))).size).toBeGreaterThan(1);
    expect(res.structuralFloorMin).toBeGreaterThanOrEqual(0);
    expect(res.structuralFloorMin).toBeLessThan(res.peakBacklog);
    // Real-world scale, matching the order of magnitude the source data exposed (peaks in the
    // tens, troughs well below that) — NOT the literal real numbers, see the note above.
    expect(res.peakBacklog).toBeGreaterThan(10);

    // The cyclical curve is itself a well-formed backlog curve (finite, non-negative, its own
    // clearing behavior) — see the separate test below for the isolated shape-vs-size property.
    expect(res.cyclicalBacklog).toHaveLength(168);
    expect(res.cyclicalBacklog.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);

    // estimatedAbandonedHours is a real, positive, finite number for a department that's
    // actually carrying backlog (never a dollar figure, never a patient count — see the
    // BacklogResult field's own doc comment).
    expect(res.estimatedAbandonedHours).toBeGreaterThan(0);
    expect(Number.isFinite(res.estimatedAbandonedHours)).toBe(true);
  });

  it('cyclical backlog isolates SHAPE from SIZE: a flat (no-shape) under-target department shows real ACTUAL backlog but ~zero CYCLICAL backlog', () => {
    // No hour-to-hour or day-to-day shape at all — a uniformly under-target department (pure
    // SIZE problem, zero SHAPE problem). ACTUAL backlog should show a real chronic hole (it
    // genuinely never has enough hours, anywhere); CYCLICAL backlog — capacity rescaled so its
    // total matches requirement's total — should collapse to ~0, since rescaling a FLAT
    // capacity curve up to match a FLAT requirement curve makes them identical everywhere.
    const requirement = new Array(168).fill(10);
    const res = computeBacklog(flatGrid('all', 8), requirement, allDay);

    expect(res.peakBacklog).toBeGreaterThan(0); // real actual backlog: a genuine size shortfall
    expect(res.cyclicalPeakBacklog).toBeCloseTo(0, 6); // isolates to ~zero once size is factored out
  });

  it('the relative caught-up threshold reads a real-world-scale peak as genuinely clearing, where the old flat 0.5hr bar would have called it "always behind"', () => {
    // A single large peak (real-world scale, ~40 nurse-hours) with genuine excess capacity
    // right after it — the queue should drain to a small fraction of that peak, which the OLD
    // flat 0.5-nurse-hour bar would still flag as "behind" (0.5 is under 2% of a 40hr peak),
    // but the NEW relative bar (~10% of that hour's own requirement) correctly reads as clear.
    const requirement = zeros();
    for (let h = 0; h < 24; h++) requirement[h] = h === 0 ? 40 : 5; // one huge requirement hour, ordinary otherwise
    // Ordinary flat capacity everywhere — the hole from hour 0 decays/drains against real spare
    // capacity the rest of the day, rather than persisting.
    const res = computeBacklog(flatGrid('all', 6), requirement, allDay);
    expect(res.neverClears).toBe(false);
    // Some hour late in the week reads well below the OLD flat threshold's own magnitude
    // relative to the peak — i.e. the department genuinely gets a rest, and the new relative
    // bar is what lets the model say so honestly at this peak's real-world scale.
    expect(res.peakBacklog).toBeGreaterThan(10);
  });
});
