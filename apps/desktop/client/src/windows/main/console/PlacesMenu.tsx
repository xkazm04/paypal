// The Places menu (navigation variant C): one button in the console's bar that opens the owner's
// places in three groups (Watch, Configure, Lab). It hangs from the shared Popover, which closes it on
// Esc (the layer stack) and on an outside click and hands focus back to the button. The panel is a
// menu: arrows, Home and End move between the items; Enter or a click opens the place. The place that
// is open carries aria-current, as the old top-bar buttons did.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { PLACES_MENU } from '../../../lib/words';
import { Popover } from '../../../shared/ui';

export type PlaceItem = { id: string; label: string; title: string; lit: boolean; onPick: () => void };
export type PlaceGroup = { key: keyof typeof PLACES_MENU.groups; items: readonly PlaceItem[] };

export function PlacesMenu({ groups }: { groups: readonly PlaceGroup[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const shown = groups.filter((g) => g.items.length > 0);
  const anyLit = shown.some((g) => g.items.some((i) => i.lit));
  const items = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // The popover focuses its panel; the lit item (else the first) takes the focus once it is there.
  useEffect(() => {
    if (!anchor) return;
    const t = setTimeout(() => {
      const all = items();
      (all.find((e) => e.getAttribute('aria-current') === 'page') ?? all[0])?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [anchor]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const all = items();
    const at = all.indexOf(e.target as HTMLElement);
    let to: number | null = null;
    if (e.key === 'ArrowDown') to = (at + 1) % all.length;
    else if (e.key === 'ArrowUp') to = (at - 1 + all.length) % all.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = all.length - 1;
    if (to === null) return;
    e.preventDefault();
    all[to]?.focus();
  };

  return (
    <>
      <button type="button" id="cs-place-menu" className={`cs-place cs-places-btn${anyLit ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={!!anchor} title={PLACES_MENU.title}
        onClick={(e) => { const t = e.currentTarget; setAnchor((a) => (a ? null : t)); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !anchor) { e.preventDefault(); setAnchor(e.currentTarget); } }}>
        {PLACES_MENU.button}<span className="cs-caret" aria-hidden="true">▾</span>
      </button>
      {anchor ? (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} title={PLACES_MENU.menu} className="cs-places-menu">
          <div ref={list} role="menu" aria-label={PLACES_MENU.menu} onKeyDown={onKeyDown}>
            {shown.map((g) => (
              <div key={g.key} role="group" aria-label={PLACES_MENU.groups[g.key]} className="cs-pm-group">
                <span className="cs-pm-head" aria-hidden="true">{PLACES_MENU.groups[g.key]}</span>
                {g.items.map((i) => (
                  <button key={i.id} type="button" role="menuitem" id={i.id} tabIndex={-1} className={`cs-pm-item${i.lit ? ' on' : ''}`} aria-current={i.lit ? 'page' : undefined} title={i.title}
                    onClick={() => { anchor.focus(); setAnchor(null); i.onPick(); }}>{i.label}</button>
                ))}
              </div>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}
