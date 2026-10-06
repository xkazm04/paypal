// Round-2 pieces of the approval window (docs/ux/ROUND-2.md): the "What happens next" path and the
// Why? link. Presentational only; the words come from next.ts and why.ts.
import { Icon, Why } from '../../../shared/ui';
import type { NextStep } from './next';
import type { WhyAnswer } from './why';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/** A small horizontal path of the steps after this decision. The first one is where you are. */
export function NextPath({ steps }: { steps: readonly NextStep[] }) {
  return (
    <section className="dr-next" aria-label="What happens next">
      <h2 className="dr-sec">What happens next</h2>
      <ol className="nx" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => (
          <li key={i} className={cx('nx-s', s.by, s.now && 'now')} aria-current={s.now ? 'step' : undefined}>
            <span className="nx-n" aria-hidden="true">{i + 1}</span>
            <span className="nx-t">{s.text}</span>
            {i < steps.length - 1 ? <Icon name="arrow" size={14} className="nx-a" /> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** "Why?" with a two-sentence answer. */
export function WhyNote({ why, className }: { why: WhyAnswer; className?: string }) {
  return (
    <Why question={why.question} className={className}>
      <p>{why.lines[0]}</p>
      <p>{why.lines[1]}</p>
    </Why>
  );
}
