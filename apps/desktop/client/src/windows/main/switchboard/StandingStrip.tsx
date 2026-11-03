// The three standing questions, always answered (spark the-proof-table; standing.ts derives them):
// Is my money safe right now? Does anything need me? What happens if I do nothing? Drawn in the kit's
// facts strip (.ui-facts): the question, the short answer in its tone (a dim answer is "not available
// yet", never 0, never green) and one line of detail. Each fact is also a key: pressing it asks the
// board that question.
import { BOARD_STANDING } from '../../../lib/words';
import { Hourglass } from '../../../shared/ui';
import { Shape } from './parts';
import type { StandingAnswer } from './standing';

const ASKS = BOARD_STANDING.asks;

/** The answer's mark: never a tick for an answer that is not known yet (a dashed box instead). */
function Mark({ a }: { a: StandingAnswer }) {
  if (a.key === 'nothing') return <Hourglass className="sb-fact-ic" />;
  if (a.tone === 'dim') return <span className="sb-fact-na" aria-hidden="true" />;
  if (a.key === 'needs') return <Shape fate={a.tone === 'gold' ? 'needs' : 'paid'} size={14} />;
  return <Shape fate={a.tone === 'refuse' ? 'stopped' : 'paid'} size={14} />;
}

export function StandingStrip({ answers, onAsk, busy }: { answers: readonly StandingAnswer[]; onAsk: (q: string) => void; busy: boolean }) {
  return (
    <section className="sb-standing" aria-label={BOARD_STANDING.label}>
      <dl className="ui-facts">
        {answers.map((a) => (
          <div key={a.key} className={`ui-fact${a.tone === 'dim' ? ' unknown' : ''}`} data-standing={a.key} data-tone={a.tone === 'dim' ? undefined : a.tone}>
            <dt>{BOARD_STANDING.question[a.key]}</dt>
            <dd className="sb-fact-v"><Mark a={a} />{a.headline}</dd>
            <dd className="note">{a.detail ?? ' '}</dd>
            <button type="button" className="sb-fact-ask" disabled={busy} aria-label={`${BOARD_STANDING.question[a.key]} ${a.headline}. ${BOARD_STANDING.ask(ASKS[a.key])}`}
              title={BOARD_STANDING.ask(ASKS[a.key])} onClick={() => onAsk(ASKS[a.key])} />
          </div>
        ))}
      </dl>
    </section>
  );
}
