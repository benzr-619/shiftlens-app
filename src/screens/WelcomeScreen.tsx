import { useStore } from '../store';

export function WelcomeScreen() {
  const setScreen = useStore((s) => s.setScreen);

  return (
    <div className="screen welcome-screen">
      <img src="/favicon.svg" alt="ShiftLens" className="welcome-logo" />
      <h1>ShiftLens</h1>
      <p className="subtitle">
        You already have a staffing pattern. ShiftLens compares it, hour by hour, to what
        your ED's demand actually calls for so you can see where it diverges, weigh what
        changing it would cost or gain, and plan ahead.
      </p>
      <button className="btn-primary btn-large" onClick={() => setScreen('setup')}>
        Start Setup
      </button>
    </div>
  );
}
