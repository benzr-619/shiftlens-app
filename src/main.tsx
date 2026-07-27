import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// PR A0 (RESULTS_PAGE_V2_SPEC_2026-07-27.md §8.1) — dev-only e2e seeding hook. `import.meta
// .env.DEV` is a compile-time constant Vite replaces with `false` in production builds, so
// this whole branch (and the dynamically-imported module) is dead-code-eliminated from the
// shipped bundle — see src/lib/testSeed.ts's own header.
if (import.meta.env.DEV) {
  import('./lib/testSeed').then((m) => m.installTestSeedHook())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
