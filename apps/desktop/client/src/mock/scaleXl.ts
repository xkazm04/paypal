// XL: the large world grown to 5,000 deals (`?scale=xl`), for trying every list, the Record and the reads
// at the size a long-lived wallet reaches. Everything is SAMPLE DATA and nothing is paid.
//
// The large world (scale.ts, 500 deals) is kept exactly as it is; the 4,500 deals added behind it are
// copies of its settled deals (paid, receipted, withdrawn, expired, refused ...), each with its own id,
// label, references, history steps, audit rows, category and rescue view, moved 2 to 89 days further into
// the past. So nothing new waits for the owner, no figure of "today" or "this week" moves, and the world is
// built by array work (a few hundred ms), not by running the generator ten times.
import type { AuditRow } from '@bindings/AuditRow';
import type { DecidedBy } from '@bindings/DecidedBy';
import type { HistoryStep } from '@bindings/HistoryStep';
import { fakeHash, fakeUlid, type MockDeal, type MockState } from './fixtures';

/** Deals in the xl world. */
export const XL_DEALS = 5000;

const DAY = 86_400;
/** States a copy may have: none of them is waiting for the owner or being moved by an agent. */
const SETTLED = new Set(['CAPTURED', 'RECEIPTED', 'RECONCILED', 'WITHDRAWN', 'EXPIRED', 'REFUSED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED', 'FAILED', 'DISPUTED']);

/** A PayPal reference of the original, as the same kind of reference for the copy's id. */
function rekey(ref: string | null | undefined, id: string): string | null {
  if (!ref) return null;
  if (ref.startsWith('INV2-')) return `INV2-${id.slice(-4)}-${id.slice(-8, -4)}`;
  if (ref.startsWith('I-')) return `I-${id.slice(-12)}`;
  const head = /^[A-Z]+-/.exec(ref)?.[0];
  return head ? `${head}${id.slice(-6)}` : ref;
}

function shiftDecision(by: DecidedBy | null | undefined, delta: number): DecidedBy | null | undefined {
  if (!by) return by;
  if (by.type === 'human') return { ...by, at: by.at - delta };
  if (by.type === 'safe_default') return { ...by, deadline: by.deadline - delta };
  return by;
}

/** `base` (the large world) with settled deals added until it holds `target`. Pure and deterministic. */
export function inflateScale(base: MockState, now: number, target: number): MockState {
  void now;
  const sources = base.deals.filter((d) => !d.attention && d.deal.shield !== 'HOLD' && SETTLED.has(d.deal.state));
  if (sources.length === 0 || base.deals.length >= target) return base;

  const stepsOf = new Map<string, HistoryStep[]>();
  for (const s of base.history ?? []) stepsOf.set(s.deal_id, [...(stepsOf.get(s.deal_id) ?? []), s]);
  const auditOf = new Map<string, AuditRow[]>();
  for (const r of base.audit ?? []) if (r.deal_id) auditOf.set(r.deal_id, [...(auditOf.get(r.deal_id) ?? []), r]);

  const deals: MockDeal[] = [...base.deals];
  const history: HistoryStep[] = [...(base.history ?? [])];
  const audit: AuditRow[] = [...(base.audit ?? [])];
  const categories = { ...(base.categories ?? {}) };
  const rescue = { ...(base.rescue ?? {}) };
  const firstLabel = 1000 + base.deals.length;

  for (let n = 0; deals.length < target; n++) {
    const from = sources[n % sources.length] as MockDeal;
    const old = from.deal.id;
    const id = fakeUlid(`xl:${n}`);
    const label = `D-${String(firstLabel + n).padStart(4, '0')}`;
    const delta = (2 + ((n * 7) % 88)) * DAY + ((n * 131) % DAY);
    const deal = {
      ...from.deal, id, created_at: (from.deal.created_at ?? 0) - delta, updated_at: (from.deal.updated_at ?? from.deal.created_at ?? 0) - delta,
      transcript_head: fakeHash(`${label}:head`),
      paypal: { order: rekey(from.deal.paypal.order, id), authorization: rekey(from.deal.paypal.authorization, id), capture: rekey(from.deal.paypal.capture, id), subscription: rekey(from.deal.paypal.subscription, id) },
    };
    const decided = shiftDecision(from.deal.decided_by, delta);
    if (decided) deal.decided_by = decided;
    deals.push({
      deal,
      display: { ...from.display, deal_id: id, label, deadline: from.display.deadline === null ? null : from.display.deadline - delta },
      evidence: { ...from.evidence, deal_id: id },
      transcript: from.transcript.map((t) => ({ ...t, at: t.at - delta })),
      attention: null,
    });
    const cat = categories[old];
    if (cat) categories[id] = cat;
    const view = rescue[old];
    if (view) rescue[id] = { ...view, deal_id: id, next_retry_at: view.next_retry_at == null ? null : view.next_retry_at - delta, invoice: rekey(view.invoice, id) };
    for (const s of stepsOf.get(old) ?? []) history.push({ ...s, deal_id: id, at: s.at - delta });
    for (const r of auditOf.get(old) ?? []) audit.push({ ...r, deal_id: id, at: r.at - delta, decided_by: shiftDecision(r.decided_by, delta) ?? null });
  }

  // Both records read in time order, numbered from 1 (stable: a tie keeps the order it was added in).
  const inOrder = <T extends { at: number }>(rows: T[]): T[] => rows.map((row, i) => ({ row, i })).sort((a, b) => a.row.at - b.row.at || a.i - b.i).map(({ row }) => row);
  const closed = new Map<string, number>();
  for (const d of deals) if (['CAPTURED', 'RECEIPTED', 'RECONCILED'].includes(d.deal.state)) closed.set(d.deal.counterparty, (closed.get(d.deal.counterparty) ?? 0) + 1);

  return {
    ...base,
    deals,
    audit: inOrder(audit).map((r, k) => ({ ...r, seq: k + 1 })),
    history: inOrder(history).map((s, k) => ({ ...s, seq: k + 1 })),
    categories,
    rescue,
    counterparties: base.counterparties.map((c) => (c.key_id.startsWith('sub_') ? c : { ...c, deals_closed: closed.get(c.key_id) ?? 0 })),
  };
}
