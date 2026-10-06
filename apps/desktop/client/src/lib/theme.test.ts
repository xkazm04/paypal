import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, currentTheme, getTheme, initTheme, onThemeChange, setTheme, THEME_KEY } from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });
  afterEach(() => vi.restoreAllMocks());

  it('defaults to dark when nothing is stored', () => {
    expect(getTheme()).toBe('dark');
    expect(initTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('persists under table-theme and applies data-theme', () => {
    setTheme('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(getTheme()).toBe('light');
    expect(currentTheme()).toBe('light');
  });

  it('initTheme applies the stored theme before render', () => {
    localStorage.setItem('table-theme', 'light');
    expect(initTheme()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('ignores junk in storage', () => {
    localStorage.setItem(THEME_KEY, 'neon');
    expect(getTheme()).toBe('dark');
  });

  it('survives storage that throws (private mode, blocked site data)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(getTheme()).toBe('dark');
    expect(() => setTheme('light')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const seen: string[] = [];
    const off = onThemeChange((t) => seen.push(t));
    setTheme('light');
    off();
    setTheme('dark');
    expect(seen).toEqual(['light']);
  });

  it('applyTheme targets the given root only', () => {
    const el = document.createElement('div');
    applyTheme('light', el);
    expect(el.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
