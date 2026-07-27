// R7 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §2) — "severity" is removed from the UI entirely; it
// remains the solver's internal objective. The engine function itself is still `severity` (an
// internal identifier, unchanged) — aliased on import so the word never appears bare in this
// file's source, and every user-facing label below says "queue cost" instead.
import { severity as computeQueueCost } from '../engine/solver';

// Same 10 nurse-hours of shortfall, two different shapes — a fixed baseline requirement of 10
// nurse-hours/hour for both scenarios, so the only difference between them is HOW the same
// total shortfall is distributed across hours.
const REQUIREMENT_PER_HOUR = 10;
const SPREAD_BACKLOG_PER_HOUR = [2.5, 2.5, 2.5, 2.5]; // 4 hours short by 2.5 each = 10 total
const CONCENTRATED_BACKLOG_PER_HOUR = [10]; // 1 hour short by 10 = 10 total

function scenarioQueueCost(backlogPerHour: number[]): { perHour: number[]; total: number } {
  const perHour = backlogPerHour.map((b) => computeQueueCost(b, REQUIREMENT_PER_HOUR));
  return { perHour, total: perHour.reduce((a, b) => a + b, 0) };
}

/**
 * PR J (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §8, teaching layer) — THE ONE interactive.
 * Convexity is the least intuitive and most load-bearing concept on the page (it's literally
 * the Step 3 trim's objective) and prose does it badly. Uses the REAL `severity` function from
 * `engine/solver.ts` (aliased to `computeQueueCost` — see the import comment) — not a mock —
 * so the numbers shown here are exactly what the solver itself would compute for these two
 * shapes, displayed under the user-facing name "queue cost" per R7.
 */
export function ConvexityDemo() {
  const spread = scenarioQueueCost(SPREAD_BACKLOG_PER_HOUR);
  const concentrated = scenarioQueueCost(CONCENTRATED_BACKLOG_PER_HOUR);
  const maxBar = Math.max(spread.total, concentrated.total, 1);

  return (
    <div className="convexity-demo">
      <div className="convexity-scenario">
        <h4>4 hours, 2.5 short each</h4>
        <div className="convexity-bars">
          {spread.perHour.map((s, i) => (
            <div key={i} className="convexity-bar-track" title={`Hour ${i + 1}: queue cost ${s.toFixed(3)}`}>
              <div className="convexity-bar" style={{ height: `${Math.min(100, (s / maxBar) * 100 * spread.perHour.length)}%` }} />
            </div>
          ))}
        </div>
        <p className="convexity-total">
          Total queue cost: <strong>{spread.total.toFixed(3)}</strong>
        </p>
      </div>
      <div className="convexity-scenario">
        <h4>1 hour, 10 short</h4>
        <div className="convexity-bars">
          {concentrated.perHour.map((s, i) => (
            <div key={i} className="convexity-bar-track" title={`Hour ${i + 1}: queue cost ${s.toFixed(3)}`}>
              <div className="convexity-bar" style={{ height: `${Math.min(100, (s / maxBar) * 100)}%` }} />
            </div>
          ))}
        </div>
        <p className="convexity-total">
          Total queue cost: <strong>{concentrated.total.toFixed(3)}</strong>
        </p>
      </div>
      <p className="wHPPV-caveat">
        Same 10 nurse-hours of shortfall, same 10 nurse-hour requirement baseline — spread across 4 hours vs.
        concentrated in 1. The concentrated version scores {(concentrated.total / Math.max(spread.total, 1e-9)).toFixed(1)}×
        higher on the same scale the Step 3 trim minimizes — which is why the solver protects a deep hole over
        several shallow ones, even at equal total nurse-hours.
      </p>
    </div>
  );
}
