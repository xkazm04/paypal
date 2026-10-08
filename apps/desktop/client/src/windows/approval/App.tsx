// The approval window: the ONLY place money can be released, credentials entered, mandates
// signed and pairings confirmed. 744 px wide (The Diff, owner 2026-10-06), non-resizable (Rust
// builds it; see routing.rs).
//
// Bootstrap: obtain the capability (memory only, SessionProvider), resolve the selected deal
// (approval_selection → attention_list → approval:summary event). A deal → review mode (The Diff);
// none → owner configuration mode.
import { useState } from 'react';
import { ToastProvider } from '../../shared/ui';
import { DealReview } from './DealReview';
import { OwnerConfig } from './OwnerConfig';
import { ReviewBar } from './review/Parts';
import { useSelection } from './selection';
import { SessionProvider } from './session';
import './approval.css';

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
  return <OwnerConfig hint={hint} onReplayed={(deal) => setReplayed(deal.id)} />;
}
