// Small building blocks shared by the Main window's layers (pre-v2; styles in legacy.css, frozen).
// New pages should prefer src/shared/ui; these stay for the deal-specific chips and rows.
import { createContext, useContext, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Deal } from '@bindings/Deal';
import type { Module } from '@bindings/Module';
import type { ReceiptEvidence } from '@bindings/ReceiptEvidence';
import type { Reconciliation } from '@bindings/Reconciliation';
import type { ShieldVerdict } from '@bindings/ShieldVerdict';
import { useCounterparties } from '../../lib/display';
import { modeWord, receiptWord, reconWord, ruleNameOf, shieldWord } from '../../lib/words';
import { MODULE } from '../../shared/modules';
import { Countdown, MinorMoney } from '../../shared/honesty';
import { headerArt, LOCK_CLOSED, LOCK_OPEN } from './art';
import { amountNote, amountTone, chipClass, dealTotal, stateLabel } from './logic';
import { useLayer } from '../../shared/ui/layers';
import { useWorld } from './world';
import './legacy.css';

/** Module colour as --mc (theme-aware token, tokens.css --m-<key>). */
export const mc = (m: Module): CSSProperties => ({ '--mc': MODULE[m].cssVar } as CSSProperties);

export function StateChip({ deal }: { deal: Pick<Deal, 'state' | 'kind' | 'shield'> & Partial<Pick<Deal, 'side'>> }) {
  return <span className={`st ${chipClass(deal)}`}>{stateLabel(deal.state, deal)}</span>;
}

const SHIELD_CLASS: Record<ShieldVerdict, string> = { CLEAR: 'done', ASK: 'wait', HOLD: 'held', BLOCK: 'bad' };
export function ShieldChip({ verdict }: { verdict: ShieldVerdict | null }) {
  if (!verdict) return <span className="st off" title="No scam check has been recorded for this deal">not checked</span>;
  const w = shieldWord(verdict);
  return <span className={`st ${SHIELD_CLASS[verdict]}`} title={w.means}>{w.text}</span>;
}

export function ReplayChip({ deal }: { deal: Pick<Deal, 'mode'> }) {
  if (deal.mode === 'replay') return <span className="st replay" title="A replayed event: never counts as real recovered money">{modeWord('replay')}</span>;
  if (deal.mode === 'scripted_engine') return <span className="st scripted" title="Run by the practice agent, which has no AI model">{modeWord('scripted_engine')}</span>;
  return null;
}

const RECEIPT_CLS: Record<ReceiptEvidence, string> = { NONE: '', SELLER_ATTESTED: 'pend', PAYPAL_VERIFIED: 'ok' };
const REC_CLS: Record<Reconciliation, string> = { not_applicable: '', pending_reporting: 'pend', matched: 'ok', mismatch: 'warn' };
export function ReceiptChip({ value }: { value: ReceiptEvidence }) {
  const w = receiptWord(value);
  return <span className={`chip ${RECEIPT_CLS[value]}`} title={w.means}>{w.text}</span>;
}
export function RecChip({ value }: { value: Reconciliation }) {
  const w = reconWord(value);
  return <span className={`chip ${REC_CLS[value]}`} title={w.means}>{w.text}</span>;
}

export function Silence({ text, className }: { text: string; className?: string }) {
  return (
    <p className={`silence ${className ?? ''}`}>
      <span className="sil-tag">if you do nothing</span>
      <span>{text}</span>
    </p>
  );
}

/** A rule of the signed rules, by its plain name (the number goes in the tooltip). */
export function Clause({ n, title }: { n: number | string; title?: string }) {
  const name = typeof n === 'number' ? ruleNameOf(n) : `rule ${n}`;
  return <span className="clause" title={title ?? `rule ${n}`}>{name}</span>;
}

export function Svg({ markup, className, viewBox, label }: { markup: string; className?: string; viewBox: string; label?: string }) {
  // Static trusted markup only (art.ts) - never data.
  return <svg className={className} viewBox={viewBox} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} dangerouslySetInnerHTML={{ __html: markup }} />;
}

export function LockGlyph({ locked }: { locked: boolean }) {
  return <Svg className="lockg" viewBox="0 0 16 16" markup={locked ? LOCK_CLOSED : LOCK_OPEN} />;
}

export function HeaderArt({ module }: { module: Module }) {
  return <Svg className="art" viewBox="0 0 200 120" markup={headerArt(module)} />;
}

/** Amount column of a deal row: proposed vs held vs moved vs struck never look alike. */
export function DealAmount({ deal, big }: { deal: Deal; big?: boolean }) {
  const t = dealTotal(deal);
  return (
    <span className={`amt ${amountTone(deal)} ${big ? 'big' : ''}`}>
      <MinorMoney minor={t.minor} currency={t.currency} />
      {!big && <small>{amountNote(deal)}</small>}
    </span>
  );
}

/** A deal row for module lists. */
export function DealRow({ deal, onOpen, sub }: { deal: Deal; onOpen: (d: Deal) => void; sub?: ReactNode }) {
  const w = useWorld();
  const disp = w.display(deal);
  const need = w.needOf(deal.id);
  const cp = useCp(deal.counterparty);
  return (
    <button className={`row ${need ? 'need' : ''}`} onClick={() => onOpen(deal)}>
      <span className="id">{disp.label}</span>
      <span className="what">
        <b>{disp.title}</b>
        <small>
          {cp} · {sub ?? (need ? need.headline : deal.terms.qty > 1 ? `${deal.terms.qty} × ${deal.terms.item_ref}` : deal.terms.item_ref)}
        </small>
      </span>
      <DealAmount deal={deal} />
      <span className="chips"><StateChip deal={deal} /><ReplayChip deal={deal} />{need?.deadline ? <Countdown deadline={need.deadline} className="gold cd" /> : null}</span>
    </button>
  );
}

// ---- counterparties (counterparty_list, short key id if the read fails) -----------------------------

const CpCtx = createContext<ReturnType<typeof useCounterparties> | null>(null);
export function CounterpartyProvider({ children }: { children: ReactNode }) {
  const cp = useCounterparties();
  return <CpCtx.Provider value={cp}>{children}</CpCtx.Provider>;
}
export function useCpLookup() {
  const c = useContext(CpCtx);
  if (!c) throw new Error('CounterpartyProvider missing');
  return c;
}
function useCp(key: string): string {
  return useCpLookup()(key).name;
}

// ---- toasts (moved to src/shared/ui/toast.tsx; re-exported so old imports keep working) --------

export { ToastProvider, useToast } from '../../shared/ui/toast';

// ---- modal confirm (one confirm for withdraw) ----------------------------------------------------

export function Confirm({ title, body, confirm, danger, onConfirm, onCancel, pending }: {
  title: string; body: ReactNode; confirm: string; danger?: boolean; pending?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useLayer(onCancel, 'confirm'); // Esc cancels (topmost layer only)
  useEffect(() => { cancelRef.current?.focus(); }, []);
  return (
    <div className="layer confirm-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="cf-t">
        <h2 id="cf-t">{title}</h2>
        <div className="muted">{body}</div>
        <div className="btns">
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={pending}>{pending ? 'Sending…' : confirm}</button>
          <button className="btn ghost" ref={cancelRef} onClick={onCancel}>Keep it</button>
        </div>
      </div>
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <div className="loading" role="status"><span className="spin" aria-hidden="true" />Loading {what}…</div>;
}
