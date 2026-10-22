// Demo mode's switcher in the console footer (polish wave, builder B). The owner, or anyone looking
// at the app, browses the sample worlds (a small shop, a busy merchant, a brand-new wallet, the
// guided sample week; an older app version and a locked wallet under "More") without leaving the
// window. The choice is read once at startup (lib/runtime.ts initBackend, lib/preview.ts
// resolveDemo); changing it shows a calm "Switching..." overlay and reloads the window at the
// centre, keeping the theme and the calm setting (they are stored on their own).
// In the desktop app the choice is kept in localStorage `table-demo` and "Live wallet" / "Exit demo"
// go back; in a browser preview the address carries it (`?scale=` and friends) and there is no live
// wallet to go back to. Nothing here calls the wallet: a choice only stores a word and reloads.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  DEMO_BADGE, DEMO_BADGE_TITLE, DEMO_DEGRADED, DEMO_FIND, DEMO_LIVE, DEMO_LOCKED, DEMO_RESET, DEMO_SWITCH, DEMO_SWITCHING_SUB, DEMO_WORLD, demoSwitching,
} from '../../../lib/words';
import { DEMO_KEY, demoNow, formatDemo, withDemoSearch, type DemoState, type DemoWorld } from '../../../lib/preview';
import { Btn, Popover } from '../../../shared/ui';
import type { FindItem } from './findIndex';

/** The worlds in the switcher's order. */
export const SWITCH_WORLDS: readonly DemoWorld[] = ['small', 'large', 'first_run', 'sample'];

/** The new choice, applied: stores it (desktop app) or puts it in the address (browser) and reloads
 *  the window at the centre. null = the live wallet (desktop app only). */
export type ApplyDemo = (next: DemoState | null) => void;

export const applyDemo: ApplyDemo = (next) => {
  const { native } = demoNow();
  if (native) {
    // Nothing stored: stay as we are, and lift the "Switching..." overlay (it covers the window).
    try { localStorage.setItem(DEMO_KEY, formatDemo(next)); } catch { endSwitch(true); return; }
    location.replace(`${location.pathname}${location.search}`);
    return;
  }
  if (!next) return; // a browser preview has no live wallet
  location.replace(`${location.pathname}${withDemoSearch(location.search, next)}`);
};

/** The director's pages frame the main window to play a story: its world is the story's, so a
 *  framed main window offers no switch. */
export function framedPage(): boolean {
  try { return window.parent !== window; } catch { return true; }
}

/** The world's name as the owner reads it. */
export const worldName = (w: DemoWorld): string => DEMO_WORLD[w].name;

// ---- one switch at a time (the footer's switcher, and Find's "Demo: ..." entries) ---------------

type Switching = { label: string; next: DemoState | null };
let switching: Switching | null = null;
/** The last switch could not be stored: one calm sentence until the next open or switch. */
let notStored = false;
const subs = new Set<() => void>();
const notify = () => { for (const s of subs) s(); };

/** Start a switch: the overlay appears, then the window reloads into `next` (after one paint). */
export function switchDemo(next: DemoState | null): void {
  switching = { label: demoSwitching(next ? worldName(next.world) : null), next };
  notStored = false;
  notify();
}

/** No switch under way: the overlay goes (a switch that could not be applied). */
function endSwitch(failed = false): void {
  switching = null;
  notStored = failed;
  notify();
}

/** Tests only. */
export const resetDemoSwitchForTests = (): void => endSwitch();

const clearNotStored = (): void => { if (notStored) { notStored = false; notify(); } };

function useNotStored(): boolean {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => notStored, () => false);
}

function useSwitching(): Switching | null {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => switching, () => null);
}

/** The calm overlay for the moment before the reload; applies the switch once it has painted. */
function SwitchingOverlay({ s, apply }: { s: Switching; apply: ApplyDemo }) {
  useEffect(() => {
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => apply(s.next)); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [s, apply]);
  return createPortal(
    <div className="cs-demo-switching" role="status" aria-live="polite">
      <div><b>{s.label}</b><span>{DEMO_SWITCHING_SUB}</span></div>
    </div>,
    document.body,
  );
}

/** Find's "Demo: ..." entries: the switcher's choices that are not the current one. */
export function demoFindItems(now: { native: boolean; state: DemoState | null } = demoNow()): FindItem[] {
  const { native, state } = now;
  const items: FindItem[] = [];
  if (framedPage()) return items;
  if (native && state) items.push({ key: 'demo-live', group: 'places', title: DEMO_FIND.title(DEMO_LIVE.name), sub: DEMO_FIND.live, target: { kind: 'demo', state: null } });
  for (const w of SWITCH_WORLDS) {
    if (state?.world === w) continue;
    items.push({ key: `demo-${w}`, group: 'places', title: DEMO_FIND.title(worldName(w)), sub: DEMO_FIND.world(DEMO_WORLD[w].sub), target: { kind: 'demo', state: { world: w, degrade: false, locked: false } } });
  }
  if (state) {
    items.push({ key: 'demo-degrade', group: 'places', title: DEMO_FIND.title(DEMO_DEGRADED.name), sub: DEMO_FIND.degraded, target: { kind: 'demo', state: { ...state, degrade: !state.degrade } } });
    items.push({ key: 'demo-locked', group: 'places', title: DEMO_FIND.title(DEMO_LOCKED.name), sub: DEMO_FIND.locked, target: { kind: 'demo', state: { ...state, locked: !state.locked } } });
  }
  return items;
}

export type DemoSwitchProps = {
  /** How a choice is applied (tests pass a spy; the app stores it and reloads). */
  apply?: ApplyDemo;
  /** How the sample's own stored data is cleared ("Reset sample data"); default the mock's own. */
  resetWorld?: () => Promise<void>;
  /** Whether the sample worlds can load in this build (the desktop app probes once, on open). */
  probe?: () => Promise<boolean>;
};

const resetMockWorld = async (): Promise<void> => { (await import('../../../mock/backend')).resetMockWorld(); };
const probeMock = (): Promise<boolean> => import('../../../mock/backend').then(() => true, () => false);

/** The footer's demo group: the badge (desktop demo), the world chip and its popover, Exit demo. */
export function DemoSwitch({ apply = applyDemo, resetWorld = resetMockWorld, probe = probeMock }: DemoSwitchProps) {
  const [now] = useState(demoNow);
  const { native, state } = now;
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const s = useSwitching();
  const failed = useNotStored();
  const name = state ? worldName(state.world) : null;
  if (framedPage()) return s ? <SwitchingOverlay s={s} apply={apply} /> : null;
  // Closing (Esc, an outside click) leaves focus where it was put; when it was left nowhere (the
  // popover is gone), it goes back to the chip, so a keyboard user keeps their place.
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => { if (document.activeElement === document.body || !document.activeElement) chip.current?.focus({ preventScroll: true }); });
  };
  return (
    <div className="cs-demo" role="group" aria-label={DEMO_SWITCH.group}>
      {native && state ? <span className="badge cs-demo-badge" title={DEMO_BADGE_TITLE}>{DEMO_BADGE}</span> : null}
      <button ref={chip} type="button" className={`cs-chip cs-demo-chip${state ? ' on' : ''}`} aria-haspopup="dialog" aria-expanded={open}
        title={DEMO_SWITCH.chipTitle} onClick={() => { clearNotStored(); setOpen((o) => !o); }}>
        {/* The world's plain name ("Sample week", "Busy merchant"); the badge beside it says it is sample data. */}
        {name ?? DEMO_SWITCH.live}<span aria-hidden="true" className="cs-demo-caret">▾</span>
      </button>
      {native && state ? <Btn sm className="cs-demo-exit" title={DEMO_SWITCH.exitTitle} onClick={() => switchDemo(null)}>{DEMO_SWITCH.exit}</Btn> : null}
      {open && chip.current ? (
        <Popover anchor={chip.current} onClose={close} title={DEMO_SWITCH.title} className="cs-demo-pop">
          <DemoChoices native={native} state={state} probe={probe} resetWorld={resetWorld}
            onPick={(next) => { setOpen(false); switchDemo(next); }} onReset={() => { setOpen(false); if (state) switchDemo(state); }} />
        </Popover>
      ) : null}
      {failed && !s ? <p className="cs-demo-note" role="status">{DEMO_SWITCH.notStored}</p> : null}
      {s ? <SwitchingOverlay s={s} apply={apply} /> : null}
    </div>
  );
}

type ChoicesProps = {
  native: boolean;
  state: DemoState | null;
  probe: () => Promise<boolean>;
  resetWorld: () => Promise<void>;
  onPick: (next: DemoState | null) => void;
  onReset: () => void;
};

function DemoChoices({ native, state, probe, resetWorld, onPick, onReset }: ChoicesProps) {
  // The desktop app's live wallet asks once whether the sample worlds are part of this build.
  const [available, setAvailable] = useState<boolean | null>(native && !state ? null : true);
  useEffect(() => {
    if (available !== null) return;
    let dead = false;
    void probe().then((ok) => { if (!dead) setAvailable(ok); });
    return () => { dead = true; };
  }, [available, probe]);
  const [asking, setAsking] = useState(false);
  const off = available === false;
  const pick = (w: DemoWorld) => onPick({ world: w, degrade: state?.degrade ?? false, locked: state?.locked ?? false });
  return (
    <div className="cs-demo-body">
      <p className="cs-demo-sub">{native ? DEMO_SWITCH.sub : DEMO_SWITCH.browser}</p>
      {off ? <p className="cs-demo-note" role="status">{DEMO_SWITCH.unavailable}</p> : null}
      <div className="cs-demo-list">
        {native ? (
          <button type="button" className="cs-demo-opt" aria-pressed={!state} onClick={() => { if (state) onPick(null); }}>
            <b>{DEMO_LIVE.name}</b><span>{DEMO_LIVE.sub}</span>{!state ? <i>{DEMO_SWITCH.current}</i> : null}
          </button>
        ) : null}
        <div role="group" aria-label={DEMO_SWITCH.worlds} className="cs-demo-worlds">
          {SWITCH_WORLDS.map((w) => {
            const on = state?.world === w;
            return (
              <button key={w} type="button" className="cs-demo-opt" aria-pressed={on} disabled={off} onClick={() => { if (!on) pick(w); }}>
                <b>{worldName(w)}</b><span>{DEMO_WORLD[w].sub}</span>{on ? <i>{DEMO_SWITCH.current}</i> : null}
              </button>
            );
          })}
        </div>
      </div>
      {state ? (
        // The popover places itself when it opens; opening More makes it taller, so it places again.
        <details className="ui-disclosure cs-demo-more" onToggle={() => window.dispatchEvent(new Event('resize'))}>
          <summary>{DEMO_SWITCH.more}</summary>
          <div className="ui-disclosure-body cs-demo-list">
            <button type="button" className="cs-demo-opt" aria-pressed={state.degrade} onClick={() => onPick({ ...state, degrade: !state.degrade })}>
              <b>{DEMO_DEGRADED.name}</b><span>{DEMO_DEGRADED.sub}</span>
            </button>
            <button type="button" className="cs-demo-opt" aria-pressed={state.locked} onClick={() => onPick({ ...state, locked: !state.locked })}>
              <b>{DEMO_LOCKED.name}</b><span>{DEMO_LOCKED.sub}</span>
            </button>
            {asking ? (
              <div className="cs-demo-ask" role="group" aria-label={DEMO_RESET.name}>
                <p>{DEMO_RESET.ask(worldName(state.world))}</p>
                <Btn sm onClick={() => { void resetWorld().then(onReset); }}>{DEMO_RESET.yes}</Btn>
                <Btn sm kind="plain" onClick={() => setAsking(false)}>{DEMO_RESET.no}</Btn>
              </div>
            ) : (
              <button type="button" className="cs-demo-opt" onClick={() => setAsking(true)}>
                <b>{DEMO_RESET.name}</b><span>{DEMO_RESET.sub(worldName(state.world))}</span>
              </button>
            )}
          </div>
        </details>
      ) : null}
      {native ? <p className="cs-demo-note">{DEMO_SWITCH.miniWindow}</p> : null}
    </div>
  );
}
