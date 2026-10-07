// Settings / first run (docs/ux/ROUND-1.md). Layer 1: one sentence that says whether the wallet is
// ready, then a checklist where every step has its state and its one action. The Circuit
// (prototype/pages/setup/variant-2, the money path drawn as wired parts) moves behind "Detailed",
// titled "How your money is protected", with its inspector column; longer explanations sit in popovers.
// Real commands only: engine_status (probe), engine_select, pause_all_agents (one click, no
// confirmation), resume_all_agents, approval_open (credentials, mandates, unlock). Credentials are
// typed only into the native dialog the approval window opens; this window never sees a secret.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { EngineId } from '@bindings/EngineId';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { clockLabel } from '../../../lib/format';
import { rulesName } from '../../../lib/words';
import { useMutation, useNow, useQuery } from '../../../lib/hooks';
import { ModeBadge, RunBadge, WalletNotice } from '../../../shared/honesty';
import { AnswerBar, Btn, Chip, DetailToggle, Group, Icon, Kv, Popover, Row, Section, Silence, layerCount, topLayerKind, useToast, type DetailMode, type IconName } from '../../../shared/ui';
import { useWorld } from '../world';
import { deriveCircuit, initialPart, PART_NAME, setupProgress, settingsAnswer, stepPart, type Break, type Circuit, type PartId } from './circuit';
import { Handoff, Info, ToneChip, WhoChip } from './common';
import type { PairMode } from './pairing';
import './setup.css';

const dateLabel = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const LOCK_SVG = (
  <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
);
const WIN_SVG = (
  <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M2 6h12" stroke="currentColor" strokeWidth="1.4" /></svg>
);
function BreakerSvg({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="coral"><circle cx="5" cy="15" r="2" fill="currentColor" /><circle cx="19" cy="15" r="2" fill="currentColor" /><path d="M6.5 14 L17 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="teal"><circle cx="5" cy="12" r="2" fill="currentColor" /><circle cx="19" cy="12" r="2" fill="currentColor" /><path d="M6.5 12 H17.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
  );
}

const shortDate = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const sentence = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;

export function SetupCircuit({ onPair, onMandates, detail, setDetail }: { onPair: (m: PairMode) => void; onMandates: () => void; detail: DetailMode; setDetail: (m: DetailMode) => void }) {
  const w = useWorld();
  const s = w.settings.data;
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  // Read-only owner facts from Rust: idle seconds to the lock, probe times, credential dates, roster.
  const facts = useQuery('owner_facts', null, { refreshOn: ['settings:changed', 'agent:changed'] });
  const f = facts.data;
  const factsAt = useRef<number>(0);
  useEffect(() => { if (f) factsAt.current = Math.floor(Date.now() / 1000); }, [f]);
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const select = useMutation('engine_select');
  const pause = useMutation('pause_all_agents');
  const resume = useMutation('resume_all_agents');
  const toast = useToast();
  const now = useNow();
  const locked = w.locked;

  // When Rust probed the engine executables this session (owner_facts), not when this window read them.
  const probedAt = f?.engines.reduce<number | null>((a, e) => (e.probed_at && (!a || e.probed_at > a) ? e.probed_at : a), null) ?? null;

  const runs = w.runs.data;
  const running = runs ? runs.filter((r) => r.state === 'running' || r.state === 'starting') : null;
  const c = useMemo(() => deriveCircuit({
    settings: s ?? null,
    engines: engines.data ?? null,
    mandates: mandates.data ? mandates.data.map((m) => ({ id: m.payload.id, version: m.payload.version, notBefore: m.payload.not_before, expires: m.payload.expires })) : null,
    running: running ? running.length : null,
    locked,
    now,
  }), [s, engines.data, mandates.data, running, locked, now]);

  const [pickAt, setPickAt] = useState<HTMLElement | null>(null);
  const [picked, setPicked] = useState<PartId | null>(null);
  const sel: PartId = picked ?? initialPart(c, !!s?.first_run);
  const focusSel = useRef(false);
  const cx = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusSel.current) return;
    focusSel.current = false;
    cx.current?.querySelector<HTMLElement>(`[data-part="${sel}"]`)?.focus();
  }, [sel]);

  const doPause = async () => { if ((await pause.run(null)) === null) toast(<><b>All agents paused.</b> Their work stops; deadlines still release holds.</>, 'gold'); };
  const doResume = async () => { if ((await resume.run(null)) === null) toast('Agents can work again. Start each deal yourself.', 'ok'); };
  const breaker = () => { if (!s || pause.pending || resume.pending) return; void (s.agents_paused ? doResume() : doPause()); };
  const pickEngine = async (id: EngineId) => { if ((await select.run({ engine: id })) === null) toast(<>Agent app set to <b>{id === 'scripted' ? 'practice agent' : id}</b>.</>, 'ok'); };

  // P pauses every agent (never resumes: resuming stays a deliberate click). Only while this sheet
  // is the top layer and focus is not in a field.
  const pauseRef = useRef(doPause);
  pauseRef.current = doPause;
  const paused = !!s?.agents_paused;
  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'p' && e.key !== 'P') return;
      if (e.ctrlKey || e.metaKey || e.altKey || paused) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (layerCount() !== 1 || topLayerKind() !== 'sheet') return;
      e.preventDefault();
      void pauseRef.current();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [paused]);

  const onArrows = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    focusSel.current = true;
    setPicked(stepPart(sel, e.key === 'ArrowRight' ? 1 : -1));
  };
  const inspect = (p: PartId) => setPicked(p);

  const probeBtn = (primary?: boolean) => (
    <Btn sm kind={primary ? 'primary' : 'default'} disabled={engines.loading && !engines.data} onClick={() => void engines.refetch()}>
      {engines.data ? 'Check again' : 'Look for agent apps'}
    </Btn>
  );

  // The engine list as radio rows: the same picker in the Simple checklist (a popover) and in the
  // Detailed inspector. A render function so its popover is not remounted by the clock.
  const enginePicker = (): ReactNode => (
    <>
      {engines.error ? <WalletNotice error={engines.error} what="Agent app" /> : null}
      <div className="ui-group" role="radiogroup" aria-label="Agent app">
        {!engines.data ? <div className="ui-row"><Chip tone="dashed">unknown</Chip><span className="tx">{engines.loading ? 'Looking for agent apps…' : 'not checked yet'}</span></div> : null}
        {(engines.data ?? []).map((e) => (
          <label key={e.id} className={`ui-row two eng ${e.available ? '' : 'dis'}`} title={e.available ? undefined : e.reason ?? undefined}>
            <input type="radio" className="ui-check" name="setup-engine" value={e.id} checked={s?.selected_engine === e.id} disabled={!e.available || select.pending || !s}
              onChange={() => void pickEngine(e.id)} />
            <span className="main">
              <span className="t1">{e.id === 'scripted' ? <>Practice agent <span className="dim">· no AI model</span></> : e.id}{e.version ? <span className="dim"> · {e.version}</span> : null}</span>
              <span className="t2">{e.available ? 'installed and ready' : e.reason ? `not usable yet · ${e.reason}` : 'not usable yet'}</span>
            </span>
            <span className="end">{e.available ? <Chip tone="ok">ready</Chip> : <Chip tone="line">not connected</Chip>}</span>
          </label>
        ))}
        <div className="ui-row foot"><span className="ui-hint">{probedAt ? `checked ${clockLabel(probedAt)}` : f ? 'not checked since the app started' : ''}</span><span className="end">{probeBtn(!engines.data)}</span></div>
      </div>
      {select.error ? <WalletNotice error={select.error} what="Agent app" /> : null}
    </>
  );

  // ---- the checklist (Simple) ----------------------------------------------------------------
  const answer = settingsAnswer(c, { firstRun: !!s?.first_run, settingsKnown: !!s, locked });
  const progress = setupProgress(c);
  const brk = (k: Break['key']) => c.breaks.find((b) => b.key === k);
  const silenceOf = (b: Break) => <Silence text={b.silence}>{` · ${b.then}`}</Silence>;
  // One gold button in the whole sheet: the first hand-off that is actually needed.
  const goldKey = brk('credentials') ? 'credentials' : brk('mandate') ? 'mandate' : locked ? 'unlock' : null;

  const live = (mandates.data ?? []).filter((m) => m.payload.not_before <= now && now < m.payload.expires);
  const liveAgents = new Set(live.map((m) => m.agent)).size;
  const liveUntil = live.length ? Math.min(...live.map((m) => m.payload.expires)) : null;
  const keyAt = f?.credentials.find((x) => x.kind === 'paypal_sandbox')?.stored_at ?? null;
  const marketAt = f?.credentials.find((x) => x.kind === 'channel3')?.stored_at ?? null;
  const engPart = c.parts.engine;
  const engBreak = brk('engine');
  const house = s?.house;
  const nWorking = running ? running.length : null;

  const keyBreak = brk('credentials');
  const stepKey: Step = keyBreak
    ? { state: 'todo', icon: 'alert', title: 'Connect PayPal', status: silenceOf(keyBreak), action: <Handoff label="Add PayPal key" kind={goldKey === 'credentials' ? 'gold' : 'default'} locked={locked} target="credentials" /> }
    : c.parts.keychain.state === 'unknown'
      ? { state: 'unknown', icon: 'eye', title: 'Connect PayPal', status: <Chip tone="dashed">not checked yet</Chip>, action: null }
      : {
        state: 'done', icon: 'check', title: 'Connect PayPal',
        status: <>Key saved{keyAt ? ` ${shortDate(keyAt)}` : ''} <Chip tone="dashed" title="The wallet doesn’t test the PayPal connection live, so it can’t say it works">connection not tested</Chip></>,
        action: <Handoff label="Replace key" kind="default" locked={locked} target="credentials" />,
      };
  const rulesBreak = brk('mandate');
  const stepRules: Step = rulesBreak
    ? { state: 'todo', icon: 'alert', title: 'Sign your agents’ rules', status: silenceOf(rulesBreak), action: <Handoff label="Sign rules" kind={goldKey === 'mandate' ? 'gold' : 'default'} locked={locked} target="mandate" /> }
    : c.parts.mandate.state === 'unknown'
      ? { state: 'unknown', icon: 'eye', title: 'Sign your agents’ rules', status: <Chip tone="dashed">not loaded yet</Chip>, action: null }
      : {
        state: 'done', icon: 'check', title: 'Sign your agents’ rules',
        status: `Signed for ${liveAgents} ${liveAgents === 1 ? 'agent' : 'agents'}${liveUntil ? ` · active until ${shortDate(liveUntil)}` : ''}`,
        action: <Btn kind="default" sm onClick={onMandates}>Agent rules ›</Btn>,
      };
  const stepEngine: Step = engBreak
    ? {
      state: 'todo', icon: 'alert', title: 'Choose an agent app', status: silenceOf(engBreak),
      action: <>{probeBtn(true)}{engBreak.scriptedFix ? <Btn sm disabled={select.pending} onClick={() => void pickEngine('scripted')} title="A scripted agent with no AI model, for trying things out">Use practice agent</Btn> : null}</>,
    }
    : engPart.state === 'unknown'
      ? { state: 'unknown', icon: 'eye', title: 'Choose an agent app', status: <Chip tone="dashed">{engines.loading ? 'looking…' : 'not checked yet'}</Chip>, action: probeBtn(true) }
      : {
        state: 'done', icon: 'check', title: 'Choose an agent app', status: `${sentence(engPart.value)} is ready`,
        action: <Btn kind="default" sm aria-expanded={!!pickAt} onClick={(e) => { const t = e.currentTarget; setPickAt((x) => (x ? null : t)); }}>Change</Btn>,
      };

  const stepHouse: Step = {
    state: house === 'waking' ? 'wait' : house === 'ready' ? 'done' : 'idle',
    icon: house === 'ready' ? 'check' : house === 'waking' ? 'clock' : 'store',
    title: 'House seller',
    status: house === undefined ? <Chip tone="dashed">not loaded yet</Chip>
      : house === 'unavailable' ? <Chip tone="dashed">not part of this version</Chip>
        : house === 'waking' ? <Silence text="it keeps waking">{' · no money moves'}</Silence>
          : house === 'ready' ? 'A practice shop, awake and answering at once' : 'A practice shop that is always there. Asleep until you open a table.',
    action: house && house !== 'unavailable' ? <Btn kind="default" sm onClick={() => onPair('house')}>Open a table with it ›</Btn> : null,
  };
  const stepMarket: Step = {
    state: s ? (s.channel3_configured ? 'done' : 'idle') : 'unknown',
    icon: s?.channel3_configured ? 'check' : 'tag',
    title: 'Market prices',
    status: !s ? <Chip tone="dashed">not loaded yet</Chip> : s.channel3_configured ? `Key saved${marketAt ? ` ${shortDate(marketAt)}` : ''}` : 'Optional. Without it, items show no typical price.',
    action: s ? <Handoff label={s.channel3_configured ? 'Replace key' : 'Add key'} kind="default" locked={locked} target="credentials" /> : null,
  };
  const stepAgents: Step = !s
    ? { state: 'unknown', icon: 'eye', title: 'Your agents', status: <Chip tone="dashed">not loaded yet</Chip>, action: null }
    : paused
      ? { state: 'wait', icon: 'pause', title: 'Your agents', status: <Silence text="they stay paused">{' · deadlines still release holds'}</Silence>, action: <Btn kind="primary" sm disabled={resume.pending} onClick={() => void doResume()}>Resume agents</Btn> }
      : {
        state: 'done', icon: 'agent', title: 'Your agents',
        status: nWorking === null ? 'Ready to work inside your rules' : nWorking ? `${nWorking} ${nWorking === 1 ? 'deal is' : 'deals are'} being worked on` : 'Idle, ready to work inside your rules',
        action: <Btn sm disabled={pause.pending} onClick={() => void doPause()} title="One click, no confirmation: stopping is always free"><span className="coral" aria-hidden="true">‖</span>Pause all agents</Btn>,
      };
  const stepLock: Step = locked
    ? { state: 'wait', icon: 'hold', title: 'Approving', status: <Silence text="it stays locked">{' · no money moves'}</Silence>, action: <Handoff label="Unlock with Windows Hello" kind={goldKey === 'unlock' ? 'gold' : 'default'} locked={locked} target="unlock" /> }
    : { state: 'done', icon: 'hold', title: 'Approving', status: 'Unlocked. It locks after 15 quiet minutes.', action: null };

  const detailed = detail === 'detailed';
  return (
    <div className={detailed ? 'cx-split' : 'cx-simple'}>
      <div className="cx-main">
        {w.settings.error && !s ? <WalletNotice error={w.settings.error} what="Settings" /> : null}
        <AnswerBar tone={answer.tone} title={answer.title} sub={answer.sub} />
        <div className="su-bar">
          <h3>{detailed ? 'How your money is protected' : `Setup · ${progress.done} of ${progress.total} done`}</h3>
          <span className="ui-spacer" />
          {detailed ? <Info label="Who can set what" text="Who can set what" className="wide"><WhoCanSetWhat locked={locked} /></Info> : null}
          <DetailToggle value={detail} onChange={setDetail} detailedLabel="Detailed" />
        </div>
        {pause.error ? <WalletNotice error={pause.error} what="Pause" /> : null}
        {resume.error ? <WalletNotice error={resume.error} what="Resume" /> : null}

        {detailed ? (
          <>
            <CircuitPicture c={c} sel={sel} locked={locked} paused={paused} busy={pause.pending || resume.pending} cxRef={cx}
              onSelect={inspect} onBreaker={breaker} onKeyDown={onArrows} />
            {c.unknowns.length ? (
              <Section title="Can’t tell yet" end="shown dashed, never as working">
                <Group>
                  {c.unknowns.map((u) => (
                    <div key={u.title} className="ui-row"><span className="mk o" aria-hidden="true">?</span><span className="lbl">{u.title}</span><span className="tx">{u.why}</span>
                      <span className="end"><Chip tone="dashed">unknown</Chip><Btn kind="plain" sm onClick={() => inspect(u.part)} aria-label={`Show ${u.title}`}>Show ›</Btn></span></div>
                  ))}
                </Group>
              </Section>
            ) : null}
          </>
        ) : (
          <>
            <div className="su-list" role="list" aria-label="Setup steps">
              <StepRow {...stepKey} /><StepRow {...stepRules} /><StepRow {...stepEngine} />
            </div>
            <h3 className="su-h">Also here</h3>
            <div className="su-list" role="list" aria-label="Other settings">
              <StepRow {...stepAgents} /><StepRow {...stepLock} /><StepRow {...stepHouse} /><StepRow {...stepMarket} />
            </div>
            <h3 className="su-h">How your money is protected</h3>
            <ol className="su-chain" aria-label="How your money is protected">
              <ChainLink icon="agent" title="Your agents" text="suggest and bargain, never pay" />
              <ChainLink icon="rules" title="Your rules" text="refuse anything outside your limits" />
              <ChainLink icon="you" title="You" text="approve what pays" />
              <ChainLink icon="bank" title="PayPal" text="moves money only after that" />
            </ol>
          </>
        )}
        {pickAt ? <Popover anchor={pickAt} onClose={() => setPickAt(null)} title="Agent app" className="setup-pop wide">{enginePicker()}</Popover> : null}
      </div>

      {detailed ? (
        <aside className="ui-inspector cx-insp" aria-label={`Details · ${PART_NAME[sel]}`} aria-live="polite">
          {inspectorFor(sel)}
        </aside>
      ) : null}
    </div>
  );

  // A render function, not a component: a nested component would remount (and close its popovers)
  // on every render, and the clock re-renders this view every second.
  function inspectorFor(part: PartId): ReactNode {
    const p = c.parts[part];
    const head = (sub: ReactNode, details: ReactNode) => (
      <>
        <div className="insp-head"><ToneChip tone={p.chip.tone}>{p.chip.text}</ToneChip><span className="ui-spacer" /><Info label={`${PART_NAME[part]} · details`} text="Details…">{details}</Info></div>
        <h2>{PART_NAME[part]}</h2>
        <div className="ui-hint">{sub}</div>
      </>
    );
    switch (part) {
      case 'agents': return (
        <>
          {head('they suggest and bargain · they never pay · your rules check them first', (
            <Kv items={[['Pause', 'stops their work at once · one click, no confirmation'], ['Still runs', 'deadlines and their safe defaults (holds released, offers lapse)'], ['Resume', 'you restart each deal yourself'], ['Also in', 'the tray menu and the mini window']]} />
          ))}
          <Group empty={facts.error ? 'Your agents can’t be listed here.' : 'Loading your agents…'}>
            {(f?.agents ?? []).map((a) => (
              <Row key={a.slot} title={<>{a.slot.charAt(0).toUpperCase()}{a.slot.slice(1)} <span className="dim">· {a.engine === 'scripted' ? 'practice agent' : a.engine}</span></>}
                sub={<>{a.does} · {a.mandates.length ? `follows ${rulesName(a.slot).toLowerCase()}` : 'no rules signed for it yet'}</>}>
                <span className="end">{a.running ? <Chip tone={paused ? 'coral' : 'teal'}>{a.running} working</Chip> : <Chip>idle</Chip>}</span>
              </Row>
            ))}
          </Group>
          <Group empty={running === null ? 'Agent activity can’t be read.' : 'No agent is working right now.'}>
            {(running ?? []).slice(0, 6).map((r) => (
              <Row key={r.run} id={w.labels.get(r.deal_id) ?? 'deal'} title={r.engine === 'scripted' ? 'practice agent' : r.engine}>
                <span className="end"><RunBadge run={r} /><Chip tone={paused ? 'coral' : 'teal'}>{r.state === 'starting' ? 'starting' : 'working'}</Chip></span>
              </Row>
            ))}
          </Group>
          <div className="acts">
            {paused ? <Btn kind="primary" sm disabled={resume.pending} onClick={() => void doResume()}>Resume agents</Btn>
              : <Btn sm disabled={pause.pending || !s} onClick={() => void doPause()} title="One click, no confirmation: stopping is always free"><span className="coral" aria-hidden="true">‖</span>Pause all agents</Btn>}
            <WhoChip who="you" />
          </div>
          <div className="ui-section"><Silence text={paused ? 'they stay paused' : 'they keep working inside your rules'}>{paused ? ' · no money moves' : ' · anything outside is refused'}</Silence></div>
        </>
      );
      case 'engine': return (
        <>
          {head('the AI app your agents think with · it never touches money', (
            <>
              <p className="muted">Your agents use an AI app already installed on this computer. “Check again” looks for it.</p>
              <Kv items={(engines.data ?? []).map((e) => [<span key={e.id}>{e.id === 'scripted' ? 'practice agent' : e.id}</span>, e.available ? `ready${e.version ? ` · ${e.version}` : ''}` : `not connected${e.version ? ` · ${e.version}` : ''}${e.reason ? ` · ${e.reason}` : ''}`] as const)} />
              <p className="ui-hint">The practice agent replays recorded answers with no AI model. Changing the app never changes what agents may do.</p>
            </>
          ))}
          {enginePicker()}
          <div className="acts"><WhoChip who="you" /><span className="ui-hint">its AI cost estimate is not a bill</span></div>
          {p.state === 'ok' ? null : <div className="ui-section"><Silence text="no agent app">{' · agents can’t start'}</Silence></div>}
        </>
      );
      case 'mandate': {
        const list = mandates.data ?? [];
        const live = new Set(c.inForce.map((m) => `${m.id}:${m.version}`));
        return (
          <>
            {head('the limits you signed · anything outside them is refused', (
              <>
                <p className="muted">Until you sign rules, every agent request is refused before PayPal is ever asked. Agents can suggest anything; only what fits your rules goes ahead.</p>
                <p className="ui-hint">Each change is a new signed version; the old one stays in your records. You sign in the approval window.</p>
              </>
            ))}
            {mandates.error ? <WalletNotice error={mandates.error} what="Your rules" /> : null}
            <Group empty={mandates.data ? 'No rules signed yet.' : 'Loading your rules…'}>
              {list.map((m) => <MandateMini key={`${m.payload.id}-${m.payload.version}`} m={m} live={live.has(`${m.payload.id}:${m.payload.version}`)} />)}
            </Group>
            <div className="acts">
              <Handoff label={c.inForce.length ? 'Change rules' : 'Set your first rules'} kind={c.inForce.length ? 'default' : 'gold'} locked={locked} target="mandate" />
              <WhoChip who="only-you" locked={locked} />
              <Btn kind="plain" sm onClick={onMandates}>All rules ›</Btn>
            </div>
            <div className="ui-section"><Silence text={c.inForce.length ? 'your rules stay as signed' : 'nothing is signed'}>{c.inForce.length ? null : ' · every agent request is refused · PayPal is never asked'}</Silence></div>
          </>
        );
      }
      case 'keychain': return (
        <>
          {head('your keys are locked in Windows, never shown here', (
            <Kv items={[['Typed into', 'a Windows dialog the wallet opens, never this window'], ['Kept in', 'Windows’ own key store · never a file, a log or an agent'], ['This window sees', 'only “saved” or “not saved”'], ['Who', 'only you, in the approval window · Windows Hello after 15 quiet minutes'], ['Market key', 'without it, items show no typical price']]} />
          ))}
          <Group>
            <CredRow name="PayPal (sandbox)" stored={s ? s.payment_executor_configured : null} storedAt={f?.credentials.find((c) => c.kind === 'paypal_sandbox')?.stored_at ?? null} locked={locked} required />
            <CredRow name="Market prices" stored={s ? s.channel3_configured : null} storedAt={f?.credentials.find((c) => c.kind === 'channel3')?.stored_at ?? null} locked={locked} />
          </Group>
          <div className="acts"><WhoChip who="only-you" locked={locked} /><span className="ui-hint">typed into a Windows dialog</span></div>
          <div className="ui-section"><Silence text={s?.payment_executor_configured ? 'your saved keys stay' : 'nothing is saved'}>{s?.payment_executor_configured ? null : ' · PayPal is never called'}</Silence></div>
        </>
      );
      case 'paypal': return (
        <>
          {head('the only place money moves · the wallet makes every call, never an agent', <WhoCanSetWhat locked={locked} />)}
          <div className="ui-section-h"><h3>Moves money only on</h3></div>
          <Group>
            <div className="ui-row"><span className="id">1</span><span className="lbl">Your decision</span><span className="tx">approval window</span></div>
            <div className="ui-row"><span className="id">2</span><span className="lbl">A rule you signed</span><span className="tx">e.g. approve on its own below your “ask me above” amount</span></div>
            <div className="ui-row"><span className="id">3</span><span className="lbl">A safe default</span><span className="tx">release a hold or let an offer lapse · never a payment</span></div>
            <div className="ui-row"><span className="id red">✗</span><span className="lbl">An agent</span><span className="tx red">never</span></div>
          </Group>
          {c.breaks.length ? (
            <>
              <div className="ui-section-h sp"><h3>Not called because</h3></div>
              <Group>{c.breaks.map((b) => <Row key={b.key} lead={<span className="mk n" aria-hidden="true">✗</span>} title={b.title} onOpen={() => inspect(b.part)} />)}</Group>
            </>
          ) : null}
          <div className="ui-section"><Kv items={[['Mode', s ? <ModeBadge mode={s.mode} /> : <Chip tone="dashed">unknown</Chip>], ['Connection', <><Chip tone="dashed">unknown</Chip> <span className="dim">not tested live</span></>]]} /></div>
          <div className="ui-section"><Silence text={c.breaks.length ? 'PayPal is not called' : 'nothing pays on its own'} /></div>
        </>
      );
      case 'house': {
        const h = s?.house;
        return (
          <>
            {head('a practice shop that is always there · sells only to you, in sandbox money', (
              <Kv items={[['Identity', 'built into this app · you still match its words once'], ['Sleeps', 'when nobody uses it · waking takes about a minute'], ['Wakes', 'when you open a table with it (Connections · House seller)'], ['If it is slow', 'just try again; nothing is lost']]} />
            ))}
            <div className="ui-section"><Kv items={[['Now', h === 'unavailable' ? 'not part of this version' : h === 'idle' ? 'asleep · wakes when you open a table' : h === 'waking' ? 'waking up · about 1 min' : h === 'ready' ? 'awake · answers at once' : <Chip tone="dashed">unknown</Chip>], ['Who', <WhoChip who="you" key="w" />]]} /></div>
            <div className="acts">{h && h !== 'unavailable' ? <Btn kind={h === 'idle' ? 'primary' : 'default'} sm onClick={() => onPair('house')}>Open a table with it ›</Btn> : null}</div>
            {h === 'ready' ? null : <div className="ui-section"><Silence text="it keeps sleeping">{' · no money moves'}</Silence></div>}
          </>
        );
      }
      case 'lock': return (
        <>
          {head('everything inside the gold frame needs you, unlocked', (
            <Kv items={[['Locks', 'saved keys · rules · connections · approvals · releases · paying on PayPal'], ['Never locks', 'looking around · pausing agents · choosing the agent app · the house seller'], ['After', '15 quiet minutes · PayPal’s own rule · nobody can make it longer'], ['Unlock', 'Windows Hello, in the approval window']]} />
          ))}
          <div className="ui-section"><Kv items={[
            ['Now', locked ? 'locked' : 'unlocked'],
            ['Locks in', f ? (f.lock_in === null ? 'locked now' : <>{Math.max(0, Math.ceil((f.lock_in - Math.max(0, now - factsAt.current)) / 60))} min <span className="dim">· unless you act in the approval window</span></>) : <><Chip tone="dashed">unknown</Chip> <span className="dim">{facts.error ? 'can’t be read' : 'loading…'}</span></>],
            ['Who', <><WhoChip who="fixed" /> <span className="dim">15 min · PayPal’s rule</span></>],
            ['Windows Hello', s ? (s.native_reauth_available ? 'available on this computer' : 'not available on this computer') : <Chip tone="dashed">unknown</Chip>],
          ]} /></div>
          {locked ? (
            <>
              <div className="acts"><Handoff label="Unlock with Windows Hello" locked={locked} target="unlock" /></div>
              <div className="ui-section"><Silence text="it stays locked">{' · no money moves'}</Silence></div>
            </>
          ) : null}
        </>
      );
    }
  }
}

function CircuitPicture({ c, sel, locked, paused, busy, cxRef, onSelect, onBreaker, onKeyDown }: {
  c: Circuit; sel: PartId; locked: boolean; paused: boolean; busy: boolean; cxRef: RefObject<HTMLDivElement | null>;
  onSelect: (p: PartId) => void; onBreaker: () => void; onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const node = (id: Exclude<PartId, 'lock'>, end?: boolean) => {
    const p = c.parts[id];
    return (
      <button type="button" className={`node n-${id} st-${p.state} ${c.powered[id] ? '' : 'unpowered'} ${end ? 'end' : ''}`} data-part={id}
        aria-pressed={sel === id} tabIndex={sel === id ? 0 : -1} onClick={() => onSelect(id)} aria-label={`${PART_NAME[id]}: ${p.value} · ${p.chip.text}`} title={`${PART_NAME[id]}: ${p.value}`}>
        <span className="k">{PART_NAME[id]}</span><span className="v">{p.value}</span><ToneChip tone={p.chip.tone}>{p.chip.text}</ToneChip>
      </button>
    );
  };
  return (
    <div className={`cx ${locked ? 'is-locked' : ''}`} role="group" aria-label="How money gets to PayPal, left to right (arrow keys move, P pauses agents)" ref={cxRef} onKeyDown={onKeyDown}>
      <div className="bracket" aria-hidden="true" />
      <button type="button" className="bracket-tag" data-part="lock" aria-pressed={sel === 'lock'} tabIndex={sel === 'lock' ? 0 : -1} onClick={() => onSelect('lock')}
        title="Only you can change what is inside this frame, in the approval window">{locked ? LOCK_SVG : WIN_SVG}only you{locked ? ' · locked' : ''}</button>
      {node('agents')}
      <div className={`wire w1 ${c.wires.w1}`}>
        <button type="button" className="breaker" aria-pressed={paused} disabled={busy || c.wires.w1 === 'unknown'} onClick={onBreaker}
          aria-label={paused ? 'Agents paused: resume agents' : 'Pause all agents'} title={paused ? 'Agents paused · click to resume' : 'Pause all agents (P) · one click, no confirmation'}>
          <BreakerSvg open={paused} />
        </button>
      </div>
      {node('engine')}
      <div className={`wire w2 ${c.wires.w2}`} aria-hidden="true" />
      {node('mandate')}
      <div className={`wire w3 ${c.wires.w3}`} aria-hidden="true" />
      {node('keychain')}
      <div className={`wire w4 ${c.wires.w4}`} aria-hidden="true" />
      {node('paypal', true)}
      <div className={`vwire ${c.wires.house}`} aria-hidden="true" />
      {node('house')}
      <div className="cx-foot ui-hint" aria-hidden="true">
        <span className="lg"><i />connected</span><span className="lg"><i className="cut" />needs fixing</span><span className="lg"><i className="unk" />can’t tell yet</span>
      </div>
    </div>
  );
}

// ---- the checklist rows ---------------------------------------------------------------------------

/** done = a known good fact · todo = missing, needs you · wait = holding for a moment or for you ·
 *  unknown = can't tell yet (dashed, never green) · idle = optional and not set up. */
type StepState = 'done' | 'todo' | 'wait' | 'unknown' | 'idle';
type Step = { state: StepState; icon: IconName; title: string; status: ReactNode; action: ReactNode };
const STEP_WORD: Record<StepState, string> = { done: 'done', todo: 'needs you', wait: 'waiting', unknown: 'not known yet', idle: 'optional' };

function StepRow({ state, icon, title, status, action }: Step) {
  return (
    <div className={`su-step st-${state}`} role="listitem">
      <span className="su-mk" role="img" aria-label={STEP_WORD[state]}><Icon name={icon} size={16} /></span>
      <div className="su-main"><div className="su-t">{title}</div><div className="su-s">{status}</div></div>
      <div className="su-act">{action}</div>
    </div>
  );
}

function ChainLink({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <li className="su-link">
      <span className="su-ci" aria-hidden="true"><Icon name={icon} size={18} /></span>
      <span className="su-ct">{title}</span><span className="su-cd">{text}</span>
    </li>
  );
}

function CredRow({ name, stored, storedAt, locked, required }: { name: string; stored: boolean | null; storedAt: number | null; locked: boolean; required?: boolean }) {
  return (
    <div className="ui-row two">
      <span className="main">
        <span className="t1">{name}{required ? null : <span className="dim"> · optional</span>}</span>
        <span className="t2">{stored === null ? 'can’t tell yet' : stored ? <span className="okc">saved{storedAt ? ` · ${dateLabel(storedAt)}` : ''}</span> : required ? <span className="red">not saved · needed to pay</span> : 'not saved'}</span>
      </span>
      <span className="end">
        {stored === null ? <Chip tone="dashed">unknown</Chip> : <Handoff label={stored ? 'Replace' : 'Save'} kind={stored || !required ? 'default' : 'gold'} locked={locked} target="credentials" />}
      </span>
    </div>
  );
}

function MandateMini({ m, live }: { m: MandateListEntry; live: boolean }) {
  return (
    <div className="ui-row">
      <span className="main"><span className="t1">{rulesName(m.agent)}</span></span>
      <span className="end">{live ? <Chip tone="ok">active until {new Date(m.payload.expires * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Chip> : <Chip>not active</Chip>}</span>
    </div>
  );
}

function WhoCanSetWhat({ locked }: { locked: boolean }) {
  const r = (a: string, b: string, c?: ReactNode) => (
    <div className="ui-row"><span className="lbl">{a}</span><span className="tx">{b}</span>{c ?? <Chip tone="red">agents: never</Chip>}</div>
  );
  return (
    <div className="who">
      <div className="ui-section-h"><h3>Only you · in the approval window{locked ? ' · locked' : ''}</h3></div>
      <Group>
        {r('PayPal key', 'typed into a Windows dialog')}
        {r('Market prices key', 'typed into a Windows dialog')}
        {r('Agent rules', 'sign, change, cancel', <Chip tone="red">agents: only suggest</Chip>)}
        {r('Connection words', 'confirms who you deal with')}
        {r('Unlock after 15 quiet min', 'Windows Hello')}
      </Group>
      <div className="ui-section-h sp"><h3>You · here in The Table</h3></div>
      <Group>
        {r('Agent app', 'Settings')}
        {r('Pause or resume agents', 'here, the tray or the mini window')}
        {r('Open a table with the house seller', 'Connections', <Chip tone="line">agents: inside a table</Chip>)}
      </Group>
      <div className="ui-section-h sp"><h3>Fixed</h3></div>
      <Group>
        {r('Lock after', '15 quiet min · PayPal’s rule')}
        {r('Sandbox or live', 'set by the app version')}
        {r('House seller identity', 'built into the app')}
      </Group>
      <div className="ui-section-h sp"><h3>Money moves only on</h3></div>
      <Group>
        <div className="ui-row"><span className="id">1</span><span className="tx">your decision in the approval window</span></div>
        <div className="ui-row"><span className="id">2</span><span className="tx">a rule you signed</span></div>
        <div className="ui-row"><span className="id">3</span><span className="tx">a safe default: release a hold or let an offer lapse, never a payment</span></div>
        <div className="ui-row"><span className="id red">✗</span><span className="tx red">an agent: it has no tool that moves money</span></div>
      </Group>
    </div>
  );
}
