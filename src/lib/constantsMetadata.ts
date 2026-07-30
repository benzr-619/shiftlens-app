// PR I (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §8, Chapter 9) — the constants table's
// METADATA (label/what-it-controls/evidence-tag/what-changes-if-you-move-it), generated
// against `DEFAULTS` AT RUNTIME by `buildConstantsTable()` below — never transcribed into
// prose. Prose copies of constants drift; a table generated from the live `DEFAULTS` object
// cannot (if a constant's VALUE ever changes, this table picks it up automatically; only the
// hand-written METADATA below — description/evidence tag/consequence — needs updating when a
// constant's MEANING changes, and a missing-metadata guard below makes that omission loud
// rather than silent).
import { DEFAULTS } from '../engine/types';

export type EvidenceTag = 'ESTABLISHED' | 'CONSENSUS' | 'CONVENTION' | 'ASSUMPTION' | 'OPTIONAL';

export interface ConstantMetadata {
  label: string;
  controls: string;
  evidenceTag: EvidenceTag;
  ifMoved: string;
}

// Keyed by the EXACT `DEFAULTS` property name — `buildConstantsTable` iterates `DEFAULTS`'s
// own keys, so a constant added there without an entry here fails loudly (see the guard).
const METADATA: Record<keyof typeof DEFAULTS, ConstantMetadata> = {
  hoursBudgetTolerance: {
    label: 'Hours budget tolerance',
    controls: 'How far above target-implied hours the trim is allowed to land before it stops cutting (capHours = target × (1 + tolerance)).',
    evidenceTag: 'CONVENTION',
    ifMoved: 'Higher = the solved grid can run further over target before the trim stops; lower = a tighter cap, more cutting.',
  },
  transitionWeight: {
    label: 'Transition weight (unused)',
    controls: 'Nothing — the Step 3 trim stopped reading this in the 2026-07-26 objective reversal (see engine-solver.md).',
    evidenceTag: 'CONVENTION',
    ifMoved: 'No effect on any computed output. Kept on EngineInputs/DEFAULTS as a currently-unconsumed field, not silently deleted.',
  },
  transitionWindowHours: {
    label: 'Transition window hours (unused)',
    controls: 'Nothing — same reversal as transitionWeight above.',
    evidenceTag: 'CONVENTION',
    ifMoved: 'No effect on any computed output.',
  },
  acuityWeights: {
    label: 'ESI acuity weights',
    controls: 'Reweights arrivals by ESI level before allocating cell-core hours — a higher-acuity visit consumes more nursing time per visit.',
    evidenceTag: 'CONSENSUS',
    ifMoved: 'Raising esi12 (or lowering esi45) shifts more of the annual budget toward hours where sicker patients arrive.',
  },
  smoothingWeights: {
    label: 'Day-of-week smoothing weights',
    controls: 'Blends each hour\'s core-hours allocation with its neighbors on adjacent days (center + 2×neighbor must sum to 1) to avoid a jagged, unstaffable requirement curve.',
    evidenceTag: 'CONVENTION',
    ifMoved: 'A higher neighbor weight smooths the curve further (less day-to-day variation in requirement); a lower one tracks the raw arrivals shape more tightly.',
  },
  boardingRatioTarget: {
    label: 'Boarding ratio target',
    controls: 'The target boarder-to-nurse ratio (default 4, i.e. 1:4) used to convert boarding census hours into nurse-hours.',
    evidenceTag: 'CONVENTION',
    ifMoved: 'A lower ratio (e.g. 1:3) raises the nurse-hours boarding is estimated to require; a higher ratio lowers it.',
  },
  bhBoardingRatioTarget: {
    label: 'BH boarding ratio target',
    controls: 'The target behavioral-health boarder-to-nurse ratio (default 10, i.e. 1:10) used to convert BH boarding census into nurse-hours — separate from the medical/surg ratio since BH boarders draw far less licensed RN time per patient.',
    evidenceTag: 'CONVENTION',
    ifMoved: 'A lower ratio (e.g. 1:8) raises the nurse-hours BH boarding is estimated to require; a higher ratio lowers it. Not peer-benchmarked (Ben\'s call, classic range 10-12) — this number does NOT capture the tech/sitter/security burden BH boarding actually places on the department; see the BH understatement callout wherever this figure is reported.',
  },
  enaFloor: {
    label: 'ENA department floor',
    controls: 'The minimum on-duty headcount enforced at every hour, department-wide, regardless of the budget (5.6, enforceDepartmentFloor) — a safety minimum, not a target.',
    evidenceTag: 'ESTABLISHED',
    ifMoved: 'Raising it can push the solved schedule over budget at genuinely low-volume hours (a real, documented behavior, not a bug — see engine-solver.md §5.6).',
  },
  hoursPerFteAnnual: {
    label: 'Hours per FTE (annual)',
    controls: 'The annual hours one FTE represents, used to convert every FTE-denominated figure on the page (funding asks, boarding coverage, the synthesis gap) from nurse-hours. Set on the setup screen\'s Staffing Policy Settings card, either as hours/week (×52) or directly as hours/year.',
    evidenceTag: 'CONVENTION',
    ifMoved: 'A department running fewer hours per FTE (e.g. a 36-hr/week 3x12 rotation) reports a larger FTE figure for the same nurse-hours ask; more hours/FTE reports a smaller one. Never affects the underlying nurse-hours themselves.',
  },
};

export interface ConstantsTableRow extends ConstantMetadata {
  key: string;
  value: unknown;
}

/**
 * Generated from `DEFAULTS` AT RUNTIME — never hand-transcribed. If a constant is ever added to
 * `DEFAULTS` without an entry in `METADATA` above, this throws rather than silently rendering
 * an incomplete table (a missing "what changes if you move it" column is exactly the kind of
 * gap an analyst reading Chapter 9 would notice and lose trust over).
 */
export function buildConstantsTable(): ConstantsTableRow[] {
  return (Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>).map((key) => {
    const meta = METADATA[key];
    if (!meta) {
      throw new Error(`constantsMetadata.ts: DEFAULTS.${String(key)} has no METADATA entry — add one before shipping this constant.`);
    }
    return { key: String(key), value: DEFAULTS[key], ...meta };
  });
}
