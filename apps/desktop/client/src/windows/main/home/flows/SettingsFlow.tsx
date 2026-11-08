// Settings flow (spark chat-configure): look / alerts / pause as single-question cards. A change is
// applied only after the card's own consent button ("Apply"), through the same writes the Settings
// layer uses (setTheme + writeCalm, settings_write on a fresh read, pause_all_agents /
// resume_all_agents). Folded turns are plain text, so the Undo lives in the live 'done' step for a few
// seconds, then the flow closes with its one-line summary. A locked wallet says so in one line and ends.
import { useCallback, useEffect, useState } from 'react';
import { Btn } from '../../../../shared/ui';
import { readCommand } from '../../../../lib/data/invoke';
import { useMutation } from '../../../../lib/hooks';
import { currentTheme, setTheme, type Theme } from '../../../../lib/theme';
import { calmToggled, writeCalm } from '../../console/calm';
import { useLocked, useSettings } from '../../world';
import { FlowCard } from './FlowCard';
import { advanceFlow, endFlow, type FlowTurn } from './store';
import { SETTINGS_FLOW as W, UNDO_MS } from './settingsWords';
import './settingsFlow.css';

/** One applicable change; its inverse is the same shape with the earlier values. */
export type Change =
  | { kind: 'look'; theme: Theme; calm: boolean }
  | { kind: 'alerts'; notifications: boolean; dnd: boolean }
  | { kind: 'pause'; to: 'pause' | 'resume' };

const ALERTS = {
  all: { notifications: true, dnd: false },
  dnd: { notifications: true, dnd: true },
  none: { notifications: false, dnd: false },
} as const;
const ALERT_KEYS = ['all', 'dnd', 'none'] as const;
const STEPS = ['topic', 'theme', 'calm', 'alerts', 'pause', 'confirm'] as const;

const whatOf = (c: Change): string => {
  if (c.kind === 'look') return [W.theme.sum(c.theme === 'light' ? W.theme.light : W.theme.dark), c.calm ? W.calm.on : W.calm.off].join(', ');
  if (c.kind === 'alerts') return W.alerts.sum(c.dnd ? W.alerts.dnd : c.notifications ? W.alerts.all : W.alerts.none);
  return c.to === 'pause' ? W.pause.sum.pause : W.pause.sum.resume;
};

export function SettingsFlow({ turn }: { turn: FlowTurn }) {
  if (turn.summary !== null) return <FlowCard turn={turn}>{null}</FlowCard>;
  return <Live turn={turn} />;
}

/** Applies a change and returns the change that undoes it, or null when it did not apply. */
function useApply(): (c: Change) => Promise<Change | null> {
  const write = useMutation('settings_write');
  const pause = useMutation('pause_all_agents');
  const resume = useMutation('resume_all_agents');
  const { run: writeRun } = write;
  const { run: pauseRun } = pause;
  const { run: resumeRun } = resume;
  return useCallback(async (c: Change): Promise<Change | null> => {
    if (c.kind === 'look') {
      const before: Change = { kind: 'look', theme: currentTheme(), calm: calmToggled() };
      setTheme(c.theme);
      writeCalm(c.calm);
      return before;
    }
    if (c.kind === 'alerts') {
      try {
        const fresh = await readCommand('get_settings', null);
        const before: Change = { kind: 'alerts', notifications: fresh.preferences.notifications, dnd: fresh.preferences.dnd };
        const out = await writeRun({ ...fresh.preferences, notifications: c.notifications, dnd: c.dnd });
        return out === undefined ? null : before;
      } catch { return null; }
    }
    const out = c.to === 'pause' ? await pauseRun(null) : await resumeRun(null);
    return out === undefined ? null : { kind: 'pause', to: c.to === 'pause' ? 'resume' : 'pause' };
  }, [writeRun, pauseRun, resumeRun]);
}

function Live({ turn }: { turn: FlowTurn }) {
  const locked = useLocked();
  const s = useSettings().data;
  const apply = useApply();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (locked) endFlow(W.locked); }, [locked]);
  const n = Math.max(1, STEPS.indexOf(turn.step as (typeof STEPS)[number]) + 1);
  const of = turn.data.change ? 3 : 2;
  const go = (summary: string, step: string, data: Record<string, unknown> = {}) => { advanceFlow(summary, step, data); };

  if (locked) return <FlowCard turn={turn}><p>{W.locked}</p></FlowCard>;

  let body;
  switch (turn.step) {
    case 'topic':
      body = (
        <>
          <p>{W.topic.ask}</p>
          <div className="fc-choices">
            <Btn onClick={() => go(W.topic.sum.look, 'theme')}>{W.topic.look}</Btn>
            <Btn onClick={() => go(W.topic.sum.alerts, 'alerts')}>{W.topic.alerts}</Btn>
            <Btn onClick={() => go(W.topic.sum.pause, 'pause')}>{W.topic.pause}</Btn>
          </div>
        </>
      );
      break;
    case 'theme':
      body = (
        <>
          <p>{W.theme.ask}</p>
          <div className="fc-choices">
            {(['dark', 'light'] as const).map((t) => (
              <Btn key={t} onClick={() => go(W.theme.sum(t === 'light' ? W.theme.light : W.theme.dark), 'calm', { theme: t })}>{t === 'light' ? W.theme.light : W.theme.dark}</Btn>
            ))}
          </div>
        </>
      );
      break;
    case 'calm':
      body = (
        <>
          <p>{W.calm.ask}</p>
          <div className="fc-choices">
            {[true, false].map((calm) => (
              <Btn key={String(calm)} onClick={() => go(calm ? W.calm.on : W.calm.off, 'confirm', { change: { kind: 'look', theme: turn.data.theme as Theme, calm } satisfies Change })}>{calm ? W.calm.on : W.calm.off}</Btn>
            ))}
          </div>
        </>
      );
      break;
    case 'alerts':
      body = !s ? <p>{W.alerts.unread}</p> : (
        <>
          <p>{W.alerts.ask}</p>
          <div className="fc-choices">
            {ALERT_KEYS.map((k) => (
              <Btn key={k} onClick={() => go(W.alerts.sum(W.alerts[k]), 'confirm', { change: { kind: 'alerts', ...ALERTS[k] } satisfies Change })}>{W.alerts[k]}</Btn>
            ))}
          </div>
        </>
      );
      break;
    case 'pause': {
      const paused = !!s?.agents_paused;
      const to = paused ? 'resume' : 'pause';
      body = (
        <>
          <p>{paused ? W.pause.paused : W.pause.working}</p>
          <div className="fc-choices">
            <Btn disabled={!s} onClick={() => go(W.pause.sum[to], 'confirm', { change: { kind: 'pause', to } satisfies Change })}>{paused ? W.pause.doResume : W.pause.doPause}</Btn>
          </div>
        </>
      );
      break;
    }
    case 'confirm': {
      const change = turn.data.change as Change;
      body = (
        <>
          <p>{W.confirm.ask(whatOf(change))}</p>
          <div className="fc-choices">
            <Btn kind="primary" disabled={busy} onClick={async () => {
              setBusy(true); setFailed(false);
              const undo = await apply(change);
              setBusy(false);
              if (!undo) { setFailed(true); return; }
              go(W.done.applied(whatOf(change)), 'done', { change, undo });
            }}>{W.confirm.apply}</Btn>
          </div>
          {failed ? <p className="fc-quiet">{W.failed}</p> : null}
        </>
      );
      break;
    }
    case 'done': body = <Done change={turn.data.change as Change} undo={turn.data.undo as Change} apply={apply} />; break;
    default: body = null;
  }
  return <FlowCard turn={turn} cancel={turn.step !== 'done'} n={turn.step === 'done' ? undefined : n} of={turn.step === 'done' ? undefined : of}>{body}</FlowCard>;
}

/** The applied line with Undo for a few seconds, then the flow closes with its summary line. */
function Done({ change, undo, apply }: { change: Change; undo: Change; apply: (c: Change) => Promise<Change | null> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (busy) return;
    const t = setTimeout(() => endFlow(W.done.closed(whatOf(change))), UNDO_MS);
    return () => clearTimeout(t);
  }, [change, busy]);
  return (
    <>
      <div className="fc-done">
        <p>{W.done.applied(whatOf(change))}</p>
        <Btn disabled={busy} onClick={async () => {
          setBusy(true);
          const back = await apply(undo);
          if (back) endFlow(W.done.undone); else { setBusy(false); setFailed(true); }
        }}>{W.done.undo}</Btn>
      </div>
      {failed ? <p className="fc-quiet">{W.failed}</p> : null}
    </>
  );
}
