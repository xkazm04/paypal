// The Main window of The Table: Layer 0 (the Dial), Layer 1 (six modules), Layer 2 (deal detail),
// plus the owner configuration sheet and Ctrl K find. Routing follows both the `main:route` event
// and location.hash (#m=<module>, #d=<deal id or label>, #s=<sheet>).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Module } from '@bindings/Module';
import type { TumblerStatus } from '@bindings/TumblerStatus';
import { useEvent } from '../../lib/hooks';
import { MODULE, MODULES } from '../../shared/modules';
import { layerCount, useLayerCount } from '../../shared/ui/layers';
import { DealView } from './DealView';
import { Home } from './Home';
import { shortTitle } from './home/model';
import { formatHash, parseHash, resolveDealRef, stateLabel, type Route, type SheetTab } from './logic';
import { ModuleView } from './Modules';
import { Palette } from './Palette';
import { QuitSheet } from './QuitSheet';
import { Shell, type Crumb } from './Shell';
import { Sheet } from './Sheet';
import type { PairMode } from './setup/pairing';
import { Shortcuts } from './Shortcuts';
import { CounterpartyProvider, Loading, ToastProvider, useToast } from './ui';
import { useWorld, WorldProvider } from './world';
import { silenceWords } from '../../lib/words';

export function App() {
  return (
    <ToastProvider>
      <WorldProvider>
        <CounterpartyProvider>
          <Main />
        </CounterpartyProvider>
      </WorldProvider>
    </ToastProvider>
  );
}

function Main() {
  const w = useWorld();
  const toast = useToast();
  const initial = useMemo(() => parseHash(location.hash), []);
  const [route, setRoute] = useState<Route>(initial.route);
  const [sheet, setSheet] = useState<SheetTab | null>(initial.sheet);
  // Connections can open on a way of connecting (first run: the house seller's tab).
  const [pairStart, setPairStart] = useState<PairMode | undefined>(undefined);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [quit, setQuit] = useState(false);
  const [returned, setReturned] = useState<{ module: Module; n: number } | null>(null);
  const [tumbler, setTumbler] = useState<TumblerStatus | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  // Open Layer-2 surfaces (src/shared/ui Sheet / Popover / Inspector with a close / Confirm). The
  // layer stack consumes Esc first (window capture phase), so the Esc handler below only runs when
  // none is open; page keys (1-6 here, arrows/Enter/1-6 on Home) pause while one is open.
  const layers = useLayerCount();

  const deals = w.deals.data;
  const deal = route.level === 'deal' && deals ? resolveDealRef(route.deal, deals, w.labels) : undefined;
  const currentModule: Module | null = route.level === 'module' ? route.module : deal ? w.moduleOfDeal(deal) : null;

  // ---- hash <-> route -------------------------------------------------------------------------
  useEffect(() => {
    const h = formatHash(route, sheet);
    if (location.hash !== h) history.replaceState(null, '', `${location.pathname}${location.search}${h}`);
  }, [route, sheet]);
  useEffect(() => {
    const on = () => { const p = parseHash(location.hash); setRoute(p.route); setSheet(p.sheet); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // ---- navigation -----------------------------------------------------------------------------
  const goHome = useCallback(() => {
    const r = routeRef.current;
    if (r.level === 'home') return;
    const m = r.level === 'module' ? r.module : currentModule ?? 'tables';
    setReturned((x) => ({ module: m, n: (x?.n ?? 0) + 1 }));
    setRoute({ level: 'home' });
  }, [currentModule]);
  const goModule = useCallback((m: Module) => { setRoute({ level: 'module', module: m }); }, []);
  const goDeal = useCallback((id: string) => { setRoute({ level: 'deal', deal: id }); }, []);
  const openSheet = useCallback((t: SheetTab, pair?: PairMode) => { setPalette(false); setPairStart(pair); setSheet(t); }, []);

  const back = useCallback(() => {
    if (palette) { setPalette(false); return; }
    if (sheet) { setSheet(null); return; }
    const r = routeRef.current;
    if (r.level === 'deal') { setRoute(currentModule ? { level: 'module', module: currentModule } : { level: 'home' }); return; }
    if (r.level === 'module') goHome();
  }, [palette, sheet, currentModule, goHome]);

  // Global keys: Ctrl K find, Esc back one level, 1-6 jump between modules inside the app.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (e.key === 'Escape') {
        if (palette || sheet || routeRef.current.level !== 'home') { e.preventDefault(); back(); }
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey && layerCount() === 0) { e.preventDefault(); setHelp(true); return; }
      if (!palette && !sheet && layerCount() === 0 && routeRef.current.level !== 'home' && /^[1-6]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const m = MODULES[Number(e.key) - 1];
        if (m) goModule(m.key);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [palette, sheet, back, goModule]);

  // ---- events ----------------------------------------------------------------------------------
  useEvent('main:route', (r) => {
    setPalette(false);
    setSheet(null);
    if (r.deal_id) goDeal(r.deal_id);
    else goHome();
  });
  useEvent('tumbler:status', (s) => setTumbler(s));
  useEvent('wallet:error', (e) => toast(<>{e.message}</>, 'bad'));
  useEvent('receipt:created', (r) => {
    // Name the deal by what it is (ids belong in Details, UX-GUIDE).
    const deal = w.deals.data?.find((d) => d.id === r.deal_id);
    const label = deal ? shortTitle(w.display(deal).title) : 'A deal';
    toast(<>{label} · <b>{stateLabel(r.state)}</b> · {silenceWords(r.on_silence)}</>, r.state === 'CAPTURED' || r.state === 'RECEIPTED' ? 'ok' : 'info');
  });

  // ---- layers ----------------------------------------------------------------------------------
  let layer = null;
  if (route.level === 'module') {
    layer = (
      <Shell module={route.module} crumbs={[{ label: MODULE[route.module].name }]} onHome={goHome} onModule={goModule} onSheet={openSheet} onFind={() => setPalette(true)} tumbler={tumbler}>
        <ModuleView module={route.module} nav={{ onDeal: goDeal, onSheet: openSheet }} />
      </Shell>
    );
  } else if (route.level === 'deal') {
    const m = currentModule ?? 'book';
    // the deal by its title (UX-GUIDE: ids live in Details)
    const disp = deal ? w.display(deal) : null;
    const crumbs: Crumb[] = [{ label: MODULE[m].name, onClick: () => goModule(m) }, { label: disp ? disp.title : 'Deal' }];
    layer = (
      <Shell module={m} crumbs={crumbs} onHome={goHome} onModule={goModule} onSheet={openSheet} onFind={() => setPalette(true)} tumbler={tumbler}>
        {deal ? <DealView deal={deal} onModule={() => goModule(m)} />
          : w.deals.error ? <div className="empty">Your deals couldn’t be loaded right now. Nothing has changed with your money.</div>
            : !deals ? <Loading what="the deal" />
              : <div className="empty">This deal isn’t here (<span className="mono">{route.deal}</span>). <button className="linkbtn" onClick={goHome}>Back to The Table</button></div>}
      </Shell>
    );
  }

  return (
    <>
      <Home active={route.level === 'home'} returnedFrom={returned} keysEnabled={!sheet && !palette && layers === 0} tumbler={tumbler}
        onOpenModule={goModule} onOpenDeal={goDeal} onOpenSheet={openSheet} onFind={() => setPalette(true)}
        skipIntro={initial.route.level !== 'home' || initial.sheet !== null} />
      {layer}
      {sheet ? <Sheet tab={sheet} pair={pairStart} onTab={setSheet} onClose={() => setSheet(null)} /> : null}
      {palette ? <Palette onClose={() => setPalette(false)} onModule={goModule} onDeal={goDeal} onSheet={openSheet} onQuit={() => setQuit(true)} /> : null}
      {help ? <Shortcuts onClose={() => setHelp(false)} /> : null}
      {quit ? <QuitSheet onClose={() => setQuit(false)} /> : null}
    </>
  );
}
