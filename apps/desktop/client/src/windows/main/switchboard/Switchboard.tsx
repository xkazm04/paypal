// The conversational home: the board. One page, full window: the instrument strip, the switchboard
// (six modules by four fates, one key per deal) and a chat rail whose answers appear beside the board
// and may light up or dim parts of it. The assistant only PROPOSES: every reply passes validateReply and
// the ops below are applied here, by the host; a proposal is armed only if the host resolves it
// (resolve.ts). Nothing on this page approves, signs, captures, voids or releases anything: the only
// route to a money decision is `approval_open`, and a decision is made in the approval window.
// Safe acts (docs/design/conversational-home-safe-acts.md): a proposal that changes the wallet is
// drawn as a consent box from the host's resolution, and its one act-tier command (SAFE_ACTS) is
// invoked only by the owner's press on that box, once, after re-checking what was shown. Its undo is
// the host's own button, never the assistant's.
// The answer area is a composition region (region.ts): up to three panels the assistant's `show` ops
// and the owner's own opens add to by one rule, that the owner may pin (a pinned panel survives every
// reply) or close. After each applied reply the rail says in one line what changed on screen, and one
// Undo puts the region, the filter and the light back exactly as they were before that reply. An owner
// move supersedes that undo; a stopped turn applies nothing; Esc clears the region and its pins. A
// move she makes while a question is being answered wins: that reply's layout is held and offered on
// its turn, never applied over her move (its proposals still appear).
// Esc backs out to the overview and never leaves the page by itself; `/` focuses the chat input.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Module } from '@bindings/Module';
import type { AssistantEngine, Fate, PanelSpec, UiOp, ValidatedReply } from '../../../lib/assistant';
import { useMutation } from '../../../lib/hooks';
import {
  BOARD_ACT, BOARD_ANSWER_CLOSE, BOARD_ANSWER_EMPTY, BOARD_ANSWER_LABEL, BOARD_CHANGED, BOARD_CRUMB_BOARD, BOARD_CRUMB_LABEL, BOARD_EMPTY_BOARD, BOARD_FATE, BOARD_FILTER_CLEAR, BOARD_MAIN_LABEL,
  BOARD_PANEL_TITLE, BOARD_PROPOSAL, BOARD_REGION, BOARD_REPAIRED, BOARD_SUB, BOARD_TITLE, BOARD_TO_CONSOLE, BOARD_TO_CONSOLE_TITLE, BRAND_NAME,
} from '../../../lib/words';
import { Mark } from '../../../shared/brand';
import { MockBadge, ModeBadge, WalletNotice } from '../../../shared/honesty';
import { MODULE } from '../../../shared/modules';
import { Btn, ThemeSwitch } from '../../../shared/ui';
import { useDeals, useLocked, useNeeds, useRuns, useSettings } from '../world';
import { Answer, panelTitle, type PanelHost } from './Answer';
import { ChatRail, type Turn } from './ChatRail';
import { InstrumentStrip } from './InstrumentStrip';
import { Matrix, NO_FILTER } from './Matrix';
import {
  applyLayout, canPin, changedAnything, changeLine, closePanel, diffArrangement, EMPTY_ARRANGEMENT, focusPanel, panelKey, PIN_MAX, place, setPinned, type Arrangement, type ChangeNames,
} from './region';
import { resolveAction, undoAvailable, type ActRun, type BoardFacts, type Consent, type Run } from './resolve';
import { useBoardAssistant, type AssistantDeps } from './useBoardAssistant';
import { useBoardModel } from './useBoardModel';
import { setHomeView } from './view';
import './switchboard.css';

type Proposal = { id: number; action: Extract<UiOp, { op: 'propose' }>['action']; why: string };
/** The outcome of an act the owner pressed on this page (kept until the next act or Esc). */
type Acted = { proposal: Proposal; run: ActRun; fingerprint: string; reverse: string; phase: 'done' | 'undone' };

const SETUP_PANEL: PanelSpec = { kind: 'setup' };

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
  const [repaired, setRepaired] = useState(false);
  const [acted, setActed] = useState<Acted | null>(null);
  const [stale, setStale] = useState<ReadonlySet<number>>(() => new Set());
  const inflight = useRef(false);
  const turnId = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const { filter, highlight } = arr;
  const focused = arr.region.find((x) => panelKey(x.spec) === arr.focus) ?? null;
  // A brand-new wallet opens on the setup steps (shown while the region is empty, not a region panel);
  // everything else opens on the plain board.
  const setupShown = arr.region.length === 0 && model.firstRun;
  const shown: PanelSpec | null = focused?.spec ?? (setupShown ? SETUP_PANEL : null);
  const selId = shown && (shown.kind === 'decision' || shown.kind === 'deal') ? shown.deal_id : null;
  const selKey = selId ? model.byId.get(selId) ?? null : null;

  const commit = useCallback((next: Arrangement) => { arrRef.current = next; setArr(next); }, []);
  // Counts the owner's own changes to the arrangement. A reply whose question was asked before the
  // count moved does not apply its layout: she changed the board while it answered, and her move wins
  // (its layout is offered on the turn instead; `ask` / `applyHeld`).
  const ownerMoves = useRef(0);
  /** A reply's layout ops held back because she moved while it answered, by turn (the latest only). */
  const held = useRef<{ turn: number; ops: readonly UiOp[] } | null>(null);

  // ---- the owner's own moves: each supersedes the last reply's pending undo ----
  const move = useCallback((f: (a: Arrangement) => Arrangement) => {
    const next = f(arrRef.current);
    if (next === arrRef.current) return;
    ownerMoves.current += 1;
    commit(next);
    setUndoTo(null);
  }, [commit]);
  // Back to the overview: the region and its pins clear (pins live for this task only).
  const overview = useCallback(() => { ownerMoves.current += 1; commit(EMPTY_ARRANGEMENT); setUndoTo(null); setProposals([]); setRepaired(false); setActed(null); }, [commit]);
  const pick = useCallback((id: string) => {
    const k = model.byId.get(id);
    if (!k) return;
    move((a) => ({ ...place(a, { kind: k.fate === 'needs' ? 'decision' : 'deal', deal_id: id }), highlight: null }));
  }, [model.byId, move]);
  const filterTo = useCallback((m: Module | null, f: Fate | null) => move((a) => ({ ...a, filter: { module: m, fate: f }, highlight: null })), [move]);
  const toggleRow = (m: Module) => move((a) => ({ ...a, filter: { module: a.filter.module === m ? null : m, fate: a.filter.fate } }));
  const toggleCol = (f: Fate) => move((a) => ({ ...a, filter: { module: a.filter.module, fate: a.filter.fate === f ? null : f } }));
  const more = (m: Module, f: Fate) => move((a) => ({ ...place(a, { kind: 'book', module: m, fate: f }), filter: { module: m, fate: f }, highlight: null }));
  const openPanel = (spec: PanelSpec) => move((a) => ({ ...place(a, spec), highlight: null }));

  // ---- the one-step undo of the last reply's layout change (acts keep their own undo below) ----
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
  const perform = useCallback(async (p: Proposal, shown: Consent) => {
    if (inflight.current) return;
    const now = resolveAction(p.action, model.byId, factsRef.current);
    if (!now.armed || !now.act || now.consent.fingerprint !== shown.fingerprint) {
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
    setRepaired(reply.repaired);
    return changed;
  }, [applyOps]);

  const ask = useCallback(async (question: string) => {
    const id = ++turnId.current;
    const movesAtAsk = ownerMoves.current;
    setTurns((t) => [...t.slice(-11), { id, question, answer: null }]);
    const out = await assistant.ask(question, model.digest);
    // A stopped turn applies nothing: the arrangement stays exactly as the owner last saw it.
    if (out.kind === 'cancelled') {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer: { say: '', dropped: 0, fellBack: false, cancelled: true, engine: null, hadOps: false, changed: null, undone: false, held: false } } : x)));
      return;
    }
    const r = out.reply;
    // She moved the board after asking: her move wins. The reply's layout is held on this turn (only
    // if it would change something now) and applied only if she asks for it.
    const moved = ownerMoves.current !== movesAtAsk;
    const wouldChange = moved && changedAnything(diffArrangement(arrRef.current, applyLayout(arrRef.current, r.ops, (x) => model.byId.has(x))));
    held.current = wouldChange ? { turn: id, ops: r.ops } : null;
    const changed = apply(r, id, !moved);
    setTurns((t) => t.map((x) => (x.id === id
      ? { ...x, answer: { say: r.say, dropped: r.dropped.count, fellBack: out.fellBack, cancelled: false, engine: out.engine, hadOps: r.ops.length > 0, changed, undone: false, held: wouldChange } }
      // one held layout at a time: a newer reply retires an older offer
      : x.answer?.held ? { ...x, answer: { ...x.answer, held: false } } : x)));
  }, [assistant, model.digest, model.byId, apply]);

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

  // The focused panel is brought into view (no animation: the region only says where it is).
  useEffect(() => {
    if (!arr.focus) return;
    root.current?.querySelector<HTMLElement>('.sb-panel.focus')?.scrollIntoView?.({ block: 'nearest' });
  }, [arr.focus]);

  // ---- keys the page owns: Esc backs out and never leaves; / goes to the input ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing) { e.preventDefault(); input.current?.focus(); return; }
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (typing && t === input.current) {
        input.current?.blur();
        root.current?.querySelector<HTMLElement>('.sb-matrix [data-slot][tabindex="0"]')?.focus();
        return;
      }
      overview();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overview]);

  // ---- the crumb: where the owner is, on the board itself ----
  const crumbModule = filter.module ?? selKey?.module ?? null;
  const crumbFate = filter.fate ?? selKey?.fate ?? null;
  const crumb = [BOARD_CRUMB_BOARD, crumbModule ? MODULE[crumbModule].name : null, crumbFate ? BOARD_FATE[crumbFate].word : null, selKey ? selKey.label : null].filter((x): x is string => !!x);
  const filtered = !!(filter.module || filter.fate);

  return (
    <div className="sb-app" data-testid="switchboard" ref={root}>
      <header className="sb-bar">
        <div className="sb-brand"><Mark /><b>{BRAND_NAME}</b><span>{BOARD_TITLE} · {BOARD_SUB}</span></div>
        {settings ? <ModeBadge mode={settings.mode} /> : null}
        <MockBadge />
        <span className="sb-spacer" />
        <Btn sm onClick={() => setHomeView('console')} title={BOARD_TO_CONSOLE_TITLE}>{BOARD_TO_CONSOLE}</Btn>
        <ThemeSwitch />
      </header>
      <main className="sb-board" aria-label={BOARD_MAIN_LABEL}>
        <InstrumentStrip inst={model.instruments} onOpen={(t) => openPanel({ kind: t === 'money' ? 'money' : 'safety' })} />
        <div className="sb-matrixwrap">
          <Matrix model={model} filter={filter} highlight={highlight} selId={selId} onKey={pick} onMore={more} onRow={toggleRow} onCol={toggleCol} />
          {model.ready && model.keys.length === 0 ? <p className="sb-emptynote" data-empty-board>{BOARD_EMPTY_BOARD}</p> : null}
        </div>
      </main>
      <ChatRail engine={assistant.engine} busy={assistant.busy} turns={turns} onAsk={(q) => void ask(q)} onCancel={assistant.cancel} onApplyHeld={applyHeld} inputRef={input}>
        <section className="sb-answer" aria-label={BOARD_ANSWER_LABEL} data-answer={shown?.kind ?? 'none'} data-region={arr.region.length}>
          <div className="sb-answer-top">
            <nav className="sb-crumb" aria-label={BOARD_CRUMB_LABEL}>
              {crumb.map((c, i) => <span key={i} className={i === crumb.length - 1 ? 'sb-here' : undefined} aria-current={i === crumb.length - 1 ? 'location' : undefined}>{i ? <i aria-hidden="true"> › </i> : null}{c}</span>)}
              {filtered ? <button type="button" className="sb-linkbtn" onClick={() => move((a) => ({ ...a, filter: NO_FILTER }))}>{BOARD_FILTER_CLEAR}</button> : null}
            </nav>
            <Btn sm className="sb-layout-undo" disabled={!undoTo} onClick={undoLayout} title={undoTo ? BOARD_REGION.undoTitle : BOARD_REGION.undoNone} data-layout-undo={undoTo ? 'ready' : 'none'}>{BOARD_REGION.undo}</Btn>
          </div>
          {arr.region.length ? (
            <ol className="sb-region" aria-label={BOARD_REGION.label}>
              {arr.region.map((x) => {
                const key = panelKey(x.spec);
                const isFocus = key === arr.focus;
                const pinOff = !x.pinned && !canPin(arr.region, key);
                return (
                  <li key={key} className={`sb-panel${isFocus ? ' focus' : ''}${x.pinned ? ' pinned' : ''}`} data-panel={x.spec.kind} data-panel-key={key} data-pinned={x.pinned ? 'true' : 'false'} aria-current={isFocus ? 'true' : undefined}>
                    <div className="sb-answer-h">
                      <h3><button type="button" className="sb-ptitle" onClick={() => move((a) => focusPanel(a, key))}>{panelTitle(x.spec)}</button></h3>
                      <span className="sb-pactions">
                        <button type="button" className="sb-pin" aria-pressed={x.pinned} disabled={pinOff} onClick={() => move((a) => setPinned(a, key, !x.pinned))} title={pinOff ? BOARD_REGION.pinFull(PIN_MAX) : x.pinned ? BOARD_REGION.unpinTitle : BOARD_REGION.pinTitle} data-pin={key}>{BOARD_REGION.pin}</button>
                        <button type="button" className="sb-close" onClick={() => move((a) => closePanel(a, key))} aria-label={BOARD_ANSWER_CLOSE} title={BOARD_ANSWER_CLOSE} data-close={key}>×</button>
                      </span>
                    </div>
                    <div className="sb-answer-b"><Answer panel={x.spec} host={host} primary={isFocus} /></div>
                  </li>
                );
              })}
            </ol>
          ) : setupShown ? (
            <>
              <div className="sb-answer-h"><h3>{panelTitle(SETUP_PANEL)}</h3></div>
              <div className="sb-answer-b"><Answer panel={SETUP_PANEL} host={host} /></div>
            </>
          ) : <p className="sb-quiet">{BOARD_ANSWER_EMPTY}</p>}
          {repaired ? <p className="sb-note" data-note="repaired">{BOARD_REPAIRED}</p> : null}
          {proposals.length ? (
            <ul className="sb-proposals" aria-label={BOARD_PROPOSAL.label}>
              {proposals.map((p) => {
                // An act whose outcome is shown below is not offered again beside it.
                if (acted && acted.phase === 'done' && acted.proposal === p) return null;
                const r = resolveAction(p.action, model.byId, facts);
                const why = <span className="sb-why"><b>{BOARD_PROPOSAL.because}:</b> {p.why}</span>;
                if (r.armed && r.act) {
                  // The consent box: every word from the resolution (fixed words + the wallet's facts).
                  const c = r.consent;
                  return (
                    <li key={p.id} className="sb-proposal act" data-proposal={p.action.action} data-act={r.run.act}>
                      {why}
                      <section className="sb-consent" aria-label={BOARD_ACT.boxLabel} data-consent={r.run.act}>
                        <span className="sb-ok">{r.confirm}</span>
                        <b className="sb-ct">{c.title}</b>
                        <span>{c.does}</span>
                        <span>{c.doesNot}</span>
                        <span className="sb-quiet">{c.reverse}</span>
                        <span className="sb-actions">
                          <Btn sm disabled={doAct.pending || undoAct.pending} onClick={() => void perform(p, c)} data-press={r.run.act}>{doAct.pending ? c.pressing : c.press}</Btn>
                        </span>
                        {stale.has(p.id) ? <span className="sb-quiet" data-stale>{BOARD_ACT.whyDisarmed.changed}</span> : null}
                        {doAct.error ? <WalletNotice error={doAct.error} what={BOARD_ACT.failed} /> : null}
                      </section>
                    </li>
                  );
                }
                return (
                  <li key={p.id} className={`sb-proposal${r.armed ? '' : ' off'}`} data-proposal={p.action.action}>
                    {why}
                    <Btn sm disabled={!r.armed || open.pending} onClick={() => { if (r.armed && !r.act) run(r.run); }} locked={r.armed && !r.act && r.run.kind === 'approval' && locked}>{r.label}</Btn>
                    <span className="sb-quiet">{r.armed ? r.confirm : `${BOARD_PROPOSAL.disarmed}: ${r.reason}`}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {acted ? (
            <div className="sb-acted" role="status" data-acted={`${acted.run.act}:${acted.phase}`}>
              <span>{acted.phase === 'done' ? acted.run.done : acted.run.undone}</span>
              {acted.phase === 'done' && undoAvailable(acted.run, facts) ? (
                <span className="sb-actions">
                  <Btn sm disabled={undoAct.pending || doAct.pending} onClick={() => void undo(acted)} title={acted.run.undoTitle} data-undo={acted.run.act}>{undoAct.pending ? BOARD_ACT.undoing : BOARD_ACT.undo}</Btn>
                  <span className="sb-quiet">{acted.reverse}</span>
                </span>
              ) : null}
              {undoAct.error ? <WalletNotice error={undoAct.error} what={BOARD_ACT.undoFailed} /> : null}
            </div>
          ) : null}
        </section>
      </ChatRail>
    </div>
  );
}

