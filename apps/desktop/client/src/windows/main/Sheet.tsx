// Owner configuration in Main, on the shared Sheet (src/shared/ui): Settings as The Circuit
// (setup/CircuitView.tsx), Pairing as the Main side of Two desks (setup/PairingDesk.tsx) and a compact
// Mandates list (setup/Mandates.tsx). Everything privileged - storing credentials, signing
// mandates, unlocking, confirming pairing words - only hands off to the approval window.
// API unchanged for App.tsx: <Sheet tab onTab onClose/>; Esc closes through the layer stack.
// The three tabs are their own chunks (lib/lazy.ts), preloaded once the window is idle; the sheet
// frame and its tabs open at once, and a tab not loaded yet shows a calm loading line.
import { Suspense, useState } from 'react';
import { ModeBadge } from '../../shared/honesty';
import { lazyPart } from '../../lib/lazy';
import { Chip, Sheet as UiSheet, useDetail } from '../../shared/ui';
import type { SheetTab } from './logic';
import '../../shared/ownerKey.css';
import './setup/setup.css';
import type { PairMode } from './setup/pairing';
import { Loading } from './ui';
import { useWorld } from './world';
import './sheet.css';

const SetupCircuit = lazyPart(() => import('./setup/CircuitView').then((m) => m.SetupCircuit));
const MandatesList = lazyPart(() => import('./setup/Mandates').then((m) => m.MandatesList));
const PairingDesk = lazyPart(() => import('./setup/PairingDesk').then((m) => m.PairingDesk));

/** The sheet's tabs, for the window's idle preload (App.tsx). */
export const SHEET_TABS = [SetupCircuit, PairingDesk, MandatesList] as const;

const TABS: ReadonlyArray<{ value: SheetTab; label: string }> = [
  { value: 'settings', label: 'Settings' },
  { value: 'pairing', label: 'Connections' },
  { value: 'mandates', label: 'Agent rules' },
];

export function Sheet({ tab, pair, onTab, onClose }: { tab: SheetTab; /** Connections opens on this way of connecting. */ pair?: PairMode; onTab: (t: SheetTab) => void; onClose: () => void }) {
  const w = useWorld();
  const s = w.settings.data;
  const [pairMode, setPairMode] = useState<PairMode>(pair ?? 'create');
  // Settings opens on the checklist; the circuit diagram is behind Detailed (the sheet is wider then).
  const [detail, setDetail] = useDetail('settings');
  const title = tab === 'settings' ? (s?.first_run ? 'Getting started' : 'Settings') : tab === 'pairing' ? 'Connect a wallet' : 'Agent rules';
  const head = (
    <div className="setup-head">
      <div className="ui-seg" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} onClick={() => onTab(t.value)}>{t.label}</button>
        ))}
      </div>
      {w.locked ? <Chip tone="gold" title="Locked after 15 quiet minutes: approving asks for Windows Hello">locked</Chip> : null}
      {s ? <ModeBadge mode={s.mode} /> : null}
    </div>
  );
  return (
    // A stray click on the scrim must not drop a pairing code that is being polled.
    <UiSheet title={title} onClose={onClose} head={head} dismissOnScrim={tab !== 'pairing'} className={`setup-sheet tab-${tab}${tab === 'settings' ? ` det-${detail}` : ''}`}>
      <Suspense fallback={<Loading what={tab === 'settings' ? 'settings' : tab === 'pairing' ? 'connections' : 'agent rules'} />}>
        {tab === 'settings' ? <SetupCircuit onPair={(m) => { setPairMode(m); onTab('pairing'); }} onMandates={() => onTab('mandates')} detail={detail} setDetail={setDetail} />
          : tab === 'pairing' ? <PairingDesk mode={pairMode} setMode={setPairMode} />
            : <MandatesList />}
      </Suspense>
    </UiSheet>
  );
}
