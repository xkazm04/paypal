// A module layer's summary cards (rebuild WP2.5): three or four `SummaryCard`s, each one figure or
// status that opens a nested detail view of the module (useModuleRoute: the view key is the `v=` in
// the hash, its label is registered with `defineModuleViews`). A card about something that waits for
// the owner says what happens if they do nothing. Focus comes back to the card that opened a view.
import type { CSSProperties, ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import { IF_NOTHING, MODULE_SUMMARY_LABEL } from '../../../lib/words';
import { SummaryCard, type ChipTone } from '../../../shared/ui';
import { registerViewLabels, useModuleRoute, type ViewLabels } from '../viewNav';

export type ModuleCard = {
  /** Stable id: focus returns here when the view closes. */
  id: string;
  /** The detail view it opens (a key registered with `defineModuleViews`). */
  view: string;
  label: ReactNode;
  /** The one figure or status line (amounts through `Amount`, counts through `formatCount`). */
  value: ReactNode;
  note?: ReactNode;
  chip?: ReactNode;
  chipTone?: ChipTone;
  /** Something here waits for the owner: the default on silence, in plain words. */
  ifNothing?: string | null;
};

/** At most this many cards: a summary that needs more is a list (ListEngine). */
export const MAX_CARDS = 4;

/** Registers a module's detail views (key -> crumb label) when the area file loads, so the crumbs
 *  and Escape know them before the page's chunk arrives. Returns the same map, typed. */
export function defineModuleViews<V extends ViewLabels>(module: Module, views: V): V {
  registerViewLabels(module, views);
  return views;
}

export function ModuleSummary({ cards, label = MODULE_SUMMARY_LABEL }: { cards: readonly ModuleCard[]; label?: string }) {
  const route = useModuleRoute();
  if (!cards.length) return null;
  return (
    <section className="ml-cards" aria-label={label} style={{ '--n': Math.min(cards.length, MAX_CARDS) } as CSSProperties}>
      {cards.slice(0, MAX_CARDS).map((c) => (
        <SummaryCard key={c.id} id={c.id} label={c.label} value={c.value} chip={c.chip} chipTone={c.ifNothing ? (c.chipTone ?? 'gold') : c.chipTone}
          className={c.ifNothing ? 'needs' : undefined}
          note={c.ifNothing ? <>{c.note ? <>{c.note} · </> : null}<span className="ml-ifnothing">{IF_NOTHING}: {c.ifNothing}</span></> : c.note}
          onOpen={() => route.open(c.view, c.id)} />
      ))}
    </section>
  );
}
