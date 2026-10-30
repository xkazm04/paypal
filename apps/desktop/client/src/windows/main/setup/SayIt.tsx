// "Say it": the owner types (or, where the browser has it, speaks) one sentence and the wallet shows how it
// read it as chips: what it understood, what it filled in safely, and the one question about anything it
// is not sure of. It reads with a fixed word list (lib/say, no model). It can never sign anything: the one
// button hands the rules to the approval window (approval_open, a typed draft Rust re-checks), where the
// owner changes whatever they like and signs. Words: lib/words/say.ts.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation } from '../../../lib/hooks';
import { parseMoneyText } from '../../../lib/format';
import { plainWords, reachOf, type Chip } from '../../../lib/say/draft';
import { readEnds, type Question, type SayCtx } from '../../../lib/say/read';
import { listen, speechSupport, type Listening } from '../../../lib/say/speech';
import { sayAnswer, saySet, sayClear, sayUnanswer } from '../../../lib/say/store';
import { NOTICE_WHAT, SAY, SAY_Q } from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { Btn, useToast } from '../../../shared/ui';
import { useLocked } from '../world';
import { SayTimeline } from './SayTimeline';
import { useSayReading } from './useSay';
import './say.css';

export function SayIt({ className, compact = false, stepGold = true, timeline = false, onOpened }: {
  className?: string;
  /** Draw the week and the next 72 hours under the chips (the Charter; the Rewind has its own timeline). */
  timeline?: boolean;
  /** The approval window was opened with the rules (the Charter then waits on it). */
  onOpened?: () => void;
  /** On the Rewind, above the timeline: no explainer, just the sentence, the chips and the button. */
  compact?: boolean;
  /** This is the view's one gold action; false when the view has its own (the Charter's step). */
  stepGold?: boolean;
}) {
  const said = useSayReading();
  const { reading, chips, rules, ctx, text } = said;
  const id = useId();
  const [typed, setTyped] = useState(text);
  const box = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const locked = useLocked();
  const open = useMutation('approval_open');
  const [opened, setOpened] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  // The store is the sentence: a try-saying click or a spoken one reaches the box through it.
  useEffect(() => { setTyped(text); }, [text]);
  useEffect(() => { setOpened(false); }, [text, said.answers]);

  // ---- speech: only where the browser has a recogniser, only as typing for the owner to check
  const canSpeak = useMemo(() => speechSupport() !== null, []);
  const [hearing, setHearing] = useState<Listening | null>(null);
  const [speechNote, setSpeechNote] = useState<string | null>(null);
  useEffect(() => () => hearing?.stop(), [hearing]);
  const speak = () => {
    if (hearing) { hearing.stop(); return; }
    setSpeechNote(null);
    const l = listen({
      onText: (t) => setTyped(t),
      onDone: (t) => { setHearing(null); if (t) saySet(t); else setSpeechNote(SAY.speechFailed); },
      onFail: () => { setHearing(null); setSpeechNote(SAY.speechFailed); },
    });
    if (l) setHearing(l); else setSpeechNote(SAY.noSpeech);
  };

  const submit = (e?: FormEvent) => { e?.preventDefault(); saySet(typed.trim()); setPicked(null); };
  const tryLine = (line: string) => { setTyped(line); saySet(line); setPicked(null); box.current?.focus(); };
  const clear = () => { sayClear(); setTyped(''); setPicked(null); box.current?.focus(); };

  const asking = chips.filter((c) => c.state === 'unsure');
  const sentence = useMemo(() => plainWords(chips), [chips]);
  const review = async () => {
    if (!rules) return;
    const r = await open.run({ deal_id: null, target: 'mandate', draft: { type: 'rules', ...rules } });
    if (r === null) { toast(SAY.opened, 'gold'); setOpened(true); onOpened?.(); }
  };

  const reach = useMemo(() => (reading ? reachOf(reading.facts, reading.facts.ends) : null), [reading]);
  const none = reading !== null && !chips.length;
  const theirs = chips.filter((c) => c.state === 'said' || c.state === 'unsure');
  const ours = chips.filter((c) => c.state === 'filled' || c.state === 'open');
  const detail = chips.find((c) => c.key === picked && c.state !== 'unsure') ?? null;
  return (
    <section className={`say${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`} aria-labelledby={`${id}-h`} data-tour="say-it">
      <header className="say-h">
        <p className="kicker">{SAY.kicker}</p>
        <h2 id={`${id}-h`} className="say-title">{compact ? SAY.titleShort : SAY.title}</h2>
        {compact ? null : <p className="say-sub">{SAY.sub}</p>}
      </header>
      <form className="say-form" onSubmit={submit} role="search" aria-label={SAY.label}>
        <label className="say-sr" htmlFor={`${id}-in`}>{SAY.label}</label>
        <input id={`${id}-in`} ref={box} className="ui-field say-input" type="text" value={typed} placeholder={SAY.placeholder} autoComplete="off" spellCheck={false}
          maxLength={400} onChange={(e) => setTyped(e.target.value)} aria-describedby={`${id}-note`} />
        {canSpeak ? (
          <Btn className={`say-mic${hearing ? ' on' : ''}`} onClick={speak} aria-pressed={!!hearing} title={SAY.speakTitle} icon>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0V4A2.5 2.5 0 0 0 8 1.5zM3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5" /></svg>
            <span className="say-sr">{hearing ? SAY.listening : SAY.speak}</span>
          </Btn>
        ) : null}
        <Btn type="submit" disabled={!typed.trim()}>{SAY.read}</Btn>
        {text || typed ? <Btn kind="plain" onClick={clear} title={SAY.clearTitle}>{SAY.clear}</Btn> : null}
      </form>
      <p id={`${id}-note`} className="say-note">
        {hearing ? <b className="say-listen" role="status">{SAY.listening} </b> : null}
        {canSpeak ? SAY.speechNote : SAY.noSpeech}{speechNote ? <> <b>{speechNote}</b></> : null}
      </p>

      {!reading ? (
        <TryList onPick={tryLine} />
      ) : (
        <div className="say-read">
          <p className="say-readas" role="status">
            <b>{SAY.readAs}</b>
            <span className="say-ai">{SAY.noAi}</span>
            <span className={`say-left${asking.length ? ' q' : ''}`}>{asking.length ? SAY.stillOpen(asking.length) : rules ? SAY.ready : ''}</span>
          </p>
          {none ? <p className="say-none">{SAY.nothing}</p> : null}
          <ul className="say-pills" key={text} aria-label={SAY.readAs}>
            {theirs.map((c, i) => <Pill key={c.key} c={c} i={i} on={picked === c.key} onPick={() => setPicked(picked === c.key ? null : c.key)} />)}
            {ours.length ? <li className="say-pillsep" aria-hidden="true">{SAY.filled}</li> : null}
            {ours.map((c, i) => <Pill key={c.key} c={c} i={theirs.length + i} on={picked === c.key} onPick={() => setPicked(picked === c.key ? null : c.key)} />)}
          </ul>
          {detail ? <Detail c={detail} ctx={ctx} currency={reading.facts.currency} onDone={() => setPicked(null)} /> : null}
          {asking.map((c) => (c.question ? <Ask key={c.key} c={c} q={c.question} ctx={ctx} /> : null))}
          {sentence ? <p className="say-plain"><b>{SAY.plain}</b> {sentence}</p> : null}
          {none ? <TryList onPick={tryLine} /> : null}
        </div>
      )}

      <div className="say-act">
        <Btn kind={stepGold ? 'gold' : 'default'} locked={locked} disabled={!rules || open.pending} onClick={() => void review()} title={SAY.reviewTitle}>
          {open.pending ? SAY.opening : SAY.review} ↗
        </Btn>
        <span className="say-note">{opened ? SAY.opened : rules && asking.length ? SAY.readyOpen : SAY.reviewNote}</span>
      </div>
      {open.error ? <WalletNotice error={open.error} what={NOTICE_WHAT.approval} /> : null}
      {timeline ? <SayTimeline reach={reach} /> : null}
    </section>
  );
}

function TryList({ onPick }: { onPick: (line: string) => void }) {
  return (
    <div className="say-try">
      <p className="say-tryh">{SAY.tryTitle}</p>
      <ul aria-label={SAY.tryLabel}>
        {SAY.tryLines.map((l) => <li key={l}><button type="button" className="say-tryline" onClick={() => onPick(l)}>{l}</button></li>)}
      </ul>
    </div>
  );
}

/** One part of the reading: the rule in the owner's words and what it was read as. A said part is solid,
 *  one that was filled in is quiet, one that is not known is dashed. */
function Pill({ c, i, on, onPick }: { c: Chip; i: number; on: boolean; onPick: () => void }) {
  const unsure = c.state === 'unsure';
  return (
    <li className={`say-pill s-${c.state}${on ? ' on' : ''}`} style={{ '--i': i } as CSSProperties} data-chip={c.slot} data-state={c.state}>
      {unsure ? (
        <span className="say-pillbody" title={c.says || undefined}><span className="say-label">{c.label}</span><span className="say-value">{c.value}</span></span>
      ) : (
        <button type="button" className="say-pillbody" onClick={onPick} aria-expanded={on} title={c.says}>
          <span className="say-label">{c.label}</span><span className="say-value">{c.value}</span>
        </button>
      )}
    </li>
  );
}

/** What a part allows in one sentence, the words it came from, and its edit (what the owner types is read again). */
function Detail({ c, ctx, currency, onDone }: { c: Chip; ctx: SayCtx; currency: string; onDone: () => void }) {
  return (
    <div className="say-detail" role="group" aria-label={c.label}>
      <p className="say-says">{c.says}</p>
      {c.heard && c.state === 'said' ? <p className="say-heard">{SAY.heard}: “{c.heard}”</p> : null}
      {c.state === 'filled' ? <p className="say-heard">{SAY.filledNote}</p> : null}
      {c.state === 'open' ? <p className="say-heard">{SAY.openNote}</p> : null}
      {c.edit ? <ChipEdit c={c} ctx={ctx} currency={currency} onDone={onDone} /> : null}
    </div>
  );
}

/** The one question an unsure part asks, answered by a tap, or by typing the one thing it needs. */
function Ask({ c, q, ctx }: { c: Chip; q: Question; ctx: SayCtx }) {
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState<string | null>(null);
  const a = q.answer;
  const leaving = q.id.startsWith('leave:');
  const text = leaving ? SAY_Q.leftover(c.value) : q.text;
  const currency = 'USD';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const kind = a.kind === 'amount' ? (q.slot === 'offers' ? 'count' : 'amount') : q.id === 'ends' ? 'when' : 'text';
    if (!validate(kind, typed, currency, ctx, setBad)) return;
    sayAnswer(q.id, typed.trim());
  };
  return (
    <div className="say-q" role="group" aria-label={SAY.unsureOne} data-q={q.id}>
      <p className="say-qt">{text}</p>
      {a.kind === 'choice' || leaving ? (
        <div className="say-qa">
          {(leaving || a.kind !== 'choice' ? [{ value: 'leave', label: SAY.leaveOut }] : a.choices).map((ch) => (
            <Btn key={ch.value} sm onClick={() => sayAnswer(q.id, ch.value)}>{ch.label}</Btn>
          ))}
        </div>
      ) : (
        <form className="say-qa" onSubmit={submit}>
          <input className="ui-field say-qin" value={typed} onChange={(e) => { setTyped(e.target.value); setBad(null); }} aria-label={a.label} aria-invalid={bad !== null} inputMode={a.kind === 'amount' ? 'decimal' : 'text'} />
          <Btn type="submit" sm disabled={!typed.trim()}>{SAY.apply}</Btn>
          {bad ? <span className="say-bad" role="alert">{bad}</span> : null}
        </form>
      )}
    </div>
  );
}

/** A said or filled-in part, edited in place: it goes back through the reader as an answer. */
function ChipEdit({ c, ctx, currency, onDone }: { c: Chip; ctx: SayCtx; currency: string; onDone: () => void }) {
  const [typed, setTyped] = useState(c.editValue);
  const [bad, setBad] = useState<string | null>(null);
  const kind = c.edit;
  const apply = () => {
    if (kind === 'who') return;
    if (!validate(kind ?? 'text', typed, currency, ctx, setBad)) return;
    sayAnswer(c.slot, typed.trim());
    onDone();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onDone(); } };
  if (kind === 'who') {
    return (
      <div className="say-edit" onKeyDown={onKey} role="radiogroup" aria-label={SAY.edit(c.label)}>
        {(['paired', 'house'] as const).map((v) => (
          <label key={v} className="say-radio"><input type="radio" name={`who-${c.key}`} checked={c.editValue === v} onChange={() => { if (v === 'paired') sayUnanswer('who'); else sayAnswer('who', v); onDone(); }} />{v === 'house' ? SAY.whoHouse : SAY.whoPaired}</label>
        ))}
      </div>
    );
  }
  return (
    <form className="say-edit" onKeyDown={onKey} onSubmit={(e) => { e.preventDefault(); apply(); }}>
      <input className="ui-field say-qin" autoFocus value={typed} onChange={(e) => { setTyped(e.target.value); setBad(null); }} aria-label={SAY.edit(c.label)} aria-invalid={bad !== null}
        inputMode={kind === 'amount' || kind === 'count' ? 'decimal' : 'text'} placeholder={kind === 'when' ? SAY.whenExample : undefined} />
      <Btn type="submit" sm>{SAY.apply}</Btn>
      <Btn kind="plain" sm onClick={onDone}>{SAY.cancel}</Btn>
      {bad ? <span className="say-bad" role="alert">{bad}</span> : null}
    </form>
  );
}

/** What can be typed into a chip: an amount, a count from 1 to 255, an end (a day and an hour), or words. */
function validate(kind: 'amount' | 'count' | 'text' | 'when' | 'who', value: string, currency: string, ctx: SayCtx, bad: (s: string | null) => void): boolean {
  const v = value.trim();
  let ok = true;
  let why: string = SAY.invalidEdit;
  if (kind === 'amount') ok = parseMoneyText(v, currency as 'USD') !== null;
  else if (kind === 'count') { ok = /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 255; why = SAY.invalidCount; }
  else if (kind === 'when') { ok = readEnds(v, ctx) !== null; why = SAY.invalidWhen; }
  else if (kind === 'text') { ok = v.length > 0 && v.length <= 60; why = SAY.invalidItem; }
  bad(ok ? null : why);
  return ok;
}
