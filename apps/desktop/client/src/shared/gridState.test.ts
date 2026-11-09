import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGroup, loadLayout, saveGroup, saveLayout } from './gridState';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('a list keeps its grid layout', () => {
  it('per list', () => {
    saveLayout('a', [{ colId: 'x', width: 120, sort: 'asc' }]);
    expect(loadLayout('a')).toEqual([{ colId: 'x', width: 120, sort: 'asc' }]);
    expect(loadLayout('b')).toEqual([]);
    saveGroup('a', 'x');
    expect(loadGroup('a')).toBe('x');
    saveGroup('a', null);
    expect(loadGroup('a')).toBeNull();
  });
  it('ignores what is not a layout', () => {
    localStorage.setItem('sg-grid:layout:v1:a', '{broken');
    expect(loadLayout('a')).toEqual([]);
    localStorage.setItem('sg-grid:layout:v1:a', JSON.stringify([{ colId: 'x' }, 7, null, { nope: 1 }]));
    expect(loadLayout('a')).toEqual([{ colId: 'x' }]);
  });
  it('is harmless when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => saveLayout('a', [{ colId: 'x' }])).not.toThrow();
    expect(loadLayout('a')).toEqual([]);
    expect(loadGroup('a')).toBeNull();
  });
});
