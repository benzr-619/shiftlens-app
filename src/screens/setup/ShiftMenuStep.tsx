import { useStore } from '../../store';
import { ShiftMenuEditor } from '../../components/ShiftMenuEditor';
import { CurrentStaffingGrid } from '../../components/CurrentStaffingGrid';
import { EvidenceBadge } from '../../components/EvidenceBadge';

export function ShiftMenuStep() {
  const { shiftMenu, setShiftMenu, currentStaffingGrid, resetCurrentStaffingGrid } = useStore();

  return (
    <>
      <section className="card">
        <h2>Shift menu <span className="required">Required</span></h2>
        <p>Tell us the shifts your ED actually runs — we don't assume 8s vs. 12s or any particular shift count.</p>
        <ShiftMenuEditor menu={shiftMenu} onChange={setShiftMenu} />
      </section>

      <section className="card current-staffing-card">
        <div className="grid-header-row">
          <h2>Your current staffing <EvidenceBadge status="OPTIONAL" note="Optional — provide it to compare your actual schedule against the recommendation." /></h2>
          {currentStaffingGrid && (
            <button className="btn-link" onClick={resetCurrentStaffingGrid}>
              Clear
            </button>
          )}
        </div>
        <p>
          Optional, but recommended: enter how many nurses you actually staff on each shift today. It starts
          blank — nothing here is pre-filled. On the results page we'll open with an analysis of this grid and
          show, cell by cell, where your current schedule and the idealized recommendation diverge. Skip it and
          the results page will start from the idealized grid instead, with a link to add this later.
        </p>
        <CurrentStaffingGrid />
      </section>
    </>
  );
}
