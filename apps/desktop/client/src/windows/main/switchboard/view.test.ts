// The default-home rule (spark the-proof-table): the address, then a console deep link, then the
// remembered choice, then the board.
import { afterEach, describe, expect, it } from 'vitest';
import { initialView, VIEW_KEY } from './view';

const at = (url: string, remembered: string | null = null) => {
  history.replaceState(null, '', url);
  localStorage.clear();
  if (remembered !== null) localStorage.setItem(VIEW_KEY, remembered);
  return initialView();
};

afterEach(() => { history.replaceState(null, '', '/'); localStorage.clear(); });

describe('initialView', () => {
  it('no address and nothing remembered: the board', () => {
    expect(at('/index.html')).toBe('board');
    expect(at('/index.html#')).toBe('board');
  });
  it('a console deep link opens the console: a deal, rewind, a module, a place, setup, an old sheet link', () => {
    for (const h of ['#d=D-0193', '#r=rewind', '#m=spend', '#p=safety', '#s=setup&step=rules', '#w=waiting', '#s=settings']) expect(at(`/index.html${h}`), h).toBe('console');
  });
  it('a hash the console reads as its home is not a deep link', () => {
    expect(at('/index.html#x=1')).toBe('board');
    expect(at('/index.html#x=1', 'console')).toBe('console');
  });
  it('the address wins over a deep link and over the remembered choice', () => {
    expect(at('/index.html?view=console')).toBe('console');
    expect(at('/index.html?view=board#d=D-0193', 'console')).toBe('board');
    expect(at('/index.html?view=console', 'board')).toBe('console');
  });
  it('a deep link wins over the remembered board; the remembered choice wins over the default', () => {
    expect(at('/index.html#d=D-0193', 'board')).toBe('console');
    expect(at('/index.html', 'console')).toBe('console');
    expect(at('/index.html?view=nope', 'board')).toBe('board');
  });
});
