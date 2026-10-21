// Proof from PayPal (the deal page's Proof view): four cards (what PayPal has · receipt · statement
// · typical price), each opening its sheet, plus the record sheet behind "Export record". "The
// seller says paid" is never shown as a PayPal receipt; "not on statement yet" is a delay, not a
// doubt. Moved from deal/Evidence.tsx by rebuild WP3c (behaviour kept, words in lib/words/deal.ts);
// this view is its own chunk, so the proof and its charts load only when the owner opens it.
import { useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import type { DisplayBand } from '@bindings/DisplayBand';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import type { WalletError } from '../../../../../lib/contract';
import { clockLabel, formatMoney, nowUnix, shortHash, shortId } from '../../../../../lib/format';
import { useMutation, useQuery } from '../../../../../lib/hooks';
import type { DealWatch } from '../../../../../lib/marketWatch';
import {
  DEAL_PROOF, DEAL_RECORD, FAIR_PRICE_NAME, fairPriceWords, HOUSE_RECORD_NAME, houseRecordWord, KEPT_FRESH, marketWords, PRICE_CHECKS_USED_UP, priceChecksToday, PROOF_FILE_SHOWS, PROOF_SAVE_WARNING,
  STATEMENT_CHECK_NEEDS_KEYS,
} from '../../../../../lib/words';
import { ModeBadge, WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, Empty, Kv, Loading, Sheet } from '../../../../../shared/ui';
import { ConvergenceChart, MarketBand, MiniBand } from '../../../charts';
import '../../../charts.css';
import { isLive, marketPosition } from '../../../logic';
import { useToast } from '../../../ui';
import { attestOf, evidenceLabel, heldRefs, reconciliationLabel, shownRefs, statementLabel, stepWords } from '../../../deal/model';

export type EvidenceKind = 'paypal' | 'books' | 'market';

type EvState = { data: DealEvidence | undefined; error: WalletError | null };

const DAY = 86400;
/** The statement read's window: back to a day before the deal began (its payment cannot be older),
 *  at least the last three days, and never more than the 31 days PayPal's reporting (and the wallet,
 *  ReportingWindow::validate) accept. A window that starts after the payment finds nothing, and the
 *  wallet records that as "not on the statement". */
export function statementWindow(d: Pick<Deal, 'created_at'>, now: number): { start: number; end: number } {
  const start = Math.max(now - 31 * DAY, Math.min(now - 3 * DAY, (d.created_at ?? now) - DAY));
  return { start, end: now };
}

/** The typical-price card's line about a signed keep-prices-fresh rule (T15); null when not watched. */
export function watchWhy(watch: DealWatch | null | undefined, priced: boolean): string | null {
  if (!watch) return null;
  if (watch.usedUp) return DEAL_PROOF.usedUp;
  return priced ? `${KEPT_FRESH}.` : DEAL_PROOF.firstOnWay(KEPT_FRESH);
}

export function ProofPanel({ deal, ev, band, watch, onOpen }: { deal: Deal; ev: EvState; band: DisplayBand | null; watch?: DealWatch | null; onOpen: (k: EvidenceKind) => void }) {
  const e = ev.data;
  const evl = e ? evidenceLabel(deal, e.receipt) : null;
  const rec = e ? statementLabel(deal.state, e) : null;
  const mk = deal.market;
  const limit = band ? (deal.side === 'buyer' ? band.ceiling : band.floor) : null;
  const any = heldRefs(deal).length > 0;
  const sameCur = !!mk && deal.terms.unit_price.currency === mk.median.currency;
  const mw = mk && sameCur ? marketWords(deal.terms.unit_price.minor, mk.p25.minor, mk.median.minor, mk.p75.minor) : null;
  const loading = <span className="dim">{DEAL_PROOF.loading}</span>;
  const house = e?.house_record ? houseRecordWord(e.house_record) : null;
  const fair = e?.fair_price ? fairPriceWords(e.fair_price, deal.terms.unit_price) : null;
  return (
    <div className="dv-proof">
      <button type="button" className="dv-pc" onClick={() => onOpen('paypal')}>
        <span className="k">{DEAL_PROOF.has}</span>
        <span className="v">
          {any ? (
            <span className="dv-refs">
              {shownRefs(deal).map((k) => {
                const l = DEAL_PROOF.refs[k];
                const id = deal.paypal[k];
                return <span key={k} className={`ref ${id ? 'has' : ''}`} title={id ? DEAL_PROOF.refTitle(l, id) : DEAL_PROOF.noRef(l)}><i aria-hidden="true" />{l}</span>;
              })}
            </span>
          ) : <span className="dv-none"><i aria-hidden="true" />{deal.state === 'REFUSED' ? DEAL_PROOF.neverSent : DEAL_PROOF.nothingSent}</span>}
        </span>
        <span className="why">{any ? DEAL_PROOF.idsOnly : deal.state === 'REFUSED' ? DEAL_PROOF.stopped : DEAL_PROOF.notCreated}</span>
      </button>
      <button type="button" className="dv-pc" onClick={() => onOpen('paypal')}>
        <span className="k">{DEAL_PROOF.receipt}</span>
        <span className="v">{ev.error ? <Chip tone="dashed">{DEAL_PROOF.cantLoad}</Chip> : evl ? <Chip tone={evl.tone} title={evl.why}>{evl.text}</Chip> : loading}</span>
        <span className="why">{evl?.why ?? ''}</span>
      </button>
      <button type="button" className="dv-pc" onClick={() => onOpen('books')}>
        <span className="k">{DEAL_PROOF.statement}</span>
        <span className="v">{ev.error ? <Chip tone="dashed">{DEAL_PROOF.cantLoad}</Chip> : rec ? <Chip tone={rec.tone} title={rec.why}>{rec.text}</Chip> : loading}</span>
        <span className="why">{rec?.why ?? ''}</span>
      </button>
      <button type="button" className="dv-pc" onClick={() => onOpen('market')}>
        <span className="k">{DEAL_PROOF.typical}</span>
        <span className="v">
          {mk ? <><MiniBand market={mk} price={deal.terms.unit_price} limit={limit} />
            <span title={sameCur ? `${marketPosition(deal.terms.unit_price.minor, mk.p25.minor, mk.median.minor, mk.p75.minor)} of ${formatMoney(mk.p25)}–${formatMoney(mk.p75)}` : undefined}>{mw ? mw.text : DEAL_PROOF.middle(formatMoney(mk.median))}</span></>
            : <span className="dv-none"><i aria-hidden="true" />{DEAL_PROOF.noComparison}</span>}
        </span>
        <span className="why">
          {mk ? DEAL_PROOF.similar(formatMoney(mk.p25), formatMoney(mk.p75)) : watch && !watch.usedUp ? DEAL_PROOF.noComparisonYet : DEAL_PROOF.noComparisonSkip}
          {fair ? <span className={`dv-fair ${fair.tone}`} title={fair.means}> {fair.text}.</span> : null}
          {watch ? <span className={`dv-fresh ${watch.usedUp ? 'used' : ''}`} title={watch.usedUp ? PRICE_CHECKS_USED_UP : `${priceChecksToday(watch.used, watch.max)}. ${DEAL_PROOF.watchFresh}`}> {watchWhy(watch, !!mk)}</span> : null}
        </span>
      </button>
      {house && e?.house_record ? (
        <button type="button" className={`dv-pc dv-pc-wide${house.warns ? ` warn ${house.tone}` : ''}`} onClick={() => onOpen('paypal')}>
          <span className="k">{HOUSE_RECORD_NAME}</span>
          <span className="v"><Chip tone={house.tone}>{house.text}</Chip>
            <span className="dim">{e.house_record.checked_at !== null ? DEAL_PROOF.compared(clockLabel(e.house_record.checked_at)) : DEAL_PROOF.kept(clockLabel(e.house_record.kept_at))}</span></span>
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
  const settings = useQuery('get_settings', null, { refreshOn: ['settings:changed'] });
  const e = ev.data;
  // The statement check is the owner's, read-only, and works on a deal PayPal's statement has not
  // matched yet: RECEIPTED, or UNCONFIRMED (a late match still counts). It needs the PayPal keys.
  const checkable = deal.state === 'RECEIPTED' || deal.state === 'UNCONFIRMED';
  const needsKeys = settings.data?.payment_executor_configured === false;
  const reconcile = checkable && needsKeys ? (
    <span className="ui-hint">{STATEMENT_CHECK_NEEDS_KEYS}</span>
  ) : checkable ? (
    <Btn className="left" disabled={rec.pending} title={DEAL_PROOF.checkTitle}
      onClick={async () => {
        const r = await rec.run({ deal_id: deal.id, ...statementWindow(deal, nowUnix()) });
        if (r) { onFresh(r); toast(DEAL_PROOF.statementToast(reconciliationLabel(r.reconciliation).text), r.reconciliation === 'matched' ? 'ok' : 'info'); }
      }}>{rec.pending ? DEAL_PROOF.checking : DEAL_PROOF.checkStatement}</Btn>
  ) : null;
  const done = <Btn kind="primary" onClick={onClose}>{DEAL_PROOF.done}</Btn>;
  const evidenceKv = e ? (
    <Kv items={[
      [DEAL_PROOF.receipt, <><Chip tone={evidenceLabel(deal, e.receipt).tone}>{evidenceLabel(deal, e.receipt).text}</Chip> {evidenceLabel(deal, e.receipt).why}</>],
      [DEAL_PROOF.statementShort, <><Chip tone={statementLabel(deal.state, e).tone}>{statementLabel(deal.state, e).text}</Chip> {statementLabel(deal.state, e).why}</>],
      e.house_record ? [HOUSE_RECORD_NAME, <><Chip tone={houseRecordWord(e.house_record).tone}>{houseRecordWord(e.house_record).text}</Chip> {houseRecordWord(e.house_record).means}</>] : null,
    ]} />
  ) : ev.error ? <WalletNotice error={ev.error} what={DEAL_PROOF.proof} /> : <Loading what={DEAL_PROOF.theProof} />;

  if (kind === 'paypal') {
    const keys = shownRefs(deal);
    const none = !deal.paypal.order && !deal.paypal.subscription;
    return (
      <Sheet title={DEAL_PROOF.records} size="wide" onClose={onClose} className="ar-deal-sheet" footer={<>{reconcile}{done}</>}>
        {none ? <p className="dv-p">{deal.state === 'REFUSED' ? DEAL_PROOF.refusedNone : DEAL_PROOF.nothingYet}</p> : (
          <table className="ui-table dv-table">
            <thead><tr><th>{DEAL_PROOF.record}</th><th>{DEAL_PROOF.paypalId}</th><th>{DEAL_PROOF.behind}</th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k}><td>{DEAL_PROOF.refs[k]}</td><td className="mono">{deal.paypal[k] ?? <span className="dim">{DEAL_PROOF.notYet}</span>}</td><td className="dim">{deal.paypal[k] ? attestOf(deal, k, e?.receipt ?? 'NONE') : ''}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="dv-gap">{evidenceKv}</div>
        {rec.error ? <WalletNotice error={rec.error} what={DEAL_PROOF.statementCheck} /> : null}
        <p className="ui-hint">{DEAL_PROOF.sellerSays}</p>
      </Sheet>
    );
  }
  if (kind === 'books') {
    return (
      <Sheet title={DEAL_PROOF.statement} onClose={onClose} className="ar-deal-sheet" footer={<>{reconcile}{done}</>}>
        {e ? (
          <>
            <p className="dv-p"><Chip tone={statementLabel(deal.state, e).tone}>{statementLabel(deal.state, e).text}</Chip></p>
            <p className="dv-p muted">{statementLabel(deal.state, e).why}</p>
          </>
        ) : ev.error ? <WalletNotice error={ev.error} what={DEAL_PROOF.proof} /> : <Loading what={DEAL_PROOF.theStatement} />}
        {rec.error ? <WalletNotice error={rec.error} what={DEAL_PROOF.statementCheck} /> : null}
      </Sheet>
    );
  }
  const mk = deal.market;
  const limit = band && deal.kind === 'haggle' ? (deal.side === 'buyer' ? (band.ceiling ? { label: DEAL_PROOF.mostPay, value: band.ceiling } : null) : (band.floor ? { label: DEAL_PROOF.leastAccept, value: band.floor } : null)) : null;
  const price = deal.terms.unit_price;
  const mw = mk && price.currency === mk.median.currency ? marketWords(price.minor, mk.p25.minor, mk.median.minor, mk.p75.minor) : null;
  const fair = e?.fair_price ? fairPriceWords(e.fair_price, price) : null;
  return (
    <Sheet title={DEAL_PROOF.typical} size="wide" onClose={onClose} className="ar-deal-sheet" footer={done}>
      {mk ? (
        <>
          <MarketBand market={mk} price={price} limit={limit} />
          <Kv className="dv-gap" items={[
            [DEAL_PROOF.thisDeal, mw ? <><b className="money">{formatMoney(price)}</b> · {mw.text}</> : <span className="dim">{formatMoney(price)} · {DEAL_PROOF.otherCurrency}</span>],
            [DEAL_PROOF.range, <span className="money">{DEAL_PROOF.rangeLine(formatMoney(mk.p25), formatMoney(mk.p75), formatMoney(mk.median))}</span>],
            [DEAL_PROOF.checked, `${clockLabel(mk.retrieved_at)}${mk.cached ? DEAL_PROOF.savedCopy : ''}`],
            fair && e?.fair_price ? [FAIR_PRICE_NAME, <><Chip tone={fair.tone} title={fair.means}>{fair.short}</Chip> {fair.text}. <span className="dim">{fair.means}</span></>] : null,
            ...(watch ? [[DEAL_PROOF.keptFresh, watch.usedUp ? <span className="gold">{PRICE_CHECKS_USED_UP}</span> : `${KEPT_FRESH} · ${priceChecksToday(watch.used, watch.max).toLowerCase()}`] as const] : []),
          ]} />
          <p className="ui-hint">{DEAL_PROOF.notAdvice}</p>
        </>
      ) : <p className="dv-p">{watch && !watch.usedUp ? DEAL_PROOF.noComparisonFirst(KEPT_FRESH) : DEAL_PROOF.noComparisonLong}</p>}
    </Sheet>
  );
}

/** The full record (one level down), with "Save signed proof": a file anyone can check with "Check
 *  a proof file" in the Book. */
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
    if (await proof.run({ deal_id: deal.id })) toast(DEAL_RECORD.saved, 'ok');
  };
  return (
    <Sheet title={DEAL_RECORD.title(label)} size="wide" onClose={onClose} className="ar-deal-sheet"
      footer={<>
        <Btn className="left" disabled={proof.pending} title={DEAL_RECORD.saveTitle} onClick={() => setConfirming(true)}>
          {proof.pending ? DEAL_RECORD.saving : DEAL_RECORD.save}
        </Btn>
        <Btn kind="primary" onClick={onClose}>{DEAL_PROOF.done}</Btn>
      </>}>
      {confirming ? (
        <Sheet title={DEAL_RECORD.confirmTitle} onClose={() => setConfirming(false)} className="ar-deal-sheet"
          footer={<><Btn onClick={() => setConfirming(false)}>{DEAL_RECORD.cancel}</Btn><Btn kind="primary" onClick={() => void save()}>{DEAL_RECORD.saveShort}</Btn></>}>
          <p className="dv-p">{DEAL_RECORD.anyone}</p>
          <ul className="dv-list">{PROOF_FILE_SHOWS.map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="dv-p">{PROOF_SAVE_WARNING}</p>
        </Sheet>
      ) : null}
      {proof.error ? <WalletNotice error={proof.error} what={DEAL_RECORD.failed} /> : null}
      <Kv items={[
        [DEAL_RECORD.messages, steps ? `${steps.length} · ${steps.every((s) => s.verified) ? DEAL_RECORD.everyChecked : DEAL_RECORD.someNot}` : '—'],
        [DEAL_RECORD.paypal, <span className="mono">{shownRefs(deal).map((k) => deal.paypal[k] ?? '—').join(' · ')}</span>],
        [DEAL_RECORD.mode, <ModeBadge mode={deal.mode} />],
        [DEAL_RECORD.recordId, <span className="mono">{shortId(deal.id, 6, 4)} · {shortHash(deal.transcript_head)}</span>],
      ]} />
      {error ? <WalletNotice error={error} what={DEAL_RECORD.unread} /> : !steps ? <Loading what={DEAL_RECORD.reading} /> : !sorted.length ? <Empty>{DEAL_RECORD.none}</Empty> : (
        <>
          {deal.kind === 'haggle' && priced ? <div className="dv-gap"><ConvergenceChart steps={sorted} band={band} market={deal.market} height={240} theirName={theirName} settled={!isLive(deal)} /></div> : null}
          <table className="ui-table dv-table dv-gap">
            <thead><tr><th>{DEAL_RECORD.who}</th><th>{DEAL_RECORD.what}</th><th className="num">{DEAL_RECORD.price}</th><th>{DEAL_RECORD.signature}</th><th>{DEAL_RECORD.when}</th></tr></thead>
            <tbody>
              {sorted.map((s) => {
                const w = stepWords(s, them);
                return (
                  <tr key={s.seq}>
                    <td className={`lane-${s.by}`}>{w.who}</td>
                    <td>{w.verb}</td>
                    <td className="num">{s.price ? formatMoney(s.price) : ''}</td>
                    <td>{s.verified ? <span className="okc">{DEAL_RECORD.checked}</span> : <span className="red">{DEAL_RECORD.notChecked}</span>}</td>
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
