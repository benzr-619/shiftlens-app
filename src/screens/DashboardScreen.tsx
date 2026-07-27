import { useState } from 'react';
import { useStore } from '../store';
import { StepBar, type StepBarEntry } from '../components/StepBar';
import { Panel1 } from './dashboard/Panel1';
import { Panel2 } from './dashboard/Panel2';
import { FundingAskSection } from './dashboard/FundingAskSection';
import { FinancePartnerWorksheet } from './dashboard/FinancePartnerWorksheet';
import { ShiftMenuFlexibilitySection } from './dashboard/ShiftMenuFlexibilitySection';
import { BoardingCoverageSection } from './dashboard/BoardingCoverageSection';
import { SynthesisSection } from './dashboard/SynthesisSection';
import { EvidenceSurfaceSection } from './dashboard/EvidenceSurfaceSection';

// PR E (RESULTS_PAGE_V2_SPEC_2026-07-27.md §8) — Panels 1 and 2 now real, replacing
// `CoreGridTab`/`CurrentStaffingAnalysis` (Panel 1) and `ScenarioBSection` (Panel 2).
// `HiddenBoardingSection`, `BoardingTransition`, `ConstrainedReallocationSection` are DELETED
// (R9) — their content is absorbed into Panel 1 (hidden-boarding diagnostic) and Panel 2 (the
// combined-reallocation toggle). `ch-funding-ask`/`ch-shift-menu`/`ch-boarding`/`ch-synthesis`/
// `ch-evidence` are STILL the old architecture — PR F/G finish the migration (Panels 3/4/5),
// see .claude/rules/results-redesign.md's "Results Page V2" PR E section.
const CHAPTERS: StepBarEntry[] = [
  { id: 'ch-current-staffing', label: 'Your current staffing' },
  { id: 'ch-scenario-b', label: 'Could moving hours fix it?' },
  { id: 'ch-funding-ask', label: 'What this costs, what it buys' },
  { id: 'ch-shift-menu', label: 'Would a different shift pattern help?' },
  { id: 'ch-boarding', label: 'The second demand: boarding' },
  { id: 'ch-synthesis', label: 'Both budgets together' },
  { id: 'ch-evidence', label: 'How this works' },
];

/**
 * Single scrolling results page (no tabs). PR E of `RESULTS_PAGE_V2_SPEC_2026-07-27.md`:
 * Panel 1 ("what your department demands, and what you staff against it") and Panel 2
 * ("could moving hours fix it") are now the real five-panel architecture; everything after
 * `ch-funding-ask` is still the pre-V2 chapter architecture pending PRs F/G. See CLAUDE.md
 * Section 3/6 + .claude/rules/results-redesign.md's "Results Page V2" section.
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
          section for the full history). Deliberately NOT a `.card`/`.banner` — see
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

      {/* R10 (PR D) — StepBar replaces ChapterRail's sticky sidebar with a horizontal top bar,
          freeing full page width below for each panel's visual frame. No more `.dashboard-body`
          two-column flex — `.dashboard-content` is now the page's only column. */}
      <StepBar steps={CHAPTERS} />
      <div className="dashboard-content">
        <Panel1 />
        <Panel2 />
        <div id="ch-funding-ask">
          <FundingAskSection />
          <FinancePartnerWorksheet />
        </div>
        <div id="ch-shift-menu">
          <ShiftMenuFlexibilitySection />
        </div>
        <div id="ch-boarding">
          <BoardingCoverageSection />
        </div>
        <div id="ch-synthesis">
          <SynthesisSection />
        </div>
        <div id="ch-evidence">
          <EvidenceSurfaceSection />
        </div>
      </div>
    </div>
  );
}
