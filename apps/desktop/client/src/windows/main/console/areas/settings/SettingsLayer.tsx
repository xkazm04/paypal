// Settings (#p=settings), a layer of the one main window (rebuild WP3c). One answer (is the wallet
// ready, from the same Circuit facts the old checklist used: setup/circuit.ts), a "Your call" line
// when something waits for the owner (the first missing hand-off is the one gold action, exactly as
// the old checklist chose it), and four cards: Approving (the lock), Your agents (pause / resume,
// who they are), Appearance (theme, calm motion) and Notifications (Windows notices, do not
// disturb). Below: the charter, the other places, the first visit (preview only) and Quit. PayPal
// keys, the agent app and the house seller live in Connections now; agent rules in Rules.
// Commands: reads, engine-free pause_all_agents / resume_all_agents (one click, no confirmation),
// settings_write (notices only) and approval_open (unlock, keys, rules). Nothing here moves money.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SettingsSnapshot } from '@bindings/SettingsSnapshot';
import { useCalm } from '../../../../../design/motion';
import { readCommand } from '../../../../../lib/data/invoke';
import { useMutation, useNow, useQuery } from '../../../../../lib/hooks';
import { switchDemo } from '../../DemoSwitch';
import { backend } from '../../../../../lib/runtime';
import { currentTheme, onThemeChange, setTheme, type Theme } from '../../../../../lib/theme';
import {
  CONNECTIONS_ENGINE, CONNECTIONS_HOUSE, CONNECTIONS_PAYPAL, fingerprintGroups, LATEST_OF, modeWord, NOTICE_WHAT, PERMISSIONS_FINGERPRINT, SETTINGS_FACTS, PERMISSIONS_FINGERPRINT_MEANS, rulesName, SETTINGS_AGENTS, SETTINGS_CARD, SETTINGS_IF, SETTINGS_KICKER, SETTINGS_LOCK, SETTINGS_LOOK, SETTINGS_MORE,
  SETTINGS_ACT, SETTINGS_NOTIFY, SETTINGS_OPEN_CHARTER, SETTINGS_PROTECT, SETTINGS_TO_CONNECTIONS,
} from '../../../../../lib/words';
import { RunBadge, WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, Kv, layerCount, Seg, Silence, UNKNOWN, useToast } from '../../../../../shared/ui';
import { deriveCircuit, settingsAnswer, type Circuit } from '../../../setup/circuit';
import { shortTitle } from '../../../home/model';
import { useDisplayOf, useLocked, useRuns, useSettings } from '../../../world';
import { writeCalm } from '../../calm';
import type { LayerProps } from '../../layers';
import type { LatestProps } from '../../Latest';
import { PlaceFrame, type CallLine, type LensCard } from './frame';
import { ToApproval } from './handoff';

export function SettingsLayer({ nav }: LayerProps) {
  const settings = useSettings();
  const s = settings.data;
  const locked = useLocked();
  const runs = useRuns().data;
  const now = useNow();
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const facts = useQuery('owner_facts', null, { refreshOn: ['settings:changed', 'agent:changed'] });
  const pause = useMutation('pause_all_agents');
  const resume = useMutation('resume_all_agents');
  const toast = useToast();
  const running = useMemo(() => (runs ? runs.filter((r) => r.state === 'running' || r.state === 'starting') : null), [runs]);
  const c = useMemo(() => deriveCircuit({
    settings: s ?? null,
    engines: engines.data ?? null,
    mandates: mandates.data ? mandates.data.map((m) => ({ id: m.payload.id, version: m.payload.version, notBefore: m.payload.not_before, expires: m.payload.expires })) : null,
    running: running ? running.length : null,
    locked,
    now,
  }), [s, engines.data, mandates.data, running, locked, now]);
  const answer = settingsAnswer(c, { firstRun: !!s?.first_run, settingsKnown: !!s, locked });
  const paused = !!s?.agents_paused;

  const doPause = async () => { if ((await pause.run(null)) === null) toast(SETTINGS_AGENTS.pausedToast, 'gold'); };
  const doResume = async () => { if (await resume.run(null)) toast(SETTINGS_AGENTS.resumedToast, 'ok'); };
  usePauseKey(paused || !s, doPause);

  const call = callOf(c, s, locked, paused, nav, doResume, resume.pending);
  const lockIn = facts.data?.lock_in ?? null;
  const nWorking = running ? running.length : null;

  const cards: LensCard[] = [
    {
      id: 'approving', label: SETTINGS_CARD.approving,
      value: !s ? null : locked ? SETTINGS_LOCK.locked : SETTINGS_LOCK.unlocked,
      note: locked ? SETTINGS_LOCK.lockedNote : lockIn !== null ? SETTINGS_LOCK.locksIn(Math.max(1, Math.ceil(lockIn / 60))) : SETTINGS_LOCK.unlockedNote,
      chip: locked ? SETTINGS_LOCK.nowLocked : undefined, chipTone: 'gold',
      view: { title: SETTINGS_LOCK.view, sub: SETTINGS_LOCK.sub, render: () => <LockView s={s} locked={locked} lockIn={lockIn} factsError={!!facts.error} /> },
    },
    {
      id: 'agents', label: SETTINGS_CARD.agents,
      value: !s ? null : paused ? SETTINGS_AGENTS.paused : nWorking ? SETTINGS_AGENTS.working(nWorking) : SETTINGS_AGENTS.ready,
      note: paused ? SETTINGS_AGENTS.pausedNote : SETTINGS_AGENTS.readyNote,
      view: {
        title: SETTINGS_AGENTS.view, sub: SETTINGS_AGENTS.sub,
        render: () => <AgentsView paused={paused} known={!!s} running={running} facts={facts.data} factsError={!!facts.error} busy={pause.pending || resume.pending} onPause={doPause} onResume={doResume} />,
      },
    },
    {
      id: 'look', label: SETTINGS_CARD.appearance, value: <LookValue />,
      view: { title: SETTINGS_LOOK.view, sub: SETTINGS_LOOK.sub, render: () => <LookView /> },
    },
    {
      id: 'notify', label: SETTINGS_CARD.notify,
      value: !s ? null : s.preferences.dnd ? SETTINGS_NOTIFY.dnd : s.preferences.notifications ? SETTINGS_NOTIFY.on : SETTINGS_NOTIFY.off,
      note: !s ? undefined : s.preferences.notifications && !s.preferences.dnd ? SETTINGS_NOTIFY.noteOn : SETTINGS_NOTIFY.noteOff,
      view: { title: SETTINGS_NOTIFY.view, sub: SETTINGS_NOTIFY.sub, render: () => <NotifyView s={s} /> },
    },
  ];

  // Settings at a glance: what the other places hold, read-only (each is changed where it lives).
  const engine = engines.data?.find((e) => e.id === s?.selected_engine);
  const latest: LatestProps | undefined = s ? {
    title: LATEST_OF.settings,
    facts: [
      [SETTINGS_FACTS.mode, modeWord(s.mode)],
      [SETTINGS_FACTS.paypal, s.payment_executor_configured ? CONNECTIONS_PAYPAL.saved : CONNECTIONS_PAYPAL.notSaved],
      [SETTINGS_FACTS.engine, !engines.data ? UNKNOWN : engine?.available ? CONNECTIONS_ENGINE.valueReady(s.selected_engine === 'scripted' ? CONNECTIONS_ENGINE.practiceShort : s.selected_engine) : CONNECTIONS_ENGINE.valueOff],
      [SETTINGS_FACTS.house, CONNECTIONS_HOUSE.value[s.house]],
      [SETTINGS_FACTS.rules, mandates.data ? String(mandates.data.length) : UNKNOWN],
      [SETTINGS_FACTS.working, nWorking === null ? UNKNOWN : String(nWorking)],
    ],
  } : undefined;

  return (
    <PlaceFrame root="ar-settings" place="settings" kicker={SETTINGS_KICKER} answer={answer.title} sub={answer.sub} call={call} cards={cards} latest={latest}
      explain={{ summary: SETTINGS_PROTECT.summary, body: <Protect locked={locked} /> }}>
      {settings.error && !s ? <WalletNotice error={settings.error} what={NOTICE_WHAT.settings} /> : null}
      {pause.error ? <WalletNotice error={pause.error} what={NOTICE_WHAT.pause} /> : null}
      {resume.error ? <WalletNotice error={resume.error} what={NOTICE_WHAT.resume} /> : null}
      <section className="st-more" aria-label={SETTINGS_MORE.title}>
        <h2 className="cs-h3">{SETTINGS_MORE.title}</h2>
        <ul className="st-rows">
          <MoreRow name={SETTINGS_MORE.charter} line={SETTINGS_MORE.charterLine} fk="st-charter" onOpen={() => nav.setup()} />
          <MoreRow name={SETTINGS_MORE.rules} line={SETTINGS_MORE.rulesLine} fk="st-rules" onOpen={() => nav.place('rules')} />
          <MoreRow name={SETTINGS_MORE.connections} line={SETTINGS_MORE.connectionsLine} fk="st-connections" onOpen={() => nav.place('connections')} />
          <MoreRow name={SETTINGS_MORE.safety} line={SETTINGS_MORE.safetyLine} fk="st-safety" onOpen={() => nav.place('safety')} />
          {backend().kind === 'mock' ? <MoreRow name={SETTINGS_MORE.firstRun} line={SETTINGS_MORE.firstRunLine} fk="st-first" onOpen={showFirstRun} /> : null}
          <MoreRow name={SETTINGS_MORE.quit} line={SETTINGS_MORE.quitLine} fk="st-quit" onOpen={() => nav.quit()} />
        </ul>
      </section>
    </PlaceFrame>
  );
}

/** The "Your call" line: the first missing hand-off is the one gold action (the old checklist's
 *  order: PayPal key, rules, unlock), then an agent app or paused agents. */
function callOf(c: Circuit, s: SettingsSnapshot | undefined, locked: boolean, paused: boolean, nav: LayerProps['nav'], resume: () => void, resuming: boolean): CallLine | null {
  if (!s) return null;
  if (s.first_run) return { ifNothing: SETTINGS_IF.firstRun, action: <Btn kind="primary" title={SETTINGS_OPEN_CHARTER.title} onClick={() => nav.setup()}>{SETTINGS_OPEN_CHARTER.act} ›</Btn> };
  const cred = c.breaks.find((b) => b.key === 'credentials');
  if (cred) return { ifNothing: `${cred.silence} · ${cred.then}`, action: <ToApproval label={SETTINGS_ACT.key} target="credentials" title={SETTINGS_ACT.keyTitle} /> };
  const rules = c.breaks.find((b) => b.key === 'mandate');
  if (rules) return { ifNothing: `${rules.silence} · ${rules.then}`, action: <ToApproval label={SETTINGS_ACT.rules} target="mandate" title={SETTINGS_ACT.rulesTitle} /> };
  if (locked) return { ifNothing: SETTINGS_IF.locked, action: <ToApproval label={SETTINGS_LOCK.unlock} target="unlock" title={SETTINGS_LOCK.unlock} /> };
  const engine = c.breaks.find((b) => b.key === 'engine');
  if (engine) return { ifNothing: `${engine.silence} · ${engine.then}`, action: <Btn kind="primary" title={SETTINGS_TO_CONNECTIONS.title} onClick={() => nav.place('connections')}>{SETTINGS_TO_CONNECTIONS.act} ›</Btn> };
  if (paused) return { ifNothing: SETTINGS_IF.paused, action: <Btn kind="primary" disabled={resuming} onClick={resume}>{SETTINGS_AGENTS.resume}</Btn> };
  return null;
}

/** P pauses every agent while Settings is the top layer and focus is not in a field (never resumes:
 *  resuming stays a deliberate click). */
function usePauseKey(off: boolean, pause: () => Promise<void>) {
  const ref = useRef(pause);
  ref.current = pause;
  useEffect(() => {
    if (off) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'p' && e.key !== 'P') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (layerCount() > 0) return;
      e.preventDefault();
      void ref.current();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [off]);
}

/** Preview and demo only: the brand-new wallet, through the demo switcher (address or stored choice). */
function showFirstRun(): void {
  switchDemo({ world: 'first_run', degrade: false, locked: false });
}

function MoreRow({ name, line, fk, onOpen }: { name: string; line: string; fk: string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="st-row" data-fk={fk} onClick={onOpen}>
        <span className="st-rt"><b>{name}</b><small>{line}</small></span>
        <span className="st-go" aria-hidden="true">{SETTINGS_MORE.open} ›</span>
      </button>
    </li>
  );
}

// ---- the four views ---------------------------------------------------------------------------

function LockView({ s, locked, lockIn, factsError }: { s: SettingsSnapshot | undefined; locked: boolean; lockIn: number | null; factsError: boolean }) {
  return (
    <div className="st-view">
      <Kv items={[
        [SETTINGS_LOCK.now, locked ? SETTINGS_LOCK.nowLocked : SETTINGS_LOCK.nowUnlocked],
        [SETTINGS_LOCK.in, locked ? SETTINGS_LOCK.inLocked : lockIn !== null ? <>{SETTINGS_LOCK.locksIn(Math.max(1, Math.ceil(lockIn / 60)))} <span className="dim">· {SETTINGS_LOCK.inUnless}</span></> : <Chip tone="dashed">{factsError ? SETTINGS_LOCK.unread : SETTINGS_LOCK.reading}</Chip>],
        [SETTINGS_LOCK.who, SETTINGS_LOCK.whoFixed],
        [SETTINGS_LOCK.hello, s ? (s.native_reauth_available ? SETTINGS_LOCK.helloYes : SETTINGS_LOCK.helloNo) : <Chip tone="dashed">{SETTINGS_LOCK.reading}</Chip>],
        [SETTINGS_LOCK.locks, SETTINGS_LOCK.locksWhat],
        [SETTINGS_LOCK.never, SETTINGS_LOCK.neverWhat],
        [PERMISSIONS_FINGERPRINT, s?.authority_manifest ? <span className="mono" title={PERMISSIONS_FINGERPRINT_MEANS}>{fingerprintGroups(s.authority_manifest)}</span> : <Chip tone="dashed">{SETTINGS_LOCK.reading}</Chip>],
      ]} />
      {locked ? <div className="cs-acts"><ToApproval label={SETTINGS_LOCK.unlock} kind="default" target="unlock" title={SETTINGS_LOCK.unlock} /></div> : null}
    </div>
  );
}

function AgentsView({ paused, known, running, facts, factsError, busy, onPause, onResume }: {
  paused: boolean; known: boolean; running: { run: string; deal_id: string; engine: string; state: string; mode: SettingsSnapshot['mode'] }[] | null;
  facts: { agents: { slot: string; engine: string; does: string; mandates: string[]; running: number }[] } | undefined; factsError: boolean;
  busy: boolean; onPause: () => void; onResume: () => void;
}) {
  const shown = (running ?? []).slice(0, 6);
  return (
    <div className="st-view st-agents">
      <div className="cs-acts">
        {paused ? <Btn kind="primary" disabled={busy || !known} onClick={onResume}>{SETTINGS_AGENTS.resume}</Btn>
          : <Btn disabled={busy || !known} onClick={onPause} title={SETTINGS_AGENTS.pauseTitle}><span className="coral" aria-hidden="true">‖ </span>{SETTINGS_AGENTS.pause}</Btn>}
        <span className="ui-hint">{SETTINGS_AGENTS.alsoIn}</span>
      </div>
      <p className="st-note">{SETTINGS_AGENTS.stillRuns}</p>
      <h3 className="cs-h3">{SETTINGS_AGENTS.roster}</h3>
      {facts?.agents.length ? (
        <ul className="st-list">
          {facts.agents.map((a) => (
            <li key={a.slot}>
              <span className="st-rt"><b>{cap(a.slot)} <span className="dim">· {a.engine === 'scripted' ? SETTINGS_AGENTS.practice : a.engine}</span></b>
                <small>{a.does} · {a.mandates.length ? SETTINGS_AGENTS.follows(rulesName(a.slot).toLowerCase()) : SETTINGS_AGENTS.noRules}</small></span>
              {a.running ? <Chip tone={paused ? 'coral' : 'teal'}>{SETTINGS_AGENTS.busy(a.running)}</Chip> : <Chip>{SETTINGS_AGENTS.idle}</Chip>}
            </li>
          ))}
        </ul>
      ) : <p className="dim">{factsError ? SETTINGS_AGENTS.rosterUnread : SETTINGS_AGENTS.rosterEmpty}</p>}
      <h3 className="cs-h3">{SETTINGS_AGENTS.now}</h3>
      {running === null ? <p className="dim">{SETTINGS_AGENTS.nowUnread}</p> : !running.length ? <p className="dim">{SETTINGS_AGENTS.nowEmpty}</p> : (
        <ul className="st-list">
          {shown.map((r) => (
            <RunRow key={r.run} r={r} paused={paused} />
          ))}
          {running.length > shown.length ? <li className="dim">{SETTINGS_AGENTS.more(running.length - shown.length)}</li> : null}
        </ul>
      )}
      <p className="st-foot"><Silence text={paused ? SETTINGS_AGENTS.ifPaused : SETTINGS_AGENTS.ifWorking} /></p>
    </div>
  );
}

const cap = (t: string): string => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;

/** One agent at work: the deal it works on, by its title (never its label). */
function RunRow({ r, paused }: { r: { run: string; deal_id: string; engine: string; state: string; mode: SettingsSnapshot['mode'] }; paused: boolean }) {
  const d = useDisplayOf(r.deal_id);
  return (
    <li>
      <span className="st-rt"><b>{d ? shortTitle(d.title) : SETTINGS_AGENTS.aDeal}</b><small>{r.engine === 'scripted' ? SETTINGS_AGENTS.practice : r.engine}</small></span>
      <span className="st-chips"><RunBadge run={r} /><Chip tone={paused ? 'coral' : 'teal'}>{r.state === 'starting' ? SETTINGS_AGENTS.starting : SETTINGS_AGENTS.workingWord}</Chip></span>
    </li>
  );
}

function useTheme(): Theme {
  const [t, set] = useState<Theme>(currentTheme);
  useEffect(() => onThemeChange(set), []);
  return t;
}
function LookValue() {
  const t = useTheme();
  const calm = useCalm();
  return <>{t === 'light' ? SETTINGS_LOOK.light : SETTINGS_LOOK.dark}<small className="st-small"> · {calm ? SETTINGS_LOOK.calmOn : SETTINGS_LOOK.calmOff}</small></>;
}

function LookView() {
  const t = useTheme();
  const calm = useCalm();
  const inApp = typeof document !== 'undefined' && document.documentElement.classList.contains('calm');
  const os = calm && !inApp;
  return (
    <div className="st-view">
      <div className="st-line">
        <span className="st-rt"><b>{SETTINGS_LOOK.theme}</b></span>
        <Seg<Theme> label={SETTINGS_LOOK.theme} value={t} onChange={setTheme}
          options={[{ value: 'dark', label: SETTINGS_LOOK.dark, title: SETTINGS_LOOK.darkTitle }, { value: 'light', label: SETTINGS_LOOK.light, title: SETTINGS_LOOK.lightTitle }]} />
      </div>
      <div className="st-line">
        <span className="st-rt"><b>{SETTINGS_LOOK.calm}</b><small>{os ? SETTINGS_LOOK.calmOs : SETTINGS_LOOK.calmWhat}</small></span>
        <Switch on={inApp} label={SETTINGS_LOOK.calm} onChange={writeCalm} />
      </div>
    </div>
  );
}

/** An on/off switch (role="switch"); the words say the state, not the colour. */
function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`st-switch${on ? ' on' : ''}`} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="knob" aria-hidden="true" /><span className="st-sw">{on ? SETTINGS_LOOK.on : SETTINGS_LOOK.off}</span>
    </button>
  );
}

/** Notices: settings_write replaces the whole preferences record and re-applies the mini window's
 *  form and position, so it starts from a fresh read (a native drag or snap emits no change event)
 *  and changes one field only, as the mini window's own do-not-disturb does. */
function NotifyView({ s }: { s: SettingsSnapshot | undefined }) {
  const write = useMutation('settings_write');
  const [busy, setBusy] = useState(false);
  const flip = async (key: 'dnd' | 'notifications', value: boolean) => {
    setBusy(true);
    try {
      const fresh = await readCommand('get_settings', null);
      await write.run({ ...fresh.preferences, [key]: value });
    } catch {
      // The fresh read failed: nothing was written; the switch keeps showing the stored value.
    } finally {
      setBusy(false);
    }
  };
  if (!s) return <p className="dim">{SETTINGS_NOTIFY.unread}</p>;
  return (
    <div className="st-view">
      <div className="st-line">
        <span className="st-rt"><b>{SETTINGS_NOTIFY.notifications}</b><small>{SETTINGS_NOTIFY.notificationsWhat}</small></span>
        <Switch on={s.preferences.notifications} label={SETTINGS_NOTIFY.notifications} disabled={busy || write.pending} onChange={(v) => void flip('notifications', v)} />
      </div>
      <div className="st-line">
        <span className="st-rt"><b>{SETTINGS_NOTIFY.dndLabel}</b><small>{SETTINGS_NOTIFY.dndWhat}</small></span>
        <Switch on={s.preferences.dnd} label={SETTINGS_NOTIFY.dndLabel} disabled={busy || write.pending} onChange={(v) => void flip('dnd', v)} />
      </div>
      {write.error ? <WalletNotice error={write.error} what={SETTINGS_NOTIFY.failed} /> : null}
      <p className="st-foot"><Silence text={SETTINGS_NOTIFY.ifNothing} /></p>
    </div>
  );
}

function Protect({ locked }: { locked: boolean }) {
  const P = SETTINGS_PROTECT;
  const rows = (list: readonly (readonly [string, string])[], chip: ReactNode) => (
    <ul className="st-list">{list.map(([a, b]) => <li key={a}><span className="st-rt"><b>{a}</b><small>{b}</small></span>{chip}</li>)}</ul>
  );
  return (
    <div className="st-protect">
      <ol className="st-chain">{P.chain.map((l) => <li key={l.title}><b>{l.title}</b><span>{l.text}</span></li>)}</ol>
      <div className="st-who">
        <div><h3 className="cs-h3">{locked ? P.onlyYouLocked : P.onlyYou}</h3>{rows(P.rowsOnlyYou, <Chip tone="red">{P.agentsNever}</Chip>)}</div>
        <div><h3 className="cs-h3">{P.youHere}</h3>{rows(P.rowsYou, <Chip tone="line">{P.agentsInside}</Chip>)}</div>
        <div><h3 className="cs-h3">{P.fixed}</h3>{rows(P.rowsFixed, <Chip tone="dashed">{P.fixed.toLowerCase()}</Chip>)}</div>
        <div>
          <h3 className="cs-h3">{P.movesOn}</h3>
          <ol className="st-moves">{P.moves.map((m) => <li key={m}>{m}</li>)}<li className="red">{P.movesNever}</li></ol>
        </div>
      </div>
    </div>
  );
}
