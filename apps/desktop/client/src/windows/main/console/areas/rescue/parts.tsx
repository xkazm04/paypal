// Parts of the Rescue layer (rebuild WP3b): the one reading of the World and the wallet's rescue
// read, the hand-off to the approval window (the only place a fix is approved; a fix picked here
// travels as a draft the approval window shows and still decides), and a failed renewal as one
// decision: its fixes as a radio group with "Do nothing" picked at the start (silence never moves
// money), what the subscriber would get, why some fixes are not offered, and what the picked fix
// does. A plan-wide price change is the one thing never offered.
import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { Money } from '@bindings/Money';
import type { RescueBook } from '@bindings/RescueBook';
import type { RescueOffer } from '@bindings/RescueOffer';
import type { RescueView } from '@bindings/RescueView';
import { clockLabel, formatMinor, formatMoney } from '../../../../../lib/format';
import { useMutation, useNow, useQuery } from '../../../../../lib/hooks';
import { APPROVAL_LOCKED_TITLE, notOfferedLine, percentWords, RESCUE, RESCUE_APPROVE_DOES, rescueSourceWord, silenceWords, stateWord, subscriberName, timeLeftWords } from '../../../../../lib/words';
import { ModeBadge, WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, Hourglass, Icon, Kv, Why, type ChipTone } from '../../../../../shared/ui';
import { chipClass, dealTotal, moneyNow, type ChipClass } from '../../../logic';
import { cellState, COLS, isReplay, leverOf, moveCell, paypalRetry, pickable, rulesFor, splitFixes, splitRows, viewFor, type Col, type LeverKey, type Rows } from '../../../modules/rescue/model';
import { FixGet, FixGetOff, FixWhy } from '../../../modules/rescue/Panels';
import { fixQuestion, fixWhy, previewFor } from '../../../modules/rescue/preview';
import { useCpLookup } from '../../../ui';
import { useDeals, useLocked, useNeeds, useWorldSelector, type World } from '../../../world';

const NO_DEALS: readonly Deal[] = [];
const selDisplay = (w: World) => w.display;

export type RescueWorld = {
  loaded: boolean;
  error: ReturnType<typeof useDeals>['error'];
  all: readonly Deal[];
  rows: Rows;
  book: RescueBook | null;
  bookError: ReturnType<typeof useQuery<'rescue_book'>>['error'];
  need: (d: Deal) => AttentionItem | undefined;
  deadline: (d: Deal) => number | null;
  /** A subscriber has no wallet: named by their subscription when the wallet has no entry. */
  name: (d: Deal) => string;
  title: (d: Deal) => string;
  view: (d: Deal) => RescueView | undefined;
};

export function useRescueWorld(): RescueWorld {
  const q = useDeals();
  const all = q.data ?? NO_DEALS;
  const needs = useNeeds();
  const cp = useCpLookup();
  const display = useWorldSelector(selDisplay);
  const rq = useQuery('rescue_book', null, { refreshOn: ['deal:changed', 'receipt:created', 'attention:changed'] });
  // The watch list changes in the approval window; read it again when this window is back in front.
  const refetch = rq.refetch;
  useEffect(() => {
    const again = () => void refetch();
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, [refetch]);
  const byId = useMemo(() => new Map(needs.map((n) => [n.deal_id, n] as const)), [needs]);
  const deadline = useMemo(() => (d: Deal) => byId.get(d.id)?.deadline ?? display(d).deadline, [byId, display]);
  const rows = useMemo(() => splitRows(all, deadline), [all, deadline]);
  const book = rq.data ?? null;
  const error = q.error;
  const loaded = !!q.data;
  const bookError = rq.error;
  return useMemo(() => ({
    loaded, error, all, rows, book, bookError, deadline,
    need: (d: Deal) => byId.get(d.id),
    name: (d: Deal) => { const c = cp(d.counterparty); return c.known ? c.name : subscriberName(d.counterparty) ?? c.name; },
    title: (d: Deal) => display(d).title,
    view: (d: Deal) => viewFor(book, d.id),
  }), [loaded, error, all, rows, book, bookError, deadline, byId, cp, display]);
}

const TONE: Record<ChipClass, ChipTone | undefined> = { live: 'teal', wait: 'coral', held: 'coral', done: 'ok', bad: 'red', off: undefined };
export const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The deal's state in words (a failing renewal reads "Renewal failed"). */
export function RescueState({ deal }: { deal: Deal }) {
  const wd = stateWord(deal.state, { side: deal.side, kind: deal.kind });
  return <Chip tone={TONE[chipClass(deal)]} title={wd.means}>{wd.text}</Chip>;
}

/** Whether this rescue counts as money you got back, in the wallet's words. */
export function CountChip({ deal, view }: { deal: Deal; view: RescueView | undefined }) {
  if (view?.counted) return <Chip tone="ok" title={RESCUE.counted}>{RESCUE.countChip.counts}</Chip>;
  if (chipClass(deal) === 'done' || deal.mode === 'replay') return <Chip tone="line" title={deal.mode === 'replay' ? RESCUE.replayNotCounted : RESCUE.unverified}>{RESCUE.countChip.not}</Chip>;
  if (deal.state === 'AWAITING_APPROVAL' || deal.state === 'SETTLING') return <Chip tone="line" title={RESCUE.sentNotCounted}>{RESCUE.countChip.notPaid}</Chip>;
  return null;
}

/** One line for a rescue that no longer waits on a fix. */
export function deskLine(d: Deal, view: RescueView | undefined): string {
  if (d.state === 'SETTLING') return RESCUE.desk.making;
  if (d.state === 'AWAITING_APPROVAL') return RESCUE.desk.sent(view?.recipient ?? null);
  if (view?.counted) return RESCUE.desk.paidVerified;
  if (chipClass(d) === 'done') return d.mode === 'replay' ? RESCUE.desk.paidReplay : RESCUE.desk.paid;
  return moneyNow(d);
}

/** Hands the decision to the approval window (approval_open), with the picked fix as a draft. */
export function HandOff({ deal, lever, quiet, sm }: { deal: Deal; lever?: LeverKey; quiet?: boolean; sm?: boolean }) {
  const open = useMutation('approval_open');
  const locked = useLocked();
  const args = lever ? { deal_id: deal.id, target: 'deal' as const, draft: { type: 'lever' as const, lever } } : { deal_id: deal.id };
  return (
    <>
      <Btn kind={quiet ? 'default' : 'gold'} sm={sm} locked={locked} disabled={open.pending} onClick={() => void open.run(args)} data-fk="rescue-handoff"
        title={locked ? APPROVAL_LOCKED_TITLE : RESCUE.handoffTitle}>
        {lever ? RESCUE.reviewFix(leverOf(lever).short.toLowerCase()) : RESCUE.review} <span aria-hidden="true">↗</span>
      </Btn>
      {open.error ? <WalletNotice error={open.error} what={RESCUE.approvalWhat} /> : null}
    </>
  );
}

const coarse = (deadline: number, now: number) => timeLeftWords(deadline - now).replace(/ \d+ h$/, '');

/** The fixes this renewal can't have, as one quiet line; Why? lists each one with its reason. */
function NotOffered({ off, amount, retryAt, replay, offer }: { off: ReturnType<typeof splitFixes>['off']; amount: Money; retryAt: number | null; replay: boolean; offer: RescueOffer | undefined }) {
  return (
    <div className="rs-notoff">
      <span>{notOfferedLine(off.map((o) => RESCUE.pick[o.col].name))}</span>
      <Why question={RESCUE.whyNotOffered}>
        <ul className="rs-notoff-list">
          {off.map((o) => <li key={o.col}><b>{RESCUE.pick[o.col].name}</b> · {fixWhy(o.col, { amount, retryAt, replay, offCode: o.code, offer })[0]}</li>)}
        </ul>
        <p>{replay ? RESCUE.nothingSafeReplay : RESCUE.nothingSafe}</p>
      </Why>
    </div>
  );
}

const MARK: Record<Col, ReactNode> = {
  NONE: <Hourglass />,
  DISCOUNT_THIS_CYCLE: <span className="mk">%</span>,
  PAUSE: <span className="mk">❚❚</span>,
  RETRY_AFTER_FIX: <span className="mk">↻</span>,
  DOWNGRADE: <span className="mk">↓</span>,
};

/** The fixes of one renewal as a radio group: arrow keys and 0-4 move between the open ones. Every
 *  "PayPal retries" claim reads PayPal's own retry time (`retry`), never the fix's deadline. */
function Picks({ deal, view, col, onPick }: { deal: Deal; view: RescueView | undefined; col: Col; onPick: (c: Col) => void }) {
  const now = useNow();
  const retry = paypalRetry(view, now);
  const replay = isReplay(deal, view);
  const box = useRef<HTMLDivElement>(null);
  const off = (c: Col) => !pickable(cellState(deal, c, retry, now, view));
  const go = (to: Col) => { onPick(to); box.current?.querySelector<HTMLButtonElement>(`[data-col="${to}"]`)?.focus(); };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, from: Col) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.key === 'ArrowDown' ? 'ArrowRight' : e.key === 'ArrowUp' ? 'ArrowLeft' : e.key;
    let to = moveCell([deal.id], { id: deal.id, col: from }, step)?.col ?? null;
    if (!to) return;
    e.preventDefault();
    e.stopPropagation(); // digits pick a fix here, not a module (the console's 1-6)
    if (step === 'ArrowRight' || step === 'ArrowLeft') while (to && off(to)) to = moveCell([deal.id], { id: deal.id, col: to }, step)?.col ?? null;
    else if (step === 'End') while (to && off(to)) to = moveCell([deal.id], { id: deal.id, col: to }, 'ArrowLeft')?.col ?? null; // the last OPEN fix
    if (to && !off(to)) go(to);
  };
  const amount = view?.offer.cycle ?? dealTotal(deal);
  const fixes = splitFixes(deal, retry, now, view);
  return (
    <>
      <div className="rs-picks" role="radiogroup" aria-label={RESCUE.picksLabel} ref={box}>
        {fixes.open.map((c) => {
          const st = cellState(deal, c, retry, now, view);
          const isOff = !pickable(st);
          const on = c === col && !isOff;
          const does = c === 'NONE' ? (replay ? RESCUE.replayNoRetry : retry ? RESCUE.retriesIn(coarse(retry, now)) : RESCUE.retriesOwn)
            : st.kind === 'offer' ? RESCUE.offerLine(percentWords(st.offer.discount_bp), formatMoney(st.offer.invoice), formatMoney(st.offer.cycle))
              : st.kind === 'off' ? RESCUE.whyOff[st.code as keyof typeof RESCUE.whyOff] ?? st.why : st.kind === 'unknown' ? st.why : '';
          return (
            <div key={c} className={`rs-fix ${on ? 'on' : ''} ${c === 'NONE' ? 'def' : ''} ${isOff ? 'off' : ''}`}>
              <button type="button" role="radio" data-col={c} aria-checked={on} disabled={isOff} tabIndex={on ? 0 : -1}
                className={`rs-pick ${on ? 'on' : ''} ${c === 'NONE' ? 'def' : ''} ${isOff ? 'off' : ''}`} onClick={() => onPick(c)} onKeyDown={(e) => onKey(e, c)}
                title={c === 'NONE' ? RESCUE.defaultTitle : st.kind === 'off' || st.kind === 'unknown' ? st.why : `${leverOf(c).name}: ${leverOf(c).effect}`}>
                <span className="mk">{MARK[c]}</span>
                <span className="l">{c === 'NONE' ? RESCUE.doNothing : RESCUE.pick[c].name}</span>
                <span className="m">{does}</span>
                {on ? <span className="tick"><Icon name="check" size={14} label={RESCUE.selected} /></span> : null}
              </button>
              {isOff ? <FixGetOff /> : <FixGet preview={previewFor(c, { item: deal.terms.item_ref, amount, retryAt: retry, replay, view })} />}
              <div className="rs-why"><FixWhy question={fixQuestion(c)} lines={fixWhy(c, { amount, retryAt: retry, replay, offCode: st.kind === 'off' ? st.code : undefined, offer: view?.offer })} /></div>
            </div>
          );
        })}
      </div>
      {fixes.off.length ? <NotOffered off={fixes.off} amount={amount} retryAt={retry} replay={replay} offer={view?.offer} /> : null}
    </>
  );
}

/** What the picked fix does, its checks and what the subscriber sees (one level down). */
function FixDetail({ deal, view, col }: { deal: Deal; view: RescueView | undefined; col: Col }) {
  const now = useNow();
  const retry = paypalRetry(view, now);
  if (col === 'NONE') {
    return (
      <ul className="rs-rules">
        <li className="ok">{RESCUE.nothingDoes.sent}</li>
        <li className="ok">{isReplay(deal, view) ? RESCUE.nothingDoes.replay : retry ? RESCUE.nothingDoes.retry(timeLeftWords(retry - now), clockLabel(retry)) : RESCUE.nothingDoes.noRetry}</li>
        <li className="ok">{RESCUE.nothingDoes.never}</li>
      </ul>
    );
  }
  const lever = leverOf(col);
  const st = cellState(deal, col, retry, now, view);
  const offer = st.kind === 'offer' ? st.offer : null;
  return (
    <div className="rs-fixdetail">
      <p>{offer ? RESCUE.fix.does(formatMoney(offer.invoice), formatMoney(offer.cycle), percentWords(offer.discount_bp)) : st.kind === 'off' || st.kind === 'unknown' ? `${lever.effect}. ${st.why}.` : `${lever.effect}.`}</p>
      <p className="rs-h">{RESCUE.fix.checks}</p>
      <ul className="rs-rules">{rulesFor(deal, col, retry, now, view).map(([k, t]) => <li key={t} className={k}>{t}</li>)}</ul>
      <p className="rs-h">{RESCUE.fix.sees}</p>
      {offer && view ? (
        <div className="rs-inv" aria-label={RESCUE.fix.wording}>
          <p className="it">{view.text.item}</p>
          <p className="nt">{view.text.note}</p>
          <p className="ui-hint">{RESCUE.fix.emails(view.recipient)}</p>
        </div>
      ) : <p>{lever.hears}.</p>}
      <details className="ui-disclosure"><summary>{RESCUE.fix.calls}</summary>
        <div className="ui-disclosure-body"><ul className="rs-calls">{lever.calls.map((c) => <li key={c}>{c}</li>)}</ul></div>
      </details>
    </div>
  );
}

/** One failed renewal as one decision: the fixes, the hand-off carrying the picked one, the default. */
export function FixPanel({ deal, r, col, onPick, onDeal }: { deal: Deal; r: RescueWorld; col: Col; onPick: (c: Col) => void; onDeal: () => void }) {
  const now = useNow();
  const need = r.need(deal);
  const view = r.view(deal);
  const deadline = r.deadline(deal);
  const t = view?.offer.cycle ?? dealTotal(deal);
  const lever = col !== 'NONE' && pickable(cellState(deal, col, paypalRetry(view, now), now, view)) ? col : undefined;
  return (
    <div className="rs-panel">
      <p className="kicker"><span className="rs-ctx" title={r.title(deal)}>{r.title(deal)}</span>{deal.mode !== 'sandbox' ? <ModeBadge mode={deal.mode} /> : null}
        {view && view.source !== 'replay' && deal.mode === 'sandbox' ? <Chip tone="line" title={RESCUE.reportedTitle}>{rescueSourceWord(view.source).toLowerCase()}</Chip> : null}</p>
      <div className="rs-q">
        <h2 className="rs-h2">{RESCUE.question(cap(r.name(deal)))}</h2>
        <span className="rs-amt num">{formatMinor(t.minor, t.currency)}</span>
      </div>
      <p className="rs-why-l">{RESCUE.whyLine}{view ? <> {RESCUE.invoiceTo} <span className="mono">{view.recipient}</span>.</> : null}</p>
      <Picks deal={deal} view={view} col={col} onPick={onPick} />
      <div className="cs-acts rs-acts">
        {need ? <HandOff deal={deal} lever={lever} /> : null}
        <Btn kind="plain" onClick={onDeal}>{RESCUE.openDeal}</Btn>
      </div>
      {need ? <p className="ui-hint">{RESCUE_APPROVE_DOES}</p> : null}
      <p className="rs-sil"><Hourglass /> <span>{RESCUE.ifNothing}: <b>{isReplay(deal, view) ? RESCUE.replaySilence : need ? silenceWords(need.on_silence) : RESCUE.defaultSilence}</b></span></p>
      {deadline ? <p className="ui-hint rs-close">{RESCUE.closes(clockLabel(deadline), timeLeftWords(deadline - now))}</p> : null}
      <details className="ui-disclosure rs-more"><summary>{col === 'NONE' ? RESCUE.fix.aboutNone : RESCUE.fix.about(RESCUE.pick[col].name)}</summary>
        <div className="ui-disclosure-body"><FixDetail deal={deal} view={view} col={col} /></div>
      </details>
    </div>
  );
}

/** A rescue that no longer waits on a fix: money, state, the fix, its source, the default. */
export function DeskDetail({ deal, r, onDeal }: { deal: Deal; r: RescueWorld; onDeal: () => void }) {
  const need = r.need(deal);
  const view = r.view(deal);
  const deadline = r.deadline(deal);
  const t = dealTotal(deal);
  return (
    <div className="rs-panel">
      <h2 className="rs-h2" title={r.name(deal)}>{cap(r.name(deal))}</h2>
      <div className="rs-chips"><RescueState deal={deal} />{deal.mode !== 'sandbox' ? <ModeBadge mode={deal.mode} /> : null}<CountChip deal={deal} view={view} /></div>
      <Kv items={[
        [RESCUE.k.what, r.title(deal)],
        [RESCUE.k.money, <><span className="money">{formatMinor(t.minor, t.currency)}</span> · {deskLine(deal, view).toLowerCase()}</>],
        view ? [RESCUE.k.fix, RESCUE.k.fixLine(percentWords(view.offer.discount_bp), formatMoney(view.offer.cycle))] : null,
        view ? [RESCUE.k.source, rescueSourceWord(view.source)] : null,
        deadline ? [RESCUE.k.deadline, clockLabel(deadline)] : null,
        need ? [RESCUE.ifNothing, need.on_silence] : null,
      ]} />
      <div className="cs-acts">{need ? <HandOff deal={deal} sm /> : null}<Btn sm onClick={onDeal}>{RESCUE.openDeal}</Btn></div>
    </div>
  );
}

/** The fixes of one renewal as short cells, for the side-by-side comparison row (text only: the
 *  row is the button; picking happens in the panel beside it). */
export function CompareCells({ deal, r }: { deal: Deal; r: RescueWorld }) {
  const now = useNow();
  const view = r.view(deal);
  const retry = paypalRetry(view, now);
  return (
    <>
      {COLS.map((c) => {
        const st = cellState(deal, c, retry, now, view);
        const [v, s] = st.kind === 'default' ? [RESCUE.cmp.nothingSent, isReplay(deal, view) ? RESCUE.cmp.replay : retry ? RESCUE.cmp.retry(coarse(retry, now)) : RESCUE.cmp.noRetry]
          : st.kind === 'offer' ? [formatMoney(st.offer.invoice), RESCUE.cmp.off(percentWords(st.offer.discount_bp))]
            : st.kind === 'off' && st.code !== 'NOT_BUILT' ? [RESCUE.cmp.notNow, st.code === 'REPLAY' ? RESCUE.cmp.replay : RESCUE.cmp.retrySoon] : [RESCUE.cmp.notYet, RESCUE.cmp.gist[c as LeverKey]];
        return <span key={c} className={`rs-cell k-${st.kind}`} title={st.kind === 'off' || st.kind === 'unknown' ? st.why : undefined}><small className="h">{RESCUE.cmp.head[c]}</small><b>{v}</b><small>{s}</small></span>;
      })}
    </>
  );
}
