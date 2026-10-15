// The "Latest" strip under a module's or a place's cards (rebuild WP4a, Director decision 1: no dead
// space under a summary). Quiet and subordinate to the first view (answer, Your call, the cards):
// the first N rows of the area's most relevant list, drawn by the area's own row part, each opening
// its deal, and "See all" into the full view. N follows the room left on the sheet (MIN_ROWS to
// MAX_ROWS), so a tall window fills and a short one keeps the cards in sight. An area with no list
// shows its state at a glance instead: read-only facts, never a control.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { formatCount } from '../../../lib/data/counts';
import { LATEST } from '../../../lib/words';

export const MIN_ROWS = 3;
export const MAX_ROWS = 8;
/** A row's height before one is measured (px; the six modules' rows measure 56-78 with their gap). */
const ROW_GUESS = 60;

export type LatestRow = {
  key: string;
  /** The area's own row part (the same one its full list draws). */
  node: ReactNode;
  /** The row's accessible name (what it is, and that it opens its deal). */
  label: string;
  onOpen: () => void;
};

export type LatestProps = {
  /** What the rows are, in a few words ("tables waiting or open"). */
  title: string;
  /** More rows than fit is fine: the strip shows the first N. Only the first MAX_ROWS are drawn. */
  rows?: readonly LatestRow[];
  /** How many rows the full view has (for "N more"). */
  total?: number;
  /** The state at a glance, as read-only label / value pairs: instead of rows, or under them. */
  facts?: ReadonlyArray<readonly [ReactNode, ReactNode]>;
  /** "See all": opens the full view (focus comes back to this link). */
  seeAll?: { onOpen: () => void; fk?: string; label?: string };
  /** Shown when there are no rows (one calm line); absent: the strip is not drawn. */
  empty?: ReactNode;
  /** The area's row height with its gap (px) before one is measured: the skeleton's first guess. */
  rowGuess?: number;
};

/** How many rows fit in `room` px (pure; exported for tests): never fewer than MIN_ROWS, never more
 *  than MAX_ROWS or than there are. */
export function rowsThatFit(room: number, rowPx: number, have: number): number {
  const fit = rowPx > 0 ? Math.floor(room / rowPx) : MIN_ROWS;
  return Math.max(0, Math.min(have, MAX_ROWS, Math.max(MIN_ROWS, fit)));
}

/** A row's measured height per strip (by its title), so the next strip, and its skeleton, start
 *  from the area's own row height. */
const rowHeights = new Map<string, number>();
/** How many rows a strip drew last time (by its title): its skeleton draws as many, without measuring. */
const rowCounts = new Map<string, number>();

/** The height of what follows `el` in its frame: its later siblings, looking through the
 *  `display: contents` wrappers of the staggered reveal (stagger.tsx), each box with its gap. */
function heightAfter(el: Element): number {
  const box = (n: Element): number => {
    if (getComputedStyle(n).display === 'contents') { let s = 0; for (const c of Array.from(n.children)) s += box(c); return s; }
    return n.getBoundingClientRect().height + 24;
  };
  let sum = 0;
  for (let node: Element | null = el; node; ) {
    for (let n = node.nextElementSibling; n; n = n.nextElementSibling) sum += box(n);
    const up: HTMLElement | null = node.parentElement;
    node = up && getComputedStyle(up).display === 'contents' ? up : null;
  }
  return sum;
}

/** The room under the strip's top, down to the bottom of the sheet's scroller, less what follows
 *  the strip in its frame (the explanation) and the strip's own head and foot. */
function useRoom(ref: RefObject<HTMLElement | null>): number {
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = el.closest<HTMLElement>('.ui-stack-inner') ?? document.scrollingElement as HTMLElement | null;
    const measure = () => {
      const s = scroller?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (!s || !s.height) { setRoom(0); return; }
      const after = heightAfter(el);
      const chrome = (el.querySelector<HTMLElement>('.lt-head')?.getBoundingClientRect().height ?? 24) + (el.querySelector<HTMLElement>('.lt-foot')?.getBoundingClientRect().height ?? 0);
      const padBottom = scroller ? parseFloat(getComputedStyle(scroller).paddingBottom) || 0 : 0;
      setRoom(Math.max(0, s.bottom - padBottom - r.top - after - chrome - 16));
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (scroller) ro?.observe(scroller);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [ref]);
  return room;
}

export function Latest(p: LatestProps) {
  const ref = useRef<HTMLElement>(null);
  const room = useRoom(ref);
  const [rowPx, setRowPx] = useState(() => rowHeights.get(p.title) ?? p.rowGuess ?? ROW_GUESS);
  const rows = p.rows ?? [];
  const n = rowsThatFit(room, rowPx, rows.length);
  const shown = rows.slice(0, n);
  useEffect(() => { if (room > 0) rowCounts.set(p.title, shown.length); }, [room, shown.length, p.title]);
  // Measure a drawn row once, so N follows the area's own row height.
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('.lt-item');
    const h = first?.getBoundingClientRect().height ?? 0;
    if (h > 8 && Math.abs(h + 6 - rowPx) > 2) { rowHeights.set(p.title, h + 6); setRowPx(h + 6); }
  }, [shown.length, rowPx, p.title]);

  const hasRows = !!p.rows;
  if (!p.facts && !rows.length && !p.empty) return null;
  const total = p.total ?? rows.length;
  const more = total - shown.length;
  return (
    <section className="lt" ref={ref} aria-label={LATEST.label(p.title)} data-latest={hasRows ? String(shown.length) : 'facts'}>
      <header className="lt-head">
        <h2 className="lt-title">{hasRows ? LATEST.label(p.title) : LATEST.facts}</h2>
        {p.seeAll ? (
          <button type="button" className="lt-all" data-fk={p.seeAll.fk ?? 'latest-all'} onClick={p.seeAll.onOpen} title={LATEST.seeAllTitle(p.title)}>
            {p.seeAll.label ?? LATEST.seeAll}{more > 0 ? <span className="lt-more"> · {LATEST.more(formatCount(more))}</span> : null} <span aria-hidden="true">›</span>
          </button>
        ) : null}
      </header>
      {hasRows ? (shown.length ? (
        <ul className="lt-rows">
          {shown.map((r) => (
            <li key={r.key} className="lt-item">
              <button type="button" className="le-row lt-row" data-fk={`lt-${r.key}`} aria-label={r.label} onClick={r.onOpen}>{r.node}</button>
            </li>
          ))}
        </ul>
      ) : <p className="lt-empty">{p.empty}</p>) : null}
      {p.facts?.length ? (
        <dl className="lt-facts">
          {p.facts.map(([k, v], i) => (
            <div key={i} className="lt-fact"><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

/** The strip's place while it waits for its turn (stagger.tsx): its head and as many quiet rows as
 *  the strip itself will draw (the same room and the same row height), or its facts. */
export function LatestSkeleton(p: LatestProps) {
  // No measuring here (a skeleton is drawn in the same frame as the answer): as many rows as the strip
  // drew last time, else the fewest it draws.
  const rowPx = rowHeights.get(p.title) ?? p.rowGuess ?? ROW_GUESS;
  const rows = p.rows ?? [];
  const n = p.rows ? (rows.length ? Math.min(rows.length, rowCounts.get(p.title) ?? MIN_ROWS) : 1) : 0;
  const facts = p.facts?.length ?? 0;
  return (
    <section className="lt stg-skel" aria-hidden="true" data-latest-skeleton="">
      <header className="lt-head"><span className="lt-title stg-b" style={{ width: '10rem', height: '1.1rem' }} /></header>
      {n ? <div className="lt-rows">{Array.from({ length: n }, (_, i) => <span key={i} className="stg-b" style={{ height: `${rowPx - 6}px` }} />)}</div> : null}
      {facts ? <div className="lt-facts">{Array.from({ length: facts }, (_, i) => <span key={i} className="lt-fact stg-b" style={{ height: '3.4rem' }} />)}</div> : null}
    </section>
  );
}
