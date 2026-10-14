// The Main window as the Calibre console (rebuild WP2): one front sheet on a stack of layers.
//   1  the decision centre (or, on a brand-new wallet, the Charter)
//   2  the six modules (the tabs on the sheet's top edge), everything waiting, the Rewind, Set up
//   3  a module's detail view, a deal
//   4  a deal opened from a module's detail view
// The route lives in the hash (logic.ts parseHash/formatHash; every older link still parses) and
// the chain of layers is derived from it (route.ts), never from a click history. Esc goes one layer
// up (Find and any sheet or popover close first: they are layers of their own), and the Back button,
// the crumbs and the browser's Back/forward walk the same chain. Going deeper focuses the new layer's
// heading; coming back gives focus and scroll back to where they were left.
// Money: the main window only ever opens the approval window (approval_open). Module and deal views
// are the existing pages, mounted inside this frame until WP3 rebuilds them.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import type { TumblerStatus } from '@bindings/TumblerStatus';
import { useEvent, useMutation, useNow } from '../../../lib/hooks';
import { lazyPart, preloadWhenIdle } from '../../../lib/lazy';
import {
  BACK_TITLE, BRAND_NAME, CHARTER_TITLE, METERS, BRAND_TITLE, CALM, CENTRE_TITLE, CRUMBS_LABEL, DEAL_CRUMB, DEAL_GONE, DEAL_UNREAD, DETAIL_BACK, LOCK, MINI_WINDOW, LATER_ALONE, LATER_TOAST, needPill, needPillLabel, PLACE, PLACE_TITLE, PLACES_LABEL,
  REWIND_TITLE, SAFE_DEFAULT_LINE, SEAL_RING, sealLabel, SETUP_PAGE_TITLE, SHORTCUTS_LABEL, silenceWords, tabTitle, tabWaiting, TABS_LABEL, WAITING_TITLE,
} from '../../../lib/words';
import { formatCount } from '../../../lib/data/counts';
import { readLimits } from '../../../lib/limits';
import { ErrorBoundary } from '../../../shared/boundary';
import { Mark, Seal } from '../../../shared/brand';
import { MockBadge, ModeBadge } from '../../../shared/honesty';
import { Glyph, MODULE, MODULES } from '../../../shared/modules';
import { Btn, Crumbs, InspectorHostProvider, layerCount, ModuleTab, Stack, TabStrip, ThemeSwitch, TOAST_MS, useInspectorHost, useToast } from '../../../shared/ui';
import { DEAL_PARTS, DealView } from '../DealView';
import { shortTitle } from '../home/model';
import { formatHash, parseHash, receiptToast, resolveDealRef, spendToday, type Route, type SetupStep, type SheetTab } from '../logic';
import { MODULE_PAGES, ModuleView } from '../Modules';
import { safetyInHash, withSafety } from '../safety/model';
import { SHEET_TABS, Sheet } from '../Sheet';
import { Charter } from '../setup/Charter';
import type { PairMode } from '../setup/pairing';
import { useSetupIntent, useStart } from '../setup/start';
import { Shortcuts } from '../Shortcuts';
import { StatusChips } from '../Status';
import { LockGlyph, Loading } from '../ui';
import { useViewLabel, viewLabel, type ModuleRoute } from '../viewNav';
import { useAttention, useDealLabels, useDeals, useDisplayOf, useLocked, useNeeds, useSettings, useWorldSelector, type World } from '../world';
import { calmToggled, writeCalm } from './calm';
import { Centre } from './Centre';
import { currentIndex, cycle, orderQueue, presenceOf, putOff } from './centreModel';
import { Find } from './Find';
import type { FindTarget } from './findIndex';
import { useWatching } from './ledger';
import { focusKeyOf, restoreLayer, type LayerMemory } from './memory';
import { REWIND_PARTS, RewindLayer } from './RewindLayer';
import { chainOf, isAncestor, moduleOfRoute, parentOf, routeKey, sameLayer, type ChainCtx } from './route';
import { StaleBanner } from './StaleBanner';
import { Waiting } from './Waiting';
import './console.css';
import './find.css';
import '../quit.css';

const QuitSheet = lazyPart(() => import('../QuitSheet').then((m) => m.QuitSheet));
const SafetySheet = lazyPart(() => import('../safety/SafetySheet').then((m) => m.SafetySheet));
const LATER_PARTS = [...MODULE_PAGES, ...DEAL_PARTS, ...SHEET_TABS, ...REWIND_PARTS, QuitSheet, SafetySheet];

type Dir = 'into' | 'out' | 'swap';
type Nav = { route: Route; sheet: SheetTab | null; safety: boolean; dir: Dir; restore: boolean; n: number };
/** What the console keeps in each history entry it writes: its place in the console's own stack. */
type HistState = { tc: number };

const selModuleOf = (w: World) => w.moduleOfDeal;
const urlOf = (h: string) => `${location.pathname}${location.search}${h}`;
const histIndex = (s: unknown): number | null => (s && typeof s === 'object' && typeof (s as HistState).tc === 'number' ? (s as HistState).tc : null);

/** The console's colour per layer (a module's colour on its own layers). */
function toneOf(r: Route, m: Module | null): string {
  if (m) return MODULE[m].cssVar;
  if (r.level === 'home' || r.level === 'waiting') return 'var(--gold)';
  if (r.level === 'rewind') return 'var(--teal)';
  return 'var(--steel)';
}

export function Console() {
  const toast = useToast();
  const needs = useNeeds();
  const dealsQ = useDeals();
  const deals = dealsQ.data;
  const labels = useDealLabels();
  const moduleOfDeal = useWorldSelector(selModuleOf);
  const settings = useSettings().data;
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
  const [nav, setNav] = useState<Nav>(() => {
    const p = parseHash(location.hash);
    return { route: p.route, sheet: p.sheet, safety: safetyInHash(location.hash), dir: 'swap', restore: false, n: 0 };
  });
  const navRef = useRef(nav);
  navRef.current = nav;
  const route = nav.route;
  // Re-render once a lazily loaded module registers its detail views (the chain needs them).
  useViewLabel(route.level === 'module' ? route.module : route.level === 'deal' && route.from ? route.from.module : 'book', route.level === 'module' ? route.view : route.level === 'deal' ? route.from?.view : undefined);
  const ctx = useMemo<ChainCtx>(() => ({
    dealModule: (ref) => { const d = deals ? resolveDealRef(ref, deals, labels) : undefined; return d ? moduleOfDeal(d) : null; },
    knownView: (m, v) => viewLabel(m, v) !== null,
  }), [deals, labels, moduleOfDeal]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const memory = useRef(new Map<string, LayerMemory>());
  const layerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scroller = () => stageRef.current?.querySelector<HTMLElement>('.ui-stack-inner') ?? null;
  // The console's own history stack: which entry we are on, and the hash of each entry we wrote.
  const hist = useRef<{ i: number; hashes: string[] }>({ i: 0, hashes: [formatHash(nav.route, null)] });

  const remember = (focus?: string | null) => {
    const r = navRef.current.route;
    memory.current.set(routeKey(r), { scroll: scroller()?.scrollTop ?? 0, focus: focus !== undefined ? focus : focusKeyOf(document.activeElement) });
  };
  const settle = useCallback((to: Route, sheet: SheetTab | null, safety: boolean) => {
    const from = navRef.current.route;
    const c = ctxRef.current;
    const up = !sameLayer(from, to) && isAncestor(to, from, c);
    const dir: Dir = sameLayer(from, to) ? 'swap' : up ? 'out' : chainOf(to, c).length > chainOf(from, c).length ? 'into' : 'swap';
    setNav((n) => ({ route: to, sheet, safety, dir, restore: up, n: sameLayer(from, to) ? n.n : n.n + 1 }));
  }, []);

  /** Go to a layer: a new history entry (or the same one with `replace`). Closes any sheet. */
  const go = useCallback((to: Route, o: { replace?: boolean; focus?: string | null } = {}) => {
    remember(o.focus);
    const h = formatHash(to, null);
    const H = hist.current;
    if (o.replace) { history.replaceState({ tc: H.i } satisfies HistState, '', urlOf(h)); H.hashes[H.i] = h; }
    else if (location.hash !== h || h === '') {
      H.hashes = [...H.hashes.slice(0, H.i + 1), h];
      H.i += 1;
      history.pushState({ tc: H.i } satisfies HistState, '', urlOf(h));
    }
    settle(to, null, false);
  }, [settle]);

  /** One layer up the chain. When the entry before this one is that layer, the browser steps back
   *  to it, so Back and forward keep walking the same chain. Never leaves the console. */
  const back = useCallback(() => {
    const n = navRef.current;
    if (n.sheet || n.safety) { setNav((x) => ({ ...x, sheet: null, safety: false })); return; }
    const p = parentOf(n.route, ctxRef.current);
    if (!p) return;
    const H = hist.current;
    if (H.i > 0 && H.hashes[H.i - 1] === formatHash(p, null)) { remember(); history.back(); return; }
    go(p);
  }, [go]);

  // The first entry carries the console's index, so the browser's Back to it is recognised.
  useEffect(() => { history.replaceState({ tc: 0 } satisfies HistState, '', location.href); }, []);
  // Browser Back / forward, and links that set the hash (the Set up note, a sheet's own link).
  useEffect(() => {
    const on = () => {
      const p = parseHash(location.hash);
      const i = histIndex(history.state);
      const H = hist.current;
      const h = formatHash(p.route, null);
      if (i !== null) H.i = i;
      // A link that set the hash (both popstate and hashchange report it): one new entry.
      else if (H.hashes[H.i] !== h) { H.hashes = [...H.hashes.slice(0, H.i + 1), h]; H.i += 1; history.replaceState({ tc: H.i } satisfies HistState, '', location.href); }
      const n = navRef.current;
      if (sameLayer(n.route, p.route) && JSON.stringify(n.route) === JSON.stringify(p.route) && n.sheet === p.sheet && n.safety === safetyInHash(location.hash)) return;
      remember();
      settle(p.route, p.sheet, safetyInHash(location.hash));
    };
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hashchange', on); };
  }, [settle]);
  // A sheet or the safety record over the layer: the same entry, its hash updated.
  useEffect(() => {
    const h = withSafety(formatHash(nav.route, nav.sheet), nav.safety);
    if (location.hash !== h && !(h === '' && location.hash === '')) history.replaceState(history.state, '', urlOf(h));
  }, [nav.route, nav.sheet, nav.safety]);

  // Focus and scroll after a move (passive, so a closing Find has given its focus back first).
  const key = routeKey(route);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const root = layerRef.current;
    if (!root) return;
    return restoreLayer(root, scroller(), navRef.current.restore ? memory.current.get(key) ?? null : null);
  }, [key, nav.n]);

  // ---- overlays -------------------------------------------------------------------------------
  const [pairStart, setPairStart] = useState<PairMode | undefined>(undefined);
  const [find, setFind] = useState(false);
  const [help, setHelp] = useState(false);
  const [quit, setQuit] = useState(false);
  const [rewindAt, setRewindAt] = useState<number | null>(null);
  const [tumbler, setTumbler] = useState<TumblerStatus | null>(null);
  const [paidFlash, setPaidFlash] = useState(false);
  const openSheet = useCallback((t: SheetTab, pair?: PairMode) => { setFind(false); setPairStart(pair); setNav((n) => ({ ...n, sheet: t })); }, []);
  const openSafety = useCallback(() => { setFind(false); setNav((n) => ({ ...n, safety: true })); }, []);
  useEffect(() => preloadWhenIdle(LATER_PARTS), []);
  useSetupIntent(useCallback((step) => go({ level: 'setup', step }), [go]));

  // ---- navigation helpers ---------------------------------------------------------------------
  const goHome = useCallback(() => { if (navRef.current.route.level !== 'home') go({ level: 'home' }); }, [go]);
  const goModule = useCallback((m: Module) => go({ level: 'module', module: m }), [go]);
  const goDeal = useCallback((id: string) => {
    const r = navRef.current.route;
    go(r.level === 'module' ? { level: 'deal', deal: id, from: r.view && viewLabel(r.module, r.view) ? { module: r.module, view: r.view } : { module: r.module } } : { level: 'deal', deal: id });
  }, [go]);
  const pickNeed = useCallback((id: string) => { setPicked(id); goHome(); }, [goHome]);
  const goRewind = useCallback((at?: number) => { setRewindAt(at ?? null); go({ level: 'rewind' }); }, [go]);

  const onFind = useCallback((t: FindTarget) => {
    switch (t.kind) {
      case 'need': pickNeed(t.deal); break;
      case 'module': goModule(t.module); break;
      case 'deal': goDeal(t.deal); break;
      case 'route': go(t.route); break;
      case 'setup': go({ level: 'setup', step: t.step }); break;
      case 'sheet': openSheet(t.tab); break;
      case 'safety': openSafety(); break;
      case 'quit': setQuit(true); break;
    }
  }, [go, goDeal, goModule, openSafety, openSheet, pickNeed]);

  // ---- keys -----------------------------------------------------------------------------------
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setFind((f) => !f); return; }
      if (e.key === 'Escape') {
        // Find, sheets and popovers are layers: the layer stack closes them first (capture phase).
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
    setNav((n) => ({ ...n, sheet: null, safety: false }));
    if (r.deal_id) go({ level: 'deal', deal: r.deal_id });
    else goHome();
  });
  useEvent('tumbler:status', (s) => setTumbler(s));
  useEvent('wallet:error', (e) => toast(<>{e.message}</>, 'bad'));
  useEvent('receipt:created', (r) => {
    // Name the deal by what it is (ids belong in Details, UX-GUIDE).
    const d = deals?.find((x) => x.id === r.deal_id);
    const label = d ? shortTitle(displayRef.current(d).title) : 'A deal';
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
  const lit = moduleOfRoute(route, ctx);
  const presence = presenceOf({ firstRun, top, deal: topDeal, heldAtPayPal: watching.held, moving: watching.moving.length, paidFlash });
  const centreRoute = route.level === 'home';
  const pile = centreRoute ? Math.min(3, Math.max(0, queue.length - 1)) : depth - 1;
  const moduleRoute = useMemo<ModuleRoute>(() => ({
    view: route.level === 'module' ? route.view ?? null : null,
    open: (view, cardId) => {
      const r = navRef.current.route;
      if (r.level !== 'module') return;
      if (view) go({ level: 'module', module: r.module, view }, { focus: cardId ? `card:${cardId}` : undefined });
      else back();
    },
  }), [route, go, back]);
  const moduleNav = useMemo(() => ({ onDeal: goDeal, onSheet: openSheet, onSafety: openSafety }), [goDeal, openSheet, openSafety]);

  let content: ReactNode;
  switch (route.level) {
    case 'home':
      content = firstRun
        ? <Charter root step={charterStep} onStep={setCharterStep} onDone={() => setCharterStep(null)} />
        : <Centre queue={queue} cur={cur} presence={presence} onPick={setPicked} onDeal={goDeal}
          onCycle={(d) => { const i = cycle(cur, d, queue.length); const n = queue[i]; if (n) setPicked(n.deal_id); }}
          onLater={() => {
            if (!top) return;
            if (queue.length < 2) { toast(LATER_ALONE, 'info'); return; }
            const next = queue[cycle(cur, 1, queue.length)];
            setLater((l) => putOff(l, top.deal_id));
            if (next) setPicked(next.deal_id);
            toast(LATER_TOAST, 'info');
          }}
          onWaiting={() => go({ level: 'waiting' })} onRewind={() => goRewind()} onBook={() => goModule('book')} />;
      break;
    case 'module':
      content = <ModuleView module={route.module} route={moduleRoute} nav={moduleNav} />;
      break;
    case 'deal':
      content = <DealLayer dealRef={route.deal} onHome={goHome} onModule={goModule} />;
      break;
    case 'setup':
      content = <Charter step={route.step ?? null} onStep={(s) => go({ level: 'setup', step: s }, { replace: true })} onDone={goHome} />;
      break;
    case 'waiting':
      content = <Waiting queue={queue} module={route.module} onPick={pickNeed} onFilter={(m) => go(m ? { level: 'waiting', module: m } : { level: 'waiting' }, { replace: true })} />;
      break;
    case 'rewind':
      content = <RewindLayer at={rewindAt} onDeal={goDeal} onExit={back} />;
      break;
  }

  const insp = useInspectorHost();
  // A crumb goes to that layer; the one just above is the same as Back.
  const crumbs = chain.map((r, i) => ({ label: <CrumbLabel r={r} firstRun={firstRun} />, onClick: i === chain.length - 2 ? back : i < chain.length - 2 ? () => go(r) : undefined }));

  return (
    <div className={`cs-app${depth > 1 ? ' deep' : ''}`} inert={find || undefined} style={{ '--seal': `var(--${SEAL_TONE[presence.state]})` } as CSSProperties}>
      <header className="cs-bar">
        <div className="cs-barl">
          <button type="button" className="cs-brand" onClick={goHome} title={BRAND_TITLE} aria-label={BRAND_TITLE}><Mark /><span>{BRAND_NAME}</span></button>
          {depth > 1 ? <button type="button" className="cs-back" onClick={back} title={BACK_TITLE}><span aria-hidden="true">‹</span> {DETAIL_BACK}</button> : null}
          <Crumbs items={crumbs} label={CRUMBS_LABEL} depth={depth} />
        </div>
        <nav className="cs-places" aria-label={PLACES_LABEL}>
          <button type="button" id="cs-needpill" className={`cs-needpill${queue.length ? '' : ' zero'}`} aria-label={needPillLabel(queue.length)}
            onClick={() => (queue.length ? go({ level: 'waiting' }) : goHome())}>{needPill(queue.length)}</button>
          <button type="button" id="cs-place-rewind" className={`cs-place${route.level === 'rewind' ? ' on' : ''}`} onClick={() => goRewind()} title={PLACE_TITLE.rewind}>{PLACE.rewind}</button>
          <button type="button" className={`cs-place${nav.sheet === 'mandates' ? ' on' : ''}`} onClick={() => openSheet('mandates')} title={PLACE_TITLE.rules}>{PLACE.rules}</button>
          <button type="button" className={`cs-place${nav.sheet === 'pairing' ? ' on' : ''}`} onClick={() => openSheet('pairing')} title={PLACE_TITLE.connections}>{PLACE.connections}</button>
          <button type="button" className={`cs-place${nav.sheet === 'settings' ? ' on' : ''}`} onClick={() => openSheet('settings')} title={PLACE_TITLE.settings}>{PLACE.settings}</button>
          <button type="button" className="cs-place" onClick={() => setFind(true)} title={PLACE_TITLE.find}>{PLACE.find} <kbd>/</kbd></button>
          <LockButton />
        </nav>
      </header>
      <StaleBanner />
      <InspectorHostProvider value={insp.value}>
        <main className={`cs-stage${insp.open ? ' has-insp' : ''}`} ref={stageRef}>
          <Stack label={route.level === 'home' && firstRun ? CHARTER_TITLE : layerName(route)} depth={pile} tone={toneOf(route, lit)} gold={centreRoute && queue.length > 1}
            corner={depth > 1 ? <Seal size="corner" state={presence.state} label={sealLabel(presence.word, presence.line)} ring={SEAL_RING} /> : undefined}
            tabs={(
              <div className="cs-tabrow">
                <TabStrip label={TABS_LABEL}>
                  {MODULES.map((m, i) => {
                    const waiting = queue.filter((n) => n.module === m.key).length;
                    const count = !deals ? null : m.key === 'book' ? deals.length : deals.filter((d) => moduleOfDeal(d) === m.key).length;
                    return (
                      <ModuleTab key={m.key} id={`cs-tab-${m.key}`} active={lit === m.key} onSelect={() => goModule(m.key)} color={m.cssVar} icon={<Glyph module={m.key} />}
                        title={tabTitle(m.name, m.long, i + 1)}
                        label={<>{m.name}<span className={`tt${count === null ? ' unknown' : ''}`}>{formatCount(count)}</span>
                          {waiting ? <span className="cnt"><span aria-hidden="true">{formatCount(waiting)}</span><span className="sr-only">{tabWaiting(waiting)}</span></span> : null}</>} />
                    );
                  })}
                </TabStrip>
                <p className="cs-presence" aria-live="polite"><b>{presence.word}</b> · {presence.line}</p>
              </div>
            )}>
            <div ref={layerRef} key={key} className="cs-layer" data-dir={nav.dir} data-level={route.level}>
              <ErrorBoundary layer="view" resetKeys={[key]}>{content}</ErrorBoundary>
            </div>
          </Stack>
          <aside className="ui-inspector cs-insp" ref={insp.ref} hidden={!insp.open} aria-label="Details" />
        </main>
      </InspectorHostProvider>
      <footer className="cs-foot">
        {settings ? <ModeBadge mode={settings.mode} /> : null}
        <MockBadge />
        <StatusChips onSettings={() => openSheet('settings')} />
        <TodayMeters />
        <span className="ui-spacer" />
        <span className="cs-promise"><Hourglass />{SAFE_DEFAULT_LINE}</span>
        <span className="ui-spacer" />
        <TumblerPill status={tumbler} />
        <CalmToggle />
        <ThemeSwitch className="cs-theme" />
        <button type="button" className="cs-help" onClick={() => setHelp(true)} aria-label={SHORTCUTS_LABEL} title={`${SHORTCUTS_LABEL} (?)`}>?</button>
        <Clock />
      </footer>
      {nav.sheet ? <Sheet tab={nav.sheet} pair={pairStart} onTab={(t) => setNav((n) => ({ ...n, sheet: t }))} onClose={() => setNav((n) => ({ ...n, sheet: null }))} /> : null}
      {nav.safety ? <Suspense fallback={null}><SafetySheet onClose={() => setNav((n) => ({ ...n, safety: false }))} onDeal={(id) => goDeal(id)} /></Suspense> : null}
      {find ? <Find onClose={() => setFind(false)} onPick={onFind} /> : null}
      {help ? <Shortcuts onClose={() => setHelp(false)} /> : null}
      {quit ? <Suspense fallback={null}><QuitSheet onClose={() => setQuit(false)} /></Suspense> : null}
    </div>
  );
}

/** How long the seal reads "Paid" after the wallet reports a payment that went through (as long as its toast). */
export const PAID_FLASH_MS = TOAST_MS;
const selDisplay = (w: World) => w.display;
const SEAL_TONE = { quiet: 'steel', watching: 'teal', needs: 'gold', holding: 'coral', paid: 'ok', stopped: 'red' } as const;

/** The layer's name for assistive tech (the sheet is a region). */
function layerName(r: Route): string {
  switch (r.level) {
    case 'home': return CENTRE_TITLE;
    case 'module': return MODULE[r.module].name;
    case 'deal': return DEAL_CRUMB;
    case 'setup': return SETUP_PAGE_TITLE;
    case 'waiting': return WAITING_TITLE;
    case 'rewind': return REWIND_TITLE;
  }
}

function CrumbLabel({ r, firstRun }: { r: Route; firstRun: boolean }) {
  const deals = useDeals().data;
  const labels = useDealLabels();
  const id = r.level === 'deal' && deals ? resolveDealRef(r.deal, deals, labels)?.id : undefined;
  const disp = useDisplayOf(id);
  const view = useViewLabel(r.level === 'module' ? r.module : 'book', r.level === 'module' ? r.view : undefined);
  switch (r.level) {
    case 'home': return <>{firstRun ? CHARTER_TITLE : CENTRE_TITLE}</>;
    case 'module': return <>{view ?? MODULE[r.module].name}</>;
    case 'deal': return <>{disp ? shortTitle(disp.title) : DEAL_CRUMB}</>;
    case 'setup': return <>{SETUP_PAGE_TITLE}</>;
    case 'waiting': return <>{WAITING_TITLE}</>;
    case 'rewind': return <>{REWIND_TITLE}</>;
  }
}

/** A deal page (the existing view), or why it cannot show. */
function DealLayer({ dealRef, onHome }: { dealRef: string; onHome: () => void; onModule: (m: Module) => void }) {
  const q = useDeals();
  const labels = useDealLabels();
  const ready = useWorldSelector(selDisplaysReady);
  const deals = q.data;
  const deal = deals ? resolveDealRef(dealRef, deals, labels) : undefined;
  if (deal) return <DealView deal={deal} />;
  if (q.error) return <div className="empty">{DEAL_UNREAD}</div>;
  if (!deals || (!ready && !deals.some((d) => d.id === dealRef))) return <Loading what="the deal" />;
  return <div className="empty">{DEAL_GONE.text} <button type="button" className="linkbtn" onClick={onHome}>{DEAL_GONE.back}</button></div>;
}
const selDisplaysReady = (w: World) => w.displaysReady;

/** Idle-lock state. Locked: a click opens the approval window, where Windows Hello unlocks. */
function LockButton() {
  const locked = useLocked();
  const open = useMutation('approval_open');
  return (
    <Btn sm className={`lockbtn ${locked ? 'is-locked' : ''}`} data-tour="approval-way" aria-disabled={!locked} onClick={() => { if (locked) void open.run({ deal_id: null }); }}
      title={locked ? LOCK.lockedTitle : LOCK.unlockedTitle}>
      <LockGlyph locked={locked} />{locked ? LOCK.locked : LOCK.unlocked}
    </Btn>
  );
}

/** Today's two meters, never one axis: money your agents paid out against the signed wallet limit
 *  (or what they committed), and the agent app's own estimate of its AI usage (never a bill). */
function TodayMeters() {
  const settings = useSettings().data;
  const att = useAttention().data;
  if (!settings) return null;
  if (!(settings.meters_available || att?.exposure) || !att) return <span className="cs-chip dashed" title={METERS.noneTitle}>{METERS.none}</span>;
  const out = readLimits(att.exposure)?.meters.find((m) => m.key === 'out');
  const sp = spendToday(att.wallet_spend_today_minor, att.wallet_spend_today_currency);
  return (
    <>
      {out ? (
        <span className={`tb-meter${out.near ? ' near' : ''}`} title={out.why}><b>{out.value}</b><span>{METERS.paidOut}{out.of ? ` · ${out.of}` : ''}</span></span>
      ) : (
        <span className={`tb-meter ${sp.exact ? '' : 'unknown'}`} title={sp.why ?? METERS.spentTitle}><b>{sp.text}</b><span>{METERS.spent}</span></span>
      )}
      {settings.meters_available ? (
        <span className="tb-meter eng" title={METERS.aiTitle}><b>~${att.engine_estimate_today_usd.toFixed(2)}</b><span>{METERS.ai}</span></span>
      ) : null}
    </>
  );
}

function TumblerPill({ status }: { status: TumblerStatus | null }) {
  if (!status) return null;
  return (
    <span className={`cs-chip ${status.visible ? '' : 'dashed'}`} title={MINI_WINDOW.title}>
      {MINI_WINDOW.name} · {status.visible ? MINI_WINDOW.shown : MINI_WINDOW.hidden}{status.count ? <> · <b>{status.count}</b> {MINI_WINDOW.waiting}</> : null}
    </span>
  );
}

function CalmToggle() {
  const [on, setOn] = useState(calmToggled);
  return (
    <button type="button" className="cs-chip cs-calm" aria-pressed={on} title={CALM.title} onClick={() => { writeCalm(!on); setOn(!on); }}>
      {CALM.label}
    </button>
  );
}

function Clock() {
  const now = useNow();
  const d = new Date(now * 1000);
  return <span className="cs-clk">{d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>;
}

function Hourglass() {
  return <svg viewBox="0 0 12 14" aria-hidden="true" focusable="false"><path d="M2 1h8M2 13h8M3 1c0 4 6 4 6 6s-6 2-6 6M9 1c0 4-6 4-6 6s6 2 6 6" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>;
}
