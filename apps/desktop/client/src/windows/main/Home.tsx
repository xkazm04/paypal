// Layer 0 - The Dial home (v2): a 38px title bar (mode, Find, lock, Settings, the theme switch),
// the dial with "Needs you" in the hub as the hero, compact indicative side columns (the week's
// ledger, every open decision with its default on silence) and a 28px status footer (shortcuts: ?).
// Detail opens in a Popover (hub "Details", the ledger's Held / In motion / Stopped lists).
// Nothing turns without the owner: money only ever moves from the approval window.
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { Module } from '@bindings/Module';
import type { TumblerStatus } from '@bindings/TumblerStatus';
import { formatMinor } from '../../lib/format';
import { readLimits, type LimitMeter } from '../../lib/limits';
import { kindWord, ruleNameOf } from '../../lib/words';
import { useMutation, useNow, usePrefersReducedMotion } from '../../lib/hooks';
import { Countdown, MockBadge, ModeBadge, WalletNotice } from '../../shared/honesty';
import { MODULE, MODULES } from '../../shared/modules';
import { Btn, Chip, Explainer, Group, Hint, Kv, Meter, Popover, Section, Silence, Spacer, ThemeSwitch, TitleBar, type ExplainerStep } from '../../shared/ui';
import { Dial, LegendBead, type Bead } from './Dial';
import { chipTone, dealCount, LEDGER_TITLE, ledgerDeals, ledgerLine, moneyList, shortTitle, silenceParts, timeLeft, weekLabel, type LedgerKind } from './home/model';
import {
  beadKind, beadSummary, chipClass, dealTotal, historyAt, isLive, ledgerScope, moduleIndex, moneyNow, reviewVerb, spendToday, splitHeadline, stateLabel, summarize, sumByCurrency,
  weekBounds, type LedgerScope, type LedgerSummary,
} from './logic';
import { RewindBar, RewindHub, useRewind } from './Rewind';
import { StatusChips } from './Status';
import { LockGlyph, mc } from './ui';
import { useWorld } from './world';
import './home.css';

type Props = {
  active: boolean;
  /** Set when the owner comes back from a module (the dial zooms out onto that sector). */
  returnedFrom: { module: Module; n: number } | null;
  keysEnabled: boolean;
  tumbler: TumblerStatus | null;
  onOpenModule: (m: Module) => void;
  onOpenDeal: (id: string) => void;
  onOpenSheet: (tab: 'settings' | 'pairing' | 'mandates') => void;
  onFind: () => void;
  skipIntro: boolean;
};

export function Home(p: Props) {
  const w = useWorld();
  const reduced = usePrefersReducedMotion();
  const deals = useMemo(() => w.deals.data ?? [], [w.deals.data]);
  const needs = w.needs;
  const settings = w.settings.data;

  const [mode, setMode] = useState<'needs' | 'module'>('needs');
  const [sel, setSel] = useState(0);
  const [needIdx, setNeedIdx] = useState(0);
  const [intro, setIntro] = useState<'wait' | 'run' | 'done'>(p.skipIntro ? 'done' : 'wait');
  const [zoom, setZoom] = useState(false);
  const [flash, setFlash] = useState(0);
  // Rewind: the week replayed under the dial (R toggles, Esc or "Back to now" returns to live).
  const [rewind, setRewind] = useState(false);
  const onDial = useRef(false);
  const timers = useRef<{ idle?: ReturnType<typeof setTimeout>; ret?: ReturnType<typeof setTimeout> }>({});
  const zooming = useRef(false);

  const safeNeedIdx = needs.length ? Math.min(needIdx, needs.length - 1) : 0;
  const top: AttentionItem | undefined = needs[safeNeedIdx];
  const pointed = top ? Math.max(0, moduleIndex(top.module)) : 0;
  const focus = mode === 'module' ? sel : pointed;

  // Start the intro once the first snapshots are in (so it clicks onto the real first decision).
  useEffect(() => { if (intro === 'wait' && w.ready) setIntro('run'); }, [intro, w.ready]);
  const finishIntro = useCallback(() => {
    setIntro((i) => {
      if (i === 'done') return i;
      if (!reduced) setFlash((f) => f + 1);
      return 'done';
    });
  }, [reduced]);

  const pointNeeds = useCallback(() => { setMode('needs'); }, []);
  const selectModule = useCallback((i: number) => { setMode('module'); setSel(((i % 6) + 6) % 6); }, []);
  const turn = useCallback((d: 1 | -1) => { selectModule((mode === 'module' ? sel : pointed) + d); }, [mode, sel, pointed, selectModule]);
  const cycleNeed = (d: 1 | -1) => { if (!needs.length) return; setNeedIdx((safeNeedIdx + d + needs.length) % needs.length); setMode('needs'); };

  const zoomInto = useCallback((i: number) => {
    if (zooming.current || i < 0) return;
    zooming.current = true;
    setRewind(false);
    clearTimeout(timers.current.idle); clearTimeout(timers.current.ret);
    selectModule(i);
    const key = MODULES[i]?.key;
    if (!key) return;
    setTimeout(() => {
      setZoom(true);
      setTimeout(() => { zooming.current = false; p.onOpenModule(key); }, reduced ? 160 : 520);
    }, reduced ? 0 : 380);
  }, [p, reduced, selectModule]);

  // Coming back from a module: zoom out onto that sector, then turn back to what needs you.
  useEffect(() => {
    if (!p.returnedFrom || !p.active) return;
    selectModule(moduleIndex(p.returnedFrom.module));
    setIntro('done');
    const t = setTimeout(() => setZoom(false), 30);
    clearTimeout(timers.current.ret);
    timers.current.ret = setTimeout(() => { if (!onDial.current) pointNeeds(); }, reduced ? 900 : 1600);
    return () => clearTimeout(t);
  }, [p.returnedFrom, p.active, selectModule, pointNeeds, reduced]);
  useEffect(() => { if (p.active && !p.returnedFrom) setZoom(false); }, [p.active, p.returnedFrom]);

  // Keyboard: arrows turn, up/down cycle decisions, Enter opens, 1-6 jump, Esc back to Needs you.
  // The handler reads this render's values through a ref, so the window listener is attached
  // once per active/keys-enabled period instead of on every clock-tick re-render. Open layers
  // (Popover, Sheet, palette) switch keysEnabled off, so Esc closes them first.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKey.current = (e: KeyboardEvent) => {
      if (intro === 'run') {
        if (!e.ctrlKey && !e.metaKey && e.key !== 'Tab') { e.preventDefault(); finishIntro(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || zooming.current || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (settings?.first_run) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); turn(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); turn(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); cycleNeed(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cycleNeed(-1); }
      else if (e.key === 'Escape') { if (rewind) { e.preventDefault(); setRewind(false); } else if (mode === 'module') { e.preventDefault(); pointNeeds(); } }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setRewind((x) => !x); }
      else if (e.key === 'Enter') {
        if (t && t !== document.body && (t.tagName === 'BUTTON' || t.getAttribute('role') === 'button')) return; // the focused control acts
        e.preventDefault(); zoomInto(focus);
      } else if (/^[1-6]$/.test(e.key)) { e.preventDefault(); zoomInto(Number(e.key) - 1); }
    };
  });
  useEffect(() => {
    if (!p.active || !p.keysEnabled) return;
    const k = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [p.active, p.keysEnabled]);

  // Beads: every deal on the middle ring, in its module's sector.
  const beads = useMemo<Bead[]>(() => {
    const ordered = [...deals].sort((a, b) => moduleIndex(w.moduleOfDeal(a)) - moduleIndex(w.moduleOfDeal(b)) || w.display(a).label.localeCompare(w.display(b).label));
    return ordered.map((d) => {
      const m = w.moduleOfDeal(d);
      const disp = w.display(d);
      const need = w.needOf(d.id);
      const t = dealTotal(d);
      return {
        id: d.id, m: moduleIndex(m), kind: beadKind(d), needs: !!need,
        tip: {
          label: disp.label, title: disp.title, amount: formatMinor(t.minor, t.currency), state: stateLabel(d.state, d), tone: chipTone(chipClass(d)),
          module: `${MODULE[m].name} · ${kindWord(d.kind)}`, color: MODULE[m].cssVar, money: moneyNow(d), need: need ? need.headline : null,
        },
      };
    });
  }, [deals, w]);
  const badges = useMemo(() => MODULES.map((m) => needs.filter((n) => n.module === m.key).length), [needs]);
  // The left column is "This week" (Mon-Sun local) when Rust's timestamps are present; it
  // re-scopes when the week turns over, not every clock tick.
  const now = useNow();
  const weekStart = weekBounds(now).start;
  const scope = useMemo(() => ledgerScope(deals, weekStart), [deals, weekStart]);
  const summary = useMemo(() => summarize(scope.deals, new Set(needs.map((n) => n.deal_id))), [scope, needs]);

  // Rewind: beads stand where their deals stood at the playhead; deals not begun yet are absent.
  const rw = useRewind(rewind, now, reduced);
  const labelOf = useMemo(() => {
    const by = new Map(deals.map((d) => [d.id, d]));
    return (id: string) => {
      const d = by.get(id);
      if (!d) return null;
      const disp = w.display(d);
      return { deal: d, label: disp.label, title: shortTitle(disp.title) };
    };
  }, [deals, w]);
  const pastBeads = useMemo<Bead[]>(() => {
    if (!rewind) return [];
    const at = historyAt(rw.steps, rw.t);
    return beads.flatMap((b) => {
      const p = at.get(b.id);
      const d = deals.find((x) => x.id === b.id);
      if (!p || !d) return [];
      const then = { ...d, state: p.state, shield: p.paused ? 'HOLD' as const : null };
      return [{ ...b, kind: beadKind(then), needs: false, tip: { ...b.tip, state: stateLabel(p.state, d), tone: chipTone(chipClass(then)), money: moneyNow(then), need: null } }];
    });
  }, [rewind, rw.steps, rw.t, beads, deals]);

  const firstRun = !!settings?.first_run;
  const cls = ['home', intro !== 'done' ? 'intro' : '', zoom ? 'zoom' : '', p.active ? '' : 'away', firstRun ? 'first-run' : '', rewind && !firstRun ? 'rewind' : ''].join(' ');

  return (
    <div className={cls} onClick={() => { if (intro === 'run') finishIntro(); }} aria-hidden={!p.active}>
      <TitleBar className="top">
        <div className="brand">
          <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="13" rx="10" ry="6" fill="none" stroke="var(--gold)" strokeWidth="2" /><circle cx="12" cy="13" r="2" fill="var(--gold)" /></svg>
          <b>The Table</b><span>an agentic wallet built on PayPal</span>
        </div>
        <Spacer />
        {settings ? <ModeBadge mode={settings.mode} />
          : <Chip tone="dashed" title={w.settings.error ? `get_settings failed: ${w.settings.error.message}` : 'Reading settings'}>mode unknown</Chip>}
        <MockBadge />
        <Btn sm onClick={p.onFind} title="Find a deal, counterparty or module">Find <span className="kbd">Ctrl K</span></Btn>
        <LockIndicator />
        <Btn sm onClick={() => p.onOpenSheet('settings')} title="Agent app, safety checks and PayPal">Settings</Btn>
        <ThemeSwitch />
      </TitleBar>
      <main className="stage">
        <section className="col l" aria-label={scope.scope === 'week' ? 'This week' : 'The ledger'}>
          <Explainer id="home" title="How The Table works" steps={HOME_STEPS} className="home-ex" />
          {firstRun ? <FirstRunSide /> : <Ledger s={summary} scope={scope} onDeal={p.onOpenDeal} onBook={() => zoomInto(moduleIndex('book'))} />}
        </section>
        <Dial beads={firstRun ? [] : rewind ? pastBeads : beads} badges={firstRun || rewind ? [0, 0, 0, 0, 0, 0] : badges} focus={focus} mode={mode} intro={intro} reduced={reduced}
          glow={!firstRun && !rewind && needs.length > 0} flash={flash}
          onIntroDone={finishIntro} onSkipIntro={finishIntro}
          onHover={(i) => { if (!firstRun) selectModule(i); }}
          onOpen={(i) => { if (!firstRun) zoomInto(i); }}
          onBead={p.onOpenDeal}
          onTurn={(d) => { if (!firstRun) turn(d); }}
          onPointerInside={(inside) => {
            onDial.current = inside;
            clearTimeout(timers.current.idle);
            if (!inside) timers.current.idle = setTimeout(() => { if (p.active && !zooming.current) pointNeeds(); }, 1500);
          }}>
          {rewind && !firstRun ? <RewindHub r={rw} labelOf={labelOf} onOpenDeal={p.onOpenDeal} /> : (
            <Hub mode={mode} sel={sel} item={top} index={safeNeedIdx} count={needs.length} summary={summary} week={scope.scope === 'week'}
              onOpen={zoomInto} onBack={pointNeeds} onPage={cycleNeed} onDeal={p.onOpenDeal} />
          )}
        </Dial>
        {rewind && !firstRun ? <RewindBar r={rw} labelOf={labelOf} onOpenDeal={p.onOpenDeal} onExit={() => setRewind(false)} /> : null}
        <section className="col r needs" aria-label="Needs you">
          {firstRun ? null : <NeedsList needs={needs} on={mode === 'needs' ? safeNeedIdx : -1}
            onPoint={(i) => { if (intro === 'done') { setNeedIdx(i); setMode('needs'); } }} onOpen={p.onOpenDeal} />}
        </section>
      </main>
      <footer className="foot">
        <StatusChips onSettings={() => p.onOpenSheet('settings')} />
        <span className="hint" title="Turn the dial with ← → or the mouse wheel · Enter opens · 1–6 jump · Ctrl K finds">Press <span className="kbd">?</span> for shortcuts</span>
        <span className="r">
          {firstRun ? null : (
            <button type="button" className={`hs-chip rw-toggle ${rewind ? 'on' : ''}`} aria-pressed={rewind} onClick={() => setRewind((x) => !x)}
              title={rewind ? 'Back to the dial as it is now (R or Esc)' : 'Replay the week: who decided each payment (R)'}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5M3 2.5v2.6h2.6M8 5.2V8l2 1.3" /></svg>
              {rewind ? 'Back to now' : 'Rewind'}
            </button>
          )}
          <TumblerPill status={p.tumbler} /><Clock />
        </span>
      </footer>
    </div>
  );
}

// The first-visit explainer sits at the top of the left column, so it never covers the hub's decision.
const HOME_STEPS: readonly ExplainerStep[] = [
  { icon: 'agent', title: 'Your agents work', text: 'They shop, haggle and sell for you.' },
  { icon: 'rules', title: 'Your rules protect', text: 'They can only act inside limits you signed.' },
  { icon: 'you', title: 'You decide what pays', text: 'Money moves only on your approval or a rule you signed.' },
];

// ---- the hub ----------------------------------------------------------------------------------

const stop = (e: MouseEvent) => e.stopPropagation();

function Hub({ mode, sel, item, index, count, summary, week, onOpen, onBack, onPage, onDeal }: {
  mode: 'needs' | 'module'; sel: number; item: AttentionItem | undefined; index: number; count: number; summary: LedgerSummary; week: boolean;
  onOpen: (i: number) => void; onBack: () => void; onPage: (d: 1 | -1) => void; onDeal: (id: string) => void;
}) {
  const w = useWorld();
  const open = useMutation('approval_open');
  const settings = w.settings.data;

  if (w.settings.error && !settings) return <div className="hc"><WalletNotice error={w.settings.error} what="Settings" /></div>;
  if (!w.ready) {
    const err = w.deals.error ?? w.attention.error;
    return <div className="hc"><div className="h-eyebrow">The Table</div>{err ? <WalletNotice error={err} what={w.deals.error ? 'Ledger' : 'Needs you'} /> : <div className="h-week">reading the ledger…</div>}</div>;
  }

  if (settings?.first_run) {
    return (
      <div className="hc first">
        <div className="h-eyebrow">Welcome</div>
        <div className="h-calm">Set your agents’ rules</div>
        <div className="h-hint">Until you sign them, no agent can agree to anything.</div>
        <button type="button" className="gbtn" onClick={(e) => { stop(e); void open.run({ deal_id: null }); }} disabled={open.pending}
          title="Opens the approval window, where you sign your rules">Set rules ↗</button>
        {open.error ? <WalletNotice error={open.error} what="Approval window" /> : null}
      </div>
    );
  }

  if (mode === 'module') {
    const m = MODULES[sel];
    if (!m) return null;
    const all = w.deals.data ?? [];
    const ds = all.filter((d) => w.moduleOfDeal(d) === m.key);
    const nNeeds = w.needs.filter((n) => n.module === m.key).length;
    const live = ds.filter(isLive).length;
    const topNeed = w.needs.find((n) => n.module === m.key);
    const head = m.key === 'book'
      ? (settings?.meters_available ? `${moneyList(summary.out)} out · ${moneyList(summary.inn)} in${week ? ' this week' : ''}` : beadSummary(all))
      : topNeed ? topNeed.headline : beadSummary(ds);
    const counts = m.key === 'book'
      ? <>all <b>{all.length}</b> deals · only reads, never changes</>
      : <>{ds.length} deal{ds.length === 1 ? '' : 's'}{nNeeds ? <> · <b>{nNeeds}</b> need{nNeeds === 1 ? 's' : ''} you</> : null} · {live} in progress</>;
    return (
      <div className="hc" key={`m-${m.key}`} style={mc(m.key)}>
        <div className="hm-name">{m.name}</div>
        <div className="hm-long">{m.long}</div>
        <div className="hm-head">{head}</div>
        <div className="hm-counts">{counts}</div>
        <button type="button" className="hm-open" onClick={(e) => { stop(e); onOpen(sel); }} title="Enter">Open {m.name}</button>
        {count ? <button type="button" className="hm-back" onClick={(e) => { stop(e); onBack(); }} title="Esc">‹ Back to what needs you ({count})</button> : null}
      </div>
    );
  }

  if (item) {
    return (
      <div className="hc" key={`n-${item.deal_id}`}>
        <div className="h-row">
          <div className="h-count">{count}</div>
          <div className="h-lbl"><b>Need{count === 1 ? 's' : ''} you</b><span>no money moves until you decide</span></div>
        </div>
        <NeedPlate item={item} onDeal={onDeal} />
        {count > 1 ? (
          <div className="pager">
            <button type="button" onClick={(e) => { stop(e); onPage(-1); }} aria-label="Previous decision">‹</button>
            <span>{index + 1} / {count}</span>
            <button type="button" onClick={(e) => { stop(e); onPage(1); }} aria-label="Next decision">›</button>
          </div>
        ) : null}
      </div>
    );
  }

  const meters = !!settings?.meters_available;
  const held = sumByCurrency(summary.held.map(dealTotal));
  return (
    <div className="hc" key="quiet">
      <div className="h-eyebrow">All quiet</div>
      <div className="h-calm">Nothing needs you</div>
      <div className="h-week">
        {meters ? <>{moneyList(summary.out)} out · {moneyList(summary.inn)} in{week ? ' this week' : ''}<br /></> : null}
        {held.length ? moneyList(held) : 'nothing'} on hold · {summary.moving.length} in progress
      </div>
      <div className="h-hint">Your agents work inside the rules you signed.</div>
    </div>
  );
}

/** The one decision on the hub: what, how much, with whom, the default on silence, one button. */
function NeedPlate({ item, onDeal }: { item: AttentionItem; onDeal: (id: string) => void }) {
  const w = useWorld();
  const open = useMutation('approval_open');
  const [details, setDetails] = useState<HTMLElement | null>(null);
  const amount = formatMinor(item.amount_minor, item.currency);
  const [verb, gold] = splitHeadline(item.headline, amount);
  const deal = (w.deals.data ?? []).find((d) => d.id === item.deal_id);
  const title = deal ? w.display(deal).title : null;
  const canReview = item.actions.includes('review');
  return (
    <div className="plate" style={mc(item.module)}>
      <div className="p-tag"><i />{MODULE[item.module].name} · <span className="mono">{item.label}</span>
        {item.deadline ? <> · <Countdown deadline={item.deadline} className={item.urgency === 'now' ? 'red' : 'gold'} /></> : null}</div>
      <div className="p-verb">{verb} {gold ? <b>{gold}</b> : null}</div>
      <div className="p-who">{[item.counterparty, title].filter(Boolean).join(' · ') || <span className="dim">no counterparty name yet</span>}</div>
      <SilenceLine text={item.on_silence} />
      <div className="p-acts">
        <Btn kind="plain" sm onClick={(e) => { stop(e); const a = e.currentTarget; setDetails((x) => (x ? null : a)); }} aria-expanded={!!details}>Details</Btn>
        {canReview ? (
          <button type="button" className="gbtn" onClick={(e) => { stop(e); void open.run({ deal_id: item.deal_id }); }} disabled={open.pending}
            title={w.locked ? 'Locked after 15 quiet minutes: you unlock with Windows Hello first' : 'Opens the approval window, the only place money can be released'}>
            {w.locked ? <LockGlyph locked /> : null}{reviewVerb(item, deal)} ↗
          </button>
        ) : (
          <button type="button" className="gbtn" onClick={(e) => { stop(e); onDeal(item.deal_id); }}>Open {item.label}</button>
        )}
      </div>
      {open.error ? <WalletNotice error={open.error} what="Approval window" /> : null}
      {details ? (
        <Popover anchor={details} onClose={() => setDetails(null)} title={`${MODULE[item.module].name} · ${item.label}`} className="home-pop">
          <Kv items={[
            ['Item', title ?? <span className="dim">no title yet</span>],
            ['With', item.counterparty ?? <span className="dim">not named yet</span>],
            deal ? ['Status', <Chip tone={chipTone(chipClass(deal))}>{stateLabel(deal.state, deal)}</Chip>] : null,
            ['Asks you', item.headline],
            item.clause ? ['Why you', <>your rule “{ruleNameOf(item.clause.number)}”</>] : null,
            deal ? ['Money now', moneyNow(deal)] : null,
            item.deadline ? ['Time left', <Countdown deadline={item.deadline} />] : null,
            ['If you do nothing', item.on_silence],
          ]} />
          <div className="pop-acts"><Btn sm onClick={() => { setDetails(null); onDeal(item.deal_id); }}>Open {item.label} ›</Btn></div>
        </Popover>
      ) : null}
    </div>
  );
}

/** "⧗ If you do nothing: <b>the offer lapses at 18:00</b> · no money moves" (the full text in the tooltip). */
function SilenceLine({ text }: { text: string }) {
  const { head, rest } = silenceParts(text);
  return <span title={`If you do nothing: ${text}`} className="sil"><Silence text={head}>{rest ? <> · {rest}</> : null}</Silence></span>;
}

// ---- left: the ledger -------------------------------------------------------------------------

function Ledger({ s, scope, onDeal, onBook }: { s: LedgerSummary; scope: LedgerScope; onDeal: (id: string) => void; onBook: () => void }) {
  const w = useWorld();
  const [pop, setPop] = useState<{ kind: LedgerKind; anchor: HTMLElement } | null>(null);
  const settings = w.settings.data;
  const meters = !!settings?.meters_available;
  const att = w.attention.data;
  const all = w.deals.data ?? [];
  if (w.deals.error && !w.deals.data) return <WalletNotice error={w.deals.error} what="Ledger" />;
  const heldSum = sumByCurrency(s.held.map(dealTotal));
  const toggle = (kind: LedgerKind) => (e: MouseEvent<HTMLButtonElement>) => {
    const anchor = e.currentTarget;
    setPop((x) => (x && x.kind === kind ? null : { kind, anchor }));
  };
  const hidden = 'Not counted yet: the wallet cannot add this up here';
  const thisWeek = scope.scope === 'week' ? ' this week' : '';
  return (
    <>
      <Section title={scope.scope === 'week' ? 'This week' : 'The ledger'}
        end={scope.scope === 'week'
          ? <span title={`Monday to Sunday, local time: everything still in play, plus what was created or changed this week (${scope.deals.length} of ${all.length} deals)`}>{weekLabel(scope.start, scope.end)}</span>
          : <span title="This shell does not report deal timestamps, so the week cannot be told apart: the whole ledger is shown">all {all.length} deals</span>}>
        <div className="ui-group">
          <button type="button" className="ui-row act" onClick={onBook} title={meters ? `Paid by your agents${thisWeek}. Only completed payments count; holds and offers never do. Opens Book.` : `${hidden}. Opens Book.`}>
            <span className="lbl">Your agents paid</span><span className={`amt ${meters ? '' : 'dim'}`}>{meters ? moneyList(s.out) : '—'}</span>
          </button>
          <button type="button" className="ui-row act" onClick={onBook} title={meters ? `Paid to you${thisWeek}. Only completed payments count. Opens Book.` : `${hidden}. Opens Book.`}>
            <span className="lbl">You received</span><span className={`amt ${meters ? '' : 'dim'}`}>{meters ? moneyList(s.inn) : '—'}</span>
          </button>
          <button type="button" className="ui-row act" onClick={toggle('held')} aria-expanded={pop?.kind === 'held'} title="Held at PayPal or paused by a check: not paid">
            <span className="lbl">On hold <span className="dim">· {dealCount(s.held.length)}</span></span><span className="amt gold">{s.held.length ? moneyList(heldSum) : '—'}</span><span className="chev" aria-hidden="true" />
          </button>
          <button type="button" className="ui-row act" onClick={toggle('moving')} aria-expanded={pop?.kind === 'moving'} title="Going on by themselves; nothing for you to decide">
            <span className="lbl">In progress</span><span className={`amt ${s.moving.length ? 'teal' : 'dim'}`}>{dealCount(s.moving.length)}</span><span className="chev" aria-hidden="true" />
          </button>
          <button type="button" className="ui-row act" onClick={toggle('stopped')} aria-expanded={pop?.kind === 'stopped'} title={`Refused or blocked before any money moved${thisWeek}`}>
            <span className="lbl">Stopped for safety</span><span className={`amt ${s.stopped.length ? '' : 'dim'}`}>{dealCount(s.stopped.length)}</span><span className="chev" aria-hidden="true" />
          </button>
        </div>
      </Section>
      <TodayMeters meters={meters} att={att} engine={settings?.selected_engine ?? null} />
      <Section title="On the dial">
        <div className="legend" aria-label="What the dots on the dial mean">
          <span><LegendBead kind="moving" />in progress</span>
          <span><LegendBead kind="held" />on hold</span>
          <span><LegendBead kind="settled" />paid</span>
          <span><LegendBead kind="stopped" />stopped</span>
          <span><LegendBead kind="off" />withdrawn</span>
          <span><LegendBead kind="needs" />needs you</span>
        </div>
      </Section>
      {pop ? (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} title={LEDGER_TITLE[pop.kind]} className="home-pop">
          <Group empty="Nothing here.">
            {ledgerDeals(pop.kind, s).map((d) => <LedgerDealRow key={d.id} d={d} kind={pop.kind} onOpen={() => { setPop(null); onDeal(d.id); }} />)}
          </Group>
        </Popover>
      ) : null}
    </>
  );
}

function LedgerDealRow({ d, kind, onOpen }: { d: Deal; kind: LedgerKind; onOpen: () => void }) {
  const w = useWorld();
  const disp = w.display(d);
  return (
    <button type="button" className="ui-row act" style={mc(w.moduleOfDeal(d))} onClick={onOpen} title={disp.title}>
      <span className="dotm" aria-hidden="true" /><span className="id">{disp.label}</span>
      <span className="clip">{ledgerLine(kind, d, disp.title)}</span>
      <Chip tone={chipTone(chipClass(d))}>{stateLabel(d.state, d)}</Chip>
    </button>
  );
}

/** Two meters, never one axis: wallet spend is money committed; the AI usage figure is the agent app’s own estimate.
 *  With the wallet's exposure (T14) the spend rows are real: paid out today, on hold now and deals today, each
 *  against the owner's signed wallet limit, a bar that turns gold near it. */
function TodayMeters({ meters, att, engine }: { meters: boolean; att: ReturnType<typeof useWorld>['attention']['data']; engine: string | null }) {
  const lim = readLimits(att?.exposure);
  if (!meters && !lim) {
    return (
      <Section title="Today">
        <div className="ui-group"><div className="ui-row" title="Today’s agent spending and AI usage appear here once the wallet can count them">
          <span className="lbl dim">Spent by agents</span><Chip tone="dashed">not counted yet</Chip>
        </div></div>
      </Section>
    );
  }
  if (!att) return null;
  const sp = spendToday(att.wallet_spend_today_minor, att.wallet_spend_today_currency);
  const end = !lim ? undefined : lim.status === 'active' ? <span title={lim.line}>against your wallet limits</span>
    : lim.status === 'none' ? <span title={lim.line}>no wallet limit</span> : <span className="gold" title={lim.line}>limits need you</span>;
  return (
    <Section title="Today" end={end}>
      <div className="ui-group">
        {lim ? (
          lim.meters.length ? lim.meters.map((m) => <LimitRow key={m.key} m={m} />) : (
            <div className="ui-row" title={lim.mixed ? 'Money went out in more than one currency, so it is not added up.' : 'Your agents have not agreed to pay anything today.'}>
              <span className="lbl">Paid out today</span><span className="amt dim">{lim.mixed ? 'mixed' : 'nothing'}</span>
            </div>
          )
        ) : (
          <div className="ui-row" title={sp.why ?? 'What your agents committed today'}>
            <span className="lbl">Spent by agents</span><span className={`amt ${sp.exact ? '' : 'dim'}`}>{sp.text}</span>
          </div>
        )}
        {meters ? (
          <div className="ui-row" title={`${engine ? `${engine}: ` : ''}the agent app’s own estimate of its AI cost. Not a bill, never added to spending, never used for money decisions.`}>
            <span className="lbl">AI usage <span className="dim">· estimate</span></span><span className="amt">~${att.engine_estimate_today_usd.toFixed(2)}</span>
          </div>
        ) : null}
      </div>
      {lim && lim.status !== 'active' && lim.status !== 'none' ? <Hint className="lh">{lim.line}</Hint> : null}
    </Section>
  );
}

/** One wallet-limit meter: the figure, the limit beside it, and a bar under them. */
function LimitRow({ m }: { m: LimitMeter }) {
  return (
    <div className="ui-row lim-row" title={m.why}>
      <span className="lbl">{m.label}</span>
      <span className="amt">{m.value}{m.of ? <small className="dim"> {m.of}</small> : null}</span>
      {m.fill !== null ? <Meter value={m.fill} tone={m.near ? 'gold' : undefined} label={`${m.label}: ${m.value} ${m.of ?? ''}`.trim()} /> : null}
    </div>
  );
}

function FirstRunSide() {
  return (
    <Section title="Getting started">
      <Hint>Sign your agents’ rules first. The dial fills as deals arrive.</Hint>
    </Section>
  );
}

// ---- right: every open decision ------------------------------------------------------------------

function NeedsList({ needs, on, onPoint, onOpen }: { needs: AttentionItem[]; on: number; onPoint: (i: number) => void; onOpen: (id: string) => void }) {
  const w = useWorld();
  const now = useNow();
  if (w.attention.error && !w.attention.data) return <WalletNotice error={w.attention.error} what="Needs you" />;
  return (
    <Section title={<>Needs you{needs.length ? <span className="dim"> · {needs.length}</span> : null}</>} end={<span title="Every item says what happens if you wait. Waiting never pays anyone.">waiting never pays</span>}>
      <Group empty="Nothing needs you. Your agents work inside the rules you signed.">
        {needs.map((x, i) => {
          const amount = formatMinor(x.amount_minor, x.currency);
          const [verb] = splitHeadline(x.headline, amount);
          const deal = (w.deals.data ?? []).find((d) => d.id === x.deal_id);
          const who = x.counterparty ?? (deal ? w.display(deal).title : null);
          const left = timeLeft(x.deadline, now);
          return (
            <button type="button" key={x.deal_id} className={`ui-row two act need-row u-${x.urgency} ${i === on ? 'on' : ''}`} style={mc(x.module)}
              aria-current={i === on ? 'true' : undefined} title={`${MODULE[x.module].name} · ${x.label} · ${x.headline}`}
              onPointerEnter={() => onPoint(i)} onFocus={() => onPoint(i)} onClick={() => onOpen(x.deal_id)}>
              <span className="dotm" aria-hidden="true" />
              <span className="main">
                <span className="t1"><b>{verb}</b>{who ? <> · {who}</> : null}</span>
                <SilenceLine text={x.on_silence} />
              </span>
              <span className="rt"><span className="amt">{amount}</span>{left ? <span className={`tl ${left.urgent ? 'now' : ''}`}>{left.text}</span> : <span className="id">{x.label}</span>}</span>
            </button>
          );
        })}
      </Group>
    </Section>
  );
}

// ---- title bar & footer bits ------------------------------------------------------------------

export function LockIndicator() {
  const w = useWorld();
  const open = useMutation('approval_open');
  const L = w.locked;
  return (
    <Btn sm className={`lockbtn ${L ? 'is-locked' : ''}`} onClick={() => { if (L) void open.run({ deal_id: null }); }} aria-disabled={!L}
      title={L ? 'Locked after 15 quiet minutes. You can still look around; approving money asks for Windows Hello. Click to unlock.'
        : 'Approvals lock after 15 quiet minutes, then ask for Windows Hello.'}>
      <LockGlyph locked={L} />{L ? 'Locked' : 'Unlocked'}
    </Btn>
  );
}

export function TumblerPill({ status }: { status: TumblerStatus | null }) {
  if (!status) return null;
  return (
    <span className={`hs-chip ${status.visible ? '' : 'dashed'}`} title="The small always-on-top window">
      Mini window · {status.visible ? 'shown' : 'hidden'}{status.count ? <> · <b>{status.count}</b> waiting</> : null}
    </span>
  );
}

function Clock() {
  const now = useNow();
  const d = new Date(now * 1000);
  return <span className="clk">{d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>;
}

