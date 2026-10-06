// Engine and agent status for the Dial's 28px footer: two compact chips that open Settings.
// No engine selected, an unavailable engine and a failed engine_status read all say so.
import { useQuery } from '../../lib/hooks';
import { useWorld } from './world';

export function EngineChip({ onClick }: { onClick: () => void }) {
  const w = useWorld();
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const sel = w.settings.data?.selected_engine;
  const info = engines.data?.find((e) => e.id === sel);
  const ok = !!info?.available;
  const label = !sel ? 'No agent app' : engines.error ? 'Agent app status unknown' : !info ? 'Checking agent app…' : ok ? (sel === 'scripted' ? 'Practice agent ready' : 'Agent app ready') : 'Agent app not connected';
  const title = engines.error
    ? `Could not check the agent app: ${engines.error.message}`
    : info
      ? ok ? `${info.id}${info.version ? ` ${info.version}` : ''} is ready. Opens Settings.` : `${info.id} is not connected${info.reason ? `: ${info.reason}` : ''}. Opens Settings.`
      : sel ? 'Checking the agent app' : 'No agent app chosen: open Settings to pick one';
  return (
    <button type="button" className={`hs-chip ${ok ? 'ok' : 'warn'}`} onClick={onClick} title={title}>
      <i aria-hidden="true" />{label}
    </button>
  );
}

export function AgentsChip({ onClick }: { onClick: () => void }) {
  const w = useWorld();
  const paused = !!w.settings.data?.agents_paused;
  const runs = w.runs.data;
  const running = (runs ?? []).filter((r) => r.state === 'running' || r.state === 'starting').length;
  const text = paused ? 'Agents paused' : w.runs.error && !runs ? 'Agents: status unknown' : running ? `${running} agent${running === 1 ? '' : 's'} working` : 'Agents idle';
  return (
    <button type="button" className={`hs-chip ${paused ? 'warn' : running ? 'ok' : ''}`} onClick={onClick}
      title={paused ? 'All agents are paused. Deadlines and their safe defaults still run; nothing new starts.'
        : w.runs.error && !runs ? `Could not read agent activity: ${w.runs.error.message}` : 'Agents working on deals right now (at most four, one per deal)'}>
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
