// Interim layer bodies (rebuild WP2.5): the existing pages, mounted as layers of the console until
// each WP3 area replaces its own. An area file under console/layers/ points its `component` here;
// the WP3 builder of that area points it at the new page instead (no edit to this file is needed,
// and none should be made: it is shared). The Director deletes this file once no area imports it.
//
// What moved here from the old Sheet and Safety sheet: Settings (the Circuit checklist), Connections
// and the pairing desk, Agent rules, and the safety record, each now a layer with a heading of its
// own (focus lands there going in; Back, Escape and the crumbs are the console's). Everything
// privileged still only hands off to the approval window (Handoff -> approval_open).
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '../../../lib/hooks';
import { lazyPart } from '../../../lib/lazy';
import { backend } from '../../../lib/runtime';
import { readLimits } from '../../../lib/limits';
import {
  CHARTER_OPEN, DEAL_GONE, DEAL_UNREAD, LIMIT_WORDS, LIMITS_LAYER, PLACE_NAME, SAFETY_LAYER, SEAL_RING, sealLabel, SETUP_SETTINGS_LINK, WALLET_LIMITS_ABOUT,
} from '../../../lib/words';
import { Seal } from '../../../shared/brand';
import { ModeBadge, WalletNotice } from '../../../shared/honesty';
import { Btn, Chip, DetailToggle, Meter, Silence, useDetail } from '../../../shared/ui';
import { DealView } from '../DealView';
import { placeOfSheet, resolveDealRef, type Place } from '../logic';
import { ModuleView } from '../Modules';
import { SafetyView } from '../safety/SafetySheet';
import { SetupCircuit } from '../setup/CircuitView';
import { Charter } from '../setup/Charter';
import { Handoff } from '../setup/common';
import { MandatesList } from '../setup/Mandates';
import { PairingDesk } from '../setup/PairingDesk';
import type { PairMode } from '../setup/pairing';
import { Loading } from '../ui';
import { useModuleRoute } from '../viewNav';
import { useAttention, useDealLabels, useDeals, useLocked, useSettings, useWorld, useWorldSelector, type World } from '../world';
import type { LayerProps } from './layers';
import { RewindLayer } from './RewindLayer';
import '../../../shared/ownerKey.css';
import '../setup/setup.css';

/** The framework's worked example (console/examples), in the browser preview only. */
const ModuleExample = lazyPart<LayerProps>(() => import('./examples/ModuleExample').then((m) => m.ModuleExample));
const showExample = (): boolean => backend().kind === 'mock' && new URLSearchParams(location.search).has('framework-example');

/** A module's existing page (modules/<name>.tsx through Modules.tsx). */
export function LegacyModuleLayer(p: LayerProps) {
  const { route, nav } = p;
  const moduleRoute = useModuleRoute();
  const moduleNav = useMemo(() => ({ onDeal: nav.deal, onSheet: (t: Parameters<typeof placeOfSheet>[0]) => nav.place(placeOfSheet(t)), onSafety: () => nav.place('safety') }), [nav]);
  if (route.level !== 'module') return null;
  if (showExample()) return <ModuleExample {...p} />;
  return <ModuleView module={route.module} route={moduleRoute} nav={moduleNav} />;
}

const selDisplaysReady = (w: World) => w.displaysReady;

/** A deal page (the existing view), or why it cannot show. */
export function LegacyDealLayer({ route, nav }: LayerProps) {
  const q = useDeals();
  const labels = useDealLabels();
  const ready = useWorldSelector(selDisplaysReady);
  if (route.level !== 'deal') return null;
  const deals = q.data;
  const deal = deals ? resolveDealRef(route.deal, deals, labels) : undefined;
  if (deal) return <DealView deal={deal} />;
  if (q.error) return <div className="empty">{DEAL_UNREAD}</div>;
  if (!deals || (!ready && !deals.some((d) => d.id === route.deal))) return <Loading what="the deal" />;
  return <div className="empty">{DEAL_GONE.text} <button type="button" className="linkbtn" onClick={nav.home}>{DEAL_GONE.back}</button></div>;
}

/** The Rewind (console/RewindLayer.tsx). */
export function LegacyRewindLayer({ nav, state }: LayerProps) {
  return <RewindLayer at={state.rewindAt} onDeal={nav.deal} onExit={nav.back} />;
}

/** The Charter as a layer (#s=setup). */
export function LegacySetupLayer({ route, nav, state }: LayerProps) {
  if (route.level !== 'setup') return null;
  const p = state.presence;
  const seal = <Seal state={p.state} progress={null} label={sealLabel(p.word, p.line)} ring={SEAL_RING} />;
  return <Charter step={route.step ?? null} onStep={(s) => nav.go({ level: 'setup', step: s }, { replace: true })} onDone={nav.home} seal={seal} />;
}

/** The heading every interim place layer shares: its name (focused going in) and one slot. */
function PlaceHead({ place, end }: { place: Place; end?: ReactNode }) {
  const settings = useSettings().data;
  const locked = useLocked();
  return (
    <div className="cs-lhead cs-placehead">
      <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{PLACE_NAME[place]}</h1>
      <div className="cs-placeend">
        {end}
        {locked ? <Chip tone="gold" title="Locked after 15 quiet minutes: approving asks for Windows Hello">locked</Chip> : null}
        {settings ? <ModeBadge mode={settings.mode} /> : null}
      </div>
    </div>
  );
}

/** Settings: the Circuit checklist (setup/CircuitView.tsx), or on a brand-new wallet the way to the Charter. */
export function LegacySettingsLayer({ nav }: LayerProps) {
  const s = useSettings().data;
  const [detail, setDetail] = useDetail('settings');
  return (
    <div className="cs-placelayer" data-place="settings">
      <PlaceHead place="settings" end={s && !s.first_run ? <Btn sm kind="plain" title={CHARTER_OPEN.title} onClick={() => nav.setup()}>{CHARTER_OPEN.act}</Btn> : null} />
      <div className={`setup-sheet tab-settings det-${detail} cs-placebody`}>
        {s?.first_run ? (
          <div className="setup-link">
            <p>{SETUP_SETTINGS_LINK.text}</p>
            <Btn kind="gold" onClick={() => nav.setup()}>{SETUP_SETTINGS_LINK.act}</Btn>
          </div>
        ) : <SetupCircuit onPair={(m) => nav.place('pairing', { pair: m })} onMandates={() => nav.place('rules')} detail={detail} setDetail={setDetail} />}
      </div>
    </div>
  );
}

/** The pairing desk, for Connections and for "Connect a wallet" (setup/PairingDesk.tsx). */
function Desk({ start }: { start: PairMode | undefined }) {
  const [mode, setMode] = useState<PairMode>(start ?? 'create');
  return <PairingDesk mode={mode} setMode={setMode} />;
}

export function LegacyConnectionsLayer({ route, nav, state }: LayerProps) {
  const place: Place = route.level === 'place' ? route.place : 'connections';
  return (
    <div className="cs-placelayer" data-place={place}>
      <PlaceHead place={place} end={place === 'connections' ? <Btn sm onClick={() => nav.place('pairing')}>{PLACE_NAME.pairing} ›</Btn> : null} />
      <div className="setup-sheet tab-pairing cs-placebody"><Desk start={state.pairMode} /></div>
    </div>
  );
}

/** Agent rules (setup/Mandates.tsx), with the way down to the wallet limits. */
export function LegacyRulesLayer({ nav }: LayerProps) {
  return (
    <div className="cs-placelayer" data-place="rules">
      <PlaceHead place="rules" end={<Btn sm onClick={() => nav.place('limits')} data-fk="to-limits">{PLACE_NAME.limits} ›</Btn>} />
      <div className="setup-sheet tab-mandates cs-placebody"><MandatesList /></div>
    </div>
  );
}

/** The wallet limits: today against the signed limits (lib/limits.ts readLimits), and the hand-off
 *  to the approval window, where the owner signs them. */
export function LegacyLimitsLayer(_: LayerProps) {
  const att = useAttention();
  const locked = useLocked();
  const reading = readLimits(att.data?.exposure);
  return (
    <div className="cs-placelayer" data-place="limits">
      <p className="kicker">{LIMITS_LAYER.kicker}</p>
      <PlaceHead place="limits" />
      <div className="cs-placebody cs-limits">
        {att.error ? <WalletNotice error={att.error} what="Wallet limits" /> : null}
        {!att.data && !att.error ? <Loading what="your wallet limits" /> : null}
        {att.data && !reading ? <p>{LIMITS_LAYER.unread}</p> : null}
        {reading ? (
          <>
            <p className="cs-limline">{reading.line}</p>
            <ul className="cs-meters">
              {reading.meters.map((m) => (
                <li key={m.key} title={m.why}>
                  <span className="k">{LIMIT_WORDS[m.key].name}</span>
                  <span className="v"><b className="num">{m.value}</b>{m.of ? <span> {m.of}</span> : null}</span>
                  <Meter value={m.fill} tone={m.near ? 'gold' : undefined} label={`${m.label}${m.of ? ` ${m.of}` : ''}`} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="ui-hint">{WALLET_LIMITS_ABOUT}</p>
        <div className="cs-acts"><Handoff label={LIMITS_LAYER.change} kind="default" sm={false} locked={locked} title={LIMITS_LAYER.changeTitle} /></div>
        <p className="cs-placefoot"><Silence text={LIMITS_LAYER.ifNothing} /></p>
      </div>
    </div>
  );
}

/** The safety record (safety/SafetySheet.tsx SafetyView), read-only. */
export function LegacySafetyLayer({ nav }: LayerProps) {
  const q = useQuery('safety_record', null);
  const [detail, setDetail] = useDetail('safety');
  const w = useWorld();
  const name = (id: string) => {
    const d = w.deals.data?.find((x) => x.id === id);
    return d ? w.display(d) : null;
  };
  const r = q.data;
  return (
    <div className="cs-placelayer" data-place="safety">
      <PlaceHead place="safety" end={<>
        <DetailToggle value={detail} onChange={setDetail} />
        <Btn sm disabled={q.loading} onClick={() => void q.refetch()} title={SAFETY_LAYER.againTitle}>{SAFETY_LAYER.again}</Btn>
      </>} />
      <div className={`sf-sheet det-${detail} cs-placebody`}>
        {q.error ? <WalletNotice error={q.error} what="Safety record" /> : null}
        {r ? <SafetyView record={r} detailed={detail === 'detailed'} dealName={name} onDeal={nav.deal} /> : !q.error ? <Loading what="your safety record" /> : null}
      </div>
    </div>
  );
}
