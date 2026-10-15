// The console's crumbs (polish A). The whole chain of layers when it fits the bar; on a narrow bar
// the middle layers fold into one "…" (its tooltip is the whole way here, a click lists the folded
// layers to go back to), and then the first one too, so the current layer (and the Back button
// beside the crumbs) always stays readable. Each crumb still shrinks with an ellipsis as a last
// resort, its full name in its title. Display only: a crumb moves along the console's chain.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CRUMBS_MORE } from '../../../lib/words';
import { Depth, Popover } from '../../../shared/ui';

export type Crumb = { label: ReactNode; onClick?: () => void };

/** Which crumbs show at a fold level (pure; tested): indexes into the chain, `-1` for the "…".
 *  0: all. 1: the first, "…", the last two. 2: "…", the last two. 3: "…", the last one. A level a
 *  chain this short cannot use is the last useful one. */
export function foldCrumbs(n: number, level: number): number[] {
  const all = Array.from({ length: n }, (_, i) => i);
  if (level <= 0 || n <= 2) return all;
  if (level === 1 && n >= 4) return [0, -1, n - 2, n - 1];
  if (level <= 2 && n >= 3) return [-1, n - 2, n - 1];
  return [-1, n - 1];
}
/** The deepest fold level that still changes something for a chain of `n`. */
export const maxFold = (n: number): number => (n <= 2 ? 0 : 3);

/** The bar is too narrow at this fold: the crumbs overflow, or a crumb is cut by its ellipsis.
 *  From fold 2 on (only the last two layers left), the one above may be cut; the current never. */
function tooNarrow(nav: HTMLElement, level: number): boolean {
  if (nav.scrollWidth > nav.clientWidth + 1) return true;
  const names = Array.from(nav.querySelectorAll<HTMLElement>(':scope > .ui-crumb-wrap > :not(.sep)'));
  const isCut = (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1;
  const last = names[names.length - 1];
  return level >= 2 ? !!last && isCut(last) : names.some(isCut);
}

export function CrumbTrail({ items, label, depth, chainKey }: { items: readonly Crumb[]; label: string; depth: number; chainKey: string }) {
  const nav = useRef<HTMLElement>(null);
  const pathRef = useRef<HTMLSpanElement>(null);
  const [level, setLevel] = useState(0);
  const [width, setWidth] = useState(0);
  const [path, setPath] = useState('');
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const n = items.length;

  // A new chain, or a new width: start from the whole chain and fold until nothing is cut.
  useLayoutEffect(() => { setLevel(0); setMenu(null); }, [chainKey, width]);
  // The names may arrive after the chain (a deal's title is read): follow the text, which reads no layout.
  useLayoutEffect(() => {
    const t = pathRef.current?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (t !== path) setPath(t);
  });
  // Measure only when something that changes the fit changed (a layout read per render would cost a
  // forced layout on every redraw of the window).
  useLayoutEffect(() => {
    const el = nav.current;
    if (el && level < maxFold(n) && tooNarrow(el, level)) setLevel((l) => l + 1);
  }, [chainKey, width, level, path, n]);
  useLayoutEffect(() => {
    const el = nav.current?.parentElement;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = foldCrumbs(n, level);
  const folded = shown.includes(-1) ? items.map((c, i) => ({ c, i })).filter(({ i }) => !shown.includes(i)) : [];
  return (
    <nav className="ui-crumbs cs-crumbs" aria-label={label} ref={nav} data-fold={level || undefined} title={folded.length ? CRUMBS_MORE.title(path) : undefined}>
      {shown.map((i, k) => {
        const sep = k ? <span className="sep" aria-hidden="true">›</span> : null;
        if (i === -1) {
          return (
            <span key="more" className="ui-crumb-wrap cs-crumb-more">
              {sep}
              <button type="button" aria-label={CRUMBS_MORE.label(folded.length)} aria-haspopup="menu" aria-expanded={!!menu} title={CRUMBS_MORE.title(path)}
                onClick={(e) => { const t = e.currentTarget; setMenu((m) => (m ? null : t)); }}>…</button>
            </span>
          );
        }
        const c = items[i];
        if (!c) return null;
        const last = i === n - 1;
        return (
          <span key={i} className={`ui-crumb-wrap${last ? ' cs-crumb-cur' : ''}`}>
            {sep}
            {!last && c.onClick ? <button type="button" onClick={c.onClick}>{c.label}</button> : <span aria-current={last ? 'page' : undefined}>{c.label}</span>}
          </span>
        );
      })}
      <Depth value={depth} />
      {/* The whole way here as text, for the tooltip (never shown). */}
      <span hidden ref={pathRef}>{items.map((c, i) => <span key={i}>{i ? ' › ' : ''}{c.label}</span>)}</span>
      {menu && folded.length ? (
        <Popover anchor={menu} onClose={() => setMenu(null)} title={CRUMBS_MORE.menu} className="cs-crumb-menu">
          <ul className="cs-crumb-list" role="menu" aria-label={CRUMBS_MORE.menu}>
            {folded.map(({ c, i }) => (
              <li key={i} role="none">
                <button type="button" role="menuitem" disabled={!c.onClick} onClick={() => { setMenu(null); c.onClick?.(); }}>{c.label}</button>
              </li>
            ))}
          </ul>
        </Popover>
      ) : null}
    </nav>
  );
}
