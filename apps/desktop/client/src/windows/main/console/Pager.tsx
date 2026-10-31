// The pager under a long list (ListEngine): first / previous, the page numbers, next / last, and the
// range footer ("21-40 of 312"). Pages are 1-based. Hidden when everything fits on one page. Plain
// buttons, so Tab and Enter/Space operate it; every target is 24px; nothing animates.
import { formatTally } from '../../../lib/data/counts';
import { listRange, PAGER_FIRST, PAGER_LAST, PAGER_NEXT, PAGER_PREV, pagerPage } from '../../../lib/words';

export type PagerProps = { page: number; pageSize: number; total: number; onPage: (page: number) => void; label: string };

/** The page count for `total` rows (at least 1). */
export const pageCount = (total: number, pageSize: number): number => (pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1);

/** The numbers to draw: first, last and the current page with one neighbour each side; null = a gap. */
export function pageNumbers(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out: (number | null)[] = [];
  let prev = 0;
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - prev > 1) out.push(null);
    out.push(n);
    prev = n;
  }
  return out;
}

export function Pager(p: PagerProps) {
  const { pageSize, total, onPage } = p;
  if (pageSize <= 0 || total <= pageSize) return null;
  const pages = pageCount(total, pageSize);
  const page = Math.min(Math.max(1, p.page), pages);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const go = (n: number) => () => onPage(n);
  return (
    <nav className="pg" aria-label={p.label}>
      <span className="pg-range">{listRange(from, to, total, formatTally)}</span>
      <span className="pg-btns">
        <button type="button" className="pg-b" aria-label={PAGER_FIRST} title={PAGER_FIRST} disabled={page === 1} onClick={go(1)}>«</button>
        <button type="button" className="pg-b" aria-label={PAGER_PREV} title={PAGER_PREV} disabled={page === 1} onClick={go(page - 1)}>‹</button>
        {pageNumbers(page, pages).map((n, i) => (n === null
          ? <span key={`gap${i}`} className="pg-gap" aria-hidden="true">…</span>
          : <button key={n} type="button" className="pg-b pg-n" aria-label={pagerPage(n, pages)} aria-current={n === page ? 'page' : undefined} onClick={go(n)}>{n}</button>))}
        <button type="button" className="pg-b" aria-label={PAGER_NEXT} title={PAGER_NEXT} disabled={page === pages} onClick={go(page + 1)}>›</button>
        <button type="button" className="pg-b" aria-label={PAGER_LAST} title={PAGER_LAST} disabled={page === pages} onClick={go(pages)}>»</button>
      </span>
    </nav>
  );
}
