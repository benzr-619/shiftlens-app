import { createPortal } from 'react-dom';
import type { TooltipState } from '../lib/useHoverTooltip';

// Native tooltips (HTML `title` attribute, SVG `<title>` element) turned out to be unreliable
// in practice — reported not firing at all for either the heatmap's `title` attribute or the
// marginal-curve markers' SVG `<title>`, two independent browser mechanisms failing together.
// Rather than debug two different native code paths, both now render through this one
// JS-driven tooltip: a `position: fixed` div tracking the cursor, portaled to `document.body`
// so it's never clipped by a scrolling/overflow ancestor (the heatmap table, the sticky
// `.panel-frame`, etc). Pair with `useHoverTooltip` (lib/useHoverTooltip.ts).
export function HoverTooltip({ tooltip }: { tooltip: TooltipState | null }) {
  if (!tooltip) return null;
  return createPortal(
    <div className="hover-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}>
      {tooltip.text}
    </div>,
    document.body
  );
}
