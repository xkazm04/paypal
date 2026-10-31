// Break The Table: the judge (or the owner) plays the attacker against Maya's agent and sees what the
// real wallet answered. One component, two hosts:
// - host="page": arena.html, a static page of the browser preview (director builds only). It runs on the
//   browser mock as a main-window page of the sample week, takes the deck's keys and `?auto=1` (the
//   film's round: three attacks, a typed note, the closing card).
// - host="console": the console's place "Try to break it" (#p=try, console/layers/try.ts), beside the
//   safety record. Its one gold action is "Try an attack"; it moves only through LayerNav, and takes no
//   window keys (the console owns them).
// Every answer, audit row and count comes from the record (record.ts, written and pinned by
// `cargo test -p table-app --test gauntlet arena`); the component never makes one up. The table panel is
// e4's corridor on D-0193's recorded haggle (corridor.ts), with a hit on her wall for each attack that
// pushed past her band. A played refusal is also written into the sample world the preview windows
// share (MockWorld.refused), so Maya's own safety record counts it; a typed seller note arrives there as
// the seller's signed note and is shown only through the note chip (quarantined). The closing card
// checks the attack deal's recorded signed file in the proof checker (ArenaProof.tsx). Live mode
// (live.ts) is an optional second source; the recorded path never depends on it.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { backend } from '../lib/runtime';
import { usePrefersReducedMotion } from '../lib/hooks';
import {
  ARENA_ANSWER, ARENA_AUTO, ARENA_CORRIDOR, ARENA_COUNTER, ARENA_DECK, ARENA_FINALE, ARENA_HONEST, ARENA_LEDE, ARENA_LIVE, ARENA_LIVE_MODE, ARENA_NOTE, ARENA_NOTE_MAX, ARENA_PLACE, ARENA_PREVIEW, ARENA_RESET,
  ARENA_SAFETY, ARENA_TABLE, ARENA_TITLE,
} from '../lib/words/arena';
import { DAN_LABEL } from '../mock/haggle';
import type { MockBackend } from '../mock/backend';
import { Btn } from '../shared/ui';
import { Corridor } from '../windows/main/console/areas/tables/Corridor';
import { Answer, Finale, LiveAnswerView, VERDICT_WORDS } from './Answer';
import { arenaHaggle, hitsWall } from './corridor';
import { FinaleCard, HeldCard, Suit, type CardHandlers } from './Deck';
import { useCardDrag } from './drag';
import { sendLiveNote, useLive, type LiveState } from './live';
import { ATTACK_WORDS, cardForKey, counters, deck, verdictOf, wholeDollars } from './model';
import { attackById, isRefusal, RECORD, type RecordedAttack } from './record';
import { CheckIt, SafetyPanel, type Played } from './Side';
import { Gauntlet } from './Gauntlet';
import { Wire } from './Wire';
import '../windows/main/console/areas/tables.css';
import './arena.css';

/** Maya's monitor haggle with Dan in the sample week (D-0193): the very table the recorder replays from the
 *  engine's recording before every attack, so a played refusal and a typed note land on it. */
const SAMPLE_DEAL = DAN_LABEL;
const LAND_MS = 620;
/** The film's round (`?auto=1`): card keys, a typed note, then the closing card; one step every `AUTO_MS`. */
export const AUTO_STEPS: readonly string[] = ['1', '4', 'q', 'note', '8', 'c'];
const AUTO_MS = 3400;
/** Milliseconds per character while the film's round types its note. */
const TYPE_MS = 24;

export type ArenaHost = 'page' | 'console';

function world(): MockBackend['world'] | null {
  try {
    const b = backend() as Partial<MockBackend>;
    return b.world ?? null;
  } catch {
    return null;
  }
}

type View = { kind: 'empty' } | { kind: 'landing'; attack: RecordedAttack } | { kind: 'answer'; n: number; attack: RecordedAttack } | { kind: 'live'; i: number } | { kind: 'finale' };

/** The next card "Try an attack" plays: the first in deck order not played yet (null once all are). */
export function nextUntried(order: readonly RecordedAttack[], played: readonly RecordedAttack[]): RecordedAttack | null {
  const seen = new Set(played.map((a) => a.id));
  return order.find((a) => !seen.has(a.id)) ?? null;
}

export function BreakTheTable({ host, onOpenSafety }: { host: ArenaHost; /** The console's move to the safety record. */ onOpenSafety?: () => void }) {
  const page = host === 'page';
  const reduced = usePrefersReducedMotion();
  const liveState = useLive();
  const [plays, setPlays] = useState<Played[]>([]);
  const [view, setView] = useState<View>({ kind: 'empty' });
  const [note, setNote] = useState('');
  const [sentNote, setSentNote] = useState<{ n: number; text: string } | null>(null);
  const [liveNote, setLiveNote] = useState<boolean | null>(null);
  const [live, setLive] = useState('');
  /** Bumped by "Start over": Maya's record panel counts "+N from you" from then on. */
  const [session, setSession] = useState(0);
  const [auto, setAuto] = useState(() => page && new URLSearchParams(location.search).get('auto') === '1');
  const timer = useRef<number | null>(null);
  const dropRef = useRef<HTMLElement | null>(null);
  const d = useMemo(() => deck(RECORD.attacks), []);
  const order = useMemo(() => [...d.agent, ...d.counterparty], [d]);
  const played = useMemo(() => plays.map((p) => p.attack), [plays]);
  const c = counters(played);
  const sampleDealId = useMemo(() => world()?.deal(SAMPLE_DEAL)?.deal.id ?? null, []);
  const nextN = useRef(1);
  // The corridor changes only when another attack hits the wall (its replay plays on to the new hit).
  const hits = played.filter((a) => hitsWall(a)).length;
  const haggle = useMemo(() => arenaHaggle(played.filter((a) => hitsWall(a))), [hits]);

  /** `typed`: the judge's own note, which arrives in the sample world instead of the recorded one. */
  const land = useCallback((a: RecordedAttack, typed?: string) => {
    const n = nextN.current++;
    setPlays((ps) => {
      const next = [...ps, { n, attack: a }];
      setLive(ARENA_LIVE.played(ATTACK_WORDS[a.id]?.title ?? a.id, VERDICT_WORDS[verdictOf(a)], counters(next.map((p) => p.attack)).asked));
      return next;
    });
    setView({ kind: 'answer', n, attack: a });
    // On a narrow screen the table sits away from the deck: bring the answer into view.
    const top = dropRef.current?.getBoundingClientRect().top;
    if (top !== undefined && (top < 0 || top > window.innerHeight - 160)) dropRef.current?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    const w = world();
    try {
      if (isRefusal(a.answer)) w?.refused(SAMPLE_DEAL, a.answer.clause);
      else if (a.sent.envelope === 'note' && typeof a.sent.text === 'string') w?.note(SAMPLE_DEAL, typed ?? a.sent.text);
    } catch {
      /* the sample week has no such deal (another world, or the desktop shell): the record still shows */
    }
    return n;
  }, [reduced]);

  const play = useCallback((a: RecordedAttack, typed?: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const done = () => { const n = land(a, typed); setSentNote(typed === undefined ? null : { n, text: typed }); };
    if (reduced) { done(); return; }
    setView({ kind: 'landing', attack: a });
    timer.current = window.setTimeout(() => { timer.current = null; done(); }, LAND_MS);
  }, [land, reduced]);

  const finale = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setView({ kind: 'finale' });
    setLive(ARENA_LIVE.finale(ARENA_FINALE.card));
  }, []);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  // Live mode: the judge's own agent's newest move lands on the table, in the same answer view.
  const liveCount = liveState.status === 'live' ? liveState.answers.length : 0;
  useEffect(() => {
    if (liveCount === 0) return;
    setView({ kind: 'live', i: liveCount - 1 });
    setLive(ARENA_LIVE_MODE.count(liveCount));
  }, [liveCount]);

  const target = useCallback(() => dropRef.current?.getBoundingClientRect() ?? null, []);
  const onDrop = useCallback((id: string) => { const a = attackById(id); if (a) play(a); }, [play]);
  const drag = useCardDrag(target, onDrop, reduced);
  const handlers: CardHandlers = { onPlay: (a) => play(a), onDown: drag.down, onMove: drag.move, onUp: drag.up, onCancel: drag.cancel, wasDrag: drag.wasDrag };

  const sendNote = useCallback((typed?: string) => {
    const text = (typed ?? note).trim().slice(0, ARENA_NOTE_MAX);
    if (!text) return;
    // The judge's words take the recorded note's path; the answer shown is the recorded one. With a live
    // table running, they also go to it as the seller's note.
    const recorded = attackById('note-ignore-your-rules');
    if (recorded) play(recorded, text);
    if (liveState.status === 'live') void sendLiveNote(text).then(setLiveNote, () => setLiveNote(false));
    setNote('');
  }, [note, play, liveState.status]);

  // The deck's keys: the page only (in the console, 1 to 6 and the rest are the console's own).
  useEffect(() => {
    if (!page) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key.toLowerCase() === 'c') { e.preventDefault(); finale(); return; }
      if (e.key === 'Escape') { drag.cancel(); return; }
      const a = cardForKey(RECORD.attacks, e.key);
      if (a) { e.preventDefault(); play(a); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, play, finale, drag.cancel]);

  // The film's round: one step every AUTO_MS, stopped by the viewer at any time.
  useEffect(() => {
    if (!auto) return;
    let i = 0;
    const steps: number[] = [];
    const next = () => {
      const step = AUTO_STEPS[i++];
      if (step === undefined) { setAuto(false); return; }
      if (step === 'note') {
        // Typed as a viewer would, then sent: the take shows the words going in.
        const text = ARENA_AUTO.note;
        for (let k = 1; k <= text.length; k++) steps.push(window.setTimeout(() => setNote(text.slice(0, k)), k * TYPE_MS));
        steps.push(window.setTimeout(() => sendNote(text), text.length * TYPE_MS + 250));
        steps.push(window.setTimeout(next, text.length * TYPE_MS + 250 + AUTO_MS));
        return;
      }
      if (step === 'c') finale();
      else { const a = cardForKey(RECORD.attacks, step); if (a) play(a); }
      steps.push(window.setTimeout(next, AUTO_MS));
    };
    steps.push(window.setTimeout(next, 1200));
    return () => steps.forEach((s) => window.clearTimeout(s));
    // The round is scripted once, when it starts (the handlers it calls do not change its steps).
  }, [auto]);

  const playedCount = (id: string) => plays.filter((p) => p.attack.id === id).length;
  const heldAttack = drag.held ? attackById(drag.held.id) : undefined;
  const distinct = new Set(plays.map((p) => p.attack.id)).size;
  const untried = nextUntried(order, played);
  const reset = () => { setPlays([]); setSentNote(null); setLiveNote(null); setView({ kind: 'empty' }); setLive(''); setSession((x) => x + 1); };

  const counter = (
    <section className="ar-counter" aria-label={ARENA_COUNTER.label}>
      <Figure big={String(c.attacks)} small={ARENA_COUNTER.attacks(c.attacks)} tone="attack" bump={c.attacks} />
      <Figure big={c.moved ?? '—'} small={c.moved === null ? `${ARENA_COUNTER.moved} · ${ARENA_COUNTER.unknown}` : ARENA_COUNTER.moved} tone="ok" bump={c.attacks} />
      <Figure big={String(c.asked)} small={ARENA_COUNTER.asked(c.asked)} tone="ok" bump={c.attacks} />
    </section>
  );

  return (
    <div className={`arena host-${host}`} data-arena-host={host}>
      {page ? (
        <header className="ar-top">
          <div className="ar-brand">
            <span className="ar-tag">{ARENA_PREVIEW}</span>
            <h1>{ARENA_TITLE}</h1>
            <p className="ar-lede">{ARENA_LEDE}</p>
          </div>
          {counter}
        </header>
      ) : (
        <header className="ar-top">
          <div className="ar-brand">
            <p className="kicker">{ARENA_PLACE.kicker}</p>
            <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{ARENA_PLACE.title}</h1>
            <p className="ar-lede">{ARENA_PLACE.lede}</p>
            <div className="ar-go">
              <Btn kind="gold" data-fk="try-attack" disabled={untried === null} title={untried ? ARENA_PLACE.attackTitle : ARENA_PLACE.attackDone} onClick={() => { if (untried) play(untried); }}>{ARENA_PLACE.attack}</Btn>
              {untried === null ? <span className="ar-hint">{ARENA_PLACE.attackDone}</span> : null}
            </div>
          </div>
          {counter}
        </header>
      )}
      <p className="ar-live" role="status" aria-live="polite">{live}</p>

      <main className="ar-main">
        <aside className="ar-deck" aria-label={ARENA_DECK.label}>
          <Suit title={ARENA_DECK.agent} sub={ARENA_DECK.agentSub} cards={d.agent} suit="agent" played={playedCount} keys={page}
            hint={plays.length === 0 && view.kind === 'empty' ? d.agent[0]?.id ?? null : null} held={drag.held} h={handlers} />
          <Suit title={ARENA_DECK.counterparty} sub={ARENA_DECK.counterpartySub} cards={d.counterparty} suit="counterparty" played={playedCount} keys={page} hint={null} held={drag.held} h={handlers} />
          <FinaleCard onPlay={finale} ready={distinct >= RECORD.attacks.length} keys={page} />
          {page ? <p className="ar-keys">{ARENA_DECK.keys}</p> : null}
        </aside>

        <section className="ar-centre">
          <TableFacts haggle={haggle} hits={hits} />
          <section ref={dropRef} className={`ar-drop${drag.held?.over ? ' over' : ''}${drag.held ? ' armed' : ''}`} aria-label={ARENA_TABLE.drop}>
            {view.kind !== 'finale' ? (
              <Wire attack={view.kind === 'landing' || view.kind === 'answer' ? view.attack : null} phase={view.kind === 'landing' ? 'travel' : view.kind === 'answer' ? 'hit' : 'idle'}
                n={view.kind === 'answer' ? view.n : view.kind === 'landing' ? -nextN.current : 0} />
            ) : null}
            {view.kind === 'landing' ? <Landing attack={view.attack} /> : null}
            {view.kind === 'answer' ? <Answer key={view.n} attack={view.attack} sentNote={sentNote && sentNote.n === view.n ? sentNote.text : null} noteDealId={sampleDealId} /> : null}
            {view.kind === 'live' && liveState.status === 'live' && liveState.answers[view.i] ? <LiveAnswerView answer={liveState.answers[view.i]!} /> : null}
            {view.kind === 'finale' ? <Finale played={played} pageLink={page} /> : null}
            {view.kind === 'empty' ? (
              <div className="ar-empty">
                <p className="ar-drop-h">{ARENA_TABLE.drop}</p>
                <p className="ar-drop-s">{ARENA_TABLE.dropSub}</p>
                <p className="ar-empty-a">{ARENA_ANSWER.empty}</p>
              </div>
            ) : null}
          </section>
          <section className="ar-note" aria-label={ARENA_NOTE.heading}>
            <h2>{ARENA_NOTE.heading}</h2>
            <p className="ar-sub">{ARENA_NOTE.sub}</p>
            <label className="ar-note-l" htmlFor="ar-note-text">{ARENA_NOTE.label}</label>
            <div className="ar-note-row">
              <textarea id="ar-note-text" maxLength={ARENA_NOTE_MAX} rows={2} aria-describedby="ar-note-limit" value={note} placeholder={ARENA_NOTE.placeholder} onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e: ReactKeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendNote(); } }} />
              <Btn kind="primary" disabled={!note.trim()} onClick={() => sendNote()} title={note.trim() ? undefined : ARENA_NOTE.empty}>{ARENA_NOTE.send}</Btn>
            </div>
            <p className="ar-hint" id="ar-note-limit">{ARENA_NOTE.limit(note.length, ARENA_NOTE_MAX)}</p>
            <p className="ar-hint">{ARENA_NOTE.honest}</p>
            {liveNote !== null ? <p className="ar-hint" role="status">{liveNote ? ARENA_LIVE_MODE.noteSent : ARENA_LIVE_MODE.noteFailed}</p> : null}
          </section>
        </section>

        <aside className="ar-side" aria-label={ARENA_SAFETY.heading}>
          {liveState.status === 'live' ? <LivePanel state={liveState} /> : null}
          <SafetyPanel key={session} plays={plays} onOpen={onOpenSafety} />
          <CheckIt />
          {view.kind === 'finale' ? null : <Gauntlet compact />}
          {auto ? <Btn sm onClick={() => setAuto(false)}>{ARENA_AUTO.stop}</Btn> : null}
          {plays.length ? <Btn sm onClick={reset}>{ARENA_RESET}</Btn> : null}
        </aside>
      </main>
      <footer className="ar-foot"><p>{page ? ARENA_HONEST : ARENA_PLACE.honest}</p></footer>
      {drag.held ? <HeldCard held={drag.held} attack={heldAttack} /> : null}
    </div>
  );
}

function Figure({ big, small, tone, bump }: { big: string; small: string; tone: 'attack' | 'ok'; bump: number }) {
  return (
    <div className={`ar-fig t-${tone}`}>
      <span key={bump} className="ar-fig-n num">{big}</span>
      <span className="ar-fig-l">{small}</span>
    </div>
  );
}

/** The table: e4's corridor replaying D-0193's recorded haggle (and the attacks that hit her wall), and
 *  the rules Maya signed, every figure read from the record. */
function TableFacts({ haggle, hits }: { haggle: ReturnType<typeof arenaHaggle>; hits: number }) {
  const r = RECORD.rules;
  return (
    <section className="ar-table" aria-label={ARENA_TABLE.heading}>
      <div className="ar-table-h">
        <h2>{ARENA_TABLE.heading} · {ARENA_TABLE.item}</h2>
        <p className="ar-sub">{ARENA_TABLE.sub}</p>
      </div>
      <div className="ar-corridor">
        <Corridor haggle={haggle} who={ARENA_CORRIDOR.who} />
        <p className="ar-hits">{ARENA_CORRIDOR.hits(hits)}</p>
      </div>
      <ul className="ar-signed" aria-label={ARENA_TABLE.rules}>
        <li>{ARENA_TABLE.range(r.least === null ? null : wholeDollars(r.least), wholeDollars(r.most))}</li>
        <li>{ARENA_TABLE.perDeal(wholeDollars(r.per_deal))}</li>
        <li>{ARENA_TABLE.inPerson(wholeDollars(r.in_person_over))}</li>
        <li>{ARENA_TABLE.offers(r.offers)}</li>
        <li>{ARENA_TABLE.payee}</li>
      </ul>
    </section>
  );
}

/** Live mode: the sandbox's table is up; each of the agent's moves lands on the table as a live answer. */
function LivePanel({ state }: { state: Extract<LiveState, { status: 'live' }> }) {
  return (
    <section className="ar-record" aria-label={ARENA_LIVE_MODE.label}>
      <h2>{ARENA_LIVE_MODE.label}</h2>
      <p className="ar-sub">{ARENA_LIVE_MODE.sub(state.table)}</p>
      <p className="ar-hint">{state.answers.length === 0 ? ARENA_LIVE_MODE.none : ARENA_LIVE_MODE.count(state.answers.length)}</p>
    </section>
  );
}

function Landing({ attack }: { attack: RecordedAttack }) {
  return (
    <div className="ar-landing">
      <div className={`ar-flying s-${attack.suit}`}>{ATTACK_WORDS[attack.id]?.title ?? attack.id}</div>
      <p className="ar-drop-s">{ARENA_TABLE.landing}</p>
    </div>
  );
}
