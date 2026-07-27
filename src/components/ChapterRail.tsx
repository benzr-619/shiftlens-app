import { useEffect, useRef, useState } from 'react';

export interface ChapterRailEntry {
  id: string;
  label: string;
}

/**
 * PR H (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §8) — sticky chapter rail (desktop-first, per
 * spec §12.3's mobile carve-out), scroll-spy, click-to-jump. CHAPTER ORDER IS THE ARGUMENT'S
 * ORDER — `chapters` is passed in by `DashboardScreen`, not decided here; this component only
 * renders and tracks whichever list it's given.
 *
 * SCOPE NOTE (flagged, not hidden): the spec's own §8 chapter list has 9 entries, several of
 * which correspond to content still bundled inside one monolithic `CoreGridTab` component (the
 * opening current-staffing analysis, the idealized-vs-current comparison, and the coverage
 * summary are three conceptually distinct chapters that render as one physical section today).
 * This rail's entries match the ACTUAL top-level sections `DashboardScreen` renders, not a
 * forced 1:1 mapping onto the spec's 9-chapter ideal — splitting `CoreGridTab` into its true
 * sub-chapters is a real, separate refactor, deferred rather than done partially here.
 */
export function ChapterRail({ chapters }: { chapters: ChapterRailEntry[] }) {
  const [activeId, setActiveId] = useState<string | null>(chapters[0]?.id ?? null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const elements = chapters.map((c) => document.getElementById(c.id)).filter((el): el is HTMLElement => !!el);
    if (elements.length === 0) return;

    observerRef.current?.disconnect();
    // Track whichever chapter's heading has crossed into the top third of the viewport — a
    // simple, robust scroll-spy heuristic (no scroll-position math, works regardless of
    // section height).
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        // Prefer the entry closest to the top of the viewport among those currently visible.
        const topMost = visible.reduce((best, e) => (e.boundingClientRect.top < best.boundingClientRect.top ? e : best));
        setActiveId(topMost.target.id);
      },
      { rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );
    elements.forEach((el) => observer.observe(el));
    observerRef.current = observer;
    return () => observer.disconnect();
  }, [chapters]);

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="chapter-rail" aria-label="Results page chapters">
      <ul>
        {chapters.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={`chapter-rail-link${activeId === c.id ? ' chapter-rail-active' : ''}`}
              onClick={() => jumpTo(c.id)}
            >
              {c.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
