// Connections (#p=connections) and Connect a wallet (#p=pairing), layers of the one main window
// (rebuild WP3c). Connections answers "is PayPal connected?" and has four cards: PayPal and your
// keys (saved or not, never the secret; Save/Replace hand off to the approval window), the agent
// app (engine_status, engine_select: the old picker), the house seller (house_wake, open a table
// with it) and who you deal with (the counterparty list, windowed, searchable). "Connect a wallet"
// opens the pairing desk one layer down; only its final confirm hands off. Nothing here moves money.
import { useMemo, useState } from 'react';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { EngineId } from '@bindings/EngineId';
import type { HouseState } from '@bindings/HouseState';
import type { MarketWatchFact } from '@bindings/MarketWatchFact';
import { formatCount } from '../../../../../lib/data/counts';
import { clockLabel } from '../../../../../lib/format';
import { useMutation, useQuery } from '../../../../../lib/hooks';
import { watchLine } from '../../../../../lib/marketWatch';
import {
  CONNECTIONS_ANSWER, CONNECTIONS_CARD, CONNECTIONS_ENGINE, CONNECTIONS_HOUSE, CONNECTIONS_KICKER, CONNECTIONS_PAIR, CONNECTIONS_PAYPAL, CONNECTIONS_PEOPLE, houseWords, KEEP_PRACTICE_AGENT, LATEST_OF, modeWord, NOTICE_WHAT, PRICE_CHECKS_USED_UP, reasonWords,
} from '../../../../../lib/words';
import { ModeBadge, WalletNotice } from '../../../../../shared/honesty';
import { OwnerKey } from '../../../../../shared/ownerKey';
import { Btn, Chip, Kv, Silence, useToast } from '../../../../../shared/ui';
import { pairingFact } from '../../../logic';
import type { PairMode } from '../../../setup/pairing';
import { useSettings } from '../../../world';
import type { LayerProps } from '../../layers';
import { Latest, MAX_ROWS } from '../../Latest';
import { ListEngine, type ListFilter, type ListSort } from '../../ListEngine';
import { WhoChip } from '../../rows';
import { fitHeight, PlaceFrame, type CallLine, type LensCard } from '../settings/frame';
import { ToApproval } from '../settings/handoff';
import { PairingDesk } from './PairingDesk';
import '../../../../../shared/ownerKey.css';

const dateLabel = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const engineName = (id: EngineId): string => (id === 'scripted' ? CONNECTIONS_ENGINE.practiceShort : id);

export function ConnectionsLayer({ route, nav, state }: LayerProps) {
  if (route.level === 'place' && route.place === 'pairing') return <PairingLayer start={state.pairMode} nav={nav} />;
  return <Connections nav={nav} />;
}

function PairingLayer({ start, nav }: { start: PairMode | undefined; nav: LayerProps['nav'] }) {
  const [mode, setMode] = useState<PairMode>(start ?? 'create');
  // Under the desk, quietly: the wallets already connected (newest first), each a way to the full list.
  const cps = useQuery('counterparty_list', null, { refreshOn: ['pairing:pinned', 'settings:changed'] });
  const people = useMemo(() => [...(cps.data ?? [])].sort((a, b) => b.first_seen - a.first_seen), [cps.data]);
  const toAll = () => nav.place('connections');
  return (
    <div className="pf ar-connections pd-layer" data-place="pairing">
      <PairingDesk mode={mode} setMode={setMode} asLayer />
      {cps.data ? (
        <Latest title={LATEST_OF.people} total={people.length} empty={CONNECTIONS_PEOPLE.empty}
          rows={people.slice(0, MAX_ROWS).map((c) => ({ key: c.key_id, label: houseWords(c.display_name), onOpen: toAll, node: <PersonRow c={c} /> }))}
          seeAll={{ onOpen: toAll, fk: 'to-connections' }} />
      ) : null}
    </div>
  );
}

function Connections({ nav }: { nav: LayerProps['nav'] }) {
  const settings = useSettings();
  const s = settings.data;
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const facts = useQuery('owner_facts', null, { refreshOn: ['settings:changed', 'agent:changed'] });
  const cps = useQuery('counterparty_list', null, { refreshOn: ['pairing:pinned', 'settings:changed'] });
  const keyAt = facts.data?.credentials.find((x) => x.kind === 'paypal_sandbox')?.stored_at ?? null;
  const marketAt = facts.data?.credentials.find((x) => x.kind === 'channel3')?.stored_at ?? null;

  const answer = !s ? { title: CONNECTIONS_ANSWER.reading, sub: CONNECTIONS_ANSWER.readingSub }
    : !s.payment_executor_configured ? { title: CONNECTIONS_ANSWER.noKey, sub: CONNECTIONS_ANSWER.noKeySub }
      : { title: CONNECTIONS_ANSWER.ready(modeWord(s.mode)), sub: CONNECTIONS_ANSWER.readySub };
  const call: CallLine | null = s && !s.payment_executor_configured
    ? { ifNothing: CONNECTIONS_ANSWER.ifNoKey, action: <ToApproval label={CONNECTIONS_PAYPAL.save} target="credentials" title={CONNECTIONS_PAYPAL.saveTitle} /> }
    : null;

  const picked = engines.data?.find((e) => e.id === s?.selected_engine);
  const engineReady = !!picked?.available;
  const list = cps.data ?? null;
  const verified = list ? list.filter((c) => c.pairing !== 'unpaired').length : null;

  const cards: LensCard[] = [
    {
      id: 'paypal', label: CONNECTIONS_CARD.paypal,
      value: !s ? null : s.payment_executor_configured ? CONNECTIONS_PAYPAL.saved : CONNECTIONS_PAYPAL.notSaved,
      note: s ? <>{modeWord(s.mode)} · {CONNECTIONS_PAYPAL.notTested}</> : undefined,
      ifNothing: s && !s.payment_executor_configured ? CONNECTIONS_ANSWER.ifNoKey : undefined,
      view: { title: CONNECTIONS_PAYPAL.view, sub: CONNECTIONS_PAYPAL.sub, render: () => <PaypalView keyAt={keyAt} marketAt={marketAt} ownerKey={facts.data?.owner_key_id} factsError={facts.error} watch={facts.data?.market_watch ?? []} /> },
    },
    {
      id: 'engine', label: CONNECTIONS_CARD.engine,
      value: !s || !engines.data ? null : engineReady && s ? CONNECTIONS_ENGINE.valueReady(engineName(s.selected_engine)) : CONNECTIONS_ENGINE.valueOff,
      note: engines.data ? (engineReady ? CONNECTIONS_ENGINE.noteReady : CONNECTIONS_ENGINE.noteOff) : undefined,
      chip: engines.data && !engineReady ? CONNECTIONS_ENGINE.chipOff : undefined, chipTone: 'dashed',
      view: { title: CONNECTIONS_ENGINE.view, sub: CONNECTIONS_ENGINE.sub, render: () => <EngineView /> },
    },
    {
      id: 'house', label: CONNECTIONS_CARD.house,
      value: s ? CONNECTIONS_HOUSE.value[s.house] : null,
      note: s ? <>{CONNECTIONS_HOUSE.note[s.house]} · {s.house_connected ? CONNECTIONS_HOUSE.connected : CONNECTIONS_HOUSE.notConnected}</> : undefined,
      view: { title: CONNECTIONS_HOUSE.view, sub: CONNECTIONS_HOUSE.sub, render: () => <HouseView house={s?.house} onOpen={() => nav.place('pairing', { pair: 'house' })} /> },
    },
    {
      id: 'people', label: CONNECTIONS_CARD.people,
      value: list === null ? null : list.length === 0 ? CONNECTIONS_PEOPLE.none : list.length === 1 ? CONNECTIONS_PEOPLE.one : CONNECTIONS_PEOPLE.value(formatCount(list.length)),
      note: verified !== null && list?.length ? CONNECTIONS_PEOPLE.note(formatCount(verified)) : undefined,
    },
  ];

  return (
    <PlaceFrame root="ar-connections" place="connections" kicker={CONNECTIONS_KICKER} answer={answer.title} sub={answer.sub} call={call} cards={cards}
      action={<Btn kind={call ? 'default' : 'primary'} data-fk="to-pairing" title={CONNECTIONS_PAIR.title} onClick={() => nav.place('pairing')}>{CONNECTIONS_PAIR.act} ›</Btn>}>
      {settings.error && !s ? <WalletNotice error={settings.error} what={NOTICE_WHAT.settings} /> : null}
      <section className="cn-people-sec" aria-label={CONNECTIONS_PEOPLE.view}>
        <header className="cn-ph"><h2 className="cs-h3">{CONNECTIONS_PEOPLE.view}</h2><span className="dim">{CONNECTIONS_PEOPLE.sub}</span>
          {/* A seller opens a table in the approval window (owner configuration › Tables); nothing is paid. */}
          {list?.some((c) => !c.house && c.pairing === 'words_confirmed') ? <ToApproval label={CONNECTIONS_PEOPLE.openTable} kind="default" sm title={CONNECTIONS_PEOPLE.openTableTitle} /> : null}
        </header>
        <PeopleView rows={list} error={!!cps.error} />
      </section>
    </PlaceFrame>
  );
}

// ---- PayPal and your keys ------------------------------------------------------------------------

function PaypalView({ keyAt, marketAt, ownerKey, factsError, watch }: { keyAt: number | null; marketAt: number | null; ownerKey: string | undefined; factsError: Parameters<typeof OwnerKey>[0]['error']; watch: readonly MarketWatchFact[] }) {
  const s = useSettings().data;
  return (
    <div className="cn-view">
      <ul className="st-list">
        <KeyRow name={CONNECTIONS_PAYPAL.paypalKey} stored={s ? s.payment_executor_configured : null} storedAt={keyAt} required />
        <KeyRow name={CONNECTIONS_PAYPAL.marketKey} stored={s ? s.channel3_configured : null} storedAt={marketAt} />
      </ul>
      {watch.length ? (
        <ul className="cn-watch" aria-label={CONNECTIONS_PAYPAL.watch}>
          {watch.map((w) => {
            const l = watchLine(w);
            return <li key={`${w.mandate_id}:${w.mandate_version}`} className={l.usedUp ? 'used' : undefined} title={l.usedUp ? PRICE_CHECKS_USED_UP : undefined}><b>{l.checks}</b> · {l.rest}</li>;
          })}
        </ul>
      ) : null}
      <Kv items={[
        [CONNECTIONS_PAYPAL.mode, s ? <ModeBadge mode={s.mode} /> : <Chip tone="dashed">{CONNECTIONS_ENGINE.unknown}</Chip>],
        [CONNECTIONS_CARD.paypal, <Chip tone="dashed" title={CONNECTIONS_PAYPAL.notTestedTitle}>{CONNECTIONS_PAYPAL.notTested}</Chip>],
        [CONNECTIONS_PAYPAL.relay, s ? (s.relay_available ? CONNECTIONS_PAYPAL.relayOn : CONNECTIONS_PAYPAL.relayOff) : <Chip tone="dashed">{CONNECTIONS_ENGINE.unknown}</Chip>],
      ]} />
      <p className="st-note">{CONNECTIONS_PAYPAL.keptIn} {CONNECTIONS_PAYPAL.marketWhy}</p>
      {/* The one key this page shows whole: public, and the anchor for anyone checking a proof file. */}
      <OwnerKey id={ownerKey} error={factsError} cols={4} />
      <p className="st-foot"><Silence text={s?.payment_executor_configured ? CONNECTIONS_PAYPAL.ifSaved : CONNECTIONS_PAYPAL.ifNone} /></p>
    </div>
  );
}

function KeyRow({ name, stored, storedAt, required }: { name: string; stored: boolean | null; storedAt: number | null; required?: boolean }) {
  const line = stored === null ? CONNECTIONS_PAYPAL.cantTell
    : stored ? (storedAt ? CONNECTIONS_PAYPAL.savedOn(dateLabel(storedAt)) : CONNECTIONS_PAYPAL.savedPlain)
      : required ? CONNECTIONS_PAYPAL.neededToPay : CONNECTIONS_PAYPAL.notSavedPlain;
  return (
    <li>
      <span className="st-rt"><b>{name}{required ? null : <span className="dim"> · {CONNECTIONS_PAYPAL.optional}</span>}</b>
        <small className={stored ? 'okc' : stored === false && required ? 'red' : undefined}>{line}</small></span>
      {stored === null ? <Chip tone="dashed">{CONNECTIONS_ENGINE.unknown}</Chip>
        : <ToApproval label={stored ? CONNECTIONS_PAYPAL.replace : CONNECTIONS_PAYPAL.save} kind={stored || !required ? 'default' : 'gold'} sm target="credentials" title={CONNECTIONS_PAYPAL.saveTitle} />}
    </li>
  );
}

// ---- the agent app -----------------------------------------------------------------------------

/** The old picker (radio rows), the probe and the practice agent. A failed pick shows its error
 *  beside the control that was used. */
export function EngineView() {
  const s = useSettings().data;
  const toast = useToast();
  const engines = useQuery('engine_status', null, { refreshOn: ['settings:changed'] });
  const facts = useQuery('owner_facts', null, { refreshOn: ['settings:changed', 'agent:changed'] });
  const select = useMutation('engine_select');
  const probedAt = facts.data?.engines.reduce<number | null>((a, e) => (e.probed_at && (!a || e.probed_at > a) ? e.probed_at : a), null) ?? null;
  const pick = async (id: EngineId) => { if ((await select.run({ engine: id })) === null) toast(CONNECTIONS_ENGINE.set(engineName(id)), 'ok'); };
  const practicePicked = s?.selected_engine === 'scripted';
  return (
    <div className="cn-view">
      {engines.error ? <WalletNotice error={engines.error} what={CONNECTIONS_ENGINE.picker} /> : null}
      <div className="cn-engines" role="radiogroup" aria-label={CONNECTIONS_ENGINE.picker}>
        {!engines.data ? <p className="dim"><Chip tone="dashed">{CONNECTIONS_ENGINE.unknown}</Chip> {engines.loading ? CONNECTIONS_ENGINE.looking : CONNECTIONS_ENGINE.notChecked}</p> : null}
        {(engines.data ?? []).map((e) => (
          <label key={e.id} className={`cn-engine${e.available ? '' : ' off'}${s?.selected_engine === e.id ? ' on' : ''}`} title={e.available ? undefined : e.reason ? reasonWords(e.reason) : undefined}>
            <input type="radio" name="cn-engine" value={e.id} checked={s?.selected_engine === e.id} disabled={!e.available || select.pending || !s} onChange={() => void pick(e.id)} />
            <span className="st-rt">
              <b>{e.id === 'scripted' ? <>{CONNECTIONS_ENGINE.practice} <span className="dim">· {CONNECTIONS_ENGINE.practiceNote}</span></> : e.id}{e.version ? <span className="dim"> · {e.version}</span> : null}</b>
              <small>{e.available ? CONNECTIONS_ENGINE.ready : e.reason ? CONNECTIONS_ENGINE.notUsableBecause(reasonWords(e.reason)) : CONNECTIONS_ENGINE.notUsable}</small>
            </span>
            {e.available ? <Chip tone="ok">{CONNECTIONS_ENGINE.chipReady}</Chip> : <Chip tone="line">{CONNECTIONS_ENGINE.chipOff}</Chip>}
          </label>
        ))}
      </div>
      <div className="cs-acts">
        <Btn sm kind={engines.data ? 'default' : 'primary'} disabled={engines.loading && !engines.data} onClick={() => void engines.refetch()}>{engines.data ? CONNECTIONS_ENGINE.checkAgain : CONNECTIONS_ENGINE.look}</Btn>
        {practicePicked ? (
          <Btn sm disabled={select.pending || !s} title={KEEP_PRACTICE_AGENT.where} onClick={() => void pick('scripted')}>{KEEP_PRACTICE_AGENT.act}</Btn>
        ) : (
          <Btn sm disabled={select.pending || !s} title={CONNECTIONS_ENGINE.usePracticeTitle} onClick={() => void pick('scripted')}>{CONNECTIONS_ENGINE.usePractice}</Btn>
        )}
        <span className="ui-hint">{probedAt ? CONNECTIONS_ENGINE.checkedAt(clockLabel(probedAt)) : facts.data ? CONNECTIONS_ENGINE.notSince : ''}</span>
      </div>
      {select.error ? <WalletNotice error={select.error} what={CONNECTIONS_ENGINE.picker} /> : null}
      <p className="st-note">{CONNECTIONS_ENGINE.costNote}</p>
      {engines.data && !engines.data.find((e) => e.id === s?.selected_engine)?.available ? <p className="st-foot"><Silence text={CONNECTIONS_ENGINE.ifOff} /></p> : null}
    </div>
  );
}

// ---- the house seller ----------------------------------------------------------------------------

function HouseView({ house, onOpen }: { house: HouseState | undefined; onOpen: () => void }) {
  const wake = useMutation('house_wake');
  return (
    <div className="cn-view">
      <Kv items={[
        [CONNECTIONS_HOUSE.now, house ? CONNECTIONS_HOUSE.note[house] : <Chip tone="dashed">{CONNECTIONS_ENGINE.unknown}</Chip>],
        [CONNECTIONS_HOUSE.identity, CONNECTIONS_HOUSE.identityWhat],
        [CONNECTIONS_HOUSE.sleeps, CONNECTIONS_HOUSE.sleepsWhat],
        [CONNECTIONS_HOUSE.slow, CONNECTIONS_HOUSE.slowWhat],
      ]} />
      {house && house !== 'unavailable' ? (
        <div className="cs-acts">
          <Btn kind="primary" data-fk="house-open" onClick={onOpen}>{CONNECTIONS_HOUSE.open} ›</Btn>
          {house === 'idle' ? <Btn disabled={wake.pending} title={CONNECTIONS_HOUSE.wakeTitle} onClick={() => void wake.run(null)}>{wake.pending ? CONNECTIONS_HOUSE.waking : CONNECTIONS_HOUSE.wake}</Btn> : null}
        </div>
      ) : null}
      {wake.error ? <WalletNotice error={wake.error} what={CONNECTIONS_HOUSE.failed} /> : null}
      {house === 'ready' ? null : <p className="st-foot"><Silence text={CONNECTIONS_HOUSE.ifAsleep} /></p>}
    </div>
  );
}

// ---- who you deal with -------------------------------------------------------------------------

const PEOPLE_FILTERS: readonly ListFilter<CounterpartyDisplay>[] = [
  { value: 'verified', label: CONNECTIONS_PEOPLE.verified, test: (c) => c.pairing === 'words_confirmed' },
  { value: 'house', label: CONNECTIONS_PEOPLE.house, test: (c) => c.house },
  { value: 'unpaired', label: CONNECTIONS_PEOPLE.notVerified, test: (c) => c.pairing === 'unpaired' },
];
const PEOPLE_SORTS: readonly ListSort<CounterpartyDisplay>[] = [
  { value: 'most', label: CONNECTIONS_PEOPLE.most, compare: (a, b) => b.deals_closed - a.deals_closed || a.display_name.localeCompare(b.display_name) },
  { value: 'name', label: CONNECTIONS_PEOPLE.name, compare: (a, b) => houseWords(a.display_name).localeCompare(houseWords(b.display_name)) },
  { value: 'new', label: CONNECTIONS_PEOPLE.newest, compare: (a, b) => b.first_seen - a.first_seen },
];

function PeopleView({ rows, error }: { rows: CounterpartyDisplay[] | null; error: boolean }) {
  const list = useMemo(() => rows ?? [], [rows]);
  if (error && !rows) return <p className="dim">{CONNECTIONS_PEOPLE.unread}</p>;
  return (
    <div className="cn-people" style={{ height: fitHeight(list.length, 56) }}>
      <ListEngine<CounterpartyDisplay> label={CONNECTIONS_PEOPLE.list} rows={list} getKey={(c) => c.key_id}
        searchText={(c) => `${houseWords(c.display_name)} ${c.declared_payee ? houseWords(c.declared_payee) : ''}`}
        filters={PEOPLE_FILTERS} sorts={PEOPLE_SORTS} estimateSize={54}
        renderRow={(c) => <PersonRow c={c} />} rowLabel={(c) => houseWords(c.display_name)}
        empty={CONNECTIONS_PEOPLE.empty} noMatch={CONNECTIONS_PEOPLE.noMatch} />
    </div>
  );
}

function PersonRow({ c }: { c: CounterpartyDisplay }) {
  const pf = pairingFact(c);
  return (
    <span className="cn-person">
      <span className="st-rt">
        <b><WhoChip name={c.display_name} /></b>
        <small>{c.declared_payee ? CONNECTIONS_PEOPLE.paysTo(houseWords(c.declared_payee)) : CONNECTIONS_PEOPLE.noPayee} · {CONNECTIONS_PEOPLE.since(dateLabel(c.first_seen))} · {CONNECTIONS_PEOPLE.deals(c.deals_closed)}</small>
      </span>
      <Chip tone={pf.tone} title={pf.why}>{pf.text}</Chip>
    </span>
  );
}
