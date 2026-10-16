// The small Dial kept as presence beside the seal (the owner's choice): one segment per module, one
// bead per deal in its state's colour (beadLook.ts liveLook: a payment being checked with PayPal is
// dashed, never on hold), the deals that need the owner first. Book (every payment) has no
// segment of its own: its deals are already in the five others. It reads the brand strip's look
// (shared/brand DialStrip, `.br-strip`) but its beads are buttons: a click or Enter opens that
// deal. Each bead is a 24 px target around a small visual bead (WCAG 2.5.8), named by the deal's
// plain title; the strip is one tab stop (roving tabindex) and the arrow keys move along it, so it
// stays compact in the tab order. Every deal is also reachable from its module, the list and Find.
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Deal } from '@bindings/Deal';
import type { Module } from '@bindings/Module';
import { stripBeads } from '../../../shared/brand';
import { MODULES } from '../../../shared/modules';
import type { ChipTone } from '../../../shared/ui';
import { stripLabel } from '../../../lib/words';
import { liveLook } from '../beadLook';
import { shortTitle } from '../home/model';
import { useWorldSelector, type World } from '../world';

export const BEADS_PER_MODULE = 8;

type Bead = { id: string; tone: ChipTone; name: string; tip: string; needs: boolean };

const sel = (w: World) => ({ deals: w.deals.data, needOf: w.needOf, display: w.display, moduleOfDeal: w.moduleOfDeal });
const same = (a: ReturnType<typeof sel>, b: ReturnType<typeof sel>) => a.deals === b.deals && a.needOf === b.needOf && a.display === b.display && a.moduleOfDeal === b.moduleOfDeal;

/** The beads per module: the deals that need the owner first, then the rest in ledger order. */
export function beadsByModule(deals: readonly Deal[], o: { needOf: World['needOf']; display: World['display']; moduleOfDeal: World['moduleOfDeal'] }): Map<Module, Bead[]> {
  const out = new Map<Module, Bead[]>(MODULES.map((m) => [m.key, []]));
  for (const d of deals) {
    const need = o.needOf(d.id);
    const look = liveLook(d, need);
    const tone: ChipTone = need && !need.money_check ? 'gold' : look.tone;
    const name = shortTitle(o.display(d).title);
    out.get(o.moduleOfDeal(d))?.push({ id: d.id, tone, name, tip: `${name} · ${look.state}`, needs: !!need });
  }
  for (const list of out.values()) list.sort((a, b) => Number(b.needs) - Number(a.needs));
  return out;
}

export function BeadStrip({ onDeal }: { onDeal: (id: string) => void }) {
  const w = useWorldSelector(sel, same);
  const byModule = useMemo(() => beadsByModule(w.deals ?? [], w), [w]);
  const all = w.deals?.length ?? 0;
  const needs = [...byModule.values()].reduce((n, l) => n + l.filter((b) => b.needs).length, 0);
  const segs = MODULES.filter((m) => m.key !== 'book').map((m) => {
    const list = byModule.get(m.key) ?? [];
    const { shown, more } = stripBeads(list.map((b) => b.tone), BEADS_PER_MODULE);
    return { m, list, shown, more };
  });
  // The beads in reading order: the strip's one tab stop moves along them with the arrow keys.
  const order = segs.flatMap((s) => s.shown.map((_, i) => s.list[i]?.id).filter((id): id is string => !!id));
  const [at, setAt] = useState<string | null>(null);
  const current = at && order.includes(at) ? at : order[0] ?? null;
  const root = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const i = current ? order.indexOf(current) : -1;
    let to: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = Math.min(order.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = Math.max(0, i - 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = order.length - 1;
    if (to === null) return;
    // Handled here: the centre's own Left / Right (walk the queue) must not also run.
    e.preventDefault();
    const id = order[to];
    if (!id) return;
    setAt(id);
    root.current?.querySelector<HTMLElement>(`[data-bead="${CSS.escape(id)}"]`)?.focus();
  };
  return (
    <div ref={root} className="br-strip cs-strip" role="group" aria-label={stripLabel(all, needs)} onKeyDown={onKey}>
      {segs.map(({ m, list, shown, more }) => {
        const style = { '--mc': m.cssVar } as CSSProperties;
        return (
          <span key={m.key} className="seg" data-m={m.key} data-waiting={list.some((b) => b.needs) ? '' : undefined} style={style} title={m.name}>
            {shown.map((t, i) => {
              const b = list[i];
              return b ? (
                <button key={b.id} type="button" className="cs-bead" data-bead={b.id} tabIndex={b.id === current ? 0 : -1} title={b.tip} aria-label={b.name}
                  onFocus={() => setAt(b.id)} onClick={() => onDeal(b.id)}>
                  <span className={`bead ${t}`} aria-hidden="true" />
                </button>
              ) : null;
            })}
            {more ? <span className="more" aria-hidden="true">+{more}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
