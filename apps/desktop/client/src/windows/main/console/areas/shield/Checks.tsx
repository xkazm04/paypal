// The Shield's checks, side by side (rebuild WP3b, scale finding #13). The old evidence matrix put
// one 150 px column per payee (17 payees made it 3,527 px wide); here each payment is a row and the
// checks are its columns: who and how much, what the shield says, whether the payee is new, the
// price against typical, what was sent to PayPal and the decision. Rows are windowed and searchable;
// on narrower windows the PayPal and check columns fold away (the picked row's story keeps them),
// and "Outcome only" fades the checks. No column is added per payee, so the page never scrolls
// sideways. The picked row's whole story (every check, the price band, their note quarantined, the
// decision and its hand-off) sits beside the list.
import { Fragment, useMemo, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import { formatMinor } from '../../../../../lib/format';
import { useNow } from '../../../../../lib/hooks';
import { SHIELD, shieldReleased, shieldRuleWord, shieldWord } from '../../../../../lib/words';
import { MinorMoney } from '../../../../../shared/honesty';
import { Btn, Chip, Hint, Kv, Seg } from '../../../../../shared/ui';
import { dealTotal, ledgerScope, moneyNow, stateLabel } from '../../../logic';
import { NoteText } from '../shared/NoteChip';
import { WeekTiles } from '../../../modules/shield/Panels';
import { weekStrip } from '../../../modules/shield/normal';
import { bandGeometry, checkCell, CHECKS, overMedian, overPauseLine, paypalLine, releasable, STAGES } from '../../../modules/shield/matrix';
import { useLayerNav } from '../../layers';
import { ListEngine, type ListFilter } from '../../ListEngine';
import { Amount } from '../../rows';
import { fewRows, RefuseButton, ReleaseHandoff, VerdictChip, type ShieldWorld } from './parts';

type Scope = 'week' | 'all';

/** A tiny price bar: where the price sits against typical, with the 1.4 × line where the shield pauses. */
function PriceMini({ deal }: { deal: Deal }) {
  const p = overMedian(deal);
  if (p === null) return null;
  const scale = 1.8;
  const at = Math.max(0, Math.min(1, (1 + p / 100) / scale));
  return (
    <span className={`sh-pmini ${overPauseLine(deal) ? 'over' : ''}`} aria-hidden="true">
      <i className="typ" style={{ left: `${(1 / scale) * 100}%` }} />
      <i className="flag" style={{ left: `${(1.4 / scale) * 100}%` }} />
      <i className="px" style={{ left: `${at * 100}%` }} />
    </span>
  );
}

/** What the decision is, in a few words (the hand-off lives in the row's story). */
function decisionWords(deal: Deal, s: ShieldWorld): string {
  const need = s.need(deal);
  if (deal.shield === 'BLOCK') return SHIELD.move.blocked;
  if (need && releasable(deal)) return SHIELD.move.yours;
  if (need) return need.headline;
  return deal.shield === 'HOLD' ? SHIELD.move.closed(stateLabel(deal.state, deal).toLowerCase()) : SHIELD.move.elsewhere(s.moduleName(deal));
}

function CheckRow({ deal, s, outcome }: { deal: Deal; s: ShieldWorld; outcome: boolean }) {
  const now = useNow();
  const cp = s.cpEntry(deal);
  const newcp = checkCell('newcp', deal, cp, now);
  const market = checkCell('market', deal, cp, now);
  const over = !!overPauseLine(deal);
  const [pp] = paypalLine(deal);
  const need = s.need(deal);
  return (
    <span className={`sh-crow${need ? ' needs' : ''}${outcome ? ' outcome' : ''}`}>
      <span className="c-who"><b title={s.who(deal)}>{s.who(deal)}</b><span className="sh-sub" title={s.title(deal)}>{s.title(deal)}</span></span>
      <span className="c-amt"><Amount money={dealTotal(deal)} tone={deal.shield === 'BLOCK' ? 'struck' : undefined} /></span>
      <span className="c-say"><VerdictChip v={deal.shield} /></span>
      <span className={`c-chk c-new r-${newcp.r}`} title={newcp.l}><small>{SHIELD.col.newPayee}</small><span>{newcp.s}</span></span>
      <span className={`c-chk c-mkt r-${market.r}${over ? ' tx-coral' : ''}`} title={market.l}><small>{SHIELD.col.price}</small><span><PriceMini deal={deal} />{market.s.replace(/ typical$/, '')}</span></span>
      <span className="c-pp"><small>{SHIELD.col.paypal}</small><span className={pp.startsWith(SHIELD.nothingSentPrefix) ? 'tx-ok' : 'tx-gold'}>{pp}</span></span>
      <span className={`c-move${need ? ' tx-gold' : ''}`}><small>{SHIELD.col.decision}</small><span>{decisionWords(deal, s)}</span></span>
    </span>
  );
}

/** The deal's unit price against typical: usual range box, typical tick, the 1.4 × pause line. */
function PriceBand({ deal }: { deal: Deal }) {
  const g = bandGeometry(deal);
  const m = deal.market;
  if (!g || !m) return <p className="sh-nomarket">{SHIELD.noTypical}</p>;
  const cur = m.median.currency;
  const f = (v: number) => formatMinor(v, cur);
  const at = (p: number) => ({ left: `${p}%`, transform: `translateX(${p > 78 ? '-100%' : p < 18 ? '0' : '-50%'})` });
  return (
    <>
      <div className="sh-mband" role="img" aria-label={SHIELD.bandLabel(f(deal.terms.unit_price.minor), f(m.median.minor), f(m.p25.minor), f(m.p75.minor), f(Math.round(m.median.minor * 1.4)))}>
        <div className="axis" />
        <div className="iqr" style={{ left: `${g.iqr[0]}%`, width: `${g.iqr[1] - g.iqr[0]}%` }} />
        <div className="med" style={{ left: `${g.median}%` }} /><span className="lab" style={at(g.median)}>{SHIELD.typical}</span>
        <div className="flag" style={{ left: `${g.flag}%` }} /><span className="lab" style={at(g.flag)}>{SHIELD.pauseLine}</span>
        <div className="px" style={{ left: `${g.price}%` }} /><span className="lab top" style={at(g.price)}>{f(deal.terms.unit_price.minor)} · {g.pct >= 0 ? '+' : ''}{g.pct}%</span>
      </div>
      <Hint>{SHIELD.bandHint(f(m.p25.minor), f(m.p75.minor), f(m.median.minor))}</Hint>
    </>
  );
}

/** The picked payment's whole story: who, every check, the price, PayPal, their note, the decision. */
export function PayeeStory({ deal, s }: { deal: Deal; s: ShieldWorld }) {
  const now = useNow();
  const nav = useLayerNav();
  const cp = s.cpEntry(deal);
  const need = s.need(deal);
  const v = deal.shield ? shieldWord(deal.shield) : null;
  const [a, b] = paypalLine(deal);
  const p = deal.paypal;
  const [note, setNote] = useState(false);
  const first = cp ? new Date(cp.first_seen * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
  return (
    <div className="sh-story">
      <p className="kicker">{SHIELD.story.payee}</p>
      <h2 className="sh-h" title={s.who(deal)}>{s.who(deal)}</h2>
      <Kv items={[
        [SHIELD.story.wants, <span title={s.title(deal)}>{s.title(deal)}</span>],
        [SHIELD.story.amount, <MinorMoney minor={dealTotal(deal).minor} currency={dealTotal(deal).currency} />],
        [SHIELD.story.now, stateLabel(deal.state, deal)],
        [SHIELD.story.firstSeen, first ? `${first} (${checkCell('newcp', deal, cp, now).s.toLowerCase()})` : <Chip tone="dashed">{SHIELD.unknown}</Chip>],
        s.house(deal) ? [SHIELD.story.who, SHIELD.story.house] : null,
      ]} />
      <h3 className="sh-h3">{SHIELD.story.says}</h3>
      <p className="sh-say"><VerdictChip v={deal.shield} /> <span>{v ? v.means : SHIELD.noVerdictTitle}</span></p>
      {deal.shield_rule ? <p className="sh-det"><b>{SHIELD.story.decidedBy}</b> {shieldRuleWord(deal.shield_rule).text}. {shieldRuleWord(deal.shield_rule).means}</p> : null}
      {shieldReleased(deal) ? <p className="sh-det">{SHIELD.story.released}</p> : null}
      <ul className="sh-cklist">
        {CHECKS.map((chk, i) => {
          const x = checkCell(chk.k, deal, cp, now);
          const stage = i === 0 || CHECKS[i - 1]?.stage !== chk.stage ? <li className="stg">{STAGES[chk.stage]}</li> : null;
          return <Fragment key={chk.k}>{stage}<li title={x.l}><span className={`sh-mark r-${x.r}`} aria-hidden="true" /><span>{chk.name}</span><span className={`res r-${x.r}`}>{x.s}</span></li></Fragment>;
        })}
      </ul>
      <Hint>{SHIELD.story.strictest}</Hint>
      <h3 className="sh-h3">{SHIELD.story.price}</h3>
      <PriceBand deal={deal} />
      <h3 className="sh-h3">{SHIELD.story.paypal}</h3>
      <p className="sh-det"><b>{a}</b> · {b}. {SHIELD.story.moneyNow(moneyNow(deal))}</p>
      {p.order || p.authorization || p.capture ? <Kv items={[p.order ? [SHIELD.story.order, <span className="mono">{p.order}</span>] : null, p.authorization ? [SHIELD.story.hold, <span className="mono">{p.authorization}</span>] : null, p.capture ? [SHIELD.story.payment, <span className="mono">{p.capture}</span>] : null]} /> : null}
      {/* Their words are read only when the owner opens them, and shown quarantined (NoteText). */}
      <details className="ui-disclosure sh-note" onToggle={(e) => setNote(e.currentTarget.open)}><summary>{SHIELD.story.note}</summary>
        <div className="ui-disclosure-body">{note ? <NoteText dealId={deal.id} from={s.who(deal)} /> : null}</div>
      </details>
      <h3 className="sh-h3">{SHIELD.story.decision}</h3>
      <p className="sh-det">{deal.shield === 'BLOCK' ? SHIELD.story.blockFinal : need && releasable(deal) ? SHIELD.releaseMeans : need ? need.headline : SHIELD.story.nothing(v ? v.text : SHIELD.noVerdict, s.moduleName(deal))}</p>
      {need ? <p className="sh-det">{SHIELD.ifNothing}: <b>{need.on_silence}</b></p> : null}
      <div className="cs-acts">
        {need ? <ReleaseHandoff deal={deal} need={need} sm /> : null}
        {need ? <RefuseButton deal={deal} need={need} title={s.title(deal)} /> : null}
        <Btn sm onClick={() => nav.deal(deal.id)}>{SHIELD.openDeal}</Btn>
      </div>
    </div>
  );
}

export function Checks({ s }: { s: ShieldWorld }) {
  const nav = useLayerNav();
  const now = useNow();
  const [scope, setScope] = useState<Scope>('week');
  const [outcome, setOutcome] = useState(false);
  const week = useMemo(() => ledgerScope([...s.checked], now).deals.filter((d) => d.shield !== null || !!s.need(d)), [s, now]);
  const rows = scope === 'week' ? week : s.checked;
  const strip = useMemo(() => weekStrip(s.checked, now, (d) => !!s.need(d)), [s, now]);
  const filters = useMemo<readonly ListFilter<Deal>[]>(() => [
    { value: 'paused', label: SHIELD.filter.paused, test: (d) => !!s.need(d) && d.shield !== 'BLOCK' },
    { value: 'blocked', label: SHIELD.filter.blocked, test: (d) => d.shield === 'BLOCK' },
    { value: 'new', label: SHIELD.filter.newPayee, test: (d) => { const c = s.cpEntry(d); return !c || now - c.first_seen < 86_400; } },
    { value: 'price', label: SHIELD.filter.price, test: (d) => overPauseLine(d) !== false },
    { value: 'clear', label: SHIELD.filter.clear, test: (d) => d.shield === 'CLEAR' && !s.need(d) },
  ], [s, now]);
  return (
    <div className="sh-checks">
      <WeekTiles strip={strip} />
      <div className="sh-ctools">
        <Seg label={SHIELD.scope.label} value={scope} onChange={setScope} options={[{ value: 'week', label: SHIELD.scope.week }, { value: 'all', label: SHIELD.scope.all }]} />
        <Seg label={SHIELD.show.label} value={outcome ? 'outcome' : 'all'} onChange={(v) => setOutcome(v === 'outcome')}
          options={[{ value: 'all', label: SHIELD.show.all }, { value: 'outcome', label: SHIELD.show.outcome, title: SHIELD.show.outcomeTitle }]} />
        <span className="ui-hint sh-unshown">{SHIELD.unshown}</span>
      </div>
      <ListEngine<Deal> className={fewRows(rows.length)} label={SHIELD.checksLabel} rows={rows} getKey={(d) => d.id} filters={filters} filterLabel={SHIELD.filter.label} estimateSize={52} wideAt={1200} toolbarMin={0}
        searchText={(d) => `${s.who(d)} ${s.title(d)} ${d.shield ? shieldWord(d.shield).text : ''}`}
        renderRow={(d) => <CheckRow deal={d} s={s} outcome={outcome} />}
        rowLabel={(d) => `${s.who(d)}, ${d.shield ? shieldWord(d.shield).text : SHIELD.noVerdict}`}
        onOpen={(d) => nav.deal(d.id)}
        detail={(d) => <PayeeStory key={d.id} deal={d} s={s} />}
        empty={scope === 'week' ? SHIELD.checksEmptyWeek : SHIELD.checksEmpty} />
    </div>
  );
}

/** How the shield decides, one level down (it was a sheet): the checks, what each result means,
 *  and how their messages are read. */
export function HowShield() {
  return (
    <div className="sh-how">
      <p className="sh-det">{SHIELD.how.lede}</p>
      <h2 className="sh-h3">{SHIELD.how.checks}</h2>
      <ol className="sh-steps">
        {CHECKS.map((c) => <li key={c.k}><b>{c.name}</b> <span className="tx-dim">· {c.kind}.</span> {SHIELD.how.ifFinds} <VerdictChip v={c.effect} /></li>)}
      </ol>
      <p className="sh-det">{SHIELD.how.noPrice}</p>
      <h2 className="sh-h3">{SHIELD.how.results}</h2>
      <Kv items={(['CLEAR', 'ASK', 'HOLD', 'BLOCK'] as const).map((v) => [<VerdictChip v={v} />, shieldWord(v).means] as const)} />
      <h2 className="sh-h3">{SHIELD.how.messages}</h2>
      <p className="sh-det">{SHIELD.how.messagesText}</p>
      <div className="sh-legend">
        <span><span className="sh-hatch" aria-hidden="true" /> {SHIELD.how.hatch}</span>
        <span><Chip tone="dashed">{SHIELD.how.noteChip}</Chip> {SHIELD.how.noteText}</span>
      </div>
    </div>
  );
}
