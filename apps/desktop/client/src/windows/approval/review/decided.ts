// What the approval window says about a decision, read from the wallet's own record (the summary's
// `decided`, `handed_off` and `evidence.money_check`), never from what this window remembers: a
// reopen, a restart or a lost reply reads the same. Pure: no React, no IPC. These words say what
// happened; gating.ts alone decides what may be clicked, and reads only the live summary.
import type { ApprovalCheck } from '@bindings/ApprovalCheck';
import type { ApprovalCheckId } from '@bindings/ApprovalCheckId';
import type { ApprovalDecided } from '@bindings/ApprovalDecided';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { MoneyCheck } from '@bindings/MoneyCheck';
import { APPROVAL_AFTER_FAILURE, APPROVAL_DECIDED, APPROVAL_MONEY_OPEN, moneyCheckStep } from '../../../lib/words';
import { shownTime } from '../../main/deal/shown';
import { checksLine } from './Checks';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "You approved the order at 14:02 on the checks shown (4 of 6 passed · 2 checked later), recorded
 *  with your decision. Unchanged since." From the recorded row; `same_now` says whether it still reads so. */
export function decidedText(d: ApprovalDecided, now: number): string {
  const did = APPROVAL_DECIDED.did[d.operation];
  const time = shownTime(d.at, now);
  return d.checks ? APPROVAL_DECIDED.line(did, time, checksLine(d.checks), d.same_now) : APPROVAL_DECIDED.hashOnly(did, time, d.same_now);
}

/** "When you approved · 14:02". */
export const decidedFoldLabel = (d: ApprovalDecided, now: number): string => APPROVAL_DECIDED.fold(APPROVAL_DECIDED.when[d.operation], shownTime(d.at, now));

export type LineChange = keyof typeof APPROVAL_DECIDED.compare;

/** Each recorded line against the list now, by its id: the same line, now passing, now failing,
 *  changed in another way, or no longer on the list. */
export function compareLines(recorded: readonly ApprovalCheck[], now: readonly ApprovalCheck[]): Partial<Record<ApprovalCheckId, LineChange>> {
  const out: Partial<Record<ApprovalCheckId, LineChange>> = {};
  for (const r of recorded) {
    const c = now.find((x) => x.id === r.id);
    out[r.id] = !c ? 'gone'
      : c.status === r.status && c.text === r.text && c.detail === r.detail ? 'same'
        : c.status === 'pass' && r.status !== 'pass' ? 'passes'
          : c.status === 'fail' && r.status !== 'fail' ? 'fails'
            : 'changed';
  }
  return out;
}

/** The one line that stands in for the money buttons while a step is open with PayPal. */
export function moneyOpenText(c: MoneyCheck, now: number): string {
  const step = cap(moneyCheckStep(c.step));
  const since = shownTime(c.since, now);
  return c.state === 'parked' ? APPROVAL_MONEY_OPEN.parked(step, since) : APPROVAL_MONEY_OPEN.checking(step, since, c.next_check != null ? shownTime(c.next_check, now) : null);
}

/** The same recorded row (every field the record carries). */
function sameRow(a: ApprovalDecided, b: ApprovalDecided): boolean {
  return a.at === b.at && a.operation === b.operation && a.decision === b.decision && JSON.stringify(a.checks_hash) === JSON.stringify(b.checks_hash);
}

export type AfterFailure = keyof typeof APPROVAL_AFTER_FAILURE;

/**
 * After a decision call failed, what the record read again says happened, from Rust's fields only:
 * `fresh` is the summary read after the failure (null when that read failed too), `before` the one
 * the click was made on. A decision row for this attempt that is not the one `before` already showed
 * (and no older than it) was written by this click: only this window can decide on its deal. With
 * a money step opened since, the step went to PayPal and is being checked; with none and the deal
 * where it was, the decision was recorded and nothing was sent; with the deal moved on, it was
 * recorded and the window's read says the rest. No such row: null (the call's own refusal stands).
 * A failed read: unconfirmed, never "nothing was done".
 */
export function afterFailure(before: ApprovalSummary, fresh: ApprovalSummary | null): AfterFailure | null {
  if (!fresh) return 'unconfirmed';
  const d = fresh.decided;
  const was = before.decided;
  const newer = !!d && fresh.attempt === before.attempt && !(was && (sameRow(was, d) || d.at < was.at));
  if (!newer) return null;
  // A step opened since the click (not one that was already open before it).
  const open = fresh.evidence.money_check;
  const held = before.evidence.money_check;
  if (open && !(held && held.step === open.step && held.since === open.since)) return 'checking';
  return fresh.deal.state === before.deal.state ? 'recorded' : 'moved';
}
