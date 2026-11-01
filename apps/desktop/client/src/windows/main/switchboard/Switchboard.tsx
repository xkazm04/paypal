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
// Esc backs out to the overview and never leaves the page by itself; `/` focuses the chat input.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Module } from '@bindings/Module';
import type { AssistantEngine, Fate, PanelSpec, UiOp, ValidatedReply } from '../../../lib/assistant';
import { useMutation } from '../../../lib/hooks';
import {
  BOARD_ACT, BOARD_ANSWER_CLOSE, BOARD_ANSWER_EMPTY, BOARD_ANSWER_LABEL, BOARD_CRUMB_BOARD, BOARD_CRUMB_LABEL, BOARD_EMPTY_BOARD, BOARD_FATE, BOARD_FILTER_CLEAR, BOARD_MAIN_LABEL, BOARD_PROPOSAL,
  BOARD_REPAIRED, BOARD_SUB, BOARD_TITLE, BOARD_TO_CONSOLE, BOARD_TO_CONSOLE_TITLE, BRAND_NAME,
} from '../../../lib/words';
import { Mark } from '../../../shared/brand';
import { MockBadge, ModeBadge, WalletNotice } from '../../../shared/honesty';
import { MODULE } from '../../../shared/modules';
import { Btn, ThemeSwitch } from '../../../shared/ui';
import { useDeals, useLocked, useNeeds, useRuns, useSettings } from '../world';
import { Answer, panelTitle, type PanelHost } from './Answer';
import { ChatRail, type Turn } from './ChatRail';
import { InstrumentStrip } from './InstrumentStrip';
import { Matrix, NO_FILTER, type Filter, type Highlight } from './Matrix';
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

  const [panel, setPanel] = useState<PanelSpec | null>(null);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [repaired, setRepaired] = useState(false);
  const [acted, setActed] = useState<Acted | null>(null);
  const [stale, setStale] = useState<ReadonlySet<number>>(() => new Set());
  const inflight = useRef(false);
  const turnId = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // A brand-new wallet opens on the setup steps; everything else opens on the plain board.
  const shown: PanelSpec | null = panel ?? (model.firstRun ? SETUP_PANEL : null);
  const selId = shown && (shown.kind === 'decision' || shown.kind === 'deal') ? shown.deal_id : null;
  const selKey = selId ? model.byId.get(selId) ?? null : null;

  // ---- the owner's own moves ----
  const overview = useCallback(() => { setPanel(null); setFilter(NO_FILTER); setHighlight(null); setProposals([]); setRepaired(false); setActed(null); }, []);
  const pick = useCallback((id: string) => {
    const k = model.byId.get(id);
    if (!k) return;
    setHighlight(null);
    setPanel({ kind: k.fate === 'needs' ? 'decision' : 'deal', deal_id: id });
  }, [model.byId]);
  const filterTo = useCallback((m: Module | null, f: Fate | null) => { setFilter({ module: m, fate: f }); setHighlight(null); }, []);
  const toggleRow = (m: Module) => setFilter((p) => ({ module: p.module === m ? null : m, fate: p.fate }));
  const toggleCol = (f: Fate) => setFilter((p) => ({ module: p.module, fate: p.fate === f ? null : f }));
  const more = (m: Module, f: Fate) => { setFilter({ module: m, fate: f }); setHighlight(null); setPanel({ kind: 'book', module: m, fate: f }); };

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

  // ---- the assistant's ops ----
  const apply = useCallback((reply: ValidatedReply) => {
    let nextPanel: PanelSpec | null | undefined;
    let nextFilter: Filter | undefined;
    let nextHighlight: Highlight | null | undefined;
    const props: Proposal[] = [];
    for (const op of reply.ops) {
      switch (op.op) {
        case 'show': nextPanel = op.panel; break;
        case 'focus':
          if (op.deal_id !== null && !model.byId.has(op.deal_id)) break;
          nextHighlight = op.module === null && op.fate === null && op.deal_id === null ? null : { module: op.module, fate: op.fate, deal_id: op.deal_id };
          break;
        case 'filter': nextFilter = { module: op.module, fate: op.fate }; break;
        case 'propose': props.push({ id: props.length, action: op.action, why: op.why }); break;
      }
    }
    if (nextPanel !== undefined) setPanel(nextPanel);
    if (nextFilter !== undefined) setFilter(nextFilter);
    if (nextHighlight !== undefined) setHighlight(nextHighlight);
    setProposals(props);
    setStale(new Set());
    setRepaired(reply.repaired);
  }, [model.byId]);

  const ask = useCallback(async (question: string) => {
    const id = ++turnId.current;
    setTurns((t) => [...t.slice(-11), { id, question, answer: null }]);
    const out = await assistant.ask(question, model.digest);
    if (out.kind === 'cancelled') {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer: { say: '', dropped: 0, fellBack: false, cancelled: true, engine: null, hadOps: false } } : x)));
      return;
    }
    const r = out.reply;
    apply(r);
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer: { say: r.say, dropped: r.dropped.count, fellBack: out.fellBack, cancelled: false, engine: out.engine, hadOps: r.ops.length > 0 } } : x)));
  }, [assistant, model.digest, apply]);

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
        <InstrumentStrip inst={model.instruments} onOpen={(t) => { setHighlight(null); setPanel({ kind: t === 'money' ? 'money' : 'safety' }); }} />
        <div className="sb-matrixwrap">
          <Matrix model={model} filter={filter} highlight={highlight} selId={selId} onKey={pick} onMore={more} onRow={toggleRow} onCol={toggleCol} />
          {model.ready && model.keys.length === 0 ? <p className="sb-emptynote" data-empty-board>{BOARD_EMPTY_BOARD}</p> : null}
        </div>
      </main>
      <ChatRail engine={assistant.engine} busy={assistant.busy} turns={turns} onAsk={(q) => void ask(q)} onCancel={assistant.cancel} inputRef={input}>
        <section className="sb-answer" aria-label={BOARD_ANSWER_LABEL} data-answer={shown?.kind ?? 'none'}>
          <nav className="sb-crumb" aria-label={BOARD_CRUMB_LABEL}>
            {crumb.map((c, i) => <span key={i} className={i === crumb.length - 1 ? 'sb-here' : undefined} aria-current={i === crumb.length - 1 ? 'location' : undefined}>{i ? <i aria-hidden="true"> › </i> : null}{c}</span>)}
            {filtered ? <button type="button" className="sb-linkbtn" onClick={() => setFilter(NO_FILTER)}>{BOARD_FILTER_CLEAR}</button> : null}
          </nav>
          {shown ? (
            <>
              <div className="sb-answer-h">
                <h3>{panelTitle(shown)}</h3>
                {panel ? <button type="button" className="sb-close" onClick={() => setPanel(null)} aria-label={BOARD_ANSWER_CLOSE} title={BOARD_ANSWER_CLOSE}>×</button> : null}
              </div>
              <div className="sb-answer-b"><Answer panel={shown} host={host} /></div>
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

