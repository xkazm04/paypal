// The owner's prices (rebuild WP3a): an item's lowest price, edited here as a draft (typed, stepped
// with the buttons or the arrow keys) against the market and the orders on it, and the one tray whose
// only way out is the approval window: lowest prices are a signed seller rule set, so "Review & sign"
// is `approval_open` with the first changed price as a pre-fill. Main never signs. Pure logic:
// modules/counter/model.ts.
import type { KeyboardEvent } from 'react';
import type { Deal } from '@bindings/Deal';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { Money } from '@bindings/Money';
import { clockLabel, exponent, formatMinor, formatMoney } from '../../../../../lib/format';
import { COUNTER } from '../../../../../lib/words';
import { Btn, Chip, Disclosure, Field, Kv, Silence } from '../../../../../shared/ui';
import { dealTotal, isLive } from '../../../logic';
import {
  currencyMark, draftFloor, draftState, fmtShort, floorText, itemName, minorToText, parseMoneyText, scaleOf, stepFloor, vsMarket,
  type CatalogRow, type DraftEntry, type DraftError, type FloorDraft, type Impact,
} from '../../../modules/counter/model';
import type { World } from '../../../world';
import { Amount, StateChip } from '../../rows';
import { HandOff } from '../tables/parts';

/** One item: its lowest price (editable), where it sits, and its orders. */
export function ItemPane({ row, draft, mandate, catPending, onText, onOrder }: {
  row: CatalogRow; draft: FloorDraft; mandate: MandateListEntry | null; catPending: boolean;
  onText: (t: string | undefined) => void; onOrder: (d: Deal) => void;
}) {
  const f = draftFloor(row, draft);
  const m = row.market;
  const changed = !!draftState([row], draft).diff[0];
  const title = itemName(row);
  return (
    <div className="ctr-pane">
      <header className="tr-phead">
        <h2 title={title}>{title}</h2>
        {catPending ? <Chip tone="dashed" title={COUNTER.catalogUnknown}>{COUNTER.catalogPending}</Chip> : null}
      </header>
      {row.title === null ? <p className="ui-hint">{COUNTER.codeOnly}</p> : null}
      <FloorField row={row} draft={draft} onText={onText} />
      <PriceScale row={row} floor={f} />
      <Kv items={[
        [COUNTER.lowest, row.signed
          ? <><span className="num">{formatMoney(row.signed)}</span>{COUNTER.signed}{changed && f ? <>{COUNTER.changingTo}<span className="num tx-gold">{formatMoney(f)}</span></> : null}</>
          : <>{COUNTER.notSet}{changed && f ? <>{COUNTER.changingTo}<span className="num tx-gold">{formatMoney(f)}</span></> : null}</>],
        row.ceiling ? [COUNTER.highest, <span className="num">{formatMoney(row.ceiling)}</span>] : null,
        [COUNTER.market, m ? <span title={COUNTER.marketTitle(formatMoney(m.p25), formatMoney(m.median), formatMoney(m.p75))}>{COUNTER.marketLine(formatMoney(m.p25), formatMoney(m.p75), formatMoney(m.median))}<span className="tx-dim">{COUNTER.marketChecked(clockLabel(m.retrieved_at))}</span></span> : <span className="tx-dim">{COUNTER.marketNone}</span>],
        f ? [COUNTER.vsMarket, vsMarket(f, m).long] : null,
        [COUNTER.listStock, <span className="tx-dim" title={COUNTER.catalogUnknown}>{COUNTER.catalogPending}</span>],
      ]} />
      <section aria-label={COUNTER.thisWeek}>
        <h3 className="ctr-h3">{COUNTER.thisWeek}</h3>
        {row.deals.length ? (
          <ul className="ctr-orders">
            {row.deals.slice(0, 12).map((d) => (
              <li key={d.id}><Btn sm kind="plain" onClick={() => onOrder(d)}><Amount money={dealTotal(d)} /></Btn><StateChip deal={d} /></li>
            ))}
            {row.deals.length > 12 ? <li className="tx-dim">+{row.deals.length - 12}</li> : null}
          </ul>
        ) : <p className="ui-hint">{COUNTER.ordersCount(0)}</p>}
      </section>
      <p className="ui-hint">{COUNTER.itemHint(!!mandate)}</p>
    </div>
  );
}

/** The lowest-price field: typed, stepped by one unit (Shift: ten), normalised on leaving it. */
function FloorField({ row, draft, onText }: { row: CatalogRow; draft: FloorDraft; onText: (t: string | undefined) => void }) {
  const text = floorText(row, draft);
  const changed = draft[row.itemRef] !== undefined;
  const bad = draftState([row], draft).errors[0];
  const unit = 10 ** exponent(row.currency);
  const step = (dir: 1 | -1, big: boolean) => onText(stepFloor(row, draft, dir * unit * (big ? 10 : 1)));
  const signedText = row.signed ? minorToText(row.signed.minor, row.currency) : '';
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey); }
  };
  const onBlur = () => {
    if (!changed) return;
    const minor = parseMoneyText(text, row.currency);
    if (minor === null) return; // keep the bad text visible with its "fix" chip
    const norm = minorToText(minor, row.currency);
    onText(norm === signedText ? undefined : norm);
  };
  return (
    <div className="ctr-floor">
      <span className="k" title={COUNTER.lowestTitle}>{COUNTER.lowest}</span>
      <Btn sm icon aria-label={COUNTER.lower} onClick={() => step(-1, false)}>−</Btn>
      <span className="cur-in">
        <span className="cur" aria-hidden="true">{currencyMark(row.currency)}</span>
        <Field inputMode="decimal" autoComplete="off" value={text} placeholder={COUNTER.none} className="num"
          aria-label={COUNTER.fieldLabel(itemName(row), row.signed ? formatMoney(row.signed) : null)} aria-invalid={!!bad}
          onChange={(e) => onText(e.target.value === signedText && row.signed ? undefined : e.target.value)} onKeyDown={onKey} onBlur={onBlur} />
      </span>
      <Btn sm icon aria-label={COUNTER.raise} onClick={() => step(1, false)}>+</Btn>
      {bad ? <Chip tone="red" title={bad.error}>{COUNTER.fix}</Chip>
        : changed ? <Btn sm kind="plain" title={COUNTER.revertTitle} onClick={() => onText(undefined)}>{COUNTER.revert(row.signed ? fmtShort(row.signed.minor, row.currency) : COUNTER.none)}</Btn> : null}
      {bad ? <span className="tx-red ctr-err">{bad.error}</span> : null}
    </div>
  );
}

/** Floor, the signed floor it replaces, the market band and the orders on one axis. */
function PriceScale({ row, floor }: { row: CatalogRow; floor: Money | null }) {
  const cur = row.currency;
  const m = row.market && row.market.median.currency === cur ? row.market : null;
  const was = row.signed && floor && row.signed.minor !== floor.minor ? row.signed.minor : null;
  const qs = row.deals.filter((d) => dealTotal(d).currency === cur).slice(0, 40);
  const vals = [floor?.minor, was, m?.p25.minor, m?.median.minor, m?.p75.minor, ...qs.map((d) => dealTotal(d).minor)].filter((v): v is number => typeof v === 'number');
  const x = scaleOf(vals);
  if (!x || vals.length < 2) return <p className="ui-hint">{COUNTER.nothingCompare(!!floor)}</p>;
  const pct = (v: number) => `${x(v).toFixed(2)}%`;
  return (
    <>
      <div className="ctr-scale" aria-hidden="true">
        <div className="bar" />
        {floor ? <div className="below" style={{ width: pct(floor.minor) }} /> : null}
        {m ? <div className="band" style={{ left: pct(m.p25.minor), width: `${(x(m.p75.minor) - x(m.p25.minor)).toFixed(2)}%` }} /> : null}
        {m ? <div className="tk mkt dn" style={{ left: pct(m.median.minor) }}><i className={was !== null ? (was < m.median.minor ? 'r' : 'l') : ''}>{COUNTER.tkTypical(fmtShort(m.median.minor, cur))}</i></div> : null}
        {was !== null ? <div className="tk was dn" style={{ left: pct(was) }}><i className={m && was >= m.median.minor ? 'r' : 'l'}>{COUNTER.tkWas(fmtShort(was, cur))}</i></div> : null}
        {floor ? <div className="tk floor up" style={{ left: pct(floor.minor) }}><i className="l">{COUNTER.tkLowest(fmtShort(floor.minor, cur))}</i></div> : null}
        {qs.map((d) => <div key={d.id} className={`dot${isLive(d) ? '' : ' sold'}`} style={{ left: pct(dealTotal(d).minor) }} />)}
      </div>
      <div className="ctr-legend"><span className="lg-q">{COUNTER.legend.order}</span><span className="lg-s">{COUNTER.legend.sold}</span><span className="lg-m">{COUNTER.legend.market}</span><span className="lg-b">{COUNTER.legend.below}</span></div>
    </>
  );
}

const IMPACT_TONE: Record<Impact['kind'], 'coral' | 'teal' | 'line'> = { withdraw: 'coral', stays: 'teal', keeps: 'line' };

/** The draft tray: the changed prices, what signing would do to open quotes, discard, and the hand-off. */
export function DraftBar({ mandate, diff, errors, impact, title, onDiscard, onFixFirst, onOpened }: {
  mandate: MandateListEntry | null; diff: readonly DraftEntry[]; errors: readonly DraftError[]; impact: readonly Impact[]; title: World['display'];
  onDiscard: () => void; onFixFirst: () => void; onOpened: () => void;
}) {
  const on = diff.length > 0 || errors.length > 0;
  const withdrawn = impact.filter((x) => x.kind === 'withdraw').length;
  if (!on) {
    return (
      <footer className="ctr-tray" aria-live="polite">
        {mandate ? <Chip tone="ok">{COUNTER.inForce}</Chip> : <Chip tone="dashed">{COUNTER.noneSigned}</Chip>}
        <span className="ui-hint grow">{mandate ? COUNTER.inForceUntil(clockLabel(mandate.payload.expires)) : COUNTER.createHint}</span>
      </footer>
    );
  }
  const first = diff[0];
  const src = first?.row.source;
  const args = src && first
    ? { deal_id: null, target: 'mandate' as const, draft: { type: 'floor' as const, mandate_id: src.mandateId, item_ref: first.row.itemRef, floor: first.to } }
    : { deal_id: null, target: 'mandate' as const };
  return (
    <footer className="ctr-tray on" aria-live="polite">
      <div className="ctr-trayrow">
        <Chip tone="gold" title={mandate ? COUNTER.becomesNext(mandate.payload.version + 1) : COUNTER.becomesFirst}>{COUNTER.unsigned}</Chip>
        <span className="diffs">
          {diff.map((d) => (
            <span key={d.row.itemRef}><span className="nm" title={itemName(d.row)}>{itemName(d.row)}</span> <span className="num tx-gold">{d.from ? fmtShort(d.from.minor, d.from.currency) : COUNTER.none}→{fmtShort(d.to.minor, d.to.currency)}</span></span>
          ))}
        </span>
        {errors.length ? <Chip tone="red" title={errors.map((x) => `${itemName(x.row)}: ${x.error}`).join(' · ')}>{COUNTER.toFix(errors.length)}</Chip> : null}
        <span className="ui-spacer" />
        <Silence text={mandate ? COUNTER.staysSigned : COUNTER.nothingSigned} />
        <Btn sm onClick={onDiscard}>{COUNTER.discard}</Btn>
        {errors.length ? <Btn sm onClick={onFixFirst}>{COUNTER.reviewSign}</Btn> : (
          <HandOff sm args={args} disabled={!diff.length} title={COUNTER.reviewSignTitle} onOpened={onOpened}>{COUNTER.reviewSign}</HandOff>
        )}
      </div>
      {impact.length ? (
        <Disclosure summary={withdrawn ? COUNTER.withdrawnN(withdrawn) : COUNTER.unaffected(impact.length)}>
          <p className="ui-hint">{COUNTER.ifSign}</p>
          <ul className="ctr-imp">
            {impact.slice(0, 20).map((x) => {
              const t = dealTotal(x.deal);
              const amt = formatMinor(t.minor, t.currency);
              const name = title(x.deal).title;
              return <li key={x.deal.id}><Chip tone={IMPACT_TONE[x.kind]}>{COUNTER.impactChip[x.kind]}</Chip><span>{COUNTER.impact[x.kind](name, amt)}</span></li>;
            })}
            {impact.length > 20 ? <li className="tx-dim">+{impact.length - 20}</li> : null}
          </ul>
        </Disclosure>
      ) : null}
    </footer>
  );
}
