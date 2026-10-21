// Engine and agent status for the Dial's 28px footer: two compact chips that open Settings.
// No engine selected, an unavailable engine and a failed engine_status read all say so; until a read
// answers, a chip says it is checking (dashed), never a state it has not read.
import { useQuery } from '../../lib/hooks';
import { reasonWords } from '../../lib/words';
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
  const label = !known ? (settings.error ? 'Agent app status unknown' : 'Checking agent app…')
    : !sel ? 'No agent app' : engines.error ? 'Agent app status unknown' : !info ? 'Checking agent app…' : ok ? (sel === 'scripted' ? 'Practice agent ready' : 'Agent app ready') : 'Agent app not connected';
  const title = !known
    ? (settings.error ? 'Your settings couldn’t be read just now. Opens Settings.' : 'Checking the agent app')
    : engines.error
      ? 'The agent app couldn’t be checked just now. Opens Settings.'
      : info
        ? ok ? `${info.id}${info.version ? ` ${info.version}` : ''} is ready. Opens Settings.` : `${info.id} is not connected${info.reason ? `: ${reasonWords(info.reason)}` : ''}. Opens Settings.`
        : sel ? 'Checking the agent app' : 'No agent app chosen: open Settings to pick one';
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
  const text = checking ? 'Agents: checking…' : unread ? 'Agents: status unknown' : paused ? 'Agents paused' : running ? `${running} agent${running === 1 ? '' : 's'} working` : 'Agents idle';
  return (
    <button type="button" className={`hs-chip ${checking || unread ? 'dashed' : paused ? 'warn' : running ? 'ok' : ''}`} onClick={onClick}
      title={checking ? 'Checking what your agents are doing'
        : unread ? 'What your agents are doing couldn’t be read just now. Opens Settings.'
          : paused ? 'All agents are paused. Deadlines and their safe defaults still run; nothing new starts.' : 'Agents working on deals right now (at most four, one per deal)'}>
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
