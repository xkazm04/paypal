// Owner configuration in Main, on the shared Sheet (src/shared/ui): Settings as The Circuit
// (setup/CircuitView.tsx), Pairing as the Main side of Two desks (setup/PairingDesk.tsx) and a compact
// Mandates list (setup/Mandates.tsx). Everything privileged - storing credentials, signing
// mandates, unlocking, confirming pairing words - only hands off to the approval window.
// API unchanged for App.tsx: <Sheet tab onTab onClose/>; Esc closes through the layer stack.
import { useState } from 'react';
import { ModeBadge } from '../../shared/honesty';
import { Chip, Sheet as UiSheet, useDetail } from '../../shared/ui';
import type { SheetTab } from './logic';
import { SetupCircuit } from './setup/CircuitView';
import { MandatesList } from './setup/Mandates';
import { PairingDesk } from './setup/PairingDesk';
import type { PairMode } from './setup/pairing';
import { useWorld } from './world';
import './sheet.css';

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
      {tab === 'settings' ? <SetupCircuit onPair={(m) => { setPairMode(m); onTab('pairing'); }} onMandates={() => onTab('mandates')} detail={detail} setDetail={setDetail} />
        : tab === 'pairing' ? <PairingDesk mode={pairMode} setMode={setPairMode} />
          : <MandatesList />}
    </UiSheet>
  );
}
