// BROWSER PREVIEW ONLY: director.html, the watch-only "Maya's week" judge path. It frames the three
// real windows (index, tumbler, approval) on the browser mock and plays the beat file across them.
// It never runs inside the desktop shell (the shell has no such window, and the page refuses there).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isTauri } from '../lib/tauri';
import { initTheme } from '../lib/theme';
import '../design/base.css';
import './director.css';

async function start(): Promise<void> {
  const el = document.getElementById('root');
  if (!el) throw new Error('#root missing');
  initTheme();
  if (isTauri()) {
    el.textContent = 'This preview runs in a web browser only.';
    return;
  }
  const { Director } = await import('./Director');
  createRoot(el).render(
    <StrictMode>
      <Director />
    </StrictMode>,
  );
}

void start();
