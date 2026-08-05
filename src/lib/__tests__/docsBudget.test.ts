// CONTEXT-BUDGET GUARDRAIL (added 2026-08-05).
//
// Why this test exists: every Claude Code session loads CLAUDE.md plus all of `.claude/rules/`
// into context BEFORE reading a single line of code. That cost is paid identically by a
// one-line CSS fix and by an engine rewrite. In August 2026 those files had grown, by pure
// append, to 537 KB — roughly 134k tokens, two-thirds the size of all of `src/`, and the
// dominant per-session cost of working on this repo. They were split into short current-state
// files (`.claude/rules/`) plus a full decision record (`docs/archive/rules/`) that is read
// only when a change actually touches a reversed area.
//
// The split only stays split if something enforces it. Append-only docs don't grow because
// anyone decided they should — they grow one reasonable-looking paragraph at a time. This test
// is the same technique as `copyLayer.test.ts`: a mechanical check that fails loudly with an
// instruction for what to do instead.
//
// IF THIS TEST FAILS, the fix is almost never "raise the limit." It is:
//   1. Move the narrative/history you just added to `docs/archive/rules/<area>.md`, dated,
//      with a one-line "why the previous shape was wrong."
//   2. Leave in `.claude/rules/<area>.md` only the CURRENT behavior, plus a pointer to the
//      archive under that file's "load-bearing history" table.
// Raise a limit only if the app has genuinely grown a new subsystem that a session must know
// about up front — and then say so in the commit message.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const RULES_DIR = join(REPO_ROOT, '.claude', 'rules');

const KB = 1024;

/** Per-file ceiling for CLAUDE.md. It is a navigation index: what the app is, the stack, the
 *  module map, the hard rules, and a pointer table. Not a feature log — git holds that. */
const CLAUDE_MD_LIMIT = 16 * KB;

/** Per-file ceiling for any one current-state rules file. The five that exist today run
 *  3.8-8.6 KB; 12 KB leaves real headroom for a subsystem to get more complex without leaving
 *  room for a changelog to reappear. */
const RULES_FILE_LIMIT = 12 * KB;

/** Ceiling on the WHOLE auto-loaded set. This is the number that actually matters — five files
 *  each just under their own limit is still a bloated session. ~60 KB is ~15k tokens. */
const TOTAL_AUTOLOADED_LIMIT = 60 * KB;

/** Markdown allowed to sit at the repo root. Everything else — completed specs, prompt logs,
 *  design notes — belongs in `docs/archive/specs/`. Root-level .md files are the other way this
 *  repo accumulated context cost: eleven finished specs (250 KB) advertising themselves at the
 *  top level, where a session browsing the tree will open them. */
const ALLOWED_ROOT_MARKDOWN = ['README.md', 'CLAUDE.md'];

function fileSize(path: string): number {
  return statSync(path).size;
}

function describeSize(bytes: number): string {
  return `${(bytes / KB).toFixed(1)} KB`;
}

describe('context budget: the auto-loaded doc set stays small', () => {
  it('CLAUDE.md stays a navigation index, not a history', () => {
    const size = fileSize(join(REPO_ROOT, 'CLAUDE.md'));
    expect(
      size,
      `CLAUDE.md is ${describeSize(size)}, over the ${describeSize(CLAUDE_MD_LIMIT)} ceiling.\n` +
        'Every session pays this before reading any code. Move build history, per-PR narrative,\n' +
        'and feature-status logs out — git already holds them. See the [MAINTENANCE] section.',
    ).toBeLessThanOrEqual(CLAUDE_MD_LIMIT);
  });

  it('no single .claude/rules file carries a changelog', () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(RULES_DIR)) {
      if (!entry.endsWith('.md')) continue;
      const size = fileSize(join(RULES_DIR, entry));
      if (size > RULES_FILE_LIMIT) offenders.push(`${entry} — ${describeSize(size)}`);
    }
    expect(
      offenders,
      `These rules files exceed ${describeSize(RULES_FILE_LIMIT)}:\n  ${offenders.join('\n  ')}\n\n` +
        'A rules file describes CURRENT behavior. Decision history — every prior shape and why it\n' +
        'was wrong — goes in docs/archive/rules/<same-filename>, read only when a change actually\n' +
        'touches one of the areas named in that file\'s "load-bearing history" table.',
    ).toEqual([]);
  });

  it('the whole auto-loaded set fits the per-session budget', () => {
    let total = fileSize(join(REPO_ROOT, 'CLAUDE.md'));
    for (const entry of readdirSync(RULES_DIR)) {
      if (entry.endsWith('.md')) total += fileSize(join(RULES_DIR, entry));
    }
    expect(
      total,
      `CLAUDE.md + .claude/rules/ totals ${describeSize(total)}, over the ` +
        `${describeSize(TOTAL_AUTOLOADED_LIMIT)} ceiling.\n` +
        'This is loaded in full on every session, for every change, however small.',
    ).toBeLessThanOrEqual(TOTAL_AUTOLOADED_LIMIT);
  });

  it('completed specs live in docs/archive/specs/, not at the repo root', () => {
    const stray = readdirSync(REPO_ROOT)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => !ALLOWED_ROOT_MARKDOWN.includes(f));
    expect(
      stray,
      `Unexpected markdown at the repo root:\n  ${stray.join('\n  ')}\n\n` +
        'Finished specs and prompt logs belong in docs/archive/specs/. Source comments reference\n' +
        'them by bare filename, so moving them costs nothing and keeps the root readable.',
    ).toEqual([]);
  });

  it('every rules file points at its archive, so history is findable rather than inlined', () => {
    const missing: string[] = [];
    for (const entry of readdirSync(RULES_DIR)) {
      if (!entry.endsWith('.md')) continue;
      const body = readFileSync(join(RULES_DIR, entry), 'utf-8');
      if (!body.includes('docs/archive/rules/')) missing.push(entry);
    }
    expect(
      missing,
      `These rules files have no pointer to docs/archive/rules/:\n  ${missing.join('\n  ')}\n\n` +
        'A short current-state file is only safe if the full decision record is one click away.\n' +
        'Without the pointer, a future session will re-derive a decision that was already made\n' +
        'and reversed — which is exactly what the archive exists to prevent.',
    ).toEqual([]);
  });
});
