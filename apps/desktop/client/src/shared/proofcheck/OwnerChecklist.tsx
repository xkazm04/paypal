// The Proof page's "Owner's checklist": each owner decision in the file being checked, read as a
// receipt. The six lines in the owner's words, whether the owner key signed the decision for its one step,
// and whether the lines that were to be checked later passed before money moved. Read from the same file
// the checks just ran on, so a tamper shows here too. Unknowns stay dashed; nothing here is a button.
import { useEffect, useId, useState } from 'react';
import { decisionReceipts, type DecisionReceipt } from '../../lib/proof/receipts';
import { PROOF_RECEIPT as W } from '../../lib/words';
import { Chip } from '../ui';

const time = (at: number | null): string =>
  at === null ? '—' : new Date(at * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function OwnerChecklist({ document, level = 3 }: { document: unknown; level?: 2 | 3 }) {
  const H = `h${level}` as 'h2' | 'h3';
  const id = useId();
  const [receipts, setReceipts] = useState<DecisionReceipt[] | null>(null);
  useEffect(() => {
    let live = true;
    setReceipts(null);
    decisionReceipts(document).then((r) => { if (live) setReceipts(r); }, () => { if (live) setReceipts([]); });
    return () => { live = false; };
  }, [document]);
  if (receipts === null || receipts.length === 0) return null;
  return (
    <section className="pk-owner" aria-labelledby={`${id}-head`}>
      <H id={`${id}-head`} className="pk-h pk-sub">{W.head}</H>
      <p className="ui-hint">{W.intro}</p>
      <ol className="pk-receipts">
        {receipts.map((r) => <Receipt key={r.seq} r={r} level={level} />)}
      </ol>
      <p className="ui-hint pk-keynote">{W.keyNote}</p>
    </section>
  );
}

function Receipt({ r, level }: { r: DecisionReceipt; level: 2 | 3 }) {
  const H4 = `h${level + 1}` as 'h3' | 'h4';
  const bad = r.signature === 'not-owner' || r.linesState === 'changed' || r.linesState === 'unreadable';
  const step = (r.operation !== null ? W.step[r.operation] : undefined) ?? W.stepUnknown;
  const sig = r.signature === 'signed' ? <Chip tone="ok">{W.signed(time(r.at))}</Chip>
    : r.signature === 'not-owner' ? <Chip tone="red">{W.notOwner}</Chip>
      : r.signature === 'unchecked' ? <Chip tone="dashed">{W.unchecked}</Chip>
        : <Chip tone="dashed">{W.notSigned}</Chip>;
  return (
    <li className={`pk-receipt${bad ? ' bad' : ''}`} data-receipt={r.operation ?? ''}>
      <div className="pk-rhead">
        <H4 className="pk-rstep">{step}</H4>
        {sig}
      </div>
      {r.lines && r.linesState !== 'unreadable' ? (
        <ul className="pk-rlines" aria-label={step}>
          {r.lines.map((l) => (
            <li key={l.id} className={`pk-rline ${l.status}`}>
              <span className="pk-rmark" aria-hidden="true">{l.status === 'pass' ? '✓' : l.status === 'fail' ? '✗' : '–'}</span>
              <span className="sr-only">{W.status[l.status] ?? l.status}: </span>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className={`pk-rnote${r.linesState === 'again' ? '' : bad ? ' bad' : ' dashed'}`}>{W.lines[r.linesState]}</p>
      {r.later.waiting > 0 ? (
        <p className={`pk-rnote${r.later.beforeMoney || r.later.passed === r.later.waiting ? '' : ' dashed'}`}>{W.later(r.later.waiting, r.later.passed, r.later.beforeMoney)}</p>
      ) : null}
    </li>
  );
}
