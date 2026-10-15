// Demo mode in the console (polish wave, builder B): the footer's switcher, the sample approval
// sheet, Find's "Demo: ..." entries and the demo words. Nothing here calls the wallet: the switcher
// only stores a word and reloads (the reload is injected), the sheet only shows a page.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as demoWords from '../../../lib/words/demo';
import { DEMO_APPROVAL, DEMO_BADGE, DEMO_DEGRADED, DEMO_LIVE, DEMO_LOCKED, DEMO_RESET, DEMO_SWITCH, DEMO_WORLD } from '../../../lib/words';
import { DEMO_RETURN_KEY, pinDemo, type DemoState } from '../../../lib/preview';
import { DemoStrip } from '../../approval/DemoStrip';
import { DemoSwitch, demoFindItems, resetDemoSwitchForTests, switchDemo } from './DemoSwitch';

type Win = { __TAURI_INTERNALS__?: unknown };
const S = (world: DemoState['world'], o: Partial<DemoState> = {}): DemoState => ({ world, degrade: false, locked: false, ...o });
/** The page as the desktop app (native) or a browser started it. */
function started(native: boolean, state: DemoState | null) {
  if (native) (window as unknown as Win).__TAURI_INTERNALS__ = {};
  pinDemo(native ? (state ? { kind: 'demo', state, source: 'stored' } : { kind: 'live' }) : { kind: 'demo', state: state ?? S('sample'), source: 'address' });
}

beforeEach(() => resetDemoSwitchForTests());
afterEach(() => {
  cleanup();
  pinDemo(null);
  resetDemoSwitchForTests();
  delete (window as unknown as Win).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('the footer switcher', () => {
  it('is one labelled group; a desktop demo shows the badge, the world and Exit demo', () => {
    started(true, S('large'));
    render(<DemoSwitch apply={vi.fn()} />);
    const g = screen.getByRole('group', { name: DEMO_SWITCH.group });
    expect(g.textContent).toContain(DEMO_BADGE);
    expect(screen.getByRole('button', { name: /Busy merchant/ }).getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.getByRole('button', { name: DEMO_SWITCH.exit })).toBeTruthy();
  });

  it('the live wallet: no badge, no Exit demo, a quiet chip', () => {
    started(true, null);
    render(<DemoSwitch apply={vi.fn()} />);
    expect(screen.queryByText(DEMO_BADGE)).toBeNull();
    expect(screen.queryByRole('button', { name: DEMO_SWITCH.exit })).toBeNull();
    expect(screen.getByRole('button', { name: DEMO_SWITCH.live })).toBeTruthy();
  });

  it('a browser preview: the world by its plain name, and no live wallet to go back to', () => {
    started(false, S('small'));
    render(<DemoSwitch apply={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Small shop/ })).toBeTruthy();
    expect(screen.queryByText(DEMO_BADGE)).toBeNull();
    expect(screen.queryByRole('button', { name: DEMO_SWITCH.exit })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Small shop/ }));
    expect(screen.queryByRole('button', { name: new RegExp(DEMO_LIVE.name) })).toBeNull();
    expect(screen.getByText(DEMO_SWITCH.browser)).toBeTruthy();
  });

  it('opens a dialog with focus inside; Esc closes it and gives focus back to the chip', async () => {
    started(true, S('large'));
    render(<DemoSwitch apply={vi.fn()} />);
    const chip = screen.getByRole('button', { name: /Busy merchant/ });
    chip.focus();
    fireEvent.click(chip);
    const dialog = await screen.findByRole('dialog', { name: DEMO_SWITCH.title });
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const worlds = screen.getByRole('group', { name: DEMO_SWITCH.worlds });
    const opts = Array.from(worlds.querySelectorAll('button'));
    expect(opts.map((b) => b.querySelector('b')?.textContent)).toEqual([DEMO_WORLD.small.name, DEMO_WORLD.large.name, DEMO_WORLD.first_run.name, DEMO_WORLD.sample.name]);
    expect(opts.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(chip));
  });

  it('a world: the calm overlay, then the injected reload with that world (flags kept)', async () => {
    started(true, S('large', { degrade: true }));
    const apply = vi.fn();
    render(<DemoSwitch apply={apply} />);
    fireEvent.click(screen.getByRole('button', { name: /Busy merchant/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DEMO_WORLD.small.name) }));
    expect((await screen.findByRole('status')).textContent).toContain('Switching to the small shop sample');
    await waitFor(() => expect(apply).toHaveBeenCalledWith(S('small', { degrade: true })));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('Exit demo and Live wallet go back to the live wallet', async () => {
    started(true, S('first_run'));
    const apply = vi.fn();
    render(<DemoSwitch apply={apply} />);
    fireEvent.click(screen.getByRole('button', { name: DEMO_SWITCH.exit }));
    expect((await screen.findByRole('status')).textContent).toContain('Back to your live wallet');
    await waitFor(() => expect(apply).toHaveBeenCalledWith(null));
    cleanup(); resetDemoSwitchForTests(); apply.mockClear();
    render(<DemoSwitch apply={apply} />);
    fireEvent.click(screen.getByRole('button', { name: /First run/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DEMO_LIVE.name) }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(null));
  });

  it('More: older version and locked toggle on the current world; reset asks first and resets only on yes', async () => {
    started(true, S('small'));
    const apply = vi.fn();
    const resetWorld = vi.fn(() => Promise.resolve());
    render(<DemoSwitch apply={apply} resetWorld={resetWorld} />);
    fireEvent.click(screen.getByRole('button', { name: /Small shop/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DEMO_LOCKED.name) }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(S('small', { locked: true })));
    cleanup(); resetDemoSwitchForTests(); apply.mockClear();
    render(<DemoSwitch apply={apply} resetWorld={resetWorld} />);
    fireEvent.click(screen.getByRole('button', { name: /Small shop/ }));
    expect(screen.getByRole('button', { name: new RegExp(DEMO_DEGRADED.name) }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DEMO_RESET.name) }));
    fireEvent.click(screen.getByRole('button', { name: DEMO_RESET.no }));
    expect(resetWorld).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DEMO_RESET.name) }));
    expect(screen.getByText(DEMO_RESET.ask(DEMO_WORLD.small.name))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: DEMO_RESET.yes }));
    await waitFor(() => expect(resetWorld).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(S('small')));
  });

  it('the desktop app without the sample worlds: the samples are disabled with a calm sentence', async () => {
    started(true, null);
    render(<DemoSwitch apply={vi.fn()} probe={() => Promise.resolve(false)} />);
    fireEvent.click(screen.getByRole('button', { name: DEMO_SWITCH.live }));
    expect(await screen.findByText(DEMO_SWITCH.unavailable)).toBeTruthy();
    const worlds = screen.getByRole('group', { name: DEMO_SWITCH.worlds });
    expect(Array.from(worlds.querySelectorAll('button')).every((b) => b.disabled)).toBe(true);
  });

  it('a switch started elsewhere (Find) shows the same overlay and reload', async () => {
    started(false, S('sample'));
    const apply = vi.fn();
    render(<DemoSwitch apply={apply} />);
    act(() => switchDemo(S('large')));
    expect((await screen.findByRole('status')).textContent).toContain('busy merchant');
    await waitFor(() => expect(apply).toHaveBeenCalledWith(S('large')));
  });
});

describe('the sample approval page strip', () => {
  it('shows only on the sample approval the demo opened, never on the real approval window', () => {
    history.replaceState(null, '', '/approval.html?deal=abc&demo=1');
    pinDemo({ kind: 'demo', state: S('large'), source: 'stored' });
    // no way back left in this webview: not the sample approval
    const a = render(<DemoStrip />);
    expect(a.container.textContent).toBe('');
    a.unmount();
    sessionStorage.setItem(DEMO_RETURN_KEY, '/index.html#m=book');
    render(<DemoStrip />);
    expect(screen.getByRole('note').textContent).toBe(DEMO_APPROVAL.strip);
    expect(DEMO_APPROVAL.strip).toMatch(/simulated/);
    cleanup();
    // the live wallet's approval window: never
    pinDemo({ kind: 'live' });
    const b = render(<DemoStrip />);
    expect(b.container.textContent).toBe('');
    sessionStorage.clear();
    history.replaceState(null, '', '/index.html');
  });

  it('the approval entry renders the app under the strip', () => {
    const entry = readFileSync('src/windows/approval/entry.tsx', 'utf8');
    expect(entry).toContain("mount('approval', withDemoStrip(App))");
  });
});

describe('Find: "Demo: ..." entries', () => {
  it('mirror the switcher: the other worlds, Live in a desktop demo, the two flags on a world', () => {
    const live = demoFindItems({ native: true, state: null });
    expect(live.map((i) => i.title)).toEqual(['Demo: Small shop', 'Demo: Busy merchant', 'Demo: First run', 'Demo: Sample week']);
    const demo = demoFindItems({ native: true, state: S('large', { locked: true }) });
    expect(demo.map((i) => i.title)).toEqual(['Demo: Live wallet', 'Demo: Small shop', 'Demo: First run', 'Demo: Sample week', 'Demo: Older app version', 'Demo: Locked']);
    expect(demo.find((i) => i.key === 'demo-live')?.target).toEqual({ kind: 'demo', state: null });
    expect(demo.find((i) => i.key === 'demo-locked')?.target).toEqual({ kind: 'demo', state: S('large', { locked: false }) });
    const browser = demoFindItems({ native: false, state: S('sample') });
    expect(browser.some((i) => i.key === 'demo-live')).toBe(false);
    for (const i of [...live, ...demo, ...browser]) expect(i.group).toBe('places');
  });

  it('Find lists them and the console applies them through the switcher', () => {
    const find = readFileSync('src/windows/main/console/Find.tsx', 'utf8');
    const console = readFileSync('src/windows/main/console/Console.tsx', 'utf8');
    expect(find).toContain('...demoFindItems()');
    expect(console).toMatch(/case 'demo': switchDemo\(t\.state\)/);
  });
});

describe('demo words', () => {
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') strings.push(v);
    else if (typeof v === 'function') strings.push(String((v as (s: string) => string)('Busy merchant')));
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(demoWords);

  it('name no internals and no vendor but PayPal', () => {
    expect(strings.length).toBeGreaterThan(30);
    const internals = /\b(mock|tauri|ipc|iframe|frame-src|csp|localStorage|storage|keychain|rust|command|invoke|backend|label|first_run|scale|degrade|url|json|claude|codex|openai|anthropic|chatgpt|gpt|windows hello)\b|table-demo|_/i;
    for (const s of strings) expect(s, s).not.toMatch(internals);
    // PayPal is the only vendor named
    for (const s of strings) expect(s.replace(/PayPal/g, '')).not.toMatch(/\b(Stripe|Square|Apple|Google|Microsoft)\b/);
  });

  it('every demo surface says nothing is paid', () => {
    expect(DEMO_BADGE).toBe('Demo · sample data · nothing is paid');
    expect(DEMO_APPROVAL.strip).toBe('Demo approval · simulated · nothing is paid');
    expect(DEMO_SWITCH.sub).toMatch(/PayPal/);
  });

  it('sentence case', () => {
    for (const s of strings) {
      const words = s.split(/(?<=[.?!:·])\s+/).flatMap((sentence) => sentence.split(/\s+/).slice(1)).filter((w) => /^[A-Z][a-z]/.test(w));
      // proper names only: PayPal, The Table, Esc, the sample names the switcher shows, Maya
      for (const w of words) expect(['PayPal', 'PayPal,', 'Maya’s', 'Busy', 'Small', 'First', 'Sample', 'Live', 'Older', 'Locked', 'Demo:', 'The', 'Table', 'Esc'].some((ok) => w.startsWith(ok)), `${w} in "${s}"`).toBe(true);
    }
  });
});
