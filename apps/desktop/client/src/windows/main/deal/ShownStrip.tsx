// "What you were shown": a quiet one-line strip on a deal its deadline ended, saying what the owner
// was offered before the safe default ran (shown, notified or why not, opened) and that no money
// moved. Read-only, from the same verified record as "Who decided"; nothing shows on any other deal.
import type { Deal } from '@bindings/Deal';
import { nowUnix } from '../../../lib/format';
import { useQuery } from '../../../lib/hooks';
import { SHOWN_TITLE } from '../../../lib/words';
import { Hourglass } from '../../../shared/ui';
import { shownParts, shownStep } from './shown';
import './whatYouWereShown.css';

export function ShownStrip({ deal }: { deal: Deal }) {
  const q = useQuery('deal_history', { deal_id: deal.id }, { refreshOn: ['deal:changed', 'receipt:created'] });
  const step = shownStep(q.data?.steps ?? []);
  if (!step) return null;
  const parts = shownParts(step, nowUnix());
  return (
    <p className="dv-shown">
      <Hourglass />
      <span className="lbl">{SHOWN_TITLE}</span>
      {parts.map((p, i) => (
        <span key={i} className={i === 0 ? 'end' : i === parts.length - 1 ? 'money' : 'rung'}>{p}</span>
      ))}
    </p>
  );
}
