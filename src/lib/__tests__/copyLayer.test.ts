// PR F (RESULTS_COMPREHENSION_SPEC_2026-07-26.md §3) — "Never call the target-derived figure
// a budget in the UI." Engine field names stay unchanged (renaming `annualCoreRnHoursBudget`/
// `weeklyBudgetHours` churns the reconciliation vocabulary for no user-visible gain) — this is
// a COPY-LAYER rule only, enforced here by a source-grep over rendered UI code.
//
// Strategy: strip comments (the word "budget" is fine in an internal comment — e.g. this file's
// own header, or engine-solver.md section-name references) and then fail on any remaining bare
// "budget" word (word-boundary, case-insensitive — this does NOT match inside camelCase
// identifiers like `weeklyBudgetHours`, since there's no boundary between "y" and "B" there).
//
// ONE explicit exception (PR H, §6.1): the philosophy statement uses "budget" as a VERB/CONCEPT
// ("ShiftLens budgets your department twice... arrivals budget... boarding gets its own
// budget") — a categorically different usage from labeling the target-derived HOURS FIGURE a
// budget, which is the actual thing this rule bans. That exact spec-mandated sentence is
// allowlisted below by substring match, rather than trying to make the regex itself tell the
// two usages apart (fragile — "budget" the concept and "budget" the mislabeled figure are the
// same word). Any NEW use of "budget" outside this allowlist still fails the test.
const ALLOWED_BUDGET_SUBSTRINGS = [
  'ShiftLens budgets your department twice',
  "that's the arrivals budget alone talking",
  'Boarding gets its own budget',
];

// PR F (RESULTS_PAGE_V2_SPEC_2026-07-27.md §5.5) — extends this file's existing strategy to
// two more banned words:
//   - "severity" (R7) — the solver's internal objective, never a user-facing figure/word.
//   - "idealized" (R11) — renamed "recommended" everywhere in the UI; engine field names
//     (`EngineResult.grid`, etc.) are unchanged, same non-renaming convention as "budget."
// Both additions were deliberately DEFERRED past PR E (see .claude/rules/results-redesign.md's
// PR E section) until PR F actually removed/renamed the last live UI text using either word —
// adding the ban earlier would have failed against files outside that PR's scope.
//
// ONE unavoidable exception: importing the engine's own `severity` function requires the
// literal substring "severity" to appear in the import statement itself (`import { severity as
// X } from ...`) — there is no way to reference an export without naming it once at the import
// site. `components/ConvexityDemo.tsx` aliases it to `computeQueueCost` immediately and never
// uses the bare name again, but that one import line is allowlisted below by exact substring,
// the same technique the "budget" rule already uses for its one legitimate exception.
const ALLOWED_SEVERITY_SUBSTRINGS = ["import { severity as computeQueueCost } from '../engine/solver';"];
const ALLOWED_IDEALIZED_SUBSTRINGS: string[] = [];

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listTsxFiles(full));
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Strips // line comments and /* block comments *\/ — a heuristic, not a real parser, but
 * sufficient for this codebase's style (no "//" inside template literals in these dirs). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const SCREENS_DIR = join(__dirname, '..', '..', 'screens');
const COMPONENTS_DIR = join(__dirname, '..', '..', 'components');

describe('PR F copy-layer rule: never call the target-derived figure a "budget" in the UI', () => {
  it('no rendered code in src/screens or src/components contains the bare word "budget"', () => {
    const files = [...listTsxFiles(SCREENS_DIR), ...listTsxFiles(COMPONENTS_DIR)];
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      const lines = code.split('\n');
      lines.forEach((line, i) => {
        if (!/\bbudget\b/i.test(line)) return;
        if (ALLOWED_BUDGET_SUBSTRINGS.some((allowed) => line.includes(allowed))) return;
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `Found "budget" in rendered UI code (use "target-implied hours" instead):\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('PR F copy-layer rule (R7): "severity" never appears in the UI', () => {
  it('no rendered code in src/screens or src/components contains the bare word "severity"', () => {
    const files = [...listTsxFiles(SCREENS_DIR), ...listTsxFiles(COMPONENTS_DIR)];
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      code.split('\n').forEach((line, i) => {
        if (!/\bseverity\b/i.test(line)) return;
        if (ALLOWED_SEVERITY_SUBSTRINGS.some((allowed) => line.includes(allowed))) return;
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `Found "severity" in rendered UI code (it's the solver's internal objective — use "hours below need"/"queue cost"):\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('PR F copy-layer rule (R11): "idealized" is renamed "recommended" everywhere in the UI', () => {
  it('no rendered code in src/screens or src/components contains the bare word "idealized"', () => {
    const files = [...listTsxFiles(SCREENS_DIR), ...listTsxFiles(COMPONENTS_DIR)];
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf-8'));
      code.split('\n').forEach((line, i) => {
        if (!/\bidealized\b/i.test(line)) return;
        if (ALLOWED_IDEALIZED_SUBSTRINGS.some((allowed) => line.includes(allowed))) return;
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `Found "idealized" in rendered UI code (use "recommended" instead):\n${offenders.join('\n')}`).toEqual([]);
  });
});
