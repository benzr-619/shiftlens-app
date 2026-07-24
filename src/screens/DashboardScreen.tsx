import { useStore } from '../store';
import { CoreGridTab } from './dashboard/CoreGridTab';
import { BoardingTransition } from './dashboard/BoardingTransition';
import { BoardingCoverageSection } from './dashboard/BoardingCoverageSection';
import { CompareTab } from './dashboard/CompareTab';

/**
 * Single scrolling results page (no tabs) — order follows the redesign narrative: current-
 * staffing analysis + idealized comparison + wHPPV/heatmap (CoreGridTab), then the short
 * boarding-transition bridge (§2.5), then the additive boarding coverage recommendation, then
 * shift-menu comparison at the bottom. See CLAUDE.md Section 3/6 + .claude/rules/results-redesign.md.
 */
export function DashboardScreen() {
  const { setScreen } = useStore();

  return (
    <div className="screen dashboard-screen">
      <div className="dashboard-topbar">
        <h1>ShiftLens — Results</h1>
        <button className="btn-link" onClick={() => setScreen('setup')}>
          ← Back to setup
        </button>
      </div>

      <CoreGridTab />
      <BoardingTransition />
      <BoardingCoverageSection />
      <CompareTab />
    </div>
  );
}
