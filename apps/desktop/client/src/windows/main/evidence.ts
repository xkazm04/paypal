// deal_evidence for the Book, read only for the deals whose evidence can have changed. Read-only:
// nothing here can move money.
//
// The rule as built:
//  - The answers live in a module-level cache, so they last as long as the main window (as
//    useDisplays' cache does in the World). Closing and reopening the Book reads nothing that has
//    not changed, and a reopened Book shows its chips at once. The World keeps the deal list across
//    a lock and a mode switch (useQuery only ever replaces its data), so nothing clears this cache
//    there; a deal that leaves the list is dropped from it.
//  - One pass runs at a time. It reads the ids evidenceToRead names, READ_CONCURRENCY at a time,
//    most recently updated deal first (updated_at, else created_at), and writes each answer into the
//    cache as it lands, keyed by the displayToken of the deal object the read was issued for. A newer
//    deal list (a refetch) or the Book closing aborts the running pass: it starts no further read, the
//    reads already out settle and are kept. The next pass starts after they have settled and runs on
//    the latest list only; lists that arrived in between are coalesced. So at most READ_CONCURRENCY
//    deal_evidence reads are ever in flight, whatever the refetch rate.
//  - A failed or timed-out read leaves its deal uncached, sets `error`, and is read again on the next
//    pass. A read aborted before it started is neither an error nor cached.
//
// Read counts: the first Book open after the wallet starts reads every deal once. After that an open
// or a refetch reads only the deals evidenceToRead returns: deals with no cached answer, a token that
// is null or changed, live deals, deals whose cached money_check is open, and paid seller deals the
// wallet has not verified yet. With a ledger of ended deals and nothing changed that is none.
//
// What deal_evidence returns (crates/table-ledger/src/receipt.rs) and what can change it:
//  - receipt, reconciliation: the deal row. Most writes also set updated_at (the token), but one does
//    not: receipt.verified on a SELLER deal sets receipt_evidence and pending_reporting with no row
//    timestamp (repositories.rs:1842). The deal is then in CAPTURED or RECEIPTED, so such a deal whose
//    cached reconciliation is not_applicable is read again. Dropped rules, each confirmed in the Rust:
//    (i) pending_reporting is no re-read input: its only exits write updated_at (receipt.rs:425, and
//    the ReportingMatched apply at receipt.rs:427 goes through apply_decided, repositories.rs:253).
//    (ii) a buyer deal's receipt write (receipt.rs:191) is followed by a transition (receipt.rs:192,
//    SellerReceiptVerified, which sets updated_at), so the not_applicable rule is for seller deals.
//  - money_check: open operations. An operation is reserved only on a live deal (AGREED, APPROVED,
//    AUTHORIZED, or a rescue's own steps; pipeline.rs), so a check cannot open on an ended deal with
//    no row write, and a live deal is always read. A check can close with no row write (a capture read
//    back on a paid deal), so a cached non-null money_check is read again.
//  - house_record: house_heads. It can change with no write to the deal row (witness.rs,
//    keep_house_head), but the Book never renders it: RowDetail shows receipt, statement,
//    statement_unmatched, money_check and fair_price only, and nothing in book.tsx or modules/book/
//    reads house_record (iii). So it is no re-read input here, and the rule on settled buyer deals
//    that existed for it is gone. Any consumer that shows house_record must read deal_evidence
//    itself, as deal/Evidence.tsx and DealView.tsx do.
//  - fair_price: audit rows of the deal's transitions and market observations, written before or with
//    a state change, so the token covers it.
//  - statement_unmatched: the receipt.unconfirmed row, written with the move to UNCONFIRMED.
// A deal with no token (a shell that does not report updated_at) is read every time.
//
// Residue: the first open after the wallet starts reads N deals once, 8 at a time, however many are
// on record; there is no batched evidence command (that would be a new IPC command). A failed read
// is read again on the next refetch.
import { useEffect, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import { toWalletError, type WalletError } from '../../lib/contract';
import { READ_CONCURRENCY, isAborted, readEach } from '../../lib/readEach';
import { backend } from '../../lib/runtime';
import { displayToken } from './displays';
import { isTerminal } from './logic';

type Cached = { token: string | null; evidence: Pick<DealEvidence, 'reconciliation' | 'money_check'> };
type Entry = { token: string | null; evidence: DealEvidence };

/** The deals whose evidence is read again: not read yet, changed since (or no token), live, or
 *  ended with evidence that can still change without the deal's row changing (see above). */
export function evidenceToRead(deals: readonly Deal[], cache: ReadonlyMap<string, Cached>): string[] {
  return deals.filter((d) => {
    const had = cache.get(d.id);
    if (!had) return true;
    const token = displayToken(d);
    if (token === null || token !== had.token) return true;
    if (!isTerminal(d)) return true;
    if (had.evidence.money_check != null) return true;
    return d.side === 'seller' && (d.state === 'CAPTURED' || d.state === 'RECEIPTED') && had.evidence.reconciliation === 'not_applicable';
  }).map((d) => d.id);
}

const cache = new Map<string, Entry>();
const subs = new Set<() => void>();
let latest: readonly Deal[] | undefined;
let running: AbortController | null = null;
let dirty = false;
let error: WalletError | null = null;
let generation = 0;
/** How many answers land between two renders of the Book while a pass is running. */
const NOTIFY_EVERY = 25;

/** Forgets every answer and stops the running pass. For tests. */
export function resetEvidence(): void {
  generation += 1;
  running?.abort();
  running = null;
  cache.clear();
  latest = undefined;
  dirty = false;
  error = null;
}

const notify = (): void => { subs.forEach((f) => f()); };
const recency = (d: Deal): number => d.updated_at ?? d.created_at ?? 0;

function view(deals: readonly Deal[] | undefined): { map: Map<string, DealEvidence>; error: WalletError | null } {
  const map = new Map<string, DealEvidence>();
  for (const d of deals ?? []) {
    const had = cache.get(d.id);
    if (had) map.set(d.id, had.evidence);
  }
  return { map, error };
}

function pump(): void {
  if (running || !latest || subs.size === 0) return;
  const deals = latest;
  dirty = false;
  const byId = new Map(deals.map((d) => [d.id, d]));
  for (const id of [...cache.keys()]) if (!byId.has(id)) cache.delete(id);
  const wanted = new Set(evidenceToRead(deals, cache));
  // Array.prototype.sort is stable: deals with the same moment keep the list's order.
  const ids = deals.filter((d) => wanted.has(d.id)).sort((a, b) => recency(b) - recency(a)).map((d) => d.id);
  if (ids.length === 0) {
    error = null;
    notify();
    return;
  }
  const ctl = new AbortController();
  const mine = generation;
  const failed = new Set<string>();
  let landed = 0;
  running = ctl;
  const read = async (id: string): Promise<DealEvidence> => {
    const d = byId.get(id);
    if (!d) throw new Error(`deal ${id} is not listed`);
    const evidence = await backend().invoke('deal_evidence', { deal_id: id });
    // A late answer to a read that was given up on is not kept: the deal is read again.
    if (mine === generation && !failed.has(id)) {
      cache.set(id, { token: displayToken(d), evidence });
      landed += 1;
      if (landed % NOTIFY_EVERY === 0) notify();
    }
    return evidence;
  };
  void readEach(ids, read, { concurrency: READ_CONCURRENCY, signal: ctl.signal }).then((rs) => {
    if (mine !== generation) return;
    let failure: unknown;
    let failedAny = false;
    for (const [i, r] of rs.entries()) {
      const id = ids[i];
      if (r.status === 'rejected' && !isAborted(r.reason) && id !== undefined) {
        failed.add(id);
        cache.delete(id);
        failure = r.reason;
        failedAny = true;
      }
    }
    if (failedAny) error = toWalletError(failure);
    else if (!ctl.signal.aborted) error = null;
    running = null;
    notify();
    if (dirty && subs.size > 0) pump();
  });
}

function request(deals: readonly Deal[]): void {
  latest = deals;
  dirty = true;
  if (running) running.abort();
  else pump();
}

/** deal_evidence per listed deal, from the cache that outlives the Book, reading again only what
 *  evidenceToRead names. A failed read leaves that deal out of the map and sets `error`. */
export function useEvidence(deals: Deal[] | undefined): { map: Map<string, DealEvidence>; error: WalletError | null } {
  const [state, setState] = useState(() => view(deals));
  useEffect(() => {
    if (!deals) return;
    const on = (): void => { setState(view(deals)); };
    subs.add(on);
    on();
    request(deals);
    return () => {
      subs.delete(on);
      if (subs.size === 0) running?.abort();
    };
  }, [deals]);
  return state;
}
