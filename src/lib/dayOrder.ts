import { DAY_LABELS } from '../engine/types';

// Display-order convention (2026-07-25 heatmap legibility rework): every grid RENDERS
// Mon, Tue, Wed, Thu, Fri, Sat, Sun — weekend contiguous at the right edge, since Sunday
// and Saturday sitting at opposite ends of a Sun-first grid split the weekend in two.
//
// This is a display-only reorder. It does NOT change the engine's canonical index — day 0
// = Sunday remains true throughout `arrivals[day*24+hour]`, every engine function, every
// store field, and every parser's output (parsers match days by name via DAY_ALIASES, never
// by row position — see .claude/rules/template-parsing.md). DISPLAY_DAY_ORDER[i] is the
// engine day index to render at display position i.
export const DISPLAY_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const DISPLAY_DAY_LABELS = DISPLAY_DAY_ORDER.map((d) => DAY_LABELS[d]);
