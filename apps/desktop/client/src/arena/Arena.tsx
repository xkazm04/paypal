// BROWSER PREVIEW ONLY. Break The Table (arena.html): the judge plays the attacker against Maya's agent
// and the page shows what the real wallet answered. Every answer, audit row and count comes from the
// record (record.ts, written and pinned by `cargo test -p table-app --test gauntlet arena`); the page
// never makes one up. A played refusal is also written into the sample world the preview windows
// share (MockWorld.refused), so Maya's own safety record counts it; a typed seller note arrives there
// as the seller's signed note and is shown only through the note chip (quarantined).
//
// `?auto=1` plays a short round by itself (the film's take): three attacks, a typed note, the closing card.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { backend } from '../lib/runtime';
import { usePrefersReducedMotion } from '../lib/hooks';
import {
  ARENA_ANSWER, ARENA_AUTO, ARENA_COUNTER, ARENA_DECK, ARENA_FINALE, ARENA_HONEST, ARENA_LEDE, ARENA_LIVE, ARENA_NOTE, ARENA_PREVIEW, ARENA_RESET, ARENA_SAFETY, ARENA_TABLE, ARENA_TITLE,
} from '../lib/words/arena';
import { DAN_LABEL } from '../mock/haggle';
import type { MockBackend } from '../mock/backend';
import { Btn } from '../shared/ui';
import { Answer, Finale, VERDICT_WORDS } from './Answer';
import { FinaleCard, HeldCard, Suit, type CardHandlers } from './Deck';
import { useCardDrag } from './drag';
import { ATTACK_WORDS, cardForKey, counters, deck, dollars, verdictOf, wholeDollars } from './model';
import { attackById, isRefusal, RECORD, type RecordedAttack, type TableStep } from './record';
import { CheckIt, SafetyPanel, type Played } from './Side';
import { Gauntlet } from './Gauntlet';
import { Wire } from './Wire';
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

function world(): MockBackend['world'] | null {
  try {
    const b = backend() as Partial<MockBackend>;
    return b.world ?? null;
  } catch {
    return null;
  }
}

type View = { kind: 'empty' } | { kind: 'landing'; attack: RecordedAttack } | { kind: 'answer'; n: number; attack: RecordedAttack } | { kind: 'finale' };

export function Arena() {
  const reduced = usePrefersReducedMotion();
  const [plays, setPlays] = useState<Played[]>([]);
  const [view, setView] = useState<View>({ kind: 'empty' });
  const [note, setNote] = useState('');
  const [sentNote, setSentNote] = useState<{ n: number; text: string } | null>(null);
  const [live, setLive] = useState('');
  /** Bumped by "Start over": Maya's record panel counts "+N from you" from then on. */
  const [session, setSession] = useState(0);
  const [auto, setAuto] = useState(() => new URLSearchParams(location.search).get('auto') === '1');
  const timer = useRef<number | null>(null);
  const dropRef = useRef<HTMLElement | null>(null);
  const d = useMemo(() => deck(RECORD.attacks), []);
  const c = counters(plays.map((p) => p.attack));
  const sampleDealId = useMemo(() => world()?.deal(SAMPLE_DEAL)?.deal.id ?? null, []);
  const nextN = useRef(1);

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
    if (top !== undefined && (top < 0 || top > window.innerHeight - 160)) dropRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    const w = world();
    try {
      if (isRefusal(a.answer)) w?.refused(SAMPLE_DEAL, a.answer.clause);
      else if (a.sent.envelope === 'note' && typeof a.sent.text === 'string') w?.note(SAMPLE_DEAL, typed ?? a.sent.text);
    } catch {
      /* the sample week has no such deal (another world): the page still shows the record */
    }
    return n;
  }, []);

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

  const target = useCallback(() => dropRef.current?.getBoundingClientRect() ?? null, []);
  const onDrop = useCallback((id: string) => { const a = attackById(id); if (a) play(a); }, [play]);
  const drag = useCardDrag(target, onDrop, reduced);
  const handlers: CardHandlers = { onPlay: (a) => play(a), onDown: drag.down, onMove: drag.move, onUp: drag.up, onCancel: drag.cancel, wasDrag: drag.wasDrag };

  const sendNote = useCallback((typed?: string) => {
    const text = (typed ?? note).trim();
    if (!text) return;
    // The judge's words take the recorded note's path; the answer shown is the recorded one.
    const recorded = attackById('note-ignore-your-rules');
    if (recorded) play(recorded, text);
    setNote('');
  }, [note, play]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      if (e.key.toLowerCase() === 'c') { e.preventDefault(); finale(); return; }
      if (e.key === 'Escape') { drag.cancel(); return; }
      const a = cardForKey(RECORD.attacks, e.key);
      if (a) { e.preventDefault(); play(a); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, finale, drag.cancel]);

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

  return (
    <div className="arena">
      <header className="ar-top">
        <div className="ar-brand">
          <span className="ar-tag">{ARENA_PREVIEW}</span>
          <h1>{ARENA_TITLE}</h1>
          <p className="ar-lede">{ARENA_LEDE}</p>
        </div>
        <section className="ar-counter" aria-label={ARENA_COUNTER.label}>
          <Figure big={String(c.attacks)} small={ARENA_COUNTER.attacks(c.attacks)} tone="attack" bump={c.attacks} />
          <Figure big={c.moved ?? '—'} small={c.moved === null ? `${ARENA_COUNTER.moved} · ${ARENA_COUNTER.unknown}` : ARENA_COUNTER.moved} tone="ok" bump={c.attacks} />
          <Figure big={String(c.asked)} small={ARENA_COUNTER.asked(c.asked)} tone="ok" bump={c.attacks} />
        </section>
      </header>
      <p className="ar-live" role="status" aria-live="polite">{live}</p>

      <main className="ar-main">
        <aside className="ar-deck" aria-label={ARENA_DECK.label}>
          <Suit title={ARENA_DECK.agent} sub={ARENA_DECK.agentSub} cards={d.agent} suit="agent" played={playedCount}
            hint={plays.length === 0 && view.kind === 'empty' ? d.agent[0]?.id ?? null : null} held={drag.held} h={handlers} />
          <Suit title={ARENA_DECK.counterparty} sub={ARENA_DECK.counterpartySub} cards={d.counterparty} suit="counterparty" played={playedCount} hint={null} held={drag.held} h={handlers} />
          <FinaleCard onPlay={finale} ready={distinct >= RECORD.attacks.length} />
          <p className="ar-keys">{ARENA_DECK.keys}</p>
        </aside>

        <section className="ar-centre">
          <TableFacts />
          <section ref={dropRef} className={`ar-drop${drag.held?.over ? ' over' : ''}${drag.held ? ' armed' : ''}`} aria-label={ARENA_TABLE.drop}>
            {view.kind !== 'finale' ? (
              <Wire attack={view.kind === 'landing' || view.kind === 'answer' ? view.attack : null} phase={view.kind === 'landing' ? 'travel' : view.kind === 'answer' ? 'hit' : 'idle'}
                n={view.kind === 'answer' ? view.n : view.kind === 'landing' ? -nextN.current : 0} />
            ) : null}
            {view.kind === 'landing' ? <Landing attack={view.attack} /> : null}
            {view.kind === 'answer' ? <Answer key={view.n} attack={view.attack} sentNote={sentNote && sentNote.n === view.n ? sentNote.text : null} noteDealId={sampleDealId} /> : null}
            {view.kind === 'finale' ? <Finale played={plays.map((p) => p.attack)} /> : null}
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
              <textarea id="ar-note-text" maxLength={280} rows={2} value={note} placeholder={ARENA_NOTE.placeholder} onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e: ReactKeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendNote(); } }} />
              <Btn kind="primary" disabled={!note.trim()} onClick={() => sendNote()} title={note.trim() ? undefined : ARENA_NOTE.empty}>{ARENA_NOTE.send}</Btn>
            </div>
            <p className="ar-hint">{ARENA_NOTE.honest}</p>
          </section>
        </section>

        <aside className="ar-side" aria-label={ARENA_SAFETY.heading}>
          <SafetyPanel key={session} plays={plays} />
          <CheckIt />
          {view.kind === 'finale' ? null : <Gauntlet compact />}
          {auto ? <Btn sm onClick={() => setAuto(false)}>{ARENA_AUTO.stop}</Btn> : null}
          {plays.length ? <Btn sm onClick={() => { setPlays([]); setSentNote(null); setView({ kind: 'empty' }); setLive(''); setSession((x) => x + 1); }}>{ARENA_RESET}</Btn> : null}
        </aside>
      </main>
      <footer className="ar-foot"><p>{ARENA_HONEST}</p></footer>
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

function TableFacts() {
  const r = RECORD.rules;
  const step = (s: TableStep | undefined, label: string) => (s ? <li><span>{label}</span><b className="num">{dollars(s.price)}</b></li> : null);
  const h = RECORD.table.history;
  return (
    <section className="ar-table" aria-label={ARENA_TABLE.heading}>
      <div className="ar-table-h">
        <h2>{ARENA_TABLE.heading} · {ARENA_TABLE.item}</h2>
        <p className="ar-sub">{ARENA_TABLE.sub}</p>
      </div>
      <ol className="ar-steps">
        {step(h.find((s) => s.act === 'listing'), ARENA_TABLE.listed)}
        {/* where the replayed table stands: her agent's latest offer and the seller's latest counter */}
        {step(h.findLast((s) => s.act === 'offer' && s.by === 'you'), ARENA_TABLE.offered)}
        {step(h.findLast((s) => s.act === 'counter'), ARENA_TABLE.countered)}
        {RECORD.table.turn === 'yours' ? <li className="turn"><span>{ARENA_TABLE.turn}</span></li> : null}
      </ol>
      <ul className="ar-rules" aria-label={ARENA_TABLE.rules}>
        <li>{ARENA_TABLE.range(r.least === null ? null : wholeDollars(r.least), wholeDollars(r.most))}</li>
        <li>{ARENA_TABLE.perDeal(wholeDollars(r.per_deal))}</li>
        <li>{ARENA_TABLE.inPerson(wholeDollars(r.in_person_over))}</li>
        <li>{ARENA_TABLE.offers(r.offers)}</li>
        <li>{ARENA_TABLE.payee}</li>
      </ul>
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
