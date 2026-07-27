import { useState } from 'react';
import { useStore } from '../store';
import { ChapterRail, type ChapterRailEntry } from '../components/ChapterRail';
import { CoreGridTab } from './dashboard/CoreGridTab';
import { ScenarioBSection } from './dashboard/ScenarioBSection';
import { FundingAskSection } from './dashboard/FundingAskSection';
import { FinancePartnerWorksheet } from './dashboard/FinancePartnerWorksheet';
import { ShiftMenuFlexibilitySection } from './dashboard/ShiftMenuFlexibilitySection';
import { HiddenBoardingSection } from './dashboard/HiddenBoardingSection';
import { BoardingTransition } from './dashboard/BoardingTransition';
import { BoardingCoverageSection } from './dashboard/BoardingCoverageSection';
import { ConstrainedReallocationSection } from './dashboard/ConstrainedReallocationSection';
import { SynthesisSection } from './dashboard/SynthesisSection';
import { EvidenceSurfaceSection } from './dashboard/EvidenceSurfaceSection';

// PR H (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §8) — CHAPTER ORDER IS THE ARGUMENT'S ORDER:
// each chapter closes one possible explanation for "it feels understaffed," so the answer is
// reached by elimination. See `ChapterRail.tsx`'s header for why this list matches the ACTUAL
// top-level sections below rather than a forced 1:1 mapping onto the spec's full 9-chapter
// ideal (several spec chapters are still bundled inside the one monolithic `CoreGridTab`).
const CHAPTERS: ChapterRailEntry[] = [
  { id: 'ch-current-staffing', label: 'Your current staffing' },
  { id: 'ch-scenario-b', label: 'Could moving hours fix it?' },
  { id: 'ch-funding-ask', label: 'What this costs, what it buys' },
  { id: 'ch-shift-menu', label: 'Would a different shift pattern help?' },
  { id: 'ch-boarding', label: 'The second demand: boarding' },
  { id: 'ch-synthesis', label: 'Both budgets together' },
  { id: 'ch-evidence', label: 'How this works' },
];

/**
 * Single scrolling results page (no tabs) — order follows the redesign narrative: current-
 * staffing analysis + idealized comparison + wHPPV/heatmap (CoreGridTab), then Scenario B
 * ("the same hours, better placed" — PR F, RESULTS_COMPREHENSION_SPEC_2026-07-26.md §5, the
 * only scenario with no ask attached), then the funding-ask surface (§ PR D change 3 — "what
 * does closing the gap buy," full coverage vs. what delivering the target costs) + the
 * finance-partner worksheet (PR G), then the shift-menu flexibility section (§2.3, "is this
 * menu as good as it could be" — absorbed the old Compare tab), then the hidden-boarding
 * diagnostic + the short boarding-transition bridge (§2.5) + the additive boarding coverage
 * recommendation, then the synthesis chapter (PR G, "both budgets together" — THE ANSWER). See
 * CLAUDE.md Section 3/6 + .claude/rules/results-redesign.md. PR H added the sticky chapter rail
 * (`ChapterRail`) — each `<div id="...">` wrapper below is a scroll-spy/jump target; the id
 * list and `CHAPTERS` above must stay in sync.
 */
export function DashboardScreen() {
  const { setScreen, getResult, buildEngineInputs, currentStaffingGrid, wHppvTarget } = useStore();
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      // Dynamic import — pptxgenjs is a large dependency (~400KB) needed only when a user
      // actually clicks "Export"; keeping it out of the main bundle is a cheap, low-risk win.
      const { exportResultsToPptx } = await import('../lib/pptxExport');
      await exportResultsToPptx({
        result: getResult(),
        inputs: buildEngineInputs(),
        currentStaffingGrid: currentStaffingGrid ?? {},
        wHppvTarget,
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="screen dashboard-screen">
      {/* Top-left, above everything else on the page — the one navigational escape hatch off
          this screen. The "ShiftLens — Results" <h1> that used to sit here was retired
          2026-07-27: `.results-welcome` below already opens with "Welcome to the Results
          Page," so a second page title right above it was pure duplication. */}
      <div className="dashboard-topbar">
        <button className="btn-link" onClick={() => setScreen('setup')}>
          ← Back to setup
        </button>
        <div className="dashboard-topbar-actions">
          {/* PR L (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §9) — client-side PPTX export,
              nothing uploaded anywhere. Slide titles pull from src/lib/narrative.ts, the SAME
              functions/wording the page itself uses — see pptxExport.ts's header. */}
          <button className="btn-secondary" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export to PPTX'}
          </button>
        </div>
      </div>

      {/* PR H (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §6.1/§8) — THE WELCOME/ORIENTATION
          SECTION, FIFTH revision (2026-07-27, see .claude/rules/results-redesign.md's PR H
          section for the full history). Rendered here, ABOVE `.dashboard-body`, so it spans
          the full page width rather than being confined to `.dashboard-content`'s column
          (which is narrowed by the chapter rail sitting beside it) — moved up from inside
          `CoreGridTab.tsx` for exactly this reason. Deliberately NOT a `.card`/`.banner` — see
          `.results-welcome`'s own CSS comment in App.css. Reuses the SAME `/favicon.svg` mark
          `WelcomeScreen.tsx` uses, at a smaller size, next to the heading — the one piece of
          product branding on this screen, since the retired top `<h1>ShiftLens — Results</h1>`
          left the results page with none. */}
      <section className="results-welcome">
        <div className="results-welcome-header">
          <img src="/favicon.svg" alt="" className="results-welcome-icon" />
          <h2>Your ShiftLens Results</h2>
        </div>
        <p>
          ShiftLens splits nurse staffing into two separate budgets: one for ED patients, one for boarding
          patients. For ED patients, most of a nurse's workload lands upfront at arrival. For boarders, workload
          is budgeted using inpatient nursing ratios instead. We believe this split gives a clearer picture of how
          nursing time is actually being consumed, and makes it easier to communicate when and why your staffing
          falls short. Your ED might normally lump these together — if so, the arrivals-only schedule below may
          look leaner than you're expecting. Boarding gets its own coverage plan further down the page, and the
          two are added back together at the end.
        </p>
      </section>

      <div className="dashboard-body">
        <ChapterRail chapters={CHAPTERS} />
        <div className="dashboard-content">
          <div id="ch-current-staffing">
            <CoreGridTab />
          </div>
          <div id="ch-scenario-b">
            <ScenarioBSection />
          </div>
          <div id="ch-funding-ask">
            <FundingAskSection />
            <FinancePartnerWorksheet />
          </div>
          <div id="ch-shift-menu">
            <ShiftMenuFlexibilitySection />
          </div>
          <div id="ch-boarding">
            <HiddenBoardingSection />
            <BoardingTransition />
            <BoardingCoverageSection />
            <ConstrainedReallocationSection />
          </div>
          <div id="ch-synthesis">
            <SynthesisSection />
          </div>
          <div id="ch-evidence">
            <EvidenceSurfaceSection />
          </div>
        </div>
      </div>
    </div>
  );
}
