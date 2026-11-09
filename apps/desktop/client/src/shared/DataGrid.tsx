// The app's one data grid: every columnar list draws through it, in our colours. Sorting, per-column
// filters, resizing, reordering and row windowing are the grid's; what a row means stays the caller's.
//
// Column definitions are built once per column shape and read the caller's latest functions through a
// ref, so a world change refreshes the cells in view instead of rebuilding the grid (and losing its
// sort, filters and column widths).
import { useEffect, useImperativeHandle, useMemo, useRef, type ReactNode, type Ref } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, type ColDef, type GridApi, type ICellRendererParams } from 'ag-grid-community';
// Static files, not the Theming API: the desktop CSP is style-src 'self', which blocks the <style> tags
// the Theming API injects (measured: no theme, dead header, no row windowing).
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import './datagrid.css';

ModuleRegistry.registerModules([AllCommunityModule]);

export const GRID_ROW_HEIGHT = 36;

// Stable objects: a new one on each render makes the grid re-apply its options.
const DEFAULT_COL = { resizable: true } as const;
const SELECTION = { mode: 'singleRow', checkboxes: false, enableClickSelection: true } as const;

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
};

export type DataGridHandle = {
  /** Clears the column filters; false when there were none. */
  clearFilters: () => boolean;
};

export type DataGridProps<T> = {
  label: string;
  rows: readonly T[];
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
  /** Noted when a column filter hides every row. */
  noMatch?: string;
  /** Size to the rows instead of filling the parent (a short list). */
  autoHeight?: boolean;
  handle?: Ref<DataGridHandle>;
};

const shapeOf = <T,>(columns: readonly GridColumn<T>[]): string =>
  columns.map((c) => [c.id, c.header, c.filter, c.width, c.flex, c.minWidth, c.end, c.sortable, c.sort, c.className, !!c.cell].join('|')).join('~');

const filterOf = (f: GridColumn<unknown>['filter']): ColDef['filter'] => {
  if (f === false) return false;
  return f === 'number' ? 'agNumberColumnFilter' : 'agTextColumnFilter';
};

export function DataGrid<T>(p: DataGridProps<T>) {
  const api = useRef<GridApi<T> | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const shape = shapeOf(p.columns);
  const locale = useMemo(() => (p.noMatch ? { noRowsToShow: p.noMatch } : undefined), [p.noMatch]);

  const defs = useMemo<ColDef<T>[]>(() => {
    const col = (id: string) => latest.current.columns.find((c) => c.id === id);
    return latest.current.columns.map((c) => ({
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
      valueGetter: (v) => (v.data ? col(c.id)?.value(v.data) ?? null : null),
      filterValueGetter: c.filterValue ? (v) => (v.data ? col(c.id)?.filterValue?.(v.data) ?? null : null) : undefined,
      cellRenderer: c.cell ? (v: ICellRendererParams<T>) => (v.data ? <span className={`sg-cell${c.end ? ' end' : ''}`}>{col(c.id)?.cell?.(v.data)}</span> : null) : undefined,
    }));
    // The shape is the dependency: the functions are read through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  // New functions over the same shape (the world moved): redraw the cells in view only.
  useEffect(() => { api.current?.refreshCells({ force: true }); }, [p.columns]);

  useImperativeHandle(p.handle, () => ({
    clearFilters: () => {
      if (!api.current?.isAnyFilterPresent()) return false;
      api.current.setFilterModel(null);
      return true;
    },
  }), []);

  return (
    <div className="sg-grid ag-theme-quartz" role="group" aria-label={p.label} data-auto={p.autoHeight ? '' : undefined}>
      <AgGridReact<T> theme="legacy" rowData={p.rows as T[]} columnDefs={defs}
        defaultColDef={DEFAULT_COL} getRowId={(r) => latest.current.getKey(r.data)}
        rowHeight={GRID_ROW_HEIGHT} headerHeight={30} floatingFiltersHeight={32} animateRows={false}
        domLayout={p.autoHeight ? 'autoHeight' : 'normal'}
        rowSelection={SELECTION}
        localeText={locale}
        onGridReady={(e) => { api.current = e.api; }}
        processRowPostCreate={(r) => {
          const row = r.node.data;
          if (!row) return;
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
        onModelUpdated={(e) => latest.current.onDisplayed?.(e.api.getDisplayedRowCount())}
        onRowClicked={(e) => { if (e.data) latest.current.onActivate?.(e.data); }}
        onCellKeyDown={(e) => {
          const key = (e.event as KeyboardEvent | null | undefined)?.key;
          if (!e.data || (key !== 'Enter' && key !== ' ')) return;
          (e.event as KeyboardEvent).preventDefault();
          if (key === 'Enter') latest.current.onEnter?.(e.data);
          else latest.current.onActivate?.(e.data);
        }} />
    </div>
  );
}
