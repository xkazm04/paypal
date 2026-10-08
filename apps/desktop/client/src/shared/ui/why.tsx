// "Why?" (docs/ux/ROUND-2.md; approval window, Shield, Rescue, Book, Tumbler): a small link
// that opens a popover with a short answer the caller writes from facts already on screen.
// Deterministic text only: no model, no guess, no number that is not already in the data.
import { useState, type ReactNode } from 'react';
import { Popover } from './Popover';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/** A unique accessible name ("Proof, Scam check: looks safe."): several Why links share one visible
 *  word, so the name carries the question too; it starts with the visible word (WCAG 2.5.3). */
export function whyName(label: ReactNode, question: ReactNode): string | undefined {
  if (typeof label !== 'string' || typeof question !== 'string' || !question.trim()) return undefined;
  return `${label}, ${question.trim()}`;
}

export function Why({ question, children, label = 'Why?', className }: { question: ReactNode; children: ReactNode; label?: ReactNode; className?: string }) {
  const [a, setA] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" className={cx('ui-why', className)} aria-expanded={!!a} aria-label={whyName(label, question)} onClick={(e) => { e.stopPropagation(); setA((x) => (x ? null : e.currentTarget)); }}>{label}</button>
      {a ? (
        <Popover anchor={a} onClose={() => setA(null)} title={typeof question === 'string' ? question : undefined} className="ui-why-pop">
          {typeof question === 'string' ? null : <h3>{question}</h3>}
          <div className="ui-why-a">{children}</div>
        </Popover>
      ) : null}
    </>
  );
}
