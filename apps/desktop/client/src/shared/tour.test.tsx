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
import { KEEP_CLEAR, keepClearBoxes, neighbourBoxes, placeMark, ringBox, TakeTour, Tour, type Box2 } from './tour';

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

  it('Back onto the first stop keeps focus in the dialog, by click and by ArrowLeft', () => {
    const r = render(<Page><Tour win="approval" gs={gs} firstRun /></Page>);
    const inDialog = () => mark()!.contains(document.activeElement);
    fireEvent.click(r.getByText(TOUR.next));
    const back = r.getByText(TOUR.back);
    back.focus();
    fireEvent.click(back);
    expect(r.queryByText(TOUR.back)).toBeNull();
    expect(inDialog()).toBe(true);
    fireEvent.click(r.getByText(TOUR.next));
    r.getByText(TOUR.back).focus();
    fireEvent.keyDown(r.getByText(TOUR.back), { key: 'ArrowLeft' });
    expect(r.queryByText(TOUR.back)).toBeNull();
    expect(inDialog()).toBe(true);
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

describe('the coach mark keeps the mode badge and the primary action clear (polish A)', () => {
  // Measured in the browser preview at 1280 x 800 on the brand-new wallet's charter (`?first_run=1`):
  // the hub (the charter's left column) is the first stop's anchor; the mark is 300 x 176.
  const hub = { left: 52, top: 96, width: 710 - 52, bottom: 740 };
  const keys: Box2 = { left: 52, top: 226, right: 239, bottom: 262 }; // the gold "Add PayPal keys"
  const sandbox: Box2 = { left: 20, top: 767, right: 98, bottom: 789 }; // the mode badge
  const preview: Box2 = { left: 110, top: 767, right: 249, bottom: 789 }; // "Preview · sample data"
  const clear = [keys, sandbox, preview];
  const covers = (m: { left: number; top: number }, b: Box2) => m.left < b.right && m.left + 300 > b.left && m.top < b.bottom && m.top + 176 > b.top;

  it('without the boxes, the old place (the bottom of the window) covered the preview badge', () => {
    const old = placeMark(hub, 300, 176, 1280, 800);
    expect(covers(old, preview)).toBe(true);
  });
  it('with them, it covers none and stays inside the window', () => {
    const m = placeMark(hub, 300, 176, 1280, 800, clear);
    for (const b of clear) expect(covers(m, b)).toBe(false);
    expect(m.left).toBeGreaterThanOrEqual(8);
    expect(m.left + 300).toBeLessThanOrEqual(1280 - 8);
    expect(m.top).toBeGreaterThanOrEqual(8);
    expect(m.top + 176).toBeLessThanOrEqual(800 - 8);
    // beside the hub, not on it
    expect(m.left).toBeGreaterThanOrEqual(hub.left + hub.width);
  });
  it('below the anchor stays the first choice when it is clear', () => {
    expect(placeMark({ left: 100, top: 100, width: 200, bottom: 140 }, 300, 150, 1280, 800, [sandbox])).toEqual(placeMark({ left: 100, top: 100, width: 200, bottom: 140 }, 300, 150, 1280, 800));
  });
  it('when every place covers something, the one that covers least', () => {
    const all: Box2 = { left: 0, top: 0, right: 1280, bottom: 400 };
    const m = placeMark({ left: 500, top: 380, width: 100, bottom: 420 }, 300, 150, 1280, 800, [all]);
    expect(m.top).toBeGreaterThanOrEqual(400);
  });
  it('reads the boxes to keep clear from the page, never from the mark itself', () => {
    document.body.innerHTML = '<span class="badge">Sandbox</span><button class="ui-btn gold">Review</button><div id="m"><button class="ui-btn primary">Next</button></div>';
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      el.getBoundingClientRect = () => ({ left: 1, top: 1, right: 11, bottom: 11, width: 10, height: 10, x: 1, y: 1, toJSON: () => ({}) });
    }
    expect(keepClearBoxes(document.getElementById('m'))).toHaveLength(2);
    document.body.innerHTML = '';
  });
});

describe('the mark and the ring keep off what sits beside the anchor', () => {
  const hit = (a: Box2, b: Box2) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const markBox = (m: { left: number; top: number }, w = 300, h = 176): Box2 => ({ left: m.left, top: m.top, right: m.left + w, bottom: m.top + h });
  const rect = (b: Box2) => ({ ...b, width: b.right - b.left, height: b.bottom - b.top, x: b.left, y: b.top, toJSON: () => ({}) });

  // "Your money stays put" in The Table (1920 x 1080 still): the last line of the charter's note, with
  // the two lines above it and the "Take the tour" link under it.
  const promise: Box2 = { left: 360, top: 746, right: 990, bottom: 770 };
  const lineOne: Box2 = { left: 360, top: 672, right: 990, bottom: 692 };
  const lineTwo: Box2 = { left: 360, top: 700, right: 990, bottom: 742 };
  const takeTour: Box2 = { left: 366, top: 784, right: 450, bottom: 806 };
  const view = { vw: 1920, vh: 860 };

  it('the mark for the promise covers neither note line above it nor the "Take the tour" link', () => {
    const a = { ...promise, width: promise.right - promise.left };
    const m = placeMark(a, 300, 176, view.vw, view.vh, [lineOne, lineTwo, takeTour]);
    for (const b of [lineOne, lineTwo, takeTour]) expect(hit(markBox(m), b)).toBe(false);
    expect(m.left).toBeGreaterThanOrEqual(8);
    expect(m.left + 300).toBeLessThanOrEqual(view.vw - 8);
    expect(m.top).toBeGreaterThanOrEqual(8);
    expect(m.top + 176).toBeLessThanOrEqual(view.vh - 8);
  });
  it('without them it sat above the anchor, on the lines', () => {
    const a = { ...promise, width: promise.right - promise.left };
    expect(hit(markBox(placeMark(a, 300, 176, view.vw, view.vh)), lineTwo)).toBe(true);
  });
  it('the welcome mark (the hub) covers no "Take the tour" link under the card', () => {
    const hub = { left: 354, top: 174, width: 684, bottom: 842 };
    const m = placeMark(hub, 300, 176, view.vw, view.vh, [takeTour]);
    expect(hit(markBox(m), takeTour)).toBe(false);
    // a link inside the hub's own box, with the mark's first choice (below) off screen
    const low = placeMark({ left: 354, top: 600, width: 684, bottom: 842 }, 300, 176, view.vw, 900, [takeTour]);
    expect(hit(markBox(low), takeTour)).toBe(false);
  });
  it('the ring stays off the title above and the steps below (the Tumbler promise, a 36 px row)', () => {
    const title: Box2 = { left: 857, top: 410, right: 1330, bottom: 436 };
    const steps: Box2 = { left: 857, top: 478, right: 1330, bottom: 570 };
    const r: Box2 = { left: 857, top: 436, right: 1330, bottom: 478 };
    const ring = ringBox(r, 1920, 1000, [title, steps]);
    const rb = { left: ring.left, top: ring.top, right: ring.left + ring.width, bottom: ring.top + ring.height };
    expect(hit(rb, title)).toBe(false);
    expect(hit(rb, steps)).toBe(false);
    // it still hugs the anchor
    expect(rb.left).toBeLessThanOrEqual(r.left);
    expect(rb.right).toBeGreaterThanOrEqual(r.right);
    expect(rb.top).toBeLessThanOrEqual(r.top);
    expect(rb.bottom).toBeGreaterThanOrEqual(r.bottom);
    // with nothing beside it, the old 4 px
    expect(ringBox(r, 1920, 1000)).toEqual({ left: 853, top: 432, width: 481, height: 50 });
  });
  it('the ring stays inside the viewport', () => {
    expect(ringBox({ left: 0, top: 0, right: 100, bottom: 40 }, 440, 228)).toEqual({ left: 2, top: 2, width: 102, height: 42 });
    const far = ringBox({ left: 400, top: 200, right: 440, bottom: 228 }, 440, 228);
    expect(far.left + far.width).toBeLessThanOrEqual(438);
    expect(far.top + far.height).toBeLessThanOrEqual(226);
  });
  it('the neighbours are the other items of the anchor list, not the columns of a layout', () => {
    document.body.innerHTML = '<div><ul><li id="a">promise</li><li>one</li><li>two</li></ul></div><div id="col"><p id="p">x</p></div>';
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) el.getBoundingClientRect = () => rect({ left: 1, top: 1, right: 11, bottom: 11 }) as DOMRect;
    expect(neighbourBoxes(document.getElementById('a')!, null)).toHaveLength(2);
    expect(neighbourBoxes(document.getElementById('p')!, null)).toHaveLength(0);
    document.body.innerHTML = '';
  });
  it('"Take the tour" is declared as something the mark keeps clear', () => {
    const { getByText } = render(<TakeTour win="main" gs={null} />);
    expect(getByText(TOUR.take).closest('button')!.matches(KEEP_CLEAR)).toBe(true);
  });
});
