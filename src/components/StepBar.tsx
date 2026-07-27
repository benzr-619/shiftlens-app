import { useEffect, useRef, useState } from 'react';

export interface StepBarEntry {
  id: string;
  label: string;
}

/**
 * R10 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §2/§6) — REPLACES `ChapterRail.tsx` (the sticky
 * left-side vertical rail from PR H, `RESULTS_COMPREHENSION_SPEC_2026-07-26.md` §8). Same
 * scroll-spy/click-to-jump behavior, reused verbatim — only the layout changed, from a
 * vertical sidebar to a slim horizontal bar pinned to the top of the results page, freeing
 * full page width for the visual frame each panel repeats (§4's "words left, one fixed visual
 * frame on the right" — a sidebar rail was actively competing with that frame for width).
 *
 * SCOPE NOTE (carried over from `ChapterRail`, still true): `steps` is passed in by
 * `DashboardScreen`, not decided here — this component only renders and tracks whichever list
 * it's given. Mid-migration (PR D onward), that list may still be the OLD 7-chapter set until
 * PRs E/F/G land the five real panels and shrink it down to exactly 5 — see
 * `.claude/rules/results-redesign.md`'s "Results Page V2" section for which PR did the shrink.
 */
export function StepBar({ steps }: { steps: StepBarEntry[] }) {
  const [activeId, setActiveId] = useState<string | null>(steps[0]?.id ?? null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const elements = steps.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    if (elements.length === 0) return;

    observerRef.current?.disconnect();
    // Track whichever step's heading has crossed into the top third of the viewport — a
    // simple, robust scroll-spy heuristic (no scroll-position math, works regardless of
    // section height). Unchanged from ChapterRail.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((best, e) => (e.boundingClientRect.top < best.boundingClientRect.top ? e : best));
        setActiveId(topMost.target.id);
      },
      { rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );
    elements.forEach((el) => observer.observe(el));
    observerRef.current = observer;
    return () => observer.disconnect();
  }, [steps]);

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="step-bar" aria-label="Results page steps">
      <ul>
        {steps.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={`step-bar-link${activeId === s.id ? ' step-bar-active' : ''}`}
              onClick={() => jumpTo(s.id)}
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
