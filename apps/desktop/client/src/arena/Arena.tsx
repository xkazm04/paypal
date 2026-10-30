// BROWSER PREVIEW ONLY. Break The Table (arena.html): the judge plays the attacker against Maya's agent
// and the page shows what the real wallet answered. Every answer, audit row and count comes from the
// record (record.ts, written and pinned by `cargo test -p table-app --test gauntlet arena`); the page
// never makes one up. A played refusal is also written into the sample world the preview windows
// share (MockWorld.refused), so Maya's own safety record in The Table counts it; a typed seller note
// arrives there as the seller's signed note and is shown only through the note chip (quarantined).
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { backend } from '../lib/runtime';
import { usePrefersReducedMotion } from '../lib/hooks';
import {
  ARENA_ANSWER, ARENA_CHECK, ARENA_COUNTER, ARENA_DECK, ARENA_HONEST, ARENA_LEDE, ARENA_NOTE, ARENA_PREVIEW, ARENA_RESET, ARENA_SAFETY, ARENA_TABLE, ARENA_TITLE,
  ARENA_VERDICT, ATTACK_WORDS, RULE_NAME,
} from '../lib/words/arena';
import type { MockBackend } from '../mock/backend';
import { Quarantine } from '../shared/honesty';
import { Btn } from '../shared/ui';
import { NoteChip } from '../windows/main/console/areas/shared/NoteChip';
import { auditLine, cardForKey, counters, deck, dollars, keyFor, minorOf, noteAsks, stateWords, verdictOf, wholeDollars, type Verdict } from './model';
import { attackById, isRefusal, RECORD, type RecordedAttack, type TableStep } from './record';
import './arena.css';

/** Maya's monitor haggle with Dan in the sample week: where a played refusal and a typed note land. */
const SAMPLE_DEAL = 'D-0193';
const LAND_MS = 620;
const NEWLINE = String.fromCharCode(10);

function world(): MockBackend['world'] | null {
  try {
    const b = backend() as Partial<MockBackend>;
    return b.world ?? null;
  } catch {
    return null;
  }
}

type Play = { n: number; attack: RecordedAttack };

export function Arena() {
  const reduced = usePrefersReducedMotion();
  const [plays, setPlays] = useState<Play[]>([]);
  const [landing, setLanding] = useState<RecordedAttack | null>(null);
  const [over, setOver] = useState(false);
  const [note, setNote] = useState('');
  const [sentNote, setSentNote] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const answerRef = useRef<HTMLElement | null>(null);
  const d = useMemo(() => deck(RECORD.attacks), []);
  const current = plays.length ? plays[plays.length - 1] : undefined;
  const c = counters(plays.map((p) => p.attack));
  const sampleDealId = useMemo(() => world()?.deal(SAMPLE_DEAL)?.deal.id ?? null, []);

  const land = useCallback((a: RecordedAttack) => {
    setPlays((ps) => [...ps, { n: ps.length + 1, attack: a }]);
    setLanding(null);
    const w = world();
    try {
      if (isRefusal(a.answer)) w?.refused(SAMPLE_DEAL, a.answer.clause);
      else if (a.sent.envelope === 'note' && typeof a.sent.text === 'string') w?.note(SAMPLE_DEAL, a.sent.text);
    } catch {
      /* the sample week has no such deal (another world): the page still shows the record */
    }
  }, []);

  const play = useCallback((a: RecordedAttack) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (reduced) { land(a); return; }
    setLanding(a);
    timer.current = window.setTimeout(() => { timer.current = null; land(a); }, LAND_MS);
  }, [land, reduced]);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      const a = cardForKey(RECORD.attacks, e.key);
      if (a) { e.preventDefault(); play(a); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play]);

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setOver(false);
    const a = attackById(e.dataTransfer.getData('text/plain'));
    if (a) play(a);
  };

  const sendNote = () => {
    const text = note.trim();
    if (!text) return;
    const w = world();
    try { w?.note(SAMPLE_DEAL, text); } catch { /* no such deal in this world */ }
    setSentNote(text);
    const recorded = attackById('note-ignore-your-rules');
    if (recorded) play(recorded);
  };

  const playedCount = (id: string) => plays.filter((p) => p.attack.id === id).length;
  const refusals = plays.filter((p) => isRefusal(p.attack.answer));

  return (
    <div className="arena">
      <header className="ar-top">
        <div className="ar-brand">
          <span className="ar-tag">{ARENA_PREVIEW}</span>
          <h1>{ARENA_TITLE}</h1>
          <p className="ar-lede">{ARENA_LEDE}</p>
        </div>
        <section className="ar-counter" aria-label={ARENA_COUNTER.label} aria-live="polite">
          <Figure big={String(c.attacks)} small={ARENA_COUNTER.attacks(c.attacks)} tone="attack" bump={c.attacks} />
          <Figure big={c.moved ?? '—'} small={c.moved === null ? `${ARENA_COUNTER.moved} · ${ARENA_COUNTER.unknown}` : ARENA_COUNTER.moved} tone="ok" bump={c.attacks} />
          <Figure big={String(c.asked)} small={ARENA_COUNTER.asked(c.asked)} tone="ok" bump={c.attacks} />
        </section>
      </header>

      <main className="ar-main">
        <aside className="ar-deck" aria-label="Attack cards">
          <Suit title={ARENA_DECK.agent} sub={ARENA_DECK.agentSub} cards={d.agent} suit="agent" onPlay={play} played={playedCount} />
          <Suit title={ARENA_DECK.counterparty} sub={ARENA_DECK.counterpartySub} cards={d.counterparty} suit="counterparty" onPlay={play} played={playedCount} />
          <p className="ar-keys">{ARENA_DECK.keys}</p>
        </aside>

        <section className="ar-centre">
          <TableFacts />
          <section ref={answerRef} className={`ar-drop${over ? ' over' : ''}${landing ? ' landing' : ''}`} aria-live="polite"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); }}
            onDragLeave={() => setOver(false)} onDrop={onDrop}>
            {landing ? <Landing attack={landing} /> : current ? <Answer key={current.n} play={current} sentNote={current.attack.id === 'note-ignore-your-rules' ? sentNote : null} noteDealId={sampleDealId} /> : (
              <div className="ar-empty">
                <p className="ar-drop-h">{ARENA_TABLE.drop}</p>
                <p className="ar-drop-s">{ARENA_TABLE.dropSub}</p>
                <p className="ar-empty-a">{ARENA_ANSWER.empty}</p>
              </div>
            )}
          </section>
          <section className="ar-note" aria-label={ARENA_NOTE.heading}>
            <h2>{ARENA_NOTE.heading}</h2>
            <p className="ar-sub">{ARENA_NOTE.sub}</p>
            <label className="ar-note-l" htmlFor="ar-note-text">{ARENA_NOTE.label}</label>
            <div className="ar-note-row">
              <textarea id="ar-note-text" maxLength={280} rows={2} value={note} placeholder={ARENA_NOTE.placeholder} onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e: ReactKeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendNote(); } }} />
              <Btn kind="primary" disabled={!note.trim()} onClick={sendNote} title={note.trim() ? undefined : ARENA_NOTE.empty}>{ARENA_NOTE.send}</Btn>
            </div>
            <p className="ar-hint">{ARENA_NOTE.honest}</p>
          </section>
        </section>

        <aside className="ar-side">
          <section className="ar-safety" aria-label={ARENA_SAFETY.heading}>
            <h2>{ARENA_SAFETY.heading}</h2>
            <p className="ar-sub">{ARENA_SAFETY.sub}</p>
            <p className="ar-safety-n">{ARENA_SAFETY.rows(refusals.length)}</p>
            {refusals.length ? <p className="ar-safety-ok">{ARENA_SAFETY.never}</p> : null}
            <ol className="ar-rows" reversed>
              {[...plays].reverse().map((p) => (
                <li key={p.n} className={`v-${verdictOf(p.attack)}`}>
                  <span className="ar-row-t">{ATTACK_WORDS[p.attack.id]?.title ?? p.attack.id}</span>
                  <span className="ar-row-a mono">{p.attack.audit[0] ? auditLine(p.attack.audit[0]) : ARENA_ANSWER.rows(0)}</span>
                </li>
              ))}
            </ol>
            <a className="ar-open" href="index.html#p=safety" target="_blank" rel="noopener">{ARENA_SAFETY.open}</a>
          </section>
          <CheckIt plays={plays} />
          {plays.length ? <Btn sm onClick={() => { setPlays([]); setSentNote(null); }}>{ARENA_RESET}</Btn> : null}
        </aside>
      </main>
      <footer className="ar-foot"><p>{ARENA_HONEST}</p></footer>
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

function Suit({ title, sub, cards, suit, onPlay, played }: { title: string; sub: string; cards: RecordedAttack[]; suit: RecordedAttack['suit']; onPlay: (a: RecordedAttack) => void; played: (id: string) => number }) {
  return (
    <section className={`ar-suit s-${suit}`}>
      <h2>{title}</h2>
      <p className="ar-sub">{sub}</p>
      <ul>
        {cards.map((a, i) => {
          const w = ATTACK_WORDS[a.id];
          const n = played(a.id);
          const key = keyFor(suit, i);
          return (
            <li key={a.id}>
              <button type="button" className={`ar-card${n ? ' played' : ''}`} draggable aria-keyshortcuts={key ?? undefined}
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; }}
                onClick={() => onPlay(a)}>
                {key ? <kbd className="ar-key">{key.toUpperCase()}</kbd> : null}
                <span className="ar-card-t">{w?.title ?? a.id}</span>
                <span className="ar-card-s">{w?.tries}</span>
                {n ? <span className="ar-card-p">{ARENA_DECK.played}{n > 1 ? ` ×${n}` : ''}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
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
        {step(h.find((s) => s.act === 'offer' && s.by === 'you'), ARENA_TABLE.offered)}
        {step(h.find((s) => s.act === 'counter'), ARENA_TABLE.countered)}
        {RECORD.table.turn === 'yours' ? <li className="turn"><span>{ARENA_TABLE.turn}</span></li> : null}
      </ol>
      <ul className="ar-rules" aria-label={ARENA_TABLE.rules}>
        <li>{ARENA_TABLE.range(wholeDollars(r.least), wholeDollars(r.most))}</li>
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

const VERDICT_WORDS: Record<Verdict, string> = {
  refused: ARENA_VERDICT.refused, turnedAway: ARENA_VERDICT.turnedAway, kept: ARENA_VERDICT.kept, counted: ARENA_VERDICT.counted,
};

function Answer({ play, sentNote, noteDealId }: { play: Play; sentNote: string | null; noteDealId: string | null }) {
  const a = play.attack;
  const w = ATTACK_WORDS[a.id];
  const v = verdictOf(a);
  const ans = a.answer;
  const which = a.deal.which === 'purchase' ? ARENA_ANSWER.purchase : ARENA_ANSWER.haggle;
  const asks = sentNote ? noteAsks(sentNote, { mostMinor: minorOf(RECORD.rules.most), perDealMinor: minorOf(RECORD.rules.per_deal) }) : [];
  return (
    <article className={`ar-answer v-${v}`}>
      <div className="ar-answer-h">
        <span className={`ar-stamp v-${v}`}>{VERDICT_WORDS[v]}</span>
        <h3>{w?.title ?? a.id}</h3>
      </div>
      {sentNote !== null ? (
        <div className="ar-yournote">
          <p>{ARENA_NOTE.sent}</p>
          {noteDealId ? <NoteChip dealId={noteDealId} who={ARENA_NOTE.chipWho} /> : null}
        </div>
      ) : null}
      <dl className="ar-why">
        <div><dt>{ARENA_ANSWER.why}</dt><dd>{w?.held}{isRefusal(ans) && RULE_NAME[ans.code] ? <span className="ar-rule">{RULE_NAME[ans.code]}</span> : null}</dd></div>
        {isRefusal(ans) ? <div><dt>{ARENA_ANSWER.heard}</dt><dd className="ar-heard">“{ans.text}”</dd></div> : null}
        {!isRefusal(ans) && ans.why ? <div><dt>{ARENA_ANSWER.heard}</dt><dd>{ARENA_ANSWER.why_kept(ans.why)}</dd></div> : null}
      </dl>
      {sentNote !== null ? <NoteAsks asks={asks} /> : null}
      <section className="ar-proof" aria-label={ARENA_ANSWER.record}>
        <h4>{ARENA_ANSWER.record}<span className="ar-sub"> · {ARENA_ANSWER.recordSub}</span></h4>
        <p className="ar-rows-h">{ARENA_ANSWER.rows(a.audit.length)}</p>
        {a.audit.length ? <ul className="ar-audit mono">{a.audit.map((r) => <li key={r.seq}>{auditLine(r)}</li>)}</ul> : null}
        <div className="ar-split">
          <div className="ar-sent">
            <h5>{a.suit === 'agent' ? ARENA_ANSWER.sent : ARENA_ANSWER.sentEnvelope}</h5>
            <Sent attack={a} />
          </div>
          <div className={`ar-paypal${a.paypal_requests === 0 ? ' none' : ''}`}>
            <h5>{ARENA_ANSWER.paypal}</h5>
            <p className="ar-paypal-n">{a.paypal_requests === 0 ? ARENA_ANSWER.paypalNone : ARENA_ANSWER.paypalSome(a.paypal_requests)}</p>
            <p className="ar-hint">{ARENA_ANSWER.paypalRows(a.paypal_calls)} · {ARENA_ANSWER.moneyOps(a.money_operations)}</p>
          </div>
        </div>
        {a.agent_saw ? (
          <div className="ar-saw">
            <h5>{ARENA_ANSWER.agentSaw}</h5>
            <p className="ar-hint">{ARENA_ANSWER.agentSawSub}</p>
            <ul className="mono">
              {a.agent_saw.history.map((s) => <li key={`${s.by}-${s.seq}-${s.act}`}>{s.by === 'you' ? 'you' : 'them'} · {s.act} · {dollars(s.price)}</li>)}
            </ul>
            <p className="ar-saw-ok">{ARENA_ANSWER.noNote}</p>
          </div>
        ) : null}
        <p className="ar-hint">{ARENA_ANSWER.dealState(which, stateWords(a.deal.before), stateWords(a.deal.after))}</p>
      </section>
    </article>
  );
}

/** What was sent: the agent's tool call (its name, then its arguments), or the seller's envelope. A
 *  seller's note is their words: drawn only through Quarantine, never as plain page text. */
function Sent({ attack: a }: { attack: RecordedAttack }) {
  if (a.suit === 'agent') {
    const { name, arguments: args } = a.sent as { name?: unknown; arguments?: unknown };
    return <pre className="mono"><b>{String(name)}</b>{NEWLINE}{JSON.stringify(args, null, 1)}</pre>;
  }
  const { text, ...rest } = a.sent as { text?: unknown };
  return (
    <>
      <pre className="mono">{JSON.stringify(rest, null, 1)}</pre>
      {typeof text === 'string' ? <Quarantine text={text} label={ARENA_ANSWER.theirWords} /> : null}
    </>
  );
}

function NoteAsks({ asks }: { asks: string[] }) {
  return (
    <div className="ar-asks">
      <h5>{ARENA_NOTE.obeyed}</h5>
      {asks.length === 0 ? <p className="ar-hint">{ARENA_NOTE.obeyedNone}</p> : (
        <ul>
          {asks.map((id) => {
            const a = attackById(id);
            if (!a || !isRefusal(a.answer)) return null;
            return <li key={id}><b>{ATTACK_WORDS[id]?.title}</b> → <span className="ar-stamp sm v-refused">{ARENA_VERDICT.refused}</span> {RULE_NAME[a.answer.code]}</li>;
          })}
        </ul>
      )}
    </div>
  );
}

function CheckIt({ plays }: { plays: Play[] }) {
  const [copied, setCopied] = useState(false);
  const tried = new Set(plays.map((p) => p.attack.id)).size;
  const moved = counters(plays.map((p) => p.attack)).moved;
  const copy = () => {
    void navigator.clipboard?.writeText(RECORD.check).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }, () => undefined);
  };
  return (
    <section className={`ar-check${plays.length >= RECORD.attacks.length ? ' all' : ''}`} aria-label={ARENA_CHECK.heading}>
      <h2>{ARENA_CHECK.heading}</h2>
      <p className="ar-sub">{ARENA_CHECK.sub}</p>
      <div className="ar-cmd"><code className="mono">{RECORD.check}</code><Btn sm onClick={copy}>{copied ? ARENA_CHECK.copied : ARENA_CHECK.copy}</Btn></div>
      {plays.length && moved !== null ? <p className="ar-hint">{ARENA_CHECK.summary(tried, RECORD.attacks.length, moved)} {ARENA_CHECK.seed(RECORD.seed)}</p> : null}
    </section>
  );
}
