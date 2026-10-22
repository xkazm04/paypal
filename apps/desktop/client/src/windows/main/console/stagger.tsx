// Staggered reveal inside a layer (polish wave A). A layer's first paint is its frame and its answer:
// the heading, "Your call" and the one action (wave 0). The rest arrives in a short, orderly
// sequence by priority, each wave on a frame (or idle slot) of its own:
//   0  the frame, the answer, Your call and its action (never deferred: a decision is never hidden)
//   1  the summary cards (or an open view's body)
//   2  the Latest strip, the list shell, the detail frame
//   3  explanations, side panes, charts, evidence-backed parts
// A part of a later wave is not mounted until its turn (so its reads do not start and its code is not
// asked for); a skeleton holds its place at the size it had last time (or the frame's own estimate),
// so nothing below it moves when it arrives. One scheduler per layer (`<Stagger>` in LayerHost):
// waves flush in order, at most SLOT_MS of reveal work per slot (a long wave goes on in the next
// frame), the gap between waves is a motion token. Leaving the layer cancels what is pending (no
// update after unmount), and opening a layer while another's waves are pending cancels those
// (`StaggerProvider`). Calm motion (the OS setting or the in-app switch) and the test switch
// (`staggerOff`) mount every wave in the first frame, with no animation.
//
// Display only: nothing here reads, writes or decides anything; it only chooses WHEN a part mounts.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { DUR, isCalm, useCalm } from '../../../design/motion';

export type Wave = 0 | 1 | 2 | 3;
export const WAVES: readonly Wave[] = [0, 1, 2, 3];

/** At most this much reveal work (ms) in one slot; a wave with more goes on in the next frame. */
export const SLOT_MS = 12;
/** Between two waves: the shortest motion token, so the sequence reads as one calm movement. */
export const WAVE_GAP_MS = DUR.instant;
/** A later-wave part that mounts this soon after its layer opened still waits for its turn (a cold
 *  read on the busy merchant lands in ~0.7 s, wp4a perf); after it, a part that mounts shows at once. */
export const OPENING_MS = 1200;

// ---- the test switch ------------------------------------------------------------------------------
// Off under vitest by default, so every existing test renders every wave in its first frame (as it
// did before the stagger). The stagger's own tests turn it on.
let off = import.meta.env.MODE === 'test';
/** Every wave mounts at once (tests; also what calm motion does). */
export function staggerOff(): void { off = true; }
/** Waves take their turns (the app's default; tests of the stagger itself). */
export function staggerOn(): void { off = false; }
export const staggerIsOff = (): boolean => off;

// ---- the scheduler --------------------------------------------------------------------------------
export type Clock = {
  now: () => number;
  /** The next frame (requestAnimationFrame). Returns a cancel. */
  frame: (fn: () => void) => () => void;
  /** An idle slot, at the latest after `ms` (requestIdleCallback; a timer where there is none). */
  idle: (fn: () => void, ms: number) => () => void;
  timer: (fn: () => void, ms: number) => () => void;
  mark: (name: string) => void;
};

type G = typeof globalThis & {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (h: number) => void;
};

export const browserClock: Clock = {
  now: () => performance.now(),
  frame: (fn) => {
    if (typeof requestAnimationFrame !== 'function') { const t = setTimeout(fn, 16); return () => clearTimeout(t); }
    const h = requestAnimationFrame(() => fn());
    return () => cancelAnimationFrame(h);
  },
  idle: (fn, ms) => {
    const g = globalThis as G;
    if (g.requestIdleCallback && g.cancelIdleCallback) { const h = g.requestIdleCallback(fn, { timeout: ms }); return () => g.cancelIdleCallback?.(h); }
    const t = setTimeout(fn, 0);
    return () => clearTimeout(t);
  },
  timer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
  // The reveal's timing marks, for the Playwright measurements (dev builds only).
  mark: (name) => { if (import.meta.env.DEV && typeof performance !== 'undefined' && typeof performance.mark === 'function') performance.mark(name); },
};

let defaultClock: Clock = browserClock;
/** Test hook: the clock every `<Stagger>` without its own uses (null: the browser's). */
export function setStaggerClock(c: Clock | null): void { defaultClock = c ?? browserClock; }

type Ticket = { wave: Wave; priority: number; seq: number; open: boolean; show: () => void };

/** One layer's reveal sequence. Pure scheduling: a ticket per deferred part, opened in wave order
 *  (higher priority first inside a wave, then mount order). */
export class RevealScheduler {
  private tickets = new Set<Ticket>();
  private seq = 0;
  private started = -1;
  private live = false;
  private cancelSlot: (() => void) | null = null;
  private cancelOpening: (() => void) | null = null;
  private settled = false;
  private marked = new Set<Wave>();
  /** The next slot is the sequence's first: it waits a whole frame, so wave 0 paints alone. */
  private first = false;
  /** Every wave opens at once (calm, the test switch). */
  instant: boolean;

  constructor(private clock: Clock = browserClock, o: { instant?: boolean } = {}) {
    this.instant = !!o.instant;
  }

  /** Would a part of this wave show at once if it mounted now? */
  opensNow(wave: Wave): boolean {
    return this.instant || wave === 0 || this.settled;
  }

  /** A deferred part mounted; `show` is called (in a synchronous commit) when its turn comes. */
  register(wave: Wave, priority: number, show: () => void, open: boolean): () => void {
    const t: Ticket = { wave, priority, seq: this.seq++, open: open || this.opensNow(wave), show };
    this.tickets.add(t);
    if (!t.open && this.live && !this.cancelSlot) this.schedule(this.gapFor(wave));
    return () => { this.tickets.delete(t); };
  }

  /** The layer's first frame is on screen: the sequence starts. */
  start(): void {
    if (this.live) return;
    this.live = true;
    if (this.started < 0) { this.started = this.clock.now(); this.mark(0); }
    if (!this.settled && !this.cancelOpening) {
      const left = Math.max(0, OPENING_MS - (this.clock.now() - this.started));
      this.cancelOpening = this.clock.timer(() => { this.settled = true; this.cancelOpening = null; }, left);
    }
    if (this.instant) { this.openAll(); return; }
    this.first = true;
    this.schedule(0);
  }

  /** Stops what is pending (the layer left, or another layer opened). Nothing is shown after this. */
  cancel(): void {
    this.live = false;
    this.cancelSlot?.();
    this.cancelSlot = null;
    this.cancelOpening?.();
    this.cancelOpening = null;
  }

  /** Calm turned on mid-sequence: everything left shows now. */
  openAll(): void {
    this.instant = true;
    this.cancelSlot?.();
    this.cancelSlot = null;
    for (const t of this.pending()) { t.open = true; t.show(); }
    this.markThrough(3);
  }

  /** How many parts still wait (tests). */
  waiting(): number { return this.pending().length; }

  private pending(): Ticket[] {
    return [...this.tickets].filter((t) => !t.open).sort((a, b) => a.wave - b.wave || b.priority - a.priority || a.seq - b.seq);
  }

  private gapFor(wave: Wave): number {
    // The first later wave follows the first frame directly; the next ones keep the token's beat.
    return wave <= 1 ? 0 : WAVE_GAP_MS;
  }

  private schedule(gap: number): void {
    if (!this.live) return;
    this.cancelSlot?.();
    const lowest = this.pending()[0];
    if (!lowest) { this.cancelSlot = null; this.markThrough(3); return; }
    const run = () => { this.cancelSlot = null; this.slot(); };
    const first = this.first;
    this.first = false;
    const next = () => {
      if (first) this.cancelSlot = this.clock.frame(() => { this.cancelSlot = this.clock.frame(run); });
      else this.cancelSlot = lowest.wave === 3 ? this.clock.idle(run, WAVE_GAP_MS) : this.clock.frame(run);
    };
    if (gap > 0) this.cancelSlot = this.clock.timer(next, gap);
    else next();
  }

  /** One slot: opens the lowest waiting wave's parts in order, until SLOT_MS of work is done. */
  private slot(): void {
    if (!this.live) return;
    const queue = this.pending();
    const first = queue[0];
    if (!first) { this.markThrough(3); return; }
    const wave = first.wave;
    this.markThrough((wave - 1) as Wave);
    const t0 = this.clock.now();
    for (const t of queue) {
      if (t.wave !== wave) break;
      if (!this.live) return;
      t.open = true;
      flushSync(() => t.show());
      if (this.clock.now() - t0 >= SLOT_MS) break;
    }
    const rest = this.pending()[0];
    if (!rest) { this.markThrough(3); return; }
    if (rest.wave === wave) this.schedule(0); // a long wave goes on in the next frame
    else { this.markThrough((rest.wave - 1) as Wave); this.schedule(this.gapFor(rest.wave)); }
  }

  private markThrough(w: Wave): void {
    for (const x of WAVES) if (x <= w) this.mark(x);
  }

  private mark(w: Wave): void {
    if (this.marked.has(w)) return;
    this.marked.add(w);
    this.clock.mark(`layer:wave${w}`);
  }
}

// ---- React --------------------------------------------------------------------------------------
const SchedulerContext = createContext<RevealScheduler | null>(null);

/** The window's one place that knows which layer's sequence is running: a new one cancels the old. */
type Registry = { activate: (s: RevealScheduler) => void; release: (s: RevealScheduler) => void };
const RegistryContext = createContext<Registry | null>(null);

export function StaggerProvider({ children }: { children: ReactNode }) {
  const [reg] = useState<Registry>(() => {
    let current: RevealScheduler | null = null;
    return {
      activate: (s) => { if (current && current !== s) current.cancel(); current = s; },
      release: (s) => { if (current === s) current = null; },
    };
  });
  return <RegistryContext.Provider value={reg}>{children}</RegistryContext.Provider>;
}

/** One layer's reveal sequence (LayerHost mounts one per sheet). `clock` is for tests. */
export function Stagger({ children, clock }: { children: ReactNode; clock?: Clock }) {
  const reg = useContext(RegistryContext);
  const calm = useCalm();
  const [s] = useState(() => new RevealScheduler(clock ?? defaultClock, { instant: off || isCalm() }));
  useEffect(() => {
    reg?.activate(s);
    s.start();
    return () => { s.cancel(); reg?.release(s); };
  }, [s, reg]);
  useEffect(() => { if (calm) s.openAll(); }, [calm, s]);
  return <SchedulerContext.Provider value={s}>{children}</SchedulerContext.Provider>;
}

/** Has this wave's turn come? (A component that defers a part, or a read, itself.) Outside a
 *  `<Stagger>` every wave is open. */
export function useRevealed(wave: Wave, priority = 0): boolean {
  const s = useContext(SchedulerContext);
  const [open, setOpen] = useState(() => !s || s.opensNow(wave));
  const openRef = useRef(open);
  openRef.current = open;
  useLayoutEffect(() => {
    if (!s) return;
    return s.register(wave, priority, () => setOpen(true), openRef.current);
  }, [s, wave, priority]);
  return open;
}

/** Remembered sizes of revealed parts, so the next skeleton holds exactly their room. */
const sizes = new Map<string, number>();
/** A size is remembered per window size (the same part is taller on a narrow window). */
const sizeKeyOf = (k: string): string => (typeof window === 'undefined' ? k : `${k}@${window.innerWidth}x${window.innerHeight}`);
/** Test hook: forget every remembered size. */
export function forgetSizes(): void { sizes.clear(); }

/** Remembers the height a `display: contents` wrapper's children take, as the browser lays them out
 *  (a ResizeObserver: no forced layout in the reveal's own frame; it follows the part while it is
 *  shown, so a part that grows after its own reads is remembered at its full size). Each measure is
 *  filed under the window size it was taken at, so a resize never overwrites another size's height. */
function rememberHeight(el: HTMLElement, key: string): () => void {
  const kids = Array.from(el.children);
  if (!kids.length || typeof ResizeObserver !== 'function') return () => {};
  // Inside the observer's callback layout is already done, so reading the boxes costs nothing extra.
  const ro = new ResizeObserver(() => {
    const a = kids[0]?.getBoundingClientRect();
    const b = kids[kids.length - 1]?.getBoundingClientRect();
    const h = a && b ? b.bottom - a.top : 0;
    if (h > 0) sizes.set(sizeKeyOf(key), h);
  });
  for (const k of kids) ro.observe(k);
  return () => ro.disconnect();
}

export type RevealProps = {
  wave: Wave;
  /** Inside a wave, higher first. */
  priority?: number;
  /** Holds the part's place until it shows (sized like the part; see `Skeleton`). */
  skeleton?: ReactNode;
  /** Remembers the part's height under this key, so the next skeleton takes exactly that room. */
  sizeKey?: string;
  children: ReactNode;
};

/** A part of a layer that takes its wave's turn. Its wrapper is `display: contents`, so the frame's
 *  layout (flex gaps, grids) is the same as without it; its children fade in when it shows. */
export function Reveal({ wave, priority = 0, skeleton, sizeKey, children }: RevealProps) {
  const open = useRevealed(wave, priority);
  const ref = useRef<HTMLDivElement>(null);
  const shownLate = useRef(false);
  if (!open) shownLate.current = true;
  useEffect(() => {
    if (!open || !sizeKey || !ref.current) return;
    return rememberHeight(ref.current, sizeKey);
  }, [open, sizeKey]);
  const key = sizeKey ? sizeKeyOf(sizeKey) : null;
  const remembered = key ? sizes.get(key) : undefined;
  return (
    <div ref={ref} className="stg" data-wave={wave} data-stg={open ? (shownLate.current ? 'in' : 'now') : 'wait'}>
      {open ? children : skeleton !== undefined ? <SkeletonRoom h={remembered}>{skeleton}</SkeletonRoom> : null}
    </div>
  );
}

/** A skeleton with a remembered height: the skeleton's own estimate is the floor until the part has
 *  shown once. */
function SkeletonRoom({ h, children }: { h: number | undefined; children: ReactNode }) {
  if (h === undefined) return <>{children}</>;
  return <div className="stg-room" style={{ height: `${h}px` } as CSSProperties} aria-hidden="true">{children}</div>;
}

/** A quiet block standing for a part that has not shown yet. `className` gives it the part's own
 *  layout class (so it takes the same room: `ml-cards`, `ml-explain`), `blocks` the inner bars
 *  (cards in a grid, rows of a list), `h` a fixed height. Shimmer only when motion is allowed. */
export function Skeleton({ className, blocks = 0, block, h, style }: { className?: string; blocks?: number; block?: string; h?: string; style?: CSSProperties }) {
  return (
    <div className={`stg-skel${className ? ` ${className}` : ''}`} aria-hidden="true" style={{ ...(h ? { minHeight: h } : null), ...style }}>
      {Array.from({ length: blocks }, (_, i) => <span key={i} className={`stg-b${block ? ` ${block}` : ''}`} />)}
    </div>
  );
}
