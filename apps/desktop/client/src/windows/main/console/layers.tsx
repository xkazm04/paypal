// The console's layer framework (rebuild WP2.5). Every layer of the main window - the decision
// centre, the waiting list, the six modules, a deal, the Rewind, the Charter and the owner's places
// (rules, wallet limits, connections, the pairing desk, settings, the safety record) - is one
// registered `LayerDef`: which component draws it (code-split, preloaded when the window is idle),
// what it is called, and optionally its crumb and colour. Area files under `console/layers/` each
// export their defs; `layers.registry.ts` collects them (one import line per area), so builders of
// different areas never edit the same file.
//
// What a layer may do is what `LayerNav` offers: move along the chain of layers (go, back, a deal
// a layer down, a place from here), nothing else. The chain itself (parent, depth, crumbs, Escape,
// focus and scroll restore) is the console's, derived from the route alone (route.ts, logic.ts
// stepBack); a layer never draws its own Back. Money: no layer calls a command that moves money;
// the only way there is `approval_open` (console/guard.test.ts reads every source file).
import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import type { LazyPart } from '../../../lib/lazy';
import { LAYER_LOADING } from '../../../lib/words';
import { LayerSuspense } from '../../../shared/boundary';
import { ChromeBackContext } from '../../../shared/ui';
import { sheetViewOf, withoutView, type Place, type PlaceFrom, type Route, type SetupStep } from '../logic';
import type { PairMode } from '../setup/pairing';
import type { Presence } from './centreModel';
import { ModuleRouteContext, useViewLabel, type ModuleRoute } from '../viewNav';
import { Stagger } from './stagger';

/** Every layer the console can show. A module's layer id is the module's own key. */
export type LayerId = 'centre' | 'waiting' | 'rewind' | 'setup' | 'deal' | Module | Place;

/** Moving to another layer pushes a history entry (or replaces this one); `focus` is the focus key
 *  (console/memory.ts) to give back when the owner comes back up to this layer. */
export type GoOptions = { replace?: boolean; focus?: string | null };

/** The only moves a layer can make. Every one walks the console's chain; none touches money. */
export type LayerNav = {
  /** Any route (a new history entry unless `replace`). */
  go: (to: Route, o?: GoOptions) => void;
  /** One layer up the chain (the same as the top bar's Back and Escape). */
  back: () => void;
  /** The decision centre. */
  home: () => void;
  /** A module's summary layer. */
  module: (m: Module) => void;
  /** A deal, one layer below the page it is opened from. */
  deal: (id: string) => void;
  /** The centre, showing this deal's decision in front. */
  need: (dealId: string) => void;
  /** One of the owner's places; opened from a module page or from Settings, Back returns there.
   *  `pair` opens the pairing desk on that way of connecting. */
  place: (p: Place, o?: { pair?: PairMode }) => void;
  rewind: (at?: number) => void;
  setup: (step?: SetupStep) => void;
  /** The quit confirmation (a sheet: it is a confirm, not a layer). */
  quit: () => void;
};

/** Console state a layer may read (never write). */
export type LayerState = {
  /** The Rewind opens at this moment (a "while you were away" line), else at now. */
  rewindAt: number | null;
  /** The pairing desk opens on this way of connecting. */
  pairMode: PairMode | undefined;
  /** A brand-new wallet: the centre is the Charter. */
  firstRun: boolean;
  /** The wallet's state as the seal shows it (centreModel presenceOf). */
  presence: Presence;
};

export type LayerProps = { route: Route; nav: LayerNav; state: LayerState };

export type LayerDef = {
  id: LayerId;
  /** The layer's content. Use `lazyPart` (lib/lazy.ts) so its code is a chunk of its own. */
  component: ComponentType<LayerProps> | LazyPart<LayerProps>;
  /** The layer's name: the sheet's accessible name and the crumb (until `Crumb` says more). */
  title: (route: Route) => string;
  /** A crumb that needs a read (a deal's name, a module view's label). Defaults to `title`. */
  Crumb?: ComponentType<{ route: Route }>;
  /** The layer's colour (a CSS value) when it is not a module's own. */
  tone?: string;
  /** The layer fits the sheet and scrolls its own list (the waiting list, a long ledger), instead
   *  of growing with its content and scrolling the sheet. */
  fit?: boolean;
  /** The layer draws the wallet's seal itself, so the sheet's corner seal is left out. */
  ownSeal?: boolean;
  /** A deal's or a place's nested card views (`&dv=` / `&v=` in the hash): key -> crumb label.
   *  A key not listed here is no view (the chain steps over it and the sheet opens none). */
  views?: Readonly<Record<string, string>>;
};

/** Identity, typed: an area file writes `defineLayer({ ... })`. */
export const defineLayer = (def: LayerDef): LayerDef => def;

/** Which layer a route shows. */
export function layerIdOf(r: Route): LayerId {
  switch (r.level) {
    case 'home': return 'centre';
    case 'waiting': return 'waiting';
    case 'rewind': return 'rewind';
    case 'setup': return 'setup';
    case 'deal': return 'deal';
    case 'module': return r.module;
    case 'place': return r.place;
  }
}

/** Where a place is opened from when a layer opens it: the module page it is on, or Settings. */
export function placeFromRoute(here: Route, p: Place): PlaceFrom | undefined {
  if (here.level === 'module') return here.module;
  if (here.level === 'place' && here.place === 'settings' && p !== 'settings') return 'settings';
  return undefined;
}

/** The open card view of a deal's or a place's sheet, as the route says (`&dv=` / `&v=`), and how
 *  to change it: opening pushes a history entry (or replaces the open one), closing is one step up
 *  the chain, so Escape, Back, the crumbs and the browser's Back all close it. Null outside such a
 *  layer: the sheet then keeps its open view as its own state. */
export type SheetView = { view: string | null; open: (view: string | null, cardId?: string) => void };
const SheetViewContext = createContext<SheetView | null>(null);
export const useSheetView = (): SheetView | null => useContext(SheetViewContext);

const NavContext = createContext<LayerNav | null>(null);
const StateContext = createContext<LayerState>({ rewindAt: null, pairMode: undefined, firstRun: false, presence: { state: 'quiet', word: '', line: '' } });

/** The current layer's moves, anywhere inside it (a row three components down). */
export function useLayerNav(): LayerNav {
  const n = useContext(NavContext);
  if (!n) throw new Error('useLayerNav outside a console layer');
  return n;
}
export const useLayerState = (): LayerState => useContext(StateContext);

/** A calm placeholder while a layer's code loads: two quiet bars that appear only after a beat
 *  (design/motion tokens), so a fast load never flashes. */
export function LayerSkeleton() {
  return (
    <div className="cs-skel" role="status" aria-label={LAYER_LOADING}>
      <span className="b1" /><span className="b2" /><span className="b3" />
    </div>
  );
}

/** Draws the registered layer for a route inside its boundary: an error shows the layer's calm
 *  fallback (never a blank window), a loading chunk the skeleton. Inside it the console's chrome
 *  owns Back (`ChromeBackContext`), a module layer gets its detail-view route, and the layer's parts
 *  take their turns in one reveal sequence (`Stagger`, stagger.tsx). */
export function LayerHost({ def, route, nav, state, resetKey }: { def: LayerDef; route: Route; nav: LayerNav; state: LayerState; resetKey: string }) {
  const C = def.component;
  // Re-render once a module registers its view labels (a lazy page may register them as it loads).
  const known = useViewLabel(route.level === 'module' ? route.module : 'book', route.level === 'module' ? route.view : undefined) !== null;
  const moduleRoute = useMemo<ModuleRoute | null>(() => {
    if (route.level !== 'module') return null;
    const view = route.view && known ? route.view : null;
    return {
      view,
      open: (v, cardId) => {
        if (v) nav.go({ level: 'module', module: route.module, view: v }, { focus: cardId ? `card:${cardId}` : undefined });
        else nav.back();
      },
    };
  }, [route, nav, known]);
  const sheet = useMemo<SheetView | null>(() => {
    if (route.level !== 'deal' && route.level !== 'place') return null;
    const v = sheetViewOf(route);
    return {
      view: v && def.views?.[v] ? v : null,
      open: (next, cardId) => {
        if (next === null) { if (v) nav.back(); return; }
        if (next === v) return;
        nav.go({ ...withoutView(route), view: next } as Route, { replace: !!v, focus: cardId ? `card:${cardId}` : undefined });
      },
    };
  }, [route, nav, def.views]);
  let body: ReactNode = <C route={route} nav={nav} state={state} />;
  if (moduleRoute) body = <ModuleRouteContext.Provider value={moduleRoute}>{body}</ModuleRouteContext.Provider>;
  if (sheet) body = <SheetViewContext.Provider value={sheet}>{body}</SheetViewContext.Provider>;
  return (
    <NavContext.Provider value={nav}>
      <StateContext.Provider value={state}>
        <ChromeBackContext.Provider value={true}>
          <LayerSuspense layer="view" resetKeys={[resetKey]} fallback={<LayerSkeleton />}><Stagger>{body}</Stagger></LayerSuspense>
        </ChromeBackContext.Provider>
      </StateContext.Provider>
    </NavContext.Provider>
  );
}
