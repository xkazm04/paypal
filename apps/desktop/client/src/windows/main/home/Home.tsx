// The home (docs/design/abstract-first-home.md): the main window's default view. It starts abstract -
// one status line and the first need, composed locally from the standing answers, the away summary and
// the board model (greeting.ts) - and everything else is one click or one question away:
// - The side panel is the module navigator (Side.tsx): ONE list, a segmented switcher (All + the six
//   modules), a title filter, one line per row with the module's own columns (rows/).
// - A row click (or Enter) slides the conversation away and main becomes that item's page
//   (ItemStage.tsx): breadcrumb "Today > Module > title", facts, the story, actions, and the ask box
//   scoped to the item (the engine gets the deal label as a prefix). Esc or the crumb puts the
//   greeting and transcript back exactly as they were: they stay mounted, only hidden.
// - Reply ops (nav.ts routeReply): a reply stays IN the conversation. Its show panels render inline in
//   its turn; a reply about one deal offers "Open <title>"; filter / focus scope the side list and ring
//   a named deal's row. One Undo puts the list back. Main moves only on her click.
// - While the wallet is in setup, the guide (guide/) leads it in this conversation, one step per turn,
//   through GuideHost; the secure steps run in the approval context (secure/).
// - Motion: framer-motion for main (today <-> page, page <-> page by list order) and the side (fx.ts,
//   values from design/motion.ts).
// Numbers come from the world and the board model, never from reply text. Watch-only: approval_open,
// engine_select, pairing_* (PairingDesk), assistant_act via the board's Proposals consent path.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import type { Module } from '@bindings/Module';
import type { Fate, PanelSpec } from '../../../lib/assistant';
import { clockNow } from '../../../lib/clock';
import { useMutation } from '../../../lib/hooks';
import { BOARD_ACT, BOARD_CHANGED, BOARD_FATE, BOARD_PANEL_TITLE, type StartStepKey } from '../../../lib/words';
import { APP_BRAND_EVENT, APP_FIND_EVENT, APP_STATUS_EVENT, useAppHeaderEvent } from '../AppHeader';
import { Countdown, MockBadge } from '../../../shared/honesty';
import { Glyph, MODULE } from '../../../shared/modules';
import { Btn, layerCount } from '../../../shared/ui';
import { DUR, useCalm } from '../../../design/motion';
import { useAway } from './useAway';
import { readLastSeen, startOfToday, writeLastSeen } from './away';
import { useStart } from '../setup/start';
import { Answer, useOwnOpen, type PanelHost } from '../switchboard/Answer';
import { Amount } from '../switchboard/parts';
import { hasProposals, Proposals, type Acted, type Proposal } from '../switchboard/Proposals';
import { resolveAction, type BoardFacts, type Consent, type Run } from '../switchboard/resolve';
import { standingAnswers } from '../switchboard/standing';
import { useBoardAssistant } from '../switchboard/useBoardAssistant';
import { useBoardModel, type BoardKey } from '../switchboard/useBoardModel';
import { setHomeView } from '../switchboard/view';
import { ViewSwitch } from '../ViewSwitch';
import { useDeals, useLocked, useNeeds, useRuns, useSettings } from '../world';
import type { ModuleRow } from './rows/rows';
import { useModuleLists } from './rows/useModuleLists';
import { compose, partOfDay, type Chip, type PartOfDay } from './greeting';
import { TRAVEL, direction, tr } from './fx';
import { ItemStage } from './ItemStage';
import { findRow, openKey, openRow as rowPage, routeReply, rowOfDeal, sameNav, START_NAV, visibleRows, type Nav, type Open, type Scope } from './nav';
import { SetupOverview } from './SetupInline';
import { Side } from './Side';
import { offerSetup, type GuideHost, type GuideProps, type GuideTurn, type HomeRegion } from './guide/host';
import { GREET, STAGE } from './words';
import { FlowTurnView } from './flows/FlowTurnView';
import { matchFlow } from './flows/intent';
import { FLOW_KINDS, startFlow, useFlows } from './flows/store';
import { FLOW_WORDS } from './flows/words';
import '../switchboard/switchboard.css';
import './home.css';

/** `?away=1`: treat "last seen" as the start of today, so the away summary has something to say.
 *  Written before the conversation mounts, because useAway reads "last seen" once, on mount. */
export function Home() {
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

/** A reply's turn: what it said, the panels it showed (inline), the one deal it offers as a page. */
type ReplyEntry = { kind: 'reply'; say: string | null; changed: string | null; undone: boolean; cancelled: boolean; held: boolean; panels: readonly PanelSpec[]; link: Open | null };

type Entry = { id: number; about: string | null } & (
  | { kind: 'you'; text: string }
  | ReplyEntry
  | { kind: 'local'; text: string; lines?: readonly string[]; card?: ReactNode; panels?: readonly PanelSpec[] });

type NewEntry =
  | { kind: 'you'; text: string }
  | { kind: 'local'; text: string; lines?: readonly string[]; card?: ReactNode; panels?: readonly PanelSpec[] };

const emptyReply = (): ReplyEntry => ({ kind: 'reply', say: null, changed: null, undone: false, cancelled: false, held: false, panels: [], link: null });

// The setup guide loads only while the wallet is in setup: the everyday home never pulls its code.
// A guide that fails to load leaves the home as it is (the status line still says what is missing).
type GuideComponent = (p: GuideProps) => ReactNode;
const Guide = lazy(() => import('./guide/Guide').then((m): { default: GuideComponent } => ({ default: m.Guide }), (): { default: GuideComponent } => ({ default: () => null })));

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
  const calm = useCalm();

  // ---- getting started: sticky once the wallet was seen in setup; the guide leads it (guide/)
  const setupSeen = useRef(false);
  if (model.firstRun) setupSeen.current = true;
  const setup = setupSeen.current;
  // a set-up wallet that asks for a setup step again (a reply's proposal, a setup panel) gets the guide
  const [asked, setAsked] = useState(false);
  const guided = setup || asked;

  const away = useAway({ active: true, enabled: back && model.ready && !setup, needs: model.colCount.needs, deals: deals ?? [] });
  const standing = standingAnswers(model);
  const composed = compose({ model, standing, away: away.summary, setup, part });
  // the guide owns the setup story: the opening is the status line only
  const greeting = setup && composed.mode === 'setup' ? { ...composed, sub: null, chips: [] } : composed;

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
  // The app header's brand, status and Find (AppHeader.tsx): this view answers them.
  useAppHeaderEvent(APP_BRAND_EVENT, useCallback(() => move((n) => ({ ...n, open: null })), [move]));
  useAppHeaderEvent(APP_STATUS_EVENT, useCallback(() => move((n) => ({ ...n, scope: 'all', fate: 'needs', query: '', lit: null })), [move]));
  useAppHeaderEvent(APP_FIND_EVENT, useCallback(() => { document.querySelector<HTMLInputElement>('.fs-filter')?.focus(); }, []));

  // Once the lists have rows: the side opens on the module holding the first need (its list, its own
  // columns), or All when nothing needs her. Never again after that: her moves win.
  const picked = useRef(false);
  const firstNeedId = greeting.need?.id ?? null;
  useEffect(() => {
    if (picked.current || !model.ready || !Object.values(lists).some((l) => l.rows.length)) return;
    picked.current = true;
    const home = firstNeedId ? rowOfDeal(lists, firstNeedId)?.module ?? null : null;
    if (home && navRef.current.scope === 'all') commit({ ...navRef.current, scope: home });
  }, [model.ready, lists, commit, firstNeedId]);

  const openRow = useCallback((r: ModuleRow) => move((n) => ({ ...n, open: rowPage(r), lit: null })), [move]);
  const openPage = useCallback((o: Open) => move((n) => ({ ...n, open: o, lit: null })), [move]);
  const goBack = useCallback(() => move((n) => ({ ...n, open: null })), [move]);

  // ---- the conversation; every turn remembers the item that was open when it was asked
  const [entries, setEntries] = useState<Entry[]>([]);
  const flows = useFlows();
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

  // ---- a setup step asked for (a reply's proposal, a setup panel): the guide offers its current step
  // in the conversation; on a set-up wallet it is mounted for that (one setup path, guide/)
  const scroller = useRef<HTMLDivElement>(null);
  const jump = useCallback((_step: StartStepKey) => {
    if (navRef.current.open) commit({ ...navRef.current, open: null });
    if (!offerSetup()) setAsked(true);
  }, [commit]);

  // ---- coming back: after an act or the approval window, main returns to the
  // conversation with a line saying what happened - unless she went somewhere else meanwhile.
  /** `since`: what main showed and how many of her moves had happened when the thing started. */
  const returnToToday = useCallback((text: string, since: { key: string | null; moves: number } | null) => {
    push({ kind: 'local', text });
    const n = navRef.current;
    if (!n.open) return;
    if (since && (since.moves !== ownerMoves.current || since.key !== openKey(n.open))) return;
    commit({ ...n, open: null });
    setUndoTo(null);
  }, [push, commit]);

  // The approval window: no close event reaches this window, so "back" is this window regaining
  // focus after it lost it to the approval window. The deal's fate is read again then.
  const modelRef = useRef(model);
  modelRef.current = model;
  const awaiting = useRef<{ deal_id: string | null; key: string | null; moves: number; left: boolean } | null>(null);
  useEffect(() => {
    const onBlur = () => { if (awaiting.current) awaiting.current.left = true; };
    let t: ReturnType<typeof setTimeout> | undefined;
    const onFocus = () => {
      const a = awaiting.current;
      if (!a || !a.left) return;
      awaiting.current = null;
      // the world's change event may land a moment after focus: read the deal's fate a beat later
      clearTimeout(t);
      t = setTimeout(() => {
        const k = a.deal_id ? modelRef.current.byId.get(a.deal_id) : undefined;
        const text = !k ? GREET.backFromApproval : k.fate === 'needs' ? GREET.backStillWaiting(k.title) : GREET.backMoved(k.title, k.state_word);
        returnToToday(text, { key: a.key, moves: a.moves });
      }, DUR.slow);
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus); clearTimeout(t); };
  }, [returnToToday]);

  // ---- the hand-off: setup steps stay in the conversation; a decision goes to the approval window;
  // everything else is a door into the console
  const run = useCallback((r: Run) => {
    if (isSetupTarget(r)) { jump(r.target === 'credentials' ? 'paypal' : 'rules'); return; }
    if (r.kind === 'approval') {
      awaiting.current = { deal_id: r.deal_id, key: openKey(navRef.current.open), moves: ownerMoves.current, left: false };
      void open.run({ deal_id: r.deal_id, target: r.target });
      return;
    }
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
    const since = { key: openKey(navRef.current.open), moves: ownerMoves.current };
    try {
      const out = await doAct.run({ act: now.run.wire, consent: { words: now.consent.words, fingerprint: now.consent.fingerprint } });
      if (out === null) {
        setActed({ proposal: p, run: now.run, fingerprint: now.consent.fingerprint, reverse: now.consent.reverse, phase: 'done' });
        returnToToday(GREET.actDone(now.consent.title), since);
      }
    } finally { inflight.current = false; }
  }, [model.byId, doAct, returnToToday]);
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
    // A request to change limits, settings or connections, or to replay days, starts a step-by-step flow
    // (flows/): a card per question in this conversation, never the full page pasted into a reply.
    const flow = matchFlow(q);
    if (flow) { startFlow(flow, 'start'); return; }
    const id = ++nextId.current;
    setEntries((t) => [...t, { id, about: aboutRef.current, ...emptyReply() }]);
    const out = await assistant.ask(scopeLabel ? `${scopeLabel}: ${q}` : q, model.digest);
    if (out.kind === 'cancelled') { patch(id, (e) => (e.kind === 'reply' ? { ...e, cancelled: true } : e)); return; }
    // The routing rule (nav.ts routeReply): the answer stays in this turn, with its panels inline and
    // at most an "Open <title>" link; only the side list may move. She moved while it answered: her
    // move wins and the list is left alone (the panels still show: they are part of the answer).
    const r0 = routeReply(navRef.current, out.reply.ops, lists);
    // in setup the guide owns the steps: no setup panels or setup proposals from replies
    const routed = setup ? { ...r0, panels: r0.panels.filter((p) => p.kind !== 'setup') } : r0;
    const moved = ownerMoves.current !== movesAtAsk;
    const changed = moved ? null : moveFor(routed.nav, id);
    const props: Proposal[] = [];
    for (const op of out.reply.ops) if (op.op === 'propose' && !setup) props.push({ id: props.length, action: op.action, why: op.why });
    setProposals(props); setStale(new Set()); setActed(null);
    patch(id, (e) => (e.kind === 'reply' ? {
      ...e, say: out.reply.say, changed, panels: routed.panels, link: routed.link,
      held: moved && out.reply.ops.some((o) => o.op === 'filter' || o.op === 'focus'),
    } : e));
    // the answer can be taller than the view: bring her question to the top, the answer under it
    if (routed.panels.length) requestAnimationFrame(() => (navRef.current.open ? stageScroller.current : scroller.current)?.querySelector(`[data-entry="${id - 1}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }, [assistant, model.digest, moveFor, lists, push, patch, scopeLabel]);
  const askRef = useRef(ask);
  askRef.current = ask;

  /** A local answer that may also move the navigation, as one undoable step. */
  const localAnswer = useCallback((question: string, text: string, to: ((n: Nav) => Nav) | null, lines?: readonly string[], panels: readonly PanelSpec[] = []) => {
    push({ kind: 'you', text: question });
    const id = ++nextId.current;
    const changed = to ? moveFor(to(navRef.current), id) : null;
    setEntries((t) => [...t, lines ? { id, about: null, kind: 'local', text, lines } : { id, about: null, ...emptyReply(), say: text, changed, panels }]);
  }, [push, moveFor]);

  const onChip = (c: Chip) => {
    if (c.kind === 'ask') { void ask(c.label); return; }
    if (c.kind === 'away') {
      const s = away.summary;
      localAnswer(c.label, s ? GREET.away(s.sinceWords) : GREET.awayAnswerQuiet, null, s ? (s.lines.length ? s.lines.map((l) => l.text) : [s.lead ?? GREET.awayAnswerQuiet]) : []);
      return;
    }
    if (c.kind === 'everything') { localAnswer(c.label, CHANGE.everything, (n) => ({ ...n, scope: 'all', fate: null, query: '', lit: null })); return; }
    localAnswer(c.label, GREET.steps, null, undefined, [{ kind: 'setup' }]);
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

  // ---- GuideHost (guide/host.ts): the setup guide drives the home only through this. Stable for the
  // page's life (the guide may keep it in an effect); every call reads the latest state through refs.
  const live = useRef({ ask, lists, move, push });
  live.current = { ask, lists, move, push };
  const guideHost = useMemo<GuideHost>(() => ({
    region: (r: HomeRegion) => document.querySelector<HTMLElement>(`[data-front="stage"] [data-region="${r}"]`),
    ask: (q: string) => { void live.current.ask(q); },
    pick: (m: Module | 'all', rowId: string | null) => {
      const { lists: l, move: mv } = live.current;
      const rows = visibleRows(l, { scope: m, query: '', fate: null });
      const r = rowId === null ? null : rows.find((x) => x.id === rowId) ?? null;
      mv((n) => ({ ...n, scope: m, fate: null, query: '', lit: null, open: r ? rowPage(r) : n.open }));
    },
    back: () => live.current.move((n) => ({ ...n, open: null })),
    say: (turn: GuideTurn) => {
      live.current.push({ kind: 'local', text: turn.text, card: turn.card });
      live.current.move((n) => ({ ...n, open: null }));
    },
  }), []);

  // Keep the latest turn in view (the conversation's, or the item's own thread).
  const stageScroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = navRef.current.open ? stageScroller.current : scroller.current;
    if (el && entries.length) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [entries.length, flows.turns.length]);
  const stageKey = nav.open ? `${openKey(nav.open)}${nav.open.kind === 'panel' ? JSON.stringify(nav.open.spec) : ''}` : 'today';

  // Direction of the main move: today -> a page goes forward, a page -> today back, page -> page by
  // the pages' order in the side list (a page not in the list counts as forward).
  const orderOf = (o: Open | null): number => {
    if (!o) return -1;
    if (o.kind !== 'row') return Number.MAX_SAFE_INTEGER;
    return visibleRows(lists, nav).findIndex((r) => r.module === o.module && r.id === o.id);
  };
  const lastStage = useRef<{ key: string; open: Open | null; dir: -1 | 1 }>({ key: 'today', open: null, dir: 1 });
  if (lastStage.current.key !== stageKey) {
    const was = lastStage.current.open;
    const d: -1 | 1 = !nav.open ? -1 : !was ? 1 : (direction(orderOf(was), orderOf(nav.open)) || 1) as -1 | 1;
    lastStage.current = { key: stageKey, open: nav.open, dir: d };
  }
  const dir = lastStage.current.dir;
  const pageMotion = {
    enter: (d: number) => ({ opacity: 0, x: TRAVEL.main * d }),
    center: { opacity: 1, x: 0 },
    leave: (d: number) => ({ opacity: 0, x: -TRAVEL.main * d }),
  };

  const [typed, setTyped] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); const q = typed; setTyped(''); void ask(q); };

  const showProps = hasProposals({ proposals, acted });
  const busy = assistant.busy;
  const staged = nav.open !== null;
  const selected = nav.open?.kind === 'row' ? openKey(nav.open) : null;

  const linkTitle = (o: Open | null): string | null => (o?.kind === 'row' ? findRow(lists, o)?.title ?? null : null);
  const inline = (panels: readonly PanelSpec[] | undefined): ReactNode => (panels?.length ? (
    <div className="fs-inlines">
      {panels.map((p, i) => (
        <section key={i} className="fs-inline" data-inline={p.kind} aria-label={panelTitle(p)}>
          <h3 className="fs-kick">{panelTitle(p)}</h3>
          {p.kind === 'setup' ? <SetupOverview gs={gs} onJump={jump} /> : <Answer panel={p} host={host} primary={false} />}
        </section>
      ))}
    </div>
  ) : null);

  const renderEntry = (e: Entry, tag: boolean): ReactNode => (
    <motion.li key={e.id} className={`fs-turn ${e.kind === 'you' ? 'is-you' : 'is-me'}`} data-entry={e.id}
      initial={{ opacity: 0, y: TRAVEL.tick }} animate={{ opacity: 1, y: 0 }} transition={tr('med', calm)}>
      {e.kind === 'you' ? (
        <p className="fs-you">{tag && e.about ? <span className="fs-about">{STAGE.about(titleOf(e.about) ?? '')}</span> : null}{e.text}</p>
      ) : null}
      {e.kind === 'local' ? (
        <div className="fs-say">
          <p>{e.text}</p>
          {e.lines?.length ? <ul className="fs-lines">{e.lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
          {e.card ? <div className="fs-simcard">{e.card}</div> : null}
          {inline(e.panels)}
        </div>
      ) : null}
      {e.kind === 'reply' ? (
        <Reply e={e} canUndo={undoTo?.entry === e.id} onUndo={undoNav} panels={inline(e.panels)}
          link={e.link && openKey(e.link) !== openKey(nav.open) ? { title: linkTitle(e.link) ?? '', go: () => openPage(e.link as Open) } : null} />
      ) : null}
    </motion.li>
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

  const page: ReactNode = !nav.open ? null : (
    <ItemStage open={nav.open} row={openRowNow} list={openRowNow ? lists[openRowNow.module] : null} host={host} gs={gs} onJump={jump} onBack={goBack}
      below={scoped.length || propsCard ? (
        <section className="fs-isec fs-ithread" aria-label={STAGE.aboutThis}>
          {scoped.length ? <h2 className="fs-kick">{STAGE.aboutThis}</h2> : null}
          {scoped.length ? <ol className="fs-transcript">{scoped.map((e) => renderEntry(e, false))}</ol> : null}
          {propsCard}
        </section>
      ) : null} />
  );

  return (
    <MotionConfig reducedMotion={calm ? 'always' : 'user'} transition={tr('med', calm)}>
    <div className="fs-app ui-ground" data-front="stage" data-ready={model.ready ? 'true' : 'false'} data-staged={staged ? 'true' : 'false'} data-guided={guided ? 'true' : undefined}>
      <header className="ui-toolbar fs-bar">
        <MockBadge />
        <span className="ui-spacer" />
        <ViewSwitch view="board" />
      </header>
      <main className="fs-stage" aria-label={GREET.mainLabel}>
        <section className={`fs-talk${staged ? ' is-staged' : ''}`}>
          <div className="fs-views" data-region="stage">
            {/* The conversation stays mounted under the stage: back is exactly where she left it. */}
            <motion.div className="fs-scroll fs-today" ref={scroller} aria-hidden={staged} inert={staged}
              initial={false}
              animate={staged ? { opacity: 0, x: -TRAVEL.main, transitionEnd: { visibility: 'hidden' } } : { opacity: 1, x: 0, visibility: 'visible' }}
              transition={tr('med', calm)}>
              <ol className="fs-transcript" aria-live="polite" data-region="transcript">
                <li className="fs-turn is-me" data-entry="greeting">
                  <Opening g={greeting} gsDone={gs.done} gsTotal={gs.total} host={host}
                    onDetails={firstNeedRow ? () => openRow(firstNeedRow) : null}
                    onAllNeeds={() => move((n) => ({ ...n, scope: 'all', fate: 'needs', query: '', lit: null }))} />
                  {greeting.chips.length ? (
                    <div className="fs-chips" role="group" aria-label={GREET.suggested} data-region="chips">
                      {greeting.chips.map((c) => <button key={c.label} type="button" className="fs-chip" disabled={busy} onClick={() => onChip(c)}>{c.label}</button>)}
                    </div>
                  ) : null}
                  {greeting.mode === 'everyday' ? (
                    <div className="fs-flowchips" role="group" aria-label={FLOW_WORDS.chipsLabel} data-region="flow-chips">
                    {FLOW_KINDS.map((k) => <button key={k} type="button" className="fs-chip" disabled={busy} onClick={() => { startFlow(k, 'start'); }}>{FLOW_WORDS.chip[k]}</button>)}
                  </div>
                  ) : null}
                </li>
                {entries.map((e) => renderEntry(e, true))}
                {flows.turns.map((t) => <li key={`flow-${t.serial}`} className="fs-turn is-me" data-entry={`flow-${t.serial}`}><FlowTurnView turn={t} /></li>)}
                {!staged && propsCard ? <li className="fs-turn is-me">{propsCard}</li> : null}
              </ol>
            </motion.div>
            <AnimatePresence initial={false} custom={dir}>
              {nav.open ? (
                <motion.div className="fs-scroll fs-onstage" ref={stageScroller} key={stageKey} custom={dir}
                  variants={pageMotion} initial="enter" animate="center" exit="leave" transition={tr('med', calm)}>
                  {page}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
          <div className="fs-askwrap" data-region="ask">
            <form className="fs-ask" onSubmit={submit} aria-label={GREET.askLabel}>
              <input ref={input} className="ui-field fs-input" type="text" value={typed} onChange={(e) => setTyped(e.target.value)}
                placeholder={openRowNow ? STAGE.askAbout(openRowNow.title) : GREET.askPlaceholder}
                aria-label={openRowNow ? STAGE.askAbout(openRowNow.title) : GREET.askLabel} maxLength={300} autoComplete="off" />
              {busy ? <Btn onClick={assistant.cancel}>{GREET.stop}</Btn> : <Btn kind={setup ? 'default' : 'primary'} type="submit" disabled={!typed.trim()}>{GREET.send}</Btn>}
            </form>
          </div>
        </section>
        <Side lists={lists} nav={nav} model={model} selected={selected} calm={calm}
          onScope={(sc: Scope) => move((n) => ({ ...n, scope: sc, fate: null, lit: null }))}
          onQuery={(q) => move((n) => ({ ...n, query: q }))}
          onClearFate={() => move((n) => ({ ...n, fate: null }))}
          onOpen={openRow} />
      </main>
      {guided ? <Suspense fallback={null}><Guide host={guideHost} asked={asked} /></Suspense> : null}
    </div>
    </MotionConfig>
  );
}

function Opening({ g, gsDone, gsTotal, host, onAllNeeds, onDetails }: {
  g: ReturnType<typeof compose>; gsDone: number; gsTotal: number; host: PanelHost; onAllNeeds: () => void; onDetails: (() => void) | null;
}) {
  const [more, setMore] = useState(false);
  return (
    <div className={`fs-say fs-open t-${g.tone}`}>
      <p className="fs-status" data-region="status">{g.status}</p>
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
  const own = useOwnOpen(host);
  return (
    <div className="fs-need" style={{ '--mc': meta.cssVar } as React.CSSProperties} data-need={k.id} data-region="need">
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
          ? <Btn kind="gold" locked={host.locked} disabled={host.pending} onClick={() => own.run({ kind: 'approval', deal_id: k.id, target: null })}>{GREET.review}</Btn>
          : null}
        {onDetails ? <Btn kind={k.review ? 'plain' : 'default'} onClick={onDetails}>{STAGE.details}</Btn> : null}
        {n > 1 ? <Btn kind="plain" onClick={onAll}>{GREET.allNeeds(n)}</Btn> : null}
      </div>
      {own.notice}
    </div>
  );
}

function Reply({ e, canUndo, onUndo, panels, link }: {
  e: Extract<Entry, { kind: 'reply' }>; canUndo: boolean; onUndo: () => void; panels: ReactNode; link: { title: string; go: () => void } | null;
}) {
  if (e.cancelled) return <p className="fs-say is-quiet">{GREET.stopped}</p>;
  if (e.say === null) return <p className="fs-say is-quiet fs-thinking">{GREET.thinking}</p>;
  return (
    <div className="fs-say">
      <p>{e.say || GREET.nothingSaid}</p>
      {panels}
      {link && link.title ? (
        <p className="fs-golink"><button type="button" className="linkbtn" onClick={link.go} data-open-link>{STAGE.openLink(link.title)} <span aria-hidden="true">›</span></button></p>
      ) : null}
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
