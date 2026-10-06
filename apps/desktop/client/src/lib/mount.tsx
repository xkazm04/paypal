import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { WindowLabel } from './contract';
import { initBackend } from './runtime';
import '../design/base.css';
import '../design/ui.css';

/** Window entry: pick the backend (shell or mock) before the first render, then mount. */
export async function mount(label: WindowLabel, App: ComponentType): Promise<void> {
  await initBackend(label);
  const el = document.getElementById('root');
  if (!el) throw new Error('#root missing');
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
