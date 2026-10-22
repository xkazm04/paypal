// Engine and agent status for the console footer (console/Footer.tsx): two compact chips that open Settings.
// No engine selected, an unavailable engine and a failed engine_status read all say so; until a read
// answers, a chip says it is checking (dashed), never a state it has not read.
import { useQuery } from '../../lib/hooks';
import { AGENTS_CHIP, ENGINE_CHIP, reasonWords } from '../../lib/words';
import { useRuns, useSettings } from './world';

export function EngineChip({ onClick }: { onClick: () => void }) {
  const settings = useSettings();
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  // Until settings are read, which agent app was chosen is not known: never "No agent app".
  const known = !!settings.data;
  const sel = settings.data?.selected_engine;
  const info = engines.data?.find((e) => e.id === sel);
  const ok = !!info?.available;
  const unknown = !known || (!!sel && (!!engines.error || !info));
  const label = !known ? (settings.error ? ENGINE_CHIP.statusUnknown : ENGINE_CHIP.checking)
    : !sel ? ENGINE_CHIP.none : engines.error ? ENGINE_CHIP.statusUnknown : !info ? ENGINE_CHIP.checking : ok ? (sel === 'scripted' ? ENGINE_CHIP.practiceReady : ENGINE_CHIP.ready) : ENGINE_CHIP.notConnected;
  const title = !known
    ? (settings.error ? ENGINE_CHIP.settingsUnread : ENGINE_CHIP.checkingTitle)
    : engines.error
      ? ENGINE_CHIP.unchecked
      : info
        ? ok ? ENGINE_CHIP.isReady(info.id, info.version) : ENGINE_CHIP.isNotConnected(info.id, info.reason ? reasonWords(info.reason) : null)
        : sel ? ENGINE_CHIP.checkingTitle : ENGINE_CHIP.pick;
  return (
    <button type="button" className={`hs-chip ${ok ? 'ok' : unknown ? 'dashed' : 'warn'}`} onClick={onClick} title={title}>
      <i aria-hidden="true" />{label}
    </button>
  );
}

export function AgentsChip({ onClick }: { onClick: () => void }) {
  const settings = useSettings();
  const r = useRuns();
  const runs = r.data;
  // Paused or idle is only said once both settings and the runs are read; before, it is "checking".
  const checking = (!settings.data && !settings.error) || (!runs && !r.error);
  const unread = !checking && (!settings.data || !runs);
  const paused = !!settings.data?.agents_paused;
  const running = (runs ?? []).filter((x) => x.state === 'running' || x.state === 'starting').length;
  const text = checking ? AGENTS_CHIP.checking : unread ? AGENTS_CHIP.unknown : paused ? AGENTS_CHIP.paused : running ? AGENTS_CHIP.working(running) : AGENTS_CHIP.idle;
  return (
    <button type="button" className={`hs-chip ${checking || unread ? 'dashed' : paused ? 'warn' : running ? 'ok' : ''}`} onClick={onClick}
      title={checking ? AGENTS_CHIP.checkingTitle
        : unread ? AGENTS_CHIP.unreadTitle
          : paused ? AGENTS_CHIP.pausedTitle : AGENTS_CHIP.workingTitle}>
      {text}
    </button>
  );
}

export function StatusChips({ onSettings }: { onSettings: () => void }) {
  return (
    <span className="chipsrow">
      <EngineChip onClick={onSettings} />
      <AgentsChip onClick={onSettings} />
    </span>
  );
}
