// Code splitting for surfaces that are not on a window's first paint (a module page, a sheet, the
// owner configuration). Each part is a separate chunk loaded with a dynamic import(); the window
// preloads its parts once it is idle after the first paint, so opening one later never shows a
// loading state. Until a part has loaded it renders through React.lazy (a <Suspense> boundary
// shows the caller's calm placeholder); once loaded it renders the component directly, so moving
// between parts never suspends again and never flashes.
//
// CSS stays eager: the window imports each part's stylesheet itself, so styles keep their place
// in the window's one stylesheet and nothing restyles when a chunk arrives.
import { createElement, lazy, type ComponentType } from 'react';

export type LazyPart<P> = ComponentType<P> & {
  /** Starts (or joins) loading the chunk; safe to call any number of times. */
  preload: () => Promise<unknown>;
  /** True once the chunk has loaded: the part then renders directly and can never suspend. */
  ready: () => boolean;
};

// Parts whose chunk failed while a render waited for it. React.lazy keeps a rejection for good, so a
// redraw of the same part would rethrow the old failure; an ErrorBoundary's "Try again" (or a route
// change that drops its fallback) calls renewFailedParts() so the next draw loads the chunk once more.
// Renewing happens only on that new attempt, never inside React's own retry of the failed render
// (that loops the loader for as long as the network is down).
const renewers = new Set<() => void>();

/** A new attempt: every part whose last render-time load failed gets a fresh lazy. Called by shared/boundary. */
export function renewFailedParts(): void {
  for (const renew of renewers) renew();
}

/** `lazyPart(() => import('./modules/book').then((m) => m.Book))`. */
export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>): LazyPart<P> {
  let ready: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const preload = () => {
    pending ??= load().then(
      (c) => {
        ready = c;
        return { default: c };
      },
      (e: unknown) => {
        pending = null; // a failed fetch may be retried by the next preload or, after renewFailedParts(), the next draw
        throw e;
      },
    );
    return pending;
  };
  let failed = false;
  const fresh = () => lazy(() => preload().catch((e: unknown) => { failed = true; throw e; }));
  let Suspending = fresh();
  renewers.add(() => {
    if (!failed) return;
    failed = false;
    Suspending = fresh();
  });
  const Part = (props: P) => createElement((ready ?? Suspending) as ComponentType<P>, props);
  return Object.assign(Part, { preload, ready: () => ready !== null });
}

type IdleGlobal = typeof globalThis & {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (h: number) => void;
};

/**
 * Preload parts once the window is idle after its first paint, IN ORDER (put the likeliest next
 * surface first) and one per idle slot, so a dozen chunks never land in one long task. Returns a
 * cancel for effects. Load failures are ignored here: the part retries when it is actually rendered.
 */
export function preloadWhenIdle(parts: ReadonlyArray<{ preload: () => Promise<unknown> }>, delayMs = 400): () => void {
  const w = globalThis as IdleGlobal;
  let cancelled = false;
  let at = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let handle: number | undefined;
  const slot = () => {
    handle = undefined;
    if (cancelled) return;
    const p = parts[at++];
    if (!p) return;
    p.preload().catch(() => undefined);
    next();
  };
  const next = () => {
    if (cancelled || at >= parts.length) return;
    if (w.requestIdleCallback) handle = w.requestIdleCallback(slot, { timeout: 2000 });
    else timer = setTimeout(slot, 0);
  };
  timer = setTimeout(next, delayMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
    if (handle !== undefined) w.cancelIdleCallback?.(handle);
  };
}

/** Is this a code-split part (has a preload and a ready check)? Plain components are always ready. */
export const isLazyPart = (c: unknown): c is LazyPart<never> => typeof (c as Partial<LazyPart<never>> | null)?.preload === 'function';

/**
 * Resolves when every lazy part among `parts` has loaded, or after `capMs` (or a load failure),
 * whichever comes first. A navigation awaits this BEFORE it swaps the screen, so the old screen stays
 * up until the next one can draw at once; the cap keeps a slow network from freezing the click (the
 * layer's own calm skeleton takes over then).
 */
export function whenPartsReady(parts: ReadonlyArray<unknown>, capMs = 300): Promise<void> {
  const pending = parts.filter(isLazyPart).filter((p) => !p.ready());
  if (!pending.length) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, capMs);
    Promise.all(pending.map((p) => p.preload())).then(() => { clearTimeout(t); resolve(); }, () => { clearTimeout(t); resolve(); });
  });
}

/** Warm a part on intent (pointer over, focus): the click that follows finds the chunk loaded. */
export function preloadOnIntent(part: unknown): void {
  if (isLazyPart(part) && !part.ready()) part.preload().catch(() => undefined);
}
