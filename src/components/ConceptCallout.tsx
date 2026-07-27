import { useState, type ReactNode } from 'react';

/**
 * PR J (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §8, teaching layer) — a single reusable
 * concept explainer. REUSES the existing `.why-toggle`/`.why-explainer` disclosure pattern
 * (CLAUDE.md Section 6's "collapsed-by-default why explainer" convention) rather than inventing
 * a second idiom — collapsed by default so a returning user isn't re-taught something they
 * already read. Each concept should appear exactly ONCE, at its first use in the chapter order
 * — see the per-section usages (`CoreGridTab.tsx`, `ScenarioBSection.tsx`,
 * `HiddenBoardingSection.tsx`) for where each of the six concepts lives.
 */
export function ConceptCallout({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="concept-callout">
      <button type="button" className="btn-link why-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? `Hide: ${title}` : `What's "${title}"?`}
      </button>
      {open && <div className="why-explainer">{children}</div>}
    </div>
  );
}
