// Find (/ or Ctrl K): a decision, a module, a deal (by title, label or counterparty) or a place.
// A modal dialog over an inert console: the field is a combobox whose active option is named by
// aria-activedescendant, Arrow Up/Down move, Enter opens, Esc closes (it is a layer, so it closes
// before anything under it), Tab stays inside. The index is built once per change of the needs and
// the deals (findIndex.ts), never per keystroke. Opening something never moves money.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MODULES } from '../../../shared/modules';
import { Dot, Field, trapTab, useLayer, useModalFocus, useReturnFocus } from '../../../shared/ui';
import {
  CENTRE_TITLE, FIND_GROUP, FIND_KEYS, FIND_LABEL, FIND_PLACEHOLDER, FIND_RESULTS, findShown, PLACE_FIND_SUB, PLACE_NAME, PLACE_TITLE, REWIND_TITLE, SETUP_PAGE_TITLE, WAITING_TITLE,
} from '../../../lib/words';
import { stateLabel } from '../logic';
import { noMatch } from '../paletteCopy';
import { useCpLookup } from '../ui';
import { useWorldSelector, type World } from '../world';
import { demoFindItems } from './DemoSwitch';
import { buildIndex, FIND_CAP, matchCount, searchIndex, type FindIndex, type FindItem, type FindTarget } from './findIndex';

const selFind = (w: World) => ({ needs: w.needs, deals: w.deals.data, display: w.display });
const sameFind = (a: ReturnType<typeof selFind>, b: ReturnType<typeof selFind>) => a.needs === b.needs && a.deals === b.deals && a.display === b.display;

/** The places Find lists, in the old palette's Owner order, plus the console's own layers. */
const PLACES: readonly FindItem[] = [
  { key: 'p-centre', group: 'places', title: CENTRE_TITLE, sub: 'the decision centre', target: { kind: 'route', route: { level: 'home' } } },
  { key: 'p-waiting', group: 'places', title: WAITING_TITLE, sub: 'every decision that waits for you', target: { kind: 'route', route: { level: 'waiting' } } },
  { key: 'p-rewind', group: 'places', title: REWIND_TITLE, sub: PLACE_TITLE.rewind.toLowerCase(), target: { kind: 'route', route: { level: 'rewind' } } },
  { key: 's-settings', group: 'places', title: PLACE_NAME.settings, sub: PLACE_FIND_SUB.settings, target: { kind: 'route', route: { level: 'place', place: 'settings' } } },
  { key: 's-connections', group: 'places', title: PLACE_NAME.connections, sub: PLACE_FIND_SUB.connections, target: { kind: 'route', route: { level: 'place', place: 'connections' } } },
  { key: 's-pairing', group: 'places', title: PLACE_NAME.pairing, sub: PLACE_FIND_SUB.pairing, target: { kind: 'route', route: { level: 'place', place: 'pairing' } } },
  { key: 's-mandates', group: 'places', title: PLACE_NAME.rules, sub: PLACE_FIND_SUB.rules, target: { kind: 'route', route: { level: 'place', place: 'rules' } } },
  { key: 's-limits', group: 'places', title: PLACE_NAME.limits, sub: PLACE_FIND_SUB.limits, target: { kind: 'route', route: { level: 'place', place: 'limits' } } },
  { key: 'p-setup', group: 'places', title: SETUP_PAGE_TITLE, sub: 'your keys, your rules and a practice deal, one step at a time', target: { kind: 'setup', step: 'keys' } },
  { key: 's-safety', group: 'places', title: PLACE_NAME.safety, sub: PLACE_FIND_SUB.safety, target: { kind: 'route', route: { level: 'place', place: 'safety' } } },
  { key: 's-quit', group: 'places', title: 'Quit The Table', sub: 'stops the wallet · see what waits first', target: { kind: 'quit' } },
];

/** The index over the window's World: built again only when the needs, the deals or their names change. */
export function useFindIndex(): FindIndex {
  const { needs, deals, display } = useWorldSelector(selFind, sameFind);
  const cp = useCpLookup();
  return useMemo(() => {
    const byId = new Map((deals ?? []).map((d) => [d.id, d]));
    const items: FindItem[] = [
      ...needs.map((n): FindItem => {
        const d = byId.get(n.deal_id);
        return { key: `n-${n.deal_id}`, group: 'needs', title: n.headline, sub: d ? display(d).title : n.label, also: n.label, color: `var(--m-${n.module})`, target: { kind: 'need', deal: n.deal_id } };
      }),
      ...MODULES.map((m, i): FindItem => ({ key: `m-${m.key}`, group: 'modules', title: m.name, sub: m.long, hint: String(i + 1), color: m.cssVar, target: { kind: 'module', module: m.key } })),
      ...(deals ?? []).map((d): FindItem => {
        const disp = display(d);
        return { key: `d-${d.id}`, group: 'deals', title: disp.title, also: disp.label, sub: `${cp(d.counterparty).name} · ${stateLabel(d.state, d)}`, target: { kind: 'deal', deal: d.id } };
      }),
      ...PLACES,
      ...demoFindItems(),
    ];
    return buildIndex(items);
  }, [needs, deals, display, cp]);
}

export function Find({ onClose, onPick }: { onClose: () => void; onPick: (t: FindTarget) => void }) {
  const index = useFindIndex();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useLayer(onClose, 'palette');
  useReturnFocus();
  useModalFocus(box, input);
  useEffect(() => { input.current?.focus(); }, []);

  const items = useMemo(() => searchIndex(index, q), [index, q]);
  const total = useMemo(() => (items.length >= FIND_CAP ? matchCount(index, q) : items.length), [index, q, items]);
  const cur = Math.min(sel, Math.max(0, items.length - 1));
  const active = items[cur];
  const pick = (i: FindItem | undefined) => { if (!i) return; onClose(); onPick(i.target); };

  useEffect(() => {
    const el = active ? list.current?.querySelector<HTMLElement>(`[data-k="${CSS.escape(active.key)}"]`) : null;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  return createPortal(
    <>
      <div className="ui-scrim" aria-hidden="true" onMouseDown={onClose} />
      <div ref={box} className="pal cs-find" role="dialog" aria-modal="true" aria-label={FIND_LABEL} tabIndex={-1} onKeyDown={(e) => trapTab(e, box.current)}>
        <div className="pal-h">
          <Field ref={input} search value={q} placeholder={FIND_PLACEHOLDER} aria-label={FIND_LABEL} autoComplete="off" spellCheck={false}
            role="combobox" aria-expanded="true" aria-controls="cs-find-list" aria-autocomplete="list" aria-activedescendant={active ? `cs-find-${active.key}` : undefined}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(items.length - 1, cur + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(0, cur - 1)); }
              else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setSel(0); }
              else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); setSel(Math.max(0, items.length - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); pick(active); }
            }} />
        </div>
        <div id="cs-find-list" role="listbox" aria-label={FIND_RESULTS} className="pal-list" ref={list}>
          {items.map((i, k) => (
            <div key={i.key} data-k={i.key} role="presentation">
              {k === 0 || items[k - 1]?.group !== i.group ? <div className="pal-g" role="presentation">{FIND_GROUP[i.group]}</div> : null}
              <div id={`cs-find-${i.key}`} role="option" aria-selected={k === cur} className={`ui-row pal-row ${k === cur ? 'on' : ''}`}
                onMouseMove={() => { if (k !== cur) setSel(k); }} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
                {i.color ? <Dot style={{ color: i.color }} /> : <span className="pal-ic" aria-hidden="true">·</span>}
                <span className="main"><span className="t1">{i.title}</span></span>
                <span className="pal-sub">{i.sub}</span>
                {i.hint ? <span className="kbd" aria-hidden="true">{i.hint}</span> : null}
              </div>
            </div>
          ))}
          {!items.length ? <div className="ui-empty" role="status">{noMatch(q)}</div> : null}
        </div>
        <div className="pal-f ui-hint" aria-hidden="true">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> {FIND_KEYS.move}</span><span><span className="kbd">Enter</span> {FIND_KEYS.open}</span>
          <span><span className="kbd">Esc</span> {FIND_KEYS.close}</span><span className="ui-spacer" /><span>{findShown(items.length, total)}</span>
        </div>
      </div>
    </>,
    document.body,
  );
}
