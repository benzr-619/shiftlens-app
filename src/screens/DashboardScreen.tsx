import { useState } from 'react';
import { useStore } from '../store';
import { CoreGridTab } from './dashboard/CoreGridTab';
import { BoardingTab } from './dashboard/BoardingTab';
import { CompareTab } from './dashboard/CompareTab';

type Tab = 'core' | 'boarding' | 'compare';

export function DashboardScreen() {
  const { setScreen } = useStore();
  const [tab, setTab] = useState<Tab>('core');

  return (
    <div className="screen dashboard-screen">
      <div className="dashboard-topbar">
        <h1>ShiftLens — Results</h1>
        <button className="btn-link" onClick={() => setScreen('setup')}>
          ← Back to setup
        </button>
      </div>

      <nav className="tab-bar">
        <button className={tab === 'core' ? 'tab active' : 'tab'} onClick={() => setTab('core')}>
          Core grid
        </button>
        <button className={tab === 'boarding' ? 'tab active' : 'tab'} onClick={() => setTab('boarding')}>
          Boarding summary
        </button>
        <button className={tab === 'compare' ? 'tab active' : 'tab'} onClick={() => setTab('compare')}>
          Compare shift menus
        </button>
      </nav>

      <div className="tab-content">
        {tab === 'core' && <CoreGridTab />}
        {tab === 'boarding' && <BoardingTab />}
        {tab === 'compare' && <CompareTab />}
      </div>
    </div>
  );
}
