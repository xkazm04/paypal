// Owner configuration mode: the approval window opened with deal_id=null (also first run).
// A calm checklist on the v2 kit - unlock, keys (native dialog only), agent app (read-only),
// house seller, agent rules (opens the What-if editor), pairing (opens the four-word confirm). Layer 1 is
// one row per item; explanations sit in popovers. Nothing here pays anyone.
import { Suspense, useEffect, useState } from 'react';
import type { CredentialArgs } from '@bindings/CredentialArgs';
import type { Deal } from '@bindings/Deal';
import type { Clause } from '@bindings/Clause';
import type { HouseState } from '@bindings/HouseState';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { WalletError } from '../../lib/contract';
import { useNow, useQuery } from '../../lib/hooks';
import { lazyPart, preloadWhenIdle } from '../../lib/lazy';
import { FIRST_RUN_TITLE, OWNER_KEY, rulesName, SAFETY_PROMISE, START_STEP, timeLeftWords, watchingWords, type StartStepKey } from '../../lib/words';
import { connectionFacts, gettingStarted, rulesInForce } from '../../lib/firstRun';
import { StartProgress, StartSteps, type StepAction } from '../../shared/start';
import { NO_LONGER_FITS, WalletNotice } from '../../shared/honesty';
import { OwnerKey } from '../../shared/ownerKey';
import { AnswerBar, Btn, Chip, Group, Hint, Popover, Row, Section, type ChipTone } from '../../shared/ui';
import { clauseText, isMandateActive } from './model';
import { PairingConfirm } from './PairingConfirm';
import { WalletLimits } from './owner/WalletLimits';
import { rescueRules } from './owner/replay';
import { useHandoff } from './selection';
import { useSession } from './session';
import { Header, LockCard } from './ui';
import './owner.css';

// The rules editor (with its what-if) and the replay sheet are their own chunks, preloaded once
// this page is idle (lib/lazy.ts).
const MandateEditor = lazyPart(() => import('./MandateEditor').then((m) => m.MandateEditor));
const RescueReplay = lazyPart(() => import('./owner/RescueReplay').then((m) => m.RescueReplay));
const RescueWatch = lazyPart(() => import('./owner/RescueWatch').then((m) => m.RescueWatch));

const ENGINE_NAME = { 'claude-code': 'claude-code', 'codex-cli': 'codex-cli', scripted: 'practice agent' } as const;
const HOUSE_TEXT: Record<HouseState, string> = {
  unavailable: 'not included in this version',
  idle: 'wakes up when you join its table',
  waking: 'waking up, about a minute',
  ready: 'open for business',
};
const HOUSE_WORD: Record<HouseState, string> = { unavailable: 'not available', idle: 'asleep', waking: 'waking up', ready: 'ready' };
const HOUSE_TONE: Record<HouseState, ChipTone> = { unavailable: 'line', idle: 'line', waking: 'gold', ready: 'ok' };
/** approval_pairing answers null once a pairing expires; re-ask now and then while one is shown. */
const PAIRING_RECHECK_MS = 30_000;

const INFO = {
  unlock: 'Signing rules, saving keys and connecting wallets ask for Windows Hello first. Like PayPal, the wallet locks again after 15 quiet minutes. You can always look around.',
  creds: 'A Windows dialog asks for each key and saves it in your computer’s secure store. Nothing is typed into this window, and the key never shows up here.',
  engine: 'The agent app is chosen in The Table, under Settings. This window only shows which one is in use.',
  house: 'A demo shop that is always open, built into this app. Join its table from The Table, then confirm its four words here.',
  mandates: 'What each agent may do without asking you. Open a set of rules to see how this week would have gone under a change, before you sign it. Withdrawn rules stop every agent that used them.',
  pairing: 'Connecting starts in The Table: one of you creates a code, the other joins it. Then each of you checks the same four words here, in your own approval window.',
  key: 'Your rules and approvals are signed with your owner key, which never leaves this computer. Its id is public: a proof file names it, so whoever checks one compares it with the id you send them.',
} as const;
type InfoKey = keyof typeof INFO;

const TARGET_TEXT = { credentials: 'save a key', mandate: 'sign rules', unlock: 'unlock with Windows Hello' } as const;

export function OwnerConfig({ hint, onReplayed }: { hint: string | null; /** A replayed renewal opened its fix: review it here. */ onReplayed?: (deal: Deal) => void }) {
  const s = useSession();
  const now = useNow();
  // What The Table opened this window for (approval_handoff); a mandate target opens the editor
  // once, pre-filled with a floor draft when one came along.
  const handoff = useHandoff();
  const floorSeed = handoff?.draft?.type === 'floor' ? handoff.draft : null;
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  // The wallet limits and today's meters (envelope_get): limits and numbers only.
  const limits = useQuery('envelope_get', null, { refreshOn: ['settings:changed'] });
  // Subscribe, then fetch: the pending pairing Rust selected for this window (null = none).
  const pairing = useQuery('approval_pairing', null, { refreshOn: ['settings:changed'] });
  // Who is connected (first run: has the house seller been connected yet?).
  const connections = useQuery('counterparty_list', null, { refreshOn: ['settings:changed'] });
  // Read-only owner facts: here, the owner's public key id for Details.
  const facts = useQuery('owner_facts', null, { refreshOn: ['settings:changed'] });
  /** Details (Layer 2): the owner's key, shown on request. */
  const [details, setDetails] = useState(false);
  const pendingPairing = pairing.data;
  const refetchPairing = pairing.refetch;
  useEffect(() => {
    if (!pendingPairing) return;
    const t = setInterval(() => void refetchPairing(), PAIRING_RECHECK_MS);
    return () => clearInterval(t);
  }, [pendingPairing, refetchPairing]);
  // Once a pairing was handed over, keep its ceremony on screen (and mounted, so its verdict
  // survives approval_pairing turning null after the confirmation) until the owner leaves it.
  const [focusPairing, setFocusPairing] = useState(false);
  useEffect(() => {
    if (pendingPairing) setFocusPairing(true);
  }, [pendingPairing]);
  /** null = configuration; otherwise the What-if editor on a mandate id (null id = new). */
  const [editing, setEditing] = useState<{ sel: string | null } | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [routed, setRouted] = useState(false);
  /** The "Replay a failed renewal" sheet (The Table's Rescue page opens this window for it). */
  const [replaying, setReplaying] = useState(false);
  useEffect(() => preloadWhenIdle([MandateEditor, RescueReplay]), []);
  /** The "Watch subscriptions" sheet (the Rescue page opens this window for it too). */
  const [watchingOpen, setWatchingOpen] = useState(false);
  // The owner's watch list (rescue_book), read here for its count and rows.
  const rescueBook = useQuery('rescue_book', null, { refreshOn: ['deal:changed', 'settings:changed'] });
  const watching = rescueBook.data?.watching ?? [];
  useEffect(() => {
    if (routed || !handoff) return;
    setRouted(true);
    if (handoff.target === 'mandate') setEditing({ sel: floorSeed?.mandate_id ?? null });
    if (handoff.target === 'rescue') setReplaying(true);
    if (handoff.target === 'rescue_watch') setWatchingOpen(true);
  }, [handoff, routed, floorSeed]);
  const [info, setInfo] = useState<{ k: InfoKey; el: HTMLElement } | null>(null);
  const [startError, setStartError] = useState<WalletError | null>(null);
  const st = s.settings;
  const locked = s.settingsLocked || s.lockedByError;
  const list = mandates.data ?? [];

  // After a revoke, mandate_list drops that row: move the editor to the next mandate.
  useEffect(() => {
    if (!leaving || list.some((m) => m.payload.id === leaving)) return;
    setLeaving(null);
    setEditing((e) => (e && e.sel === leaving ? { sel: list[0]?.payload.id ?? null } : e));
  }, [leaving, list]);

  if (editing) {
    // Only if the editor is opened before its chunk arrived: the editor's frame, empty.
    const waiting = (
      <div className="aw ow ow-ed">
        <Header mode={st?.mode} />
        <main className="aw-body ow-body" aria-busy="true" />
      </div>
    );
    return (
      <Suspense fallback={waiting}>
      <MandateEditor
        mode={st?.mode}
        entries={list}
        seedFloor={floorSeed}
        selected={editing.sel}
        onSelect={(sel) => setEditing({ sel })}
        onClose={() => setEditing(null)}
        onSigned={(m) => {
          void mandates.refetch().then(() => setEditing({ sel: m.payload.id }));
          void s.refreshSettings();
        }}
        onRevoked={() => {
          setLeaving(editing.sel);
          void mandates.refetch();
          void s.refreshSettings();
        }}
      />
      </Suspense>
    );
  }

  const pairingView = (
    <PairingConfirm pending={pairing.loading && pairing.data === undefined ? undefined : pairing.data ?? null} readError={pairing.error} onSettled={() => void refetchPairing()} />
  );

  // Main handed a pending pairing to this window: the four words are the only thing to do here.
  if (focusPairing) {
    return (
      <div className="aw ow ow-cfg">
        <Header mode={st?.mode} />
        <main className="aw-body ow-body">
          <div className="ow-kick">
            <span>Connect a wallet{pendingPairing?.house ? ' · house seller' : ''}</span>
            <Btn kind="plain" sm onClick={() => setFocusPairing(false)}>Wallet setup ›</Btn>
          </div>
          {!s.tokenReady && s.tokenError ? <WalletNotice error={s.tokenError} what="This window can’t approve right now" /> : null}
          {pairingView}
        </main>
      </div>
    );
  }

  const active = list.filter((m) => isMandateActive(m, now) && !m.refusal);
  // First run: the same steps as The Table (lib/firstRun.ts), with the next one in gold.
  const gs = gettingStarted({
    firstRun: st ? st.first_run : null, paypal: st ? st.payment_executor_configured : null,
    rulesInForce: rulesInForce(mandates.data, now), ...connectionFacts(connections.data), engine: st ? st.selected_engine : null,
  });
  const first = gs.show;
  const saveKeys = async () => {
    setStartError(null);
    const r = await s.call('set_credentials', 'paypal_sandbox', true);
    if (!r.ok) setStartError(r.error);
    await s.refreshSettings();
  };
  const runStep = (k: StartStepKey) => {
    if (locked) { void s.unlock(); return; }
    if (k === 'paypal') void saveKeys();
    else if (k === 'rules') setEditing({ sel: null });
  };
  const stepAction = (k: StartStepKey): StepAction => (k === 'practice' || k === 'engine' ? null : {
    label: locked ? 'Unlock first' : k === 'paypal' ? 'Add keys…' : 'Choose rules…',
    title: locked ? 'Unlock with Windows Hello first' : k === 'paypal' ? 'A secure dialog asks for your sandbox keys and saves them on this computer' : 'Start from a ready-made set of rules, check it, then sign',
    run: () => runStep(k),
  });
  const nextStep = gs.next === 'paypal' || gs.next === 'rules' ? gs.next : null;
  const steps = [!locked, !!st?.payment_executor_configured, !!st?.channel3_configured, active.length > 0];
  const readyCount = steps.filter(Boolean).length;
  // What is still missing, in the order the checklist below shows it.
  const left = (['Unlock', 'PayPal connection', 'Market prices', 'Signed rules'] as const).filter((_, n) => !steps[n]);
  const i = (k: InfoKey) => (
    <Btn kind="plain" sm icon aria-label={`About ${k}`} aria-haspopup="dialog" onClick={(e) => { const el = e.currentTarget; setInfo((x) => (x?.k === k ? null : { k, el })); }}>ⓘ</Btn>
  );

  return (
    <div className="aw ow ow-cfg">
      <Header mode={st?.mode} />
      <main className="aw-body ow-body">
        <h1 className="sr-only">{first ? `Welcome: ${FIRST_RUN_TITLE.toLowerCase()}` : 'Wallet setup'}</h1>
        {first ? (
          <>
            <div className="ow-answer">
              <AnswerBar tone="need" icon="shield" title={FIRST_RUN_TITLE} sub={SAFETY_PROMISE}
                // Locked: the lock card below holds the one gold button (Unlock with Windows Hello).
                actions={nextStep && !locked ? (
                  <Btn kind="gold" disabled={!s.tokenReady || s.pending !== null} onClick={() => runStep(nextStep)} title={stepAction(nextStep)?.title}>
                    {s.pending === 'set_credentials' ? 'Dialog open…' : `${START_STEP[nextStep].act}…`}
                  </Btn>
                ) : null} />
            </div>
            <div className="ow-start">
              <StartProgress gs={gs} /><span className="dim">· nothing on this page pays anyone</span>
            </div>
            <StartSteps gs={gs} action={stepAction} className="ow-steps" busy={s.pending === 'set_credentials' ? 'paypal' : null}
              elsewhere={{ practice: 'Next, in The Table: Connections › House seller', engine: 'In The Table: Settings › Agent app' }} />
            {startError ? <WalletNotice error={startError} what={`${START_STEP.paypal.title}: not saved`} /> : null}
          </>
        ) : null}
        {first ? null : <div className="ow-answer">
          <AnswerBar
            tone={left.length ? 'need' : 'done'}
            icon={left.length ? 'you' : 'shield'}
            title={left.length ? `${left.length} ${left.length === 1 ? 'thing' : 'things'} left to set up` : 'Your wallet is ready'}
            sub={left.length ? `Still to do: ${left.join(', ')}.${st?.first_run ? ' Agents can’t start until then.' : ''}` : 'Nothing to approve right now.'}
          />
        </div>}
        {first ? null : (
          <div className="ow-progress" role="img" aria-label={`${readyCount} of ${steps.length} set up`}>
            {steps.map((ok, n) => <i key={n} className={ok ? 'on' : ''} />)}
            <span>{readyCount} of {steps.length} set up · nothing on this page pays anyone</span>
          </div>
        )}
        {hint ? <Hint>{hint}</Hint> : null}
        {(handoff?.target === 'credentials' && !first) || handoff?.target === 'unlock' ? <Hint>The Table opened this window to {TARGET_TEXT[handoff.target]}.</Hint> : null}
        {s.settingsError ? <WalletNotice error={s.settingsError} what="Settings can’t be read" /> : null}
        {!s.tokenReady && s.tokenError ? <WalletNotice error={s.tokenError} what="This window can’t approve right now" /> : null}

        <Section title="Wallet" end={i('unlock')}>
          <Group>
            <Row title="Unlock" sub={locked ? 'Changes here ask for Windows Hello' : 'Locks again after 15 quiet minutes'} need={locked}>
              {locked ? <Chip tone="gold">locked</Chip> : <Chip tone="ok">unlocked</Chip>}
            </Row>
            {/* on first run the PayPal keys are step 1 above; the price key is optional, so never gold then */}
            {first ? null : <Credential kind="paypal_sandbox" name="PayPal connection" what="your PayPal sandbox app keys" stored={!!st?.payment_executor_configured} locked={locked} />}
            <Credential kind="channel3" name="Market prices" what={first ? 'optional · the key for comparing prices' : 'the key for comparing prices'} stored={!!st?.channel3_configured} locked={locked} gold={!first} />
            <Row title="Agent app" sub={st ? `${ENGINE_NAME[st.selected_engine]}${st.agents_paused ? ' · all agents paused' : ''} · change it in The Table` : 'Reading settings…'}>
              <Chip tone={st?.agents_paused ? 'gold' : 'line'}>{st?.agents_paused ? 'paused' : 'in use'}</Chip>
              {i('engine')}
            </Row>
            <Row title="House seller" sub={st ? `${HOUSE_TEXT[st.house]}${st.relay_available ? '' : ' · can’t be reached'}` : 'Reading settings…'}>
              <Chip tone={st ? HOUSE_TONE[st.house] : 'dashed'}>{st ? HOUSE_WORD[st.house] : 'unknown'}</Chip>
              {i('house')}
            </Row>
          </Group>
          {locked ? <LockCard compact /> : null}
        </Section>

        <Section title="Agent rules" end={<>{i('mandates')}<Btn kind={active.length || first ? 'default' : 'gold'} sm onClick={() => setEditing({ sel: null })}>{active.length ? 'New rules…' : 'Sign your first rules…'}</Btn></>}>
          {mandates.error ? <WalletNotice error={mandates.error} what="Agent rules" /> : null}
          <Group empty={mandates.loading ? 'Reading your rules…' : 'No rules signed yet, so agents can’t do anything.'}>
            {list.map((m) => <MandateRow key={`${m.payload.id}:${m.payload.version}`} m={m} now={now} onOpen={() => setEditing({ sel: m.payload.id })} />)}
          </Group>
        </Section>

        <Section title="Failed renewals">
          <Group>
            <Row title="Replay a failed renewal" sub={rescueRules(list, now) ? 'PayPal can’t fail a test renewal, so you can replay one and approve its fix' : 'Sign rules for fixing failed renewals first'}>
              <Chip tone="line">replay</Chip>
              <Btn sm onClick={() => setReplaying(true)}>Replay one…</Btn>
            </Row>
            <Row title={rescueBook.error ? 'Watched subscriptions' : watchingWords(watching.length)}
              sub={rescueBook.error ? 'This window can’t read them right now' : rescueRules(list, now) ? 'Your wallet checks them with PayPal for a failed renewal; checking never moves money' : 'Sign rules for fixing failed renewals first'}>
              <Chip tone={rescueBook.error ? 'dashed' : 'line'}>{rescueBook.error ? 'not available' : 'checks only'}</Chip>
              <Btn sm onClick={() => setWatchingOpen(true)}>{watching.length ? 'Manage…' : 'Watch one…'}</Btn>
            </Row>
          </Group>
        </Section>

        <WalletLimits view={limits.data} error={limits.error} loading={limits.loading} locked={locked}
          currency={active.flatMap((m) => m.payload.clauses).find((c) => c.type === 'per_deal')?.max_amount.currency ?? 'USD'}
          onSigned={() => void limits.refetch()} />

        <Section title="Connections" end={i('pairing')}>
          <Group>
            {pairing.error ? (
              <Row title="Waiting connection" sub="This window can’t read it right now"><Chip tone="dashed">not available</Chip></Row>
            ) : pendingPairing ? (
              <Row title={`Check four words · ${pendingPairing.display_context}`} sub={`${pendingPairing.house ? 'The house seller' : 'Another owner’s wallet'} · if you do nothing, it lapses and nothing is connected`} need onOpen={() => setFocusPairing(true)}>
                <Chip tone="gold">needs you</Chip>
              </Row>
            ) : (
              <Row title="No connection is waiting" sub="Start one in The Table; it brings you back here for the four words">
                <Chip tone="line">none</Chip>
              </Row>
            )}
          </Group>
        </Section>

        <Section title="Details" end={i('key')}>
          <Group>
            <Row title={OWNER_KEY.label} sub="For anyone who checks a proof file you send">
              <Btn sm aria-expanded={details} onClick={() => setDetails((x) => !x)}>{details ? 'Hide' : 'Show'}</Btn>
            </Row>
            {details ? <div className="ow-key"><OwnerKey id={facts.data?.owner_key_id} error={facts.error} heading={false} /></div> : null}
          </Group>
        </Section>
      </main>
      {watchingOpen ? <Suspense fallback={null}><RescueWatch entries={list} watching={watching} locked={locked} onClose={() => setWatchingOpen(false)} onChanged={() => void rescueBook.refetch()} /></Suspense> : null}
      {replaying ? <Suspense fallback={null}><RescueReplay entries={list} locked={locked} onClose={() => setReplaying(false)} onReplayed={(deal) => { setReplaying(false); onReplayed?.(deal); }} /></Suspense> : null}
      {info ? (
        <Popover anchor={info.el} onClose={() => setInfo(null)} className="ow-pop">
          <p className="ow-p">{INFO[info.k]}</p>
        </Popover>
      ) : null}
    </div>
  );
}

function MandateRow({ m, now, onOpen }: { m: MandateListEntry; now: number; onOpen: () => void }) {
  const p = m.payload;
  const live = isMandateActive(m, now) && !m.refusal;
  // The two or three limits that say the most, in plain words; ids and keys live in the editor.
  const KEY: Clause['type'][] = ['per_deal', 'band', 'human_present_over', 'velocity', 'payees'];
  const key = KEY.map((t) => p.clauses.find((c) => c.type === t)).filter((c): c is Clause => !!c).slice(0, 3);
  const name = rulesName(m.agent);
  return (
    <Row
      title={<>{name} <span className="dim">· updated {new Date(p.not_before * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></>}
      sub={m.refusal ? NO_LONGER_FITS : key.map(clauseText).join(' · ')}
      onOpen={onOpen}
      label={`Open ${name} to see or change them`}
    >
      <Chip tone={live ? 'ok' : m.refusal ? 'gold' : 'line'}>{live ? `in force · ${timeLeftWords(p.expires - now)} left` : m.refusal ? 'needs signing again' : p.not_before > now ? 'not started yet' : 'expired'}</Chip>
    </Row>
  );
}

function Credential({ kind, name, what, stored, locked, gold = true }: { kind: CredentialArgs; name: string; what: string; stored: boolean; locked: boolean; /** Gold while missing (off when it is optional). */ gold?: boolean }) {
  const s = useSession();
  const [error, setError] = useState<WalletError | null>(null);
  const [done, setDone] = useState(false);
  const [a, setA] = useState<HTMLElement | null>(null);
  const run = async () => {
    setError(null);
    setDone(false);
    const r = await s.call('set_credentials', kind, true);
    if (r.ok) setDone(true);
    else setError(r.error);
    await s.refreshSettings();
  };
  return (
    <>
      <Row title={name} sub={done ? 'Saved securely on this computer' : stored ? `${what} · saved securely on this computer` : `${what} · not saved yet`} need={!stored && gold}>
        <Chip tone={stored ? 'ok' : gold ? 'gold' : 'line'}>{stored ? 'connected' : gold ? 'needed' : 'not set'}</Chip>
        <Btn kind="plain" sm icon aria-label={`About ${name}`} aria-haspopup="dialog" onClick={(e) => { const el = e.currentTarget; setA((x) => (x ? null : el)); }}>ⓘ</Btn>
        <Btn sm kind={stored || !gold ? 'default' : 'gold'} locked={locked} disabled={locked || !s.tokenReady || s.pending !== null} onClick={() => void run()}>
          {s.pending === 'set_credentials' ? 'Dialog open…' : stored ? 'Replace…' : 'Add…'}
        </Btn>
      </Row>
      {error ? <WalletNotice error={error} what={`${name} not saved`} /> : null}
      {a ? (
        <Popover anchor={a} onClose={() => setA(null)} title={name} className="ow-pop">
          <p className="ow-p">{INFO.creds}</p>
        </Popover>
      ) : null}
    </>
  );
}
