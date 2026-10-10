// deal_evidence for the Book, read only for the deals whose evidence can have changed. Opening the
// Book used to send one deal_evidence read per deal on record, all at once, and again on every
// deal-list refetch. Here each open reads every deal once, READ_CONCURRENCY at a time, and a
// refetch reads again only the deals listed below. Read-only: nothing here can move money.
//
// What deal_evidence returns (crates/table-ledger/src/receipt.rs) and what can change it:
//  - receipt, reconciliation: the deal row. Most writes also set updated_at (the token), but two
//    do not: receipt.verified on a seller deal in CAPTURED or RECEIPTED sets paypal_verified and
//    pending_reporting with no row timestamp (repositories.rs, the "receipt.verified" write), and
//    pending_reporting later turns to matched or mismatch with a timestamp. So a deal in CAPTURED
//    or RECEIPTED whose reconciliation is not_applicable is read again, and so is any deal whose
//    reconciliation is pending_reporting.
//  - money_check: open operations. An operation is reserved only on a live deal (AGREED, APPROVED,
//    AUTHORIZED, or a rescue's own steps; pipeline.rs), so a check cannot open on an ended deal
//    with no row write, and a live deal is always read. A check can close with no row write (a
//    capture read back on a paid deal), so a cached non-null money_check is read again. The
//    CHECKED_AFTER_END state rule of displays.ts is therefore not needed here.
//  - house_record: house_heads. A receipt head is kept beside a buyer deal already RECEIPTED or
//    RECONCILED with no write to the deal row (witness.rs, keep_house_head), and any later head
//    changes the record of every deal that has one. So a non-null house_record is read again, and
//    so is a null one on a buyer deal in RECEIPTED or RECONCILED (the client cannot tell a house
//    deal from another). This is the one rule that keeps reads going for settled buyer deals.
//  - fair_price: audit rows of the deal's transitions and market observations, written before or
//    with a state change, so the token covers it.
//  - statement_unmatched: the receipt.unconfirmed row, written with the move to UNCONFIRMED.
// A deal with no token (a shell that does not report updated_at) is read every time. Where this
// is unsure it reads again: a stale statement chip on the Book is worse than an extra read.
import { useEffect, useRef, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import { toWalletError, type WalletError } from '../../lib/contract';
import { READ_CONCURRENCY, readEach } from '../../lib/readEach';
import { backend } from '../../lib/runtime';
import { displayToken } from './displays';
import { isTerminal } from './logic';

type Cached = { token: string | null; evidence: Pick<DealEvidence, 'reconciliation' | 'money_check' | 'house_record'> };

/** The deals whose evidence is read again: not read yet, changed since (or no token), live, or
 *  ended with evidence that can still change without the deal's row changing (see above). */
export function evidenceToRead(deals: readonly Deal[], cache: ReadonlyMap<string, Cached>): string[] {
  return deals.filter((d) => {
    const had = cache.get(d.id);
    if (!had) return true;
    const token = displayToken(d);
    if (token === null || token !== had.token) return true;
    if (!isTerminal(d)) return true;
    const e = had.evidence;
    if (e.money_check != null || e.house_record != null) return true;
    if (e.reconciliation === 'pending_reporting') return true;
    if ((d.state === 'CAPTURED' || d.state === 'RECEIPTED') && e.reconciliation === 'not_applicable') return true;
    return d.side === 'buyer' && (d.state === 'RECEIPTED' || d.state === 'RECONCILED');
  }).map((d) => d.id);
}

/** deal_evidence per listed deal, keeping the earlier answer for a deal not read again and
 *  dropping deals no longer listed. A failed read leaves that deal out of the map and sets
 *  `error`; the deal is read again on the next refetch. */
export function useEvidence(deals: Deal[] | undefined): { map: Map<string, DealEvidence>; error: WalletError | null } {
  const cache = useRef<ReadonlyMap<string, Cached & { evidence: DealEvidence }>>(new Map());
  const [state, setState] = useState<{ map: Map<string, DealEvidence>; error: WalletError | null }>({ map: new Map(), error: null });
  useEffect(() => {
    if (!deals) return;
    let dead = false;
    const ids = evidenceToRead(deals, cache.current);
    void readEach(ids, (id) => backend().invoke('deal_evidence', { deal_id: id }), { concurrency: READ_CONCURRENCY }).then((rs) => {
      if (dead) return;
      const next = new Map<string, Cached & { evidence: DealEvidence }>();
      for (const d of deals) {
        const had = cache.current.get(d.id);
        if (had) next.set(d.id, had);
      }
      const byId = new Map(deals.map((d) => [d.id, d]));
      let error: WalletError | null = null;
      rs.forEach((r, i) => {
        const id = ids[i];
        const d = id === undefined ? undefined : byId.get(id);
        if (!id || !d) return;
        if (r.status === 'fulfilled') next.set(id, { token: displayToken(d), evidence: r.value });
        else { next.delete(id); error = toWalletError(r.reason); }
      });
      cache.current = next;
      setState({ map: new Map([...next].map(([id, e]): [string, DealEvidence] => [id, e.evidence])), error });
    });
    return () => { dead = true; };
  }, [deals]);
  return state;
}
