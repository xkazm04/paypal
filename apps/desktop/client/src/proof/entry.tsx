// proof.html: the proof checker on a page of its own, with no wallet and no backend. Drop a deal's
// .tableproof file on it, or use the practice deal, and see whether it holds; then break it. It is a
// static page (like director.html), so a judge or a counterparty needs nothing installed.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTheme } from '../lib/theme';
import '../design/base.css';
import '../design/ui.css';
import './proof.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root missing');
initTheme();
void import('./ProofPage').then(({ ProofPage }) => {
  createRoot(el).render(
    <StrictMode>
      <ProofPage />
    </StrictMode>,
  );
});
