// The closed BookQuery's shape rules, ported from Rust so the window can check its own reading
// before it asks (pure, no IO). Mirrors `BookQuery::rejection` (crates/table-core/src/book.rs) and
// the compile checks of `book_query_rejection` (crates/table-ledger/src/book.rs): the same rules,
// the same fixed words, never echoing a value. Rust still checks every query again; this is a
// guard and the test oracle for the understanding step, not the authority.
import type { BookQuery } from '@bindings/BookQuery';
import type { JsonValue } from '@bindings/serde_json/JsonValue';

const VIEWS = ['deals', 'paypal_calls', 'receipts', 'subscriptions', 'reconciliation'];
const METRICS = ['count', 'sum_amount', 'avg_vs_market_pct', 'recovered_sum'];
const GROUPS = ['kind', 'counterparty', 'state', 'day', 'decided_by'];
const FIELDS = ['kind', 'state', 'counterparty', 'amount', 'created_at', 'vs_market_pct', 'decided_by'];
const OPS = ['eq', 'ne', 'gt', 'lt', 'between', 'in'];
const INT_FIELDS = ['amount', 'created_at', 'vs_market_pct'];
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
