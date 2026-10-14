// The small Dial kept as presence beside the seal (the owner's choice): one segment per module, one
// bead per deal in its state's colour (beadLook.ts liveLook: a payment being checked with PayPal is
// dashed, never on hold), the deals that need the owner first. Book (every payment) has no
// segment of its own: its deals are already in the five others. It reads the brand strip's look
// (shared/brand DialStrip, `.br-strip`) but its beads are buttons: a click opens that deal. The
// beads are pointer shortcuts only (out of the tab order): every deal is also reachable from its
// module, the waiting list and Find.
import { useMemo, type CSSProperties } from 'react';
import type { Deal } from '@bindings/Deal';
import type { Module } from '@bindings/Module';
import { stripBeads } from '../../../shared/brand';
import { MODULES } from '../../../shared/modules';
import type { ChipTone } from '../../../shared/ui';
import { stripLabel } from '../../../lib/words';
import { liveLook } from '../beadLook';
import { useWorldSelector, type World } from '../world';

export const BEADS_PER_MODULE = 8;

type Bead = { id: string; tone: ChipTone; tip: string; needs: boolean };

const sel = (w: World) => ({ deals: w.deals.data, needOf: w.needOf, display: w.display, moduleOfDeal: w.moduleOfDeal });
const same = (a: ReturnType<typeof sel>, b: ReturnType<typeof sel>) => a.deals === b.deals && a.needOf === b.needOf && a.display === b.display && a.moduleOfDeal === b.moduleOfDeal;

/** The beads per module: the deals that need the owner first, then the rest in ledger order. */
export function beadsByModule(deals: readonly Deal[], o: { needOf: World['needOf']; display: World['display']; moduleOfDeal: World['moduleOfDeal'] }): Map<Module, Bead[]> {
  const out = new Map<Module, Bead[]>(MODULES.map((m) => [m.key, []]));
  for (const d of deals) {
    const need = o.needOf(d.id);
    const look = liveLook(d, need);
    const tone: ChipTone = need && !need.money_check ? 'gold' : look.tone;
    out.get(o.moduleOfDeal(d))?.push({ id: d.id, tone, tip: `${o.display(d).title} · ${look.state}`, needs: !!need });
  }
  for (const list of out.values()) list.sort((a, b) => Number(b.needs) - Number(a.needs));
  return out;
}

export function BeadStrip({ onDeal }: { onDeal: (id: string) => void }) {
  const w = useWorldSelector(sel, same);
  const byModule = useMemo(() => beadsByModule(w.deals ?? [], w), [w]);
  const all = w.deals?.length ?? 0;
  const needs = [...byModule.values()].reduce((n, l) => n + l.filter((b) => b.needs).length, 0);
  return (
    <div className="br-strip cs-strip" role="group" aria-label={stripLabel(all, needs)}>
      {MODULES.filter((m) => m.key !== 'book').map((m) => {
        const list = byModule.get(m.key) ?? [];
        const { shown, more } = stripBeads(list.map((b) => b.tone), BEADS_PER_MODULE);
        const style = { '--mc': m.cssVar } as CSSProperties;
        return (
          <span key={m.key} className="seg" data-m={m.key} data-waiting={list.some((b) => b.needs) ? '' : undefined} style={style} title={m.name}>
            {shown.map((t, i) => {
              const b = list[i];
              return b ? <button key={b.id} type="button" tabIndex={-1} className={`bead ${t}`} title={b.tip} aria-label={b.tip} onClick={() => onDeal(b.id)} /> : null;
            })}
            {more ? <span className="more" aria-hidden="true">+{more}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
