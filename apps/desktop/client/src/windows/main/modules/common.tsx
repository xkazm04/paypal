// Shared by the six module pages (moved verbatim from the old Modules.tsx). Foundation-owned:
// module agents import from here but do not edit it. Need something different? Build it in your
// own module file (e.g. your own row or review button) instead of changing these.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { Module } from '@bindings/Module';
import { WalletError } from '../../../lib/contract';
import { formatMinor } from '../../../lib/format';
import { useMutation, useQuery } from '../../../lib/hooks';
import { WalletNotice } from '../../../shared/honesty';
import { MODULE } from '../../../shared/modules';
import { ConvergenceChart } from '../charts';
import { isLive, PENDING_BACKEND, reviewVerb, type SheetTab } from '../logic';
import { DealRow, HeaderArt, Loading, LockGlyph, Silence, useCpLookup } from '../ui';
import { useWorld } from '../world';

/** Navigation a module page may use: open a deal (Layer 2) or an owner sheet. */
export type Nav = { onDeal: (id: string) => void; onSheet: (t: SheetTab) => void };
/** Props every module page receives: its own deals (already sorted by useSorted) and nav. */
export type ModuleProps = { deals: Deal[]; nav: Nav };

export /** Needs-you first (in Rust's attention order), then live by deadline, then closed. */
function useSorted(deals: Deal[]): Deal[] {
  const w = useWorld();
  return useMemo(() => {
    const order = new Map(w.needs.map((n, i) => [n.deal_id, i]));
    const rank = (d: Deal) => (order.has(d.id) ? 0 : isLive(d) ? 1 : 2);
    const dl = (d: Deal) => w.display(d).deadline ?? Infinity;
    return [...deals].sort((a, b) => rank(a) - rank(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || dl(a) - dl(b) || (rank(a) === 2 ? w.display(b).label.localeCompare(w.display(a).label) : w.display(a).label.localeCompare(w.display(b).label)));
  }, [deals, w]);
}

export function ModuleHead({ module }: { module: Module }) {
  const m = MODULE[module];
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => { h1.current?.focus({ preventScroll: true }); }, [module]);
  return (
    <>
      <div className="mhead">
        <div>
          <div className="kick">{m.long}</div>
          <h1 tabIndex={-1} ref={h1}>{m.name}</h1>
          <p>{m.line}</p>
        </div>
        <HeaderArt module={module} />
      </div>
      <div className="decision"><span className="lbl">Your one decision here</span><span>{m.decision}</span></div>
      {PENDING_BACKEND[module] ? (
        <WalletNotice error={new WalletError({ code: 'UNAVAILABLE', message: PENDING_BACKEND[module] ?? '' })} what={module === 'book' ? 'Questions' : 'Not connected yet'} />
      ) : null}
    </>
  );
}

export function ReviewButton({ item, label, className = 'btn primary' }: { item: AttentionItem; label?: string; className?: string }) {
  const w = useWorld();
  const open = useMutation('approval_open');
  return (
    <>
      <button className={`${className} ${w.locked ? 'locked' : ''}`} onClick={() => void open.run({ deal_id: item.deal_id })} disabled={open.pending}
        title="Opens the approval window - the only place money can be released">
        {w.locked ? <LockGlyph locked /> : null}{label ?? reviewVerb(item, (w.deals.data ?? []).find((d) => d.id === item.deal_id))}
      </button>
      {open.error ? <WalletNotice error={open.error} what="Approval window" /> : null}
    </>
  );
}

export function Rows({ deals, empty, nav, sub }: { deals: Deal[]; empty: ReactNode; nav: Nav; sub?: (d: Deal) => ReactNode }) {
  if (!deals.length) return <div className="empty">{empty}</div>;
  return <div className="rows">{deals.map((d) => <DealRow key={d.id} deal={d} onOpen={(x) => nav.onDeal(x.id)} sub={sub?.(d)} />)}</div>;
}

export function BandCard({ deal, nav, wide }: { deal: Deal; nav?: Nav; wide?: boolean }) {
  const w = useWorld();
  const disp = w.display(deal);
  const tr = useQuery('deal_transcript', { deal_id: deal.id }, { refreshOn: ['deal:changed'] });
  const cp = useCpLookup()(deal.counterparty);
  const need = w.needOf(deal.id);
  return (
    <div className="card bandcard">
      <h3>{wide ? 'Price range' : <>{disp.label} · price range</>} <span className="dim">{cp.name} · {deal.terms.item_ref}</span></h3>
      {tr.error ? (
        <div className="unavail">
          <b>Offers not available.</b>
          <span className="muted"> The offers could not be loaded, so the chart can’t be drawn.</span>
        </div>
      ) : !tr.data ? <Loading what="the offers" /> : (
        <ConvergenceChart steps={tr.data} band={disp.band} market={deal.market} height={wide ? 280 : 320} theirName={cp.name} settled={!isLive(deal)} />
      )}
      {disp.band ? (
        <p className="dim small">{disp.band.ceiling ? `Most you’ll pay ${formatMinor(disp.band.ceiling.minor, disp.band.ceiling.currency)}` : 'No upper limit'}{disp.band.floor ? ` · least you’ll accept ${formatMinor(disp.band.floor.minor, disp.band.floor.currency)}` : ''} · offer {disp.band.rounds_used} of {disp.band.max_rounds}. You change it by signing new rules in the approval window.</p>
      ) : disp.fallback ? <p className="dim small">The price range could not be loaded.</p> : null}
      {nav ? (
        <div className="btns">
          {need ? <ReviewButton item={need} /> : null}
          <button className="btn ghost" onClick={() => nav.onDeal(deal.id)}>Open deal</button>
        </div>
      ) : null}
      {nav && need ? <Silence text={need.on_silence} /> : null}
    </div>
  );
}
