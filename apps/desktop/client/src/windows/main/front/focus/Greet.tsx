// spark abstract-first-home round 1, variant GREET: the assistant greets. Conversation first.
// Centre: a conversation whose opening message is composed LOCALLY (greeting.ts: standing answers,
// the away summary, the first need) with two or three suggested replies, and the ask box as the
// primary control. Side: a composition region (switchboard/region.ts) where reply ops land: `show`
// adds a panel card (the board's own Answer renderers), `focus` / `filter` light the module strip,
// `propose` becomes a suggested step (the board's Proposals, its consent path unchanged). Copy,
// don't move: the chrome, the conversation and the strip stay put; only the region is composed, and
// one Undo puts it back as it was before the last reply. Numbers come from the board model, never
// from reply text.
// Getting started happens AS the conversation (SetupInline.tsx): a proposal to open setup lands as
// the step's card in the transcript, never a swap to the console.
// Watch-only: approval_open, engine_select, pairing_* (PairingDesk), assistant_act via Proposals.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Module } from '@bindings/Module';
import { MODULE_KEYS, type Fate, type PanelSpec, type UiOp, type ValidatedReply } from '../../../../lib/assistant';
import { clockNow } from '../../../../lib/clock';
import { useMutation } from '../../../../lib/hooks';
import { BOARD_ACT, BOARD_CHANGED, BOARD_FATE, BOARD_PANEL_TITLE, BRAND_NAME, type StartStepKey } from '../../../../lib/words';
import { Mark } from '../../../../shared/brand';
import { Countdown, MockBadge } from '../../../../shared/honesty';
import { Glyph, MODULE, MODULES } from '../../../../shared/modules';
import { Btn, layerCount } from '../../../../shared/ui';
import { formatHash } from '../../logic';
import { useAway } from '../../home/useAway';
import { readLastSeen, startOfToday, writeLastSeen } from '../../home/away';
import { useStart } from '../../setup/start';
import { Answer, type PanelHost } from '../../switchboard/Answer';
import { Amount } from '../../switchboard/parts';
import { hasProposals, Proposals, type Acted, type Proposal } from '../../switchboard/Proposals';
import {
  applyLayout, changedAnything, changeLine, closePanel, diffArrangement, EMPTY_ARRANGEMENT, panelKey, place, setPinned, slotsOf, type Arrangement, type ChangeNames,
} from '../../switchboard/region';
import { resolveAction, type BoardFacts, type Consent, type Run } from '../../switchboard/resolve';
import { engineWords } from '../../switchboard/Says';
import { standingAnswers } from '../../switchboard/standing';
import { useBoardAssistant } from '../../switchboard/useBoardAssistant';
import { useBoardModel, type BoardKey } from '../../switchboard/useBoardModel';
import { setHomeView } from '../../switchboard/view';
import { useDeals, useLocked, useNeeds, useRuns, useSettings } from '../../world';
import { compose, type Chip } from './greeting';
import { SetupCard, SetupOverview } from './SetupInline';
import { GREET, STEP_SAY } from './words';
import '../../switchboard/switchboard.css';
import './focus.css';

/** `?away=1`: treat "last seen" as the start of today, so the away summary has something to say.
 *  Written before the conversation mounts, because useAway reads "last seen" once, on mount. */
export function FocusFront() {
  // Away news only for a viewer coming back: one with a stored "last seen" (or `?away=1`). A first
  // look has nothing to come back to, so the greeting does not recount the whole day.
  const [back] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search).get('away') === '1') { writeLastSeen(startOfToday(clockNow())); return true; }
    } catch { /* no address: fall through */ }
    return readLastSeen(clockNow()).stored;
  });
  return <Greet back={back} />;
}

type Entry =
  | { id: number; kind: 'you'; text: string }
  | { id: number; kind: 'reply'; say: string | null; changed: string | null; undone: boolean; cancelled: boolean; held: boolean }
  | { id: number; kind: 'local'; text: string; lines?: readonly string[] }
  | { id: number; kind: 'setup'; step: StartStepKey };

type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, 'id'> : never) : never;

const isSetupTarget = (t: Run): t is { kind: 'approval'; deal_id: null; target: 'credentials' | 'mandate' } =>
  t.kind === 'approval' && t.deal_id === null && (t.target === 'credentials' || t.target === 'mandate');

function Greet({ back }: { back: boolean }) {
  const model = useBoardModel();
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

  // ---- getting started: sticky once the wallet was seen brand-new, until every step is done
  const setupSeen = useRef(false);
  if (model.firstRun) setupSeen.current = true;
  const setup = setupSeen.current;

  const away = useAway({ active: true, enabled: back && model.ready && !setup, needs: model.colCount.needs, deals: deals ?? [] });
  const standing = standingAnswers(model);
  const greeting = compose({ model, standing, away: away.summary, setup, nowMs: clockNow() * 1000 });

  // ---- the conversation
  const [entries, setEntries] = useState<Entry[]>([]);
  const nextId = useRef(0);
  const push = useCallback((...es: NewEntry[]) => {
    setEntries((t) => [...t, ...es.map((e) => ({ ...e, id: ++nextId.current }) as Entry)].slice(-40));
  }, []);
  const patch = useCallback((id: number, f: (e: Entry) => Entry) => setEntries((t) => t.map((e) => (e.id === id ? f(e) : e))), []);

  // ---- the composition region (one value; the ref is what the next reply is applied to)
  const [arr, setArr] = useState<Arrangement>(EMPTY_ARRANGEMENT);
  const arrRef = useRef(arr);
  const commit = useCallback((a: Arrangement) => { arrRef.current = a; setArr(a); }, []);
  const [undoTo, setUndoTo] = useState<{ before: Arrangement; entry: number } | null>(null);
  const ownerMoves = useRef(0);
  const move = useCallback((f: (a: Arrangement) => Arrangement) => {
    const next = f(arrRef.current);
    if (next === arrRef.current) return;
    ownerMoves.current += 1;
    commit(next);
    setUndoTo(null);
  }, [commit]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [acted, setActed] = useState<Acted | null>(null);
  const [stale, setStale] = useState<ReadonlySet<number>>(() => new Set());
  const [opened, setOpened] = useState<ReadonlySet<StartStepKey>>(() => new Set());

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

  /** Apply layout ops as one undo step for an entry; returns the change line. */
  const applyOps = useCallback((ops: readonly UiOp[], entry: number): string | null => {
    const before = arrRef.current;
    const after = applyLayout(before, ops, (id) => model.byId.has(id));
    const change = diffArrangement(before, after);
    commit(after);
    setUndoTo(changedAnything(change) ? { before, entry } : null);
    return changeLine(change, BOARD_CHANGED, names);
  }, [model.byId, commit, names]);

  const undoLayout = useCallback(() => {
    if (!undoTo) return;
    ownerMoves.current += 1;
    commit(undoTo.before);
    setUndoTo(null);
    patch(undoTo.entry, (e) => (e.kind === 'reply' ? { ...e, undone: true } : e));
  }, [undoTo, commit, patch]);

  // ---- the setup steps as the conversation goes
  const scroller = useRef<HTMLDivElement>(null);
  const jump = useCallback((step: StartStepKey) => {
    setEntries((t) => {
      const there = t.find((e) => e.kind === 'setup' && e.step === step);
      if (there) {
        requestAnimationFrame(() => scroller.current?.querySelector(`[data-entry="${there.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
        return t;
      }
      return [...t, { id: ++nextId.current, kind: 'setup', step }];
    });
  }, []);
  const lastNext = useRef<StartStepKey | null | undefined>(undefined);
  useEffect(() => {
    if (!setup) return;
    const now = gs.next;
    const was = lastNext.current;
    if (was === now) return;
    // Nothing read yet: no step to put on screen.
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

  const pick = useCallback((id: string) => {
    const k = model.byId.get(id);
    if (k) move((a) => ({ ...place(a, { kind: k.fate === 'needs' ? 'decision' : 'deal', deal_id: id }), highlight: null }));
  }, [model.byId, move]);
  const filterTo = useCallback((m: Module | null, f: Fate | null) => move((a) => ({ ...a, filter: { module: m, fate: f }, highlight: null })), [move]);
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

  // ---- asking
  const apply = useCallback((reply: ValidatedReply, entry: number, layout: boolean): string | null => {
    const changed = layout ? applyOps(reply.ops, entry) : null;
    const props: Proposal[] = [];
    for (const op of reply.ops) if (op.op === 'propose') props.push({ id: props.length, action: op.action, why: op.why });
    setProposals(props);
    setStale(new Set());
    setActed(null);
    return changed;
  }, [applyOps]);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q) return;
    const movesAtAsk = ownerMoves.current;
    push({ kind: 'you', text: q });
    const id = ++nextId.current;
    setEntries((t) => [...t, { id, kind: 'reply', say: null, changed: null, undone: false, cancelled: false, held: false }]);
    const out = await assistant.ask(q, model.digest);
    if (out.kind === 'cancelled') { patch(id, (e) => (e.kind === 'reply' ? { ...e, cancelled: true } : e)); return; }
    // She moved the region while it answered: her move wins; the reply's layout is not applied.
    const moved = ownerMoves.current !== movesAtAsk;
    const changed = apply(out.reply, id, !moved);
    patch(id, (e) => (e.kind === 'reply' ? { ...e, say: out.reply.say, changed, held: moved && out.reply.ops.some((o) => o.op !== 'propose') } : e));
  }, [assistant, model.digest, apply, push, patch]);

  /** A local answer that also composes the region, as one undoable step. */
  const localAnswer = useCallback((question: string, text: string, ops: UiOp[], lines?: readonly string[]) => {
    push({ kind: 'you', text: question });
    const id = ++nextId.current;
    const changed = ops.length ? applyOps(ops, id) : null;
    setEntries((t) => [...t, lines ? { id, kind: 'local', text, lines } : { id, kind: 'reply', say: text, changed, undone: false, cancelled: false, held: false }]);
  }, [push, applyOps]);

  const onChip = (c: Chip) => {
    if (c.kind === 'ask') { void ask(c.label); return; }
    if (c.kind === 'away') {
      const s = away.summary;
      localAnswer(c.label, s ? `${GREET.away(s.sinceWords)}` : GREET.awayAnswerQuiet, [], s ? (s.lines.length ? s.lines.map((l) => l.text) : [s.lead ?? GREET.awayAnswerQuiet]) : []);
      return;
    }
    if (c.kind === 'everything') { localAnswer(c.label, GREET.everything, [{ op: 'show', panel: { kind: 'book', module: null, fate: null } }, { op: 'filter', module: null, fate: null }]); return; }
    localAnswer(c.label, GREET.steps, [{ op: 'show', panel: { kind: 'setup' } }]);
  };

  // ---- keys: `/` asks, Esc clears the region
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing || layerCount() > 0) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing) { e.preventDefault(); input.current?.focus(); return; }
      if (e.key === 'Escape') {
        if (typing) { t?.blur(); return; }
        ownerMoves.current += 1;
        commit(EMPTY_ARRANGEMENT); setUndoTo(null); setProposals([]); setActed(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [commit]);

  // Keep the latest turn in view.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: entries.length ? 'smooth' : 'auto' });
  }, [entries.length]);

  const [typed, setTyped] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); const q = typed; setTyped(''); void ask(q); };

  // ---- what the strip lights: the reply's light, the filter, the focused panel's module
  const focused = arr.region.find((x) => panelKey(x.spec) === arr.focus)?.spec ?? null;
  const lit = useMemo(() => {
    const s = new Set<Module>();
    const add = (m: Module | null | undefined) => { if (m) s.add(m); };
    add(arr.filter.module);
    add(arr.highlight?.module);
    if (arr.highlight?.deal_id) add(model.byId.get(arr.highlight.deal_id)?.module);
    const fate = arr.highlight?.module ? null : arr.highlight?.fate ?? (arr.filter.module ? null : arr.filter.fate);
    if (fate) for (const m of MODULE_KEYS) if (model.cells[m][fate].count > 0) s.add(m);
    if (focused) {
      if (focused.kind === 'needs' || focused.kind === 'rules' || focused.kind === 'book') add(focused.module);
      if (focused.kind === 'decision' || focused.kind === 'deal') add(model.byId.get(focused.deal_id)?.module);
      if (focused.kind === 'rescue') add('rescue');
    }
    return s;
  }, [arr, focused, model.byId, model.cells]);

  const slots = slotsOf(arr.region).filter((p): p is NonNullable<typeof p> => p !== null);
  const showProps = hasProposals({ proposals, acted });
  const busy = assistant.busy;

  return (
    <div className="ff-app ui-ground" data-front="focus" data-ready={model.ready ? 'true' : 'false'}>
      <header className="ui-toolbar ff-bar">
        <span className="ff-brand"><Mark /><b>{BRAND_NAME}</b></span>
        <MockBadge />
        <span className="ui-spacer" />
        <Btn sm kind="plain" onClick={() => setHomeView('console')} title={GREET.toConsoleTitle}>{GREET.toConsole}</Btn>
      </header>
      <main className="ff-stage" aria-label={GREET.mainLabel}>
        <section className="ff-talk">
          <div className="ff-scroll" ref={scroller}>
            <ol className="ff-transcript" aria-live="polite">
              <li className="ff-turn is-me" data-entry="greeting">
                <Opening g={greeting} gsDone={gs.done} gsTotal={gs.total} host={host} onAllNeeds={() => move((a) => place(a, { kind: 'needs', module: null }))} />
                {greeting.chips.length ? (
                  <div className="ff-chips" role="group" aria-label={GREET.suggested}>
                    {greeting.chips.map((c) => <button key={c.label} type="button" className="ff-chip" disabled={busy} onClick={() => onChip(c)}>{c.label}</button>)}
                  </div>
                ) : null}
              </li>
              {entries.map((e) => (
                <li key={e.id} className={`ff-turn ${e.kind === 'you' ? 'is-you' : 'is-me'}`} data-entry={e.id}>
                  {e.kind === 'you' ? <p className="ff-you">{e.text}</p> : null}
                  {e.kind === 'local' ? (
                    <div className="ff-say">
                      <p>{e.text}</p>
                      {e.lines?.length ? <ul className="ff-lines">{e.lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
                    </div>
                  ) : null}
                  {e.kind === 'reply' ? <Reply e={e} canUndo={undoTo?.entry === e.id} onUndo={undoLayout} /> : null}
                  {e.kind === 'setup' ? (
                    <SetupCard step={e.step} done={gs.steps.find((s) => s.key === e.step)?.state === 'done'}
                      opened={opened.has(e.step)} onOpened={() => setOpened((o) => new Set(o).add(e.step))} />
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
          <div className="ff-askwrap">
          <form className="ff-ask" onSubmit={submit} aria-label={GREET.askLabel}>
            <input ref={input} className="ui-field ff-input" type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={GREET.askPlaceholder}
              aria-label={GREET.askLabel} maxLength={300} autoComplete="off" />
            {busy ? <Btn onClick={assistant.cancel}>{GREET.stop}</Btn> : <Btn kind={setup ? 'default' : 'primary'} type="submit" disabled={!typed.trim()}>{GREET.send}</Btn>}
          </form>
          <p className="ff-answers" data-engine={assistant.engine.id}>{GREET.engine(engineWords(assistant.engine))}</p>
          </div>
        </section>
        <aside className="ff-side" aria-label={GREET.modules}>
          <nav className="ff-mods" aria-label={GREET.modules}>
            {MODULES.map((m) => {
              const n = model.cells[m.key].needs.count;
              return (
                <button key={m.key} type="button" className={`ff-mod${lit.has(m.key) ? ' is-lit' : ''}`} style={{ '--mc': m.cssVar } as React.CSSProperties}
                  title={GREET.moduleTitle(m.name, m.long, n)} aria-label={GREET.moduleTitle(m.name, m.long, n)} aria-pressed={lit.has(m.key)} data-module={m.key}
                  onClick={() => move((a) => ({ ...place(a, { kind: 'book', module: m.key, fate: null }), highlight: null }))}>
                  <Glyph module={m.key} className="ff-glyph" />
                  {n ? <i className="ff-dot" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </nav>
          <div className="ff-region">
            {slots.length === 0 && !showProps ? <p className="ff-hint">{GREET.regionHint}</p> : null}
            {[...slots].reverse().map((p) => {
              const key = panelKey(p.spec);
              const mod = p.spec.kind === 'book' || p.spec.kind === 'needs' || p.spec.kind === 'rules' ? p.spec.module : null;
              return (
                <article key={key} className={`ff-card${arr.focus === key ? ' is-focus' : ''}`} data-panel={key}>
                  <header className="ff-card-h">
                    <b>{BOARD_PANEL_TITLE[p.spec.kind]}{mod ? ` · ${MODULE[mod].name}` : ''}</b>
                    <span className="ui-spacer" />
                    {mod ? <Btn sm onClick={() => run({ kind: 'console', hash: `#m=${mod}` })} title={GREET.goConsole(MODULE[mod].name)}>{GREET.goTo(MODULE[mod].name)}</Btn> : null}
                    <Btn sm kind="plain" aria-pressed={p.pinned} onClick={() => move((a) => setPinned(a, key, !p.pinned))}>{p.pinned ? GREET.unpin : GREET.pin}</Btn>
                    <Btn sm kind="plain" onClick={() => move((a) => closePanel(a, key))} aria-label={GREET.close}>×</Btn>
                  </header>
                  <div className="ff-card-b">
                    {p.spec.kind === 'setup' ? <SetupOverview gs={gs} onJump={jump} /> : <Answer panel={p.spec} host={host} primary={false} />}
                  </div>
                </article>
              );
            })}
            {showProps ? (
              <article className="ff-card is-suggest">
                <header className="ff-card-h"><b>{GREET.suggested}</b></header>
                <div className="ff-card-b">
                  <Proposals proposals={proposals} acted={acted} byId={model.byId} facts={facts} stale={stale} locked={locked} opening={open.pending}
                    act={{ pending: doAct.pending, error: doAct.error }} undoAct={{ pending: undoAct.pending, error: undoAct.error }}
                    perform={(p, c) => void perform(p, c)} undo={(a) => void undo(a)} run={run} gold={false} />
                </div>
              </article>
            ) : null}
          </div>
        </aside>
      </main>
    </div>
  );
}

function Opening({ g, gsDone, gsTotal, host, onAllNeeds }: { g: ReturnType<typeof compose>; gsDone: number; gsTotal: number; host: PanelHost; onAllNeeds: () => void }) {
  return (
    <div className={`ff-say ff-open t-${g.tone}`}>
      <p className="ff-status">{g.status}</p>
      {g.sub ? <p className="ff-sub">{g.sub}{g.mode === 'setup' ? <> <span className="ff-prog">{GREET.progress(gsDone, gsTotal)}</span></> : null}</p> : null}
      {g.away ? (
        <div className="ff-away">
          <p className="ff-kick">{GREET.away(g.away.since)}</p>
          <ul className="ff-lines">
            {g.away.lines.map((l, i) => <li key={i}>{l}</li>)}
            {g.away.more ? <li className="ff-more">{GREET.awayMore(g.away.more)}</li> : null}
          </ul>
        </div>
      ) : null}
      {g.need ? (
        <div className="ff-away">
          <p className="ff-kick">{g.needs > 1 ? GREET.soonest : GREET.theOne}</p>
          <NeedCard k={g.need} n={g.needs} host={host} onAll={onAllNeeds} />
        </div>
      ) : null}
    </div>
  );
}

function NeedCard({ k, n, host, onAll }: { k: BoardKey; n: number; host: PanelHost; onAll: () => void }) {
  const meta = MODULE[k.module];
  return (
    <div className="ff-need" style={{ '--mc': meta.cssVar } as React.CSSProperties} data-need={k.id}>
      <div className="ff-need-h">
        <Glyph module={k.module} className="ff-need-g" />
        <b className="ff-need-t">{k.title}</b>
        <Amount k={k} />
      </div>
      <p className="ff-need-m">
        <span>{meta.name}</span>
        {k.deadline_s !== null ? <span><Countdown deadline={k.deadline_s} /></span> : null}
        {k.why ? <span>{k.why}</span> : null}
      </p>
      {k.on_silence ? <p className="ff-need-s"><b>{GREET.ifNothing}:</b> {k.on_silence}</p> : null}
      <div className="ff-acts">
        {k.review
          ? <Btn kind="gold" locked={host.locked} disabled={host.pending} onClick={() => host.run({ kind: 'approval', deal_id: k.id, target: null })}>{GREET.review}</Btn>
          : <Btn onClick={() => host.run({ kind: 'console', hash: formatHash({ level: 'deal', deal: k.id }) })}>{GREET.open}</Btn>}
        {n > 1 ? <Btn kind="plain" onClick={onAll}>{GREET.allNeeds(n)}</Btn> : null}
      </div>
    </div>
  );
}

function Reply({ e, canUndo, onUndo }: { e: Extract<Entry, { kind: 'reply' }>; canUndo: boolean; onUndo: () => void }) {
  if (e.cancelled) return <p className="ff-say is-quiet">{GREET.stopped}</p>;
  if (e.say === null) return <p className="ff-say is-quiet ff-thinking">{GREET.thinking}</p>;
  return (
    <div className="ff-say">
      <p>{e.say || GREET.nothingSaid}</p>
      {e.held ? <p className="ff-change">{BOARD_CHANGED.held}</p> : null}
      {e.changed && !e.held ? (
        <p className="ff-change">
          {e.undone ? BOARD_CHANGED.undone : e.changed}
          {canUndo && !e.undone ? <button type="button" className="linkbtn ff-undo" onClick={onUndo}>{GREET.undo}</button> : null}
        </p>
      ) : null}
    </div>
  );
}

