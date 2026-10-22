// The decision centre: the console's first layer. One decision at a time, in Rust's order: what it
// is and how much, with whom, what happens if the owner does nothing, and ONE gold action. That
// action only opens the approval window (approval_open), exactly as the Dial home's plate did;
// money is released there and nowhere else. Nothing here says "approved": the centre changes only
// when the wallet's events say the decision changed (deal:changed, attention:changed, receipt:created).
// Beside it the seal (the wallet's state, from the facts) and the small Dial strip; under it the
// next decisions, and in any free slot what happened while the owner was away and what the wallet
// is watching, so the row never stands empty.
import { NOTICE_UNREAD, NOTICE_WHAT } from '../../../lib/words';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import { formatMinor } from '../../../lib/format';
import { useMutation, useNow } from '../../../lib/hooks';
import {
  allWaiting, APPROVAL_LOCKED_TITLE, BRAND_NAME, APPROVAL_OPEN_TITLE, AWAY_KICKER, CENTRE_EMPTY, CENTRE_READING, DECISION_OF, decisionOfLabel, IF_NOTHING, LATER, LATER_TITLE,
  houseWords, moneyCheckNow, moneyCheckPill, NEXT_DECISION, NEXT_IN_STACK, NO_COUNTERPARTY, NO_DEADLINE, NOTHING_ELSE_WAITS, OPEN_BOOK, OPEN_THE_DEAL, PREV_DECISION,
  REWIND_TITLE, ruleNameOf, SEAL_RING, sealLabel, SEE_REWIND, TITLE_UNKNOWN, watchingKicker, watchingLine, WHO_UNKNOWN, WHY, WHY_LABEL, yourRule,
} from '../../../lib/words';
import { Seal } from '../../../shared/brand';
import { Countdown, WalletNotice } from '../../../shared/honesty';
import { MODULE } from '../../../shared/modules';
import { Btn, Facts, Kv, layerCount } from '../../../shared/ui';
import { moneyCheckEnded } from '../../tumbler/logic';
import { useAway } from '../home/useAway';
import { shortTitle, silenceParts, timeLeft } from '../home/model';
import { isTerminal, moneyNow, reviewVerb, splitHeadline, stateLabel } from '../logic';
import { mc } from '../ui';
import { useDeals, useDisplayOf, useLocked, useWorldHealth, useWorldReady, useWorldSelector, type Display, type World } from '../world';
import { BeadStrip } from './BeadStrip';
import { centreFacts, deadlineProgress, stackRows, stackSlots, type Presence } from './centreModel';
import { useWatching } from './ledger';
import { Reveal, Skeleton } from './stagger';

export type CentreProps = {
  /** The queue in the centre's order (centre.ts orderQueue). */
  queue: readonly AttentionItem[];
  /** Index of the decision in front (-1 when nothing waits). */
  cur: number;
  presence: Presence;
  onPick: (dealId: string) => void;
  onCycle: (d: 1 | -1) => void;
  onLater: () => void;
  onDeal: (id: string) => void;
  onWaiting: () => void;
  onRewind: () => void;
  onBook: () => void;
};

const NO_DEALS: readonly Deal[] = [];
const selModuleOf = (w: World) => w.moduleOfDeal;

export function Centre(p: CentreProps) {
  const ready = useWorldReady();
  const health = useWorldHealth();
  const deals = useDeals().data ?? NO_DEALS;
  const top = p.cur >= 0 ? p.queue[p.cur] : undefined;
  const away = useAway({ active: true, enabled: ready, needs: p.queue.length, deals });
  const watching = useWatching();

  // Left / Right walk the queue while no sheet, popover or Find is open and nothing is being typed.
  const cycle = useRef(p.onCycle);
  cycle.current = p.onCycle;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || layerCount() > 0) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || t.closest('[role="tablist"]'))) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); cycle.current(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); cycle.current(-1); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  if (!ready) {
    const err = health.dealsError ?? health.attentionError ?? health.settingsError;
    return (
      <div className="cs-centre loading">
        <p className="kicker">{BRAND_NAME}</p>
        <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{CENTRE_READING}</h1>
        {err ? <WalletNotice error={err} message={NOTICE_UNREAD} what={health.dealsError ? NOTICE_WHAT.ledger : health.attentionError ? NOTICE_WHAT.needs : NOTICE_WHAT.settings} /> : null}
      </div>
    );
  }

  // The decision (and the seal beside it) is wave 0; the stack row under it takes its turn (stagger.tsx).
  const fill = (
    <Reveal wave={1} sizeKey="centre:stack" skeleton={<Skeleton className="cs-also" h="7rem" />}>
      <StackRow queue={p.queue} cur={p.cur} away={away.summary} moving={watching.moving} onPick={p.onPick} onDeal={p.onDeal} onWaiting={p.onWaiting} onRewind={p.onRewind} />
    </Reveal>
  );

  if (!top) {
    return (
      <div className="cs-centre empty">
        <div className="cs-cgrid">
          <div className="cs-cmain">
            <p className="kicker">{CENTRE_EMPTY.kicker}</p>
            <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{CENTRE_EMPTY.title}</h1>
            <p className="cs-who">{watchingLine(watching.moving.length, watching.heldText)}</p>
            <div className="cs-acts">
              <Btn onClick={p.onRewind}>{REWIND_TITLE}</Btn>
              <Btn kind="plain" onClick={p.onBook}>{OPEN_BOOK}</Btn>
            </div>
          </div>
          <SealSide presence={p.presence} progress={null} onDeal={p.onDeal} />
        </div>
        {fill}
      </div>
    );
  }

  return (
    <div className="cs-centre" style={mc(top.module)}>
      <div className="cs-cgrid">
        <Decision key={top.deal_id} item={top} index={p.cur} count={p.queue.length} onLater={p.onLater} onDeal={p.onDeal} />
        <DecisionSeal item={top} presence={p.presence} onDeal={p.onDeal} />
      </div>
      {fill}
      {p.queue.length > 1 ? (
        <div className="cs-pagers">
          <button type="button" className="cs-pager prev" onClick={() => p.onCycle(-1)} aria-label={PREV_DECISION} title={PREV_DECISION}>‹</button>
          <button type="button" className="cs-pager next" onClick={() => p.onCycle(1)} aria-label={NEXT_DECISION} title={NEXT_DECISION}>›</button>
        </div>
      ) : null}
    </div>
  );
}

function DecisionSeal({ item, presence, onDeal }: { item: AttentionItem; presence: Presence; onDeal: (id: string) => void }) {
  const deal = useDeals().data?.find((d) => d.id === item.deal_id);
  const now = useNow();
  return <SealSide presence={presence} progress={deadlineProgress(item.deadline, deal?.created_at, now)} onDeal={onDeal} />;
}

function SealSide({ presence, progress, onDeal }: { presence: Presence; progress: number | null; onDeal: (id: string) => void }) {
  return (
    <div className="cs-cseal">
      <Seal state={presence.state} progress={progress} label={sealLabel(presence.word, presence.line)} ring={SEAL_RING} />
      <div className="cs-sealword" aria-hidden="true"><b>{presence.word}</b><span>{presence.line}</span></div>
      <Reveal wave={2} sizeKey="centre:beads" skeleton={<Skeleton className="cs-strip" h="2rem" />}><BeadStrip onDeal={onDeal} /></Reveal>
    </div>
  );
}

/** The decision in front: the sentence, the default on silence, one gold action, the facts. */
function Decision({ item, index, count, onLater, onDeal }: { item: AttentionItem; index: number; count: number; onLater: () => void; onDeal: (id: string) => void }) {
  const locked = useLocked();
  const open = useMutation('approval_open');
  const deal = useDeals().data?.find((d) => d.id === item.deal_id);
  const disp = useDisplayOf(item.deal_id);
  const now = useNow();
  const amount = formatMinor(item.amount_minor, item.currency);
  const [verb, gold] = splitHeadline(item.headline, amount);
  const left = timeLeft(item.deadline, now);
  const canReview = item.actions.includes('review');
  const who = item.counterparty ? houseWords(item.counterparty) : null;
  const title = disp ? shortTitle(disp.title) : null;
  const facts = useMemo(() => centreFacts(item, deal, now), [item, deal, now]);
  const ticks = Math.min(count, 6);
  return (
    <div className="cs-cmain cs-decision">
      <div className="cs-dhead">
        <div className="cs-toprow">
          <span className="cs-idx" aria-label={decisionOfLabel(index + 1, count)}>
            <span className="tk" aria-hidden="true">{Array.from({ length: ticks }, (_, i) => <i key={i} className={i === Math.min(index, ticks - 1) ? 'on' : undefined} />)}</span>
            <span aria-hidden="true">{DECISION_OF(index + 1, count)}</span>
          </span>
          <span className="cs-mod" style={mc(item.module)}><i aria-hidden="true" />{MODULE[item.module].name}</span>
          {left ? <span className={`cs-left ${left.urgent || item.urgency === 'now' ? 'now' : ''}`}>{left.text}</span> : <span className="cs-left dim">{NO_DEADLINE}</span>}
        </div>
        <p className="kicker">{MODULE[item.module].long}</p>
        <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{verb}{gold ? <> <em className="amt">{gold}</em></> : null}</h1>
        <p className="cs-who">{who || title ? <>{who ? <span>{who}</span> : null}{who && title ? ' · ' : null}{title}</> : <span className="dim">{NO_COUNTERPARTY}</span>}</p>
      </div>
      <div className="cs-dmid">
        <SilenceLine item={item} />
        <div className="cs-acts">
          {canReview ? (
            <Btn kind="gold" className="cs-gold" locked={locked} disabled={open.pending} onClick={() => void open.run({ deal_id: item.deal_id })}
              title={locked ? APPROVAL_LOCKED_TITLE : APPROVAL_OPEN_TITLE}>
              {reviewVerb(item, deal)} <span aria-hidden="true">↗</span>
            </Btn>
          ) : (
            <Btn kind="gold" className="cs-gold" onClick={() => onDeal(item.deal_id)} data-fk="open-deal">{OPEN_THE_DEAL}</Btn>
          )}
          <Btn kind="plain" onClick={onLater} title={LATER_TITLE} data-fk="later">{LATER}</Btn>
          {canReview ? <Btn kind="plain" onClick={() => onDeal(item.deal_id)} data-fk="open-deal">{OPEN_THE_DEAL}</Btn> : null}
          <WhyDisclosure item={item} deal={deal} disp={disp} />
        </div>
        {open.error ? <WalletNotice error={open.error} what={NOTICE_WHAT.approval} /> : null}
      </div>
      <Facts items={facts} className="cs-facts" />
    </div>
  );
}

/** "⧗ If you do nothing: the offer lapses at 18:00 · no money moves". A payment whose deal already
 *  ended without PayPal showing what happened has no such frame: nothing waits on the owner's
 *  silence any more (DECISIONS section 32), so its sentence stands alone. */
function SilenceLine({ item }: { item: AttentionItem }) {
  const { head, rest } = silenceParts(item.on_silence);
  if (moneyCheckEnded(item)) return <p className="cs-silence ended"><span><b>{head}</b>{rest ? <> · {rest}</> : null}</span></p>;
  // The countdown is its own chip after the sentence (it never wraps inside the words).
  return (
    <p className="cs-silence" title={`${IF_NOTHING}: ${item.on_silence}`}>
      <Hourglass /><span className="txt">{IF_NOTHING}: <b>{head}</b>{rest ? <> · {rest}</> : null}</span>
      {item.deadline ? <span className="cs-sil-cd"><Countdown deadline={item.deadline} /></span> : null}
    </p>
  );
}

function Hourglass() {
  return <svg viewBox="0 0 12 14" aria-hidden="true" focusable="false"><path d="M2 1h8M2 13h8M3 1c0 4 6 4 6 6s-6 2-6 6M9 1c0 4-6 4-6 6s6 2 6 6" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>;
}

/** Why? the old Details popover's facts, as a disclosure in place (one layer down, never a permanent hint). */
function WhyDisclosure({ item, deal, disp }: { item: AttentionItem; deal: Deal | undefined; disp: Display | undefined }) {
  const ended = deal ? isTerminal(deal) : false;
  // It opens over the row below like a popover, so Escape closes it first (focus back on Why?)
  // and the console's own Escape does not run.
  const ref = useRef<HTMLDetailsElement>(null);
  const onKey = (e: ReactKeyboardEvent<HTMLDetailsElement>) => {
    const d = ref.current;
    if (e.key !== 'Escape' || e.defaultPrevented || !d?.open) return;
    e.preventDefault();
    d.open = false;
    d.querySelector<HTMLElement>('summary')?.focus();
  };
  return (
    <details className="cs-why" ref={ref} onKeyDown={onKey}>
      <summary>{WHY}</summary>
      <div className="pop">
        <Kv items={[
          [WHY_LABEL.item, disp ? disp.title : <span className="dim">{TITLE_UNKNOWN}</span>],
          [WHY_LABEL.with, item.counterparty ? houseWords(item.counterparty) : <span className="dim">{WHO_UNKNOWN}</span>],
          deal ? [WHY_LABEL.status, item.money_check ? moneyCheckPill(item.money_check, ended).text : stateLabel(deal.state, deal)] : null,
          [WHY_LABEL.asks, item.headline],
          item.clause ? [WHY_LABEL.why, yourRule(ruleNameOf(item.clause.number))] : null,
          deal ? [WHY_LABEL.money, item.money_check ? moneyCheckNow(ended) : moneyNow(deal)] : null,
          item.deadline ? [WHY_LABEL.time, <Countdown deadline={item.deadline} />] : null,
          [IF_NOTHING, item.on_silence],
        ]} />
      </div>
    </details>
  );
}

// ---- the stack row --------------------------------------------------------------------------------

/** How many cards fit: 2 / 4 / 6 a row by the window's width, and a second row on a tall, wide
 *  window (more of the queue in view instead of an empty band), following resizes. */
function readSlots(): { cols: number; cap: number } {
  const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const h = typeof window === 'undefined' ? 800 : window.innerHeight;
  const cols = stackSlots(w);
  return { cols, cap: cols * stackRows(w, h) };
}
function useSlots(): { cols: number; cap: number } {
  const [n, setN] = useState(readSlots);
  useEffect(() => {
    const on = () => setN((was) => { const x = readSlots(); return x.cols === was.cols && x.cap === was.cap ? was : x; });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return n;
}

type Card = { key: string; kicker: ReactNode; body: ReactNode; sub?: ReactNode; color: string; fill: boolean; go: () => void; title?: string };

function StackRow({ queue, cur, away, moving, onPick, onDeal, onWaiting, onRewind }: {
  queue: readonly AttentionItem[]; cur: number; away: ReturnType<typeof useAway>['summary']; moving: readonly Deal[];
  onPick: (id: string) => void; onDeal: (id: string) => void; onWaiting: () => void; onRewind: () => void;
}) {
  const { cols, cap: slots } = useSlots();
  const now = useNow();
  const moduleOfDeal = useWorldSelector(selModuleOf);
  const next = queue.length > 1 ? Math.min(slots, queue.length - 1) : 0;
  const cards: Card[] = [];
  for (let i = 1; i <= next; i++) {
    const n = queue[(cur + i) % queue.length];
    if (!n) continue;
    const left = timeLeft(n.deadline, now);
    const amount = formatMinor(n.amount_minor, n.currency);
    const [verb, gold] = splitHeadline(n.headline, amount);
    cards.push({
      key: `n-${n.deal_id}`, color: MODULE[n.module].cssVar, fill: false, go: () => onPick(n.deal_id),
      kicker: <>{MODULE[n.module].name}{left ? <> · {left.text}</> : null}</>,
      body: <>{verb}{gold ? <> <em className="amt">{gold}</em></> : null}</>,
      sub: n.counterparty ? houseWords(n.counterparty) : undefined,
    });
  }
  // Free slots: what happened while the owner was away, then what the wallet is watching.
  for (const l of away?.lines ?? []) {
    if (cards.length >= slots) break;
    const one = l.deals.length === 1 ? l.deals[0] : undefined;
    cards.push({
      key: `a-${l.key}`, color: l.tone === 'stopped' ? 'var(--red)' : l.tone === 'in' || l.tone === 'out' ? 'var(--ok)' : 'var(--steel)', fill: true,
      go: () => (one ? onDeal(one) : onRewind()), title: l.text,
      kicker: AWAY_KICKER, body: <>{l.before}{l.amount ? <b className="amt">{l.amount}</b> : null}{l.after}</>,
    });
  }
  for (const d of moving) {
    if (cards.length >= slots) break;
    cards.push({ key: `w-${d.id}`, color: 'var(--teal)', fill: true, go: () => onDeal(d.id), kicker: watchingKicker(MODULE[moduleOfDeal(d)].name), body: <WatchBody deal={d} /> });
  }
  if (!cards.length) return null;
  const head = next ? NEXT_IN_STACK : queue.length ? NOTHING_ELSE_WAITS : AWAY_KICKER;
  return (
    <section className="cs-also" aria-label={head}>
      <div className="cs-alsoh">
        <h2 className="cs-h3">{head}</h2>
        <span className="ui-spacer" />
        {queue.length > 1 ? <Btn sm onClick={onWaiting} data-fk="all-waiting">{allWaiting(queue.length)}</Btn> : <Btn sm onClick={onRewind} data-fk="see-rewind">{SEE_REWIND}</Btn>}
      </div>
      <div className="cs-cards" style={{ '--slots': cols } as CSSProperties}>
        {cards.map((c) => (
          <button key={c.key} type="button" data-fk={`card-${c.key}`} className={`cs-card${c.fill ? ' fill' : ''}`} style={{ '--c': c.color } as CSSProperties} onClick={c.go} title={c.title}>
            <span className="wk">{c.kicker}</span>
            <b>{c.body}</b>
            {c.sub ? <span className="wn">{c.sub}</span> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function WatchBody({ deal }: { deal: Deal }) {
  const disp = useDisplayOf(deal.id);
  return <>{disp ? shortTitle(disp.title) : null}<span className="cs-st"> · {stateLabel(deal.state, deal)}</span></>;
}
