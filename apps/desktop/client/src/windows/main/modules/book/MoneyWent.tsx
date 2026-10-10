// Round 2 (experiment r2-book): "Where the money went" (bars by kind, split into paid / on hold /
// stopped, per currency, drawn to scale) and the "PayPal agrees" meter. Read-only, display only.
// Stopped money is hatched and struck, never drawn like money that moved. Colours come from the
// design tokens (book.css); text stays in text colours, the marks carry the series.
import type { Deal } from '@bindings/Deal';
import { formatMinor } from '../../../../lib/format';
import { unconfirmedMeans } from '../../../../lib/words';
import { Icon, Section, Why } from '../../../../shared/ui';
import type { Statement } from './model';
import {
  agreeFigure, agreeLine, agreeWhy, agreement, agreementGaps, chartSummary, FLOW_WORD, FLOWS, GAP_WORD, inProgressCount, plural, rowName, rowSummary, sharePct, whereTheMoneyWent,
  type Agreement, type BarChart, type BarRow, type Flow, type Gap,
} from './where';

const SEG_TITLE: Record<Flow, string> = { paid: 'Paid: the money moved', held: 'On hold at PayPal: not paid yet', stopped: 'Stopped: this money never moved (or came back)' };

function Swatch({ kind }: { kind: Flow | 'ok' | 'notyet' | 'differs' | 'unknown' }) {
  return <i className={`wm-sw sw-${kind}`} aria-hidden="true" />;
}

function BarRowView({ r, max }: { r: BarRow; max: number }) {
  const { name, dir } = rowName(r);
  return (
    <div className="wm-row" role="img" aria-label={rowSummary(r)}>
      <div className="wm-name" aria-hidden="true"><b>{name}</b><span>{dir}</span></div>
      <div className="wm-body" aria-hidden="true">
        <div className="wm-track">
          {FLOWS.filter((f) => r.minor[f] > 0).map((f) => (
            <span key={f} className={`wm-seg s-${f}`} style={{ width: `${sharePct(r.minor[f], max)}%` }}
              title={`${SEG_TITLE[f]} · ${formatMinor(r.minor[f], r.currency)} · ${plural(r.n[f], 'payment', 'payments')}`} />
          ))}
        </div>
        <div className="wm-vals">
          {FLOWS.filter((f) => r.minor[f] > 0).map((f) => (
            <span key={f} className={`wm-v v-${f}`}><Swatch kind={f} /><b>{formatMinor(r.minor[f], r.currency)}</b> {FLOW_WORD[f]}</span>
          ))}
          {!r.total ? <span className="wm-v v-none">nothing paid, held or stopped yet</span> : null}
          {r.replays ? <span className="wm-v v-note" title="A replay is a rerun of something that happened before. It is never counted as money recovered.">{plural(r.replays, 'replay', 'replays')} not counted</span> : null}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <span className="wm-legend" role="list" aria-label="How to read the bars">
      <span role="listitem"><Swatch kind="paid" />Paid</span>
      <span role="listitem"><Swatch kind="held" />On hold</span>
      <span role="listitem"><Swatch kind="stopped" />Stopped, never moved</span>
    </span>
  );
}

function BarsCard({ charts }: { charts: BarChart[] }) {
  const open = inProgressCount(charts);
  return (
    <div className="wm-card wm-bars">
      {!charts.length ? <div className="wm-empty">No payments to draw yet. Bars appear as soon as an agent’s deal is paid, held or stopped.</div> : null}
      {charts.map((c) => (
        <div key={c.currency} className="wm-chart" role="group" aria-label={chartSummary(c)}>
          {charts.length > 1 ? <div className="wm-cur">Amounts in {c.currency}, drawn on their own scale</div> : null}
          {c.rows.map((r) => <BarRowView key={r.key} r={r} max={c.max} />)}
        </div>
      ))}
      {open ? <p className="wm-foot">{plural(open, 'payment is', 'payments are')} still in progress and not drawn: nothing has been paid, held or stopped yet.</p> : null}
    </div>
  );
}

type Opener = { titleOf: (d: Deal) => string; onOpen: (id: string) => void };

function AgreeCard({ a, gaps, checkedAt, titleOf, onOpen }: { a: Agreement; gaps: Gap[]; checkedAt: string | null } & Opener) {
  const [one, two] = agreeWhy(a, checkedAt);
  // An UNCONFIRMED end is drawn dashed like an unknown, never as a wait for the statement.
  const slots: Array<'ok' | 'notyet' | 'differs' | 'unconfirmed' | 'unknown'> = [
    ...Array<'ok'>(a.matched).fill('ok'), ...Array<'notyet'>(a.notYet).fill('notyet'), ...Array<'differs'>(a.differs).fill('differs'), ...Array<'unconfirmed'>(a.unconfirmed).fill('unconfirmed'), ...Array<'unknown'>(a.unknown).fill('unknown'),
  ];
  const grouped = slots.length > 30;
  const blocks: Array<{ k: (typeof slots)[number]; n: number }> = grouped
    ? (['ok', 'notyet', 'differs', 'unconfirmed', 'unknown'] as const).map((k) => ({ k, n: slots.filter((s) => s === k).length })).filter((b) => b.n)
    : slots.map((k) => ({ k, n: 1 }));
  const label = a.needed ? `${agreeFigure(a)} payments are on your PayPal statement. ${agreeLine(a)}` : 'No payment has needed a place on your PayPal statement yet.';
  return (
    <div className="wm-card wm-agree" role="group" aria-label="PayPal agrees">
      <div className="wm-h"><Icon name="check" size={15} />PayPal agrees
        <Why question={`What does “${agreeFigure(a)}” mean?`} label="Why?">
          <p>{one}</p>
          <p>{two}</p>
        </Why>
      </div>
      {a.loading && !a.needed ? <div className="ag-fig dim">Reading PayPal’s statement…</div> : (
        <>
          <div className="ag-fig">{a.needed ? <><b>{a.matched}</b> of {a.needed}</> : <b className="none">—</b>}</div>
          <div className="ag-sub">{a.needed ? 'payments are on your PayPal statement' : 'No payment has needed a place on the statement yet.'}</div>
          {a.needed ? (
            <div className="ag-meter" role="img" aria-label={label}>
              {blocks.map((b, i) => <span key={i} className={`ag-b b-${b.k === 'unconfirmed' ? 'unknown' : b.k}`} style={grouped ? { flex: b.n } : undefined} />)}
            </div>
          ) : null}
          {a.needed ? (
            <div className="ag-key" role="list" aria-label="Statement status">
              <span role="listitem"><Swatch kind="ok" />On statement <b>{a.matched}</b></span>
              <span role="listitem" title="Paid, but PayPal’s statement can take up to 3 hours to show it"><Swatch kind="notyet" />Not yet <b>{a.notYet}</b></span>
              <span role="listitem" title="PayPal’s statement shows a different amount or payment than the deal"><Swatch kind="differs" />Differs <b>{a.differs}</b></span>
              {a.unconfirmed ? <span role="listitem" title={unconfirmedMeans(null)}><Swatch kind="unknown" />Not confirmed <b>{a.unconfirmed}</b></span> : null}
              {a.unknown ? <span role="listitem" title="The PayPal proof could not be read"><Swatch kind="unknown" />Unknown <b>{a.unknown}</b></span> : null}
            </div>
          ) : null}
          {gaps.length ? (
            <ul className="ag-gaps" aria-label="Payments not on the statement">
              {gaps.slice(0, 4).map((g) => (
                <li key={g.deal.id}>
                  <button type="button" onClick={() => onOpen(g.deal.id)} title="Open this payment">
                    <span className="g-t">{titleOf(g.deal)}</span>
                    <span className={`g-s st-${g.statement === 'unconfirmed' ? 'unknown' : g.statement}`}>{GAP_WORD[g.statement]}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : a.needed ? <div className="ag-line">{agreeLine(a)}</div> : null}
          {gaps.length > 4 ? <div className="ag-more">and {gaps.length - 4} more</div> : null}
          {checkedAt ? <div className="ag-chk">Last checked {checkedAt}</div> : null}
        </>
      )}
    </div>
  );
}

/** The two new blocks under the totals. `stmt` returns null while the PayPal statement is still being read. */
export function MoneyWent({ deals, stmt, checkedAt, titleOf, onOpen }: { deals: Deal[]; stmt: (d: Deal) => Statement | null; checkedAt: string | null } & Opener) {
  const charts = whereTheMoneyWent(deals);
  return (
    <Section title="Where the money went" end={<Legend />} className="wm">
      <div className="wm-grid">
        <BarsCard charts={charts} />
        <AgreeCard a={agreement(deals, stmt)} gaps={agreementGaps(deals, stmt)} checkedAt={checkedAt} titleOf={titleOf} onOpen={onOpen} />
      </div>
    </Section>
  );
}
