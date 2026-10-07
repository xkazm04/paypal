// "Who decided": this deal's decisions from the wallet's own verified record (deal_history), one
// line each: when, what happened in plain words, and who decided it (you, a rule you signed, your
// shop rules after the buyer approved, or the safe default). A refusal says PayPal was never
// asked. The same steps the Dial's Rewind replays; read-only.
import type { Deal } from '@bindings/Deal';
import type { HistoryStep } from '@bindings/HistoryStep';
import { useQuery } from '../../../lib/hooks';
import { WalletNotice } from '../../../shared/honesty';
import { Loading } from '../../../shared/ui';
import { isMoneyCall, isRefusal, stepSentence, stepTime, tickTone, whoDecided } from '../logic';
import { TickMark } from '../Rewind';

/** "You · PayPal call", "Your rules · no PayPal call", "Refused · PayPal never asked". */
export function decidedLine(s: HistoryStep): string {
  if (isRefusal(s)) return 'Refused · PayPal never asked';
  const call = s.paypal.type === 'call' ? (isMoneyCall(s) ? 'PayPal call' : 'PayPal checked') : 'no PayPal call';
  return [whoDecided(s.authority), call].filter(Boolean).join(' · ');
}

/** The steps worth a line here: every decision, every money call and every refusal. */
export function decisionSteps(steps: readonly HistoryStep[]): HistoryStep[] {
  return steps.filter((s) => isMoneyCall(s) || isRefusal(s) || s.kind === 'approved_by_buyer'
    || (s.authority.type !== 'none' && s.authority.type !== 'agent_intent'));
}

export function WhoDecided({ deal, title }: { deal: Deal; title: string }) {
  const q = useQuery('deal_history', { deal_id: deal.id }, { refreshOn: ['deal:changed', 'receipt:created'] });
  const steps = decisionSteps(q.data?.steps ?? []);
  return (
    <section className="dv-who-decided" aria-label="Who decided">
      <header>
        <h3>Who decided</h3>
        <span className="dim">from the wallet’s own record</span>
      </header>
      {q.error ? <WalletNotice error={q.error} what="The deal’s record" />
        : !q.data ? <Loading what="the record" />
          : !steps.length ? <p className="dv-wd-none">Nobody has decided anything on this deal yet. Nothing was sent to PayPal.</p> : (
            <ol>
              {steps.map((s) => {
                const money = isMoneyCall(s) || isRefusal(s);
                const tone = tickTone(s);
                return (
                  <li key={s.seq} className={money ? `t-${tone}` : ''}>
                    {money ? <TickMark tone={tone} /> : <i className="dv-wd-dot" aria-hidden="true" />}
                    <time>{stepTime(s.at)}</time>
                    <span className="say">{stepSentence(s, { title, side: deal.side })}</span>
                    <span className="by">{decidedLine(s)}</span>
                  </li>
                );
              })}
            </ol>
          )}
      {q.data?.truncated ? <p className="dim">Older steps are in Book’s record.</p> : null}
    </section>
  );
}
