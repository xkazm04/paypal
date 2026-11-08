// The Main window as the Calibre console (rebuild WP2, layers WP2.5): one front sheet on a stack of
// layers.
//   1  the decision centre (or, on a brand-new wallet, the Charter)
//   2  the six modules (the tabs on the sheet's top edge), everything waiting, the Rewind, Set up,
//      and the owner's places: agent rules, connections, settings, the safety record
//   3  a module's detail view, a deal; the wallet limits (under rules), the pairing desk (under
//      connections); a place opened from a module page or from Settings
//   4  a deal opened from a module's detail view
// Every layer is a registered LayerDef (console/layers.tsx, layers.registry.ts): this frame only
// looks the route's layer up and hosts it. The route lives in the hash (logic.ts parseHash /
// formatHash; every older link still parses, the old sheet links included) and the chain of layers
// is derived from it (route.ts), never from a click history. Esc goes one layer up (Find and any
// confirm or popover close first: they are layers of their own), and the Back button, the crumbs
// and the browser's Back/forward walk the same chain. Going deeper focuses the new layer's heading;
// coming back gives focus and scroll back to where they were left.
// Money: the main window only ever opens the approval window (approval_open).
import { startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Module } from '@bindings/Module';
import { useEvent, useMutation } from '../../../lib/hooks';
import { isLazyPart, lazyPart, preloadOnIntent, preloadWhenIdle, whenPartsReady } from '../../../lib/lazy';
import {
  A_DEAL, BACK_TITLE, WALLET_FAULT_TOAST, CHARTER_TITLE, DETAIL_BACK, INSPECTOR_LABEL, LOCK, LATER_ALONE, LATER_TOAST, NOTICE_WHAT, PLACE, PLACE_TITLE,
  SEAL_RING, sealLabel, silenceWords, tabTitle, tabWaiting, TABS_LABEL,
} from '../../../lib/words';
import { formatCount } from '../../../lib/data/counts';
import { Seal } from '../../../shared/brand';
import { APP_BRAND_EVENT, APP_FIND_EVENT, APP_STATUS_EVENT, useAppHeaderEvent } from '../AppHeader';
import { Glyph, MODULE, MODULES } from '../../../shared/modules';
import { Btn, InspectorHostProvider, layerCount, ModuleTab, Stack, TabStrip, TOAST_MS, useInspectorHost, useToast } from '../../../shared/ui';
import { shortTitle } from '../home/model';
import { formatHash, parseHash, receiptToast, resolveDealRef, sheetViewOf, type Place, type Route, type SetupStep } from '../logic';
import type { PairMode } from '../setup/pairing';
import { useSetupIntent, useStart } from '../setup/start';
import { Shortcuts } from '../Shortcuts';
import { LockGlyph } from '../ui';
import { useViewLabel, viewLabel } from '../viewNav';
import { useDealLabels, useDeals, useLocked, useNeeds, useWorldSelector, type World } from '../world';
import type { CentreProps } from './Centre';
import { currentIndex, cycle, orderQueue, presenceOf, putOff } from './centreModel';
import { Find } from './Find';
import { ViewSwitch } from '../ViewSwitch';
import { PlacesMenu, type PlaceGroup, type PlaceItem } from './PlacesMenu';
import { switchDemo } from './DemoSwitch';
import { Footer } from './Footer';
import type { FindTarget } from './findIndex';
import { CrumbLabel } from './crumbItems';
import { CentreHost, type CentreHostValue } from './layers/core';
import { LayerHost, layerIdOf, placeFromRoute, type LayerId, type LayerNav, type LayerState } from './layers';
import { LAYERS, LAYER_PARTS, layerOf } from './layers.registry';
import { placeAvailable } from '../logic';
import { useWatching } from './ledger';
import { focusKeyOf, restoreLayer, type LayerMemory } from './memory';
import { chainOf, isAncestor, moduleOfRoute, mountKey, parentOf, routeKey, sameLayer, type ChainCtx } from './route';
import { StaleBanner } from './StaleBanner';
import { StaggerProvider } from './stagger';
import { watchTable } from '../modules/tables/watchPick';
// Every tab's stylesheet is part of the window's one eager stylesheet (never fetched with a tab's code),
// so nothing restyles when a tab's chunk arrives.
import '../../../arena/arena.css';
import '../../../proof/proof.css';
import './areas/try/preview.css';
import './console.css';
import './find.css';
import './framework.css';
import '../quit.css';

const QuitSheet = lazyPart(() => import('../QuitSheet').then((m) => m.QuitSheet));
// Idle preload order = likeliest next first (the six modules, then the places), one chunk per idle slot.
const LATER_PARTS = [...LAYER_PARTS, QuitSheet];
/** A navigation waits this long at most for the next tab's code, keeping the old screen up meanwhile. */
const READY_CAP_MS = 300;

type Dir = 'into' | 'out' | 'swap';
type Nav = { route: Route; dir: Dir; restore: boolean; n: number };
/** What the console keeps in each history entry it writes: its place in the console's own stack. */
type HistState = { tc: number };

const selModuleOf = (w: World) => w.moduleOfDeal;
const urlOf = (h: string) => `${location.pathname}${location.search}${h}`;
const histIndex = (s: unknown): number | null => (s && typeof s === 'object' && typeof (s as HistState).tc === 'number' ? (s as HistState).tc : null);

/** The console's colour per layer (a module's colour on its own layers, else the layer's own). */
function toneOf(r: Route, m: Module | null): string {
  if (m) return MODULE[m].cssVar;
  return layerOf(r).tone ?? 'var(--steel)';
}

/** The places the top bar opens, and which place keeps a button lit. */
type BarPlace = { place: Place; label: string; title: string; lit: readonly Place[] };
const ALL_BAR_PLACES: readonly BarPlace[] = [
  { place: 'rules', label: PLACE.rules, title: PLACE_TITLE.rules, lit: ['rules', 'limits'] },
  { place: 'connections', label: PLACE.connections, title: PLACE_TITLE.connections, lit: ['connections', 'pairing'] },
  { place: 'settings', label: PLACE.settings, title: PLACE_TITLE.settings, lit: ['settings'] },
  { place: 'try', label: PLACE.try, title: PLACE_TITLE.try, lit: ['try'] },
  { place: 'proof', label: PLACE.proof, title: PLACE_TITLE.proof, lit: ['proof'] },
  { place: 'director', label: PLACE.director, title: PLACE_TITLE.director, lit: ['director'] },
];
/** The preview-only tab (the director) is left out of the desktop shell. */
const BAR_PLACES = ALL_BAR_PLACES.filter((b) => placeAvailable(b.place));
/** Hover / focus on a top-bar place or a module tab warms its chunk, so the click that follows swaps at once. */
function warmOnIntent(e: { target: EventTarget }): void {
  const el = e.target instanceof Element ? e.target.closest('[id^="cs-place-"],[id^="cs-tab-"]') : null;
  const id = el?.id.replace(/^cs-(place|tab)-/, '');
  if (!id) return;
  const def = (LAYERS as ReadonlyMap<string, { component: unknown }>).get(id);
  if (def) preloadOnIntent(def.component);
}


export function Console() {
  const toast = useToast();
  const needs = useNeeds();
  const dealsQ = useDeals();
  const deals = dealsQ.data;
  const labels = useDealLabels();
  const moduleOfDeal = useWorldSelector(selModuleOf);
  const start = useStart();
  const firstRun = start.show;
  const watching = useWatching();

  // ---- the queue (the centre's order; "Later" only reorders, locally) --------------------------
  const [later, setLater] = useState<string[]>([]);
  // On a brand-new wallet the Charter is the first layer; null follows its first open line.
  const [charterStep, setCharterStep] = useState<SetupStep | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const queue = useMemo(() => orderQueue(needs, later), [needs, later]);
  const cur = currentIndex(queue, picked);
  const top = cur >= 0 ? queue[cur] : undefined;
  const topDeal = top && deals ? deals.find((d) => d.id === top.deal_id) : undefined;

  // ---- the route -------------------------------------------------------------------------------
  const [nav, setNav] = useState<Nav>(() => ({ route: parseHash(location.hash).route, dir: 'swap', restore: false, n: 0 }));
  const navRef = useRef(nav);
  navRef.current = nav;
  const route = nav.route;
  // Re-render once a lazily loaded module registers its detail views (the chain needs them).
  useViewLabel(route.level === 'module' ? route.module : route.level === 'deal' && route.from ? route.from.module : 'book', route.level === 'module' ? route.view : route.level === 'deal' ? route.from?.view : undefined);
  const ctx = useMemo<ChainCtx>(() => ({
    dealModule: (ref) => { const d = deals ? resolveDealRef(ref, deals, labels) : undefined; return d ? moduleOfDeal(d) : null; },
    knownView: (m, v) => viewLabel(m, v) !== null,
    knownSheetView: (r) => { const v = sheetViewOf(r); return !v || !!layerOf(r).views?.[v]; },
  }), [deals, labels, moduleOfDeal]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const swapTicket = useRef(0);
  /** The layer a press is waiting on (its code is still arriving): its tab lights now, the old screen stays. */
  const [pending, setPending] = useState<Route | null>(null);
  const memory = useRef(new Map<string, LayerMemory>());
  const layerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scroller = () => stageRef.current?.querySelector<HTMLElement>('.ui-stack-inner') ?? null;
  // The console's own history stack: which entry we are on, and the hash of each entry we wrote.
  const hist = useRef<{ i: number; hashes: string[] }>({ i: 0, hashes: [formatHash(nav.route)] });

  const remember = (focus?: string | null) => {
    const r = navRef.current.route;
    memory.current.set(routeKey(r), { scroll: scroller()?.scrollTop ?? 0, focus: focus !== undefined ? focus : focusKeyOf(document.activeElement) });
  };
  const settle = useCallback((to: Route) => {
    const from = navRef.current.route;
    const c = ctxRef.current;
    const up = !sameLayer(from, to) && isAncestor(to, from, c);
    const dir: Dir = sameLayer(from, to) ? 'swap' : up ? 'out' : chainOf(to, c).length > chainOf(from, c).length ? 'into' : 'swap';
    // Opening or closing a card view keeps the sheet (and its entrance) as it is.
    const sameSheet = mountKey(from) === mountKey(to);
    const commit = () => startTransition(() => { setPending(null); setNav((n) => ({ route: to, dir: sameSheet ? n.dir : dir, restore: up, n: sameLayer(from, to) ? n.n : n.n + 1 })); });
    // The old screen stays up until the next one's code is here (capped), then swaps in one commit; a
    // newer move supersedes a pending one. Code already loaded swaps in the same tick.
    const mine = ++swapTicket.current;
    const part = layerOf(to).component;
    // The press answers on the very frame (the tab / place lights at once) while the code arrives.
    if (isLazyPart(part) && !part.ready()) setPending(to);
    else setPending(null);
    if (isLazyPart(part) && !part.ready()) void whenPartsReady([part], READY_CAP_MS).then(() => { if (swapTicket.current === mine) commit(); });
    else commit();
  }, []);

  /** Go to a layer: a new history entry (or the same one with `replace`). */
  const go = useCallback((to: Route, o: { replace?: boolean; focus?: string | null } = {}) => {
    remember(o.focus);
    const h = formatHash(to);
    const H = hist.current;
    if (o.replace) { history.replaceState({ tc: H.i } satisfies HistState, '', urlOf(h)); H.hashes[H.i] = h; }
    else if (location.hash !== h || h === '') {
      H.hashes = [...H.hashes.slice(0, H.i + 1), h];
      H.i += 1;
      history.pushState({ tc: H.i } satisfies HistState, '', urlOf(h));
    }
    settle(to);
  }, [settle]);

  /** One layer up the chain. When the entry before this one is that layer, the browser steps back
   *  to it, so Back and forward keep walking the same chain. Never leaves the console. */
  const back = useCallback(() => {
    const n = navRef.current;
    const p = parentOf(n.route, ctxRef.current);
    if (!p) return;
    const H = hist.current;
    if (H.i > 0 && H.hashes[H.i - 1] === formatHash(p)) { remember(); history.back(); return; }
    go(p);
  }, [go]);

  // The first entry carries the console's index, so the browser's Back to it is recognised. An old
  // link (a sheet's `#s=settings`, the safety record's `&p=safety`) is rewritten to its layer's form.
  useEffect(() => { history.replaceState({ tc: 0 } satisfies HistState, '', urlOf(formatHash(navRef.current.route))); }, []);
  // Browser Back / forward, and links that set the hash (the Set up note, a page's own link).
  useEffect(() => {
    const on = () => {
      const p = parseHash(location.hash);
      const i = histIndex(history.state);
      const H = hist.current;
      const h = formatHash(p.route);
      if (i !== null) H.i = i;
      // A link that set the hash (both popstate and hashchange report it): one new entry.
      else if (H.hashes[H.i] !== h) { H.hashes = [...H.hashes.slice(0, H.i + 1), h]; H.i += 1; history.replaceState({ tc: H.i } satisfies HistState, '', location.href); }
      const n = navRef.current;
      if (JSON.stringify(n.route) === JSON.stringify(p.route)) return;
      remember();
      settle(p.route);
    };
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hashchange', on); };
  }, [settle]);

  // Focus and scroll after a move (passive, so a closing Find has given its focus back first). A card
  // view opening or closing on the same sheet is the sheet's to focus (frame.tsx): the card that
  // opened it, or the view's heading.
  const key = routeKey(route);
  const sheetKey = mountKey(route);
  const lastSheet = useRef(sheetKey);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const sameSheet = lastSheet.current === sheetKey;
    lastSheet.current = sheetKey;
    if (sameSheet) return;
    const root = layerRef.current;
    if (!root) return;
    return restoreLayer(root, scroller(), navRef.current.restore ? memory.current.get(key) ?? null : null);
  }, [key, sheetKey, nav.n]);

  // ---- overlays -------------------------------------------------------------------------------
  const [pairStart, setPairStart] = useState<PairMode | undefined>(undefined);
  const [find, setFind] = useState(false);
  const [help, setHelp] = useState(false);
  const [quit, setQuit] = useState(false);
  // The app header's brand, status and Find (AppHeader.tsx) announce themselves; this view answers.
  useAppHeaderEvent(APP_FIND_EVENT, useCallback(() => setFind(true), []));
  const [rewindAt, setRewindAt] = useState<number | null>(null);
  const [paidFlash, setPaidFlash] = useState(false);
  useEffect(() => preloadWhenIdle(LATER_PARTS), []);
  useSetupIntent(useCallback((step) => go({ level: 'setup', step }), [go]));

  // ---- navigation helpers ---------------------------------------------------------------------
  const goHome = useCallback(() => { if (navRef.current.route.level !== 'home') go({ level: 'home' }); }, [go]);
  useAppHeaderEvent(APP_BRAND_EVENT, goHome);
  useAppHeaderEvent(APP_STATUS_EVENT, useCallback(() => (queue.length ? go({ level: 'waiting' }) : goHome()), [queue.length, go, goHome]));
  const goModule = useCallback((m: Module) => go({ level: 'module', module: m }), [go]);
  const goDeal = useCallback((id: string) => {
    const r = navRef.current.route;
    go(r.level === 'module' ? { level: 'deal', deal: id, from: r.view && viewLabel(r.module, r.view) ? { module: r.module, view: r.view } : { module: r.module } } : { level: 'deal', deal: id });
  }, [go]);
  const pickNeed = useCallback((id: string) => { setPicked(id); goHome(); }, [goHome]);
  const goRewind = useCallback((at?: number) => { setRewindAt(at ?? null); go({ level: 'rewind' }); }, [go]);
  /** A place from inside a layer: opened from a module page or Settings, Back returns there. */
  const goPlace = useCallback((p: Place, o: { pair?: PairMode } = {}) => {
    setFind(false);
    // The way of connecting is for this open only: a later plain open starts at the desk's default.
    setPairStart(o.pair);
    const from = placeFromRoute(navRef.current.route, p);
    go(from ? { level: 'place', place: p, from } : { level: 'place', place: p });
  }, [go]);
  /** A place from the top bar: always one layer above the centre. */
  const barPlace = useCallback((p: Place) => { setFind(false); go({ level: 'place', place: p }); }, [go]);

  const layerNav = useMemo<LayerNav>(() => ({
    go, back, home: goHome, module: goModule, deal: goDeal, need: pickNeed, place: goPlace, rewind: goRewind,
    setup: (step) => go({ level: 'setup', step: step ?? 'keys' }), quit: () => setQuit(true),
  }), [go, back, goHome, goModule, goDeal, pickNeed, goPlace, goRewind]);

  const onFind = useCallback((t: FindTarget) => {
    switch (t.kind) {
      case 'need': pickNeed(t.deal); break;
      case 'module': goModule(t.module); break;
      case 'deal': goDeal(t.deal); break;
      case 'route': setPairStart(undefined); go(t.route); break;
      case 'setup': go({ level: 'setup', step: t.step }); break;
      case 'quit': setQuit(true); break;
      case 'demo': switchDemo(t.state); break;
    }
  }, [go, goDeal, goModule, pickNeed]);

  // ---- keys -----------------------------------------------------------------------------------
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setFind((f) => !f); return; }
      if (e.key === 'Escape') {
        // Find, confirms and popovers are layers: the layer stack closes them first (capture phase).
        if (layerCount() > 0) return;
        if (typing && (t as HTMLInputElement).value) return;
        e.preventDefault();
        back();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || layerCount() > 0) return;
      if (e.key === '/') { e.preventDefault(); setFind(true); return; }
      if (e.key === '?') { e.preventDefault(); setHelp(true); return; }
      if (/^[1-6]$/.test(e.key)) {
        const m = MODULES[Number(e.key) - 1];
        if (m) { e.preventDefault(); goModule(m.key); }
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [back, goModule]);

  // ---- events (outcomes come only from the wallet) --------------------------------------------
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  useEvent('main:route', (r) => {
    setFind(false);
    if (r.deal_id) go({ level: 'deal', deal: r.deal_id });
    else goHome();
  });
  useEvent('wallet:error', () => toast(<>{WALLET_FAULT_TOAST}</>, 'bad'));
  useEvent('receipt:created', (r) => {
    // Name the deal by what it is (ids belong in Details, UX-GUIDE).
    const d = deals?.find((x) => x.id === r.deal_id);
    const label = d ? shortTitle(displayRef.current(d).title) : A_DEAL;
    // A receipt that is only the seller's word never reads as paid (receiptToast).
    const said = receiptToast(r);
    toast(<>{label} · <b>{said.text}</b> · {silenceWords(r.on_silence)}</>, said.tone);
    if (said.tone === 'ok') {
      setPaidFlash(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setPaidFlash(false), PAID_FLASH_MS);
    }
  });
  const display = useWorldSelector(selDisplay);
  const displayRef = useRef(display);
  displayRef.current = display;

  // ---- what the frame shows -------------------------------------------------------------------
  const chain = chainOf(route, ctx);
  const depth = chain.length;
  const lit = moduleOfRoute(pending ?? route, ctx);
  const tabRow = useRef<HTMLDivElement>(null);
  useTabStop(tabRow, lit);
  const said = presenceOf({ firstRun, top, deal: topDeal, heldAtPayPal: watching.held, moving: watching.moving.length, paidFlash });
  // One object while the seal says the same, so the layers reading it do not redraw for nothing.
  const presence = useMemo(() => ({ state: said.state, word: said.word, line: said.line }), [said.state, said.word, said.line]);
  const centreRoute = route.level === 'home';
  const pile = centreRoute ? Math.min(3, Math.max(0, queue.length - 1)) : depth - 1;
  const def = layerOf(route);
  // Kept-alive layers (heavy preview tabs): once opened they stay mounted behind the front one.
  const [keptIds, setKeptIds] = useState<readonly LayerId[]>([]);
  const keptRoutes = useRef(new Map<LayerId, Route>());
  if (def.keepAlive) {
    const id = layerIdOf(route);
    keptRoutes.current.set(id, route);
    if (!keptIds.includes(id)) setKeptIds([...keptIds, id]);
  }

  const centre = useMemo<CentreProps>(() => ({
    queue, cur, presence, onPick: setPicked, onDeal: goDeal,
    onCycle: (d) => { const i = cycle(cur, d, queue.length); const n = queue[i]; if (n) setPicked(n.deal_id); },
    onLater: () => {
      const t = queue[cur];
      if (!t) return;
      if (queue.length < 2) { toast(LATER_ALONE, 'info'); return; }
      const next = queue[cycle(cur, 1, queue.length)];
      setLater((l) => putOff(l, t.deal_id));
      if (next) setPicked(next.deal_id);
      toast(LATER_TOAST, 'info');
    },
    onWaiting: () => go({ level: 'waiting' }), onRewind: () => goRewind(), onBook: () => goModule('book'),
    onWatch: (id) => { watchTable(id); go({ level: 'module', module: 'tables', view: 'watch' }); },
  }), [queue, cur, presence, goDeal, toast, go, goRewind, goModule]);
  const host = useMemo<CentreHostValue>(() => ({ centre, charterStep, setCharterStep }), [centre, charterStep]);
  const layerState = useMemo<LayerState>(() => ({ rewindAt, pairMode: pairStart, firstRun, presence }), [rewindAt, pairStart, firstRun, presence]);

  const insp = useInspectorHost();
  // The top bar names the current place (the same label as the last crumb); the trail itself is in the content.
  const here = chain.length ? chain[chain.length - 1] : null;
  const litRoute = pending ?? route;
  const placeLit = litRoute.level === 'place' ? litRoute.place : null;
  const placeItem = (p: BarPlace): PlaceItem => ({ id: `cs-place-${p.place}`, label: p.label, title: p.title, lit: !!placeLit && p.lit.includes(placeLit), onPick: () => barPlace(p.place) });
  const placeBy = (k: Place) => BAR_PLACES.filter((b) => b.place === k).map(placeItem);
  const placeGroups: PlaceGroup[] = [
    { key: 'watch', items: [{ id: 'cs-place-rewind', label: PLACE.rewind, title: PLACE_TITLE.rewind, lit: route.level === 'rewind', onPick: () => goRewind() }, ...placeBy('proof')] },
    { key: 'configure', items: [...placeBy('rules'), ...placeBy('connections'), ...placeBy('settings')] },
    { key: 'lab', items: [...placeBy('try'), ...placeBy('director')] },
  ];

  return (
    <div className={`cs-app ui-ground${depth > 1 ? ' deep' : ''}`} inert={find || undefined} onPointerOver={warmOnIntent} onFocus={warmOnIntent} style={{ '--seal': `var(--${SEAL_TONE[presence.state]})` } as CSSProperties}>
      <header className="cs-bar">
        <div className="cs-barl">
          {depth > 1 ? <button type="button" className="cs-back" onClick={back} title={BACK_TITLE}><span aria-hidden="true">‹</span> {DETAIL_BACK}</button> : null}
          {here ? <span className="cs-here" data-testid="cs-here" title={def.title(route)}><CrumbLabel r={here} firstRun={firstRun} /></span> : null}
        </div>
        <div className="cs-tabrow" ref={tabRow}>
          <TabStrip label={TABS_LABEL}>
            {MODULES.map((m, i) => {
              const waiting = queue.filter((n) => n.module === m.key).length;
              const count = !deals ? null : m.key === 'book' ? deals.length : deals.filter((d) => moduleOfDeal(d) === m.key).length;
              return (
                <ModuleTab key={m.key} id={`cs-tab-${m.key}`} active={lit === m.key} onSelect={() => goModule(m.key)} color={m.cssVar} icon={<Glyph module={m.key} />} controls={PANEL_ID}
                  title={tabTitle(m.name, m.long, i + 1)}
                  label={<>{m.name}<span className={`tt${count === null ? ' unknown' : ''}`}>{formatCount(count)}</span>
                    {waiting ? <span className="cnt"><span aria-hidden="true">{formatCount(waiting)}</span><span className="sr-only">{tabWaiting(waiting)}</span></span> : null}</>} />
              );
            })}
          </TabStrip>
        </div>
        <div className="cs-places">
          <PlacesMenu groups={placeGroups} />
          <LockButton />
          <ViewSwitch view="console" />
        </div>
      </header>
      <StaleBanner />
      <InspectorHostProvider value={insp.value}>
        <StaggerProvider>
          <main className={`cs-stage${insp.open ? ' has-insp' : ''}`} ref={stageRef}>
            <Stack label={route.level === 'home' && firstRun ? CHARTER_TITLE : def.title(route)} depth={pile} tone={toneOf(route, lit)} gold={centreRoute && queue.length > 1}
              corner={depth > 1 && !def.ownSeal ? <Seal size="corner" state={presence.state} label={sealLabel(presence.word, presence.line)} ring={SEAL_RING} /> : undefined}>
              {def.keepAlive ? null : (
                <div ref={layerRef} key={sheetKey} id={PANEL_ID} role={lit ? 'tabpanel' : undefined} aria-labelledby={lit ? `cs-tab-${lit}` : undefined} className="cs-layer" data-dir={nav.dir} data-level={route.level} data-layer={layerIdOf(route)} data-fit={def.fit ? '' : undefined}>
                  <CentreHost.Provider value={host}>
                    <LayerHost def={def} route={route} nav={layerNav} state={layerState} resetKey={sheetKey} />
                  </CentreHost.Provider>
                </div>
              )}
              {keptIds.map((id) => {
                const on = def.keepAlive && layerIdOf(route) === id;
                const kdef = LAYERS.get(id);
                const kroute = on ? route : keptRoutes.current.get(id);
                if (!kdef || !kroute) return null;
                return (
                  <div key={`kept:${id}`} ref={on ? layerRef : undefined} id={on ? PANEL_ID : undefined} className="cs-layer" hidden={!on} inert={!on || undefined} data-dir={nav.dir} data-level={kroute.level} data-layer={id} data-fit={kdef.fit ? '' : undefined}>
                    <LayerHost def={kdef} route={kroute} nav={layerNav} state={layerState} resetKey={mountKey(kroute)} active={on} />
                  </div>
                );
              })}
            </Stack>
            <aside className="ui-inspector cs-insp" ref={insp.ref} hidden={!insp.open} aria-label={INSPECTOR_LABEL} />
          </main>
        </StaggerProvider>
      </InspectorHostProvider>
      <Footer onSettings={() => barPlace('settings')} onHelp={() => setHelp(true)} />
      {find ? <Find onClose={() => setFind(false)} onPick={onFind} /> : null}
      {help ? <Shortcuts onClose={() => setHelp(false)} /> : null}
      {quit ? <Suspense fallback={null}><QuitSheet onClose={() => setQuit(false)} /></Suspense> : null}
    </div>
  );
}

/** The sheet's layer: the module tabs' panel (role tabpanel while a module's tab is lit). */
const PANEL_ID = 'cs-panel';

/** The module tabs are one tab stop (a roving tablist): the lit tab, or the first when none is lit
 *  (the centre, a place), so Tab always reaches them; arrows move between them (TabStrip). */
function useTabStop(row: RefObject<HTMLDivElement | null>, lit: Module | null): void {
  useEffect(() => {
    const tabs = Array.from(row.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const stop = (lit ? tabs.find((t) => t.id === `cs-tab-${lit}`) : undefined) ?? tabs[0];
    for (const t of tabs) t.tabIndex = t === stop ? 0 : -1;
  });
}

/** How long the seal reads "Paid" after the wallet reports a payment that went through (as long as its toast). */
export const PAID_FLASH_MS = TOAST_MS;
const selDisplay = (w: World) => w.display;
const SEAL_TONE = { quiet: 'steel', watching: 'teal', needs: 'gold', holding: 'coral', paid: 'ok', stopped: 'red' } as const;

/** Idle-lock state. Locked: a click opens the approval window, where Windows Hello unlocks. When the
 *  window could not open, a toast says so (the centre's gold action shows the same as a notice). */
function LockButton() {
  const locked = useLocked();
  const open = useMutation('approval_open');
  const toast = useToast();
  useEffect(() => {
    if (open.error) toast(<><b>{NOTICE_WHAT.approval}:</b> {open.error.message}</>, 'bad');
  }, [open.error, toast]);
  return (
    <Btn sm className={`lockbtn ${locked ? 'is-locked' : ''}`} data-tour="approval-way" aria-disabled={!locked} onClick={() => { if (locked) void open.run({ deal_id: null }); }}
      title={locked ? LOCK.lockedTitle : LOCK.unlockedTitle}>
      <LockGlyph locked={locked} />{locked ? LOCK.locked : LOCK.unlocked}
    </Btn>
  );
}

