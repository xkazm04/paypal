// spark abstract-first-home round 1, variant "zoom": semantic zoom. One canvas, three depths
// (depth.ts): the headline (status + the ONE first need, or the current setup step), the three
// standing answers, the six modules. The status sentence and the ask bar are fixed chrome; the
// depth below them is the only thing that changes, by click ("See everything", a standing card, a
// tile, the three dots), by key (+ / - or the arrows, Esc zooms out, / asks) or by chat: a reply's
// ops are interpreted here (landingOf) - a `show` zooms to the depth that holds the panel and lights
// it, a `focus`/`filter` on a module zooms to the modules and lights that tile, a `propose` becomes
// the switchboard's own consent box in the reply area. The reply contract is untouched.
// The model composes only into the reply area and the one slot of each depth; it never types a
// figure (every number on screen is read from the board model).
// Read-only except: approval_open (hand-offs), engine_select / pairing_* (setup, in place), and
// assistant_act through the switchboard's consent path (Proposals: re-resolved, pressed once).
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Module } from '@bindings/Module';
import type { Fate, PanelSpec } from '../../../../lib/assistant';
import { clockNow } from '../../../../lib/clock';
import { useMutation } from '../../../../lib/hooks';
import { BOARD_DECISION, BOARD_DEAL, BOARD_PANEL_TITLE, BOARD_STANDING, BRAND_NAME, APPROVAL_LOCKED_TITLE } from '../../../../lib/words';
import { useCalm } from '../../../../design/motion';
import { Mark } from '../../../../shared/brand';
import { Countdown, MockBadge, WalletNotice } from '../../../../shared/honesty';
import { Glyph, MODULE, MODULES } from '../../../../shared/modules';
import { Btn, layerCount } from '../../../../shared/ui';
import { formatHash } from '../../logic';
import { useAway } from '../../home/useAway';
import { readLastSeen, startOfToday, writeLastSeen, type AwaySummary } from '../../home/away';
import { moneyList } from '../../home/model';
import { useStart } from '../../setup/start';
import { Answer, type PanelHost } from '../../switchboard/Answer';
import { Amount } from '../../switchboard/parts';
import { hasProposals, Proposals, type Acted, type Proposal } from '../../switchboard/Proposals';
import { resolveAction, type BoardFacts, type Consent, type Run } from '../../switchboard/resolve';
import { standingAnswers, type StandingAnswer, type StandingKey } from '../../switchboard/standing';
import { useBoardAssistant } from '../../switchboard/useBoardAssistant';
import { useBoardModel, type BoardKey } from '../../switchboard/useBoardModel';
import { setHomeView } from '../../switchboard/view';
import { useDeals, useLocked, useNeeds, useRuns, useSettings } from '../../world';
import { DEPTHS, deeper, landingOf, needsKeys, shallower, statusLine, tileState, type Depth } from './depth';
import { SetupCard, SetupSteps, useSetupFlow } from './Setup';
import { ZOOM } from './words';
import '../../switchboard/switchboard.css';
import './zoom.css';

/** `?away=1`: this prototype treats "last seen" as the start of today, so the away summary has content.
 *  Without it the summary shows only when this viewer has a stored "last seen" (a first look has no
 *  "while you were away"). Returns whether the away summary is on. */
function primeAway(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('away') === '1') { writeLastSeen(startOfToday(clockNow())); return true; }
    return readLastSeen(clockNow()).stored;
  } catch { return false; }
}

/** Prototype review seams (screenshots): `?zoom_depth=0|1|2` opens at a depth, `?zoom_ask=<q>` asks once on load. */
function param(name: string): string | null {
  try { return new URLSearchParams(window.location.search).get(name); } catch { return null; }
}
const initialDepth = (): Depth => { const d = Number(param('zoom_depth')); return d === 1 || d === 2 ? d : 0; };

/** How long a lit card / tile / panel glows after the assistant (or a click) put it there. */
const LIT_MS = 1800;

type Reply = { say: string; where: string | null; fellBack: boolean; cancelled: boolean };
type Lit = { what: string; n: number } | null;
type Peek = { module: Module | null; panel: PanelSpec | null } | null;

export function ZoomFront() {
  const [awayOn] = useState(primeAway); // runs once, before useAway reads "last seen" below
  const model = useBoardModel();
  const gs = useStart();
  const locked = useLocked();
  const settings = useSettings().data;
  const runs = useRuns().data;
  const needsList = useNeeds();
  const deals = useDeals().data;
  const open = useMutation('approval_open');
  const doAct = useMutation('assistant_act');
  const undoAct = useMutation('assistant_act');
  const assistant = useBoardAssistant();
  const calm = useCalm();
  const setup = gs.show;
  const flow = useSetupFlow(gs);
  const away = useAway({ active: true, enabled: awayOn && model.ready && !setup, needs: model.colCount.needs, deals: deals ?? [] });

  const [depth, setDepthRaw] = useState<Depth>(initialDepth);
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [slot, setSlot] = useState<PanelSpec | null>(null);
  /** The standing card that opened the slot (two cards can open the same panel kind). */
  const [slotFrom, setSlotFrom] = useState<StandingKey | null>(null);
  const [peek, setPeek] = useState<Peek>(null);
  const [lit, setLit] = useState<Lit>(null);
  const litN = useRef(0);
  const [reply, setReply] = useState<Reply | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [acted, setActed] = useState<Acted | null>(null);
  const [stale, setStale] = useState<ReadonlySet<number>>(() => new Set());
  const inflight = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const go = useCallback((d: Depth) => {
    setDepthRaw((cur) => { setDir(d >= cur ? 'in' : 'out'); return d; });
  }, []);
  const light = useCallback((what: string) => { litN.current += 1; setLit({ what, n: litN.current }); }, []);
  useEffect(() => {
    if (!lit) return;
    const t = setTimeout(() => setLit((l) => (l && l.n === lit.n ? null : l)), LIT_MS);
    return () => clearTimeout(t);
  }, [lit]);

  const needs = useMemo(() => needsKeys(model), [model]);
  const first = needs[0] ?? null;
  const status = statusLine(model);
  const standing = standingAnswers(model);

  // ---- the hand-off: approval_open, or the console (exactly as Switchboard.run) ----
  const run = useCallback((r: Run) => {
    if (r.kind === 'approval') { void open.run({ deal_id: r.deal_id, target: r.target }); return; }
    window.location.hash = r.hash === '#' ? '' : r.hash;
    setHomeView('console');
  }, [open]);
  const openModule = useCallback((m: Module) => run({ kind: 'console', hash: formatHash({ level: 'module', module: m }) }), [run]);

  // ---- placing a panel: the depth that holds it, its slot, and the light ----
  const place = useCallback((p: PanelSpec, module: Module | null = null) => {
    const l = landingOf([{ op: 'show', panel: p }], first?.id ?? null, setup);
    const d = l?.depth ?? 1;
    go(d);
    if (d === 0) light('card');
    else if (d === 1) { setSlot(p); setSlotFrom(null); light('slot'); } else { setPeek({ module: l?.module ?? module, panel: p }); light(`tile:${l?.module ?? module ?? ''}`); }
  }, [first, setup, go, light]);
  const pick = useCallback((id: string) => {
    const k = model.byId.get(id);
    if (k) place({ kind: k.fate === 'needs' ? 'decision' : 'deal', deal_id: id });
  }, [model.byId, place]);
  const filterTo = useCallback((m: Module | null, f: Fate | null) => {
    if (m) { go(2); setPeek({ module: m, panel: { kind: 'book', module: m, fate: f } }); light(`tile:${m}`); return; }
    place(f === 'needs' ? { kind: 'needs', module: null } : { kind: 'book', module: null, fate: f });
  }, [go, light, place]);
  const host = useMemo<PanelHost>(() => ({ model, run, pending: open.pending, error: open.error, locked, pick, filterTo }), [model, run, open.pending, open.error, locked, pick, filterTo]);

  // ---- the facts an act depends on (as Switchboard): read from the wallet, never the reply ----
  const facts = useMemo<BoardFacts>(() => ({
    agentsPaused: settings ? !!settings.agents_paused : null,
    agentsWorking: runs ? runs.filter((r) => r.state === 'running' || r.state === 'starting').length : null,
    pausedAgents: settings ? settings.paused_agents ?? null : null,
    lapsable: deals ? new Set(needsList.filter((n) => n.kind === 'gate' && n.actions.includes('let_lapse') && deals.find((d) => d.id === n.deal_id)?.state !== 'MISMATCH').map((n) => n.deal_id)) : null,
  }), [settings, runs, needsList, deals]);
  const factsRef = useRef(facts);
  factsRef.current = facts;
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
      const out = await undoAct.run({ act: a.run.undoWire, consent: { words: `Undo. ${a.run.undoTitle}`, fingerprint: `undo|${a.fingerprint}`.slice(0, 160) } });
      if (out === null) setActed({ ...a, phase: 'undone' });
    } finally { inflight.current = false; }
  }, [undoAct]);

  // ---- chat: ask, then interpret the reply's ops on this canvas ----
  const ask = useCallback(async (q: string) => {
    setReply({ say: '', where: null, fellBack: false, cancelled: false });
    setProposals([]); setActed(null); setStale(new Set());
    const out = await assistant.ask(q, model.digest);
    if (out.kind === 'cancelled') { setReply({ say: '', where: null, fellBack: false, cancelled: true }); return; }
    const r = out.reply;
    const landing = landingOf(r.ops, first?.id ?? null, setup);
    let where: string | null = null;
    if (landing) {
      go(landing.depth);
      where = ZOOM.depthNames[landing.depth];
      if (landing.depth === 0) light('card');
      else if (landing.depth === 1) {
        if (landing.panel) { setSlot(landing.panel); setSlotFrom(landing.panel.kind === 'needs' ? 'needs' : landing.panel.kind === 'safety' ? 'safe' : null); light('slot'); } else light('standing:needs');
      } else {
        setPeek({ module: landing.module, panel: landing.panel ?? (landing.module ? { kind: 'book', module: landing.module, fate: null } : null) });
        light(`tile:${landing.module ?? ''}`);
      }
    }
    const props: Proposal[] = [];
    for (const op of r.ops) if (op.op === 'propose') props.push({ id: props.length, action: op.action, why: op.why });
    setProposals(props);
    setReply({ say: r.say, where, fellBack: out.fellBack, cancelled: false });
  }, [assistant, model.digest, first, setup, go, light]);

  const asked = useRef(false);
  useEffect(() => {
    const q = param('zoom_ask');
    if (!q || asked.current || !model.ready) return;
    asked.current = true;
    void ask(q);
  }, [model.ready, ask]);

  // ---- keys: / asks, + / - (or the arrows) zoom, Esc zooms out (and lets go of the field) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing || layerCount() > 0) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'Escape') {
        if (typing) { t?.blur(); return; }
        e.preventDefault();
        setDepthRaw((cur) => { if (cur === 0) { setReply(null); setProposals([]); return 0; } setDir('out'); return shallower(cur); });
        return;
      }
      if (typing) return;
      if (e.key === '/') { e.preventDefault(); input.current?.focus(); return; }
      if (e.key === '+' || e.key === '=' || e.key === 'ArrowDown') { e.preventDefault(); setDepthRaw((cur) => { setDir('in'); return deeper(cur); }); return; }
      if (e.key === '-' || e.key === '_' || e.key === 'ArrowUp') { e.preventDefault(); setDepthRaw((cur) => { setDir('out'); return shallower(cur); }); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const isLit = (what: string) => lit?.what === what;
  const showProps = hasProposals({ proposals, acted });

  return (
    <div className="fz-app ui-ground" data-front="zoom" data-depth={depth} data-ready={model.ready ? 'true' : 'false'}>
      <header className="fz-bar">
        <span className="fz-brand"><Mark /><b>{BRAND_NAME}</b></span>
        <DepthDots depth={depth} go={go} />
        <span className="fz-bar-r"><MockBadge /></span>
      </header>

      <main className="fz-stage" aria-label={ZOOM.mainLabel}>
        <h1 className={`fz-status t-${setup ? 'gold' : status.tone}`} data-status>
          <i className="fz-led" aria-hidden="true" />
          {setup ? <>{ZOOM.setupTitle} <span className="fz-status-sub">· {ZOOM.setupSteps(gs.total)}</span></> : status.text}
        </h1>

        <section key={depth} className={`fz-depth fz-d${depth} fz-${calm ? 'calm' : dir}`} aria-label={ZOOM.depthNames[depth]}>
          {depth === 0 ? (
            <DepthHeadline setup={setup} gs={gs} flow={flow} locked={locked} first={first} more={Math.max(0, needs.length - 1)}
              away={away.summary} host={host} lit={isLit('card')} onMore={() => go(1)} />
          ) : depth === 1 ? (
            <DepthStanding setup={setup} gs={gs} flow={flow} standing={standing} away={away.summary} slot={slot} slotFrom={slotFrom} host={host} locked={locked}
              litSlot={isLit('slot')} litNeeds={isLit('standing:needs')} onPickStep={() => go(0)}
              onOpen={(p, from) => { setSlot(p); setSlotFrom(from); light('slot'); }} onClose={() => { setSlot(null); setSlotFrom(null); }} onMore={() => go(2)} />
          ) : (
            <DepthModules model={model} peek={peek} host={host} isLit={isLit}
              onTile={(m) => setPeek((p) => (p?.module === m ? null : { module: m, panel: { kind: 'book', module: m, fate: null } }))}
              onClose={() => setPeek(null)} onOpenModule={openModule} />
          )}
        </section>
      </main>

      <footer className="fz-foot">
        {reply ? (
          <section className="fz-reply" aria-live="polite" aria-label={ZOOM.replyKicker}>
            {assistant.busy ? <p className="fz-quiet">{ZOOM.thinking}</p>
              : reply.cancelled ? null
                : <>
                  <p className="fz-say">{reply.say}</p>
                  {reply.where ? <p className="fz-where">{ZOOM.movedTo(reply.where)}</p> : null}
                </>}
            {showProps ? (
              <Proposals proposals={proposals} acted={acted} byId={model.byId} facts={facts} stale={stale} locked={locked} opening={open.pending}
                act={{ pending: doAct.pending, error: doAct.error }} undoAct={{ pending: undoAct.pending, error: undoAct.error }}
                perform={(p, c) => void perform(p, c)} undo={(a) => void undo(a)} run={run} gold={depth !== 0} />
            ) : null}
            <Btn sm kind="plain" className="fz-reply-x" onClick={() => { setReply(null); setProposals([]); setActed(null); }} aria-label={ZOOM.dismiss} title={ZOOM.dismiss}>×</Btn>
          </section>
        ) : null}
        <AskBar busy={assistant.busy} onAsk={(q) => void ask(q)} onCancel={assistant.cancel} inputRef={input} />
      </footer>
    </div>
  );
}

// ---- chrome --------------------------------------------------------------------------------------

function DepthDots({ depth, go }: { depth: Depth; go: (d: Depth) => void }) {
  return (
    <nav className="fz-dots" aria-label={ZOOM.depthLabel} title={ZOOM.keysHint}>
      <span className="fz-dots-row">
        {DEPTHS.map((d) => (
          <button key={d} type="button" className={`fz-dot${d === depth ? ' is-on' : d < depth ? ' is-past' : ''}`} aria-current={d === depth ? 'step' : undefined}
            aria-label={ZOOM.depthGo(ZOOM.depthNames[d])} onClick={() => go(d)} />
        ))}
      </span>
      <span className="fz-dots-name">{ZOOM.depthNames[depth]}</span>
    </nav>
  );
}

function AskBar({ busy, onAsk, onCancel, inputRef }: { busy: boolean; onAsk: (q: string) => void; onCancel: () => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setText('');
    onAsk(q);
  };
  return (
    <form className="fz-ask" onSubmit={submit} autoComplete="off" aria-label={ZOOM.askLabel}
      onFocus={() => setFocused(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}>
      {/* The suggestions appear only once she reaches for the field: the first paint stays abstract. */}
      {focused && !busy ? (
        <div className="fz-chips" role="group">
          {ZOOM.chips.map((c) => <button key={c} type="button" className="ui-filter fz-chip" onClick={() => onAsk(c)}>{c}</button>)}
        </div>
      ) : null}
      <div className="fz-ask-row">
        <input ref={inputRef} className="ui-field fz-ask-input" aria-label={ZOOM.askLabel} placeholder={busy ? ZOOM.thinking : ZOOM.askPlaceholder}
          value={text} onChange={(e) => setText(e.target.value)} maxLength={400} />
        <span className="kbd fz-ask-kbd" aria-hidden="true">/</span>
        {busy ? <Btn onClick={onCancel}>{ZOOM.stop}</Btn> : <Btn type="submit" kind="primary">{ZOOM.ask}</Btn>}
      </div>
    </form>
  );
}

// ---- depth 0: the headline -----------------------------------------------------------------------

function DepthHeadline({ setup, gs, flow, locked, first, more, away, host, lit, onMore }: {
  setup: boolean; gs: ReturnType<typeof useStart>; flow: ReturnType<typeof useSetupFlow>; locked: boolean;
  first: BoardKey | null; more: number; away: AwaySummary | null; host: PanelHost; lit: boolean; onMore: () => void;
}) {
  const moreLine = [away ? awayShort(away) : null, !setup && more ? ZOOM.moreNeeds(more) : null].filter(Boolean).join(' · ');
  return (
    <div className="fz-head">
      <div className={`fz-lit-wrap${lit ? ' is-lit' : ''}`}>
        {setup ? <SetupCard gs={gs} flow={flow} locked={locked} /> : first ? <NeedCard k={first} host={host} /> : <CalmCard />}
      </div>
      <button type="button" className="fz-more" onClick={onMore} data-more>
        {moreLine ? <span className="fz-more-t">{moreLine}</span> : null}
        <span className="fz-more-go">{ZOOM.seeAll} <span aria-hidden="true">⌄</span></span>
      </button>
    </div>
  );
}

/** The away summary in one short clause for the headline: money in / out (from the wallet's record),
 *  else its own lead, and how many things happened. The lines themselves wait one zoom in. */
function awayShort(s: AwaySummary): string {
  const money = [s.inn.length ? ZOOM.awayIn(moneyList(s.inn)) : '', s.out.length ? ZOOM.awayOut(moneyList(s.out)) : ''].filter(Boolean).join(', ');
  const head = money || s.lead || '';
  return `${ZOOM.awayKicker}: ${[head, s.quiet ? '' : ZOOM.awayHappened(s.lines.length)].filter(Boolean).join(' · ')}`;
}

function NeedCard({ k, host }: { k: BoardKey; host: PanelHost }) {
  const meta = MODULE[k.module];
  const run: Run = k.review ? { kind: 'approval', deal_id: k.id, target: null } : { kind: 'console', hash: formatHash({ level: 'deal', deal: k.id }) };
  return (
    <article className="fz-card fz-need" style={{ '--mc': meta.cssVar } as React.CSSProperties} data-need={k.id}>
      <p className="fz-kicker"><Glyph module={k.module} className="fz-glyph" />{meta.name}{k.deadline_s !== null ? <> · <Countdown deadline={k.deadline_s} /> {ZOOM.left}</> : null}</p>
      <h2 className="fz-card-t"><span>{k.title}</span><Amount k={k} /></h2>
      <p className="fz-line">{k.why ?? BOARD_STANDING.question.needs}</p>
      {k.on_silence ? <p className="fz-quiet"><b>{ZOOM.ifNothing}:</b> {k.on_silence}</p> : null}
      <div className="fz-acts">
        <Btn kind={k.review ? 'gold' : 'default'} locked={host.locked} disabled={host.pending} onClick={() => host.run(run)}
          title={host.locked ? APPROVAL_LOCKED_TITLE : k.review ? BOARD_DECISION.reviewTitle : BOARD_DEAL.openTitle} data-handoff={run.kind}>
          {host.pending ? BOARD_DECISION.opening : k.review ? BOARD_DECISION.review : BOARD_DEAL.open}
        </Btn>
      </div>
      {host.error ? <WalletNotice error={host.error} what={BOARD_DECISION.review} /> : null}
    </article>
  );
}

function CalmCard() {
  return (
    <article className="fz-card fz-calm">
      <h2 className="fz-card-t">{ZOOM.calmTitle}</h2>
      <p className="fz-line">{ZOOM.calmLine}</p>
    </article>
  );
}

// ---- depth 1: the three standing answers -----------------------------------------------------------

const STANDING_PANEL: Record<StandingKey, PanelSpec> = {
  safe: { kind: 'safety' },
  needs: { kind: 'needs', module: null },
  nothing: { kind: 'needs', module: null },
};

function DepthStanding({ setup, gs, flow, standing, away, slot, slotFrom, host, locked, litSlot, litNeeds, onPickStep, onOpen, onClose, onMore }: {
  setup: boolean; gs: ReturnType<typeof useStart>; flow: ReturnType<typeof useSetupFlow>; standing: readonly StandingAnswer[]; away: AwaySummary | null;
  slot: PanelSpec | null; slotFrom: StandingKey | null; host: PanelHost; locked: boolean; litSlot: boolean; litNeeds: boolean;
  onPickStep: () => void; onOpen: (p: PanelSpec, from: StandingKey) => void; onClose: () => void; onMore: () => void;
}) {
  return (
    <div className="fz-standing">
      {setup ? (
        <SetupSteps gs={gs} flow={flow} onPick={onPickStep} />
      ) : (
        <ul className="fz-three" aria-label={BOARD_STANDING.label}>
          {standing.map((a) => {
            const p = STANDING_PANEL[a.key];
            const on = !!slot && slotFrom === a.key;
            return (
              <li key={a.key}>
                <button type="button" className={`fz-q t-${a.tone}${on ? ' is-on' : ''}${a.key === 'needs' && litNeeds ? ' is-lit' : ''}`} onClick={() => (on ? onClose() : onOpen(p, a.key))} aria-expanded={on} data-standing={a.key}>
                  <span className="fz-q-k">{BOARD_STANDING.question[a.key]}</span>
                  <span className="fz-q-h"><i className="fz-led" aria-hidden="true" />{a.headline}</span>
                  {a.detail ? <span className="fz-q-d">{a.detail}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className={`fz-under${away && slot ? ' two' : ''}`}>
        {away ? <AwayCard s={away} /> : null}
        {slot ? (
          <section className={`fz-card fz-slot${litSlot ? ' is-lit' : ''}`} aria-label={BOARD_PANEL_TITLE[slot.kind]} data-slot={slot.kind}>
            <header className="fz-slot-h"><span className="fz-kicker">{BOARD_PANEL_TITLE[slot.kind]}</span><Btn sm kind="plain" onClick={onClose} aria-label={ZOOM.closePanel} title={ZOOM.closePanel}>×</Btn></header>
            <div className="fz-slot-b">{slot.kind === 'setup' ? <SetupCard gs={gs} flow={flow} locked={locked} /> : <Answer panel={slot} host={host} />}</div>
          </section>
        ) : null}
      </div>
      <button type="button" className="fz-more" onClick={onMore}><span className="fz-more-go">{ZOOM.modulesKicker} <span aria-hidden="true">⌄</span></span></button>
    </div>
  );
}

function AwayCard({ s }: { s: AwaySummary }) {
  return (
    <section className="fz-card fz-away" aria-label={ZOOM.awayTitle} data-away>
      <p className="fz-kicker">{ZOOM.awayTitle} · {s.sinceWords}</p>
      {s.lead ? <p className="fz-line">{s.lead}</p> : null}
      <ul className="fz-away-l">
        {s.lines.slice(0, 5).map((l) => <li key={l.key} className={`a-${l.tone}`}><i className="fz-led" aria-hidden="true" />{l.text}</li>)}
      </ul>
      {s.lines.length > 5 ? <p className="fz-quiet">{ZOOM.awayMore(s.lines.length - 5)}</p> : null}
      {s.needsLine ? <p className="fz-quiet">{s.needsLine}</p> : null}
    </section>
  );
}

// ---- depth 2: the modules --------------------------------------------------------------------------

function DepthModules({ model, peek, host, isLit, onTile, onClose, onOpenModule }: {
  model: ReturnType<typeof useBoardModel>; peek: Peek; host: PanelHost; isLit: (w: string) => boolean;
  onTile: (m: Module) => void; onClose: () => void; onOpenModule: (m: Module) => void;
}) {
  return (
    <div className="fz-modules">
      <ul className="fz-tiles" aria-label={ZOOM.modulesKicker}>
        {MODULES.map((meta) => {
          const st = tileState(model, meta.key);
          const on = peek?.module === meta.key;
          return (
            <li key={meta.key}>
              <button type="button" className={`fz-tile t-${st.tone}${on ? ' is-on' : ''}${isLit(`tile:${meta.key}`) ? ' is-lit' : ''}`} style={{ '--mc': meta.cssVar } as React.CSSProperties}
                onClick={() => onTile(meta.key)} aria-expanded={on} data-tile={meta.key}>
                <Glyph module={meta.key} className="fz-tile-g" />
                <span className="fz-tile-n"><b>{meta.name}</b><span>{meta.long}</span></span>
                <span className="fz-tile-s">{st.tone === 'gold' ? ZOOM.tileNeeds(st.count ?? 0) : st.tone === 'teal' ? ZOOM.tileMoving(st.count ?? 0) : st.tone === 'dim' ? ZOOM.tileUnknown : ZOOM.tileQuiet}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {peek && (peek.panel || peek.module) ? (
        <section className={`fz-card fz-slot fz-peek${isLit(`tile:${peek.module ?? ''}`) ? ' is-lit' : ''}`} aria-label={peek.module ? MODULE[peek.module].name : ZOOM.wallet} data-peek={peek.module ?? 'wallet'}>
          <header className="fz-slot-h">
            <span className="fz-kicker">{peek.module ? <><Glyph module={peek.module} className="fz-glyph" />{MODULE[peek.module].name}</> : ZOOM.wallet}{peek.panel && peek.panel.kind !== 'book' ? ` · ${BOARD_PANEL_TITLE[peek.panel.kind]}` : ''}</span>
            <span className="fz-slot-acts">
              {peek.module ? <Btn sm onClick={() => onOpenModule(peek.module!)} title={ZOOM.openModuleTitle}>{ZOOM.openModule(MODULE[peek.module].name)} ↗</Btn> : null}
              <Btn sm kind="plain" onClick={onClose} aria-label={ZOOM.closePanel} title={ZOOM.closePanel}>×</Btn>
            </span>
          </header>
          <div className="fz-slot-b">{peek.panel ? <Answer panel={peek.panel} host={host} primary={false} /> : null}</div>
        </section>
      ) : null}
      <p className="fz-console"><button type="button" className="linkbtn" onClick={() => setHomeView('console')} title={ZOOM.toConsoleTitle}>{ZOOM.toConsole} ↗</button></p>
    </div>
  );
}

