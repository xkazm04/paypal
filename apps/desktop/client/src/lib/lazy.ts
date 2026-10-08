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
};

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
        pending = null; // a failed fetch may be retried by the next render or preload
        throw e;
      },
    );
    return pending;
  };
  const Suspending = lazy(preload);
  const Part = (props: P) => createElement((ready ?? Suspending) as ComponentType<P>, props);
  return Object.assign(Part, { preload });
}

/**
 * Preload parts once the window is idle after its first paint. Returns a cancel for effects.
 * Load failures are ignored here: the part retries when it is actually rendered.
 */
export function preloadWhenIdle(parts: ReadonlyArray<{ preload: () => Promise<unknown> }>, delayMs = 400): () => void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    for (const p of parts) p.preload().catch(() => undefined);
  };
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (h: number) => void;
  };
  const t = setTimeout(() => {
    if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 2000 });
    else run();
  }, delayMs);
  return () => {
    done = true;
    clearTimeout(t);
  };
}
