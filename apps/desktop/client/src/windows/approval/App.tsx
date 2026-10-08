// The approval window: the ONLY place money can be released, credentials entered, mandates
// signed and pairings confirmed. 744 px wide (The Diff, owner 2026-10-06), non-resizable (Rust
// builds it; see routing.rs).
//
// Bootstrap: obtain the capability (memory only, SessionProvider), resolve the selected deal
// (approval_selection → attention_list → approval:summary event). A deal → review mode (The Diff);
// none → owner configuration mode.
//
// A deal review is this window's first paint, so DealReview is in the entry chunk; the owner
// configuration (with the rules editor, its what-if and the replay sheet) is its own chunk
// (lib/lazy.ts), preloaded while the selection resolves, so it is ready when no deal is selected.
import { Suspense, useEffect, useState } from 'react';
import { lazyPart, preloadWhenIdle } from '../../lib/lazy';
import { ToastProvider } from '../../shared/ui';
import { DealReview } from './DealReview';
import '../../shared/start.css';
import '../../shared/ownerKey.css';
import './owner.css';
import { ReviewBar } from './review/Parts';
import { useSelection } from './selection';
import { SessionProvider } from './session';
import { Header } from './ui';
import './approval.css';

const OwnerConfig = lazyPart(() => import('./OwnerConfig').then((m) => m.OwnerConfig));

export function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <Approval />
      </ToastProvider>
    </SessionProvider>
  );
}

function Approval() {
  const sel = useSelection();
  // A failed renewal replayed in this window: Rust selected its new rescue deal for review.
  const [replayed, setReplayed] = useState<string | null>(null);
  useEffect(() => preloadWhenIdle([OwnerConfig], 0), []);
  if (replayed) return <DealReview key={replayed} dealId={replayed} seed={null} />;
  if (sel.status === 'resolving') {
    return (
      <div className="aw dr phase-checking">
        <ReviewBar module={null} label={null} mode={undefined} />
        <main className="dr-body" aria-label="Checking">
          <div className="dr-head">
            <h1 className="dr-h">Checking <span className="q">· asking the wallet why this window opened</span></h1>
          </div>
          <div className="dr-twin" aria-hidden="true">
            <div className="tw l"><span className="twk">You signed</span><span className="tw-amt skeleton">$ ———</span></div>
            <div className="tw-op wait">…</div>
            <div className="tw r"><span className="twk">Being asked</span><span className="tw-amt skeleton">$ ———</span></div>
          </div>
        </main>
      </div>
    );
  }
  if (sel.dealId) return <DealReview key={sel.dealId} dealId={sel.dealId} seed={sel.seed} />;
  const hint = sel.source === 'unknown' ? 'If you opened this window to review a deal, its summary appears here as soon as the wallet sends it.' : null;
  // Only if the owner configuration is opened before its chunk arrived: the same frame, empty.
  const waiting = (
    <div className="aw ow ow-cfg">
      <Header mode={undefined} />
      <main className="aw-body ow-body" aria-busy="true" />
    </div>
  );
  return (
    <Suspense fallback={waiting}>
      <OwnerConfig hint={hint} onReplayed={(deal) => setReplayed(deal.id)} />
    </Suspense>
  );
}
