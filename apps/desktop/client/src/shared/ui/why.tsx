// "Why?" (docs/ux/ROUND-2.md; approval window, Shield, Rescue, Book, Tumbler): a small link
// that opens a popover with a short answer the caller writes from facts already on screen.
// Deterministic text only: no model, no guess, no number that is not already in the data.
import { useState, type ReactNode } from 'react';
import { Popover } from './Popover';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export function Why({ question, children, label = 'Why?', className }: { question: ReactNode; children: ReactNode; label?: ReactNode; className?: string }) {
  const [a, setA] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" className={cx('ui-why', className)} aria-expanded={!!a} onClick={(e) => { e.stopPropagation(); setA((x) => (x ? null : e.currentTarget)); }}>{label}</button>
      {a ? (
        <Popover anchor={a} onClose={() => setA(null)} title={typeof question === 'string' ? question : undefined} className="ui-why-pop">
          {typeof question === 'string' ? null : <h3>{question}</h3>}
          <div className="ui-why-a">{children}</div>
        </Popover>
      ) : null}
    </>
  );
}
