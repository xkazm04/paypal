// The what-if (Layer 1): a scoreboard of outcomes, now → with your change, and a compact table of
// only the deals whose answer changes. Unchanged deals fold into one line until asked for. Every
// answer is Rust's own check (mandate_simulate); a deal it could not rebuild shows as not checked.
import { useState } from 'react';
import type { SimulatedLine } from '@bindings/SimulatedLine';
import type { SimulatedVerdict } from '@bindings/SimulatedVerdict';
import type { WalletError } from '../../../lib/contract';
import { clockLabel, formatMoney } from '../../../lib/format';
import { WalletNotice } from '../../../shared/honesty';
import { Btn, Chip, Empty, Loading, type ChipTone } from '../../../shared/ui';
import { refusalWords } from '../mandateDraft';
import { changed, counts, OUTCOME_LABEL, OUTCOMES, outcomeOf, verdictWords, type Outcome } from './simulation';

export const OUTCOME_TONE: Record<Outcome, ChipTone> = { refused: 'red', asks: 'gold', policy: 'teal', unknown: 'dashed' };

/** The outcome as a chip, with the rule in words beside it (refusals and questions only). */
export function Verdict({ v, why = true }: { v: SimulatedVerdict; why?: boolean }) {
  const o = outcomeOf(v);
  const words = verdictWords(v);
  return (
    <span className="ow-vd" title={words}>
      <Chip tone={OUTCOME_TONE[o]}>{OUTCOME_LABEL[o]}</Chip>
      {why && (v.type === 'refuse' || v.type === 'ask') ? <span className="why">{words}</span> : null}
    </span>
  );
}

/** Outcome counts, now → with your change. lines null = no answer yet: every cell is a dash. */
export function Scoreboard({ lines, signedName, draftName }: { lines: readonly SimulatedLine[] | null; signedName: string; draftName: string }) {
  const a = lines ? counts(lines, 'before') : null;
  const b = lines ? counts(lines, 'after') : null;
  return (
    <div className="ow-score" role="group" aria-label={`Outcomes this week: ${signedName} → ${draftName}`}>
      {OUTCOMES.map((o) => {
        const x = a?.[o];
        const y = b?.[o];
        const moved = x !== undefined && y !== undefined && x !== y;
        return (
          <div key={o} className={`sc ${o} ${moved ? 'moved' : ''} ${lines ? '' : 'na'}`}>
            <span className="k">{OUTCOME_LABEL[o]}</span>
            <span className="v">
              {x ?? '—'}
              {moved ? <span className="to">→ {y}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Rows({ lines }: { lines: readonly SimulatedLine[] }) {
  return (
    <>
      {lines.map((l) => (
        <tr key={l.deal_id} className={changed(l) ? 'chg' : ''}>
          <td className="t">{l.at ? clockLabel(l.at) : '—'}</td>
          <td className="clip" title={`${l.label} · ${l.title}`}>
            <span className="id">{l.label}</span>
            <span className="it">{l.title}</span>
          </td>
          <td className="num">{formatMoney(l.amount)}</td>
          <td><Verdict v={l.before} /></td>
          <td>{changed(l) ? <Verdict v={l.after} /> : <span className="dim">same</span>}</td>
        </tr>
      ))}
    </>
  );
}

export function WhatIfTable({ lines, error, updating, signedName, draftName }: { lines: readonly SimulatedLine[] | null; error: WalletError | null; updating: boolean; signedName: string; draftName: string }) {
  const [open, setOpen] = useState(false);
  if (error) {
    return (
      <div className="ow-na">
        {error.code === 'REFUSED'
          ? <p className="ui-hint">{refusalWords(error.message)} Fix that and this week’s deals are tried again.</p>
          : <WalletNotice error={error} what="This week’s deals couldn’t be tried" />}
      </div>
    );
  }
  if (!lines) return updating ? <Loading what="this week’s deals" /> : <p className="ui-hint ow-na">Fill in the limits and this week’s deals are tried against them.</p>;
  if (!lines.length) return <Empty>No deals this week under these rules.</Empty>;
  const moved = lines.filter(changed);
  const same = lines.filter((l) => !changed(l));
  return (
    <div className={`ow-wi ${updating ? 'updating' : ''}`} aria-busy={updating}>
      <table className="ui-table ow-rp" aria-label="Deals whose answer changes">
        <colgroup>
          <col className="c-t" />
          <col />
          <col className="c-a" />
          <col className="c-v" />
          <col className="c-v" />
        </colgroup>
        <thead>
          <tr>
            <th>When</th>
            <th>Deal</th>
            <th className="num">Amount</th>
            <th>{signedName}</th>
            <th>{draftName}</th>
          </tr>
        </thead>
        <tbody>
          {moved.length ? <Rows lines={moved} /> : (
            <tr className="none">
              <td colSpan={5} className="dim">No deal this week would have gone differently.</td>
            </tr>
          )}
          {same.length ? (
            <tr className="fold">
              <td colSpan={5}>
                <Btn kind="plain" sm aria-expanded={open} onClick={() => setOpen((x) => !x)}>
                  {open ? 'Hide' : 'Show'} the {same.length} {same.length === 1 ? 'deal' : 'deals'} that stay the same {open ? '‹' : '›'}
                </Btn>
              </td>
            </tr>
          ) : null}
          {open ? <Rows lines={same} /> : null}
        </tbody>
      </table>
    </div>
  );
}
