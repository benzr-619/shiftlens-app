import { useState } from 'react';
import { useStore } from '../../store';
import { compute } from '../../engine';
import { ShiftMenuEditor } from '../../components/ShiftMenuEditor';
import type { ShiftDef } from '../../engine/types';

let variantCounter = 1;

export function CompareTab() {
  const { shiftMenu, compareVariants, addCompareVariant, removeCompareVariant, updateCompareVariant, buildEngineInputs } =
    useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [draftMenu, setDraftMenu] = useState<ShiftDef[]>(shiftMenu.map((s) => ({ ...s })));
  const [draftName, setDraftName] = useState('');

  const baseInputs = buildEngineInputs();
  const baseResult = compute(baseInputs);

  function commitAdd() {
    addCompareVariant({
      id: `variant-${variantCounter++}`,
      name: draftName || `Variant ${compareVariants.length + 1}`,
      shiftMenu: draftMenu,
    });
    setShowAdd(false);
    setDraftName('');
  }

  const variantResults = compareVariants.map((v) => ({
    variant: v,
    result: compute({ ...baseInputs, shiftMenu: v.shiftMenu }),
  }));

  return (
    <div className="compare-tab">
      <p>
        Shift start-time is a real, testable lever — a validated finding showed ~18% shortfall difference just
        from shifting the shift-menu start time. Define alternate menus and compare against your current one, run
        through the same solver.
      </p>

      <div className="compare-columns">
        <div className="compare-column">
          <h3>Current menu</h3>
          <MenuSummary menu={shiftMenu} result={baseResult} />
        </div>

        {variantResults.map(({ variant, result }) => (
          <div className="compare-column" key={variant.id}>
            <div className="grid-header-row">
              <h3>{variant.name}</h3>
              <button className="btn-link" onClick={() => removeCompareVariant(variant.id)}>
                Remove
              </button>
            </div>
            <ShiftMenuEditor menu={variant.shiftMenu} onChange={(m) => updateCompareVariant(variant.id, m)} />
            <MenuSummary menu={variant.shiftMenu} result={result} />
          </div>
        ))}

        <div className="compare-column compare-add">
          {showAdd ? (
            <>
              <input
                type="text"
                placeholder="Variant name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
              />
              <ShiftMenuEditor menu={draftMenu} onChange={setDraftMenu} />
              <div className="button-row">
                <button className="btn-primary" onClick={commitAdd}>
                  Add variant
                </button>
                <button className="btn-secondary" onClick={() => setShowAdd(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button className="btn-secondary btn-large" onClick={() => setShowAdd(true)}>
              + Add shift-menu variant
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuSummary({ menu, result }: { menu: ShiftDef[]; result: ReturnType<typeof compute> }) {
  const totalDeficit = result.shortfall.reduce((a, s) => a + s.deficit, 0);
  return (
    <div className="menu-summary">
      <ul className="menu-list">
        {menu.map((s) => (
          <li key={s.id}>
            {s.label || s.id}: {s.startHour.toString().padStart(2, '0')}:00, {s.lengthHours}h
          </li>
        ))}
      </ul>
      <div className="wHPPV-stats compact">
        <div className="stat">
          <div className="stat-label">Overcoverage</div>
          <div className="stat-value">{(result.overcoveragePct * 100).toFixed(1)}%</div>
        </div>
        <div className="stat">
          <div className="stat-label">Shortfall hrs</div>
          <div className={`stat-value ${totalDeficit > 0 ? 'stat-warning' : ''}`}>{totalDeficit}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Cells short</div>
          <div className="stat-value">{result.shortfall.length}</div>
        </div>
      </div>
    </div>
  );
}
