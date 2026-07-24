import './App.css';
import { useStore } from './store';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { SetupScreen } from './screens/SetupScreen';
import { DashboardScreen } from './screens/DashboardScreen';

function App() {
  const screen = useStore((s) => s.screen);
  if (screen === 'welcome') return <WelcomeScreen />;
  return screen === 'setup' ? <SetupScreen /> : <DashboardScreen />;
}

export default App;
