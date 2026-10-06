// The Tumbler: the small operative window. Rust owns its size and placement; this page only
// asks for a form by name (tumbler_set_form) and draws whatever form Rust reports
// (tumbler:form), growing out of the anchored puck corner (tumbler:orient).
//
// It can always say no (Withdraw, Let it lapse, Snooze via deal_snooze) and can open other windows (Review →
// the approval window, Open in Table → main). It cannot release money: there is no approve
// action and no approve hotkey anywhere in this window.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { AttentionSnapshot } from '@bindings/AttentionSnapshot';
import type { Form } from '@bindings/Form';
import type { ReceiptEvent } from '@bindings/ReceiptEvent';
import type { SettingsSnapshot } from '@bindings/SettingsSnapshot';
import type { VAlign } from '@bindings/VAlign';
import type { VisualState } from '@bindings/VisualState';
import type { WindowSide } from '@bindings/WindowSide';
import { toWalletError, type WalletError } from '../../lib/contract';
import { useEvent, useNow, usePrefersReducedMotion, useQuery } from '../../lib/hooks';
import { backend } from '../../lib/runtime';
import { PuckArt } from './Puck';
import { CardForm, HandoffForm, StackForm, TabForm, TickerForm, WelcomeForm } from './forms';
import {
  plainItems,
  NO_HANDOFF, SECONDS, ackTicker, arrivals, arrivalsTicker, canReview, dndPreferences, handoffEnded, nextFocus, puckLook, puckTarget, receiptTicker,
  restForm, snoozeEligible, snoozeTicker, sortItems, stopTicker, tickerMayShow, type CardAction, type Handoff, type Ticker,
} from './logic';

type Failure = { dealId: string | null; what: string; error: WalletError };
type Ack = { dealId: string; timer: ReturnType<typeof setTimeout> };

const DRAG_THRESHOLD = 4;
const RECONCILE_MS = 30_000;
const ACK_MS = 900;

function setFormNative(form: Form): void {
  backend()
    .invoke('tumbler_set_form', { form })
    .catch((e: unknown) => console.warn('tumbler_set_form', toWalletError(e).message));
}

export function Tumbler() {
  const now = useNow();
  const reducedMotion = usePrefersReducedMotion();

  // what Rust reports
  const [form, setForm] = useState<Form>('rest');
  const [orient, setOrient] = useState<{ side: WindowSide; valign: VAlign }>({ side: 'left', valign: 'up' });
  const [snapshot, setSnapshot] = useState<AttentionSnapshot>();
  const [settings, setSettings] = useState<SettingsSnapshot>();
  const [visual, setVisual] = useState<VisualState | null>(null);

  // what this page holds (views only)
  const [focusId, setFocusId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Handoff>(NO_HANDOFF);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const [docked, setDocked] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [snoozing, setSnoozing] = useState<string | null>(null);
  const [pinned, setPinned] = useState<boolean | null>(null);

  // refs mirror state for event callbacks and timers
  const formRef = useRef(form);
  formRef.current = form;
  const dockedRef = useRef(docked);
  dockedRef.current = docked;
  const focusRef = useRef(focusId);
  focusRef.current = focusId;
  const handoffRef = useRef(handoff);
  handoffRef.current = handoff;
  const queue = useRef<Ticker[]>([]);
  const tickerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevItems = useRef<AttentionItem[] | undefined>(undefined);
  const prevStopped = useRef<number | undefined>(undefined);
  const lastStopAt = useRef(0);
  const known = useRef(new Map<string, AttentionItem>());
  const ack = useRef<Ack | null>(null);
  const autoFocus = useRef(false);
  const formEl = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; started: boolean } | null>(null);
  const swallowClick = useRef(false);

  const items = useMemo(() => sortItems(snapshot?.items ?? []), [snapshot]);
  const locked = !!(snapshot?.locked || settings?.locked);
  const mode = settings?.mode ?? items[0]?.mode ?? null;
  const dnd = settings?.preferences.dnd ?? false;
  const look = puckLook(snapshot, { now, visual, reducedMotion, dnd });
  // the hand-off deal's label and own-catalog title (degrades to the item / a short id)
  const handoffDisplay = useQuery('deal_display', { deal_id: handoff.dealId ?? '' }, { enabled: !!handoff.dealId });

  const rest = useCallback(() => {
    setConfirmId(null);
    setFormNative(restForm(dockedRef.current));
  }, []);

  /** Ask Rust for a form; `focus` moves keyboard focus into it once it is drawn (user action only). */
  const open = useCallback((f: Form, focus = true) => {
    autoFocus.current = focus;
    setFailure(null);
    if (f !== 'card') setConfirmId(null);
    if (formRef.current === f) {
      if (focus) formEl.current?.focus({ preventScroll: true });
      return;
    }
    setFormNative(f);
  }, []);

  // ------------------------------------------------------------------ tickers
  const showTicker = useCallback((t: Ticker) => {
    if (tickerTimer.current) clearTimeout(tickerTimer.current);
    setTicker(t);
    setFormNative('ticker');
    tickerTimer.current = setTimeout(endTicker, t.ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function endTicker() {
    tickerTimer.current = null;
    const next = queue.current.shift();
    if (next) return showTicker(next);
    // the ticker's content stays until Rust reports the next form (no flash of an empty pill)
    if (formRef.current === 'ticker') setFormNative(handoffRef.current.active ? 'handoff' : restForm(dockedRef.current));
  }
  const pushTicker = useCallback((t: Ticker, force = false) => {
    if (dockedRef.current) return; // a docked Tumbler stays quiet; the stack still counts it
    if (force || tickerMayShow(formRef.current)) showTicker(t);
    else queue.current = [...queue.current.slice(-3), t];
  }, [showTicker]);
  const openFromTicker = useCallback(() => {
    if (tickerTimer.current) clearTimeout(tickerTimer.current);
    tickerTimer.current = null;
    const t = ticker;
    const target = t?.dealId ? known.current.get(t.dealId) : undefined;
    if (target && prevItems.current?.some((i) => i.deal_id === target.deal_id)) {
      setFocusId(target.deal_id);
      open('card');
    } else open('stack');
  }, [ticker, open]);

  // ------------------------------------------------------------------ Rust → page
  const applySnapshot = useCallback((raw: AttentionSnapshot) => {
    // Plain-word headlines and defaults for every form (lib/words.ts); ids, amounts, actions untouched.
    const next: AttentionSnapshot = { ...raw, items: plainItems(raw.items) };
    const prev = prevItems.current;
    const arrived = arrivals(prev, next.items);
    for (const i of next.items) known.current.set(i.deal_id, i);
    prevItems.current = next.items;
    setSnapshot(next);

    if (arrived.length) {
      setNewIds(new Set(arrived.map((i) => i.deal_id)));
      setTimeout(() => setNewIds(new Set()), 900);
      const t = arrivalsTicker(arrived);
      if (t) pushTicker(t); // never opens the card, never takes focus
    }
    if (prevStopped.current !== undefined && next.stopped_today > prevStopped.current && Date.now() - lastStopAt.current > 3000) {
      pushTicker(stopTicker(next.stopped_today, next.items[0]?.mode ?? 'sandbox'));
    }
    prevStopped.current = next.stopped_today;

    // the hand-off ends when its deal leaves the list or turns into a hold
    if (handoffEnded(handoffRef.current, next.items)) {
      setHandoff(NO_HANDOFF);
      if (formRef.current === 'handoff') setFormNative(restForm(dockedRef.current));
    }
    // an open card follows its item; an acted-on item waits for its receipt/ack ticker
    const id = focusRef.current;
    if (formRef.current === 'card' && id && !next.items.some((i) => i.deal_id === id) && ack.current?.dealId !== id) {
      const nf = nextFocus(prev ?? [], next.items, id);
      setConfirmId(null);
      if (nf) setFocusId(nf);
      else setFormNative(restForm(dockedRef.current));
    }
  }, [pushTicker]);

  const onReceipt = useCallback((ev: ReceiptEvent) => {
    const related =
      ev.deal_id === ack.current?.dealId || ev.deal_id === handoffRef.current.dealId || (formRef.current === 'card' && ev.deal_id === focusRef.current);
    if (ack.current?.dealId === ev.deal_id) {
      clearTimeout(ack.current.timer);
      ack.current = null;
    }
    if (handoffRef.current.dealId === ev.deal_id) setHandoff(NO_HANDOFF);
    if (ev.state === 'REFUSED') lastStopAt.current = Date.now();
    pushTicker(receiptTicker(ev, known.current.get(ev.deal_id)), related);
  }, [pushTicker]);

  const refetchAttention = useCallback(async () => {
    try {
      applySnapshot(await backend().invoke('attention_list', null));
    } catch (e) {
      console.warn('attention_list', toWalletError(e).message);
    }
  }, [applySnapshot]);
  const refetchSettings = useCallback(async () => {
    try {
      const s = await backend().invoke('get_settings', null);
      setSettings(s);
      return s;
    } catch (e) {
      console.warn('get_settings', toWalletError(e).message);
      return undefined;
    }
  }, []);

  useEvent('tumbler:form', (f) => {
    setForm(f);
    if (f !== 'ticker') {
      setTicker(null);
      if (tickerTimer.current) clearTimeout(tickerTimer.current);
      tickerTimer.current = null;
    }
    // While docked the page only ever asks for `tab`, so a `rest` from Rust means a drag or
    // snap put the puck back in free space.
    if (f === 'tab') setDocked(true);
    else if (f === 'rest') setDocked(false);
    // Rust sends tumbler:handoff (deal + approve window) just before this form; without it the
    // hand-off stays generic rather than guessing a deal.
    if (f === 'handoff') setHandoff((h) => (h.active ? h : { ...NO_HANDOFF, active: true }));
    if (f === 'rest' && queue.current.length) {
      setTimeout(() => {
        const next = formRef.current === 'rest' ? queue.current.shift() : undefined;
        if (next) showTicker(next);
      }, 350);
    }
  });
  useEvent('tumbler:handoff', ({ deal_id, approve_until }) => setHandoff({ active: true, dealId: deal_id, approveUntil: approve_until }));
  useEvent('tumbler:orient', (o) => setOrient({ side: o.placement.side, valign: o.placement.valign }));
  useEvent('tumbler:visual', setVisual);
  useEvent('attention:changed', applySnapshot);
  useEvent('receipt:created', onReceipt);
  useEvent('settings:changed', (s) => {
    setSettings(s);
    if (s.preferences.snap !== 'screen_left' && s.preferences.snap !== 'screen_right' && formRef.current !== 'tab') setDocked(false);
  });
  useEvent('tumbler:selected', ({ deal_id }) => {
    setFocusId(deal_id);
    setConfirmId(null);
    open('card');
  });

  // subscribe first (above), then fetch; start from rest (or the tab while docked)
  useEffect(() => {
    let dead = false;
    void (async () => {
      const s = await refetchSettings();
      if (dead) return;
      const isDocked = !!s && (s.preferences.snap === 'screen_left' || s.preferences.snap === 'screen_right') && s.preferences.form === 'tab';
      setDocked(isDocked);
      setPinned(s?.preferences.pinned ?? null);
      await refetchAttention();
      if (!dead) setFormNative(restForm(isDocked));
    })();
    return () => {
      dead = true;
    };
  }, [refetchAttention, refetchSettings]);

  // re-read while any GATE is open, and whenever the window comes back (WebView2 throttles hidden pages)
  const anyGate = items.some((i) => i.kind === 'gate');
  useEffect(() => {
    if (!anyGate) return;
    const t = setInterval(() => void refetchAttention(), RECONCILE_MS);
    return () => clearInterval(t);
  }, [anyGate, refetchAttention]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void refetchAttention();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refetchAttention]);

  // focus the drawn form after a user-initiated open
  useEffect(() => {
    if (!autoFocus.current) return;
    if (form === 'card' || form === 'stack' || form === 'handoff' || form === 'welcome') {
      autoFocus.current = false;
      formEl.current?.focus({ preventScroll: true });
    }
  }, [form, focusId]);
  useEffect(() => {
    if (confirmId) formEl.current?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus();
  }, [confirmId]);
  useEffect(() => setFailure(null), [form, focusId]);

  // a card or ticker drawn without content goes back to rest
  const cardItem: AttentionItem | undefined =
    items.find((i) => i.deal_id === focusId) ?? (ack.current && ack.current.dealId === focusId ? known.current.get(focusId) : undefined) ?? items[0];
  useEffect(() => {
    if (form === 'card' && !cardItem) setFormNative(restForm(docked));
    if (form === 'ticker' && !ticker && !tickerTimer.current) setFormNative(handoff.active ? 'handoff' : restForm(docked));
  }, [form, cardItem, ticker, docked, handoff.active]);

  useEffect(() => () => {
    if (tickerTimer.current) clearTimeout(tickerTimer.current);
    if (ack.current) clearTimeout(ack.current.timer);
  }, []);

  // ------------------------------------------------------------------ actions (safe direction only)
  const fail = (dealId: string | null, what: string, e: unknown) => setFailure({ dealId, what, error: toWalletError(e) });

  const review = useCallback(async (it: AttentionItem) => {
    if (!canReview(it)) return; // a HOLD has no path toward paying
    setReviewed(it.deal_id);
    try {
      await backend().invoke('approval_open', { deal_id: it.deal_id });
    } catch (e) {
      setReviewed(null);
      fail(it.deal_id, 'Review', e);
    }
  }, []);

  const awaitAck = (it: AttentionItem, kind: 'withdraw' | 'let_lapse') => {
    if (ack.current) clearTimeout(ack.current.timer);
    ack.current = {
      dealId: it.deal_id,
      timer: setTimeout(() => {
        ack.current = null;
        pushTicker(ackTicker(it, kind), true);
      }, ACK_MS),
    };
  };

  const withdraw = useCallback(async (it: AttentionItem) => {
    setBusy(true);
    try {
      awaitAck(it, 'withdraw');
      await backend().invoke('deal_withdraw', { deal_id: it.deal_id });
      setConfirmId(null);
    } catch (e) {
      if (ack.current) clearTimeout(ack.current.timer);
      ack.current = null;
      setConfirmId(null);
      fail(it.deal_id, 'Withdraw', e);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushTicker]);

  const letLapse = useCallback(async (it: AttentionItem) => {
    try {
      awaitAck(it, 'let_lapse');
      await backend().invoke('deal_let_lapse', { deal_id: it.deal_id });
    } catch (e) {
      if (ack.current) clearTimeout(ack.current.timer);
      ack.current = null;
      fail(it.deal_id, 'Let it lapse', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushTicker]);

  // Rust owns the snooze (deal_snooze: GATE, deadline > 45 min, 30 min, persisted); the page
  // pre-filters with the same rule and then only reflects the next snapshot, where the item is gone.
  const snooze = useCallback(async (it: AttentionItem) => {
    if (!snoozeEligible(it, Math.floor(Date.now() / 1000))) return;
    setSnoozing(it.deal_id);
    // hold the card on this item while Rust's next snapshot drops it, until the ticker takes over
    if (ack.current) clearTimeout(ack.current.timer);
    ack.current = { dealId: it.deal_id, timer: setTimeout(() => (ack.current = null), ACK_MS) };
    try {
      await backend().invoke('deal_snooze', { deal_id: it.deal_id });
      pushTicker(snoozeTicker(it, Math.floor(Date.now() / 1000) + SECONDS.snooze), true);
      void refetchAttention();
    } catch (e) {
      if (ack.current?.dealId === it.deal_id) {
        clearTimeout(ack.current.timer);
        ack.current = null;
      }
      fail(it.deal_id, 'Snooze', e);
    } finally {
      setSnoozing(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushTicker, refetchAttention]);

  const openInTable = useCallback(async (dealId: string | null) => {
    try {
      await backend().invoke('main_open', { deal_id: dealId });
    } catch (e) {
      fail(dealId, 'Open in Table', e);
    }
  }, []);

  const onAction = (a: CardAction['action'], it: AttentionItem) => {
    if (a === 'review') void review(it);
    else if (a === 'withdraw') setConfirmId(it.deal_id);
    else if (a === 'let_lapse') void letLapse(it);
    else if (a === 'snooze30') void snooze(it);
    else void openInTable(it.deal_id);
  };

  const togglePin = async () => {
    const next = !(pinned ?? true);
    try {
      await backend().invoke('tumbler_pin', { pinned: next });
      setPinned(next);
    } catch (e) {
      fail(null, 'Pin', e);
    }
  };
  const toggleDnd = async () => {
    if (!settings) return;
    try {
      // settings_write replaces the whole record; the snapshot may predate a native drag or snap.
      const fresh = await backend().invoke('get_settings', null);
      await backend().invoke('settings_write', dndPreferences(fresh.preferences, { form: formRef.current, pinned }, !dnd));
      await refetchSettings();
    } catch (e) {
      fail(null, 'Do not disturb', e);
    }
  };

  // ------------------------------------------------------------------ puck: click, drag
  const onPuckClick = () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (form === 'rest' || form === 'tab') {
      const t = puckTarget({ snapshot, handoff: handoff.active, preferId: focusId });
      if (t.form === 'card') setFocusId(t.id);
      open(t.form);
    } else if (form === 'ticker') openFromTicker();
    else rest();
  };
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    swallowClick.current = false;
    drag.current = { x: e.clientX, y: e.clientY, started: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.started) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_THRESHOLD) {
      d.started = true;
      swallowClick.current = true; // WebView2 delivers a trailing click after a native drag
      setDocked(false);
      backend()
        .invoke('tumbler_drag', null)
        .catch((err: unknown) => console.warn('tumbler_drag', toWalletError(err).message));
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // ------------------------------------------------------------------ keyboard
  const onCardKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const it = cardItem;
    if (!it || e.ctrlKey || e.altKey || e.metaKey) return;
    // a details popover is portaled out of the card but its keys still bubble through React's
    // tree: typing there never withdraws (Esc is taken first by the layer stack and closes it)
    if (e.target instanceof Element && e.target.closest('.ui-popover')) return;
    if (e.key === 'Enter' && e.target === e.currentTarget) {
      e.preventDefault();
      if (canReview(it)) void review(it); // Enter reviews; it never approves anything
    } else if (e.key === 'w' || e.key === 'W') {
      if (!it.actions.includes('withdraw')) return;
      e.preventDefault();
      if (confirmId === it.deal_id) void withdraw(it);
      else setConfirmId(it.deal_id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (confirmId) {
        setConfirmId(null);
        formEl.current?.focus({ preventScroll: true });
      } else rest();
    }
  };
  const onRootKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && form !== 'rest' && form !== 'tab') {
      e.preventDefault();
      rest();
    }
  };

  // ------------------------------------------------------------------ render
  const puckRight = orient.side === 'left';
  const puckBottom = orient.valign === 'up';
  const flushLeft = settings?.preferences.snap === 'screen_left';
  const handoffItem = handoff.dealId ? items.find((i) => i.deal_id === handoff.dealId) ?? known.current.get(handoff.dealId) ?? null : null;
  const display = handoffDisplay.data && handoffDisplay.data.deal_id === handoff.dealId ? handoffDisplay.data : null;
  const count = look.needs;
  const puckLabel = `The Tumbler · ${count ? `${count} need${count === 1 ? 's' : ''} you · ${items[0]?.label ?? ''}` : `nothing needs you · ${snapshot?.in_motion ?? 0} in motion`}${mode ? ` · ${mode}` : ''}${locked ? ' · locked' : ''}`;

  let body: ReactNode = null;
  if (form === 'ticker') body = <TickerForm ticker={ticker} onOpen={openFromTicker} />;
  else if (form === 'card' && cardItem)
    body = (
      <CardForm ref={formEl} item={cardItem} items={items} now={now} locked={locked} busy={busy}
        pending={snoozing === cardItem.deal_id ? 'snooze30' : busy ? 'withdraw' : null}
        confirming={confirmId === cardItem.deal_id} reviewed={reviewed === cardItem.deal_id}
        failure={failure && failure.dealId === cardItem.deal_id ? failure : null}
        onAction={onAction}
        onConfirm={(yes) => (yes ? void withdraw(cardItem) : (setConfirmId(null), formEl.current?.focus({ preventScroll: true })))}
        onNav={(dir) => {
          const i = items.findIndex((x) => x.deal_id === cardItem.deal_id);
          const n = items[(i + dir + items.length) % items.length];
          if (n) {
            setFocusId(n.deal_id);
            setConfirmId(null);
          }
        }}
        onStack={() => open('stack')} onKey={onCardKey} />
    );
  else if (form === 'stack')
    body = (
      <StackForm ref={formEl} snapshot={snapshot} items={items} now={now} locked={locked} mode={mode}
        metersAvailable={!!settings?.meters_available} paused={!!settings?.agents_paused} pinned={pinned} dnd={dnd}
        failure={failure && failure.dealId === null ? failure : null}
        onOpen={(id) => { setFocusId(id); open('card'); }} onTable={() => void openInTable(null)} onPin={() => void togglePin()} onDnd={() => void toggleDnd()} />
    );
  else if (form === 'handoff')
    body = <HandoffForm ref={formEl} handoff={handoff} item={handoffItem} display={display} now={now} locked={locked} mode={mode} onTable={() => void openInTable(handoff.dealId)} onRest={rest} />;
  else if (form === 'welcome') body = <WelcomeForm ref={formEl} mode={mode} locked={locked} onOk={rest} />;

  const kindClass = form === 'card' && cardItem ? (cardItem.kind === 'hold' ? ' k-hold' : ' k-gate') : form === 'ticker' && ticker ? ` k-${ticker.kind}` : '';
  const classes = [
    'tum', `form-${form}`, puckRight ? 'px-r' : 'px-l', puckBottom ? 'py-b' : 'py-t', `ring-${look.ring}`, `u-${look.urgency}`,
    look.breathe ? 'breathe' : '', locked ? 'locked' : '', reducedMotion ? 'reduced' : '', handoff.active ? 'in-handoff' : '',
  ].filter(Boolean).join(' ') + kindClass;

  return (
    <div className={classes} onKeyDown={onRootKey} style={form === 'rest' || form === 'tab' ? { opacity: look.opacity / 100 } : undefined}
      aria-label="The Tumbler" role="complementary">
      {form === 'tab' ? (
        <button className="tabbtn" onClick={onPuckClick} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          aria-label={`${puckLabel} · docked`} title={`${puckLabel} · docked · click to open, drag to undock`}>
          <TabForm needs={count} inMotion={snapshot?.in_motion ?? 0} mode={mode} flushLeft={flushLeft} ring={look.ring} />
        </button>
      ) : (
        <>
          {form !== 'rest' ? <div className="plate" aria-hidden="true" /> : null}
          <div className="tbody">{body}</div>
          <button className="puck" onClick={onPuckClick} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            aria-label={puckLabel} title={`${puckLabel}${form === 'rest' ? ' · click to open, drag to move' : ' · click for rest'}`}>
            <PuckArt look={look} items={items} newIds={newIds} inMotion={snapshot?.in_motion ?? 0} mode={mode} locked={locked} handoff={handoff.active} />
          </button>
        </>
      )}
    </div>
  );
}
