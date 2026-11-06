// spark abstract-first-home round 2, fork FOCUS (?home=focus): "the item takes the stage card".
// Baseline = round-1 GREET (the assistant greets: a locally composed status sentence, the ONE first
// need as a card, two suggested replies, the ask box as the primary control). What FOCUS changes:
//   side  the module navigator (Navigator.tsx): six module tabs with a needs badge, and below them the
//         selected module's list, one line per item (front/rows contract, rendered generically).
//         The default tab is the module holding the first need.
//   main  a row click (or Enter on the cursor row) turns the greeting's need-card slot into a FOCUS
//         CARD for that item (FocusCard.tsx): title, the row's facts, the board's own decision/deal
//         renderer and its actions, "Ask about this" chips that pre-fill the ask box. The status
//         sentence stays on top; "Back to today" / Esc restores the need card; the transcript is kept.
//   chat  a reply's focus/filter ops pick the module (and the deal's row) on the side; its show ops
//         land in the slot (a deal as its focus card, any other panel as the board's renderer). One
//         Undo puts the side and the slot back as they were before that reply. Numbers come from the
//         rows and the board model, never from reply text.
// Getting started happens AS the conversation (SetupInline.tsx), never a swap to the console.
// Watch-only: approval_open, engine_select, pairing_* (PairingDesk), assistant_act via Proposals.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Module } from '@bindings/Module';
import { MODULE_KEYS, type PanelSpec, type UiOp, type ValidatedReply } from '../../../../lib/assistant';
import { clockNow, onClockChange } from '../../../../lib/clock';
import { useMutation } from '../../../../lib/hooks';
import { BOARD_ACT, BOARD_CHANGED, BOARD_PANEL_TITLE, BRAND_NAME, type StartStepKey } from '../../../../lib/words';
import { Mark } from '../../../../shared/brand';
import { Countdown, MockBadge } from '../../../../shared/honesty';
import { Glyph, MODULE } from '../../../../shared/modules';
import { Btn, layerCount } from '../../../../shared/ui';
import { formatHash } from '../../logic';
import { useAway } from '../../home/useAway';
import { readLastSeen, startOfToday, writeLastSeen } from '../../home/away';
import { useStart } from '../../setup/start';
import type { PanelHost } from '../../switchboard/Answer';
import { Amount } from '../../switchboard/parts';
import { panelKey } from '../../switchboard/region';
import { hasProposals, Proposals, type Acted, type Proposal } from '../../switchboard/Proposals';
import { resolveAction, type BoardFacts, type Consent, type Run } from '../../switchboard/resolve';
import { engineWords } from '../../switchboard/Says';
import { standingAnswers } from '../../switchboard/standing';
import { useBoardAssistant } from '../../switchboard/useBoardAssistant';
import { useBoardModel, type BoardKey, type BoardModel } from '../../switchboard/useBoardModel';
import { setHomeView } from '../../switchboard/view';
import { useDeals, useLocked, useNeeds, useRuns, useSettings } from '../../world';
import type { ModuleList, ModuleRow } from '../rows/rows';
import { useModuleLists } from '../rows/useModuleLists';
import { PanelCard, RowCard } from './FocusCard';
import { compose, partOfDay, type Chip } from './greeting';
import { Navigator } from './Navigator';
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

/** What the side and the slot show: the tab the owner (or a reply) picked, the list cursor, and the
 *  slot's content (null = the greeting's need card). One value, so a reply's change undoes as one. */
type View = {
  mod: Module | null;
  cursor: string | null;
  slot: { kind: 'row'; module: Module; id: string } | { kind: 'panel'; spec: PanelSpec } | null;
};
const TODAY: View = { mod: null, cursor: null, slot: null };

/** `ff_pick=<module>:<rowId|index>`: prototype-only, opens a row on load (headless screenshots). */
function readPick(): { module: Module; key: string } | null {
  try {
    const v = new URLSearchParams(window.location.search).get('ff_pick');
    if (!v) return null;
    const [m, key = '0'] = v.split(':');
    return (MODULE_KEYS as readonly string[]).includes(m ?? '') ? { module: m as Module, key } : null;
  } catch { return null; }
}

/** The greeting word follows the clock: re-read every minute and on a preview clock jump. */
function usePartOfDay() {
  const [part, setPart] = useState(() => partOfDay(clockNow() * 1000));
  useEffect(() => {
    const read = () => setPart(partOfDay(clockNow() * 1000));
    const t = setInterval(read, 60_000);
    const off = onClockChange(read);
    return () => { clearInterval(t); off(); };
  }, []);
  return part;
}

const rowOfDeal = (lists: Record<Module, ModuleList>, k: BoardKey | undefined): ModuleRow | null =>
  (k ? lists[k.module].rows.find((r) => r.deal_id === k.id) : undefined) ?? null;

/** Apply a reply's layout ops to the view: focus/filter pick the module (and the deal's row), show
 *  lands in the slot; a module's book is the side list itself, so it only picks the tab. */
function applyOpsToView(v: View, ops: readonly UiOp[], model: BoardModel, lists: Record<Module, ModuleList>): View {
  let out = v;
  const pickDeal = (id: string | null) => {
    const k = id ? model.byId.get(id) : undefined;
    if (!k) return;
    out = { ...out, mod: k.module, cursor: rowOfDeal(lists, k)?.id ?? out.cursor };
  };
  for (const op of ops) {
    if (op.op === 'focus') {
      if (op.deal_id) pickDeal(op.deal_id);
      else if (op.module) out = { ...out, mod: op.module, cursor: null };
    } else if (op.op === 'filter') {
      if (op.module) out = { ...out, mod: op.module, cursor: null };
    } else if (op.op === 'show') {
      const p = op.panel;
      if (p.kind === 'decision' || p.kind === 'deal') {
        const k = model.byId.get(p.deal_id);
        if (!k) continue;
        const row = rowOfDeal(lists, k);
        out = { ...out, mod: k.module, cursor: row?.id ?? out.cursor, slot: row ? { kind: 'row', module: k.module, id: row.id } : { kind: 'panel', spec: p } };
      } else if (p.kind === 'book' && p.module) {
        out = { ...out, mod: p.module, cursor: null };
      } else {
        const m = 'module' in p ? p.module : p.kind === 'rescue' ? 'rescue' : null;
        out = { ...out, mod: m ?? out.mod, slot: { kind: 'panel', spec: p } };
      }
    }
  }
  return out;
}

const sameSlot = (a: View['slot'], b: View['slot']): boolean =>
  a === b || (!!a && !!b && (a.kind === 'row' && b.kind === 'row' ? a.id === b.id && a.module === b.module : a.kind === 'panel' && b.kind === 'panel' ? panelKey(a.spec) === panelKey(b.spec) : false));

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
  usePartOfDay();

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

  // ---- the side and the slot (one value; the ref is what the next reply is applied to)
  const [view, setViewState] = useState<View>(TODAY);
  const viewRef = useRef(view);
  const commit = useCallback((v: View) => { viewRef.current = v; setViewState(v); }, []);
  const [undoTo, setUndoTo] = useState<{ before: View; entry: number } | null>(null);
  const ownerMoves = useRef(0);
  const move = useCallback((f: (v: View) => View) => {
    const next = f(viewRef.current);
    if (next === viewRef.current) return;
    ownerMoves.current += 1;
    commit(next);
    setUndoTo(null);
  }, [commit]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [propsAt, setPropsAt] = useState<number | null>(null);
  const [acted, setActed] = useState<Acted | null>(null);
  const [stale, setStale] = useState<ReadonlySet<number>>(() => new Set());
  const [opened, setOpened] = useState<ReadonlySet<StartStepKey>>(() => new Set());

  // The tab: what she (or a reply) picked, else the module holding the first need, else the first
  // module with anything in it.
  const needRow = rowOfDeal(lists, greeting.need ?? undefined);
  const mod: Module = view.mod ?? greeting.need?.module ?? MODULE_KEYS.find((m) => lists[m].rows.length > 0) ?? 'tables';
  const cursor = view.cursor ?? (needRow && needRow.module === mod ? needRow.id : null);
  const needsBy = useMemo(() => Object.fromEntries(MODULE_KEYS.map((m) => [m, model.cells[m].needs.count])) as Record<Module, number>, [model.cells]);
  const slotRow = view.slot?.kind === 'row' ? lists[view.slot.module].rows.find((r) => r.id === (view.slot as { id: string }).id) ?? null : null;

  /** Apply layout ops as one undo step for an entry; returns the change line. */
  const applyOps = useCallback((ops: readonly UiOp[], entry: number): string | null => {
    const before = viewRef.current;
    const after = applyOpsToView(before, ops, model, lists);
    commit(after);
    const changedSlot = !sameSlot(before.slot, after.slot);
    const changedMod = before.mod !== after.mod || before.cursor !== after.cursor;
    setUndoTo(changedSlot || changedMod ? { before, entry } : null);
    if (changedSlot && after.slot) {
      const what = after.slot.kind === 'row'
        ? lists[after.slot.module].rows.find((r) => r.id === (after.slot as { id: string }).id)?.title ?? MODULE[after.slot.module].name
        : BOARD_PANEL_TITLE[after.slot.spec.kind];
      return GREET.replyShowed(what);
    }
    return changedMod && after.mod ? GREET.replyPicked(MODULE[after.mod].name) : null;
  }, [model, lists, commit]);

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

  // ---- opening an item: the row takes the slot, and the side follows
  const openRow = useCallback((r: ModuleRow) => move(() => ({ mod: r.module, cursor: r.id, slot: { kind: 'row', module: r.module, id: r.id } })), [move]);
  const backToToday = useCallback(() => move((v) => (v.slot ? { ...v, slot: null } : v)), [move]);
  const pick = useCallback((id: string) => {
    const k = model.byId.get(id);
    if (!k) return;
    const row = rowOfDeal(lists, k);
    if (row) openRow(row);
    else move((v) => ({ ...v, mod: k.module, slot: { kind: 'panel', spec: k.fate === 'needs' ? { kind: 'decision', deal_id: id } : { kind: 'deal', deal_id: id } } }));
  }, [model.byId, lists, openRow, move]);
  const filterTo = useCallback((m: Module | null) => { if (m) move((v) => ({ ...v, mod: m, cursor: null })); }, [move]);
  const host = useMemo<PanelHost>(() => ({ model, run, pending: open.pending, error: open.error, locked, pick, filterTo }), [model, run, open.pending, open.error, locked, pick, filterTo]);

  // `ff_pick=<module>:<rowId|index>` (prototype only): open that row once its list has loaded.
  const pickFlag = useRef(readPick());
  useEffect(() => {
    const p = pickFlag.current;
    if (!p) return;
    const rows = lists[p.module].rows;
    if (!rows.length) return;
    const r = rows.find((x) => x.id === p.key) ?? (/^\d+$/.test(p.key) ? rows[Number(p.key)] : undefined);
    pickFlag.current = null;
    if (r) openRow(r);
  }, [lists, openRow]);

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
    setPropsAt(props.length ? entry : null);
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
    // She moved the side or the slot while it answered: her move wins; the reply's layout is not applied.
    const moved = ownerMoves.current !== movesAtAsk;
    const changed = apply(out.reply, id, !moved);
    patch(id, (e) => (e.kind === 'reply' ? { ...e, say: out.reply.say, changed, held: moved && out.reply.ops.some((o) => o.op !== 'propose') } : e));
  }, [assistant, model.digest, apply, push, patch]);

  /** A local answer that also composes the side / slot, as one undoable step. */
  const localAnswer = useCallback((question: string, text: string, ops: UiOp[], lines?: readonly string[]) => {
    push({ kind: 'you', text: question });
    const id = ++nextId.current;
    const changed = ops.length ? applyOps(ops, id) : null;
    setEntries((t) => [...t, lines ? { id, kind: 'local', text, lines } : { id, kind: 'reply', say: text, changed, undone: false, cancelled: false, held: false }]);
  }, [push, applyOps]);

  const awayAll = () => {
    const s = away.summary;
    localAnswer(GREET.chipAway, s ? `${GREET.away(s.sinceWords)}` : GREET.awayAnswerQuiet, [], s ? (s.lines.length ? s.lines.map((l) => l.text) : [s.lead ?? GREET.awayAnswerQuiet]) : []);
  };
  const onChip = (c: Chip) => {
    if (c.kind === 'ask') { void ask(c.label); return; }
    if (c.kind === 'away') { awayAll(); return; }
    if (c.kind === 'everything') { localAnswer(c.label, GREET.everything, [{ op: 'show', panel: { kind: 'book', module: null, fate: null } }]); return; }
    localAnswer(c.label, GREET.steps, [{ op: 'show', panel: { kind: 'setup' } }]);
  };

  // ---- keys: `/` asks, Esc goes back to today (and drops the suggestions)
  const input = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  const prefill = useCallback((q: string) => {
    setTyped(q);
    requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(q.length, q.length); } });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing || layerCount() > 0) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing) { e.preventDefault(); input.current?.focus(); return; }
      if (e.key === 'Escape') {
        if (typing) { t?.blur(); return; }
        if (viewRef.current.slot) { ownerMoves.current += 1; commit({ ...viewRef.current, slot: null }); setUndoTo(null); return; }
        setProposals([]); setPropsAt(null); setActed(null);
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

  const submit = (e: FormEvent) => { e.preventDefault(); const q = typed; setTyped(''); void ask(q); };

  const showProps = hasProposals({ proposals, acted });
  const busy = assistant.busy;

  // The slot: the focus card when an item (or an answer) is open, else the greeting's need card.
  const slot = view.slot?.kind === 'row' && slotRow
    ? <RowCard row={slotRow} columns={lists[slotRow.module].columns} deal={slotRow.deal_id ? model.byId.get(slotRow.deal_id) ?? null : null} host={host} onBack={backToToday} onAsk={prefill} />
    : view.slot?.kind === 'panel'
      ? <PanelCard spec={view.slot.spec} host={host} onBack={backToToday}>{view.slot.spec.kind === 'setup' ? <SetupOverview gs={gs} onJump={jump} /> : null}</PanelCard>
      : null;

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
          <div className={`ff-head${slot ? ' has-focus' : ''}`} data-entry="greeting">
            <Opening g={greeting} gsDone={gs.done} gsTotal={gs.total} host={host} slot={slot} onAwayAll={awayAll}
              onAllNeeds={() => move((v) => ({ ...v, slot: { kind: 'panel', spec: { kind: 'needs', module: null } } }))} />
            {greeting.chips.length && !slot ? (
              <div className="ff-chips" role="group" aria-label={GREET.suggested}>
                {greeting.chips.map((c) => <button key={c.label} type="button" className="ff-chip" disabled={busy} onClick={() => onChip(c)}>{c.label}</button>)}
              </div>
            ) : null}
          </div>
          <div className="ff-scroll" ref={scroller}>
            <ol className="ff-transcript" aria-live="polite">
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
                  {showProps && propsAt === e.id ? (
                    <article className="ff-card is-suggest">
                      <header className="ff-card-h"><b>{GREET.suggested}</b></header>
                      <div className="ff-card-b">
                        <Proposals proposals={proposals} acted={acted} byId={model.byId} facts={facts} stale={stale} locked={locked} opening={open.pending}
                          act={{ pending: doAct.pending, error: doAct.error }} undoAct={{ pending: undoAct.pending, error: undoAct.error }}
                          perform={(p, c) => void perform(p, c)} undo={(a) => void undo(a)} run={run} gold={false} />
                      </div>
                    </article>
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
          <Navigator lists={lists} needs={needsBy} mod={mod} onMod={(m) => move((v) => (v.mod === m ? v : { ...v, mod: m, cursor: null }))}
            cursor={cursor} onCursor={(id) => move((v) => (v.cursor === id && v.mod === mod ? v : { ...v, mod, cursor: id }))}
            open={view.slot?.kind === 'row' ? view.slot.id : null} need={needRow?.id ?? null} onOpen={openRow} />
        </aside>
      </main>
    </div>
  );
}

function Opening({ g, gsDone, gsTotal, host, slot, onAllNeeds, onAwayAll }: {
  g: ReturnType<typeof compose>; gsDone: number; gsTotal: number; host: PanelHost; slot: React.ReactNode; onAllNeeds: () => void; onAwayAll: () => void;
}) {
  return (
    <div className={`ff-say ff-open t-${g.tone}`}>
      <p className="ff-status">{g.status}</p>
      {g.sub && !slot ? <p className="ff-sub">{g.sub}{g.mode === 'setup' ? <> <span className="ff-prog">{GREET.progress(gsDone, gsTotal)}</span></> : null}</p> : null}
      {g.away && !slot ? (
        <p className="ff-away" title={g.away.line}>
          <span className="ff-kick">{GREET.away(g.away.since)}</span>
          <span className="ff-away-l">{g.away.line}</span>
          {g.away.more ? <button type="button" className="linkbtn ff-more" onClick={onAwayAll} title={GREET.awayMoreTitle}>{GREET.awayMore(g.away.more)}</button> : null}
        </p>
      ) : null}
      {slot ?? (g.need ? (
        <div className="ff-needwrap">
          <p className="ff-kick">{g.needs > 1 ? GREET.soonest : GREET.theOne}</p>
          <NeedCard k={g.need} n={g.needs} host={host} onAll={onAllNeeds} />
        </div>
      ) : null)}
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

