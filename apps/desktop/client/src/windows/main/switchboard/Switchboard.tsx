// The conversational home: the board, laid out as The Proof Table (spark the-proof-table; contest
// ai-ux-board-r2, B/2). One page, full window, no page scroll: the top bar; what the board says, in one
// sentence whose figures light the board where they are true; the three standing questions; up to
// three answers in fixed slots; the board column (counts, what is lit, the sum, the lit deals); and
// the ask bar. The assistant only PROPOSES: every reply passes validateReply and the ops below are
// applied here, by the host; a proposal is armed only if the host resolves it (resolve.ts). Nothing on
// this page approves, signs, captures, voids or releases anything: the only route to a money decision
// is `approval_open`, and a decision is made in the approval window.
// Safe acts (docs/design/conversational-home-safe-acts.md): a proposal that changes the wallet is
// drawn as a consent box from the host's resolution (Proposals.tsx), and its one act-tier command
// (SAFE_ACTS) is invoked only by the owner's press on that box, once, after re-checking what was
// shown. Its undo is the host's own button, never the assistant's.
// The answers are a composition region (region.ts): up to three panels in fixed slots that the
// assistant's `show` ops and the owner's own opens add to by one rule, that the owner may pin (a pinned
// panel survives every reply) or close. After each applied reply one line says what changed on screen,
// and one Undo puts the region, the filter and the light back exactly as they were before that reply.
// An owner move supersedes that undo; a stopped turn applies nothing; Esc clears the region and its
// pins. A move she makes while a question is being answered wins: that reply's layout is held and
// offered, never applied over her move (its proposals still appear).
// A figure she hovers, focuses or holds in the sentence lights its own set on the board column: that
// light is the page's own (never an op, never undoable, gone with Esc or the next answer).
// Keys: one declaration (keys.ts). `/` asks, Esc lets go of a held figure or else clears the region,
// pins, filter and light, `?` lists the keys; the arrows belong to the board column.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Module } from '@bindings/Module';
import type { AssistantEngine, Fate, PanelSpec, UiOp, ValidatedReply } from '../../../lib/assistant';
import { SETUP_INTENT_KEY } from '../../../lib/firstRun';
import { useEvent, useMutation } from '../../../lib/hooks';
import {
  BOARD_ACT, BOARD_CHANGED, BOARD_CHIPS, BOARD_CRUMB_BOARD, BOARD_EARLIER, BOARD_FATE, BOARD_GHOSTS, BOARD_KEYS, BOARD_MAIN_LABEL, BOARD_PANEL_TITLE, BOARD_PROPOSAL, BOARD_TO_CONSOLE,
  BOARD_TO_CONSOLE_TITLE, BRAND_NAME,
} from '../../../lib/words';
import { Mark } from '../../../shared/brand';
import { MockBadge, ModeBadge } from '../../../shared/honesty';
import { MODULE } from '../../../shared/modules';
import { Btn, layerCount, ThemeSwitch } from '../../../shared/ui';
import { formatHash } from '../logic';
import { useDeals, useLocked, useNeeds, useRuns, useSettings } from '../world';
import type { PanelHost } from './Answer';
import { AskBar } from './AskBar';
import { BoardColumn } from './BoardColumn';
import { Earlier, KeysHelp } from './Earlier';
import type { Figure } from './figures';
import { bindingOf } from './keys';
import { litFromArrangement, NO_FILTER } from './lit';
import { hasProposals, Proposals, type Acted, type Proposal } from './Proposals';
import {
  applyLayout, changedAnything, changeLine, closePanel, diffArrangement, EMPTY_ARRANGEMENT, focusPanel, panelKey, place, setPinned, slotsOf, type Arrangement, type ChangeNames,
} from './region';
import { resolveAction, type BoardFacts, type Consent, type Run } from './resolve';
import { engineWords, Says, type FigureHost, type Turn } from './Says';
import { Slots, type Extra } from './Slots';
import { StandingStrip } from './StandingStrip';
import { standingAnswers } from './standing';
import { useBoardAssistant, type AssistantDeps } from './useBoardAssistant';
import { useBoardModel } from './useBoardModel';
import { setHomeView } from './view';
import './switchboard.css';

export function Switchboard({ engine, deps }: { engine?: AssistantEngine; deps?: AssistantDeps } = {}) {
  const model = useBoardModel();
  const settings = useSettings().data;
  const locked = useLocked();
  const open = useMutation('approval_open');
  // Every act and every undo goes through the one wallet door (SAFE_ACT_COMMAND, act tier), which
  // runs the closed act and records the consent words; called only from `perform` / `undo`.
  const doAct = useMutation('assistant_act');
  const undoAct = useMutation('assistant_act');
  const runs = useRuns().data;
  const needs = useNeeds();
  const deals = useDeals().data;
  const assistant = useBoardAssistant(engine, deps);

  // Everything a reply may change on screen, as one value (region.ts). The ref is the value the next
  // reply is applied to, so a diff and an undo snapshot never read a stale render.
  const [arr, setArr] = useState<Arrangement>(EMPTY_ARRANGEMENT);
  const arrRef = useRef<Arrangement>(arr);
  /** The arrangement from before the last applied reply that changed something (one step), and its turn. */
  const [undoTo, setUndoTo] = useState<{ before: Arrangement; turn: number } | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [askedAt, setAskedAt] = useState(0);
  const [acted, setActed] = useState<Acted | null>(null);
  const [stale, setStale] = useState<ReadonlySet<number>>(() => new Set());
  // The figure the pointer or keyboard is on, and the one she pressed to hold (the page's own light).
  const [figOn, setFigOn] = useState<Figure | null>(null);
  const [figHeld, setFigHeld] = useState<Figure | null>(null);
  const [sheet, setSheet] = useState<'earlier' | 'keys' | null>(null);
  const inflight = useRef(false);
  const turnId = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  const { filter, highlight } = arr;
  const focused = arr.region.find((x) => panelKey(x.spec) === arr.focus) ?? null;
  // A brand-new wallet opens on the setup steps (in a slot while the region is empty, not a region
  // panel); everything else opens on the plain board.
  const setupShown = arr.region.length === 0 && model.firstRun;
  const shown: PanelSpec | null = focused?.spec ?? (setupShown ? { kind: 'setup' } : null);
  const selId = shown && (shown.kind === 'decision' || shown.kind === 'deal') ? shown.deal_id : null;
  const selKey = selId ? model.byId.get(selId) ?? null : null;

  const commit = useCallback((next: Arrangement) => { arrRef.current = next; setArr(next); }, []);
  // Counts the owner's own changes to the arrangement. A reply whose question was asked before the
  // count moved does not apply its layout: she changed the board while it answered, and her move wins
  // (its layout is offered on the turn instead; `ask` / `applyHeld`).
  const ownerMoves = useRef(0);
  /** A reply's layout ops held back because she moved while it answered, by turn (the latest only). */
  const held = useRef<{ turn: number; ops: readonly UiOp[] } | null>(null);

  const letGo = useCallback(() => { setFigOn(null); setFigHeld(null); }, []);

  // ---- the owner's own moves: each supersedes the last reply's pending undo ----
  const move = useCallback((f: (a: Arrangement) => Arrangement) => {
    const next = f(arrRef.current);
    if (next === arrRef.current) return;
    ownerMoves.current += 1;
    commit(next);
    setUndoTo(null);
  }, [commit]);
  // Back to the overview: the region and its pins clear (pins live for this task only), and the light.
  const overview = useCallback(() => { ownerMoves.current += 1; commit(EMPTY_ARRANGEMENT); setUndoTo(null); setProposals([]); setActed(null); letGo(); }, [commit, letGo]);
  const pick = useCallback((id: string) => {
    const k = model.byId.get(id);
    if (!k) return;
    move((a) => ({ ...place(a, { kind: k.fate === 'needs' ? 'decision' : 'deal', deal_id: id }), highlight: null }));
  }, [model.byId, move]);
  const filterTo = useCallback((m: Module | null, f: Fate | null) => move((a) => ({ ...a, filter: { module: m, fate: f }, highlight: null })), [move]);
  // Her own filter wins over the reply's light and the figure's: the board then shows what she chose.
  const toggleRow = (m: Module) => { letGo(); move((a) => ({ ...a, highlight: null, filter: { module: a.filter.module === m ? null : m, fate: a.filter.fate } })); };
  const toggleCol = (f: Fate) => { letGo(); move((a) => ({ ...a, highlight: null, filter: { module: a.filter.module, fate: a.filter.fate === f ? null : f } })); };
  const toggleCell = (m: Module, f: Fate) => { letGo(); move((a) => ({ ...a, highlight: null, filter: a.filter.module === m && a.filter.fate === f ? NO_FILTER : { module: m, fate: f } })); };
  const openPanel = (spec: PanelSpec) => move((a) => ({ ...place(a, spec), highlight: null }));
  const showEverything = () => { letGo(); move((a) => ({ ...a, filter: NO_FILTER, highlight: null })); };

  // ---- the one-step undo of the last reply's layout change (acts keep their own undo) ----
  const undoLayout = useCallback(() => {
    if (!undoTo) return;
    ownerMoves.current += 1;
    commit(undoTo.before);
    setUndoTo(null);
    setTurns((t) => t.map((x) => (x.id === undoTo.turn && x.answer ? { ...x, answer: { ...x.answer, undone: true } } : x)));
  }, [undoTo, commit]);

  // Plain names for the change line: a panel's title plus what it is about.
  const names = useMemo<ChangeNames>(() => {
    const scope = (m: Module | null, f: Fate | null, dealId?: string | null): string =>
      [m ? MODULE[m].name : null, f ? BOARD_FATE[f].word : null, dealId ? model.byId.get(dealId)?.label ?? null : null].filter((x): x is string => !!x).join(', ');
    const panel = (p: PanelSpec): string => {
      const about = p.kind === 'decision' || p.kind === 'deal' ? scope(null, null, p.deal_id)
        : p.kind === 'needs' || p.kind === 'rules' ? scope(p.module, null)
          : p.kind === 'book' ? scope(p.module, p.fate) : '';
      return about ? `${BOARD_PANEL_TITLE[p.kind]} (${about})` : BOARD_PANEL_TITLE[p.kind];
    };
    return { panel, scope };
  }, [model.byId]);

  // ---- the hand-off: approval_open, or the console ----
  const run = useCallback((r: Run) => {
    if (r.kind === 'approval') {
      void open.run({ deal_id: r.deal_id, target: r.target });
      return;
    }
    window.location.hash = r.hash === '#' ? '' : r.hash;
    setHomeView('console');
  }, [open]);
  // The Tumbler routes an open main window by event. The board is the default home now, so a route to
  // a deal (or a setup step the Tumbler left a note for) hands over to the console, which reads the
  // hash and the note when it mounts; a route with neither is the home, which is here.
  useEvent('main:route', (r) => {
    let note = false;
    try { note = window.localStorage.getItem(SETUP_INTENT_KEY) !== null; } catch { /* no storage: no note */ }
    if (!r.deal_id && !note) return;
    if (r.deal_id) window.location.hash = formatHash({ level: 'deal', deal: r.deal_id });
    setHomeView('console');
  });
  // ---- the facts an act depends on, read from the wallet (never from the reply) ----
  const facts = useMemo<BoardFacts>(() => ({
    agentsPaused: settings ? !!settings.agents_paused : null,
    agentsWorking: runs ? runs.filter((r) => r.state === 'running' || r.state === 'starting').length : null,
    pausedAgents: settings ? settings.paused_agents ?? null : null,
    // As the console's own rule (Decision.tsx): a gate that offers Let it lapse, never a closed mismatch.
    lapsable: deals ? new Set(needs.filter((n) => n.kind === 'gate' && n.actions.includes('let_lapse') && deals.find((d) => d.id === n.deal_id)?.state !== 'MISMATCH').map((n) => n.deal_id)) : null,
  }), [settings, runs, needs, deals]);
  const factsRef = useRef(facts);
  factsRef.current = facts;

  // ---- an act: the owner pressed the consent box. Re-resolve, compare with what was shown, run once ----
  const perform = useCallback(async (p: Proposal, shownConsent: Consent) => {
    if (inflight.current) return;
    const now = resolveAction(p.action, model.byId, factsRef.current);
    if (!now.armed || !now.act || now.consent.fingerprint !== shownConsent.fingerprint) {
      setStale((s) => new Set(s).add(p.id));
      return;
    }
    inflight.current = true;
    try {
      const out = await doAct.run({ act: now.run.wire, consent: { words: now.consent.words, fingerprint: now.consent.fingerprint } });
      if (out === null) setActed({ proposal: p, run: now.run, fingerprint: now.consent.fingerprint, reverse: now.consent.reverse, phase: 'done' });
    } finally {
      inflight.current = false;
    }
  }, [model.byId, doAct]);
  const undo = useCallback(async (a: Acted) => {
    if (inflight.current || a.phase !== 'done') return;
    inflight.current = true;
    try {
      const words = `${BOARD_ACT.undo}. ${a.run.undoTitle}`;
      const out = await undoAct.run({ act: a.run.undoWire, consent: { words, fingerprint: `undo|${a.fingerprint}`.slice(0, 160) } });
      if (out === null) setActed({ ...a, phase: 'undone' });
    } finally {
      inflight.current = false;
    }
  }, [undoAct]);

  const host = useMemo<PanelHost>(() => ({ model, run, pending: open.pending, error: open.error, locked, pick, filterTo }), [model, run, open.pending, open.error, locked, pick, filterTo]);

  // ---- the assistant's ops: layout through the region's rules, proposals beside it ----
  /** Applies a reply's layout ops to the arrangement as it is now, as one undo step for `turn`;
   *  returns the line saying what changed on screen (null when nothing). */
  const applyOps = useCallback((ops: readonly UiOp[], turn: number): string | null => {
    const before = arrRef.current;
    const after = applyLayout(before, ops, (id) => model.byId.has(id));
    const change = diffArrangement(before, after);
    commit(after);
    // One step: the undo is always the last applied reply's, and only when it changed something.
    setUndoTo(changedAnything(change) ? { before, turn } : null);
    return changeLine(change, BOARD_CHANGED, names);
  }, [model.byId, commit, names]);

  /** Applies a reply. `layout: false` when she moved the board while it answered: then the layout is
   *  held back and only the proposals appear. Returns the change line (null when nothing changed). */
  const apply = useCallback((reply: ValidatedReply, turn: number, layout: boolean): string | null => {
    const changed = layout ? applyOps(reply.ops, turn) : null;
    const props: Proposal[] = [];
    for (const op of reply.ops) if (op.op === 'propose') props.push({ id: props.length, action: op.action, why: op.why });
    setProposals(props);
    setStale(new Set());
    return changed;
  }, [applyOps]);

  const ask = useCallback(async (question: string) => {
    const id = ++turnId.current;
    const movesAtAsk = ownerMoves.current;
    letGo();
    setAskedAt(Date.now());
    setTurns((t) => [...t.slice(-11), { id, question, answer: null }]);
    const out = await assistant.ask(question, model.digest);
    // A stopped turn applies nothing: the arrangement stays exactly as the owner last saw it.
    if (out.kind === 'cancelled') {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer: { say: '', dropped: 0, fellBack: false, cancelled: true, engine: null, hadOps: false, repaired: false, changed: null, undone: false, held: false } } : x)));
      return;
    }
    const r = out.reply;
    // She moved the board after asking: her move wins. The reply's layout is held on this turn (only
    // if it would change something now) and applied only if she asks for it.
    const moved = ownerMoves.current !== movesAtAsk;
    const wouldChange = moved && changedAnything(diffArrangement(arrRef.current, applyLayout(arrRef.current, r.ops, (x) => model.byId.has(x))));
    held.current = wouldChange ? { turn: id, ops: r.ops } : null;
    const changed = apply(r, id, !moved);
    letGo();
    setTurns((t) => t.map((x) => (x.id === id
      ? { ...x, answer: { say: r.say, dropped: r.dropped.count, fellBack: out.fellBack, cancelled: false, engine: out.engine, hadOps: r.ops.length > 0, repaired: r.repaired, changed, undone: false, held: wouldChange } }
      // one held layout at a time: a newer reply retires an older offer
      : x.answer?.held ? { ...x, answer: { ...x.answer, held: false } } : x)));
  }, [assistant, model.digest, model.byId, apply, letGo]);

  /** She asked for the layout a reply suggested while she was moving: applied now, by the region's
   *  rules, as an undo step of its own. */
  const applyHeld = useCallback((turn: number) => {
    const h = held.current;
    if (!h || h.turn !== turn) return;
    held.current = null;
    ownerMoves.current += 1;
    const changed = applyOps(h.ops, turn);
    setTurns((t) => t.map((x) => (x.id === turn && x.answer ? { ...x, answer: { ...x.answer, held: false, changed } } : x)));
  }, [applyOps]);

  // ---- the page's keys, from the one keymap (keys.ts): `/`, Esc and `?` ----
  const figHeldRef = useRef<Figure | null>(null);
  figHeldRef.current = figHeld;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      const id = bindingOf(e.key, 'page');
      if (!id || layerCount() > 0) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (id === 'ask' && !typing) { e.preventDefault(); input.current?.focus(); return; }
      if (id === 'help' && !typing) { e.preventDefault(); setSheet('keys'); return; }
      if (id !== 'clear') return;
      // Esc backs out and never leaves the page: the input lets go to the board; a held figure is let
      // go first; else the region, its pins, the filter and the light clear.
      e.preventDefault();
      if (typing && t === input.current) {
        input.current?.blur();
        grid.current?.querySelector<HTMLElement>('.sb-grid [tabindex="0"]')?.focus();
        return;
      }
      if (figHeldRef.current) { letGo(); return; }
      overview();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overview, letGo]);

  // ---- what the board column lights: the figure she is on or holds, else the reply's light and her filter ----
  const lit = (figOn ?? figHeld)?.lit ?? litFromArrangement(arr, model);
  const figs: FigureHost = {
    on: figOn,
    held: figHeld,
    setOn: setFigOn,
    toggleHeld: (f) => setFigHeld((h) => (h && h.start === f.start && h.text === f.text ? null : f)),
  };
  // The crumb: where the owner is (her filter, the deal in focus), else what the reply lit.
  const crumbModule = filter.module ?? selKey?.module ?? highlight?.module ?? null;
  const crumbFate = filter.fate ?? selKey?.fate ?? highlight?.fate ?? null;
  const crumb = [BOARD_CRUMB_BOARD, crumbModule ? MODULE[crumbModule].name : null, crumbFate ? BOARD_FATE[crumbFate].word : null, selKey ? selKey.label : null].filter((x): x is string => !!x);
  const active = !!(filter.module || filter.fate || highlight || figHeld);

  const standing = standingAnswers(model);
  const latest = turns.length ? turns[turns.length - 1]! : null;
  const busy = assistant.busy;

  // ---- the slots: the region, then the setup steps or the suggested next steps, then ghosts ----
  const slots = slotsOf(arr.region);
  const showProps = hasProposals({ proposals, acted });
  const footFor = showProps ? (arr.focus ?? (setupShown ? 'setup' : null)) : null;
  const extras: Extra[] = [];
  if (setupShown) extras.push({ kind: 'setup' });
  const propsNode = showProps ? (
    <Proposals proposals={proposals} acted={acted} byId={model.byId} facts={facts} stale={stale} locked={locked} opening={open.pending}
      act={{ pending: doAct.pending, error: doAct.error }} undoAct={{ pending: undoAct.pending, error: undoAct.error }}
      perform={(p, c) => void perform(p, c)} undo={(a) => void undo(a)} run={run}
      gold={footFor !== null && footFor !== 'setup' && focused?.spec.kind !== 'decision'} />
  ) : null;
  if (showProps && footFor === null) extras.push({ kind: 'suggested', title: BOARD_PROPOSAL.label, body: propsNode });
  // The suggestions under the field: not a question an empty slot already offers, nor the one just asked.
  const offered = new Set(BOARD_GHOSTS.filter((g) => !arr.region.some((p) => p.spec.kind === g.kind)).slice(0, Math.max(0, slots.filter((s) => !s).length - extras.length)).map((g) => g.q));
  const chips = BOARD_CHIPS.filter((q) => !offered.has(q) && q !== latest?.question).slice(0, 3);

  return (
    <div className="sb-app ui-ground" data-testid="switchboard" data-ready={model.ready ? 'true' : 'false'}>
      <header className="ui-toolbar sb-bar">
        <span className="sb-brand"><Mark /><b>{BRAND_NAME}</b></span>
        {settings ? <ModeBadge mode={settings.mode} /> : null}
        <MockBadge />
        <span className="ui-spacer" />
        <span className={`${assistant.engine.id === 'scripted' ? 'badge scripted_engine' : 'ui-chip teal'} sb-engine`} title={engineWords(assistant.engine)} data-engine={assistant.engine.id}>{engineWords(assistant.engine)}</span>
        <Btn sm onClick={() => setSheet('earlier')} title={BOARD_EARLIER.title} data-earlier-open>{BOARD_EARLIER.button} <span className="num sb-bar-n">{turns.length}</span></Btn>
        <ThemeSwitch />
        <Btn sm onClick={() => setHomeView('console')} title={BOARD_TO_CONSOLE_TITLE}>{BOARD_TO_CONSOLE}</Btn>
        <Btn sm icon onClick={() => setSheet('keys')} aria-label={BOARD_KEYS.button} title={`${BOARD_KEYS.button} (?)`} data-keys-open>
          <svg className="sb-kbd-ic" viewBox="0 0 20 14" aria-hidden="true"><rect x="1" y="1" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M4 5h1M7 5h1M10 5h1M13 5h1M16 5h0M5 9h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </Btn>
      </header>
      <main className="sb-stage" aria-label={BOARD_MAIN_LABEL}>
        <Says model={model} turn={latest} askedAt={askedAt} answering={assistant.answering} opening={standing} figs={figs}
          canUndo={!!undoTo} onUndo={undoLayout} onApplyHeld={applyHeld} />
        <StandingStrip answers={standing} onAsk={(q) => void ask(q)} busy={busy} />
        <Slots slots={slots} region={arr.region} focus={arr.focus} host={host} extras={extras} footFor={footFor} foot={propsNode} busy={busy}
          onAsk={(q) => void ask(q)} onFocus={(k) => move((a) => focusPanel(a, k))} onPin={(k, p) => move((a) => setPinned(a, k, p))} onClose={(k) => move((a) => closePanel(a, k))}
          answer={shown?.kind ?? 'none'} />
        <div ref={grid} className="sb-colwrap">
          <BoardColumn model={model} filter={filter} lit={lit} crumb={crumb} active={active} onShowEverything={showEverything}
            onRow={toggleRow} onCol={toggleCol} onCell={toggleCell} onKey={pick} onMore={openPanel} />
        </div>
        <AskBar busy={busy} chips={chips} onAsk={(q) => void ask(q)} onCancel={assistant.cancel} inputRef={input} />
      </main>
      {sheet === 'earlier' ? <Earlier turns={turns} onClose={() => setSheet(null)} /> : null}
      {sheet === 'keys' ? <KeysHelp onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
