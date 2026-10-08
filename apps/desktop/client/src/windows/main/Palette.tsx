// Ctrl K - find a module, a deal (by label, title or counterparty) or an owner sheet. v2 look:
// a search field and grouped one-line rows over a scrim. It is a layer (layers.ts), so Esc closes
// it before anything under it (a sheet it was opened over, or App's "back one level").
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Module } from '@bindings/Module';
import { MODULES } from '../../shared/modules';
import { Dot, Field, trapTab, useLayer, useModalFocus, useReturnFocus } from '../../shared/ui';
import { stateLabel, type SheetTab } from './logic';
import { useCpLookup } from './ui';
import { useWorld } from './world';
import './palette.css';

type Group = 'Modules' | 'Deals' | 'Owner';
const GROUP_TEXT: Record<Group, string> = { Modules: 'Go to', Deals: 'Deals', Owner: 'Settings' };
/** `also` is searched but not shown (a deal's label: typing "D-0193" still finds it; ids stay off Layer 1). */
type Item = { key: string; group: Group; title: string; sub: string; also?: string; hint?: string; color?: string; go: () => void };

export function Palette({ onClose, onModule, onDeal, onSheet, onQuit }: { onClose: () => void; onModule: (m: Module) => void; onDeal: (id: string) => void; onSheet: (t: SheetTab) => void; onQuit?: () => void }) {
  const w = useWorld();
  const cp = useCpLookup();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useLayer(onClose, 'palette');
  useReturnFocus();
  useModalFocus(box, input);
  useEffect(() => { input.current?.focus(); }, []);

  const all = useMemo<Item[]>(() => [
    ...MODULES.map((m, i) => ({ key: `m-${m.key}`, group: 'Modules' as const, title: m.name, sub: m.long, hint: String(i + 1), color: m.cssVar, go: () => onModule(m.key) })),
    ...(w.deals.data ?? []).map((d) => {
      const disp = w.display(d);
      return { key: `d-${d.id}`, group: 'Deals' as const, title: disp.title, also: disp.label, sub: `${cp(d.counterparty).name} · ${stateLabel(d.state, d)}`, go: () => onDeal(d.id) };
    }),
    { key: 's-settings', group: 'Owner', title: 'Settings', sub: 'agent app, pause agents, PayPal key, lock', go: () => onSheet('settings') },
    { key: 's-pairing', group: 'Owner', title: 'Connections', sub: 'connect with another wallet or the house seller', go: () => onSheet('pairing') },
    { key: 's-mandates', group: 'Owner', title: 'Agent rules', sub: 'what your agents may do · change in the approval window', go: () => onSheet('mandates') },
    ...(onQuit ? [{ key: 's-quit', group: 'Owner' as const, title: 'Quit The Table', sub: 'stops the wallet · see what waits first', go: onQuit }] : []),
  ], [w, cp, onModule, onDeal, onSheet, onQuit]);
  const needle = q.trim().toLowerCase();
  const items = (needle ? all.filter((i) => `${i.title} ${i.sub} ${i.also ?? ''}`.toLowerCase().includes(needle)) : all).slice(0, 40);
  const pick = (i: Item | undefined) => { if (!i) return; onClose(); i.go(); };
  const cur = Math.min(sel, Math.max(0, items.length - 1));

  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-k="${CSS.escape(items[cur]?.key ?? '')}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cur, items]);

  return createPortal(
    <>
      <div className="ui-scrim" aria-hidden="true" onMouseDown={onClose} />
      <div ref={box} className="pal" role="dialog" aria-modal="true" aria-label="Find" tabIndex={-1} onKeyDown={(e) => trapTab(e, box.current)}>
        <div className="pal-h">
          <Field ref={input} search value={q} placeholder="Find a deal, a person or a place…" aria-label="Find" autoComplete="off" spellCheck={false}
            role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={items[cur] ? `pal-${items[cur].key}` : undefined}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(items.length - 1, cur + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(0, cur - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); pick(items[cur]); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            }} />
        </div>
        <div id="pal-list" role="listbox" aria-label="Results" className="pal-list" ref={list}>
          {items.map((i, k) => (
            <div key={i.key} data-k={i.key}>
              {k === 0 || items[k - 1]?.group !== i.group ? <div className="pal-g" role="presentation">{GROUP_TEXT[i.group]}</div> : null}
              <div id={`pal-${i.key}`} role="option" aria-selected={k === cur} className={`ui-row pal-row ${k === cur ? 'on' : ''}`}
                onMouseMove={() => { if (k !== cur) setSel(k); }} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
                {i.color ? <Dot style={{ color: i.color }} /> : <span className="pal-ic" aria-hidden="true">{i.group === 'Owner' ? '⚙' : '·'}</span>}
                <span className="main"><span className="t1">{i.title}</span></span>
                <span className="pal-sub">{i.sub}</span>
                {i.hint ? <span className="kbd">{i.hint}</span> : null}
              </div>
            </div>
          ))}
          {!items.length ? <div className="ui-empty">Nothing matches.</div> : null}
        </div>
        <div className="pal-f ui-hint"><span><span className="kbd">↑</span> <span className="kbd">↓</span> move</span><span><span className="kbd">Enter</span> open</span><span><span className="kbd">Esc</span> close</span><span className="ui-spacer" /><span>{items.length} shown</span></div>
      </div>
    </>,
    document.body,
  );
}
