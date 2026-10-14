/**
 * Inspector overlay (test build only): Ctrl+Shift+L arms it. Hover highlights an element and shows
 * its source chain; right-click copies the call site (`src/.../File.tsx:LINE`), Alt+right-click
 * copies the innermost element, a click on a HUD row copies that file. Esc disarms. Left-click is
 * untouched so the wallet stays operable while armed. Needs the `data-loc` stamps from
 * scripts/babel (THE_TABLE_INSPECTOR=1); it is never bundled otherwise (see mount.tsx).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { buildChain, dedupeChain, pickDefaultIndex, type LocEntry } from './devLocate';
import './devInspector.css';

interface Hover { chain: LocEntry[]; pointer: DOMRect; target: DOMRect; di: number }

const rectStyle = (r: DOMRect): CSSProperties => ({ left: r.left, top: r.top, width: r.width, height: r.height });

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function DevInspector() {
  const [armed, setArmed] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [copied, setCopied] = useState<{ loc: string; ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const armedRef = useRef(false);
  armedRef.current = armed;

  const doCopy = useCallback(async (loc: string) => {
    const ok = await copyText(loc);
    setCopied({ loc, ok });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1800);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        e.stopPropagation();
        setArmed((a) => !a);
      } else if (e.key === 'Escape' && armedRef.current) {
        e.stopPropagation();
        setArmed(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    if (!armed) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    const inHud = (t: EventTarget | null) => t instanceof Element && t.closest('[data-devinspector]') !== null;
    const onMove = (e: MouseEvent) => {
      if (inHud(e.target)) return;
      const chain = buildChain(e.target as Element | null);
      const first = chain[0];
      if (!first) return setHover(null);
      const di = pickDefaultIndex(chain);
      setHover({ chain, pointer: first.el.getBoundingClientRect(), target: (chain[di] ?? first).el.getBoundingClientRect(), di });
    };
    const onContext = (e: MouseEvent) => {
      if (inHud(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const chain = buildChain(e.target as Element | null);
      const first = chain[0];
      if (!first) return;
      void doCopy((e.altKey ? first : (chain[pickDefaultIndex(chain)] ?? first)).loc);
    };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('contextmenu', onContext, true);
    return () => {
      document.body.style.cursor = prev;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('contextmenu', onContext, true);
      setHover(null);
    };
  }, [armed, doCopy]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!armed) return null;
  const mappingOn = document.querySelector('[data-loc]') !== null;
  const best = hover?.chain[hover.di];
  return createPortal(
    <div className="dev-inspector" data-devinspector="">
      {hover && hover.di !== 0 && <div className="dev-inspector__box dev-inspector__box--pointer" style={rectStyle(hover.pointer)} />}
      {hover && <div className="dev-inspector__box" style={rectStyle(hover.target)} />}
      {hover && best && (
        <div className="dev-inspector__label" style={{ left: hover.pointer.left, top: Math.max(0, hover.pointer.top - 22) }}>{best.loc}</div>
      )}
      <div className="dev-inspector__hud">
        <div><b>Inspect</b> · right-click copies the call site · Alt+right-click the element · Esc exits</div>
        {!mappingOn && <div className="dev-inspector__warn">Source mapping is off: start with npm run tauri:dev:test</div>}
        {copied && <div className={copied.ok ? 'dev-inspector__ok' : 'dev-inspector__warn'}>{copied.ok ? 'Copied' : 'Copy failed'}: {copied.loc}</div>}
        {hover && dedupeChain(hover.chain).map((c) => (
          <button key={c.loc} type="button" className="dev-inspector__row" onClick={() => void doCopy(c.loc)}>{c.loc}</button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
