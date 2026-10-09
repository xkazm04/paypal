// The tour on screen: a stop shows beside its element, Next and Back move, the last stop reads
// Finish, Skip (or Esc) ends it for good, "Take the tour" brings it back, and a stop whose element
// is not on screen is never shown. The mark never carries a gold button and never acts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contrast, hexTokens, parseHex, type Rgb } from '../lib/contrast';
import { gettingStarted, type StartFacts } from '../lib/firstRun';
import { loadTour, resetTourMemory, TOUR_KEY } from '../lib/tour';
import { TOUR, TOUR_STOP } from '../lib/words';
import { placeMark, TakeTour, Tour } from './tour';

const facts: StartFacts = { firstRun: true, paypal: false, rulesInForce: 0, houseConnected: false, otherConnections: 0, engine: 'scripted' };
const gs = gettingStarted(facts);

/** The approval window's anchors, as the owner configuration renders them. */
function Page({ engine = true, children }: { engine?: boolean; children?: React.ReactNode }) {
  return (
    <div>
      <div data-tour="approval-answer"><button type="button">Connect PayPal…</button></div>
      <ol data-tour="start-steps">{engine ? <li data-tour="step-engine">Choose your agent app</li> : null}</ol>
      <section data-tour="owner-config">Wallet</section>
      {children}
    </div>
  );
}
const mark = () => document.querySelector<HTMLElement>('.tour-mark');
const title = () => mark()?.querySelector('h2')?.textContent;

describe('the tour on screen', () => {
  beforeEach(() => {
    localStorage.clear();
    resetTourMemory();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('starts on first run as a labelled, non-modal dialog with the first stop, n of N and no gold button', () => {
    render(<Page><Tour win="approval" gs={gs} firstRun /></Page>);
    const d = mark()!;
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.getAttribute('aria-modal')).toBe('false');
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe(TOUR_STOP['approval.only'].title);
    expect(document.getElementById(d.getAttribute('aria-describedby')!)?.textContent).toBe(TOUR_STOP['approval.only'].text);
    expect(d.textContent).toContain('1 of 4');
    expect(d.querySelector('.gold')).toBeNull();
    expect(document.querySelector('.tour-ring')).not.toBeNull();
    // Focus moved into it, on Next.
    expect(document.activeElement?.textContent).toBe(TOUR.next);
  });

  it('does not start by itself outside first run', () => {
    render(<Page><Tour win="approval" gs={gs} firstRun={false} /></Page>);
    expect(mark()).toBeNull();
  });

  it('Next and Back move between stops, and the last stop finishes it for good', () => {
    const r = render(<Page><Tour win="approval" gs={gs} firstRun /></Page>);
    fireEvent.click(r.getByText(TOUR.next));
    expect(title()).toBe(TOUR_STOP['approval.steps'].title);
    expect(mark()!.textContent).toContain('2 of 4');
    fireEvent.click(r.getByText(TOUR.back));
    expect(title()).toBe(TOUR_STOP['approval.only'].title);
    // The arrow keys do the same.
    fireEvent.keyDown(mark()!, { key: 'ArrowRight' });
    fireEvent.keyDown(mark()!, { key: 'ArrowRight' });
    fireEvent.keyDown(mark()!, { key: 'ArrowRight' });
    expect(title()).toBe(TOUR_STOP['approval.config'].title);
    fireEvent.keyDown(mark()!, { key: 'ArrowRight' });
    expect(title()).toBe(TOUR_STOP['approval.config'].title);
    fireEvent.keyDown(mark()!, { key: 'ArrowLeft' });
    expect(title()).toBe(TOUR_STOP['approval.engine'].title);
    fireEvent.click(r.getByText(TOUR.next));
    fireEvent.click(r.getByText(TOUR.finish));
    expect(mark()).toBeNull();
    expect(loadTour('approval')).toEqual({ status: 'finished', at: null });
    expect(JSON.parse(localStorage.getItem(TOUR_KEY)!).approval.status).toBe('finished');
  });

  it('announces a new stop: after Next or an arrow key, focus is on the dialog, which holds the new title', () => {
    const r = render(<Page><Tour win="approval" gs={gs} firstRun /></Page>);
    expect(document.activeElement?.textContent).toBe(TOUR.next);
    fireEvent.click(r.getByText(TOUR.next));
    expect(title()).toBe(TOUR_STOP['approval.steps'].title);
    expect(document.activeElement).toBe(mark());
    expect(mark()!.getAttribute('tabindex')).toBe('-1');
    expect(document.getElementById(mark()!.getAttribute('aria-labelledby')!)?.textContent).toBe(TOUR_STOP['approval.steps'].title);
    fireEvent.keyDown(mark()!, { key: 'ArrowRight' });
    expect(title()).toBe(TOUR_STOP['approval.engine'].title);
    expect(document.activeElement).toBe(mark());
  });

  it('Skip tour ends it, it stays closed after a reload, and focus goes back where it was', () => {
    const page = (tour: boolean) => <Page><button type="button">before</button>{tour ? <Tour win="approval" gs={gs} firstRun /> : null}</Page>;
    const r = render(page(false));
    r.getByText('before').focus();
    r.rerender(page(true));
    expect(document.activeElement?.textContent).toBe(TOUR.next);
    fireEvent.click(r.getByText(TOUR.skip));
    expect(mark()).toBeNull();
    expect(document.activeElement?.textContent).toBe('before');
    cleanup();
    resetTourMemory();
    render(<Page><Tour win="approval" gs={gs} firstRun /></Page>);
    expect(mark()).toBeNull();
  });

  it('Esc skips', () => {
    render(<Page><Tour win="approval" gs={gs} firstRun /></Page>);
    fireEvent.keyDown(mark()!, { key: 'Escape' });
    expect(mark()).toBeNull();
    expect(loadTour('approval').status).toBe('skipped');
  });

  it('“Take the tour” reopens it on the first stop', () => {
    const r = render(<Page><TakeTour win="approval" gs={gs} /><Tour win="approval" gs={gs} firstRun /></Page>);
    fireEvent.click(r.getByText(TOUR.skip));
    expect(mark()).toBeNull();
    act(() => { fireEvent.click(r.getByText(TOUR.take)); });
    expect(title()).toBe(TOUR_STOP['approval.only'].title);
  });

  it('a stop whose element is absent is never shown, and nothing shows with no anchors at all', () => {
    const r = render(<Page engine={false}><Tour win="approval" gs={gs} firstRun /></Page>);
    expect(mark()!.textContent).toContain('1 of 3');
    fireEvent.click(r.getByText(TOUR.next));
    fireEvent.click(r.getByText(TOUR.next));
    expect(title()).toBe(TOUR_STOP['approval.config'].title);
    cleanup();
    localStorage.clear();
    resetTourMemory();
    render(<div><Tour win="approval" gs={gs} firstRun /></div>);
    expect(mark()).toBeNull();
    // An anchor inside a hidden part of the page does not count.
    cleanup();
    render(<div aria-hidden="true"><Page><Tour win="approval" gs={gs} firstRun /></Page></div>);
    expect(mark()).toBeNull();
  });

  it('waits while something sits on top', () => {
    const r = render(<Page><Tour win="approval" gs={gs} firstRun paused /></Page>);
    expect(mark()).toBeNull();
    r.rerender(<Page><Tour win="approval" gs={gs} firstRun paused={false} /></Page>);
    expect(mark()).not.toBeNull();
  });

  it('follows a write to its own key from another page (the director), and ignores any other key', () => {
    render(<Page><Tour win="approval" gs={gs} firstRun /></Page>);
    expect(mark()?.dataset.tourStop).toBe('approval.only');
    const write = (key: string, at: string) => act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify({ approval: { status: 'active', at } }) }));
    });
    write(TOUR_KEY, 'approval.config');
    expect(mark()?.dataset.tourStop).toBe('approval.config');
    expect(title()).toBe(TOUR_STOP['approval.config'].title);
    // another key (the first-run world's tour, the theme) leaves the mark where it is
    write(`${TOUR_KEY}:first-run`, 'approval.steps');
    write('table-theme', 'approval.steps');
    expect(mark()?.dataset.tourStop).toBe('approval.config');
    // nothing was saved by the window itself: it only followed
    expect(localStorage.getItem(TOUR_KEY)).toBeNull();
  });

  it('a framed window in the first-run world follows the first-run key', () => {
    const key = `${TOUR_KEY}:first-run`;
    render(<Page><Tour win="approval" gs={gs} firstRun storageKey={key} /></Page>);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify({ approval: { status: 'active', at: 'approval.engine' } }) }));
    });
    expect(mark()?.dataset.tourStop).toBe('approval.engine');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify({ approval: { status: 'finished', at: null } }) }));
    });
    expect(mark()).toBeNull();
  });

  it('does not take the keyboard while the window is not focused', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    render(<Page><Tour win="approval" gs={gs} firstRun /></Page>);
    expect(mark()).not.toBeNull();
    expect(mark()!.contains(document.activeElement)).toBe(false);
  });
});

describe('the coach mark stays inside the viewport', () => {
  const a = (top: number, bottom: number, left = 100, width = 200) => ({ top, bottom, left, width });
  it('below the element when there is room, else above, else at the bottom edge', () => {
    expect(placeMark(a(100, 140), 300, 150, 1280, 800)).toEqual({ left: 50, top: 150 });
    expect(placeMark(a(600, 700), 300, 150, 1280, 800)).toEqual({ left: 50, top: 440 });
    // The Tumbler: a 440 x 228 window with the welcome filling it.
    expect(placeMark(a(0, 228, 0, 440), 260, 130, 440, 228)).toEqual({ left: 90, top: 90 });
  });
  it('never past an edge, even narrower than the mark', () => {
    expect(placeMark(a(100, 140, 1200, 60), 300, 150, 1280, 800).left).toBe(1280 - 300 - 8);
    expect(placeMark(a(100, 140, -50, 20), 300, 150, 1280, 800).left).toBe(8);
    expect(placeMark(a(10, 20, 0, 100), 300, 400, 320, 300)).toEqual({ left: 8, top: 8 });
  });
});

describe('the coach mark is readable in both themes', () => {
  // vitest runs from the client package root (pnpm --dir apps/desktop/client test)
  const tokens = readFileSync(resolve(process.cwd(), 'src/design/tokens.css'), 'utf8');
  const tour = readFileSync(resolve(process.cwd(), 'src/shared/tour.css'), 'utf8');
  const split = tokens.indexOf(':root[data-theme="light"]');
  const dark = hexTokens(tokens.slice(0, split));
  const light = { ...dark, ...hexTokens(tokens.slice(split)) };
  const rgb = (t: Record<string, string>, k: string): Rgb => {
    const v = t[k] ? parseHex(t[k]) : null;
    if (!v) throw new Error(`token --${k} is not a hex colour`);
    return [v[0], v[1], v[2]];
  };

  it('draws its inks on --panel2 and its focus and ring in --focus', () => {
    expect(tour).toMatch(/\.tour-mark \{[^}]*background: var\(--panel2\)/);
    for (const ink of ['text', 'muted', 'dim']) expect(tour).toContain(`color: var(--${ink})`);
    expect(tour).toMatch(/:focus-visible \{ outline: 2px solid var\(--focus\)/);
    expect(tour).toMatch(/\.tour-ring \{[^}]*0 0 0 2px var\(--focus\)/);
    expect(tour).toContain('prefers-reduced-motion: no-preference');
  });

  for (const [name, t, focus] of [['dark', dark, 'gold-l'], ['light', light, 'pp-blue']] as const) {
    it(`${name}: text 4.5:1, focus ring and highlight 3:1`, () => {
      const panel = rgb(t, 'panel2');
      for (const ink of ['text', 'muted', 'dim', 'teal-l']) expect(contrast(rgb(t, ink), panel), ink).toBeGreaterThanOrEqual(4.5);
      // Next is a primary button: its ink on its fill.
      expect(contrast(rgb(t, 'on-teal'), rgb(t, 'teal'))).toBeGreaterThanOrEqual(4.5);
      // The focus outline and the ring (non-text, 3:1) against the mark and the page behind it.
      for (const s of ['panel2', 'bg', 'bg2', 'panel']) expect(contrast(rgb(t, focus), rgb(t, s)), s).toBeGreaterThanOrEqual(3);
    });
  }
});
