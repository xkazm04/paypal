// Theme for the main window: 'dark' (the Dial, default) or 'light' (PayPal palette).
// Stored per browser origin in localStorage under `table-theme`; storage can be missing or throw
// (private mode, blocked site data, previews), so every access is guarded and dark is the fallback.
// The main window and the Tumbler follow the stored theme (initTheme, followStoredTheme); the
// approval window is always dark. Tokens: src/design/tokens.css `[data-theme="light"]`.

export type Theme = 'dark' | 'light';
export const THEME_KEY = 'table-theme';
export const THEMES: readonly Theme[] = ['dark', 'light'];

const isTheme = (v: unknown): v is Theme => v === 'dark' || v === 'light';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The stored theme, or 'dark' when nothing (valid) is stored or storage is unavailable. */
export function getTheme(): Theme {
  try {
    const v = storage()?.getItem(THEME_KEY);
    return isTheme(v) ? v : 'dark';
  } catch {
    return 'dark';
  }
}

/** Sets `data-theme` on the root element (no storage). */
export function applyTheme(theme: Theme, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (root) root.dataset.theme = theme;
}

const listeners = new Set<(t: Theme) => void>();

/** Persists (best effort) and applies the theme, then notifies subscribers. */
export function setTheme(theme: Theme): void {
  if (!isTheme(theme)) return;
  try {
    storage()?.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the theme still applies for this session.
  }
  applyTheme(theme);
  for (const l of listeners) l(theme);
}

/** Applies the stored theme; call once before the first render (main window only). */
export function initTheme(): Theme {
  const t = getTheme();
  applyTheme(t);
  return t;
}

/** Subscribe to theme changes made through setTheme (used by ThemeSwitch). */
export function onThemeChange(fn: (t: Theme) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The theme currently applied to the document (falls back to the stored one). */
export function currentTheme(): Theme {
  const v = typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme;
  return isTheme(v) ? v : getTheme();
}

/** Applies the stored theme and follows later changes made in another window of this origin
 *  (the `storage` event). For windows that never show the switch themselves (the Tumbler). */
export function followStoredTheme(): Theme {
  const t = initTheme();
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === null || e.key === THEME_KEY) applyTheme(getTheme());
    });
  }
  return t;
}
