import './App.css';
import { useStore } from './store';
import { SetupScreen } from './screens/SetupScreen';
import { DashboardScreen } from './screens/DashboardScreen';

function App() {
  const screen = useStore((s) => s.screen);
  return screen === 'setup' ? <SetupScreen /> : <DashboardScreen />;
}

export default App;
