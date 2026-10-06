// Owner configuration mode: the approval window opened with deal_id=null (also first run).
// A calm checklist on the v2 kit - unlock, keys (native dialog only), agent app (read-only),
// house seller, agent rules (opens the What-if editor), pairing (opens the four-word confirm). Layer 1 is
// one row per item; explanations sit in popovers. Nothing here pays anyone.
import { useEffect, useState } from 'react';
import type { CredentialArgs } from '@bindings/CredentialArgs';
import type { Clause } from '@bindings/Clause';
import type { HouseState } from '@bindings/HouseState';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { WalletError } from '../../lib/contract';
import { useNow, useQuery } from '../../lib/hooks';
import { rulesName, timeLeftWords } from '../../lib/words';
import { WalletNotice } from '../../shared/honesty';
import { AnswerBar, Btn, Chip, Group, Hint, Popover, Row, Section, type ChipTone } from '../../shared/ui';
import { MandateEditor } from './MandateEditor';
import { clauseText, isMandateActive } from './model';
import { PairingConfirm } from './PairingConfirm';
import { useHandoff } from './selection';
import { useSession } from './session';
import { Header, LockCard } from './ui';
import './owner.css';

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
} as const;
type InfoKey = keyof typeof INFO;

const TARGET_TEXT = { credentials: 'save a key', mandate: 'sign rules', unlock: 'unlock with Windows Hello' } as const;

export function OwnerConfig({ hint }: { hint: string | null }) {
  const s = useSession();
  const now = useNow();
  // What The Table opened this window for (approval_handoff); a mandate target opens the editor
  // once, pre-filled with a floor draft when one came along.
  const handoff = useHandoff();
  const floorSeed = handoff?.draft?.type === 'floor' ? handoff.draft : null;
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  // Subscribe, then fetch: the pending pairing Rust selected for this window (null = none).
  const pairing = useQuery('approval_pairing', null, { refreshOn: ['settings:changed'] });
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
  useEffect(() => {
    if (routed || !handoff) return;
    setRouted(true);
    if (handoff.target === 'mandate') setEditing({ sel: floorSeed?.mandate_id ?? null });
  }, [handoff, routed, floorSeed]);
  const [info, setInfo] = useState<{ k: InfoKey; el: HTMLElement } | null>(null);
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
    return (
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

  const active = list.filter((m) => isMandateActive(m, now));
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
        <h1 className="sr-only">{st?.first_run ? 'Welcome: set up your wallet' : 'Wallet setup'}</h1>
        <div className="ow-answer">
          <AnswerBar
            tone={left.length ? 'need' : 'done'}
            icon={left.length ? 'you' : 'shield'}
            title={left.length ? `${left.length} ${left.length === 1 ? 'thing' : 'things'} left to set up` : 'Your wallet is ready'}
            sub={left.length ? `Still to do: ${left.join(', ')}.${st?.first_run ? ' Agents can’t start until then.' : ''}` : 'Nothing to approve right now.'}
          />
        </div>
        <div className="ow-progress" role="img" aria-label={`${readyCount} of ${steps.length} set up`}>
          {steps.map((ok, n) => <i key={n} className={ok ? 'on' : ''} />)}
          <span>{readyCount} of {steps.length} set up · nothing on this page pays anyone</span>
        </div>
        {hint ? <Hint>{hint}</Hint> : null}
        {handoff?.target === 'credentials' || handoff?.target === 'unlock' ? <Hint>The Table opened this window to {TARGET_TEXT[handoff.target]}.</Hint> : null}
        {s.settingsError ? <WalletNotice error={s.settingsError} what="Settings can’t be read" /> : null}
        {!s.tokenReady && s.tokenError ? <WalletNotice error={s.tokenError} what="This window can’t approve right now" /> : null}

        <Section title="Wallet" end={i('unlock')}>
          <Group>
            <Row title="Unlock" sub={locked ? 'Changes here ask for Windows Hello' : 'Locks again after 15 quiet minutes'} need={locked}>
              {locked ? <Chip tone="gold">locked</Chip> : <Chip tone="ok">unlocked</Chip>}
            </Row>
            <Credential kind="paypal_sandbox" name="PayPal connection" what="your PayPal sandbox app keys" stored={!!st?.payment_executor_configured} locked={locked} />
            <Credential kind="channel3" name="Market prices" what="the key for comparing prices" stored={!!st?.channel3_configured} locked={locked} />
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

        <Section title="Agent rules" end={<>{i('mandates')}<Btn kind={active.length ? 'default' : 'gold'} sm onClick={() => setEditing({ sel: null })}>{active.length ? 'New rules…' : 'Sign your first rules…'}</Btn></>}>
          {mandates.error ? <WalletNotice error={mandates.error} what="Agent rules" /> : null}
          <Group empty={mandates.loading ? 'Reading your rules…' : 'No rules signed yet, so agents can’t do anything.'}>
            {list.map((m) => <MandateRow key={`${m.payload.id}:${m.payload.version}`} m={m} now={now} onOpen={() => setEditing({ sel: m.payload.id })} />)}
          </Group>
        </Section>

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
      </main>
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
  const live = isMandateActive(m, now);
  // The two or three limits that say the most, in plain words; ids and keys live in the editor.
  const KEY: Clause['type'][] = ['per_deal', 'band', 'human_present_over', 'velocity', 'payees'];
  const key = KEY.map((t) => p.clauses.find((c) => c.type === t)).filter((c): c is Clause => !!c).slice(0, 3);
  const name = rulesName(m.agent);
  return (
    <Row
      title={<>{name} <span className="dim">· updated {new Date(p.not_before * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></>}
      sub={key.map(clauseText).join(' · ')}
      onOpen={onOpen}
      label={`Open ${name} to see or change them`}
    >
      <Chip tone={live ? 'ok' : 'line'}>{live ? `in force · ${timeLeftWords(p.expires - now)} left` : p.not_before > now ? 'not started yet' : 'expired'}</Chip>
    </Row>
  );
}

function Credential({ kind, name, what, stored, locked }: { kind: CredentialArgs; name: string; what: string; stored: boolean; locked: boolean }) {
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
      <Row title={name} sub={done ? 'Saved securely on this computer' : stored ? `${what} · saved securely on this computer` : `${what} · not saved yet`} need={!stored}>
        <Chip tone={stored ? 'ok' : 'gold'}>{stored ? 'connected' : 'needed'}</Chip>
        <Btn kind="plain" sm icon aria-label={`About ${name}`} aria-haspopup="dialog" onClick={(e) => { const el = e.currentTarget; setA((x) => (x ? null : el)); }}>ⓘ</Btn>
        <Btn sm kind={stored ? 'default' : 'gold'} locked={locked} disabled={locked || !s.tokenReady || s.pending !== null} onClick={() => void run()}>
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
