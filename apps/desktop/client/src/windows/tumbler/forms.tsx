// The Tumbler's drawn forms on the v2 baseline (prototype/tumbler, reworked "puck").
// Layer 1 is one indicative line per item; detail sits behind small popovers (Layer 2).
// Every string here is either ours or a field Rust composed for the AttentionItem / ReceiptEvent
// / DealDisplay (headline, counterparty display name, on_silence, label, own-catalog title).
// No counterparty free text, memo or product title from the counterparty ever reaches these
// components (W4). Colours come from tokens only (tumbler.css); module colour is `--mc`.
import { forwardRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { AttentionSnapshot } from '@bindings/AttentionSnapshot';
import type { Currency } from '@bindings/Currency';
import type { Mode } from '@bindings/Mode';
import type { DealDisplay } from '../../lib/pending';
import type { WalletError } from '../../lib/contract';
import { clockLabel, formatMinor, shortId } from '../../lib/format';
import { readLimits } from '../../lib/limits';
import { timeLeftWords } from '../../lib/words';
import { useQuery } from '../../lib/hooks';
import { ModeBadge } from '../../shared/honesty';
import { MODULE } from '../../shared/modules';
import { Btn, Chip, Hint, Hourglass, Kv, Meter, Popover } from '../../shared/ui';
import {
  MODE_SHORT, approveWindow, cardActions, cardClock, cardQuestion, cardWhy, hhmm, ladderCaption, ladderFill, ringFill, rung, spendMeter, splitHeadline,
  type CardAction, type Handoff, type Ticker,
} from './logic';
import { WALK_AWAY_HOURS, walkAway, type WalkAway } from './logic';

const MODE_TEXT: Record<Mode, string> = { sandbox: 'Sandbox', replay: 'Replay', scripted_engine: 'Practice agent' };

// ------------------------------------------------------------------------------- small parts

const LockIcon = ({ open }: { open?: boolean }) =>
  open ? (
    <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.4-1" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor" /><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
  );

/** The idle-lock indicator and the mode badge: on every form. `compact` drops the word "locked"
 *  where a row beside the puck has no room for it; the closed gold lock, its accessible name and
 *  the puck's own lock glyph still say it. */
export function Flags({ mode, locked, compact }: { mode: Mode | null; locked: boolean; compact?: boolean }) {
  return (
    <span className="flags">
      <span className={`lockind${locked ? ' on' : ''}`} role="img" aria-label={locked ? 'locked' : 'unlocked'}
        title={locked ? 'Locked after 15 quiet minutes · Review still opens the approval window, which unlocks with Windows Hello' : 'Unlocked · approvals lock after 15 quiet minutes'}>
        <LockIcon open={!locked} />{locked && !compact ? 'locked' : null}
      </span>
      {mode ? <ModeBadge mode={mode} /> : null}
    </span>
  );
}

/** Rust's headline with its amount set in the money face when it ends with the item's amount. */
export function Headline({ text, minor, currency }: { text: string; minor: number; currency: Currency }) {
  const s = splitHeadline(text, minor, currency);
  // the lead may ellipsize on a narrow row; the amount never does (tumbler.css .hl / .amt)
  return s ? <><span className="hl">{s.lead}</span> <b className="amt">{s.amount}</b></> : <span className="hl">{text}</span>;
}

/** The card's one sentence: "Approve $329.00 with Dan?". The lead may ellipsize on a narrow row; the
 *  amount never does, and the tail (who, and the question mark) goes last. */
export function Question({ item, ring }: { item: AttentionItem; ring?: ((amount: ReactNode) => ReactNode) | null }) {
  const q = cardQuestion(item);
  const amount = q.amount ? <b className="amt">{q.amount}</b> : null;
  return (
    <>
      <span className="hl">{q.lead}</span>{amount ? <> {ring ? ring(amount) : amount}</> : null}{q.tail ? <span className={`tl${q.tail.startsWith(' ') ? '' : ' q'}`}>{q.tail}</span> : null}
    </>
  );
}

/** "ⓘ": opens a Layer-2 popover. Toggles: a second click on the anchor closes it. */
function InfoBtn({ label, open, onToggle }: { label: string; open: boolean; onToggle: (el: HTMLElement) => void }) {
  return (
    <Btn kind="plain" sm className="t-info" aria-label={label} title={label} aria-expanded={open} onClick={(e) => onToggle(e.currentTarget)}>ⓘ</Btn>
  );
}

export function Notice({ failure }: { failure: { what: string; error: WalletError } }) {
  const avail = failure.error.isAvailabilityState;
  return (
    <div className={`t-fail${avail ? ' avail' : ''}`} role={avail ? 'status' : 'alert'}>
      <span className="code" title={failure.error.code}>{failure.error.isAvailabilityState ? 'Not available' : 'Problem'}</span>
      <span className="msg"><b>{failure.what}:</b> {failure.error.message}</span>
    </div>
  );
}

/** Which rung a deadline is on, in words, with its wall-clock end: the card's ladder caption,
 *  which lives on the rule's tooltip and in the details popover (the card has no room for it). */
function ladderLine(deadline: number | null, now: number, hold: boolean, checking = false): string {
  const cap = ladderCaption(rung(deadline, now), hold, checking);
  if (deadline === null) return cap;
  return `${cap} · until ${deadline - now > 20 * 3600 ? clockLabel(deadline) : hhmm(deadline)}`;
}

const LADDER_HELP = 'The ring starts breathing 2 hours before the deadline, you get one reminder at 15 minutes, then the safe default runs';

/** The attention ladder for one deadline as a 2 px rule with the 15-minute and 2-hour rungs
 *  ticked. No clock is drawn dashed (unknown), never empty. */
function DeadlineRule({ deadline, now, hold, className }: { deadline: number | null; now: number; hold: boolean; className?: string }) {
  const r = rung(deadline, now);
  const line = ladderLine(deadline, now, hold);
  const fill = deadline === null ? null : ladderFill(deadline - now);
  return (
    <div className={`c-rule r-${r}${fill === null ? ' none' : ''}${className ? ` ${className}` : ''}`} title={`${line}\n${LADDER_HELP}`}
      {...(fill === null
        ? { role: 'img', 'aria-label': `deadline: ${line}` }
        : { role: 'meter', 'aria-label': 'time left', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(fill), 'aria-valuetext': line })}>
      {fill === null ? null : <i style={{ width: `${fill.toFixed(1)}%` }} />}
      <em className="m15" aria-hidden="true" /><em className="m2h" aria-hidden="true" />
    </div>
  );
}

/** The deadline as a thin ring around the amount, replacing the 2 px rule. It is drawn from
 *  the item's deadline only (ringFill); no clock is a dashed ring, never a full one. The words stay
 *  in the header ("3 h 57 min left") and on the title, so the ring never carries the time alone. */
function AmountRing({ deadline, now, hold, children }: { deadline: number | null; now: number; hold: boolean; children: ReactNode }) {
  const r = rung(deadline, now);
  const line = ladderLine(deadline, now, hold);
  const fill = ringFill(deadline, now);
  return (
    <span className={`amt-ring r-${r}${fill === null ? ' none' : ''}`} title={`${line}\n${LADDER_HELP}`}
      style={fill === null ? undefined : { ['--p' as string]: fill.toFixed(1) }}>
      {children}
      <i className="ring"
        {...(fill === null
          ? { role: 'img', 'aria-label': `deadline: ${line}` }
          : { role: 'meter', 'aria-label': 'time left', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(fill), 'aria-valuetext': line })} />
    </span>
  );
}

// ------------------------------------------------------------------------------- ticker

export function TickerForm({ ticker, onOpen }: { ticker: Ticker | null; onOpen: () => void }) {
  if (!ticker) return <div className="f ticker info still" />;
  const [lead, strong, tail] = ticker.l1;
  return (
    <div className={`f ticker ${ticker.kind}`} role="status" aria-live="polite" onClick={onOpen} key={ticker.key}>
      <span className="stripe" aria-hidden="true" />
      <div className="tx">
        <div className="l1">{lead}<b>{strong}</b>{tail}</div>
        <div className="l2"><span>{ticker.l2}</span><ModeBadge mode={ticker.mode} /></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------- card

export type CardProps = {
  item: AttentionItem;
  items: readonly AttentionItem[];
  now: number;
  locked: boolean;
  confirming: boolean;
  /** the approval window was opened for this deal from here */
  reviewed: boolean;
  busy: boolean;
  /** an action in flight (Withdraw or Snooze): its button is disabled until Rust answers */
  pending: CardAction['action'] | null;
  failure: { what: string; error: WalletError } | null;
  onAction: (a: CardAction['action'], item: AttentionItem) => void;
  onConfirm: (yes: boolean) => void;
  onNav: (dir: 1 | -1) => void;
  onStack: () => void;
  onKey: (e: KeyboardEvent<HTMLDivElement>) => void;
};

/** Layer 2 for one item, built only from composed fields (W4): who, the rule, the deadline and
 *  its rung, the full default, the mode, and the deal's own-catalog title from deal_display when
 *  Rust has one. It also carries the card's quieter safe-direction actions (Open in Table, Let it
 *  lapse) that the 152-px card has no room for. */
function CardDetails({ item, now, anchor, actions, pending, onAction, onClose }: {
  item: AttentionItem; now: number; anchor: HTMLElement; actions: readonly CardAction[]; pending: CardAction['action'] | null;
  onAction: (a: CardAction['action']) => void; onClose: () => void;
}) {
  const display = useQuery('deal_display', { deal_id: item.deal_id });
  const title = display.data && display.data.deal_id === item.deal_id ? display.data.title : null;
  const hold = item.kind === 'hold';
  const table = actions.find((a) => a.action === 'open_in_table');
  const lapse = actions.find((a) => a.action === 'let_lapse');
  const snooze = actions.find((a) => a.action === 'snooze30');
  const act = (a: CardAction['action']) => () => {
    onClose();
    onAction(a);
  };
  return (
    <Popover anchor={anchor} onClose={onClose} className="t-pop" title={item.headline}>
      <div className="t-why">
        <h4>Why?</h4>
        {cardWhy(item).map((t) => <p key={t}>{t}</p>)}
      </div>
      <Kv items={[
        ['Deal', <span className="mono">{item.label} · {MODULE[item.module].name}</span>],
        ['With', item.counterparty ?? 'a connected wallet'],
        title ? ['Item', title] : null,
        ['Deadline', item.deadline !== null ? clockLabel(item.deadline) : 'none · paused until you act'],
        ['Time', ladderLine(item.deadline, now, hold, !!item.money_check)],
        ['Mode', MODE_TEXT[item.mode]],
      ]} />
      {table || lapse || snooze ? (
        <div className="t-pop-acts">
          {table ? <Btn sm onClick={act('open_in_table')} title={hold ? "Open this deal's evidence in The Table" : 'Open this deal in The Table'}>{hold ? 'See why in The Table ↗' : 'Open in The Table ↗'}</Btn> : null}
          {snooze ? <Btn sm kind="plain" disabled={pending === 'snooze30'} onClick={act('snooze30')} title={ACTION_TITLE.snooze30}>{snooze.label}</Btn> : null}
          {lapse ? <Btn sm kind="plain" onClick={act('let_lapse')} title={ACTION_TITLE.let_lapse}>{lapse.label}</Btn> : null}
        </div>
      ) : null}
      <Hint className="t-pop-hint">{hold ? 'No pay button exists for a hold. ' : ''}Counterparty notes stay quarantined in The Table and the approval window.</Hint>
    </Popover>
  );
}

const ACTION_TITLE: Partial<Record<CardAction['action'], string>> = {
  review: 'Opens the approval window, the only window that can release money (Enter)',
  withdraw: 'Walk away from this deal · no money moves (W · asks once)',
  let_lapse: 'Let it run out now · no money moves',
  snooze30: 'Remind me in 30 min · the deadline still runs and the 15-minute reminder still comes',
};

/** The card's line-4 buttons: one gold way in to the approval window and a quiet Withdraw for a
 *  decision; "See why" and Withdraw for a pause. Open in The Table, Let it lapse and Remind me
 *  live in the details popover, so nothing else competes with the question. */
const ON_CARD: ReadonlySet<CardAction['action']> = new Set(['review', 'withdraw']);
/** The gold button says where it leads: the approval window, the only place that can release money. */
const REVIEW_WORDS = 'Review and decide';

/*
 * One decision or alert at 440 x 152 (the size table in crates/table-attention). Four lines on a
 * fixed grid so every row's height is known against the 88 x 88 puck corner (tumbler.css):
 *   1  module · time left · pager · lock · mode
 *   2  the question: "Approve $329.00 with Dan?"
 *   3  "⧗ If you do nothing: …" (two lines at most, full text on the title and in ⓘ)
 *   4  one gold action (and a quiet Withdraw), then the deadline as a 2 px rule
 * Rows that fall beside the puck carry .nt / .nb and leave its corner free.
 */
export const CardForm = forwardRef(function CardForm(p: CardProps, ref: Ref<HTMLDivElement>) {
  const { item, items, now } = p;
  const [infoAt, setInfoAt] = useState<HTMLElement | null>(null);
  const hold = item.kind === 'hold';
  // The ring replaces the 2 px rule only when the question has an amount to put it around
  const ringed = cardQuestion(item).amount !== null;
  const idx = items.findIndex((i) => i.deal_id === item.deal_id);
  const acts = cardActions(item, now);
  const buttons = acts.filter((a) => ON_CARD.has(a.action));
  const table = acts.find((a) => a.action === 'open_in_table');
  const r = rung(item.deadline, now);
  const clock = cardClock(item, now);
  const label = `${item.money_check ? 'Checking with PayPal' : hold ? 'Paused' : 'Decision'} ${item.label}. ${hold ? '' : 'Enter reviews, '}W withdraws, Escape returns to rest.`;
  const askId = `c-ask-${item.deal_id}`;

  let line3: ReactNode;
  let line4: ReactNode;
  if (p.confirming) {
    line3 = <p className="c-ask" id={askId}>Withdraw {item.label}? A signed WITHDRAW moves only toward the default · no money moves.</p>;
    line4 = (
      <div className="c-acts" role="group" aria-label="Confirm withdraw" aria-describedby={askId}>
        <Btn kind="danger" sm data-autofocus onClick={() => p.onConfirm(true)} disabled={p.busy}>Withdraw</Btn>
        <Btn sm onClick={() => p.onConfirm(false)}>Keep</Btn>
      </div>
    );
  } else {
    line3 = p.failure ? <Notice failure={p.failure} /> : (
      <p className="c-who" title={`${item.counterparty ?? 'a connected wallet'} · If you do nothing: ${item.on_silence}`}>
        <span className="c-sil"><Hourglass />If you do nothing: <b>{item.on_silence}</b></span>
      </p>
    );
    line4 = (
      <div className="c-acts">
        {buttons.map((a) =>
          a.action === 'review' && p.reviewed ? (
            <Btn key={a.action} sm className="inappr" onClick={() => p.onAction('review', item)} title="The approval window is open for this deal · click to raise it">
              <span className="ui-dot" aria-hidden="true" />In approval ↗
            </Btn>
          ) : (
            <Btn key={a.action} sm kind={a.action === 'review' ? 'gold' : a.style === 'danger' ? 'danger' : 'plain'}
              onClick={() => p.onAction(a.action, item)} disabled={p.pending === a.action || (p.busy && a.action === 'withdraw')} title={ACTION_TITLE[a.action]}>
              {a.action === 'review' ? `${REVIEW_WORDS} ↗` : a.label}
            </Btn>
          ),
        )}
        {hold && table ? <Btn sm onClick={() => p.onAction('open_in_table', item)} title="See why it is paused, in The Table">See why ↗</Btn> : null}
        {items.length > 1 ? (
          <span className="nav">
            <Btn kind="plain" sm className="arr" onClick={() => p.onNav(-1)} aria-label="Previous item">‹</Btn>
            <Btn kind="plain" sm onClick={p.onStack} title="Show every open item" aria-label={`${idx + 1} of ${items.length} · show every open item`}>{idx + 1}/{items.length}</Btn>
            <Btn kind="plain" sm className="arr" onClick={() => p.onNav(1)} aria-label="Next item">›</Btn>
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={ref} className={`f card ${hold ? 'k-hold' : 'k-gate'} r-${r}`} tabIndex={-1} aria-label={label} onKeyDown={p.onKey}
      style={{ ['--mc' as string]: MODULE[item.module].cssVar }}>
      <div className="f-head nt">
        <span className="ui-dot mdot" aria-hidden="true" />
        <span className="kick" title={`${MODULE[item.module].name} · ${item.label}`}><b>{MODULE[item.module].name}</b></span>
        <span className={`c-cd ${hold ? 'hold' : ''}${clock.urgent ? ' r-now' : ''}`} title={ladderLine(item.deadline, now, hold, !!item.money_check)}>{item.money_check ? (item.deadline !== null ? `Checking · ${clock.text}` : 'Checking') : hold && item.deadline !== null ? `Paused · ${clock.text}` : `${clock.text.charAt(0).toUpperCase()}${clock.text.slice(1)}`}</span>
        <Flags mode={item.mode} locked={p.locked} compact />
      </div>
      <div className="c-line nt">
        <h2 className="c-h"><Question item={item} ring={ringed ? (amt) => <AmountRing deadline={item.deadline} now={now} hold={hold}>{amt}</AmountRing> : null} /></h2>
      </div>
      <div className="c-r3 nt nb">
        {line3}
        <InfoBtn label={`Details for ${item.label}`} open={!!infoAt} onToggle={(el) => setInfoAt((x) => (x ? null : el))} />
      </div>
      <div className="c-r4 nb">{line4}</div>
      {ringed ? null : <DeadlineRule deadline={item.deadline} now={now} hold={hold} className="nb" />}
      {infoAt ? <CardDetails item={item} now={now} anchor={infoAt} actions={acts} pending={p.pending} onAction={(a) => p.onAction(a, item)} onClose={() => setInfoAt(null)} /> : null}
    </div>
  );
});

// ------------------------------------------------------------------------------- stack

export type StackProps = {
  snapshot: AttentionSnapshot | undefined;
  items: readonly AttentionItem[];
  now: number;
  locked: boolean;
  mode: Mode | null;
  metersAvailable: boolean;
  paused: boolean;
  pinned: boolean | null;
  dnd: boolean;
  failure: { what: string; error: WalletError } | null;
  onOpen: (id: string) => void;
  onTable: () => void;
  onPin: () => void;
  onDnd: () => void;
};

export const StackForm = forwardRef(function StackForm(p: StackProps, ref: Ref<HTMLDivElement>) {
  const s = p.snapshot;
  const spend = s ? spendMeter(s) : null;
  // Real meters from the wallet's exposure (T14), against the signed wallet limits.
  const lim = s ? readLimits(s.exposure) : null;
  const limHint = (of: string | null) => of ?? (lim?.status === 'expired' ? 'limits ran out' : lim?.status === 'unverified' ? 'limits not checked' : 'no wallet limit');
  const deals = lim?.meters.find((m) => m.key === 'deals');
  const walk = s ? walkAway(s) : null;
  const [pop, setPop] = useState<{ el: HTMLElement; which: 'stopped' | 'motion' | 'walk' } | null>(null);
  const toggle = (which: 'stopped' | 'motion' | 'walk') => (el: HTMLElement) => setPop((x) => (x && x.which === which ? null : { el, which }));
  return (
    <div ref={ref} className="f stack" tabIndex={-1} aria-label="Everything open">
      <div className="s-head">
        <h2>Needs you<span className="n">{p.items.length}</span></h2>
        <Btn kind="plain" sm onClick={p.onTable}>Open The Table ↗</Btn>
        {p.dnd ? <Chip tone="line" title="Do not disturb: no notifications, no breathing; the ring and count stay">Quiet</Chip> : null}
        <span className="s-tools">
          {p.pinned !== null ? (
            <Btn kind="plain" sm className={`t-ico${p.pinned ? ' on' : ''}`} onClick={p.onPin} aria-pressed={p.pinned}
              aria-label="Always on top" title={p.pinned ? 'Always on top · click to let other windows cover it' : 'Not on top · click to keep it above other windows'}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2h4l-.6 4 2.6 2.4V10H4V8.4L6.6 6z" fill="currentColor" /><path d="M8 10v4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            </Btn>
          ) : null}
          <Btn kind="plain" sm className={`t-ico${p.dnd ? ' on' : ''}`} onClick={p.onDnd} aria-pressed={p.dnd}
            aria-label="Do not disturb" title={p.dnd ? 'Do not disturb is on · no notification, no breathing; the ring and count stay' : 'Do not disturb'}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 9.6A5.4 5.4 0 0 1 6.4 3a5.4 5.4 0 1 0 6.6 6.6z" fill="currentColor" /></svg>
          </Btn>
        </span>
        <Flags mode={p.mode} locked={p.locked} />
      </div>
      <div className="s-list">
        {p.items.length ? (
          p.items.map((it) => {
            const r = rung(it.deadline, p.now);
            const hold = it.kind === 'hold';
            return (
              <button key={it.deal_id} type="button" className={`ui-row two act s-row ${hold ? 'hold' : 'gate'} r-${r}`} onClick={() => p.onOpen(it.deal_id)}
                title={`${MODULE[it.module].name} · ${it.headline} · If you do nothing: ${it.on_silence}`}>
                <span className="bd" aria-hidden="true" />
                <span className="main">
                  <span className="t1"><Headline text={it.headline} minor={it.amount_minor} currency={it.currency} />{it.counterparty ? <span className="who"> · {it.counterparty}</span> : null}</span>
                  <span className="t2"><Hourglass />If you do nothing: <b>{it.on_silence}</b></span>
                </span>
                {it.money_check ? <Chip tone="dashed">Checking</Chip> : hold ? <Chip tone="coral">Paused</Chip> : null}
                <span className="cd">{it.deadline !== null ? timeLeftWords(it.deadline - p.now) : 'no clock'}</span>
              </button>
            );
          })
        ) : (
          <div className="ui-empty s-empty">Nothing needs you. Your agents keep working inside your rules.</div>
        )}
      </div>
      {p.failure ? <div className="s-fail"><Notice failure={p.failure} /></div> : null}
      <div className={`s-walk${walk && !walk.known ? ' unknown' : ''}`}>
        <Hourglass />
        <span className="k">If you walk away</span>
        <span className="v">{walk ? <WalkSummary walk={walk} /> : '—'}</span>
        <InfoBtn label="What happens if you walk away" open={pop?.which === 'walk'} onToggle={toggle('walk')} />
      </div>
      <div className="s-sum">
        <span>Stopped today</span><b className={s && s.stopped_today > 0 ? 'stop' : ''}>{s?.stopped_today ?? '—'}</b>
        <InfoBtn label="What was stopped today" open={pop?.which === 'stopped'} onToggle={toggle('stopped')} />
        <span aria-hidden="true">·</span>
        <span>In motion</span><b className="mot">{s?.in_motion ?? '—'}</b>
        <InfoBtn label="What is in motion" open={pop?.which === 'motion'} onToggle={toggle('motion')} />
        {p.paused ? <Chip tone="line">Paused</Chip> : null}
      </div>
      <div className={`s-meters${lim ? ' lim' : ''}`}>
        {lim && s ? (
          <>
            {lim.meters.length ? lim.meters.filter((m) => m.key !== 'deals').map((m) => (
              <div key={m.key} className={`ui-stat${m.near ? ' near' : ''}`}
                title={`${m.why}${m.key === 'out' && deals ? ` ${deals.label}: ${deals.value}${deals.of ? ` ${deals.of}` : ''}.` : ''} ${lim.line}`}>
                <span className="k">{m.label}</span>
                <span className="v">{m.value}</span>
                {m.fill !== null ? <Meter value={m.fill} tone={m.near ? 'gold' : undefined} label={`${m.label} against ${m.of}`} /> : null}
                <span className={`ui-hint${lim.status === 'expired' || lim.status === 'unverified' ? ' gold' : ''}`}>{limHint(m.of)}</span>
              </div>
            )) : (
              <div className="ui-stat" title={lim.line}>
                <span className="k">Paid out today</span>
                <span className="v none">{lim.mixed ? 'mixed' : 'nothing'}</span>
                <span className={`ui-hint${lim.status === 'expired' || lim.status === 'unverified' ? ' gold' : ''}`}>{lim.mixed ? 'more than one currency' : limHint(null)}</span>
              </div>
            )}
            {p.metersAvailable ? (
              <div className="ui-stat eng" title="What the AI likely cost. An estimate, never a bill, never PayPal money.">
                <span className="k">AI usage</span>
                <span className="v">≈ ${s.engine_estimate_today_usd.toFixed(2)}</span>
                <span className="ui-hint">estimate</span>
              </div>
            ) : null}
          </>
        ) : p.metersAvailable && s && spend ? (
          <>
            <div className="ui-stat" title="Money your agents paid today. Shown only when every deal uses one currency; otherwise nothing is added up.">
              <span className="k">Spent today</span>
              <span className={`v${spend.value ? '' : ' none'}`}>{spend.value ?? '—'}</span>
              <Meter value={null} label="against today's limit (not known here)" />
              <span className="ui-hint">{spend.note}</span>
            </div>
            <div className="ui-stat eng" title="What the AI likely cost. An estimate, never a bill, never PayPal money.">
              <span className="k">AI usage</span>
              <span className="v">≈ ${s.engine_estimate_today_usd.toFixed(2)}</span>
              <span className="ui-hint">estimate · not a bill</span>
            </div>
          </>
        ) : (
          <p className="m-off">Today’s spending appears here once the wallet can count it. Nothing is guessed until then.</p>
        )}
      </div>
      {pop?.which === 'walk' ? (
        <Popover anchor={pop.el} onClose={() => setPop(null)} className="t-pop t-walk" title={`If you walk away · next ${WALK_AWAY_HOURS} h`}>
          <WalkDetails walk={walk} />
        </Popover>
      ) : pop ? (
        <Popover anchor={pop.el} onClose={() => setPop(null)} className="t-pop" title={pop.which === 'stopped' ? 'Stopped today · 0 PayPal calls' : 'In motion · no decision needed'}>
          {pop.which === 'stopped' ? (
            <p className="t-pop-p">
              {s && s.stopped_today > 0
                ? `${s.stopped_today} request${s.stopped_today === 1 ? ' was' : 's were'} refused by your rules before any payment. Nothing moved.`
                : 'Nothing was refused today.'}
            </p>
          ) : (
            <p className="t-pop-p">
              {p.paused ? 'All agents are paused. Open decisions stay open; nothing new starts.'
                : `${s?.in_motion ?? 0} deal${s?.in_motion === 1 ? ' is' : 's are'} going on inside your rules. Nothing here needs you.`}
            </p>
          )}
          <Hint className="t-pop-hint">Each one is listed in The Table.</Hint>
        </Popover>
      ) : null}
    </div>
  );
});

/** The stack's one-line walk-away summary: money out (always zero), money in, holds released. */
function WalkSummary({ walk }: { walk: WalkAway }) {
  if (!walk.known) return <>{walk.summary}</>;
  return (
    <>
      <b className="w-out" title="Your wallet sends no money while you are away">{walk.out ?? 'nothing'}</b> out
      {walk.inUpTo ? <> · up to <b className="w-in" title="Only if a buyer approves on PayPal in time">{walk.inUpTo}</b> in</>
        : walk.inSure ? <> · <b className="w-in" title="Payments buyers already approved">{walk.inSure}</b> in</> : null}
      {walk.releases ? <> · {walk.releases} hold{walk.releases === 1 ? '' : 's'} released</> : null}
      {!walk.lines.length && !walk.inUpTo && !walk.inSure && !walk.releases ? <> · nothing scheduled</> : null}
    </>
  );
}

/** Layer 2: the first few lines (time · what happens · on whose authority). */
function WalkDetails({ walk }: { walk: WalkAway | null }) {
  if (!walk || !walk.known) {
    return <p className="t-pop-p">The wallet couldn’t work out what happens next just now, so nothing here is a promise. Open The Table to see each deal.</p>;
  }
  return (
    <>
      {walk.lines.length ? (
        <ul className="w-lines">
          {walk.lines.map((l) => (
            <li key={l.key} className={l.conditional ? 'if' : ''}>
              <span className="w-when">{l.when}</span>
              <span className="w-what">{l.what}</span>
              <span className="w-who">{l.who}</span>
            </li>
          ))}
        </ul>
      ) : <p className="t-pop-p">Nothing is scheduled. Every open deal waits for you.</p>}
      {walk.more ? <p className="t-pop-p w-more">and {walk.more} more</p> : null}
      <Hint className="t-pop-hint">Your wallet never sends money on its own. Closing the window keeps this running; quitting The Table stops it.</Hint>
    </>
  );
}

// ------------------------------------------------------------------------------- hand-off

const BrowserGlyph = () => (
  <svg className="br" viewBox="0 0 52 38" aria-hidden="true">
    <rect className="g-frame" x="1" y="1" width="50" height="36" rx="5" strokeWidth="1.5" />
    <rect className="g-bar" x="1" y="1" width="50" height="8" rx="4" />
    <circle className="g-btn" cx="6" cy="5" r="1.4" /><circle className="g-btn" cx="10.5" cy="5" r="1.4" />
    <rect className="g-url" x="15" y="3" width="31" height="4" rx="2" />
    <path className="g-arrow" d="M15 24h18M28 19l5 5-5 5" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export type HandoffProps = {
  /** what tumbler:handoff said (deal + approve window); dealId null = generic hand-off */
  handoff: Handoff;
  /** the deal's open attention item, when Rust still lists it */
  item: AttentionItem | null;
  /** deal_display for the deal (label, own-catalog title); null while loading or unavailable */
  display: DealDisplay | null;
  now: number;
  locked: boolean;
  mode: Mode | null;
  onTable: () => void;
  onRest: () => void;
};

/*
 * Approval in progress at 440 x 160, five rows on a fixed grid (tumbler.css):
 *   1  In your browser · id · own-catalog title · lock · mode
 *   2  Approve $329.00 on PayPal's own page
 *   3  approve window 5:41:12 · until 18:00 · polling
 *   4  ⧗ If you do nothing: … (two lines at most, full text on the title)
 *   5  Open in Table ↗ · Back to rest
 */
export const HandoffForm = forwardRef(function HandoffForm(p: HandoffProps, ref: Ref<HTMLDivElement>) {
  const it = p.item;
  const id = p.handoff.dealId;
  const label = it?.label ?? p.display?.label ?? (id ? shortId(id) : null);
  const title = p.display?.title ?? null;
  const win = approveWindow(p.handoff.approveUntil, p.now);
  const silence = it?.on_silence ?? p.display?.on_silence ?? 'the order expires · no money moves';
  return (
    <div ref={ref} className="f handoff" tabIndex={-1} aria-label={`Approval in progress in your browser${label ? ` · ${label}` : ''}`}
      style={it ? { ['--mc' as string]: MODULE[it.module].cssVar } : undefined}>
      <div className="f-head nt">
        <span className="ui-dot mdot" aria-hidden="true" />
        <span className="kick" title={[label, title].filter(Boolean).join(' · ') || undefined}>
          <b className="teal">In your browser</b>{title ? <span className="h-title"> · {title}</span> : label ? <> · {label}</> : null}
        </span>
        <Flags mode={it?.mode ?? p.mode} locked={p.locked} />
      </div>
      <div className="h1 nt">
        <BrowserGlyph />
        <span className="hl">
          {it ? <>Approve <b className="amt">{formatMinor(it.amount_minor, it.currency)}</b> on PayPal’s own page</>
            : label ? <>Approve <b className="amt">{label}</b> on PayPal’s own page</>
            : 'Approval in progress on PayPal’s own page'}
        </span>
      </div>
      <div className={`h2 nt nb aw-${win.state === 'open' ? win.rung : win.state}`}>
        {win.state === 'open' ? (
          <span className="aw" title={`PayPal’s approval for this deal closes at ${win.until}`}>time to approve <b className="money">{win.left}</b> · until {win.until}</span>
        ) : win.state === 'closed' ? (
          <span className="aw" title="The deadline has passed · the safe default runs">approval closed at {win.until}</span>
        ) : (
          <span className="aw">time to approve not known</span>
        )}
        <span className="poll" aria-hidden="true" />
        <span className="h-poll" title="The wallet checks the order with PayPal every 10 s; it never trusts the browser alone">checking PayPal</span>
      </div>
      <p className="h-sil nt nb" title={`If you do nothing: ${silence}`}><Hourglass />If you do nothing: <b>{silence}</b></p>
      <div className="h-links nb">
        <Btn kind="plain" sm onClick={p.onTable}>Open in The Table ↗</Btn>
        <Btn kind="plain" sm onClick={p.onRest}>Minimise</Btn>
      </div>
    </div>
  );
});

// ------------------------------------------------------------------------------- welcome

const Mini = ({ ring, children }: { ring: 'gold' | 'line'; children?: ReactNode }) => (
  <svg viewBox="0 0 26 26" aria-hidden="true" className={`mini ring-${ring}`}>
    <circle className="mo" cx="13" cy="13" r="11.5" strokeWidth="1.6" /><circle className="mi" cx="13" cy="13" r="7.5" />{children}
  </svg>
);

/*
 * First close at 440 x 228 (tumbler.css): head, title, one line of promise, a 2 x 2 legend that
 * clears the puck in either corner, and the foot (keyboard promise, summon chord, Got it) beside
 * the puck when it sits at the bottom.
 */
export const WelcomeForm = forwardRef(function WelcomeForm(p: { mode: Mode | null; locked: boolean; onOk: () => void }, ref: Ref<HTMLDivElement>) {
  return (
    <div ref={ref} className="f welcome" tabIndex={-1} aria-label="The Table is closed">
      <div className="f-head nt"><span className="kick">Your mini window</span><Flags mode={p.mode} locked={p.locked} /></div>
      <h2 className="w-h nt">The Table is closed.</h2>
      <p className="w-p nt" title="Your agents keep working; I show you what needs you.">Your agents keep working; I show you what needs you.</p>
      <ul className="w-legend">
        <li title="A gold ring on the puck: something needs you"><Mini ring="gold"><text className="m-n" x="13" y="16.5" textAnchor="middle">4</text></Mini><span><b>Gold ring</b> · needs you</span></li>
        <li title="A dot on the rim: one open decision"><Mini ring="line"><circle className="m-bead" cx="13" cy="3.2" r="2.4" /></Mini><span><b>A dot</b> · one open decision</span></li>
        <li title="If you do nothing, the safe default runs: waiting never pays anyone"><Mini ring="line"><path className="m-dash" d="M9 13h8" strokeWidth="1.6" /></Mini><span><b>Waiting</b> · never pays anyone</span></li>
        <li title="Review ↗ opens the approval window: only that window can pay"><Mini ring="line"><path className="m-lock" d="M10 14.5v-2.5a3 3 0 0 1 6 0v2.5M9 14.5h8v4H9z" fill="none" strokeWidth="1.3" /></Mini><span><b>Review ↗</b> · you decide there</span></li>
      </ul>
      <div className="w-foot nb">
        <p className="w-kb">I never take your keyboard.</p>
        <div className="w-ok">
          <span className="ui-hint"><span className="kbd">Ctrl</span> <span className="kbd">Shift</span> <span className="kbd">Space</span> summons or hides me</span>
          <Btn kind="gold" sm onClick={p.onOk}>Got it</Btn>
        </div>
      </div>
    </div>
  );
});

// ------------------------------------------------------------------------------- tab

export function TabForm({ needs, inMotion, mode, flushLeft, ring }: { needs: number; inMotion: number; mode: Mode | null; flushLeft: boolean; ring: 'none' | 'gold' | 'coral' }) {
  return (
    <div className={`f tab${flushLeft ? ' flush-l' : ''} ring-${ring}`}>
      <span className="tg" aria-hidden="true" />
      <span className={`tc${needs ? '' : ' calm'}`}>{needs || inMotion}</span>
      <span className="tm">{mode ? MODE_SHORT[mode] : ''}</span>
    </div>
  );
}
