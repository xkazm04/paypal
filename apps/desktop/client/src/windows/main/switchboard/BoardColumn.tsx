// The board column (spark the-proof-table): the proof. Six areas by four fates as COUNTS (no deal keys
// in cells; deal detail lives in the panels), the cells the answer lights, a sum line that adds the lit
// cells up, and at most six lit deals as keys. It answers to the sentence: whatever the sentence's
// figure lights (or else the reply's own light and the owner's filter, lit.ts litFromArrangement) is
// lit here. A real count of 0 is the dashed empty cell; an unknown value is never drawn as 0.
// Keyboard: the grid is one tab stop and the arrows move across its heads and cells (keys.ts
// stepGrid, a roving tabindex); a cell is a native button, so Enter lights it and shows only it.
// Every press here is the owner's move (filter, open a deal); nothing here can move money.
import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Module } from '@bindings/Module';
import { FATES, MODULE_KEYS, type Fate, type PanelSpec } from '../../../lib/assistant';
import {
  BOARD_ALL, BOARD_COLUMN, BOARD_CORNER, BOARD_CRUMB_LABEL, BOARD_EMPTY_BOARD, BOARD_FATE, BOARD_FILTER_CLEAR, BOARD_GRID_LABEL, BOARD_MODULE_ROLE, BOARD_MORE,
} from '../../../lib/words';
import { Glyph, MODULE } from '../../../shared/modules';
import { Btn, UNKNOWN } from '../../../shared/ui';
import { stepGrid, type GridPos } from './keys';
import { FATE_TONE, isCellLit, litKeys, passes, sumLine, type Filter, type LitSet } from './lit';
import { amountText, Shape } from './parts';
import type { BoardModel } from './useBoardModel';

export const MAX_KEYS = 6;

/** The lit set as a list the book panel can show: one area, one fate, or one cell; else null. */
export function bookOf(lit: LitSet): Extract<PanelSpec, { kind: 'book' }> | null {
  if (lit.deals.length) return null;
  const { rows, cols, cells } = lit;
  if (cells.length === 1 && !rows.length && !cols.length) return { kind: 'book', module: cells[0]![0], fate: cells[0]![1] };
  if (rows.length === 1 && !cols.length && !cells.length) return { kind: 'book', module: rows[0]!, fate: null };
  if (cols.length === 1 && !rows.length && !cells.length) return { kind: 'book', module: null, fate: cols[0]! };
  return null;
}

export type BoardColumnProps = {
  model: BoardModel;
  filter: Filter;
  lit: LitSet;
  crumb: readonly string[];
  /** Something is filtered or lit: "Show everything" is offered. */
  active: boolean;
  onShowEverything: () => void;
  onRow: (m: Module) => void;
  onCol: (f: Fate) => void;
  onCell: (m: Module, f: Fate) => void;
  /** Open the deal behind a lit key (its decision when it needs her, else the deal). */
  onKey: (id: string) => void;
  /** Open the lit deals as a list (the book panel). */
  onMore: (spec: PanelSpec) => void;
};

const at = (r: number, c: number): string => `${r},${c}`;

export function BoardColumn({ model, filter, lit, crumb, active, onShowEverything, onRow, onCol, onCell, onKey, onMore }: BoardColumnProps) {
  const [pos, setPos] = useState<GridPos>([1, 1]);
  const grid = useRef<HTMLDivElement>(null);
  const onGridKey = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    const t = e.target instanceof HTMLElement ? e.target : null;
    const from = t?.dataset.g?.split(',').map(Number);
    if (!from || from.length !== 2) return;
    const next = stepGrid([from[0]!, from[1]!], e.key);
    if (e.key.startsWith('Arrow')) e.preventDefault();
    if (!next) return;
    setPos(next);
    grid.current?.querySelector<HTMLElement>(`[data-g="${at(next[0], next[1])}"]`)?.focus();
  }, []);
  const stop = (r: number, c: number): 0 | -1 => (pos[0] === r && pos[1] === c ? 0 : -1);
  const focusAt = (r: number, c: number) => () => setPos([r, c]);

  const sum = sumLine(lit, model);
  const keys = litKeys(lit, model, MAX_KEYS);
  const more = sum ? sum.total - keys.length : 0;
  const book = more > 0 ? bookOf(lit) : null;
  const filtered = !!(filter.module || filter.fate);

  return (
    <aside className="sb-boardcol" aria-label={BOARD_GRID_LABEL}>
      <section className="ui-stack-sheet sb-board" aria-label={BOARD_COLUMN.title}>
        <header className="sb-board-h">
          <div className="sb-board-t">
            <p className="kicker">{BOARD_COLUMN.title}</p>
            <nav className="sb-crumb" aria-label={BOARD_CRUMB_LABEL}>
              {crumb.map((c, i) => (
                <span key={i} className={i === crumb.length - 1 ? 'sb-here' : undefined} aria-current={i === crumb.length - 1 ? 'location' : undefined}>
                  {i ? <i aria-hidden="true">›</i> : null}{c}
                </span>
              ))}
            </nav>
          </div>
          {active ? <Btn sm onClick={onShowEverything} data-everything>{BOARD_FILTER_CLEAR}</Btn> : null}
        </header>
        <div className="ui-stack-inner sb-board-b">
          <div ref={grid} className="sb-grid" role="grid" aria-label={BOARD_GRID_LABEL} onKeyDown={onGridKey} data-filtered={filtered ? 'true' : 'false'}>
            <div role="row" className="sb-grow sb-grow-head">
              <span className="sb-corner">{BOARD_CORNER}</span>
              {FATES.map((f, i) => (
                <button key={f} type="button" role="columnheader" className={`sb-colhead${lit.cols.includes(f) ? ' is-lit' : ''}`} data-tone={FATE_TONE[f]} data-col={f}
                  data-g={at(0, i + 1)} tabIndex={stop(0, i + 1)} onFocus={focusAt(0, i + 1)} aria-pressed={filter.fate === f}
                  aria-label={BOARD_COLUMN.col(BOARD_FATE[f].word, model.colCount[f])} title={BOARD_FATE[f].means} onClick={() => onCol(f)}>
                  <span className="sb-colhead-n"><Shape fate={f} size={11} /><span className="num" data-count={f}>{model.colCount[f]}</span></span>
                  <span className="sb-colhead-w">{BOARD_FATE[f].short}</span>
                </button>
              ))}
              <span className="sb-tot">{BOARD_ALL}</span>
            </div>
            {MODULE_KEYS.map((m, ri) => (
              <div key={m} role="row" className="sb-grow">
                <button type="button" role="rowheader" className={`sb-rowhead${lit.rows.includes(m) ? ' is-lit' : ''}`} style={{ '--fc': MODULE[m].cssVar } as React.CSSProperties}
                  data-rowhead={m} data-g={at(ri + 1, 0)} tabIndex={stop(ri + 1, 0)} onFocus={focusAt(ri + 1, 0)} aria-pressed={filter.module === m}
                  aria-label={BOARD_COLUMN.row(MODULE[m].name, BOARD_MODULE_ROLE[m], model.rowCount[m])} title={`${MODULE[m].long}: ${BOARD_MODULE_ROLE[m]}`} onClick={() => onRow(m)}>
                  <Glyph module={m} className="sb-rowglyph" /><span className="sb-rowname">{MODULE[m].name}</span>
                </button>
                {FATES.map((f, fi) => {
                  const n = model.cells[m][f].count;
                  const on = isCellLit(lit, m, f);
                  const dim = !passes(filter, m, f);
                  return (
                    <button key={f} type="button" role="gridcell" className={`sb-cell${on ? ' ui-lit' : ''}${n ? '' : ' is-empty'}${dim ? ' is-dim' : ''}`} data-tone={FATE_TONE[f]}
                      data-cell={`${m}:${f}`} data-count={n} data-g={at(ri + 1, fi + 1)} tabIndex={stop(ri + 1, fi + 1)} onFocus={focusAt(ri + 1, fi + 1)}
                      aria-pressed={filter.module === m && filter.fate === f} aria-label={BOARD_COLUMN.cell(MODULE[m].name, BOARD_FATE[f].word, n, on)} onClick={() => onCell(m, f)}>
                      <span className="num sb-cell-n" aria-hidden="true">{n ? n : UNKNOWN}</span>
                    </button>
                  );
                })}
                <span className="sb-tot num">{model.rowCount[m]}</span>
              </div>
            ))}
          </div>
          {sum ? (
            <p className="ui-sum sb-sum" aria-label={BOARD_COLUMN.sumLabel(sum.total)} data-sum={sum.total}>
              {sum.terms.length ? <><span className="terms num">{sum.terms.join(' + ')}</span><span className="eq"> = <b className="num">{sum.total}</b> {BOARD_COLUMN.lit(sum.total)}</span></> : BOARD_COLUMN.emptyLit}
            </p>
          ) : <p className="ui-sum is-quiet sb-sum">{model.keys.length ? BOARD_COLUMN.noneLit : ' '}</p>}
          <div className="sb-keys" aria-label={BOARD_COLUMN.keysLabel} role="group">
            {model.ready && model.keys.length === 0 ? <p className="sb-keys-none" data-empty-board>{BOARD_EMPTY_BOARD}</p> : null}
            {keys.map((k) => {
              const amt = amountText(k);
              return (
                <button key={k.id} type="button" className="ui-key" data-tone={FATE_TONE[k.fate]} data-key={k.id} title={`${k.title}, ${k.state_word}`}
                  aria-label={BOARD_COLUMN.key(k.label, k.title, amt, k.state_word)} onClick={() => onKey(k.id)}>
                  <span className="ref">{k.label}</span><span className="amt num">{amt ?? UNKNOWN}</span>
                </button>
              );
            })}
            {more > 0 ? (book
              ? <button type="button" className="sb-more" data-more onClick={() => onMore(book)} title={BOARD_COLUMN.moreTitle}>{BOARD_MORE(more)}</button>
              : <span className="sb-more is-quiet num" data-more>{BOARD_MORE(more)}</span>) : null}
          </div>
        </div>
      </section>
    </aside>
  );
}
