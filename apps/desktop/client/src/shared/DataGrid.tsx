// The app's one data grid: every columnar list draws through it, in our colours. Sorting, per-column
// filters, resizing, reordering and row windowing are the grid's; what a row means stays the caller's.
//
// Column definitions are built once per column shape and read the caller's latest functions through a
// ref, so a world change refreshes the cells in view instead of rebuilding the grid (and losing its
// sort, filters and column widths).
//
// Two row models: the client model (all `rows` in memory) and, with `source`, the infinite model, whose
// filter and sort are the server's. Group options are additive and exist only on the Enterprise tier
// (./gridLicence): on Community the columns marked for grouping are plain columns, or absent.
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode, type Ref } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule, ModuleRegistry, type ColDef, type ColumnState, type GridApi, type ICellRendererParams, type IDatasource, type IRowNode, type RowClickedEvent,
} from 'ag-grid-community';
import { LIST_LOADING, LIST_TOTAL } from '../lib/words';
// Static files, not the Theming API: the desktop CSP is style-src 'self', which blocks the <style> tags
// the Theming API injects (measured: no theme, dead header, no row windowing).
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import './datagrid.css';
import { useGridTier, type GridTier } from './gridLicence';
import { loadLayout, saveLayout, type SavedColumn } from './gridState';

ModuleRegistry.registerModules([AllCommunityModule]);

export const GRID_ROW_HEIGHT = 36;
/** How long after the last change a layout is saved. */
const SAVE_MS = 400;

// Stable objects: a new one on each render makes the grid re-apply its options.
const DEFAULT_COL = { resizable: true } as const;
const NO_PICK_NODE = (n: IRowNode) => !n.group && !n.rowPinned;
const SELECTION = { mode: 'singleRow', checkboxes: false, enableClickSelection: true, isRowSelectable: NO_PICK_NODE } as const;
/** The grid's own group header column. */
const GROUP_COLUMN = 'ag-Grid-AutoColumn';

export type GridColumn<T> = {
  id: string;
  header: string;
  /** What the column sorts and filters by. */
  value: (row: T) => string | number | null;
  /** What the cell draws; absent = the value as plain text. */
  cell?: (row: T) => ReactNode;
  /** The filter over `value`; default 'text'. False = no filter on this column. */
  filter?: 'text' | 'number' | false;
  /** A number filter's value when it differs from `value` (minor units filtered as major). */
  filterValue?: (row: T) => number | null;
  width?: number;
  flex?: number;
  minWidth?: number;
  end?: boolean;
  sortable?: boolean;
  sort?: 'asc' | 'desc';
  className?: string;
  /** Offered in "Group by" (Enterprise only; a plain column on Community). */
  group?: boolean;
  /** Exists only to be grouped by, so it is absent on Community and hidden on Enterprise. */
  groupOnly?: boolean;
  /** The column that shows a group's money (from `totals`); its group cell spans the next column too. */
  aggregate?: boolean;
};

export type DataGridHandle = {
  /** Clears the column filters; false when there were none. */
  clearFilters: () => boolean;
  /** Scrolls so that row `index` is the top row in view (the infinite list's "go to a day"). */
  showIndex: (index: number) => void;
};

/** A page the server answered: its rows and the true count of everything matching. */
export type GridPage<T> = { rows: readonly T[]; total: number };
/** The server side of the infinite model: `getRows` is asked for [start, end) in the current sort. */
export type GridSource<T> = { getRows: (start: number, end: number, sort: 'asc' | 'desc' | null) => Promise<GridPage<T>> };

export type DataGridProps<T> = {
  label: string;
  /** The client model's rows; ignored with `source`. */
  rows?: readonly T[];
  /** The infinite model (rows read a block at a time, filter and sort executed by the server). */
  source?: GridSource<T>;
  /** Rows per server read with `source`. */
  blockSize?: number;
  getKey: (row: T) => string;
  columns: readonly GridColumn<T>[];
  /** A row's accessible name, when its cells say too little. */
  rowLabel?: (row: T) => string;
  /** A click or Space on a row. */
  onActivate?: (row: T) => void;
  /** Enter on a row. */
  onEnter?: (row: T) => void;
  /** The rows left after the column filters, whenever that changes. */
  onDisplayed?: (count: number) => void;
  /** Those same rows, for what follows them (a chart). Not called on the infinite model. */
  onFilteredRows?: (rows: readonly T[]) => void;
  /** Noted when a column filter hides every row. */
  noMatch?: string;
  /** Size to the rows instead of filling the parent (a short list). */
  autoHeight?: boolean;
  handle?: Ref<DataGridHandle>;
  /** The key of this list's saved layout (default: its label). */
  layoutKey?: string;
  /** The quick search text. */
  quickFilter?: string;
  /** A row's search text (default: its column values). */
  quickText?: (row: T) => string;
  /** The totals of a set of rows: the pinned row of the filtered rows, and a group's money. */
  totals?: (rows: readonly T[]) => string;
  /** The column to group by, or null; Enterprise only. */
  groupBy?: string | null;
};

type TotalRow = { readonly sgTotal: string };
const isTotal = (r: unknown): r is TotalRow => typeof r === 'object' && r !== null && 'sgTotal' in r;
/** Rows of a group after the filter, however deep. */
function leavesOf<T>(node: IRowNode<T>, out: T[] = []): T[] {
  for (const c of node.childrenAfterFilter ?? []) {
    if (c.group) leavesOf(c, out);
    else if (c.data) out.push(c.data);
  }
  return out;
}

const shapeOf = <T,>(columns: readonly GridColumn<T>[]): string =>
  columns.map((c) => [c.id, c.header, c.filter, c.width, c.flex, c.minWidth, c.end, c.sortable, c.sort, c.className, !!c.cell, !!c.group, !!c.groupOnly, !!c.aggregate].join('|')).join('~');

const filterOf = (f: GridColumn<unknown>['filter']): ColDef['filter'] => {
  if (f === false) return false;
  return f === 'number' ? 'agNumberColumnFilter' : 'agTextColumnFilter';
};

const collate = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
/** Column values in order: blanks first, numbers by size, text by the owner's alphabet. */
export function compareValues(a: unknown, b: unknown): number {
  const blankA = a === null || a === undefined || a === '';
  const blankB = b === null || b === undefined || b === '';
  if (blankA || blankB) return blankA && blankB ? 0 : blankA ? -1 : 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collate(String(a), String(b));
}

function colSpanOf<T>(c: GridColumn<T> | null, p: { node?: IRowNode | null; column?: { getColId: () => string } | null; api: GridApi }): number {
  if (p.node?.rowPinned) {
    const all = p.api.getAllDisplayedColumns() ?? [];
    return all[0]?.getColId() === p.column?.getColId() ? all.length : 1;
  }
  if (p.node?.group && c?.aggregate) return 2;
  return 1;
}

function TotalCell({ line }: { line: string }) {
  return <span className="sg-total" title={line}>{line}</span>;
}
function CellOf<T>(v: ICellRendererParams<T> & { draw: (r: T) => ReactNode; end: boolean }) {
  return v.data ? <span className={`sg-cell${v.end ? ' end' : ''}`}>{v.draw(v.data)}</span> : null;
}
function GroupMoney(v: ICellRendererParams & { end: boolean }) {
  const line = typeof v.value === 'string' ? v.value : '';
  return <span className={`sg-cell sg-group-money${v.end ? ' end' : ''}`} title={line}>{line}</span>;
}

export function DataGrid<T>(p: DataGridProps<T>) {
  const api = useRef<GridApi<T> | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const shape = shapeOf(p.columns);
  const layoutKey = p.layoutKey ?? p.label;
  const locale = useMemo(() => (p.noMatch ? { noRowsToShow: p.noMatch } : undefined), [p.noMatch]);
  const wantsGroup = p.columns.some((c) => c.group);
  const tier: GridTier = useGridTier(wantsGroup);
  const grouped = tier === 'enterprise' && wantsGroup;
  const infinite = !!p.source;

  const defs = useMemo<ColDef<T>[]>(() => {
    const col = (id: string) => latest.current.columns.find((c) => c.id === id);
    const keyOf = (n: IRowNode<T>): string => (n.data ? latest.current.getKey(n.data) : n.key ?? '');
    return latest.current.columns.filter((c) => !c.groupOnly || grouped).map((c) => ({
      colId: c.id,
      headerName: c.header,
      width: c.width,
      flex: c.flex,
      minWidth: c.minWidth,
      initialSort: c.sort,
      sortable: c.sortable !== false,
      type: c.end ? 'rightAligned' : undefined,
      cellClass: c.className,
      filter: filterOf(c.filter),
      floatingFilter: c.filter !== false,
      hide: c.groupOnly ? true : undefined,
      enableRowGroup: grouped && c.group ? true : undefined,
      aggFunc: grouped && c.aggregate ? 'sgTotals' : undefined,
      colSpan: (q) => colSpanOf(c, q),
      // Equal values keep one order whichever way the column is sorted, so rows never swap on a refresh.
      comparator: (a: unknown, b: unknown, na: IRowNode<T>, nb: IRowNode<T>, desc: boolean) => {
        const n = na.group || nb.group ? 0 : compareValues(a, b);
        if (n !== 0) return n;
        const tie = keyOf(na).localeCompare(keyOf(nb));
        return desc ? -tie : tie;
      },
      valueGetter: (v) => (v.data && !v.node?.rowPinned ? col(c.id)?.value(v.data) ?? null : null),
      filterValueGetter: c.filterValue ? (v) => (v.data ? col(c.id)?.filterValue?.(v.data) ?? null : null) : undefined,
      // The search text is the row's, once, on the first column; the rest add nothing.
      getQuickFilterText: (q) => {
        const words = latest.current.quickText;
        if (!words) return String(q.value ?? '');
        return c.id === latest.current.columns[0]?.id && q.data ? words(q.data) : '';
      },
      cellRendererSelector: (v: ICellRendererParams<T>) => {
        if (v.node.rowPinned) return isTotal(v.node.data) ? { component: TotalCell, params: { line: v.node.data.sgTotal } } : undefined;
        if (v.node.group) return c.aggregate ? { component: GroupMoney, params: { end: !!c.end } } : undefined;
        return c.cell ? { component: CellOf, params: { draw: (r: T) => col(c.id)?.cell?.(r), end: !!c.end } } : undefined;
      },
    })) as ColDef<T>[];
    // The shape is the dependency: the functions are read through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, grouped]);

  // New functions over the same shape (the world moved): redraw the cells in view only.
  useEffect(() => { api.current?.refreshCells({ force: true }); }, [p.columns]);

  // The grid's own column for a group: grouping is by the column's value, so the label is the owner's words.
  const groupColumn = useMemo<ColDef<T> | undefined>(() => (grouped ? {
    minWidth: 220, sortable: true, filter: false, colSpan: (q) => colSpanOf<T>(null, q),
    cellRendererSelector: (v: ICellRendererParams<T>) => (v.node.rowPinned && isTotal(v.node.data) ? { component: TotalCell, params: { line: v.node.data.sgTotal } } : { component: 'agGroupCellRenderer' }),
  } : undefined), [grouped]);
  const aggFuncs = useMemo(() => (grouped ? { sgTotals: (q: { rowNode: IRowNode<T> }) => latest.current.totals?.(leavesOf(q.rowNode)) ?? '' } : undefined), [grouped]);

  useImperativeHandle(p.handle, () => ({
    clearFilters: () => {
      if (!api.current?.isAnyFilterPresent()) return false;
      api.current.setFilterModel(null);
      return true;
    },
    showIndex: (index) => api.current?.ensureIndexVisible(index, 'top'),
  }), []);

  // ---- the saved layout ---------------------------------------------------------------------------
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveNow = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!api.current) return;
    saveLayout(layoutKey, api.current.getColumnState().filter((c) => c.colId !== GROUP_COLUMN).map((c: ColumnState): SavedColumn => ({ colId: c.colId, width: c.width, hide: c.hide, pinned: c.pinned, sort: c.sort, sortIndex: c.sortIndex, flex: c.flex })));
  }, [layoutKey]);
  const save = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(saveNow, SAVE_MS);
  }, [saveNow]);

  // ---- the group choice -------------------------------------------------------------------------
  const applyGroup = useCallback((a: GridApi<T>) => {
    if (!grouped) return;
    const want = latest.current.groupBy ?? null;
    const now = a.getRowGroupColumns()[0]?.getColId() ?? null;
    if (want !== now) a.setRowGroupColumns(want ? [want] : []);
  }, [grouped]);
  useEffect(() => { if (api.current) applyGroup(api.current); }, [p.groupBy, applyGroup]);

  // ---- what the grid shows, for the row of totals and the chart -----------------------------------
  const lastTotal = useRef<string | null>(null);
  const syncShown = useCallback((a: GridApi<T>) => {
    const now = latest.current;
    if (infinite) { now.onDisplayed?.(a.getDisplayedRowCount()); return; }
    const leaves: T[] = [];
    a.forEachNodeAfterFilter((n) => { if (n.data && !n.group) leaves.push(n.data); });
    now.onDisplayed?.(leaves.length);
    now.onFilteredRows?.(leaves);
    if (!now.totals) return;
    const line = `${LIST_TOTAL(leaves.length)}: ${now.totals(leaves)}`;
    if (line === lastTotal.current) return;
    lastTotal.current = line;
    a.setGridOption('pinnedBottomRowData', [{ sgTotal: line } as unknown as T]);
  }, [infinite]);

  const quick = p.quickFilter ?? '';
  useEffect(() => { if (api.current && !infinite) api.current.setGridOption('quickFilterText', quick); }, [quick, infinite]);

  const datasource = useMemo<IDatasource | undefined>(() => {
    if (!p.source) return undefined;
    const source = p.source;
    return {
      getRows: (q) => {
        const sort = q.sortModel[0]?.sort ?? null;
        source.getRows(q.startRow, q.endRow, sort).then(
          (page) => q.successCallback(page.rows as T[], page.total),
          () => q.failCallback(),
        );
      },
    };
  }, [p.source]);

  // Group options need the Enterprise chunk first; a key-less build never waits here.
  if (tier === 'loading' && wantsGroup) return <p className="le-empty" role="status">{LIST_LOADING}</p>;

  const onRowClicked = (e: RowClickedEvent<T>) => {
    if (e.node.rowPinned) return;
    if (e.node.group) {
      // A group row picks nothing: a click opens or closes it, unless the click was on its chevron, which already did.
      const target = e.event?.target as HTMLElement | null;
      if (!target?.closest?.('.ag-group-contracted, .ag-group-expanded')) e.node.setExpanded(!e.node.expanded);
      return;
    }
    if (e.data) latest.current.onActivate?.(e.data);
  };

  const model = infinite
    ? { rowModelType: 'infinite' as const, datasource, cacheBlockSize: p.blockSize ?? 200, maxConcurrentDatasourceRequests: 1, infiniteInitialRowCount: 40, suppressMultiSort: true }
    : { rowData: p.rows as T[], cacheQuickFilter: true, quickFilterText: quick };
  const groupOptions = grouped ? { autoGroupColumnDef: groupColumn, aggFuncs, suppressAggFuncInHeader: true, groupDefaultExpanded: 0 } : {};

  return (
    <div className="sg-grid ag-theme-quartz" role="group" aria-label={p.label} data-auto={p.autoHeight ? '' : undefined}>
      <AgGridReact<T> theme="legacy" {...model} {...groupOptions} columnDefs={defs}
        defaultColDef={DEFAULT_COL} getRowId={(r) => (isTotal(r.data) ? `sg-total-${r.data.sgTotal}` : latest.current.getKey(r.data))}
        rowHeight={GRID_ROW_HEIGHT} headerHeight={30} floatingFiltersHeight={32} animateRows={false}
        domLayout={p.autoHeight ? 'autoHeight' : 'normal'}
        rowSelection={SELECTION}
        localeText={locale}
        onGridReady={(e) => {
          api.current = e.api;
          const known = new Set(e.api.getColumns()?.map((c) => c.getColId()) ?? []);
          const state = loadLayout(layoutKey).filter((c) => known.has(c.colId));
          if (state.length) e.api.applyColumnState({ state, applyOrder: true });
          applyGroup(e.api);
          syncShown(e.api);
        }}
        onSortChanged={save} onColumnMoved={(e) => { if (e.finished) save(); }} onColumnResized={(e) => { if (e.finished) save(); }} onColumnVisible={save}
        processRowPostCreate={(r) => {
          const row = r.node.data;
          if (!row || isTotal(row) || r.node.rowPinned || r.node.group) return;
          const label = latest.current.rowLabel?.(row);
          if (label) r.eRow.setAttribute('aria-label', label);
          // Layer memory finds a row by data-fk: focus coming back to the row goes on to its first cell.
          r.eRow.setAttribute('data-fk', `le-${latest.current.getKey(row)}`);
          r.eRow.tabIndex = -1;
          r.eRow.addEventListener('focus', () => {
            const first = api.current?.getAllDisplayedColumns()[0];
            if (first && r.node.rowIndex !== null) api.current?.setFocusedCell(r.node.rowIndex, first);
          });
        }}
        onModelUpdated={(e) => syncShown(e.api)}
        onRowClicked={onRowClicked}
        onCellKeyDown={(e) => {
          const key = (e.event as KeyboardEvent | null | undefined)?.key;
          if (!e.data || isTotal(e.data) || e.node.group || (key !== 'Enter' && key !== ' ')) return;
          (e.event as KeyboardEvent).preventDefault();
          if (key === 'Enter') latest.current.onEnter?.(e.data);
          else latest.current.onActivate?.(e.data);
        }} />
    </div>
  );
}
