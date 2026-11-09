// ExplainHint (not the caption `Hint` in components.tsx): a long explanation one layer down, behind
// a small (i) beside its short visible line. It opens the shared Popover, so mouse, keyboard and
// touch all reach it. Safety text never goes here: what happens if the owner does nothing, approval
// lines, refusals, errors and sample-data labels stay on the page. Display only.
import { useState, type ReactNode } from 'react';
import { CONNECTIONS_HINT } from '../../lib/words';
import { Popover } from './Popover';
import { whyName } from './why';
import './Hint.css';

export type ExplainHintProps = {
  /** What the explanation is about: the popover's title and the button's unique accessible name. */
  label: string;
  /** The short visible line the button sits after. */
  line?: ReactNode;
  children: ReactNode;
};

export function ExplainHint({ label, line, children }: ExplainHintProps) {
  const [a, setA] = useState<HTMLElement | null>(null);
  return (
    <>
      {line}
      <button type="button" className="ui-hint-i" aria-expanded={!!a} aria-label={whyName(CONNECTIONS_HINT.more, label)}
        onClick={(e) => { e.stopPropagation(); const t = e.currentTarget; setA((x) => (x ? null : t)); }}>
        <span aria-hidden="true">i</span>
      </button>
      {a ? <Popover anchor={a} onClose={() => setA(null)} title={label} className="ui-why-pop"><div className="ui-why-a">{children}</div></Popover> : null}
    </>
  );
}
