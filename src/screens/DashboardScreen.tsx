import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { StepBar, type StepBarEntry } from '../components/StepBar';
import { Panel1 } from './dashboard/Panel1';
import { Panel2 } from './dashboard/Panel2';
import { Panel3 } from './dashboard/Panel3';
import { Panel4 } from './dashboard/Panel4';
import { Panel5 } from './dashboard/Panel5';
import { EvidenceSurfaceSection } from './dashboard/EvidenceSurfaceSection';

// PR G (RESULTS_PAGE_V2_SPEC_2026-07-27.md §8) — Panel 5 (the sandbox) lands, completing the
// five-panel architecture (§4) in full. `EvidenceSurfaceSection` stays exactly where it is,
// unmodified — off the main arc, below everything, protecting the tool when a number is
// challenged. See .claude/rules/results-redesign.md's "Results Page V2" PR G section.
const CHAPTERS: StepBarEntry[] = [
  { id: 'ch-current-staffing', label: 'Your current staffing' },
  { id: 'ch-scenario-b', label: 'Could moving hours fix it?' },
  { id: 'ch-full-coverage', label: 'What would full coverage take?' },
  { id: 'ch-recommended', label: 'ShiftLens Idealized Staffing' },
  { id: 'ch-sandbox', label: 'Test it yourself' },
  { id: 'ch-evidence', label: 'How this works' },
];

/**
 * Single scrolling results page (no tabs). All five panels of `RESULTS_PAGE_V2_SPEC_2026-07-
 * 27.md` §4 are now live. See CLAUDE.md Section 3/6 + .claude/rules/results-redesign.md's
 * "Results Page V2" section.
 */
export function DashboardScreen() {
  const {
    setScreen,
    getResult,
    buildEngineInputs,
    currentStaffingGrid,
    wHppvTarget,
    arrivals,
    shiftMenu,
    sandboxEdGrid,
    sandboxHoldGrid,
  } = useStore();
  const [exporting, setExporting] = useState(false);

  // The screen switch in App.tsx is a plain conditional render with no route/scroll reset, so
  // without this the dashboard mounts at whatever scroll position setup's Review step left the
  // page at — landing near Panel 1 instead of the welcome banner at the top of this screen.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

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
        arrivals,
        shiftMenu,
        sandboxEdGrid,
        sandboxHoldGrid,
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
          Page," so a second page title right above it was pure duplication. R12 (PR H,
          RESULTS_PAGE_V2_SPEC_2026-07-27.md §7): "Export to PPTX" MOVED out of this topbar,
          down to the bottom of the page, after Panel 5 — you export after testing your own
          scenario, not before you've read anything. */}
      <div className="dashboard-topbar">
        <button className="btn-link" onClick={() => setScreen('setup')}>
          ← Back to setup
        </button>
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
        <Panel3 />
        <Panel4 />
        <Panel5 />

        {/* R12 — export lives here now, below the sandbox: the deck's scope (title -> current
            staffing -> the sandbox scenario just above -> the delta -> Method & Limitations,
            §7) only makes sense once a scenario actually exists to export. */}
        <div className="export-row">
          <button className="btn-secondary" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export to PPTX'}
          </button>
        </div>

        <div id="ch-evidence">
          <EvidenceSurfaceSection />
        </div>
      </div>
    </div>
  );
}
