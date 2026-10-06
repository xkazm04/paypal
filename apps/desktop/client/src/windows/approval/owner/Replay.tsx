// The replay (Layer 1): a scoreboard of outcomes, signed → draft, and one row per deal of the
// week. A row's reasons open in a popover (Layer 2). Unknown outcomes are drawn dashed.
import { useState, type ReactNode } from 'react';
import { clockLabel, formatMinor, shortId } from '../../../lib/format';
import { ruleNameOf } from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { Chip, Empty, Kv, Loading, Popover, type ChipTone } from '../../../shared/ui';
import type { WalletError } from '../../../lib/contract';
import { counts, OUTCOME_LABEL, OUTCOMES, verdictWhy, type Check, type Outcome, type ReplayRow, type Verdict } from './preview';

export const OUTCOME_TONE: Record<Outcome, ChipTone> = { refused: 'red', asks: 'gold', policy: 'teal', unknown: 'dashed' };
const CHECK_TONE: Record<Check['state'], ChipTone> = { pass: 'ok', fail: 'red', ask: 'gold', unknown: 'dashed' };
const CHECK_LABEL: Record<Check['state'], string> = { pass: 'passes', fail: 'refuses', ask: 'asks you', unknown: 'unknown' };

export function VerdictChip({ v }: { v: Verdict }) {
  // Dashed = unknown. "≤ asks you": at most that; an unknown check may still refuse it.
  const label = v.outcome === 'unknown' ? (v.ifPass ? `≤ ${OUTCOME_LABEL[v.ifPass]}` : 'unknown') : OUTCOME_LABEL[v.outcome];
  return <Chip tone={OUTCOME_TONE[v.outcome]} title={verdictWhy(v)}>{label}</Chip>;
}

/** Outcome counts, signed → draft. rows null = replay unavailable: every cell is unknown. */
export function Scoreboard({ rows, signedName, draftName }: { rows: readonly ReplayRow[] | null; signedName: string; draftName: string }) {
  const a = rows ? counts(rows, 'signed') : null;
  const b = rows ? counts(rows, 'draft') : null;
  return (
    <div className="ow-score" role="group" aria-label={`Outcomes this week: ${signedName} → ${draftName}`}>
      {OUTCOMES.map((o) => {
        const x = a?.[o];
        const y = b?.[o];
        const moved = x !== undefined && y !== undefined && x !== y;
        return (
          <div key={o} className={`sc ${o} ${moved ? 'moved' : ''} ${rows ? '' : 'na'}`}>
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

const tag = (r: ReplayRow) => `${shortId(r.deal.id)} · ${r.deal.terms.item_ref}`;
export const rowTag = tag;

export function ReplayTable({ rows, error, signedName, draftName }: { rows: readonly ReplayRow[] | null | undefined; error: WalletError | null; signedName: string; draftName: string }) {
  const [sel, setSel] = useState<{ id: string; el: HTMLElement } | null>(null);
  if (rows === undefined) return <Loading what="this week’s deals" />;
  if (rows === null) {
    return (
      <div className="ow-na">
        {error ? <WalletNotice error={error} what="This week’s deals are not readable in this window" /> : null}
        <p className="ui-hint">
          This week’s deals can only be read in The Table, so this window shows no outcomes rather than guess. You can still change the limits, and the wallet checks everything again when you sign.
        </p>
      </div>
    );
  }
  if (!rows.length) return <Empty>No deals under these rules this week.</Empty>;
  const open = rows.find((r) => r.deal.id === sel?.id);
  return (
    <>
      <table className="ui-table ow-rp" aria-label="This week replayed">
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
          {rows.map((r) => (
            <tr
              key={r.deal.id}
              className={r.moved ? 'chg' : ''}
              tabIndex={0}
              aria-selected={sel?.id === r.deal.id}
              onClick={(e) => setSel({ id: r.deal.id, el: e.currentTarget })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSel({ id: r.deal.id, el: e.currentTarget });
                }
              }}
            >
              <td className="t">{r.deal.created_at !== undefined ? clockLabel(r.deal.created_at) : '—'}</td>
              <td className="clip" title={`${r.deal.id} · ${r.deal.terms.item_ref} · ${r.deal.kind}`}>
                <span className="id">{shortId(r.deal.id)}</span>
                <span className="it">{r.deal.terms.item_ref}</span>
                <span className="dim"> · {r.deal.kind}</span>
              </td>
              <td className="num">{r.amount !== null ? formatMinor(r.amount, r.deal.terms.currency) : '—'}</td>
              <td><VerdictChip v={r.signed} /></td>
              <td><VerdictChip v={r.draft} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && sel ? (
        <Popover anchor={sel.el} onClose={() => setSel(null)} title={`${shortId(open.deal.id)} · ${open.deal.terms.item_ref}`} className="ow-why">
          <Kv
            items={[
              [signedName, <Reasons key="s" v={open.signed} />],
              [draftName, open.moved ? <Reasons key="d" v={open.draft} /> : <span className="dim">same as {signedName}</span>],
              ['Deal', `${open.deal.kind} · ${open.deal.side} · ${open.deal.state} · qty ${open.deal.terms.qty}`],
            ]}
          />
          <p className="ui-hint">A preview from the deal record. The wallet checks every real request again.</p>
        </Popover>
      ) : null}
    </>
  );
}

function Reasons({ v }: { v: Verdict }): ReactNode {
  // Rust stops at the first refusal: later clauses are never reached, so they are not listed.
  const stop = v.checks.findIndex((c) => c.state === 'fail');
  const shown = stop >= 0 ? v.checks.slice(0, stop + 1) : v.checks;
  return (
    <div className="ow-reasons">
      <VerdictChip v={v} />
      <ul>
        {shown.map((c, i) => (
          <li key={i}>
            <Chip tone={CHECK_TONE[c.state]}>{CHECK_LABEL[c.state]}</Chip>
            <span>
              {c.clause ? <span className="dim">{ruleNameOf(c.clause)} · </span> : null}
              {c.why}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
