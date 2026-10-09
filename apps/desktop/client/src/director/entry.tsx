// BROWSER PREVIEW ONLY: director.html, the watch-only judge path. It frames the three real windows
// (index, tumbler, approval) on the browser mock and plays a story's beat file across them: "Maya's
// week" by default, "First run" with `?story=first-run` (stories.ts). It never runs inside the
// desktop shell (the shell has no such window, and the page refuses there).
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
  const { directorSearchFor, storyFor } = await import('./stories');
  const story = storyFor();
  // The page's mock core reads its world from the address: First run's page joins the
  // brand-new wallet's world before the core is made.
  const search = directorSearchFor(story, location.search);
  if (search !== null) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
  if (story.id !== 'maya') document.title = `The Table · ${story.title} (preview)`;
  const { Director } = await import('./Director');
  createRoot(el).render(
    <StrictMode>
      <Director story={story} />
    </StrictMode>,
  );
}

void start();
