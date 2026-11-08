// The app's own header (the desktop window has no native frame): who this is (mark, name, slogan),
// whether anything needs the owner, Find, and the window's buttons. No navigation lives here: the
// places and the module tabs stay in the views below. It is the same in the Chat and the Platform
// view, so it sits above both in App.tsx. The status and Find only announce themselves
// (APP_STATUS_EVENT, APP_FIND_EVENT, APP_BRAND_EVENT); the view that is showing answers: the console
// opens its waiting list, Find or the centre, the chat filters its list to what needs her or focuses
// its filter. The empty space is the drag handle (data-tauri-drag-region; double-click maximises).
import { useEffect, useState } from 'react';
import { APP_HEADER, BRAND_NAME, BRAND_SLOGAN, needPill, needPillLabel } from '../../lib/words';
import { isTauri } from '../../lib/tauri';
import { Mark } from '../../shared/brand/Mark';
import { useNeeds } from './world';
import './appHeader.css';

export const APP_FIND_EVENT = 'app:find';
export const APP_STATUS_EVENT = 'app:status';
export const APP_BRAND_EVENT = 'app:brand';

type Win = { minimize: () => Promise<void>; toggleMaximize: () => Promise<void>; close: () => Promise<void>; isMaximized: () => Promise<boolean>; onResized: (cb: () => void) => Promise<() => void> };
async function win(): Promise<Win | null> {
  if (!isTauri()) return null;
  try { return (await import('@tauri-apps/api/window')).getCurrentWindow() as unknown as Win; } catch { return null; }
}
const fire = (name: string): void => { window.dispatchEvent(new CustomEvent(name)); };

/** Runs `fn` when the header announces `name` (the view that is showing answers). */
export function useAppHeaderEvent(name: string, fn: () => void): void {
  useEffect(() => {
    const h = () => fn();
    window.addEventListener(name, h);
    return () => window.removeEventListener(name, h);
  }, [name, fn]);
}

function useMaximised(): boolean {
  const [on, set] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    let dead = false;
    void win().then(async (w) => {
      if (!w || dead) return;
      const sync = () => { void w.isMaximized().then((m) => { if (!dead) set(m); }).catch(() => {}); };
      sync();
      off = await w.onResized(sync).catch(() => undefined);
    });
    return () => { dead = true; off?.(); };
  }, []);
  return on;
}

export function AppHeader() {
  const needs = useNeeds().length;
  const native = isTauri();
  const maximised = useMaximised();
  const act = (f: (w: Win) => Promise<void>) => () => { void win().then((w) => (w ? f(w) : undefined)).catch(() => {}); };
  return (
    <header className="ah" data-tauri-drag-region aria-label={APP_HEADER.label}>
      <button type="button" className="ah-brand" onClick={() => fire(APP_BRAND_EVENT)} title={BRAND_NAME} aria-label={BRAND_NAME}>
        <Mark /><b>{BRAND_NAME}</b>
      </button>
      <span className="ah-slogan" data-tauri-drag-region>{BRAND_SLOGAN}</span>
      <span className="ah-fill" data-tauri-drag-region />
      <button type="button" id="ah-status" className={`ah-status${needs ? '' : ' zero'}`} aria-label={needPillLabel(needs)} title={needPill(needs)} onClick={() => fire(APP_STATUS_EVENT)}><i aria-hidden="true" /></button>
      <button type="button" className="ah-find" onClick={() => fire(APP_FIND_EVENT)} title={APP_HEADER.findTitle} aria-label={APP_HEADER.findTitle}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        <span>{APP_HEADER.find}</span><kbd>/</kbd>
      </button>
      {native ? (
        <div className="ah-win">
          <button type="button" className="ah-wb" onClick={act((w) => w.minimize())} aria-label={APP_HEADER.minimise} title={APP_HEADER.minimise}>
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
          <button type="button" className="ah-wb" onClick={act((w) => w.toggleMaximize())} aria-label={APP_HEADER.maximise} title={APP_HEADER.maximise}>
            {maximised
              ? <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2.5 3.5h5v5h-5zM3.5 3.5v-2h5v5h-1" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>
              : <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>}
          </button>
          <button type="button" className="ah-wb ah-close" onClick={act((w) => w.close())} aria-label={APP_HEADER.close} title={APP_HEADER.close}>
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="m1.5 1.5 7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
          </button>
        </div>
      ) : null}
    </header>
  );
}
