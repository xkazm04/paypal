// STAGE fork: the side panel as ONE list. A segmented switcher (All + the six module glyphs, a gold
// dot where something needs you), a title filter, an optional fate filter the assistant set, then the
// rows: one line each (title + the module's own cells, numbers right-aligned in tabular figures).
// All shows title | module glyph | amount | state. The selected row (its stage is open in main) is
// marked and shows its `sub` line; a row the assistant pointed at is ringed. Arrow keys move, Enter
// opens. Columns align across rows through a CSS subgrid.
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Module } from '@bindings/Module';
import { BOARD_FATE } from '../../../../lib/words';
import { Glyph, MODULE, MODULES } from '../../../../shared/modules';
import { amountText } from '../../switchboard/parts';
import type { BoardModel } from '../../switchboard/useBoardModel';
import type { ModuleList, ModuleRow, RowCell } from '../rows/rows';
import { allRows, rowKey, visibleRows, type Nav, type Scope } from './nav';
import { STAGE } from './words';

export type SideProps = {
  lists: Record<Module, ModuleList>;
  nav: Nav;
  model: BoardModel;
  selected: string | null;
  onScope: (s: Scope) => void;
  onQuery: (q: string) => void;
  onClearFate: () => void;
  onOpen: (r: ModuleRow) => void;
};

/** The All view's cells: amount (from the board model for a deal, else the row's first number) and state. */
function allCells(r: ModuleRow, model: BoardModel): RowCell[] {
  const k = r.deal_id ? model.byId.get(r.deal_id) : undefined;
  const amt = k ? amountText(k) : r.cells.find((c) => c.num)?.text ?? null;
  const state: RowCell = r.fate ? { text: BOARD_FATE[r.fate].short, tone: r.fate } : (r.cells.find((c) => !c.num) ?? { text: '', tone: 'quiet' });
  return [{ text: amt ?? '–', num: true, tone: amt ? undefined : 'quiet' }, state];
}

export function Side({ lists, nav, model, selected, onScope, onQuery, onClearFate, onOpen }: SideProps) {
  const rows = visibleRows(lists, nav);
  const mod: Module | null = nav.scope === 'all' ? null : nav.scope;
  const total = mod ? lists[mod]?.rows.length ?? 0 : allRows(lists).length;
  const isAll = mod === null;
  const columns: string[] = mod ? (lists[mod]?.columns ?? []) : ['', STAGE.colAmount, STAGE.colState];
  const box = useRef<HTMLDivElement>(null);
  const filter = useRef<HTMLInputElement>(null);

  // Keep the selected or ringed row in view when it changes (an assistant focus, a pick, Undo).
  const target = selected ?? nav.lit;
  useEffect(() => {
    if (!target) return;
    box.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(target)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [target, nav.scope]);

  const focusRow = (i: number) => {
    const all = [...(box.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
    all[Math.max(0, Math.min(all.length - 1, i))]?.focus();
  };
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const all = [...(box.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    if (e.key === 'Home') { focusRow(0); return; }
    if (e.key === 'End') { focusRow(all.length - 1); return; }
    if (i < 0) { focusRow(0); return; }
    if (e.key === 'ArrowUp' && i === 0) { filter.current?.focus(); return; }
    focusRow(i + (e.key === 'ArrowDown' ? 1 : -1));
  };
  const onFilterKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(0); }
    if (e.key === 'Enter' && rows[0]) { e.preventDefault(); onOpen(rows[0]); }
  };

  return (
    <aside className="fs-side" aria-label={STAGE.side}>
      <div className="fs-seg" role="tablist" aria-label={STAGE.side}>
        <button type="button" role="tab" aria-selected={isAll} className={`fs-segb is-all${isAll ? ' is-on' : ''}`} title={STAGE.allTitle} onClick={() => onScope('all')} data-scope="all">
          {STAGE.all}
        </button>
        {MODULES.map((m) => {
          const l = lists[m.key];
          const needs = model.cells[m.key].needs.count;
          const on = nav.scope === m.key;
          const t = STAGE.scopeTitle(m.name, m.long, l?.rows.length ?? 0, needs);
          return (
            <button key={m.key} type="button" role="tab" aria-selected={on} aria-label={t} title={t} data-scope={m.key}
              className={`fs-segb${on ? ' is-on' : ''}`} style={{ '--mc': m.cssVar } as React.CSSProperties} onClick={() => onScope(m.key)}>
              <Glyph module={m.key} className="fs-segg" />
              {needs ? <i className="fs-dot" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      <div className="fs-tools">
        <input ref={filter} className="ui-field fs-filter" type="search" value={nav.query} placeholder={STAGE.filter} aria-label={STAGE.filterLabel}
          onChange={(e) => onQuery(e.target.value)} onKeyDown={onFilterKey} autoComplete="off" />
        {nav.fate ? (
          <button type="button" className="fs-fate" onClick={onClearFate} title={STAGE.clearFate}>{STAGE.fateOnly(BOARD_FATE[nav.fate].short)} <span aria-hidden="true">×</span></button>
        ) : null}
        <span className="fs-count">{STAGE.count(rows.length, total)}</span>
      </div>
      <div className="fs-list" ref={box} role="listbox" aria-label={isAll ? STAGE.allTitle : (mod ? MODULE[mod].name : '')}
        onKeyDown={onListKey} style={{ '--cols': columns.length } as React.CSSProperties}>
        <div className="fs-grid">
        <div className="fs-lh" aria-hidden="true">
          <span>{isAll ? STAGE.colItem : (mod ? MODULE[mod].name : '')}</span>
          {columns.map((c, i) => <span key={i} className={isAll ? (i === 0 ? '' : i === 1 ? 'is-num' : '') : ((mod ? lists[mod] : undefined)?.rows[0]?.cells[i]?.num ? 'is-num' : '')}>{c}</span>)}
        </div>
        {rows.length === 0 ? (
          <p className="fs-empty">{nav.query.trim() ? STAGE.noMatch(nav.query.trim()) : isAll ? STAGE.nothing : (mod ? lists[mod] : undefined)?.empty}</p>
        ) : rows.map((r) => {
          const key = rowKey(r);
          const on = key === selected;
          const cells = isAll ? allCells(r, model) : r.cells;
          return (
            <button key={key} type="button" role="option" aria-selected={on} data-row={key} tabIndex={on || (!selected && r === rows[0]) ? 0 : -1}
              className={`fs-row${on ? ' is-on' : ''}${nav.lit === key ? ' is-lit' : ''}${r.fate === 'needs' ? ' is-need' : ''}`}
              style={{ '--mc': MODULE[r.module].cssVar } as React.CSSProperties} title={r.sub ? `${r.title} · ${r.sub}` : r.title} onClick={() => onOpen(r)}>
              <span className="fs-rt">{r.title}</span>
              {isAll ? <span className="fs-rc fs-rg"><Glyph module={r.module} className="fs-rgl" /></span> : null}
              {(isAll ? cells.slice(0, 2) : cells.slice(0, columns.length)).map((c, i) => (
                <span key={i} className={`fs-rc${c.num ? ' is-num' : ''}${c.tone ? ` fs-tn-${c.tone}` : ''}`}>{c.text}</span>
              ))}
              {/* a module with fewer cells than columns still fills its grid row */}
              {!isAll && cells.length < columns.length ? Array.from({ length: columns.length - cells.length }, (_, i) => <span key={`x${i}`} className="fs-rc" />) : null}
              {on && r.sub ? <span className="fs-rsub">{r.sub}</span> : null}
            </button>
          );
        })}
        </div>
      </div>
      <p className="fs-keys">{STAGE.keysHint}</p>
    </aside>
  );
}
