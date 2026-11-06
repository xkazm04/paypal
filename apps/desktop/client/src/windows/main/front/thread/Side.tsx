// THREAD side panel: the module navigator. All six modules stacked as collapsible sections (sticky
// header: glyph, name, count, needs-you dot); an open section shows its column names and its first
// PEEK rows, one line each, with "n more" expanding in place. Rows render the list contract
// generically (front/rows/rows.ts): title + the module's own cells, numbers right-aligned in tabular
// figures. `sub` shows only on the selected row. Arrow up/down walk every header and row in order;
// Enter (a native button press) opens.
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Module } from '@bindings/Module';
import { Glyph, MODULE, MODULES } from '../../../../shared/modules';
import type { ModuleList, ModuleRow, RowCell } from '../rows/rows';
import { GREET } from './words';

export const PEEK = 5;

export type Nav = {
  open: ReadonlySet<Module>;
  /** Sections showing every row instead of the first PEEK. */
  more: ReadonlySet<Module>;
  sel: { module: Module; id: string } | null;
};

export const rowKey = (m: Module, id: string): string => `${m}:${id}`;

export function Side({ lists, nav, onToggle, onMore, onPick }: {
  lists: Record<Module, ModuleList>;
  nav: Nav;
  onToggle: (m: Module) => void;
  onMore: (m: Module) => void;
  onPick: (r: ModuleRow) => void;
}) {
  const root = useRef<HTMLElement>(null);

  // Keep the selected row in view (a reply or a pick from the conversation may select it).
  const selKey = nav.sel ? rowKey(nav.sel.module, nav.sel.id) : null;
  useEffect(() => {
    if (!selKey) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(selKey)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selKey]);

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = [...(root.current?.querySelectorAll<HTMLElement>('[data-nav]') ?? [])];
    if (!all.length) return;
    e.preventDefault();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? 0 : Math.max(0, Math.min(all.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
    all[next]?.focus();
  };

  return (
    <nav className="ft-nav" ref={root} aria-label={GREET.navLabel} onKeyDown={onKey}>
      {MODULES.map((m) => {
        const list = lists[m.key];
        const needs = list.rows.filter((r) => r.fate === 'needs').length;
        const isOpen = nav.open.has(m.key);
        const all = nav.more.has(m.key);
        const shown = isOpen ? (all ? list.rows : list.rows.slice(0, PEEK)) : [];
        const hidden = list.rows.length - PEEK;
        const cols = list.columns.length;
        const numCol = list.columns.map((_, i) => list.rows.some((r) => r.cells[i]?.num));
        const titleId = `ft-sec-${m.key}`;
        return (
          <section key={m.key} className={`ft-sec${isOpen ? ' is-open' : ''}${list.rows.length ? '' : ' is-zero'}`} style={{ '--mc': m.cssVar } as React.CSSProperties} data-section={m.key}>
            <h3 className="ft-sec-h" id={titleId}>
              <button type="button" className="ft-sec-b" data-nav aria-expanded={isOpen} onClick={() => onToggle(m.key)}
                title={GREET.sectionTitle(m.name, m.long, list.rows.length, needs)}>
                <span className="ft-chev" aria-hidden="true" />
                <Glyph module={m.key} className="ft-sec-g" />
                <span className="ft-sec-n">{m.name}</span>
                {needs ? <i className="ft-dot" aria-label={`${needs} need you`} /> : null}
                <span className="ft-sec-c">{list.rows.length}</span>
              </button>
            </h3>
            {isOpen ? (
              list.rows.length === 0 ? <p className="ft-empty">{list.empty}</p> : (
                <div className="ft-rows" role="list" aria-labelledby={titleId}
                  style={{ gridTemplateColumns: cols ? `minmax(0, 1fr) repeat(${cols}, auto)` : 'minmax(0, 1fr)' }}>
                  {cols ? (
                    <div className="ft-colh" aria-hidden="true">
                      <span />
                      {list.columns.map((c, i) => <span key={c} className={numCol[i] ? 'is-num' : undefined}>{c}</span>)}
                    </div>
                  ) : null}
                  {shown.map((r) => {
                    const sel = nav.sel?.module === m.key && nav.sel.id === r.id;
                    return (
                      <div role="listitem" key={r.id} className="ft-rowwrap">
                        <button type="button" className={`ft-row${sel ? ' is-sel' : ''}${r.fate ? ` f-${r.fate}` : ''}`} data-nav data-row={rowKey(m.key, r.id)}
                          aria-current={sel ? 'true' : undefined} title={r.sub ? `${r.title}\n${r.sub}` : r.title} onClick={() => onPick(r)}>
                          <span className="ft-row-t">{r.title}</span>
                          {Array.from({ length: cols }, (_, i) => <Cell key={i} c={r.cells[i]} num={!!numCol[i]} />)}
                          {sel && r.sub ? <span className="ft-row-sub">{r.sub}</span> : null}
                        </button>
                      </div>
                    );
                  })}
                  {hidden > 0 ? (
                    <button type="button" className="ft-more-b linkbtn" data-nav onClick={() => onMore(m.key)} aria-expanded={all}>
                      {all ? GREET.fewer : GREET.more(hidden)}
                    </button>
                  ) : null}
                </div>
              )
            ) : null}
          </section>
        );
      })}
    </nav>
  );
}

function Cell({ c, num }: { c: RowCell | undefined; num: boolean }) {
  if (!c) return <span className="ft-cell" />;
  return <span className={`ft-cell${c.num || num ? ' is-num' : ''}${c.tone ? ` t-${c.tone}` : ''}`}>{c.text}</span>;
}

/** The module of a selection, for "Opened X" lines. */
export const moduleName = (m: Module): string => MODULE[m].name;
