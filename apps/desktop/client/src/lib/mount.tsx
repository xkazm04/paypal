import { lazy, StrictMode, Suspense, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { WindowLabel } from './contract';
import { initBackend } from './runtime';
import { DataProvider } from './data/provider';
import { WINDOW_START_FAILED } from './words';
import { WindowBoundary } from '../shared/boundary/ErrorBoundary';
import '../design/base.css';
import '../design/ui.css';

// Inspector (Ctrl+Shift+L): only in the `npm run tauri:dev:test` build. The flag is replaced at
// build time, so the dynamic import and the overlay are dropped from every other bundle.
const DevInspector =
  import.meta.env.VITE_INSPECTOR === '1'
    ? lazy(() => import('./dev/DevInspector').then((m) => ({ default: m.DevInspector })))
    : null;

/** Window entry: pick the backend (shell or mock) before the first render, then mount. */
export async function mount(label: WindowLabel, App: ComponentType): Promise<void> {
  const el = document.getElementById('root');
  if (!el) throw new Error('#root missing');
  try {
    await initBackend(label);
  } catch (e) {
    // No backend, no window: say so in one plain sentence instead of leaving the page blank. The
    // error still goes to the console (the entries call this with `void`, so it would be unhandled).
    console.error('[window:start]', e);
    el.textContent = WINDOW_START_FAILED;
    return;
  }
  createRoot(el).render(
    <StrictMode>
      {/* The window's read layer (lib/data) and its last-resort boundary (shared/boundary). */}
      <DataProvider scope={label === 'main' ? 'main' : 'plain'}>
        <WindowBoundary>
          <App />
        </WindowBoundary>
      </DataProvider>
      {DevInspector && (
        <Suspense fallback={null}>
          <DevInspector />
        </Suspense>
      )}
    </StrictMode>,
  );
}
