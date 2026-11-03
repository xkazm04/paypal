// The chat rail: the engine chip, the answer area (slot), the conversation, suggestion chips and the
// input. Every assistant sentence is React text: never HTML, never a link. A reply with parts that could
// not be shown says so; an answer that came from the scripted preview because the live engine failed
// says so. Asking is cancellable. Under a reply that changed the screen, one line says what changed
// (region.ts); a reply that arrived after she moved the board says it changed nothing and offers its
// layout instead.
import { useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import type { EngineInfo } from '../../../lib/assistant';
import {
  BOARD_ASK, BOARD_ASK_LABEL, BOARD_ASK_PLACEHOLDER, BOARD_BUSY, BOARD_CANCELLED, BOARD_CHANGED, BOARD_CHIPS, BOARD_CHIPS_LABEL, BOARD_DROPPED, BOARD_EMPTY_REPLY, BOARD_ENGINE_LIVE, BOARD_ENGINE_SCRIPTED,
  BOARD_FALLBACK_NOTICE, BOARD_HINT, BOARD_RAIL_LABEL, BOARD_RAIL_TITLE, BOARD_SAYS, BOARD_STOP, BOARD_THREAD_EMPTY, BOARD_THREAD_LABEL, BOARD_YOU,
} from '../../../lib/words';
import { Btn, Chip } from '../../../shared/ui';

export type Turn = {
  id: number;
  question: string;
  /** null while waiting. */
  answer: null | {
    say: string; dropped: number; fellBack: boolean; cancelled: boolean; engine: EngineInfo | null; hadOps: boolean;
    /** What this reply changed on screen, in one plain line (region.ts changeLine); null when nothing. */
    changed: string | null;
    /** The owner undid this reply's change. */
    undone: boolean;
    /** She moved the board while it answered, so its layout was held back; it is offered, not applied. */
    held: boolean;
  };
};

export const engineWords = (e: EngineInfo): string => (e.id === 'scripted' ? BOARD_ENGINE_SCRIPTED : BOARD_ENGINE_LIVE);

export function ChatRail({ engine, busy, turns, onAsk, onCancel, onApplyHeld, inputRef, children }: {
  engine: EngineInfo;
  busy: boolean;
  turns: readonly Turn[];
  onAsk: (q: string) => void;
  onCancel: () => void;
  /** Apply the layout a turn's reply suggested while she was moving the board. */
  onApplyHeld?: (turn: number) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** The answer area. */
  children: ReactNode;
}) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setText('');
    onAsk(q);
  };
  return (
    <aside className="sb-rail" aria-label={BOARD_RAIL_LABEL}>
      <header className="sb-rail-h">
        <b>{BOARD_RAIL_TITLE}</b>
        <Chip tone={engine.id === 'scripted' ? 'dashed' : 'teal'} title={engineWords(engine)} className="sb-engine"><span data-engine={engine.id}>{engineWords(engine)}</span></Chip>
      </header>
      {children}
      <div className="sb-thread" role="log" aria-label={BOARD_THREAD_LABEL} aria-live="polite">
        {turns.length === 0 ? <p className="sb-quiet">{BOARD_THREAD_EMPTY}</p> : null}
        {turns.map((t) => (
          <div key={t.id} className="sb-turn">
            <p className="sb-q"><span className="sb-who">{BOARD_YOU}</span>{t.question}</p>
            {t.answer === null ? <p className="sb-busy" role="status"><span className="ui-spin" aria-hidden="true" />{BOARD_BUSY}</p> : (
              <div className="sb-a">
                <span className="sb-who">{BOARD_SAYS}</span>
                {t.answer.cancelled ? <p>{BOARD_CANCELLED}</p> : t.answer.say ? <p className="sb-say">{t.answer.say}</p> : !t.answer.hadOps ? <p>{BOARD_EMPTY_REPLY}</p> : null}
                {t.answer.changed ? (
                  <p className="sb-changed" data-changed={t.answer.undone ? 'undone' : 'applied'} title={BOARD_CHANGED.label}>
                    {t.answer.changed}{t.answer.undone ? <span className="sb-undone"> {BOARD_CHANGED.undone}</span> : null}
                  </p>
                ) : null}
                {t.answer.held ? (
                  <p className="sb-changed" data-changed="held" title={BOARD_CHANGED.label}>
                    {BOARD_CHANGED.held}{' '}
                    <button type="button" className="sb-linkbtn" onClick={() => onApplyHeld?.(t.id)} data-apply-held={t.id}>{BOARD_CHANGED.applyHeld}</button>
                  </p>
                ) : null}
                {t.answer.fellBack ? <p className="sb-note" data-note="fallback">{BOARD_FALLBACK_NOTICE}</p> : null}
                {t.answer.dropped > 0 ? <p className="sb-note" data-note="dropped">{BOARD_DROPPED(t.answer.dropped)}</p> : null}
              </div>
            )}
          </div>
        ))}
      </div>
      <form className="sb-ask" onSubmit={submit} autoComplete="off">
        <div className="sb-chips" role="group" aria-label={BOARD_CHIPS_LABEL}>
          {BOARD_CHIPS.map((c) => <button key={c} type="button" className="sb-chip" disabled={busy} onClick={() => onAsk(c)}>{c}</button>)}
        </div>
        <div className="sb-inputrow">
          <input ref={inputRef} className="ui-field" aria-label={BOARD_ASK_LABEL} placeholder={BOARD_ASK_PLACEHOLDER} value={text} onChange={(e) => setText(e.target.value)} maxLength={400} />
          {busy ? <Btn onClick={onCancel} data-cancel>{BOARD_STOP}</Btn> : <Btn type="submit" disabled={!text.trim()}>{BOARD_ASK}</Btn>}
        </div>
        <p className="sb-hint">{BOARD_HINT}</p>
      </form>
    </aside>
  );
}
