// Proof from PayPal: four cards (what PayPal has · receipt · statement · typical price), each
// opening its Sheet, plus the record Sheet behind "Export record". "The seller says paid" is never
// shown as a PayPal receipt; "not on statement yet" is a delay, not a doubt.
import { useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import type { DisplayBand } from '@bindings/DisplayBand';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import type { WalletError } from '../../../lib/contract';
import { clockLabel, formatMoney, nowUnix, shortHash, shortId } from '../../../lib/format';
import { useMutation } from '../../../lib/hooks';
import type { DealWatch } from '../../../lib/marketWatch';
import { HOUSE_RECORD_NAME, houseRecordWord, KEPT_FRESH, marketWords, PRICE_CHECKS_USED_UP, priceChecksToday, PROOF_FILE_SHOWS, PROOF_SAVE_WARNING } from '../../../lib/words';
import { ModeBadge, WalletNotice } from '../../../shared/honesty';
import { Btn, Chip, Empty, Kv, Loading, Sheet } from '../../../shared/ui';
import { ConvergenceChart, MarketBand, MiniBand } from '../charts';
import { isLive, marketPosition } from '../logic';
import { useToast } from '../ui';
import { attestOf, evidenceLabel, reconciliationLabel, stepWords, type PaypalRefKey } from './model';

export type EvidenceKind = 'paypal' | 'books' | 'market';

type EvState = { data: DealEvidence | undefined; error: WalletError | null };

/** PayPal's own records, in the order money goes through them. */
const REFS: Array<[PaypalRefKey, string]> = [['order', 'Order'], ['authorization', 'Hold'], ['capture', 'Payment']];
const REF_NAME: Record<PaypalRefKey, string> = { order: 'Order', authorization: 'Hold', capture: 'Payment', subscription: 'Subscription' };

/** The typical-price card's line about a signed keep-prices-fresh rule (T15); null when not watched. */
export function watchWhy(watch: DealWatch | null | undefined, priced: boolean): string | null {
  if (!watch) return null;
  if (watch.usedUp) return 'Today’s price checks are used up; checked again tomorrow.';
  return priced ? `${KEPT_FRESH}.` : `${KEPT_FRESH}: the first check is on its way.`;
}

export function ProofPanel({ deal, ev, band, watch, onOpen }: { deal: Deal; ev: EvState; band: DisplayBand | null; watch?: DealWatch | null; onOpen: (k: EvidenceKind) => void }) {
  const e = ev.data;
  const evl = e ? evidenceLabel(deal, e.receipt) : null;
  const rec = e ? reconciliationLabel(e.reconciliation) : null;
  const mk = deal.market;
  const limit = band ? (deal.side === 'buyer' ? band.ceiling : band.floor) : null;
  const any = REFS.some(([k]) => deal.paypal[k]);
  const sameCur = !!mk && deal.terms.unit_price.currency === mk.median.currency;
  const mw = mk && sameCur ? marketWords(deal.terms.unit_price.minor, mk.p25.minor, mk.median.minor, mk.p75.minor) : null;
  const loading = <span className="dim">loading…</span>;
  const house = e?.house_record ? houseRecordWord(e.house_record) : null;
  return (
    <div className="dv-proof">
      <button type="button" className="dv-pc" onClick={() => onOpen('paypal')}>
        <span className="k">What PayPal has</span>
        <span className="v">
          {any ? (
            <span className="dv-refs">
              {REFS.map(([k, l]) => <span key={k} className={`ref ${deal.paypal[k] ? 'has' : ''}`} title={deal.paypal[k] ? `${l}: ${deal.paypal[k]}` : `No ${l.toLowerCase()} yet`}><i aria-hidden="true" />{l}</span>)}
            </span>
          ) : <span className="dv-none"><i aria-hidden="true" />{deal.state === 'REFUSED' ? 'Never sent to PayPal' : 'Nothing sent yet'}</span>}
        </span>
        <span className="why">{any ? 'Only the ids are kept here. Open to see them.' : deal.state === 'REFUSED' ? 'It was stopped before PayPal was asked.' : 'Nothing is created at PayPal until a deal is agreed.'}</span>
      </button>
      <button type="button" className="dv-pc" onClick={() => onOpen('paypal')}>
        <span className="k">Receipt</span>
        <span className="v">{ev.error ? <Chip tone="dashed">couldn’t load</Chip> : evl ? <Chip tone={evl.tone} title={evl.why}>{evl.text}</Chip> : loading}</span>
        <span className="why">{evl?.why ?? ''}</span>
      </button>
      <button type="button" className="dv-pc" onClick={() => onOpen('books')}>
        <span className="k">PayPal statement</span>
        <span className="v">{ev.error ? <Chip tone="dashed">couldn’t load</Chip> : rec ? <Chip tone={rec.tone} title={rec.why}>{rec.text}</Chip> : loading}</span>
        <span className="why">{rec?.why ?? ''}</span>
      </button>
      <button type="button" className="dv-pc" onClick={() => onOpen('market')}>
        <span className="k">Typical price</span>
        <span className="v">
          {mk ? <><MiniBand market={mk} price={deal.terms.unit_price} limit={limit} />
            <span title={sameCur ? `${marketPosition(deal.terms.unit_price.minor, mk.p25.minor, mk.median.minor, mk.p75.minor)} of ${formatMoney(mk.p25)}–${formatMoney(mk.p75)}` : undefined}>{mw ? mw.text : `middle ${formatMoney(mk.median)}`}</span></>
            : <span className="dv-none"><i aria-hidden="true" />No comparison</span>}
        </span>
        <span className="why">
          {mk ? `Similar listings: ${formatMoney(mk.p25)} to ${formatMoney(mk.p75)}.` : watch && !watch.usedUp ? 'No comparison yet.' : 'No comparison for this item, so market checks are skipped, not passed.'}
          {watch ? <span className={`dv-fresh ${watch.usedUp ? 'used' : ''}`} title={watch.usedUp ? PRICE_CHECKS_USED_UP : `${priceChecksToday(watch.used, watch.max)}. The wallet checks the typical price on its own; it never approves anything.`}> {watchWhy(watch, !!mk)}</span> : null}
        </span>
      </button>
      {house && e?.house_record ? (
        <button type="button" className={`dv-pc dv-pc-wide${house.warns ? ` warn ${house.tone}` : ''}`} onClick={() => onOpen('paypal')}>
          <span className="k">{HOUSE_RECORD_NAME}</span>
          <span className="v"><Chip tone={house.tone}>{house.text}</Chip>
            <span className="dim">{e.house_record.checked_at !== null ? `compared ${clockLabel(e.house_record.checked_at)}` : `kept ${clockLabel(e.house_record.kept_at)}`}</span></span>
          <span className="why">{house.means}</span>
        </button>
      ) : null}
    </div>
  );
}

export function EvidenceSheet({ kind, deal, ev, band, watch, onFresh, onClose }: {
  kind: EvidenceKind; deal: Deal; ev: EvState; band: DisplayBand | null; watch?: DealWatch | null; onFresh: (e: DealEvidence) => void; onClose: () => void;
}) {
  const rec = useMutation('deal_reconcile');
  const toast = useToast();
  const e = ev.data;
  const reconcile = deal.state === 'RECEIPTED' ? (
    <Btn className="left" disabled={rec.pending} title="Looks this payment up on your own PayPal statement. Read-only."
      onClick={async () => {
        const now = nowUnix();
        const r = await rec.run({ deal_id: deal.id, start: now - 3 * 86400, end: now });
        if (r) { onFresh(r); toast(<>PayPal statement: <b>{reconciliationLabel(r.reconciliation).text}</b></>, r.reconciliation === 'matched' ? 'ok' : 'info'); }
      }}>{rec.pending ? 'Checking your statement…' : 'Check my PayPal statement'}</Btn>
  ) : null;
  const done = <Btn kind="primary" onClick={onClose}>Done</Btn>;
  const evidenceKv = e ? (
    <Kv items={[
      ['Receipt', <><Chip tone={evidenceLabel(deal, e.receipt).tone}>{evidenceLabel(deal, e.receipt).text}</Chip> {evidenceLabel(deal, e.receipt).why}</>],
      ['Statement', <><Chip tone={reconciliationLabel(e.reconciliation).tone}>{reconciliationLabel(e.reconciliation).text}</Chip> {reconciliationLabel(e.reconciliation).why}</>],
      e.house_record ? [HOUSE_RECORD_NAME, <><Chip tone={houseRecordWord(e.house_record).tone}>{houseRecordWord(e.house_record).text}</Chip> {houseRecordWord(e.house_record).means}</>] : null,
    ]} />
  ) : ev.error ? <WalletNotice error={ev.error} what="Proof" /> : <Loading what="the PayPal proof" />;

  if (kind === 'paypal') {
    const keys: PaypalRefKey[] = ['order', 'authorization', 'capture', ...(deal.paypal.subscription ? ['subscription' as const] : [])];
    const none = !deal.paypal.order && !deal.paypal.subscription;
    return (
      <Sheet title="PayPal records" size="wide" onClose={onClose} footer={<>{reconcile}{done}</>}>
        {none ? <p className="dv-p">{deal.state === 'REFUSED' ? 'Refused before PayPal was asked: there are no PayPal records.' : 'Nothing has been sent to PayPal for this deal yet.'}</p> : (
          <table className="ui-table dv-table">
            <thead><tr><th>Record</th><th>PayPal id</th><th>Who stands behind it</th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k}><td>{REF_NAME[k]}</td><td className="mono">{deal.paypal[k] ?? <span className="dim">not yet</span>}</td><td className="dim">{deal.paypal[k] ? attestOf(deal, k, e?.receipt ?? 'NONE') : ''}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="dv-gap">{evidenceKv}</div>
        {rec.error ? <WalletNotice error={rec.error} what="Statement check" /> : null}
        <p className="ui-hint">Until your wallet checks a payment with PayPal itself, it only shows what the seller says. Only ids are kept here, never PayPal’s full answers.</p>
      </Sheet>
    );
  }
  if (kind === 'books') {
    return (
      <Sheet title="PayPal statement" onClose={onClose} footer={<>{reconcile}{done}</>}>
        {e ? (
          <>
            <p className="dv-p"><Chip tone={reconciliationLabel(e.reconciliation).tone}>{reconciliationLabel(e.reconciliation).text}</Chip></p>
            <p className="dv-p muted">{reconciliationLabel(e.reconciliation).why}</p>
          </>
        ) : ev.error ? <WalletNotice error={ev.error} what="Proof" /> : <Loading what="the statement" />}
        {rec.error ? <WalletNotice error={rec.error} what="Statement check" /> : null}
      </Sheet>
    );
  }
  const mk = deal.market;
  const limit = band && deal.kind === 'haggle' ? (deal.side === 'buyer' ? (band.ceiling ? { label: 'most you’ll pay', value: band.ceiling } : null) : (band.floor ? { label: 'least you’ll accept', value: band.floor } : null)) : null;
  const price = deal.terms.unit_price;
  const mw = mk && price.currency === mk.median.currency ? marketWords(price.minor, mk.p25.minor, mk.median.minor, mk.p75.minor) : null;
  return (
    <Sheet title="Typical price" size="wide" onClose={onClose} footer={done}>
      {mk ? (
        <>
          <MarketBand market={mk} price={price} limit={limit} />
          <Kv className="dv-gap" items={[
            ['This deal', mw ? <><b className="money">{formatMoney(price)}</b> · {mw.text}</> : <span className="dim">{formatMoney(price)} · in another currency than the comparison</span>],
            ['Typical range', <span className="money">{formatMoney(mk.p25)} – {formatMoney(mk.p75)} · middle {formatMoney(mk.median)}</span>],
            ['Checked', `${clockLabel(mk.retrieved_at)}${mk.cached ? ' · saved copy' : ''}`],
            ...(watch ? [['Kept fresh', watch.usedUp ? <span className="gold">{PRICE_CHECKS_USED_UP}</span> : `${KEPT_FRESH} · ${priceChecksToday(watch.used, watch.max).toLowerCase()}`] as const] : []),
          ]} />
          <p className="ui-hint">A comparison with similar listings, not a recommendation.</p>
        </>
      ) : <p className="dv-p">{watch && !watch.usedUp ? `No comparison yet. ${KEPT_FRESH}: the first check is on its way.` : 'No comparison for this item, so price checks against the market are skipped, not passed.'}</p>}
    </Sheet>
  );
}

/** The full record (layer 2), with "Save signed proof": a file anyone can check with "Check a proof file" in the Book. */
export function TranscriptSheet({ deal, label, steps, error, band, theirName, onClose }: {
  deal: Deal; label: string; steps: TranscriptStep[] | undefined; error: WalletError | null; band: DisplayBand | null; theirName: string; onClose: () => void;
}) {
  const sorted = [...(steps ?? [])].sort((a, b) => a.seq - b.seq);
  const priced = sorted.some((s) => s.price);
  const them = theirName.split(' · ')[0] ?? theirName;
  const proof = useMutation('deal_export_proof');
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();
  const save = async () => {
    setConfirming(false);
    if (await proof.run({ deal_id: deal.id })) toast('Signed proof saved · check it with “Check a proof file” in the Book', 'ok');
  };
  return (
    <Sheet title={`Record of ${label}`} size="wide" onClose={onClose}
      footer={<>
        <Btn className="left" disabled={proof.pending} title="Saves one signed file with this deal's rules, messages, PayPal records and audit trail. Check it with “Check a proof file” in the Book."
          onClick={() => setConfirming(true)}>
          {proof.pending ? 'Saving signed proof…' : 'Save signed proof'}
        </Btn>
        <Btn kind="primary" onClick={onClose}>Done</Btn>
      </>}>
      {confirming ? (
        <Sheet title="Save signed proof" onClose={() => setConfirming(false)}
          footer={<><Btn onClick={() => setConfirming(false)}>Cancel</Btn><Btn kind="primary" onClick={() => void save()}>Save</Btn></>}>
          <p className="dv-p">Anyone with the file can check, without your wallet:</p>
          <ul className="dv-list">{PROOF_FILE_SHOWS.map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="dv-p">{PROOF_SAVE_WARNING}</p>
        </Sheet>
      ) : null}
      {proof.error ? <WalletNotice error={proof.error} what="Signed proof" /> : null}
      <Kv items={[
        ['Messages', steps ? `${steps.length} · ${steps.every((s) => s.verified) ? 'every signature checked' : 'some signatures could not be checked'}` : '—'],
        ['PayPal', <span className="mono">{[deal.paypal.order, deal.paypal.authorization, deal.paypal.capture].map((x) => x ?? '—').join(' · ')}</span>],
        ['Mode', <ModeBadge mode={deal.mode} />],
        ['Record id', <span className="mono">{shortId(deal.id, 6, 4)} · {shortHash(deal.transcript_head)}</span>],
      ]} />
      {error ? <WalletNotice error={error} what="Record" /> : !steps ? <Loading what="the record" /> : !sorted.length ? <Empty>No signed messages for this deal.</Empty> : (
        <>
          {deal.kind === 'haggle' && priced ? <div className="dv-gap"><ConvergenceChart steps={sorted} band={band} market={deal.market} height={240} theirName={theirName} settled={!isLive(deal)} /></div> : null}
          <table className="ui-table dv-table dv-gap">
            <thead><tr><th>Who</th><th>What</th><th className="num">Price</th><th>Signature</th><th>When</th></tr></thead>
            <tbody>
              {sorted.map((s) => {
                const w = stepWords(s, them);
                return (
                  <tr key={s.seq}>
                    <td className={`lane-${s.by}`}>{w.who}</td>
                    <td>{w.verb}</td>
                    <td className="num">{s.price ? formatMoney(s.price) : ''}</td>
                    <td>{s.verified ? <span className="okc">✓ checked</span> : <span className="red">✗ could not be checked</span>}</td>
                    <td className="dim num">{clockLabel(s.at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </Sheet>
  );
}
