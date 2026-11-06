// spark abstract-first-home round 1, variant "brief": a short morning brief.
// First paint: the brand, ONE status headline, one to three ranked items (rank.ts holds the rule:
// deadline, then money at risk, then news), the quiet module dock and the ask line. Every item opens
// INLINE to its detail and actions (the board's own panel renderers, switchboard/Answer.tsx); nothing
// navigates for the common case. The ask line goes through useBoardAssistant; a reply's `say` becomes
// the top item (marked as the answer), its `show` ops open the matching item or insert a detail item
// under the answer, its `focus`/`filter` light a dock glyph, its handoff proposals become buttons.
// Fixed chrome (brand, headline, dock, ask) never moves; replies compose only into the item list.
// Figures come from the board model, never from reply text. Nothing here moves money: the only
// mutations are approval_open, engine_select and the pairing desk's own commands.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import { MODULE_KEYS, type ActionRef, type Fate, type PanelSpec, type UiOp, type ValidatedReply } from '../../../../lib/assistant';
import { clockNow } from '../../../../lib/clock';
import { clockLabel } from '../../../../lib/format';
import { useMutation } from '../../../../lib/hooks';
import { BOARD_PANEL_TITLE, BRAND_NAME } from '../../../../lib/words';
import { Mark } from '../../../../shared/brand';
import { Countdown, MockBadge } from '../../../../shared/honesty';
import { Glyph, MODULE } from '../../../../shared/modules';
import { Btn, layerCount } from '../../../../shared/ui';
import { startOfToday, writeLastSeen, type AwayTone } from '../../home/away';
import { useAway } from '../../home/useAway';
import { formatHash } from '../../logic';
import { Answer, type PanelHost } from '../../switchboard/Answer';
import { Amount } from '../../switchboard/parts';
import type { Run } from '../../switchboard/resolve';
import { standingAnswers } from '../../switchboard/standing';
import { useBoardAssistant } from '../../switchboard/useBoardAssistant';
import { useBoardModel, type BoardModel } from '../../switchboard/useBoardModel';
import { useDeals, useLocked } from '../../world';
import { Dock, toConsole } from './Dock';
import { needsByUrgency, rankBrief, type BriefItem } from './rank';
import { RealDetail, TryDetail, useBriefSetup } from './Setup';
import { FB } from './words';
import '../../switchboard/switchboard.css';
import './brief.css';

/** `?away=1`: treat "last seen" as the start of today, so the away summary has something to tell. */
function forceAwayFromAddress(): void {
  try {
    if (new URLSearchParams(window.location.search).get('away') === '1') writeLastSeen(startOfToday(clockNow()));
  } catch { /* no address or storage: the real last-seen stands */ }
}

/** Prototype review hooks (headless screenshots cannot click): `fb_open=need,away` opens items,
 *  `fb_peek=<module>` opens a dock peek, `fb_ask=<question>` asks once the board is ready. */
function previewParam(name: string): string | null {
  try { return new URLSearchParams(window.location.search).get(name); } catch { return null; }
}
const sentence = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

type Said = { question: string; reply: ValidatedReply | null; fellBack: boolean };
type Inserted = { key: string; spec: PanelSpec };
const panelKey = (p: PanelSpec): string => JSON.stringify(p);
const INSERTED_MAX = 3;

export function BriefFront() {
  // Must run before useAway reads "last seen" (its useState initialiser, below).
  useState(forceAwayFromAddress);
  const model = useBoardModel();
  const setup = useBriefSetup();
  const deals = useDeals().data;
  const locked = useLocked();
  const open = useMutation('approval_open');
  const assistant = useBoardAssistant();
  const away = useAway({ active: true, enabled: model.ready && !setup.show, needs: model.colCount.needs, deals: deals ?? [] });
  const standing = standingAnswers(model);

  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set(previewParam('fb_open')?.split(',') ?? []));
  const [inserted, setInserted] = useState<Inserted[]>([]);
  const [said, setSaid] = useState<Said | null>(null);
  const [lit, setLit] = useState<Module | null>(null);
  const [peek, setPeek] = useState<Module | null>(() => MODULE_KEYS.find((m) => m === previewParam('fb_peek')) ?? null);
  const input = useRef<HTMLInputElement>(null);

  const items = useMemo(
    () => rankBrief(model, standing, away.summary, setup.show ? { tryDone: setup.tryDone, realDone: setup.realDone } : null),
    // standing is derived from model
    [model, away.summary, setup.show, setup.tryDone, setup.realDone],
  );
  const needItem = items.find((i): i is Extract<BriefItem, { kind: 'need' }> => i.kind === 'need') ?? null;

  const toggle = useCallback((id: string) => setOpened((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const expand = useCallback((id: string) => setOpened((s) => (s.has(id) ? s : new Set(s).add(id))), []);
  const insert = useCallback((spec: PanelSpec) => {
    const key = panelKey(spec);
    setInserted((xs) => [{ key, spec }, ...xs.filter((x) => x.key !== key)].slice(0, INSERTED_MAX));
    expand(key);
  }, [expand]);

  /** A panel the owner or a reply asks for: open the brief item that already is it, else insert it. */
  const showPanel = useCallback((spec: PanelSpec) => {
    if ((spec.kind === 'decision' || spec.kind === 'deal') && needItem && spec.deal_id === needItem.key.id) { expand('need'); return; }
    if (spec.kind === 'setup' && setup.show) { expand(setup.tryDone ? 'real' : 'try'); return; }
    if (spec.kind === 'safety' && items.some((i) => i.kind === 'risk' && i.broken)) { expand('risk'); return; }
    // The "if you do nothing" item IS the all-needs panel (every need with its silence line).
    if (spec.kind === 'needs' && spec.module === null && items.some((i) => i.kind === 'risk' && !i.broken)) { expand('risk'); return; }
    insert(spec);
  }, [needItem, setup.show, setup.tryDone, items, expand, insert]);

  const run = useCallback((r: Run) => {
    if (r.kind === 'approval') { void open.run({ deal_id: r.deal_id, target: r.target }); return; }
    toConsole(r.hash);
  }, [open]);
  const pick = useCallback((id: string) => {
    const k = model.byId.get(id);
    if (k) showPanel({ kind: k.fate === 'needs' ? 'decision' : 'deal', deal_id: id });
  }, [model.byId, showPanel]);
  const filterTo = useCallback((m: Module | null, _f: Fate | null) => { setLit(m); setPeek(m); }, []);
  const host = useMemo<PanelHost>(() => ({ model, run, pending: open.pending, error: open.error, locked, pick, filterTo }), [model, run, open.pending, open.error, locked, pick, filterTo]);

  // ---- a reply's ops, interpreted in this layout (the contract is unchanged) ----
  const applyOps = useCallback((ops: readonly UiOp[]) => {
    let light: Module | null = null;
    for (const op of ops) {
      if (op.op === 'show') showPanel(op.panel);
      else if (op.op === 'focus') {
        const ofDeal = op.deal_id ? model.byId.get(op.deal_id)?.module : undefined;
        light = op.module ?? ofDeal ?? light;
      }
      else if (op.op === 'filter') light = op.module ?? light;
    }
    setLit(light);
  }, [showPanel, model.byId]);

  const ask = useCallback(async (question: string) => {
    setSaid({ question, reply: null, fellBack: false });
    const out = await assistant.ask(question, model.digest);
    if (out.kind === 'cancelled') { setSaid(null); return; }
    setSaid({ question, reply: out.reply, fellBack: out.fellBack });
    applyOps(out.reply.ops);
  }, [assistant, model.digest, applyOps]);

  const asked = useRef(false);
  useEffect(() => {
    const q = previewParam('fb_ask');
    if (!q || asked.current || !model.ready) return;
    asked.current = true;
    void ask(q);
  }, [model.ready, ask]);

  // `/` focuses the ask line; Esc folds every item and drops the answer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing || layerCount() > 0) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing) { e.preventDefault(); input.current?.focus(); }
      if (e.key === 'Escape') { if (typing) { t?.blur(); return; } setOpened(new Set()); setSaid(null); setInserted([]); setLit(null); setPeek(null); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="fb-app ui-ground" data-front="brief" data-testid="front-brief" data-ready={model.ready ? 'true' : 'false'}>
      <header className="fb-top">
        <span className="fb-brand"><Mark /><b>{BRAND_NAME}</b></span>
        <MockBadge />
      </header>
      <main className="fb-col" aria-label={FB.mainLabel}>
        <h1 className="fb-headline" data-headline><Headline model={model} setupShown={setup.show} standingSafe={standing[0].tone === 'ok'} /></h1>
        <ol className="fb-items" aria-live="polite">
          {said ? <AnswerItem said={said} busy={assistant.busy} onCancel={assistant.cancel} onDismiss={() => setSaid(null)} run={run} model={model} /> : null}
          {inserted.map((x) => (
            <Card key={x.key} id={x.key} kicker={FB.panel.kicker} title={BOARD_PANEL_TITLE[x.spec.kind]} open={opened.has(x.key)} onToggle={() => toggle(x.key)} tone="detail"
              onRemove={() => setInserted((xs) => xs.filter((y) => y.key !== x.key))}>
              <div className="fb-panel"><Answer panel={x.spec} host={host} primary={false} /></div>
            </Card>
          ))}
          {items.map((it, i) => <ItemCard key={it.id} item={it} rank={i} open={opened.has(it.id)} onToggle={() => toggle(it.id)} host={host} onSeeAll={() => insert({ kind: 'needs', module: null })} onDismissAway={away.dismiss} />)}
        </ol>
        <AskLine busy={assistant.busy} onAsk={(q) => void ask(q)} onCancel={assistant.cancel} inputRef={input} />
      </main>
      <footer className="fb-foot">
        <Dock model={model} peek={peek} lit={lit} onPeek={setPeek} />
      </footer>
    </div>
  );
}

// ---- the headline ------------------------------------------------------------------------------------

function Headline({ model, setupShown, standingSafe }: { model: BoardModel; setupShown: boolean; standingSafe: boolean }) {
  if (setupShown) return <>{FB.headline.firstRun} <span className="fb-soft">{FB.headline.firstRunTail}</span></>;
  if (!model.ready) return <span className="fb-soft">{FB.reading}</span>;
  if (model.instruments.records === 'broken') return <>{FB.headline.broken}</>;
  const needs = needsByUrgency(model);
  const now = Math.floor(model.digest.now_ms / 1000);
  const first = needs[0];
  const safe = standingSafe ? <span className="fb-soft"> {FB.headline.safe}</span> : null;
  if (first) return <>{FB.headline.needs(needs.length, first.deadline_s !== null ? clockLabel(first.deadline_s, now) : null)}{safe}</>;
  return <>{FB.headline.calm}{safe}</>;
}

// ---- one item: a row that opens inline -----------------------------------------------------------------

function Card({ id, kicker, title, gist, meta, open, onToggle, children, tone, rank, onRemove, glyph }: {
  id: string; kicker: ReactNode; title: ReactNode; gist?: ReactNode; meta?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode;
  tone: 'need' | 'risk' | 'news' | 'setup' | 'done' | 'detail'; rank?: number; onRemove?: () => void; glyph?: Module;
}) {
  const bodyId = `fb-body-${id.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <li className={`fb-item t-${tone}${open ? ' open' : ''}`} data-item={id}>
      <button type="button" className="fb-item-h" aria-expanded={open} aria-controls={bodyId} onClick={onToggle} title={open ? FB.close : FB.open}>
        <span className="fb-rank num" aria-hidden="true">{rank !== undefined ? FB.rankLabel(rank) : glyph ? '' : '·'}{glyph ? <Glyph module={glyph} className="fb-rank-ic" /> : null}</span>
        <span className="fb-item-txt">
          <span className="fb-kicker">{kicker}</span>
          <span className="fb-title">{title}</span>
          {gist ? <span className="fb-gist">{gist}</span> : null}
        </span>
        {meta ? <span className="fb-meta">{meta}</span> : null}
        <svg className="fb-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {onRemove ? <button type="button" className="fb-x" aria-label={FB.panel.remove} title={FB.panel.remove} onClick={onRemove}>×</button> : null}
      {open ? <div className="fb-item-b" id={bodyId}>{children}</div> : null}
    </li>
  );
}

const TONE_OF_AWAY: Record<AwayTone, string> = { out: 'coral', in: 'teal', held: 'gold', calm: 'dim', stopped: 'coral', check: 'gold' };

function ItemCard({ item, rank, open, onToggle, host, onSeeAll, onDismissAway }: {
  item: BriefItem; rank: number; open: boolean; onToggle: () => void; host: PanelHost; onSeeAll: () => void; onDismissAway: () => void;
}) {
  switch (item.kind) {
    case 'need': {
      const k = item.key;
      return (
        <Card id="need" rank={rank} tone="need" kicker={<>{FB.need.kicker} · {MODULE[k.module].name}</>} title={k.title}
          gist={[k.why, item.more ? FB.need.more(item.more) : null].filter(Boolean).join(' · ')}
          meta={<><Amount k={k} />{k.deadline_s !== null ? <Countdown deadline={k.deadline_s} className="fb-clock" /> : null}</>}
          open={open} onToggle={onToggle}>
          <div className="fb-panel"><Answer panel={{ kind: 'decision', deal_id: k.id }} host={host} primary /></div>
          {item.more ? <div className="fb-acts"><Btn sm onClick={onSeeAll}>{FB.need.seeAll(item.more + 1)}</Btn></div> : null}
        </Card>
      );
    }
    case 'risk':
      return (
        <Card id="risk" rank={rank} tone="risk" kicker={item.broken ? FB.risk.brokenKicker : FB.risk.kicker} title={item.broken ? item.answer.headline : sentence(item.answer.detail ?? item.answer.headline)} gist={item.broken ? item.answer.detail : item.answer.headline} open={open} onToggle={onToggle}>
          <div className="fb-panel"><Answer panel={item.broken ? { kind: 'safety' } : { kind: 'needs', module: null }} host={host} primary={false} /></div>
        </Card>
      );
    case 'away': {
      const s = item.summary;
      // The title is the lead ("No money moved.") or the first line; the gist is the next line and a count.
      const head = s.lead ?? s.lines[0]?.text ?? s.text;
      const rest = s.lines.slice(s.lead ? 0 : 1);
      const gist = rest.length ? `${rest[0]!.text}${rest.length > 1 ? ` · ${FB.away.more(rest.length - 1)}` : ''}` : null;
      return (
        <Card id="away" rank={rank} tone="news" kicker={`${FB.away.kicker} · ${s.sinceWords}`} title={head} gist={gist}
          open={open} onToggle={onToggle}>
          <ul className="fb-away">
            {s.lines.map((l) => <li key={l.key} className={`tone-${TONE_OF_AWAY[l.tone]}`}><i className="fb-led" aria-hidden="true" />{l.text}</li>)}
          </ul>
          {s.partial ? <p className="fb-quiet">{FB.away.partial}</p> : null}
          <div className="fb-acts"><Btn sm onClick={onDismissAway}>{FB.away.gotIt}</Btn></div>
        </Card>
      );
    }
    case 'try':
      return (
        <Card id="try" rank={rank} tone={item.done ? 'done' : 'setup'} kicker={FB.try.kicker} title={FB.try.title} gist={item.done ? FB.try.doneGist : FB.try.gist} open={open} onToggle={onToggle}>
          <TryDetail />
        </Card>
      );
    case 'real':
      return (
        <Card id="real" rank={rank} tone={item.done ? 'done' : 'setup'} kicker={FB.real.kicker} title={FB.real.title} gist={item.done ? FB.real.doneGist : FB.real.gist} open={open} onToggle={onToggle}>
          <RealDetail />
        </Card>
      );
  }
}

// ---- the answer: the top item while there is one ---------------------------------------------------------

/** A handoff proposal as a button; an act (pause, let lapse) is left to the board's consent box. */
function proposalRun(a: ActionRef, model: BoardModel): Run | null {
  if (a.action === 'open_decision') return model.byId.has(a.deal_id) ? { kind: 'approval', deal_id: a.deal_id, target: null } : null;
  if (a.action === 'open_setup') return { kind: 'approval', deal_id: null, target: a.target };
  if (a.action === 'open_console') return { kind: 'console', hash: a.hash || formatHash({ level: 'home' }) };
  return null;
}

function AnswerItem({ said, busy, onCancel, onDismiss, run, model }: { said: Said; busy: boolean; onCancel: () => void; onDismiss: () => void; run: (r: Run) => void; model: BoardModel }) {
  const r = said.reply;
  const props = r ? r.ops.filter((o): o is Extract<UiOp, { op: 'propose' }> => o.op === 'propose') : [];
  const shows = r ? r.ops.filter((o) => o.op === 'show').length : 0;
  return (
    <li className="fb-item t-answer open" data-item="answer">
      <div className="fb-item-h static">
        <span className="fb-rank" aria-hidden="true">
          <svg viewBox="0 0 16 16" className="fb-rank-ic"><path d="M3 3h10v7H7l-3 3v-3H3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
        </span>
        <span className="fb-item-txt">
          <span className="fb-kicker">{FB.answer.kicker} · “{said.question}”</span>
          {!r ? <span className="fb-title fb-soft">{FB.answer.thinking}</span> : <span className="fb-title fb-say">{r.say || FB.answer.nothing}</span>}
          {r && shows ? <span className="fb-gist">{FB.answer.shown}</span> : null}
        </span>
        {busy ? <Btn sm onClick={onCancel}>{FB.ask.stop}</Btn> : <button type="button" className="fb-x inline" aria-label={FB.answer.dismiss} title={FB.answer.dismiss} onClick={onDismiss}>×</button>}
      </div>
      {r && (props.length || r.dropped.count || said.fellBack) ? (
        <div className="fb-item-b">
          {props.map((p, i) => {
            const go = proposalRun(p.action, model);
            return (
              <div key={i} className="fb-prop">
                <span>{p.why}</span>
                {go ? <Btn sm onClick={() => run(go)}>{BOARD_PANEL_TITLE[p.action.action === 'open_decision' ? 'decision' : p.action.action === 'open_setup' ? 'setup' : 'book']}</Btn> : <span className="fb-quiet">{FB.answer.actNote}</span>}
              </div>
            );
          })}
          {r.dropped.count ? <p className="fb-quiet">{FB.answer.dropped(r.dropped.count)}</p> : null}
          {said.fellBack ? <p className="fb-quiet">{FB.answer.fellBack}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

// ---- the ask line ---------------------------------------------------------------------------------------

function AskLine({ busy, onAsk, onCancel, inputRef }: { busy: boolean; onAsk: (q: string) => void; onCancel: () => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setText('');
    onAsk(q);
  };
  return (
    <form className="fb-ask" onSubmit={submit} autoComplete="off" aria-label={FB.ask.label}>
      <input ref={inputRef} className="fb-ask-in" aria-label={FB.ask.label} placeholder={FB.ask.placeholder} value={text} onChange={(e) => setText(e.target.value)} maxLength={400} />
      <span className="kbd fb-ask-kbd" aria-hidden="true">/</span>
      {busy ? <Btn sm onClick={onCancel}>{FB.ask.stop}</Btn> : <Btn sm type="submit" disabled={!text.trim()}>{FB.ask.send}</Btn>}
    </form>
  );
}
