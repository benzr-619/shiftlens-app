import { lookupWhppvBand } from './edbaLookup';

/**
 * The heatmap's color domain — a NEUTRAL band, not a single center point. Cells inside
 * [low, high] render with no color at all; only cells genuinely outside the typical range
 * for an ED this size get ink. `low`/`high` already fold in the user's own `wHppvTarget` (a
 * manager's stated target should never itself render as a problem — see computeColorDomain).
 *
 * MUST be computed ONCE (CoreGridTab.tsx) and passed into every WhppvHeatmap instance as an
 * explicit prop — the idealized-grid heatmap and the current-staffing heatmap are meant to
 * read as directly comparable, so neither may derive its own domain from its own cells.
 */
export interface WhppvColorDomain {
  low: number;
  high: number;
  target: number;
  isFallback: boolean; // true if lookupWhppvBand couldn't produce a band (no/invalid annualVisits)
}

/**
 * Neutral-band + log-ratio + asymmetric-ramp color domain (2026-07-25 heatmap legibility
 * rework — see .claude/rules/results-redesign.md). Band comes from `lookupWhppvBand`
 * (p25-p75 for this volume); widened to include `wHppvTarget` if the user's own target sits
 * outside the cohort band — a manager's stated target must never itself render as "a
 * problem." Falls back to ±15% of target when no usable volume/band exists.
 */
export function computeColorDomain(annualVisits: number, wHppvTarget: number): WhppvColorDomain {
  if (!Number.isFinite(annualVisits) || annualVisits <= 0 || !Number.isFinite(wHppvTarget) || wHppvTarget <= 0) {
    return { low: wHppvTarget * 0.85, high: wHppvTarget * 1.15, target: wHppvTarget, isFallback: true };
  }
  const band = lookupWhppvBand(annualVisits);
  return {
    low: Math.min(band.p25Whppv, wHppvTarget),
    high: Math.max(band.p75Whppv, wHppvTarget),
    target: wHppvTarget,
    isFallback: false,
  };
}
