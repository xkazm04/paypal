// The conversational home: the board. One page, full window: the instrument strip, the switchboard
// (six modules by four fates, one key per deal) and a chat rail whose answers appear beside the board
// and may light up or dim parts of it. The assistant only PROPOSES: every reply passes validateReply and
// the ops below are applied here, by the host; a proposal is armed only if the host resolves it
// (resolve.ts). Nothing on this page approves, signs, captures, voids or releases anything: the only
// route to a money decision is `approval_open`, and a decision is made in the approval window.
// Esc backs out to the overview and never leaves the page by itself; `/` focuses the chat input.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Module } from '@bindings/Module';
import type { AssistantEngine, Fate, PanelSpec, UiOp, ValidatedReply } from '../../../lib/assistant';
import { useMutation } from '../../../lib/hooks';
import {
  BOARD_ANSWER_CLOSE, BOARD_ANSWER_EMPTY, BOARD_ANSWER_LABEL, BOARD_CRUMB_BOARD, BOARD_CRUMB_LABEL, BOARD_EMPTY_BOARD, BOARD_FATE, BOARD_FILTER_CLEAR, BOARD_MAIN_LABEL, BOARD_PROPOSAL,
  BOARD_SUB, BOARD_TITLE, BOARD_TO_CONSOLE, BOARD_TO_CONSOLE_TITLE, BRAND_NAME,
} from '../../../lib/words';
import { Mark } from '../../../shared/brand';
import { MockBadge, ModeBadge } from '../../../shared/honesty';
import { MODULE } from '../../../shared/modules';
import { Btn, ThemeSwitch } from '../../../shared/ui';
import { useLocked, useSettings } from '../world';
import { Answer, panelTitle, type PanelHost } from './Answer';
import { ChatRail, type Turn } from './ChatRail';
import { InstrumentStrip } from './InstrumentStrip';
import { Matrix, NO_FILTER, type Filter, type Highlight } from './Matrix';
import { resolveAction, type Run } from './resolve';
import { useBoardAssistant, type AssistantDeps } from './useBoardAssistant';
import { useBoardModel } from './useBoardModel';
import { setHomeView } from './view';
import './switchboard.css';

type Proposal = { id: number; action: Extract<UiOp, { op: 'propose' }>['action']; why: string };

const SETUP_PANEL: PanelSpec = { kind: 'setup' };

export function Switchboard({ engine, deps }: { engine?: AssistantEngine; deps?: AssistantDeps } = {}) {
  const model = useBoardModel();
  const settings = useSettings().data;
  const locked = useLocked();
  const open = useMutation('approval_open');
  const assistant = useBoardAssistant(engine, deps);

  const [panel, setPanel] = useState<PanelSpec | null>(null);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnId = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // A brand-new wallet opens on the setup steps; everything else opens on the plain board.
  const shown: PanelSpec | null = panel ?? (model.firstRun ? SETUP_PANEL : null);
  const selId = shown && (shown.kind === 'decision' || shown.kind === 'deal') ? shown.deal_id : null;
  const selKey = selId ? model.byId.get(selId) ?? null : null;

  // ---- the owner's own moves ----
  const overview = useCallback(() => { setPanel(null); setFilter(NO_FILTER); setHighlight(null); setProposals([]); }, []);
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
          {proposals.length ? (
            <ul className="sb-proposals" aria-label={BOARD_PROPOSAL.label}>
              {proposals.map((p) => {
                const r = resolveAction(p.action, model.byId);
                return (
                  <li key={p.id} className={`sb-proposal${r.armed ? '' : ' off'}`} data-proposal={p.action.action}>
                    <span className="sb-why"><b>{BOARD_PROPOSAL.because}:</b> {p.why}</span>
                    <Btn sm disabled={!r.armed || open.pending} onClick={() => { if (r.armed) run(r.run); }} locked={r.armed && r.run.kind === 'approval' && locked}>{r.label}</Btn>
                    <span className="sb-quiet">{r.armed ? r.confirm : `${BOARD_PROPOSAL.disarmed}: ${r.reason}`}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </ChatRail>
    </div>
  );
}

