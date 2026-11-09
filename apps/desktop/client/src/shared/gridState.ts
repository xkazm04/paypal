// A list's saved grid layout (column widths, order, sort) and its "group by" choice, per list. Storage
// can be missing or throw (private mode, blocked site data), so every access is guarded: losing the
// saved layout never breaks a list.
const LAYOUT = 'sg-grid:layout:v1:';
const GROUP = 'sg-grid:group:v1:';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } catch { /* storage unavailable: the layout is simply not kept */ }
}

export type SavedColumn = { colId: string; width?: number; hide?: boolean | null; pinned?: 'left' | 'right' | boolean | null; sort?: 'asc' | 'desc' | null; sortIndex?: number | null; flex?: number | null };

/** The layout saved for a list; empty when none, or when what is stored is not a layout. */
export function loadLayout(list: string): SavedColumn[] {
  try {
    const raw = read(LAYOUT + list);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((c): c is SavedColumn => typeof c === 'object' && c !== null && typeof (c as SavedColumn).colId === 'string') : [];
  } catch { return []; }
}
export const saveLayout = (list: string, columns: readonly SavedColumn[]): void => write(LAYOUT + list, JSON.stringify(columns));

/** The column a list was last grouped by, or null. */
export const loadGroup = (list: string): string | null => read(GROUP + list);
export const saveGroup = (list: string, column: string | null): void => write(GROUP + list, column);
