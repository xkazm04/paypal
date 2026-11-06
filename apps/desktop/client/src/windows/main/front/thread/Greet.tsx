// spark abstract-first-home round 2, fork THREAD of GREET: "browsing is part of the conversation".
// Centre: the conversation whose opening message is composed LOCALLY (greeting.ts: a status sentence,
// one away line, the first need, two suggested replies) and the ask box as the primary control.
// Side (Side.tsx): the module navigator - six collapsible sections, one row per item (front/rows).
// Clicking a row appends a TURN: "Looking at <title>" and a local (not model) reply with that item's
// facts (the module's own columns) and the board's own detail renderer (switchboard/Answer.tsx), so
// the main column is the history of what you looked at. The same row again scrolls to its turn
// instead of duplicating; Undo removes the last turn. While a row is selected the ask box follows up
// about it (the question reaches the engine prefixed with the deal's label).
// Reply ops: `show` lands as a card inside the reply's own turn, `focus` / `filter` open and select
// in the side panel (the deal row when one is named), `propose` is the board's Proposals inside the
// turn, its consent path unchanged. Numbers come from the world, never from reply text.
// Getting started happens AS the conversation (SetupInline.tsx), never a swap to the console.
// Watch-only: approval_open, engine_select, pairing_* (PairingDesk), assistant_act via Proposals.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Module } from '@bindings/Module';
import { MODULE_KEYS, type Fate, type PanelSpec, type UiOp, type ValidatedReply } from '../../../../lib/assistant';
import { clockNow } from '../../../../lib/clock';
import { useMutation } from '../../../../lib/hooks';
import { BOARD_ACT, BRAND_NAME, type StartStepKey } from '../../../../lib/words';
import { Mark } from '../../../../shared/brand';
import { Countdown, MockBadge } from '../../../../shared/honesty';
import { Glyph, MODULE } from '../../../../shared/modules';
import { Btn, layerCount } from '../../../../shared/ui';
import { formatHash } from '../../logic';
import { useAway } from '../../home/useAway';
import { readLastSeen, startOfToday, writeLastSeen } from '../../home/away';
import { useStart } from '../../setup/start';
import { Answer, type PanelHost } from '../../switchboard/Answer';
import { Amount } from '../../switchboard/parts';
import { hasProposals, Proposals, type Acted, type Proposal } from '../../switchboard/Proposals';
import { panelKey } from '../../switchboard/region';
import { resolveAction, type BoardFacts, type Consent, type Run } from '../../switchboard/resolve';
import { engineWords } from '../../switchboard/Says';
import { standingAnswers } from '../../switchboard/standing';
import { useBoardAssistant } from '../../switchboard/useBoardAssistant';
import { useBoardModel, type BoardKey } from '../../switchboard/useBoardModel';
import { setHomeView } from '../../switchboard/view';
import { useDeals, useLocked, useNeeds, useRuns, useSettings } from '../../world';
import type { ModuleList, ModuleRow } from '../rows/rows';
import { useModuleLists } from '../rows/useModuleLists';
import { useDayPart } from './dayPart';
import { compose, needsFirst, type Chip } from './greeting';
import { SetupCard, SetupOverview } from './SetupInline';
import { PEEK, Side, type Nav } from './Side';
import { GREET, STEP_SAY } from './words';
import '../../switchboard/switchboard.css';
import './thread.css';

/** `?away=1`: treat "last seen" as the start of today, so the away summary has something to say.
 *  Written before the conversation mounts, because useAway reads "last seen" once, on mount. */
export function ThreadFront() {
  // Away news only for a viewer coming back: one with a stored "last seen" (or `?away=1`).
  const [back] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search).get('away') === '1') { writeLastSeen(startOfToday(clockNow())); return true; }
    } catch { /* no address: fall through */ }
    return readLastSeen(clockNow()).stored;
  });
  return <Greet back={back} />;
}

/** `turn`: the owner's turn this entry belongs to (Undo removes the last one whole); null = said by
 *  the app on its own (setup progress), which Undo never removes. */
type Entry =
  | { id: number; turn: number | null; kind: 'you'; text: string; about: string | null }
  | { id: number; turn: number | null; kind: 'reply'; say: string | null; changed: string | null; cancelled: boolean; panels: PanelSpec[] }
  | { id: number; turn: number | null; kind: 'local'; text: string; lines?: readonly string[]; panels?: PanelSpec[] }
  | { id: number; turn: number | null; kind: 'setup'; step: StartStepKey }
  | { id: number; turn: number | null; kind: 'look'; module: Module; row: string; deal_id: string | null; title: string };

type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, 'id' | 'turn'> : never) : never;

const isSetupTarget = (t: Run): t is { kind: 'approval'; deal_id: null; target: 'credentials' | 'mandate' } =>
  t.kind === 'approval' && t.deal_id === null && (t.target === 'credentials' || t.target === 'mandate');

const EMPTY_NAV: Nav = { open: new Set(), more: new Set(), sel: null };
const add = <T,>(s: ReadonlySet<T>, v: T): ReadonlySet<T> => (s.has(v) ? s : new Set(s).add(v));

/** `?ft_pick=<module>:<rowId|index>` (prototype only): open that row once the lists are read. */
function readPick(): { module: Module; key: string } | null {
  try {
    const v = new URLSearchParams(window.location.search).get('ft_pick');
    if (!v) return null;
    const at = v.indexOf(':');
    const m = (at < 0 ? v : v.slice(0, at)) as Module;
    return (MODULE_KEYS as readonly string[]).includes(m) ? { module: m, key: at < 0 ? '0' : v.slice(at + 1) } : null;
  } catch { return null; }
}

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
  const part = useDayPart();

  // ---- getting started: sticky once the wallet was seen brand-new, until every step is done
  const setupSeen = useRef(false);
  if (model.firstRun) setupSeen.current = true;
  const setup = setupSeen.current;

  const away = useAway({ active: true, enabled: back && model.ready && !setup, needs: model.colCount.needs, deals: deals ?? [] });
  const standing = standingAnswers(model);
  const greeting = compose({ model, standing, away: away.summary, setup, part });

  // ---- the side navigator. Default open: the section holding the first need.
  const [nav, setNav] = useState<Nav>(EMPTY_NAV);
  const navRef = useRef(nav);
  navRef.current = nav;
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !model.ready) return;
    seeded.current = true;
    const first = needsFirst(model)[0]?.module ?? MODULE_KEYS.find((m) => lists[m].rows.length > 0) ?? null;
    if (first) setNav((n) => ({ ...n, open: add(n.open, first) }));
  }, [model, lists]);

  /** Open a module's section, expanded far enough to show the row, and select it. */
  const select = useCallback((m: Module, id: string | null) => {
    setNav((n) => {
      const idx = id === null ? -1 : lists[m].rows.findIndex((r) => r.id === id);
      return {
        open: add(n.open, m),
        more: idx >= PEEK ? add(n.more, m) : n.more,
        sel: id === null ? n.sel : { module: m, id },
      };
    });
  }, [lists]);

  // ---- the conversation
  const [entries, setEntries] = useState<Entry[]>([]);
  const nextId = useRef(0);
  const nextTurn = useRef(0);
  /** Nav as it was before each owner turn, so Undo puts the side panel back too. */
  const navBefore = useRef(new Map<number, Nav>());
  const push = useCallback((turn: number | null, ...es: NewEntry[]) => {
    setEntries((t) => [...t, ...es.map((e) => ({ ...e, id: ++nextId.current, turn }) as Entry)].slice(-60));
  }, []);
  const patch = useCallback((id: number, f: (e: Entry) => Entry) => setEntries((t) => t.map((e) => (e.id === id ? f(e) : e))), []);
  const beginTurn = useCallback((): number => {
    const turn = ++nextTurn.current;
    navBefore.current.set(turn, navRef.current);
    return turn;
  }, []);

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [propsEntry, setPropsEntry] = useState<number | null>(null);
  const [acted, setActed] = useState<Acted | null>(null);
  const [stale, setStale] = useState<ReadonlySet<number>>(() => new Set());
  const [opened, setOpened] = useState<ReadonlySet<StartStepKey>>(() => new Set());
  const [flash, setFlash] = useState<number | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const scrollTo = useCallback((id: number | 'greeting') => {
    requestAnimationFrame(() => scroller.current?.querySelector(`[data-entry="${id}"]`)?.scrollIntoView({ block: id === 'greeting' ? 'start' : 'nearest', behavior: 'smooth' }));
  }, []);

  // ---- the setup steps as the conversation goes
  const jump = useCallback((step: StartStepKey) => {
    setEntries((t) => {
      const there = t.find((e) => e.kind === 'setup' && e.step === step);
      if (there) { scrollTo(there.id); return t; }
      return [...t, { id: ++nextId.current, turn: null, kind: 'setup', step }];
    });
  }, [scrollTo]);
  const lastNext = useRef<StartStepKey | null | undefined>(undefined);
  useEffect(() => {
    if (!setup) return;
    const now = gs.next;
    const was = lastNext.current;
    if (was === now) return;
    if (was === undefined && now === null && gs.steps.every((s) => s.state === 'unknown')) return;
    lastNext.current = now;
    const title = (k: StartStepKey) => STEP_SAY[k];
    if (was) push(null, { kind: 'local', text: GREET.stepDone(title(was)) });
    if (now) {
      const n = gs.steps.find((s) => s.key === now)?.n ?? 1;
      push(null, { kind: 'local', text: GREET.stepNext(n, title(now)) });
      jump(now);
    } else if (was !== undefined) {
      push(null, { kind: 'local', text: GREET.allDone });
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

  // ---- looking at an item: a turn of its own, never twice
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const look = useCallback((r: Pick<ModuleRow, 'module' | 'id' | 'deal_id' | 'title'>) => {
    const there = entriesRef.current.find((e) => e.kind === 'look' && e.module === r.module && e.row === r.id);
    if (there) {
      select(r.module, r.id);
      scrollTo(there.id);
      setFlash(null);
      requestAnimationFrame(() => setFlash(there.id));
      return;
    }
    const turn = beginTurn();
    select(r.module, r.id);
    push(turn, { kind: 'look', module: r.module, row: r.id, deal_id: r.deal_id, title: r.title });
  }, [select, scrollTo, beginTurn, push]);

  /** A deal named by a panel (NeedsPanel row, DealPanel button): its row, or the deal itself. */
  const pick = useCallback((dealId: string) => {
    const k = model.byId.get(dealId);
    if (!k) return;
    const row = lists[k.module].rows.find((r) => r.deal_id === dealId);
    look(row ?? { module: k.module, id: dealId, deal_id: dealId, title: k.title });
  }, [model.byId, lists, look]);
  const filterTo = useCallback((m: Module | null) => { if (m) select(m, null); }, [select]);
  const host = useMemo<PanelHost>(() => ({ model, run, pending: open.pending, error: open.error, locked, pick, filterTo }), [model, run, open.pending, open.error, locked, pick, filterTo]);

  // `?ft_pick=`: drive a selected state headless.
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current || !model.ready) return;
    const want = readPick();
    if (!want) { picked.current = true; return; }
    const rows = lists[want.module].rows;
    if (!rows.length) return;
    const row = rows.find((r) => r.id === want.key) ?? rows[Number(want.key)] ?? null;
    picked.current = true;
    if (row) look(row);
  }, [model.ready, lists, look]);

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
  const undoActed = useCallback(async (a: Acted) => {
    if (inflight.current || a.phase !== 'done') return;
    inflight.current = true;
    try {
      const words = `${BOARD_ACT.undo}. ${a.run.undoTitle}`;
      const out = await undoAct.run({ act: a.run.undoWire, consent: { words, fingerprint: `undo|${a.fingerprint}`.slice(0, 160) } });
      if (out === null) setActed({ ...a, phase: 'undone' });
    } finally { inflight.current = false; }
  }, [undoAct]);

  // ---- reply ops: show lands in this turn; focus / filter open and select on the side
  const applyOps = useCallback((ops: readonly UiOp[]): { panels: PanelSpec[]; changed: string | null } => {
    const panels: PanelSpec[] = [];
    const openNames = new Set<Module>();
    let picked: string | null = null;
    const pickDeal = (id: string) => {
      const k = model.byId.get(id);
      if (!k) return;
      const row = lists[k.module].rows.find((r) => r.deal_id === id);
      select(k.module, row?.id ?? null);
      openNames.add(k.module);
      if (row) picked = row.title;
    };
    const openFate = (f: Fate) => {
      for (const m of MODULE_KEYS) if (lists[m].rows.some((r) => r.fate === f)) { select(m, null); openNames.add(m); }
    };
    for (const op of ops) {
      if (op.op === 'show') {
        if (!panels.some((p) => panelKey(p) === panelKey(op.panel))) panels.push(op.panel);
        if (op.panel.kind === 'decision' || op.panel.kind === 'deal') pickDeal(op.panel.deal_id);
        else if ((op.panel.kind === 'needs' || op.panel.kind === 'book' || op.panel.kind === 'rules') && op.panel.module) { select(op.panel.module, null); openNames.add(op.panel.module); }
      } else if (op.op === 'focus') {
        if (op.deal_id) pickDeal(op.deal_id);
        else if (op.module) { select(op.module, null); openNames.add(op.module); }
        else if (op.fate) openFate(op.fate);
      } else if (op.op === 'filter') {
        if (op.module) { select(op.module, null); openNames.add(op.module); }
        else if (op.fate) openFate(op.fate);
      }
    }
    const changed = picked ? GREET.navPicked(picked)
      : openNames.size ? GREET.navOpened([...openNames].map((m) => MODULE[m].name).join(', ')) : null;
    return { panels, changed };
  }, [model.byId, lists, select]);

  const takeProposals = useCallback((reply: ValidatedReply, entry: number) => {
    const props: Proposal[] = [];
    for (const op of reply.ops) if (op.op === 'propose') props.push({ id: props.length, action: op.action, why: op.why });
    setProposals(props);
    setPropsEntry(props.length ? entry : null);
    setStale(new Set());
    setActed(null);
  }, []);

  // ---- asking: while a row is selected, the question is about it
  const about = useMemo(() => {
    if (!nav.sel) return null;
    const row = lists[nav.sel.module].rows.find((r) => r.id === nav.sel!.id);
    const title = row?.title ?? (model.byId.get(nav.sel.id)?.title ?? null);
    if (!title) return null;
    const dealId = row ? row.deal_id : nav.sel.id;
    const label = (dealId ? model.byId.get(dealId)?.label : null) ?? title;
    return { title, label };
  }, [nav.sel, lists, model.byId]);

  const ask = useCallback(async (question: string, context: { title: string; label: string } | null) => {
    const q = question.trim();
    if (!q) return;
    const turn = beginTurn();
    push(turn, { kind: 'you', text: q, about: context?.title ?? null });
    const id = ++nextId.current;
    setEntries((t) => [...t, { id, turn, kind: 'reply', say: null, changed: null, cancelled: false, panels: [] }]);
    const out = await assistant.ask(context ? GREET.aboutPrefix(context.label, q) : q, model.digest);
    if (out.kind === 'cancelled') { patch(id, (e) => (e.kind === 'reply' ? { ...e, cancelled: true } : e)); return; }
    const { panels, changed } = applyOps(out.reply.ops);
    takeProposals(out.reply, id);
    patch(id, (e) => (e.kind === 'reply' ? { ...e, say: out.reply.say, changed, panels } : e));
  }, [assistant, model.digest, applyOps, takeProposals, push, patch, beginTurn]);

  /** A local answer (no model) as one owner turn. */
  const localAnswer = useCallback((question: string, text: string, ops: UiOp[], lines?: readonly string[]) => {
    const turn = beginTurn();
    const { panels } = applyOps(ops);
    push(turn, { kind: 'you', text: question, about: null }, { kind: 'local', text, lines, panels });
  }, [beginTurn, applyOps, push]);

  const onChip = (c: Chip) => {
    if (c.kind === 'ask') { void ask(c.label, null); return; }
    if (c.kind === 'away') {
      const s = away.summary;
      localAnswer(c.label, s ? GREET.away(s.sinceWords) : GREET.awayAnswerQuiet, [], s ? (s.lines.length ? s.lines.map((l) => l.text) : [s.lead ?? GREET.awayAnswerQuiet]) : []);
      return;
    }
    if (c.kind === 'everything') { localAnswer(c.label, GREET.everything, [{ op: 'show', panel: { kind: 'book', module: null, fate: null } }]); return; }
    localAnswer(c.label, GREET.steps, [{ op: 'show', panel: { kind: 'setup' } }]);
  };

  // ---- Undo: the last owner turn goes, whole, and the side panel goes back with it
  const lastTurn = useMemo(() => {
    const last = entries[entries.length - 1];
    return last && last.turn !== null ? last.turn : null;
  }, [entries]);
  const undoTurn = useCallback(() => {
    if (lastTurn === null) return;
    const gone = entriesRef.current.filter((e) => e.turn === lastTurn).map((e) => e.id);
    setEntries((t) => t.filter((e) => e.turn !== lastTurn));
    if (propsEntry !== null && gone.includes(propsEntry)) { setProposals([]); setPropsEntry(null); setActed(null); }
    const before = navBefore.current.get(lastTurn);
    if (before) setNav(before);
    navBefore.current.delete(lastTurn);
  }, [lastTurn, propsEntry]);

  // ---- keys: `/` asks; Esc lets go of the item and goes back to today (the history stays)
  const input = useRef<HTMLInputElement>(null);
  const backToToday = useCallback(() => {
    setNav((n) => (n.sel ? { ...n, sel: null } : n));
    scrollTo('greeting');
  }, [scrollTo]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing || layerCount() > 0) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing) { e.preventDefault(); input.current?.focus(); return; }
      if (e.key === 'Escape') {
        if (typing) { t?.blur(); return; }
        backToToday();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [backToToday]);

  // Keep the latest turn in view.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: entries.length ? 'smooth' : 'auto' });
  }, [entries.length]);

  const [typed, setTyped] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); const q = typed; setTyped(''); void ask(q, about); };

  const busy = assistant.busy;
  const lastLook = useMemo(() => [...entries].reverse().find((e) => e.kind === 'look')?.id ?? null, [entries]);

  return (
    <div className="ft-app ui-ground" data-front="thread" data-ready={model.ready ? 'true' : 'false'}>
      <header className="ui-toolbar ft-bar">
        <span className="ft-brand"><Mark /><b>{BRAND_NAME}</b></span>
        <MockBadge />
        <span className="ui-spacer" />
        <Btn sm kind="plain" onClick={() => setHomeView('console')} title={GREET.toConsoleTitle}>{GREET.toConsole}</Btn>
      </header>
      <main className="ft-stage" aria-label={GREET.mainLabel}>
        <section className="ft-talk">
          <div className="ft-scroll" ref={scroller}>
            <ol className="ft-transcript" aria-live="polite">
              <li className="ft-turn is-me" data-entry="greeting">
                <Opening g={greeting} gsDone={gs.done} gsTotal={gs.total} host={host}
                  onAllNeeds={() => localAnswer(GREET.allNeeds(greeting.needs), GREET.shownBelow, [{ op: 'show', panel: { kind: 'needs', module: null } }, { op: 'focus', module: null, fate: 'needs', deal_id: null }])} />
                {greeting.chips.length ? (
                  <div className="ft-chips" role="group" aria-label={GREET.suggested}>
                    {greeting.chips.map((c) => <button key={c.label} type="button" className="ft-chip" disabled={busy} onClick={() => onChip(c)}>{c.label}</button>)}
                  </div>
                ) : null}
              </li>
              {entries.map((e) => {
                const isLast = e.turn !== null && e.turn === lastTurn && e === entries[entries.length - 1];
                const undo = isLast ? <button type="button" className="linkbtn ft-undo" onClick={undoTurn} title={GREET.undoTurnTitle}>{GREET.undoTurn}</button> : null;
                if (e.kind === 'look') {
                  return (
                    <li key={e.id} className={`ft-turn is-look${flash === e.id ? ' is-flash' : ''}`} data-entry={e.id} data-look={`${e.module}:${e.row}`}>
                      <p className="ft-you ft-you-look"><Glyph module={e.module} className="ft-you-g" />{GREET.looking(lists[e.module].rows.find((r) => r.id === e.row)?.title ?? e.title)}</p>
                      <LookCard e={e} list={lists[e.module]} host={host} primary={e.id === lastLook} />
                      {undo ? <p className="ft-change">{undo}</p> : null}
                    </li>
                  );
                }
                return (
                  <li key={e.id} className={`ft-turn ${e.kind === 'you' ? 'is-you' : 'is-me'}`} data-entry={e.id}>
                    {e.kind === 'you' ? <p className="ft-you">{e.about ? <span className="ft-about-tag">{GREET.about(e.about)}</span> : null}{e.text}</p> : null}
                    {e.kind === 'local' ? (
                      <div className="ft-say">
                        <p>{e.text}</p>
                        {e.lines?.length ? <ul className="ft-lines">{e.lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
                        {e.panels?.map((p) => <Panel key={panelKey(p)} p={p} host={host} gs={gs} jump={jump} />)}
                        {undo ? <p className="ft-change">{undo}</p> : null}
                      </div>
                    ) : null}
                    {e.kind === 'reply' ? (
                      <Reply e={e} undo={undo}>
                        {e.panels.map((p) => <Panel key={panelKey(p)} p={p} host={host} gs={gs} jump={jump} />)}
                        {propsEntry === e.id && hasProposals({ proposals, acted }) ? (
                          <div className="ft-panel is-suggest">
                            <Proposals proposals={proposals} acted={acted} byId={model.byId} facts={facts} stale={stale} locked={locked} opening={open.pending}
                              act={{ pending: doAct.pending, error: doAct.error }} undoAct={{ pending: undoAct.pending, error: undoAct.error }}
                              perform={(p, c) => void perform(p, c)} undo={(a) => void undoActed(a)} run={run} gold={false} />
                          </div>
                        ) : null}
                      </Reply>
                    ) : null}
                    {e.kind === 'setup' ? (
                      <SetupCard step={e.step} done={gs.steps.find((s) => s.key === e.step)?.state === 'done'}
                        opened={opened.has(e.step)} onOpened={() => setOpened((o) => new Set(o).add(e.step))} />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="ft-askwrap">
            {about ? (
              <p className="ft-about">
                <span className="ft-about-t">{GREET.about(about.title)}</span>
                <button type="button" className="linkbtn" onClick={backToToday} title={GREET.aboutClearTitle}>{GREET.aboutClear}</button>
              </p>
            ) : null}
            <form className="ft-ask" onSubmit={submit} aria-label={GREET.askLabel}>
              <input ref={input} className="ui-field ft-input" type="text" value={typed} onChange={(e) => setTyped(e.target.value)}
                placeholder={about ? GREET.aboutPlaceholder(about.title) : GREET.askPlaceholder}
                aria-label={GREET.askLabel} maxLength={300} autoComplete="off" />
              {busy ? <Btn onClick={assistant.cancel}>{GREET.stop}</Btn> : <Btn kind={setup ? 'default' : 'primary'} type="submit" disabled={!typed.trim()}>{GREET.send}</Btn>}
            </form>
            <p className="ft-answers" data-engine={assistant.engine.id}>{GREET.engine(engineWords(assistant.engine))}</p>
          </div>
        </section>
        <aside className="ft-side" aria-label={GREET.modules}>
          <Side lists={lists} nav={nav}
            onToggle={(m) => setNav((n) => { const o = new Set(n.open); if (o.has(m)) o.delete(m); else o.add(m); return { ...n, open: o }; })}
            onMore={(m) => setNav((n) => { const o = new Set(n.more); if (o.has(m)) o.delete(m); else o.add(m); return { ...n, more: o }; })}
            onPick={look} />
        </aside>
      </main>
    </div>
  );
}

/** A panel a reply (or a local answer) showed, inside its own turn. */
function Panel({ p, host, gs, jump }: { p: PanelSpec; host: PanelHost; gs: ReturnType<typeof useStart>; jump: (k: StartStepKey) => void }) {
  return (
    <div className="ft-panel" data-panel={panelKey(p)}>
      {p.kind === 'setup' ? <SetupOverview gs={gs} onJump={jump} /> : <Answer panel={p} host={host} primary={false} />}
    </div>
  );
}

/** The local reply to "Looking at <title>": the module's own facts (its list columns, read live), the
 *  second-line fact, and for a deal the board's own decision / deal renderer with its actions. */
function LookCard({ e, list, host, primary }: { e: Extract<Entry, { kind: 'look' }>; list: ModuleList; host: PanelHost; primary: boolean }) {
  const row = list.rows.find((r) => r.id === e.row) ?? null;
  const k = e.deal_id ? host.model.byId.get(e.deal_id) ?? null : null;
  const meta = MODULE[e.module];
  const facts = row ? list.columns.map((c, i) => [c, row.cells[i]] as const).filter(([, c]) => c && c.text) : [];
  return (
    <div className="ft-look" style={{ '--mc': meta.cssVar } as React.CSSProperties}>
      <h4 className="ft-look-h"><Glyph module={e.module} className="ft-look-g" /><span>{row?.title ?? k?.title ?? e.title}</span><small>{meta.name}</small></h4>
      {facts.length ? (
        <dl className="ft-facts" aria-label={GREET.facts}>
          {facts.map(([name, c]) => (
            <div key={name} className="ft-fact">
              <dt>{name}</dt>
              <dd className={`${c!.num ? 'is-num' : ''}${c!.tone ? ` t-${c!.tone}` : ''}`}>{c!.text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {row?.sub && !k ? <p className="ft-quiet">{row.sub}</p> : null}
      {k ? (
        <div className="ft-panel"><Answer panel={k.fate === 'needs' ? { kind: 'decision', deal_id: k.id } : { kind: 'deal', deal_id: k.id }} host={host} primary={primary} /></div>
      ) : (
        <div className="ft-panel">
          <p className="ft-quiet">{row ? GREET.lookNoDeal(meta.name) : GREET.lookGone}</p>
          <div className="ft-acts">
            <Btn onClick={() => host.run({ kind: 'console', hash: `#m=${e.module}` })} title={GREET.goConsole(meta.name)}>{GREET.openModule(meta.name)}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function Opening({ g, gsDone, gsTotal, host, onAllNeeds }: { g: ReturnType<typeof compose>; gsDone: number; gsTotal: number; host: PanelHost; onAllNeeds: () => void }) {
  return (
    <div className={`ft-say ft-open t-${g.tone}`}>
      <p className="ft-status">{g.status}</p>
      {g.sub ? <p className="ft-sub">{g.sub}{g.mode === 'setup' ? <> <span className="ft-prog">{GREET.progress(gsDone, gsTotal)}</span></> : null}</p> : null}
      {g.away ? (
        <p className="ft-awayline">
          <span className="ft-kick">{GREET.away(g.away.since)}</span>
          <span>{g.away.lines[0]}{g.away.more ? <span className="ft-more">{GREET.awayMoreLine(g.away.more)}</span> : null}</span>
        </p>
      ) : null}
      {g.need ? (
        <div className="ft-away">
          <p className="ft-kick">{g.needs > 1 ? GREET.soonest : GREET.theOne}</p>
          <NeedCard k={g.need} n={g.needs} host={host} onAll={onAllNeeds} />
        </div>
      ) : null}
    </div>
  );
}

function NeedCard({ k, n, host, onAll }: { k: BoardKey; n: number; host: PanelHost; onAll: () => void }) {
  const meta = MODULE[k.module];
  return (
    <div className="ft-need" style={{ '--mc': meta.cssVar } as React.CSSProperties} data-need={k.id}>
      <div className="ft-need-h">
        <Glyph module={k.module} className="ft-need-g" />
        <b className="ft-need-t">{k.title}</b>
        <Amount k={k} />
      </div>
      <p className="ft-need-m">
        <span>{meta.name}</span>
        {k.deadline_s !== null ? <span><Countdown deadline={k.deadline_s} /></span> : null}
        {k.why ? <span>{k.why}</span> : null}
      </p>
      {k.on_silence ? <p className="ft-need-s"><b>{GREET.ifNothing}:</b> {k.on_silence}</p> : null}
      <div className="ft-acts">
        {k.review
          ? <Btn kind="gold" locked={host.locked} disabled={host.pending} onClick={() => host.run({ kind: 'approval', deal_id: k.id, target: null })}>{GREET.review}</Btn>
          : <Btn onClick={() => host.run({ kind: 'console', hash: formatHash({ level: 'deal', deal: k.id }) })}>{GREET.open}</Btn>}
        {n > 1 ? <Btn kind="plain" onClick={onAll}>{GREET.allNeeds(n)}</Btn> : null}
      </div>
    </div>
  );
}

function Reply({ e, undo, children }: { e: Extract<Entry, { kind: 'reply' }>; undo: React.ReactNode; children: React.ReactNode }) {
  if (e.cancelled) return <p className="ft-say is-quiet">{GREET.stopped}{undo ? <> {undo}</> : null}</p>;
  if (e.say === null) return <p className="ft-say is-quiet ft-thinking">{GREET.thinking}</p>;
  return (
    <div className="ft-say">
      <p>{e.say || GREET.nothingSaid}</p>
      {children}
      {e.changed || undo ? <p className="ft-change">{e.changed}{undo}</p> : null}
    </div>
  );
}
