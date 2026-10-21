// The closed BookQuery's shape rules, ported from Rust so the window can check its own reading
// before it asks (pure, no IO). Mirrors `BookQuery::rejection` (crates/table-core/src/book.rs) and
// the compile checks of `book_query_rejection` (crates/table-ledger/src/book.rs): the same rules,
// the same fixed words, never echoing a value. Rust still checks every query again; this is a
// guard and the test oracle for the understanding step, not the authority.
import type { BookField } from '@bindings/BookField';
import type { BookGroup } from '@bindings/BookGroup';
import type { BookMetric } from '@bindings/BookMetric';
import type { BookOp } from '@bindings/BookOp';
import type { BookQuery } from '@bindings/BookQuery';
import type { BookView } from '@bindings/BookView';
import type { JsonValue } from '@bindings/serde_json/JsonValue';

// Each closed list is the keys of a record over its generated Rust enum: a variant Rust adds or
// drops is a type error here, never a valid query this mirror refuses (or the reverse).
const every = <T extends string>(all: Record<T, true>): readonly string[] => Object.keys(all);
const VIEWS = every<BookView>({ deals: true, paypal_calls: true, receipts: true, subscriptions: true, reconciliation: true });
const METRICS = every<BookMetric>({ count: true, sum_amount: true, avg_vs_market_pct: true, recovered_sum: true });
const GROUPS = every<BookGroup>({ kind: true, counterparty: true, state: true, day: true, decided_by: true });
const FIELDS = every<BookField>({ kind: true, state: true, counterparty: true, amount: true, created_at: true, vs_market_pct: true, decided_by: true });
const OPS = every<BookOp>({ eq: true, ne: true, gt: true, lt: true, between: true, in: true });
const INT_FIELDS: readonly BookField[] = ['amount', 'created_at', 'vs_market_pct'];
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/** Seconds since the epoch for an RFC 3339 time, or null when it is not one. */
export function rfc3339Seconds(text: string): number | null {
  if (!RFC3339.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** The rule a query breaks, in Rust's fixed words, or null when it would compile. */
export function bookRejection(q: BookQuery): string | null {
  if (!VIEWS.includes(q.view)) return 'unknown view';
  if (q.metrics.some((m) => !METRICS.includes(m))) return 'unknown metric';
  if (q.group_by.some((g) => !GROUPS.includes(g))) return 'unknown group';
  if (q.filters.some((f) => !FIELDS.includes(f.field) || !OPS.includes(f.op))) return 'unknown filter';
  // BookQuery::rejection, in its order.
  if (q.metrics.length < 1 || q.metrics.length > 4) return 'metrics: 1 to 4 required';
  if (q.filters.length > 6) return 'filters: at most 6';
  if (q.group_by.length > 2) return 'group_by: at most 2';
  if (q.limit !== null && (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 500)) return 'limit: 1 to 500';
  if (new Set(q.metrics).size !== q.metrics.length) return 'metrics: each at most once';
  if (new Set(q.group_by).size !== q.group_by.length) return 'group_by: each at most once';
  // compile(), in its order.
  if (q.view === 'paypal_calls' && q.metrics.includes('recovered_sum')) return 'recovered_sum is not defined on the paypal_calls view';
  for (const f of q.filters) {
    const many = f.op === 'in' || f.op === 'between';
    const values: JsonValue[] = many ? (Array.isArray(f.value) ? f.value : []) : [f.value];
    if (many && (!values.length || values.length > 32)) return 'filters: in and between take an array of 1 to 32 values';
    if (f.op === 'between' && values.length !== 2) return 'filters: between takes exactly two values';
    for (const v of values) {
      if (INT_FIELDS.includes(f.field)) {
        if (!Number.isInteger(v)) return 'filters: amount, created_at and vs_market_pct take integers';
      } else if (typeof v !== 'string' || !v.length || v.length > 256) {
        return 'filters: text values are 1 to 256 characters';
      }
    }
  }
  if (q.range) {
    const from = rfc3339Seconds(q.range.from);
    const to = rfc3339Seconds(q.range.to);
    if (from === null || to === null) return 'range: from and to must be RFC 3339 times';
    if (from >= to) return 'range: from must be before to';
  }
  return null;
}
