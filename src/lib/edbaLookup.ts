// EDBA-cohort aggregate benchmark, keyed by annual volume band. This is a small shipped
// lookup table, NOT ED-specific seeding — it is a cross-ED aggregate used only to pre-fill
// the wHPPV target, always user-editable and always framed as "what similar EDs run at,"
// never presented as a mandated target. Source: EDBA cohort median_wHPPV_adjusted.
export interface VolumeBand {
  label: string;
  minVisits: number;
  maxVisits: number | null; // null = no upper bound
  medianWhppv: number;
  nEdYears: number;
}

export const EDBA_VOLUME_BANDS: VolumeBand[] = [
  { label: '0 - 20,000', minVisits: 0, maxVisits: 20000, medianWhppv: 1.997, nEdYears: 5065 },
  { label: '20,000 - 40,000', minVisits: 20000, maxVisits: 40000, medianWhppv: 1.648, nEdYears: 5669 },
  { label: '40,000 - 60,000', minVisits: 40000, maxVisits: 60000, medianWhppv: 1.663, nEdYears: 3486 },
  { label: '60,000 - 80,000', minVisits: 60000, maxVisits: 80000, medianWhppv: 1.688, nEdYears: 1786 },
  { label: '80,000 - 100,000', minVisits: 80000, maxVisits: 100000, medianWhppv: 1.683, nEdYears: 707 },
  { label: '> 100,000', minVisits: 100000, maxVisits: null, medianWhppv: 1.618, nEdYears: 429 },
];

export function lookupWhppvBand(annualVisits: number): VolumeBand {
  const band = EDBA_VOLUME_BANDS.find(
    (b) => annualVisits >= b.minVisits && (b.maxVisits === null || annualVisits < b.maxVisits)
  );
  return band ?? EDBA_VOLUME_BANDS[EDBA_VOLUME_BANDS.length - 1];
}
