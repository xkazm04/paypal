// Parts the three trade areas share (rebuild WP3a: Tables, Spend, Counter). Lives under the tables
// area; spend and counter import it from here.
//
//   HandOff      the approval hand-off button: `approval_open` only, the lock glyph and the
//                "Locked after 15 quiet minutes" title when locked, disabled while pending, the
//                WalletNotice on error. Never anything that moves money.
//   TheirWords   the counterparty's latest note, read only when the owner asks, shown through
//                <Quarantine> as plain text (the same rule as the shield's NoteChip).
//   SplitView    a list on the left and the picked row's detail on the right, at every width.
//   useTranscript / useEvidence   per-deal reads through the shared query cache, only for the row
//                that is picked (never per row of a list).
import { useState, type ReactNode } from 'react';
import type { ApprovalOpenArgs } from '@bindings/ApprovalOpenArgs';
import { clockLabel } from '../../../../../lib/format';
import { useMutation, useQuery } from '../../../../../lib/hooks';
import { APPROVAL_LOCKED_TITLE, APPROVAL_OPEN_TITLE, TABLES_TRADE } from '../../../../../lib/words';
import { Quarantine, WalletNotice } from '../../../../../shared/honesty';
import { Btn, Loading, type BtnKind } from '../../../../../shared/ui';
import { useLocked } from '../../../world';

/** A button that opens the approval window on `args`. `onOpened` runs once it opened. */
export function HandOff({ args, children, kind = 'gold', sm, title, onOpened, className, disabled }: {
  args: ApprovalOpenArgs; children: ReactNode; kind?: BtnKind; sm?: boolean; title?: string; onOpened?: () => void; className?: string; disabled?: boolean;
}) {
  const locked = useLocked();
  const open = useMutation('approval_open');
  return (
    <>
      <Btn kind={kind} sm={sm} className={className} locked={locked} disabled={disabled || open.pending}
        title={locked ? APPROVAL_LOCKED_TITLE : (title ?? APPROVAL_OPEN_TITLE)}
        onClick={async () => { const r = await open.run(args); if (r !== undefined) onOpened?.(); }}>
        {children} <span aria-hidden="true">↗</span>
      </Btn>
      {open.error ? <WalletNotice error={open.error} what={TABLES_TRADE.approvalWhat} /> : null}
    </>
  );
}

/** The counterparty's own words, behind a quiet toggle: read only when opened, shown as plain text. */
export function TheirWords({ dealId, who }: { dealId: string; who: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className="tr-words">
      <Btn sm kind="plain" aria-expanded={on} title={TABLES_TRADE.noteTitle} onClick={() => setOn((x) => !x)}>{on ? TABLES_TRADE.noteHide : TABLES_TRADE.noteShow}</Btn>
      {on ? <NoteRead dealId={dealId} who={who} /> : null}
    </div>
  );
}

function NoteRead({ dealId, who }: { dealId: string; who: string }) {
  const q = useQuery('counterparty_note', { deal_id: dealId }, { refreshOn: ['deal:changed'] });
  if (q.error) return <WalletNotice error={q.error} what={TABLES_TRADE.noteWhat} message={TABLES_TRADE.noteUnread} />;
  if (q.data === undefined) return <Loading what={TABLES_TRADE.noteReading} />;
  if (q.data === null) return <p className="ui-hint">{TABLES_TRADE.noteNone(who)}</p>;
  return (
    <>
      <Quarantine text={q.data.text} label={TABLES_TRADE.noteFrom(who)} />
      <p className="ui-hint">{TABLES_TRADE.noteSent(clockLabel(q.data.at))}</p>
    </>
  );
}

/** At or under this many rows a split view takes its content's height instead of the sheet's. */
const FIT_ROWS = 10;

/** A list and the picked row's detail side by side (the list is a ListEngine that picks on open).
 *  With no rows (`count` 0) only the list's calm empty line is drawn, and a short list takes its own
 *  height: a small world's view shrinks to its content. A long list is windowed in the sheet's height. */
export function SplitView({ list, pane, label, count }: { list: ReactNode; pane: ReactNode; label: string; count: number }) {
  if (count === 0) return <div className="tr-split empty">{list}</div>;
  return (
    <div className={`tr-split${count <= FIT_ROWS ? ' fit' : ''}`}>
      <div className="tr-list">{list}</div>
      <section className="tr-pane" aria-label={label} aria-live="polite">{pane ?? <p className="le-empty">{TABLES_TRADE.pick}</p>}</section>
    </div>
  );
}

/** A deal's signed steps, read only while `dealId` is given (a picked row). */
export function useTranscript(dealId: string | null | undefined) {
  return useQuery('deal_transcript', { deal_id: dealId ?? '' }, { refreshOn: ['deal:changed'], enabled: !!dealId });
}

/** A deal's proof (receipt, statement), read only while `dealId` is given (a picked row). */
export function useEvidence(dealId: string | null | undefined) {
  return useQuery('deal_evidence', { deal_id: dealId ?? '' }, { refreshOn: ['deal:changed', 'receipt:created'], enabled: !!dealId });
}

/** The picked key of a list: the owner's pick while it is still listed, else the first row. */
export function usePick<T>(rows: readonly T[], keyOf: (r: T) => string): [T | undefined, (k: string) => void] {
  const [k, setK] = useState<string | null>(null);
  const row = (k !== null ? rows.find((r) => keyOf(r) === k) : undefined) ?? rows[0];
  return [row, setK];
}
