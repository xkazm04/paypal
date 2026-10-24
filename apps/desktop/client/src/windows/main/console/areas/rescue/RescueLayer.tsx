// The Rescue layer (rebuild WP3b): failed renewals, one fix for one subscriber, or nothing. The
// summary carries the decision (the owner found the decision cards buried a level down): the
// answer names the first failed renewal, "Your call" says how many wait and what happens if the
// owner does nothing, and the one gold action opens the approval window on it. Four cards open
// the renewals that need a fix (a windowed list, the picked one's fixes beside it), the fixes in
// progress, the money that came back and the subscriptions the wallet watches. Replaying a failed
// renewal and changing the watch list happen in the approval window.
import { useMemo, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import { formatMinor } from '../../../../../lib/format';
import { useMutation, useQuery } from '../../../../../lib/hooks';
import { LATEST_OF, OPEN_THE_DEAL, RESCUE, RESCUE_REPLAY_ABOUT, RESCUE_WATCH_STATE, RESCUE_VIEWS_TITLE, RESCUE_WATCH_ABOUT, ruleSentence, watchingWords } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, Kv } from '../../../../../shared/ui';
import { silenceParts } from '../../../home/model';
import { dealTotal, sumByCurrency } from '../../../logic';
import { atRiskOf, isReplay, recovered, type Col, type NotCountedWhy } from '../../../modules/rescue/model';
import { moneyList, rescueStrip } from '../../../modules/rescue/preview';
import { Loading } from '../../../ui';
import { useModuleRoute } from '../../../viewNav';
import { useLayerNav, type LayerProps } from '../../layers';
import { fewRows, ListEngine, type ListFilter } from '../../ListEngine';
import { Countdown } from '../../rows';
import { MAX_ROWS, type LatestProps } from '../../Latest';
import { ModuleLayer } from '../../ModuleLayer';
import { cap, CompareCells, CountChip, DeskDetail, deskLine, FixPanel, HandOff, RescueState, useRescueWorld, type RescueWorld } from './parts';

/** The answer, from the rows alone. Only a really paid rescue turns it green. What doing nothing does
 *  is said of the renewal named first: a replay has no failed payment at PayPal to retry. */
export function answerOf(r: RescueWorld): { answer: string; sub: string } {
  const got = r.book ? moneyList(r.book.recovered) : null;
  const first = r.rows.failing[0];
  if (first) {
    const n = r.rows.failing.length;
    const asks = r.rows.failing.some((d) => !!r.need(d));
    const t = atRiskOf(first, r.book);
    const quiet = isReplay(first, r.view(first)) ? RESCUE.answer.replay : RESCUE.answer.retries;
    const sums = sumByCurrency(r.rows.failing.map((d) => atRiskOf(d, r.book))).map((m) => formatMinor(m.minor, m.currency)).join(' · ');
    return {
      answer: n === 1 ? RESCUE.answer.one(cap(r.name(first)), formatMinor(t.minor, t.currency), asks, isReplay(first, r.view(first))) : RESCUE.answer.many(n, sums, asks),
      // With several, the one the gold action opens is named: the soonest PayPal retry.
      sub: n > 1 ? `${RESCUE.answer.soonest(cap(r.name(first)), formatMinor(t.minor, t.currency))} ${quiet}` : quiet,
    };
  }
  const waiting = r.rows.inflight.length;
  return { answer: RESCUE.answer.none, sub: [waiting ? RESCUE.answer.waiting(waiting) : RESCUE.answer.nothing, got ? RESCUE.answer.got(got) : ''].filter(Boolean).join(' ') };
}

function FailedRow({ deal, r }: { deal: Deal; r: RescueWorld }) {
  const need = r.need(deal);
  const t = atRiskOf(deal, r.book);
  return (
    <span className={`rs-row${need ? ' needs' : ''}`}>
      <span className="rs-who"><b title={r.name(deal)}>{cap(r.name(deal))}</b><span className="rs-sub" title={r.title(deal)}>{r.title(deal)}{need ? <> · {RESCUE.ifNothing}: {silenceParts(need.on_silence).head}</> : null}</span></span>
      <span className="rs-amt num">{formatMinor(t.minor, t.currency)}</span>
      {need ? <Chip tone="gold">{RESCUE.yourCall}</Chip> : <RescueState deal={deal} />}
      <Countdown deadline={r.deadline(deal)} />
    </span>
  );
}

function ProgressRow({ deal, r }: { deal: Deal; r: RescueWorld }) {
  const need = r.need(deal);
  const view = r.view(deal);
  const t = dealTotal(deal);
  return (
    <span className={`rs-row${need ? ' needs' : ''}`}>
      <span className="rs-who"><b title={r.name(deal)}>{cap(r.name(deal))}</b><span className="rs-sub">{need ? `${RESCUE.ifNothing}: ${silenceParts(need.on_silence).head}` : deskLine(deal, view)}</span></span>
      <span className="rs-amt num">{formatMinor(t.minor, t.currency)}</span>
      <RescueState deal={deal} />
      <CountChip deal={deal} view={view} />
    </span>
  );
}

/** The renewals that need a fix: the list, and the picked one's fixes beside it. */
function Failed({ r, picked, onPick, compare }: { r: RescueWorld; picked: Record<string, Col>; onPick: (id: string, c: Col) => void; compare?: boolean }) {
  const nav = useLayerNav();
  return (
    <div className={`rs-list${compare ? ' rs-compare' : ''}`}>
      {r.bookError ? <WalletNotice error={r.bookError} what={RESCUE.bookWhat} /> : null}
      {compare ? <p className="ui-hint rs-never">{RESCUE.never}</p> : null}
      <ListEngine<Deal> className={fewRows(r.rows.failing.length)} label={compare ? RESCUE_VIEWS_TITLE.compare : RESCUE_VIEWS_TITLE.failed} rows={r.rows.failing} getKey={(d) => d.id} estimateSize={compare ? 72 : 56} wideAt={1200}
        searchText={(d) => `${r.name(d)} ${r.title(d)}`}
        renderRow={(d) => (compare ? <span className="rs-crow"><span className="rs-who"><b title={r.name(d)}>{cap(r.name(d))}</b><span className="rs-sub">{r.title(d)}</span></span><CompareCells deal={d} r={r} /></span> : <FailedRow deal={d} r={r} />)}
        rowLabel={(d) => `${cap(r.name(d))}, ${r.title(d)}`}
        onOpen={(d) => nav.deal(d.id)}
        detail={(d) => <FixPanel key={d.id} deal={d} r={r} col={picked[d.id] ?? 'NONE'} onPick={(c) => onPick(d.id, c)} onDeal={() => nav.deal(d.id)} />}
        empty={RESCUE.empty.failed} />
    </div>
  );
}

function Progress({ r }: { r: RescueWorld }) {
  const nav = useLayerNav();
  return (
    <div className="rs-list">
      {r.bookError ? <WalletNotice error={r.bookError} what={RESCUE.bookWhat} /> : null}
      <ListEngine<Deal> className={fewRows(r.rows.inflight.length)} label={RESCUE_VIEWS_TITLE.progress} rows={r.rows.inflight} getKey={(d) => d.id} estimateSize={56} wideAt={1200}
        searchText={(d) => `${r.name(d)} ${r.title(d)}`}
        renderRow={(d) => <ProgressRow deal={d} r={r} />} rowLabel={(d) => cap(r.name(d))}
        onOpen={(d) => nav.deal(d.id)} detail={(d) => <DeskDetail deal={d} r={r} onDeal={() => nav.deal(d.id)} />}
        empty={RESCUE.empty.progress} />
    </div>
  );
}

type RecoveredRow = { deal: Deal; why: NotCountedWhy | null };
const RECOVERED_FILTERS: readonly ListFilter<RecoveredRow>[] = [
  { value: 'counts', label: RESCUE.recovered.counts, test: (x) => x.why === null },
  { value: 'not', label: RESCUE.recovered.notCounts, test: (x) => x.why !== null },
  { value: 'closed', label: RESCUE.recovered.closed, test: (x) => x.why === 'closed' || x.why === 'unverified' },
];

/** What counts as recovered and what does not: the wallet's totals, then every rescue with its reason. */
function Recovered({ r }: { r: RescueWorld }) {
  const nav = useLayerNav();
  const rec = useMemo(() => recovered(r.all, r.book), [r.all, r.book]);
  const rows = useMemo<RecoveredRow[]>(() => [...rec.counted.map((deal) => ({ deal, why: null })), ...rec.notCounted.map((x) => ({ deal: x.deal, why: x.why as NotCountedWhy }))], [rec]);
  const total = rec.totals.length ? rec.totals.map((t) => formatMinor(t.minor, t.currency)).join(' · ') : null;
  return (
    <div className="rs-list">
      {r.bookError ? <WalletNotice error={r.bookError} what={RESCUE.bookWhat} /> : null}
      <p className="rs-total">{RESCUE.recovered.total} <b className={`money${total ? ' okc' : ''}`}>{total ?? RESCUE.recovered.noneYet}</b></p>
      <p className="ui-hint">{RESCUE.recovered.rule}</p>
      <ListEngine<RecoveredRow> className={fewRows(rows.length)} label={RESCUE_VIEWS_TITLE.recovered} rows={rows} getKey={(x) => x.deal.id} filters={RECOVERED_FILTERS} estimateSize={52}
        searchText={(x) => `${r.name(x.deal)} ${r.title(x.deal)}`}
        renderRow={(x) => {
          const t = dealTotal(x.deal);
          return (
            <span className={`rs-row${x.why === null ? ' ok' : ''}`}>
              <span className="rs-who"><b title={r.name(x.deal)}>{cap(r.name(x.deal))}</b><span className="rs-sub">{x.why === null ? RESCUE.recovered.countsLine : RESCUE.notCounted[x.why]}</span></span>
              <span className={`rs-amt num${x.why === null ? ' okc' : ''}`}>{formatMinor(t.minor, t.currency)}</span>
              <RescueState deal={x.deal} />
              <CountChip deal={x.deal} view={r.view(x.deal)} />
            </span>
          );
        }}
        rowLabel={(x) => cap(r.name(x.deal))} onOpen={(x) => nav.deal(x.deal.id)} empty={RESCUE.empty.recovered} />
    </div>
  );
}

/** The watched subscriptions and the rescue rules; changing either happens in the approval window. */
function Watch({ r }: { r: RescueWorld }) {
  const nav = useLayerNav();
  const open = useMutation('approval_open');
  const q = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const rules = (q.data ?? []).filter((m) => !m.refusal && m.payload.clauses.some((c) => c.type === 'lever'));
  const lever = rules.at(-1)?.payload.clauses.find((c) => c.type === 'lever');
  const book = r.book;
  const n = book?.watching.length ?? 0;
  const failing = book?.watching.filter((w) => w.state === 'fix_opened' || w.state === 'failed_no_fix').length ?? 0;
  return (
    <div className="rs-watch">
      {r.bookError ? <WalletNotice error={r.bookError} what={RESCUE.bookWhat} /> : null}
      <section className="rs-wbox">
        <h2 className="rs-h2">{book ? watchingWords(n) : r.bookError ? RESCUE.watch.unread : RESCUE.watch.reading}</h2>
        <p>{!book ? null : n === 0 ? RESCUE.watch.none : failing ? RESCUE.watch.failing(failing) : RESCUE.watch.checked}</p>
        {book && n ? <p className="ui-hint" title={RESCUE_WATCH_ABOUT}>{RESCUE.watch.reads(book.watch_reads_today, book.watch_reads_max)}</p> : null}
        <div className="cs-acts">
          <Btn onClick={() => void open.run({ deal_id: null, target: 'rescue_watch' })} disabled={open.pending} title={`${RESCUE_WATCH_ABOUT} ${RESCUE.opensApproval}`}>
            {n ? RESCUE.watch.manage : RESCUE.watch.add} <span aria-hidden="true">↗</span>
          </Btn>
        </div>
        {open.error ? <WalletNotice error={open.error} what={RESCUE.approvalWhat} /> : null}
      </section>
      <section className="rs-wbox">
        <h2 className="rs-h2">{RESCUE.rules.title}</h2>
        {q.error ? <WalletNotice error={q.error} what={RESCUE.rules.what} /> : (
          <Kv items={[
            [RESCUE.rules.signed, rules.length ? RESCUE.rules.cover(rules.length) : RESCUE.rules.noneSigned],
            [RESCUE.rules.fixes, lever ? ruleSentence(lever) : <span className="rs-dim">{RESCUE.rules.noFixes}</span>],
            [RESCUE.rules.scope, RESCUE.rules.scopeText],
            [RESCUE.rules.never, RESCUE.rules.neverText],
            [RESCUE.rules.invoice, RESCUE.rules.invoiceText],
          ]} />
        )}
        <div className="cs-acts"><Btn sm onClick={() => nav.place('rules')}>{RESCUE.rules.open}</Btn></div>
      </section>
    </div>
  );
}

/** Replaying a failed renewal is recorded in the approval window (PayPal can't fail a test renewal). */
function ReplayButton() {
  const open = useMutation('approval_open');
  return (
    <>
      <Btn sm onClick={() => void open.run({ deal_id: null, target: 'rescue' })} disabled={open.pending} title={`${RESCUE_REPLAY_ABOUT} ${RESCUE.opensApproval}`}>{RESCUE.replay} <span aria-hidden="true">↗</span></Btn>
      {open.error ? <WalletNotice error={open.error} what={RESCUE.approvalWhat} /> : null}
    </>
  );
}

/** Latest: the renewals that need a fix (asking ones first), else the fixes on their way. */
function latestOf(r: RescueWorld, open: (v: string) => void, deal: (id: string) => void): LatestProps {
  const failing = new Set(r.rows.failing.map((d) => d.id));
  const asking = [...r.rows.failing].sort((a, b) => (r.need(b) ? 1 : 0) - (r.need(a) ? 1 : 0));
  const rows = [...asking, ...r.rows.inflight, ...r.rows.settled];
  return {
    title: LATEST_OF.rescue, total: rows.length,
    rows: rows.slice(0, MAX_ROWS).map((d) => ({
      key: d.id, label: `${cap(r.name(d))}, ${r.title(d)}, ${OPEN_THE_DEAL}`, onOpen: () => deal(d.id),
      node: failing.has(d.id) ? <FailedRow deal={d} r={r} /> : <ProgressRow deal={d} r={r} />,
    })),
    seeAll: { onOpen: () => open(failing.size ? 'failed' : r.rows.inflight.length ? 'progress' : 'recovered') },
    // The subscriptions the wallet watches for a failed renewal, at a glance (the Watching view has more).
    facts: (r.book?.watching ?? []).slice(0, MAX_ROWS).map((w) => [`${w.plan} · ${w.recipient}`, RESCUE_WATCH_STATE[w.state].text] as const),
  };
}

export function RescueLayer({ nav }: LayerProps) {
  const r = useRescueWorld();
  const route = useModuleRoute();
  const [picked, setPicked] = useState<Record<string, Col>>({});
  const pick = (id: string, c: Col) => setPicked((p) => ({ ...p, [id]: c }));
  if (!r.loaded) {
    return (
      <div className="ar-rescue">
        <ModuleLayer module="rescue" answer={RESCUE.title} yourCall={null}>
          {r.error ? <WalletNotice error={r.error} what={RESCUE.ledgerWhat} /> : <Loading what={RESCUE.loading} />}
        </ModuleLayer>
      </div>
    );
  }
  const { answer, sub } = answerOf(r);
  const strip = rescueStrip(r.rows, r.all, r.book);
  const asking = r.rows.failing.filter((d) => !!r.need(d));
  const first = asking[0];
  const firstNeed = first ? r.need(first) : undefined;
  const watching = r.book?.watching.length ?? 0;
  return (
    <div className="ar-rescue">
      <ModuleLayer module="rescue" answer={answer} sub={sub} latest={latestOf(r, (v) => route.open(v), nav.deal)}
        yourCall={first && firstNeed ? { count: asking.length, ifNothing: silenceParts(firstNeed.on_silence).head, onOpen: () => route.open('failed', 'your-call') } : null}
        action={first && firstNeed ? <HandOff deal={first} /> : undefined}
        cards={[
          { id: 'failed', view: 'failed', label: RESCUE_VIEWS_TITLE.failed, value: r.rows.failing.length ? RESCUE.cards.renewals(r.rows.failing.length) : RESCUE.none,
            note: r.rows.failing.length ? RESCUE.cards.atRisk(moneyList(strip.atRisk) ?? RESCUE.cards.nothing) : RESCUE.cards.nothingToFix,
            chip: asking.length ? RESCUE.yourCall : undefined, chipTone: 'gold', ifNothing: firstNeed ? silenceParts(firstNeed.on_silence).head : null },
          { id: 'progress', view: 'progress', label: RESCUE_VIEWS_TITLE.progress, value: r.rows.inflight.length ? RESCUE.cards.fixes(r.rows.inflight.length) : RESCUE.none,
            note: r.rows.inflight.length ? RESCUE.cards.waitingFor(moneyList(strip.inProgress) ?? '') : RESCUE.cards.nothingWaiting },
          { id: 'recovered', view: 'recovered', label: RESCUE_VIEWS_TITLE.recovered, value: moneyList(strip.recovered) ?? RESCUE.cards.noneYet, note: RESCUE.cards.countedOnce },
          { id: 'watch', view: 'watch', label: RESCUE_VIEWS_TITLE.watch, value: r.book ? watchingWords(watching) : r.bookError ? RESCUE.cards.unread : RESCUE.cards.reading,
            note: r.book && watching ? RESCUE.watch.reads(r.book.watch_reads_today, r.book.watch_reads_max) : RESCUE.cards.watchNote },
        ]}
        explain={{ summary: RESCUE.how.title, body: <><ul className="rs-how">{RESCUE.how.items.map((x) => <li key={x.title}><b>{x.title}.</b> {x.text}</li>)}</ul><p>{RESCUE.never}</p></> }}
        views={{
          failed: { title: RESCUE_VIEWS_TITLE.failed, sub: RESCUE.failedSub, actions: <><ReplayButton /><Btn sm onClick={() => route.open('compare')}>{RESCUE_VIEWS_TITLE.compare}</Btn></>, render: () => <Failed r={r} picked={picked} onPick={pick} /> },
          compare: { title: RESCUE_VIEWS_TITLE.compare, sub: RESCUE.compareSub, render: () => <Failed r={r} picked={picked} onPick={pick} compare /> },
          progress: { title: RESCUE_VIEWS_TITLE.progress, sub: RESCUE.progressSub, render: () => <Progress r={r} /> },
          recovered: { title: RESCUE_VIEWS_TITLE.recovered, sub: RESCUE.recoveredSub, render: () => <Recovered r={r} /> },
          watch: { title: RESCUE_VIEWS_TITLE.watch, sub: RESCUE.watchSub, render: () => <Watch r={r} /> },
        }} />
    </div>
  );
}
