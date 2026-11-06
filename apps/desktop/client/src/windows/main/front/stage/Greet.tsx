// spark abstract-first-home round 2, fork STAGE (?home=stage): the main column becomes the item's page.
// Baseline = round-1 GREET (the conversation greets; the opening message is composed locally from the
// standing answers, the away summary and the first need). What STAGE changes:
// - The side panel is the module navigator (Side.tsx): ONE list, a segmented switcher (All + the six
//   modules), a title filter, one line per row with the module's own columns (front/rows contract).
// - A row click (or Enter) slides the conversation away and main becomes that item's STAGE
//   (ItemStage.tsx): breadcrumb "Today > Module > title", facts, the story, actions, and the ask box
//   scoped to the item (the engine gets the deal label as a prefix). Esc or the crumb puts the
//   greeting and transcript back exactly as they were: they stay mounted, only hidden.
// - Reply ops (nav.ts): filter / focus scope the list and ring a named deal's row; show of a deal opens
//   its stage, any other show opens the panel as the stage. One Undo puts the navigation back.
// Numbers come from the world and the board model, never from reply text. Watch-only: approval_open,
// engine_select, pairing_* (PairingDesk), assistant_act via the board's Proposals consent path.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import type { Fate, PanelSpec } from '../../../../lib/assistant';
import { clockNow } from '../../../../lib/clock';
import { useMutation } from '../../../../lib/hooks';
import { BOARD_ACT, BOARD_CHANGED, BOARD_FATE, BOARD_PANEL_TITLE, BRAND_NAME, type StartStepKey } from '../../../../lib/words';
import { Mark } from '../../../../shared/brand';
import { Countdown, MockBadge } from '../../../../shared/honesty';
import { Glyph, MODULE } from '../../../../shared/modules';
import { Btn, layerCount } from '../../../../shared/ui';
import { useAway } from '../../home/useAway';
import { readLastSeen, startOfToday, writeLastSeen } from '../../home/away';
import { useStart } from '../../setup/start';
import type { PanelHost } from '../../switchboard/Answer';
import { Amount } from '../../switchboard/parts';
import { hasProposals, Proposals, type Acted, type Proposal } from '../../switchboard/Proposals';
import { resolveAction, type BoardFacts, type Consent, type Run } from '../../switchboard/resolve';
import { engineWords } from '../../switchboard/Says';
import { standingAnswers } from '../../switchboard/standing';
import { useBoardAssistant } from '../../switchboard/useBoardAssistant';
import { useBoardModel, type BoardKey } from '../../switchboard/useBoardModel';
import { setHomeView } from '../../switchboard/view';
import { useDeals, useLocked, useNeeds, useRuns, useSettings } from '../../world';
import type { ModuleRow } from '../rows/rows';
import { useModuleLists } from '../rows/useModuleLists';
import { compose, partOfDay, type Chip, type PartOfDay } from './greeting';
import { ItemStage } from './ItemStage';
import { applyOps, findRow, openKey, pickFromSearch, rowOfDeal, sameNav, START_NAV, type Nav, type Scope } from './nav';
import { SetupCard } from './SetupInline';
import { Side } from './Side';
import { GREET, STAGE, STEP_SAY } from './words';
import '../../switchboard/switchboard.css';
import './stage.css';

/** `?away=1`: treat "last seen" as the start of today, so the away summary has something to say.
 *  Written before the conversation mounts, because useAway reads "last seen" once, on mount. */
export function StageFront() {
  const [back] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search).get('away') === '1') { writeLastSeen(startOfToday(clockNow())); return true; }
    } catch { /* no address: fall through */ }
    return readLastSeen(clockNow()).stored;
  });
  return <Greet back={back} />;
}

/** The part of the day on the wallet's clock, re-read every minute (re-renders only when it changes). */
function usePartOfDay(): PartOfDay {
  const [part, setPart] = useState<PartOfDay>(() => partOfDay(clockNow() * 1000));
  useEffect(() => {
    const t = setInterval(() => setPart(partOfDay(clockNow() * 1000)), 60_000);
    return () => clearInterval(t);
  }, []);
  return part;
}

type Entry = { id: number; about: string | null } & (
  | { kind: 'you'; text: string }
  | { kind: 'reply'; say: string | null; changed: string | null; undone: boolean; cancelled: boolean; held: boolean }
  | { kind: 'local'; text: string; lines?: readonly string[] }
  | { kind: 'setup'; step: StartStepKey });

type NewEntry =
  | { kind: 'you'; text: string }
  | { kind: 'local'; text: string; lines?: readonly string[] };

const isSetupTarget = (t: Run): t is { kind: 'approval'; deal_id: null; target: 'credentials' | 'mandate' } =>
  t.kind === 'approval' && t.deal_id === null && (t.target === 'credentials' || t.target === 'mandate');

/** How a reply (or a local answer) moved the navigation, in words. */
const CHANGE = {
  opened: (title: string): string => `Opened ${title}`,
  listed: (where: string, fate: Fate | null): string => `Listing ${where}${fate ? `, ${BOARD_FATE[fate].short.toLowerCase()} only` : ''}`,
  pointed: (title: string): string => `Pointed at ${title}`,
  everything: 'Every item is in the list on the right, needs first. Pick one and it opens here.',
} as const;

const panelTitle = (p: PanelSpec): string => BOARD_PANEL_TITLE[p.kind];

function Greet({ back }: { back: boolean }) {
  const model = useBoardModel();
  const lists = useModuleLists();
  const gs = useStart();
  const settings = useSettings().data;
  const locked = useLocked();
  const runs = useRuns().data;
  const needs = useNeeds();
  const deals = useDeals().data;
  const open = useMutation('approval_open');
  const doAct = useMutation('assistant_act');
  const undoAct = useMutation('assistant_act');
  const assistant = useBoardAssistant();
  const part = usePartOfDay();

  // ---- getting started: sticky once the wallet was seen brand-new, until every step is done
  const setupSeen = useRef(false);
  if (model.firstRun) setupSeen.current = true;
  const setup = setupSeen.current;

  const away = useAway({ active: true, enabled: back && model.ready && !setup, needs: model.colCount.needs, deals: deals ?? [] });
  const standing = standingAnswers(model);
  const greeting = compose({ model, standing, away: away.summary, setup, part });

  // ---- the navigation (side list + what main shows); the ref is what the next reply is applied to
  const [nav, setNavState] = useState<Nav>(START_NAV);
  const navRef = useRef(nav);
  const commit = useCallback((n: Nav) => { navRef.current = n; setNavState(n); }, []);
  const [undoTo, setUndoTo] = useState<{ before: Nav; entry: number } | null>(null);
  const ownerMoves = useRef(0);
  /** An owner's own move: counts against a reply in flight (her move wins) and drops the Undo. */
  const move = useCallback((f: (n: Nav) => Nav) => {
    const next = f(navRef.current);
    if (sameNav(next, navRef.current)) return;
    ownerMoves.current += 1;
    commit(next);
    setUndoTo(null);
  }, [commit]);

  // Once the lists have rows: the side opens on the module holding the first need (its list, its own
  // columns), or All when nothing needs her. Prototype-only `?fs_pick=<module|all>:<rowId|index>`
  // opens a row instead (screenshots, tests). Never again after that: her moves win.
  const picked = useRef(false);
  const firstNeedId = greeting.need?.id ?? null;
  useEffect(() => {
    if (picked.current || !model.ready || !Object.values(lists).some((l) => l.rows.length)) return;
    picked.current = true;
    const n = pickFromSearch(window.location.search, lists);
    if (n) { commit(n); return; }
    const home = firstNeedId ? rowOfDeal(lists, firstNeedId)?.module ?? null : null;
    if (home && navRef.current.scope === 'all') commit({ ...navRef.current, scope: home });
  }, [model.ready, lists, commit, firstNeedId]);

  const openRow = useCallback((r: ModuleRow) => move((n) => ({ ...n, open: { kind: 'row', module: r.module, id: r.id }, lit: null })), [move]);
  const goBack = useCallback(() => move((n) => ({ ...n, open: null })), [move]);

  // ---- the conversation; every turn remembers the item that was open when it was asked
  const [entries, setEntries] = useState<Entry[]>([]);
  const nextId = useRef(0);
  const aboutRef = useRef<string | null>(null);
  aboutRef.current = nav.open?.kind === 'row' ? openKey(nav.open) : null;
  const push = useCallback((...es: NewEntry[]) => {
    setEntries((t) => [...t, ...es.map((e): Entry => ({ ...e, id: ++nextId.current, about: aboutRef.current }))].slice(-40));
  }, []);
  const patch = useCallback((id: number, f: (e: Entry) => Entry) => setEntries((t) => t.map((e) => (e.id === id ? f(e) : e))), []);

  const titleOf = useCallback((key: string | null): string | null => {
    if (!key) return null;
    const i = key.indexOf(':');
    return lists[key.slice(0, i) as Module]?.rows.find((r) => r.id === key.slice(i + 1))?.title ?? null;
  }, [lists]);

  const changeWords = useCallback((before: Nav, after: Nav): string | null => {
    const parts: string[] = [];
    if (after.open && openKey(after.open) !== openKey(before.open)) {
      parts.push(CHANGE.opened(after.open.kind === 'panel' ? panelTitle(after.open.spec) : findRow(lists, after.open)?.title ?? ''));
    }
    if (after.scope !== before.scope || after.fate !== before.fate) parts.push(CHANGE.listed(after.scope === 'all' ? STAGE.allTitle : MODULE[after.scope].name, after.fate));
    if (after.lit && after.lit !== before.lit) parts.push(CHANGE.pointed(titleOf(after.lit) ?? ''));
    return parts.length ? parts.join(' · ') : null;
  }, [lists, titleOf]);

  /** Move the navigation for an entry as one undo step; returns the change line. */
  const moveFor = useCallback((after: Nav, entry: number): string | null => {
    const before = navRef.current;
    if (sameNav(before, after)) { setUndoTo(null); return null; }
    commit(after);
    setUndoTo({ before, entry });
    return changeWords(before, after);
  }, [commit, changeWords]);

  const undoNav = useCallback(() => {
    if (!undoTo) return;
    ownerMoves.current += 1;
    commit(undoTo.before);
    setUndoTo(null);
    patch(undoTo.entry, (e) => (e.kind === 'reply' ? { ...e, undone: true } : e));
  }, [undoTo, commit, patch]);

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [acted, setActed] = useState<Acted | null>(null);
  const [stale, setStale] = useState<ReadonlySet<number>>(() => new Set());
  const [opened, setOpened] = useState<ReadonlySet<StartStepKey>>(() => new Set());

  // ---- the setup steps as the conversation goes (a step always shows in the conversation)
  const scroller = useRef<HTMLDivElement>(null);
  const jump = useCallback((step: StartStepKey) => {
    if (navRef.current.open) commit({ ...navRef.current, open: null });
    setEntries((t) => {
      const there = t.find((e) => e.kind === 'setup' && e.step === step);
      if (there) {
        requestAnimationFrame(() => scroller.current?.querySelector(`[data-entry="${there.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
        return t;
      }
      return [...t, { id: ++nextId.current, about: null, kind: 'setup', step }];
    });
  }, [commit]);
  const lastNext = useRef<StartStepKey | null | undefined>(undefined);
  useEffect(() => {
    if (!setup) return;
    const now = gs.next;
    const was = lastNext.current;
    if (was === now) return;
    if (was === undefined && now === null && gs.steps.every((s) => s.state === 'unknown')) return;
    lastNext.current = now;
    const title = (k: StartStepKey) => STEP_SAY[k];
    if (was) push({ kind: 'local', text: GREET.stepDone(title(was)) });
    if (now) {
      const n = gs.steps.find((s) => s.key === now)?.n ?? 1;
      push({ kind: 'local', text: GREET.stepNext(n, title(now)) });
      jump(now);
    } else if (was !== undefined) {
      push({ kind: 'local', text: GREET.allDone });
    }
  }, [setup, gs.next, gs.steps, push, jump]);

  // ---- the hand-off: setup steps stay in the conversation; a decision goes to the approval window;
  // everything else is a door into the console
  const run = useCallback((r: Run) => {
    if (isSetupTarget(r)) { jump(r.target === 'credentials' ? 'paypal' : 'rules'); return; }
    if (r.kind === 'approval') { void open.run({ deal_id: r.deal_id, target: r.target }); return; }
    window.location.hash = r.hash === '#' ? '' : r.hash;
    setHomeView('console');
  }, [open, jump]);

  // The board's panel renderers (on a panel stage) pick a deal or filter the board: here a pick opens
  // that deal's stage and a filter scopes the side list.
  const pick = useCallback((id: string) => { const r = rowOfDeal(lists, id); if (r) openRow(r); }, [lists, openRow]);
  const filterTo = useCallback((m: Module | null, f: Fate | null) => move((n) => ({ ...n, scope: m ?? 'all', fate: f, query: '', lit: null })), [move]);
  const host = useMemo<PanelHost>(() => ({ model, run, pending: open.pending, error: open.error, locked, pick, filterTo }), [model, run, open.pending, open.error, locked, pick, filterTo]);

  // ---- acts: the board's consent path, unchanged (re-resolve, compare with what was shown, run once)
  const facts = useMemo<BoardFacts>(() => ({
    agentsPaused: settings ? !!settings.agents_paused : null,
    agentsWorking: runs ? runs.filter((r) => r.state === 'running' || r.state === 'starting').length : null,
    pausedAgents: settings ? settings.paused_agents ?? null : null,
    lapsable: deals ? new Set(needs.filter((n) => n.kind === 'gate' && n.actions.includes('let_lapse') && deals.find((d) => d.id === n.deal_id)?.state !== 'MISMATCH').map((n) => n.deal_id)) : null,
  }), [settings, runs, needs, deals]);
  const factsRef = useRef(facts);
  factsRef.current = facts;
  const inflight = useRef(false);
  const perform = useCallback(async (p: Proposal, shown: Consent) => {
    if (inflight.current) return;
    const now = resolveAction(p.action, model.byId, factsRef.current);
    if (!now.armed || !now.act || now.consent.fingerprint !== shown.fingerprint) { setStale((s) => new Set(s).add(p.id)); return; }
    inflight.current = true;
    try {
      const out = await doAct.run({ act: now.run.wire, consent: { words: now.consent.words, fingerprint: now.consent.fingerprint } });
      if (out === null) setActed({ proposal: p, run: now.run, fingerprint: now.consent.fingerprint, reverse: now.consent.reverse, phase: 'done' });
    } finally { inflight.current = false; }
  }, [model.byId, doAct]);
  const undo = useCallback(async (a: Acted) => {
    if (inflight.current || a.phase !== 'done') return;
    inflight.current = true;
    try {
      const words = `${BOARD_ACT.undo}. ${a.run.undoTitle}`;
      const out = await undoAct.run({ act: a.run.undoWire, consent: { words, fingerprint: `undo|${a.fingerprint}`.slice(0, 160) } });
      if (out === null) setActed({ ...a, phase: 'undone' });
    } finally { inflight.current = false; }
  }, [undoAct]);

  // ---- asking, scoped to the open item: the engine reads the deal label first
  const openRowNow = findRow(lists, nav.open);
  const scopeLabel = openRowNow ? (openRowNow.deal_id ? model.byId.get(openRowNow.deal_id)?.label ?? openRowNow.title : openRowNow.title) : null;
  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q) return;
    const movesAtAsk = ownerMoves.current;
    push({ kind: 'you', text: q });
    const id = ++nextId.current;
    setEntries((t) => [...t, { id, about: aboutRef.current, kind: 'reply', say: null, changed: null, undone: false, cancelled: false, held: false }]);
    const out = await assistant.ask(scopeLabel ? `${scopeLabel}: ${q}` : q, model.digest);
    if (out.kind === 'cancelled') { patch(id, (e) => (e.kind === 'reply' ? { ...e, cancelled: true } : e)); return; }
    // She moved while it answered: her move wins; the reply's layout is not applied.
    const moved = ownerMoves.current !== movesAtAsk;
    const changed = moved ? null : moveFor(applyOps(navRef.current, out.reply.ops, lists), id);
    const props: Proposal[] = [];
    for (const op of out.reply.ops) if (op.op === 'propose') props.push({ id: props.length, action: op.action, why: op.why });
    setProposals(props); setStale(new Set()); setActed(null);
    patch(id, (e) => (e.kind === 'reply' ? { ...e, say: out.reply.say, changed, held: moved && out.reply.ops.some((o) => o.op !== 'propose') } : e));
  }, [assistant, model.digest, moveFor, lists, push, patch, scopeLabel]);

  /** A local answer that may also move the navigation, as one undoable step. */
  const localAnswer = useCallback((question: string, text: string, to: ((n: Nav) => Nav) | null, lines?: readonly string[]) => {
    push({ kind: 'you', text: question });
    const id = ++nextId.current;
    const changed = to ? moveFor(to(navRef.current), id) : null;
    setEntries((t) => [...t, lines ? { id, about: null, kind: 'local', text, lines } : { id, about: null, kind: 'reply', say: text, changed, undone: false, cancelled: false, held: false }]);
  }, [push, moveFor]);

  const onChip = (c: Chip) => {
    if (c.kind === 'ask') { void ask(c.label); return; }
    if (c.kind === 'away') {
      const s = away.summary;
      localAnswer(c.label, s ? GREET.away(s.sinceWords) : GREET.awayAnswerQuiet, null, s ? (s.lines.length ? s.lines.map((l) => l.text) : [s.lead ?? GREET.awayAnswerQuiet]) : []);
      return;
    }
    if (c.kind === 'everything') { localAnswer(c.label, CHANGE.everything, (n) => ({ ...n, scope: 'all', fate: null, query: '', lit: null })); return; }
    localAnswer(c.label, GREET.steps, (n) => ({ ...n, open: { kind: 'panel', spec: { kind: 'setup' } } }));
  };

  // ---- keys: `/` asks; Esc goes back (stage -> today, focus back on the row), then clears the side filters
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing || layerCount() > 0) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing) { e.preventDefault(); input.current?.focus(); return; }
      if (e.key !== 'Escape') return;
      if (typing) {
        // A field with text keeps it (a search field clears itself); an empty one lets go.
        if ((t as HTMLInputElement).value) return;
        t?.blur();
      }
      const n = navRef.current;
      if (n.open) {
        const was = openKey(n.open);
        move((x) => ({ ...x, open: null }));
        requestAnimationFrame(() => { if (was) document.querySelector<HTMLElement>(`[data-row="${CSS.escape(was)}"]`)?.focus({ preventScroll: true }); });
      } else if (n.lit || n.fate || n.query) move((x) => ({ ...x, lit: null, fate: null, query: '' }));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [move]);

  // Keep the latest turn in view (the conversation's, or the item's own thread).
  const stageScroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = navRef.current.open ? stageScroller.current : scroller.current;
    if (el && entries.length) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [entries.length]);
  const stageKey = nav.open ? `${openKey(nav.open)}${nav.open.kind === 'panel' ? JSON.stringify(nav.open.spec) : ''}` : 'today';

  const [typed, setTyped] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); const q = typed; setTyped(''); void ask(q); };

  const showProps = hasProposals({ proposals, acted });
  const busy = assistant.busy;
  const staged = nav.open !== null;
  const selected = nav.open?.kind === 'row' ? openKey(nav.open) : null;

  const renderEntry = (e: Entry, tag: boolean): ReactNode => (
    <li key={e.id} className={`fs-turn ${e.kind === 'you' ? 'is-you' : 'is-me'}`} data-entry={e.id}>
      {e.kind === 'you' ? (
        <p className="fs-you">{tag && e.about ? <span className="fs-about">{STAGE.about(titleOf(e.about) ?? '')}</span> : null}{e.text}</p>
      ) : null}
      {e.kind === 'local' ? (
        <div className="fs-say">
          <p>{e.text}</p>
          {e.lines?.length ? <ul className="fs-lines">{e.lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
        </div>
      ) : null}
      {e.kind === 'reply' ? <Reply e={e} canUndo={undoTo?.entry === e.id} onUndo={undoNav} /> : null}
      {e.kind === 'setup' ? (
        <SetupCard step={e.step} done={gs.steps.find((s) => s.key === e.step)?.state === 'done'}
          opened={opened.has(e.step)} onOpened={() => setOpened((o) => new Set(o).add(e.step))} />
      ) : null}
    </li>
  );

  const propsCard = showProps ? (
    <article className="fs-card is-suggest">
      <header className="fs-card-h"><b>{GREET.suggested}</b></header>
      <div className="fs-card-b">
        <Proposals proposals={proposals} acted={acted} byId={model.byId} facts={facts} stale={stale} locked={locked} opening={open.pending}
          act={{ pending: doAct.pending, error: doAct.error }} undoAct={{ pending: undoAct.pending, error: undoAct.error }}
          perform={(p, c) => void perform(p, c)} undo={(a) => void undo(a)} run={run} gold={false} />
      </div>
    </article>
  ) : null;

  const scoped = selected ? entries.filter((e) => e.about === selected) : [];
  const firstNeedRow = greeting.need ? rowOfDeal(lists, greeting.need.id) : null;

  return (
    <div className="fs-app ui-ground" data-front="stage" data-ready={model.ready ? 'true' : 'false'} data-staged={staged ? 'true' : 'false'}>
      <header className="ui-toolbar fs-bar">
        <span className="fs-brand"><Mark /><b>{BRAND_NAME}</b></span>
        <MockBadge />
        <span className="ui-spacer" />
        <Btn sm kind="plain" onClick={() => setHomeView('console')} title={GREET.toConsoleTitle}>{GREET.toConsole}</Btn>
      </header>
      <main className="fs-stage" aria-label={GREET.mainLabel}>
        <section className={`fs-talk${staged ? ' is-staged' : ''}`}>
          <div className="fs-views">
            {/* The conversation stays mounted under the stage: back is exactly where she left it. */}
            <div className="fs-scroll fs-today" ref={scroller} aria-hidden={staged} inert={staged}>
              <ol className="fs-transcript" aria-live="polite">
                <li className="fs-turn is-me" data-entry="greeting">
                  <Opening g={greeting} gsDone={gs.done} gsTotal={gs.total} host={host}
                    onDetails={firstNeedRow ? () => openRow(firstNeedRow) : null}
                    onAllNeeds={() => move((n) => ({ ...n, scope: 'all', fate: 'needs', query: '', lit: null }))} />
                  {greeting.chips.length ? (
                    <div className="fs-chips" role="group" aria-label={GREET.suggested}>
                      {greeting.chips.map((c) => <button key={c.label} type="button" className="fs-chip" disabled={busy} onClick={() => onChip(c)}>{c.label}</button>)}
                    </div>
                  ) : null}
                </li>
                {entries.map((e) => renderEntry(e, true))}
                {!staged && propsCard ? <li className="fs-turn is-me">{propsCard}</li> : null}
              </ol>
            </div>
            {nav.open ? (
              <div className="fs-scroll fs-onstage" ref={stageScroller} key={stageKey}>
                <ItemStage open={nav.open} row={openRowNow} list={openRowNow ? lists[openRowNow.module] : null} host={host} gs={gs} onJump={jump} onBack={goBack}
                  below={scoped.length || propsCard ? (
                    <section className="fs-isec fs-ithread" aria-label={STAGE.aboutThis}>
                      {scoped.length ? <h2 className="fs-kick">{STAGE.aboutThis}</h2> : null}
                      {scoped.length ? <ol className="fs-transcript">{scoped.map((e) => renderEntry(e, false))}</ol> : null}
                      {propsCard}
                    </section>
                  ) : null} />
              </div>
            ) : null}
          </div>
          <div className="fs-askwrap">
            <form className="fs-ask" onSubmit={submit} aria-label={GREET.askLabel}>
              <input ref={input} className="ui-field fs-input" type="text" value={typed} onChange={(e) => setTyped(e.target.value)}
                placeholder={openRowNow ? STAGE.askAbout(openRowNow.title) : GREET.askPlaceholder}
                aria-label={openRowNow ? STAGE.askAbout(openRowNow.title) : GREET.askLabel} maxLength={300} autoComplete="off" />
              {busy ? <Btn onClick={assistant.cancel}>{GREET.stop}</Btn> : <Btn kind={setup ? 'default' : 'primary'} type="submit" disabled={!typed.trim()}>{GREET.send}</Btn>}
            </form>
            <p className="fs-answers" data-engine={assistant.engine.id}>{GREET.engine(engineWords(assistant.engine))}</p>
          </div>
        </section>
        <Side lists={lists} nav={nav} model={model} selected={selected}
          onScope={(sc: Scope) => move((n) => ({ ...n, scope: sc, fate: null, lit: null }))}
          onQuery={(q) => move((n) => ({ ...n, query: q }))}
          onClearFate={() => move((n) => ({ ...n, fate: null }))}
          onOpen={openRow} />
      </main>
    </div>
  );
}

function Opening({ g, gsDone, gsTotal, host, onAllNeeds, onDetails }: {
  g: ReturnType<typeof compose>; gsDone: number; gsTotal: number; host: PanelHost; onAllNeeds: () => void; onDetails: (() => void) | null;
}) {
  const [more, setMore] = useState(false);
  return (
    <div className={`fs-say fs-open t-${g.tone}`}>
      <p className="fs-status">{g.status}</p>
      {g.sub ? <p className="fs-sub">{g.sub}{g.mode === 'setup' ? <> <span className="fs-prog">{GREET.progress(gsDone, gsTotal)}</span></> : null}</p> : null}
      {g.away ? (
        <div className="fs-away">
          <p className="fs-awayline">
            <span className="fs-kick">{GREET.away(g.away.since)}</span>{' '}
            <span>{g.away.lines[0]}</span>
            {g.away.more && !more ? <> <button type="button" className="linkbtn fs-more" onClick={() => setMore(true)}>{GREET.awayMore(g.away.more)}</button></> : null}
          </p>
          {more ? <ul className="fs-lines">{g.away.all.slice(1).map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
        </div>
      ) : null}
      {g.need ? <NeedCard k={g.need} n={g.needs} host={host} onAll={onAllNeeds} onDetails={onDetails} /> : null}
    </div>
  );
}

function NeedCard({ k, n, host, onAll, onDetails }: { k: BoardKey; n: number; host: PanelHost; onAll: () => void; onDetails: (() => void) | null }) {
  const meta = MODULE[k.module];
  return (
    <div className="fs-need" style={{ '--mc': meta.cssVar } as React.CSSProperties} data-need={k.id}>
      <div className="fs-need-h">
        <Glyph module={k.module} className="fs-need-g" />
        <b className="fs-need-t">{k.title}</b>
        <Amount k={k} />
      </div>
      <p className="fs-need-m">
        <span className="fs-need-k">{n > 1 ? GREET.soonest : GREET.theOne}</span>
        <span>{meta.name}</span>
        {k.deadline_s !== null ? <span><Countdown deadline={k.deadline_s} /></span> : null}
        {k.why ? <span>{k.why}</span> : null}
      </p>
      {k.on_silence ? <p className="fs-need-s"><b>{GREET.ifNothing}:</b> {k.on_silence}</p> : null}
      <div className="fs-acts">
        {k.review
          ? <Btn kind="gold" locked={host.locked} disabled={host.pending} onClick={() => host.run({ kind: 'approval', deal_id: k.id, target: null })}>{GREET.review}</Btn>
          : null}
        {onDetails ? <Btn kind={k.review ? 'plain' : 'default'} onClick={onDetails}>{STAGE.details}</Btn> : null}
        {n > 1 ? <Btn kind="plain" onClick={onAll}>{GREET.allNeeds(n)}</Btn> : null}
      </div>
    </div>
  );
}

function Reply({ e, canUndo, onUndo }: { e: Extract<Entry, { kind: 'reply' }>; canUndo: boolean; onUndo: () => void }) {
  if (e.cancelled) return <p className="fs-say is-quiet">{GREET.stopped}</p>;
  if (e.say === null) return <p className="fs-say is-quiet fs-thinking">{GREET.thinking}</p>;
  return (
    <div className="fs-say">
      <p>{e.say || GREET.nothingSaid}</p>
      {e.held ? <p className="fs-change">{BOARD_CHANGED.held}</p> : null}
      {e.changed && !e.held ? (
        <p className="fs-change">
          {e.undone ? BOARD_CHANGED.undone : e.changed}
          {canUndo && !e.undone ? <button type="button" className="linkbtn fs-undo" onClick={onUndo}>{GREET.undo}</button> : null}
        </p>
      ) : null}
    </div>
  );
}
