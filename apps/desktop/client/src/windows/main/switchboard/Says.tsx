// The says area (spark the-proof-table): the kicker ("The board says", what she asked), ONE sentence
// set as large as it fits, and one line under it that says what changed on screen, with Undo.
// - Answered: the reply's sentence. Its figures (figures.ts) are keys only where they equal the board;
//   hovering or focusing one lights its proof on the board column, a press holds it (local state,
//   never an op), and the line under the sentence says what the figure is.
// - Waiting: "You asked" at once, then the engine's REAL state in plain words (which engine is
//   answering; the scripted preview says so) and the seconds since she asked. No filler, no delay;
//   Stop is in the ask bar. (registry model-composed-workspace conductor-turn-flow)
// - Opening (nothing asked yet): a line composed from the three standing answers, labelled "From
//   your board, not an answer". It is never presented as a reply.
// Every sentence is React text: never HTML, never a link.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EngineInfo } from '../../../lib/assistant';
import {
  BOARD_CANCELLED, BOARD_CHANGED, BOARD_DROPPED, BOARD_EMPTY_REPLY, BOARD_ENGINE_LIVE, BOARD_ENGINE_SCRIPTED, BOARD_FALLBACK_NOTICE, BOARD_REGION, BOARD_REPAIRED, BOARD_SAYS,
  BOARD_SAYS_AREA, BOARD_WAIT,
} from '../../../lib/words';
import { Btn } from '../../../shared/ui';
import { findFigures, type Figure } from './figures';
import type { StandingAnswer } from './standing';
import type { BoardModel } from './useBoardModel';

export type Turn = {
  id: number;
  question: string;
  /** null while waiting. */
  answer: null | {
    say: string; dropped: number; fellBack: boolean; cancelled: boolean; engine: EngineInfo | null; hadOps: boolean;
    /** The reply was tidied by the validator before it was shown. */
    repaired: boolean;
    /** What this reply changed on screen, in one plain line (region.ts changeLine); null when nothing. */
    changed: string | null;
    /** The owner undid this reply's change. */
    undone: boolean;
    /** She moved the board while it answered, so its layout was held back; it is offered, not applied. */
    held: boolean;
  };
};

/** What the engine chip says. The engine id is the one machinery word the product shows (board.ts). */
export const engineWords = (e: EngineInfo): string => (e.id === 'scripted' ? BOARD_ENGINE_SCRIPTED : BOARD_ENGINE_LIVE);

/** The engine answering the question in flight, as useBoardAssistant reports it. */
export type Answering = { engine: EngineInfo; fellBack: boolean } | null;

/** The sentence is set by its length: it must fit the says box at the largest step that holds it. */
const HERO_STEPS = [{ max: 130, cls: 'is-h1' }, { max: 210, cls: 'is-h2' }, { max: 340, cls: 'is-h3' }, { max: Infinity, cls: 'is-h4' }] as const;
export const heroStep = (len: number): number => HERO_STEPS.findIndex((s) => len <= s.max);

/** The opening line: the three standing headlines as one line, each said once. */
export function openingLine(answers: readonly StandingAnswer[]): string {
  const seen = new Set<string>();
  return answers.map((a) => a.headline).filter((h) => (seen.has(h) ? false : (seen.add(h), true))).map((h) => `${h}.`).join(' ');
}

export type FigureHost = {
  /** The figure the pointer or the keyboard is on, else null. */
  on: Figure | null;
  /** The figure she pressed to keep lit, else null. */
  held: Figure | null;
  setOn: (f: Figure | null) => void;
  toggleHeld: (f: Figure) => void;
};

const sameFigure = (a: Figure | null, b: Figure): boolean => a !== null && a.start === b.start && a.text === b.text;

/** One sentence with its figures as keys. Steps its size down until it fits its box. */
function Sentence({ text, model, figs, quiet }: { text: string; model: BoardModel; figs: FigureHost; quiet?: boolean }) {
  const figures = useMemo(() => findFigures(text, model), [text, model]);
  // Keyed by its text (below), so a new sentence starts again at the step its length allows.
  const [step, setStep] = useState(() => heroStep(text.length));
  const el = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const s = el.current;
    const box = s?.parentElement;
    if (!s || !box || step >= HERO_STEPS.length - 1) return;
    if (s.scrollHeight > box.clientHeight + 1) setStep(step + 1);
  }, [step, text]);
  const parts: ReactNode[] = [];
  let at = 0;
  figures.forEach((f, i) => {
    if (f.start > at) parts.push(text.slice(at, f.start));
    const on = sameFigure(figs.on, f);
    const held = sameFigure(figs.held, f);
    parts.push(
      <button key={`f${i}`} type="button" className={`ui-fig${on ? ' is-on' : ''}${held ? ' is-held' : ''}`} data-tone={f.tone} data-fig={f.text}
        aria-label={`${f.text}. ${f.what}`} aria-pressed={held} title={BOARD_SAYS_AREA.holdTitle}
        onPointerEnter={() => figs.setOn(f)} onPointerLeave={() => figs.setOn(null)} onFocus={() => figs.setOn(f)} onBlur={() => figs.setOn(null)}
        onClick={() => figs.toggleHeld(f)}>
        <span className="num">{f.text}</span>
      </button>,
    );
    at = f.end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <p ref={el} className={`ui-sentence ${HERO_STEPS[step]!.cls}${quiet ? ' is-quiet' : ''} sb-say`} data-step={HERO_STEPS[step]!.cls}>{parts}</p>;
}

/** The wait, narrated: which engine is answering, and how long since she asked. */
function Waiting({ answering, since }: { answering: Answering; since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - since) / 1000));
  const words = !answering || answering.engine.id === 'scripted'
    ? (answering?.fellBack ? BOARD_WAIT.fallback : BOARD_WAIT.scripted)
    : BOARD_WAIT.live(engineWords(answering.engine));
  return (
    <div className="sb-wait sb-busy" role="status" data-waiting={answering?.fellBack ? 'fallback' : answering?.engine.id ?? 'scripted'}>
      <p className="ui-sentence is-h3 sb-wait-t">{words} <span className="num sb-wait-s" title={BOARD_WAIT.secondsLabel}>{BOARD_WAIT.seconds(secs)}</span></p>
      <span className="sb-sweep" aria-hidden="true" />
      <p className="sb-wait-n">{BOARD_WAIT.moveWins}</p>
    </div>
  );
}

export type SaysProps = {
  model: BoardModel;
  turn: Turn | null;
  /** When the question in flight was asked (Date.now()), for the wait. */
  askedAt: number;
  answering: Answering;
  opening: readonly StandingAnswer[];
  figs: FigureHost;
  canUndo: boolean;
  onUndo: () => void;
  onApplyHeld: (turn: number) => void;
};

export function Says({ model, turn, askedAt, answering, opening, figs, canUndo, onUndo, onApplyHeld }: SaysProps) {
  const a = turn?.answer ?? null;
  const waiting = !!turn && a === null;
  let body: ReactNode;
  const line = !turn ? openingLine(opening) : '';
  if (!turn) body = <Sentence key={line} text={line} model={model} figs={figs} />;
  else if (waiting) body = <Waiting answering={answering} since={askedAt} />;
  else if (a!.cancelled) body = <p className="ui-sentence is-h1 is-quiet sb-say">{BOARD_CANCELLED}</p>;
  else if (a!.say) body = <Sentence key={`${turn.id}:${a!.say}`} text={a!.say} model={model} figs={figs} />;
  else body = <p className="ui-sentence is-h3 is-quiet sb-say">{a!.hadOps ? BOARD_SAYS_AREA.shown : BOARD_EMPTY_REPLY}</p>;

  const fig = figs.on ?? figs.held;
  return (
    <section className="sb-says" aria-label={BOARD_SAYS_AREA.label} data-says={!turn ? 'opening' : waiting ? 'waiting' : 'answered'}>
      <div className="sb-kick">
        <span className="kicker">{BOARD_SAYS}</span>
        {!turn ? <span className="ui-chip line" data-opening title={BOARD_SAYS_AREA.openingTitle}>{BOARD_SAYS_AREA.opening}</span> : null}
        {turn ? <span className="sb-asked">{BOARD_SAYS_AREA.asked} <q>{turn.question}</q></span> : null}
        {a?.fellBack ? <span className="ui-chip coral" data-note="fallback" title={BOARD_FALLBACK_NOTICE}>{BOARD_SAYS_AREA.fallback}</span> : null}
        {a && a.dropped > 0 ? <span className="ui-chip line" data-note="dropped">{BOARD_DROPPED(a.dropped)}</span> : null}
        {a?.repaired ? <span className="ui-chip line" data-note="repaired" title={BOARD_REPAIRED}>{BOARD_SAYS_AREA.repaired}</span> : null}
      </div>
      <div className="sb-says-b">{body}</div>
      <div className="sb-changedrow" role="group" aria-label={BOARD_CHANGED.label}>
        {fig ? (
          <p className="sb-proof" role="status" data-proof aria-label={BOARD_SAYS_AREA.figureNote}><span className="sb-proof-k" data-tone={fig.tone} aria-hidden="true" />{fig.what}</p>
        ) : a?.held ? (
          <p className="sb-changed" data-changed="held">
            {BOARD_CHANGED.held}{' '}
            <Btn sm kind="plain" onClick={() => onApplyHeld(turn!.id)} data-apply-held={turn!.id}>{BOARD_CHANGED.applyHeld}</Btn>
          </p>
        ) : a?.changed ? (
          <p className="sb-changed" data-changed={a.undone ? 'undone' : 'applied'}>
            <span className="sb-changed-t">{a.changed}</span>{a.undone ? <span className="sb-undone"> {BOARD_CHANGED.undone}</span> : null}
          </p>
        ) : <p className="sb-changed" />}
        <Btn sm className="sb-layout-undo" disabled={!canUndo} onClick={onUndo} title={canUndo ? BOARD_REGION.undoTitle : BOARD_REGION.undoNone} data-layout-undo={canUndo ? 'ready' : 'none'}>{BOARD_REGION.undo}</Btn>
      </div>
    </section>
  );
}
