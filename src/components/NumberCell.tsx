import { useState } from 'react';

/**
 * Editable numeric grid-cell input. Coercing to a number on every keystroke (the old
 * pattern in these grids) snaps a cleared "0" field back to "0" before the next digit
 * lands, making backspace-then-retype impossible without a select-all first. This tracks
 * the raw text locally while focused (empty string is a valid intermediate state) and only
 * commits/coerces to a number on blur.
 */
export function NumberCell({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="number"
      min={0}
      value={draft ?? (value || '')}
      placeholder="0"
      onFocus={() => setDraft(value ? String(value) : '')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onCommit(Math.max(0, Number(draft) || 0));
        setDraft(null);
      }}
    />
  );
}
