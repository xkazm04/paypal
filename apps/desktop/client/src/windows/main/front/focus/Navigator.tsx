// FOCUS round 2: the side panel as the module navigator. Six module tabs on top (glyph; the name on
// the selected tab and on hover; a badge with how many rows need you), and below them the selected
// module's list: ONE line per item, a sticky header naming the columns, figures right-aligned in
// tabular numerals. The list renders `columns` + `cells` generically: it never knows which module
// it is drawing. The row's `sub` shows only on the open row (the one on the stage card) - one line
// everywhere else. Keys: Left/Right move between tabs; Up/Down/Home/End move the cursor through
// rows, Enter opens it; a click opens directly.
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Module } from '@bindings/Module';
import { MODULE_KEYS } from '../../../../lib/assistant';
import { Glyph, MODULE } from '../../../../shared/modules';
import type { ModuleList, ModuleRow, RowCell } from '../rows/rows';
import { GREET } from './words';

export function Navigator({ lists, needs, mod, onMod, cursor, onCursor, open, need, onOpen }: {
  lists: Record<Module, ModuleList>;
  /** Needs-you count per module, from the board model (a deal counts in its own module only, so the
   *  six badges add up to the status sentence's number even where a list also shows other modules' deals). */
  needs: Record<Module, number>;
  mod: Module;
  onMod: (m: Module) => void;
  /** The keyboard cursor in the list (a row id), or null for the first row. */
  cursor: string | null;
  onCursor: (id: string) => void;
  /** The row on the stage card, if any. */
  open: string | null;
  /** The row the greeting's need card is about, if it is in this list. */
  need: string | null;
  onOpen: (r: ModuleRow) => void;
}) {
  const list = lists[mod];
  const rows = list.rows;
  const at = Math.max(0, rows.findIndex((r) => r.id === cursor));
  const active = rows[at] ?? null;
  const box = useRef<HTMLDivElement>(null);

  // Keep the cursor row in view (keyboard moves, or a reply that picked a row).
  useEffect(() => {
    if (!active) return;
    box.current?.querySelector(`[data-row="${CSS.escape(active.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, mod]);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = MODULE_KEYS.indexOf(mod);
    const go = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? MODULE_KEYS.length - 1 : null;
    if (go === null) return;
    e.preventDefault();
    const m = MODULE_KEYS[(go + MODULE_KEYS.length) % MODULE_KEYS.length] as Module;
    onMod(m);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`.ff-tab[data-module="${m}"]`)?.focus());
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const go = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : null;
    if (go !== null) {
      e.preventDefault();
      onCursor((rows[Math.min(rows.length - 1, Math.max(0, go))] as ModuleRow).id);
      return;
    }
    if (e.key === 'Enter' && active) { e.preventDefault(); onOpen(active); }
  };

  const meta = MODULE[mod];
  const cols = list.columns.length;
  // A column is numeric when any of its cells is: every cell in it right-aligns, dashes included.
  const numCol = list.columns.map((_, i) => rows.some((r) => r.cells[i]?.num));
  return (
    <>
      <div className="ff-tabs" role="tablist" aria-label={GREET.modules}>
        {MODULE_KEYS.map((m) => {
          const n = needs[m];
          const on = m === mod;
          const mm = MODULE[m];
          return (
            <button key={m} type="button" role="tab" id={`ff-tab-${m}`} aria-selected={on} aria-controls="ff-list" tabIndex={on ? 0 : -1}
              className={`ff-tab${on ? ' is-on' : ''}`} style={{ '--mc': mm.cssVar } as React.CSSProperties} data-module={m}
              title={GREET.moduleTitle(mm.name, mm.long, n)} onClick={() => onMod(m)} onKeyDown={onTabKey}>
              <Glyph module={m} className="ff-tab-g" />
              <span className="ff-tab-n">{mm.name}</span>
              {n ? <span className="ff-badge num" aria-label={GREET.needBadge(n)}>{n}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="ff-listhead">
        <b>{meta.long}</b>
        <span className="ff-listcount num">{GREET.rowsCount(rows.length)}</span>
      </div>
      <div ref={box} id="ff-list" className="ff-list" role="listbox" tabIndex={rows.length ? 0 : -1} aria-labelledby={`ff-tab-${mod}`}
        aria-activedescendant={active ? `ff-row-${active.id}` : undefined} onKeyDown={onListKey}
        style={{ '--cols': cols, '--mc': meta.cssVar } as React.CSSProperties} data-list={mod}>
        {rows.length ? (
          <div className="ff-row ff-row-h" role="presentation">
            <span className="ff-t">{GREET.itemCol}</span>
            {list.columns.map((c, i) => <span key={i} className={`ff-c${numCol[i] ? ' is-num' : ''}`}>{c}</span>)}
          </div>
        ) : null}
        {rows.map((r) => {
          const isOpen = r.id === open;
          return (
            <div key={r.id} id={`ff-row-${r.id}`} role="option" aria-selected={isOpen}
              className={`ff-row${r === active ? ' is-cursor' : ''}${isOpen ? ' is-open' : ''}${r.fate === 'needs' ? ' is-needs' : ''}${r.id === need ? ' is-need' : ''}`}
              data-row={r.id} data-deal={r.deal_id ?? undefined} title={r.sub ?? undefined}
              onMouseDown={(e) => e.preventDefault()} onClick={() => { onCursor(r.id); onOpen(r); box.current?.focus({ preventScroll: true }); }}>
              <span className="ff-t">{r.fate === 'needs' ? <i className="ff-needdot" aria-hidden="true" /> : null}<span className="ff-tt">{r.title}</span></span>
              {Array.from({ length: cols }, (_, i) => <Cell key={i} c={r.cells[i]} num={!!numCol[i]} />)}
              {isOpen && r.sub ? <span className="ff-rsub">{r.sub}</span> : null}
            </div>
          );
        })}
        {rows.length ? null : <p className="ff-empty">{list.empty}</p>}
      </div>
      {rows.length ? <p className="ff-keys">{GREET.keysHint}</p> : null}
    </>
  );
}

function Cell({ c, num }: { c: RowCell | undefined; num: boolean }) {
  if (!c) return <span className={`ff-c${num ? ' is-num' : ''}`} />;
  return <span className={`ff-c${num ? ' is-num' : ''}${c.num ? ' num' : ''}${c.tone ? ` tn-${c.tone}` : ''}`}>{c.text}</span>;
}
