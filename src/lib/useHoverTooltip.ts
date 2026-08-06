import { useState } from 'react';

// Split from components/HoverTooltip.tsx (2026-08-05) for the same reason heatmapColor.ts /
// whppvColorDomain.ts are split out of their component files — oxlint's fast-refresh rule
// trips on a component file that also exports a non-component (here, this hook).
export interface TooltipState {
  x: number;
  y: number;
  text: string;
}

export function useHoverTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const showTooltip = (e: { clientX: number; clientY: number }, text: string) =>
    setTooltip({ x: e.clientX, y: e.clientY, text });
  const moveTooltip = (e: { clientX: number; clientY: number }) =>
    setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
  const hideTooltip = () => setTooltip(null);
  return { tooltip, showTooltip, moveTooltip, hideTooltip };
}
