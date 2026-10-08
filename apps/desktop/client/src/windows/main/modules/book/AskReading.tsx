// "I read this as:" - the wallet's own reading of a typed question, as chips the owner can remove or
// change (time and grouping), and the gentle line when a question did not read. Display only: the
// reading comes from ./understand.ts and every change is composed into the closed query again.
import type { BookGroup } from '@bindings/BookGroup';
import {
  GROUP_CHOICES, GROUP_TEXT, groupChip, MAX_ASK, replaceChip, SUGGESTIONS, WHEN_CHOICES, whenChip, whenText, type AskCtx, type ReadingChip, type Unsure, type When,
} from './understand';

/** The honest note under every reading. */
export const NO_AI = 'Understood by your wallet · no AI involved';

const whenKey = (w: When): string => JSON.stringify(w);

export function ReadingChips({ reading, ctx, onChange }: { reading: readonly ReadingChip[]; ctx: Pick<AskCtx, 'now' | 'offsetMin'>; onChange: (next: ReadingChip[]) => void }) {
  const groups = reading.flatMap((c) => (c.part.group ? [c.part.group] : []));
  return (
    <div className="rd" role="group" aria-label="How your question was read">
      <span className="rd-h">I read this as:</span>
      <ul className="rd-chips">
        {reading.map((c) => {
          const w = c.part.when;
          const g = c.part.group;
          let body = <span className="rd-t">{c.text}</span>;
          if (w) {
            const choices = WHEN_CHOICES.some((x) => whenKey(x) === whenKey(w)) ? WHEN_CHOICES : [w, ...WHEN_CHOICES];
            body = (
              <select className="rd-sel" aria-label="When" value={whenKey(w)} onChange={(e) => onChange(replaceChip(reading, c.id, whenChip(JSON.parse(e.target.value) as When, ctx)))}>
                {choices.map((x) => <option key={whenKey(x)} value={whenKey(x)}>{whenText(x)}</option>)}
              </select>
            );
          } else if (g) {
            body = (
              <select className="rd-sel" aria-label="One line per" value={g} onChange={(e) => onChange(replaceChip(reading, c.id, groupChip(e.target.value as BookGroup)))}>
                {GROUP_CHOICES.filter((x) => x === g || !groups.includes(x)).map((x) => <option key={x} value={x}>{GROUP_TEXT[x]}</option>)}
              </select>
            );
          }
          const fixed = w?.k === 'any';
          return (
            <li key={c.id} className={`rd-chip rd-${c.slot}`} title={c.title} data-chip={c.id}>
              {body}
              {fixed ? null : <button type="button" className="rd-x" aria-label={`Remove ${c.text}`} title="Leave this out and ask again" onClick={() => onChange(replaceChip(reading, c.id, null))}>×</button>}
            </li>
          );
        })}
      </ul>
      <span className="ui-hint rd-ai">{NO_AI}</span>
    </div>
  );
}

const WHY: Record<Unsure['why'], string> = {
  words: 'I didn’t understand',
  too_long: `That is longer than ${MAX_ASK} characters. Try a shorter question.`,
  empty: 'Type a question first.',
  nothing: 'I couldn’t find anything to look up in that.',
  two_times: 'That names two times. Pick one:',
  too_many_groups: 'I can split an answer two ways at most, not',
};

/** The words the wallet could not read, and phrasings that would work. */
export function UnsureLine({ unsure, onTry }: { unsure: Unsure; onTry: (text: string) => void }) {
  const quoted = unsure.unsure.map((w) => `“${w}”`).join(', ');
  return (
    <div className="rd rd-unsure" role="status">
      <p className="rd-msg">{WHY[unsure.why]}{unsure.unsure.length ? <> <b>{quoted}</b>.</> : null}</p>
      <div className="rd-try">
        <span className="rd-h">Try:</span>
        {SUGGESTIONS.map((s) => <button key={s} type="button" className="rd-sug" onClick={() => onTry(s)}>{s}</button>)}
      </div>
      <span className="ui-hint rd-ai">{NO_AI}</span>
    </div>
  );
}
