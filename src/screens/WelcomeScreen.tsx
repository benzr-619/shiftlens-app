import { useStore } from '../store';

export function WelcomeScreen() {
  const setScreen = useStore((s) => s.setScreen);

  return (
    <div className="screen welcome-screen">
      <img src="/favicon.svg" alt="ShiftLens" className="welcome-logo" />
      <h1>ShiftLens</h1>
      <p className="subtitle">
        ShiftLens is an ED RN staffing calculator. Enter your emergency department's
        arrivals data, a target wHPPV, and your shift menu, and it builds an idealized
        day-by-shift staffing grid — honestly reporting shortfalls and boarding-driven
        FTE need instead of hiding them behind an average.
      </p>
      <button className="btn-primary btn-large" onClick={() => setScreen('setup')}>
        Start Setup
      </button>
    </div>
  );
}
