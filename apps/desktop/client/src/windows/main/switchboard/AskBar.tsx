// The ask bar (spark the-proof-table): one field ("/" focuses it), Ask, Stop while an answer is on its
// way, and two or three suggested questions that are not already offered by an empty slot. On submit
// the field clears at once and the says area shows what she asked.
import { useState, type FormEvent, type RefObject } from 'react';
import { BOARD_ASK, BOARD_ASK_LABEL, BOARD_ASK_PLACEHOLDER, BOARD_BUSY, BOARD_CHIPS_LABEL, BOARD_STOP } from '../../../lib/words';
import { Btn } from '../../../shared/ui';

export function AskBar({ busy, chips, onAsk, onCancel, inputRef }: {
  busy: boolean;
  chips: readonly string[];
  onAsk: (q: string) => void;
  onCancel: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
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
    <form className="sb-ask" onSubmit={submit} autoComplete="off" aria-label={BOARD_ASK_LABEL}>
      <div className="sb-ask-row">
        <div className="sb-ask-field">
          <input ref={inputRef} className="ui-field sb-ask-input" aria-label={BOARD_ASK_LABEL} placeholder={busy ? `${BOARD_BUSY}…` : BOARD_ASK_PLACEHOLDER}
            value={text} onChange={(e) => setText(e.target.value)} maxLength={400} />
          <span className="kbd sb-ask-kbd" aria-hidden="true">/</span>
        </div>
        {busy ? <Btn className="sb-ask-go" onClick={onCancel} data-cancel>{BOARD_STOP}</Btn> : <Btn type="submit" kind="primary" className="sb-ask-go">{BOARD_ASK}</Btn>}
      </div>
      <div className="sb-chips" role="group" aria-label={BOARD_CHIPS_LABEL}>
        {chips.map((c) => <button key={c} type="button" className="ui-filter sb-chip" disabled={busy} onClick={() => onAsk(c)}>{c}</button>)}
      </div>
    </form>
  );
}
