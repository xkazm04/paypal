// The instrument strip: the money, read at a glance. Room left today against the signed daily limit,
// deals today against the limit, what is held (at PayPal, and agreed but not yet at PayPal), what
// PayPal confirmed, and whether the records still check out. Every number is the wallet's own
// (the exposure fold, safety_record); one that is not known is dashed "not available yet", never 0.
import type { ReactNode } from 'react';
import type { Currency } from '@bindings/Currency';
import { formatMinor } from '../../../lib/format';
import { meterFill } from '../../../lib/limits';
import { BOARD_INST, BOARD_NOT_AVAILABLE, BOARD_STRIP_LABEL } from '../../../lib/words';
import { Meter } from '../../../shared/ui';
import { NotYet } from './parts';
import type { BoardInstruments } from './useBoardModel';

export type StripTarget = 'money' | 'safety';

const money = (minor: number | null, cur: string | null): string | null => (minor === null || cur === null ? null : formatMinor(minor, cur as Currency));
const whole = (s: string): string => s.replace(/\.0+(?=\s|$)/, '');

function Gauge({ id, label, onOpen, children }: { id: string; label: string; onOpen: () => void; children: ReactNode }) {
  return (
    <button type="button" className="sb-inst" data-inst={id} onClick={onOpen}>
      <span className="sb-k">{label}</span>
      {children}
    </button>
  );
}

export function InstrumentStrip({ inst, onOpen }: { inst: BoardInstruments; onOpen: (t: StripTarget) => void }) {
  const cur = inst.currency;
  const room = money(inst.room_left_minor, cur);
  const cap = money(inst.day_cap_minor, cur);
  const roomFill = inst.day_cap_minor !== null && inst.out_today_minor !== null ? meterFill(inst.out_today_minor, inst.day_cap_minor) : null;
  const dealsFill = inst.deals_cap !== null && inst.deals_today !== null ? meterFill(inst.deals_today, inst.deals_cap) : null;
  const stake = inst.held_at_paypal_minor !== null && inst.held_before_minor !== null ? inst.held_at_paypal_minor + inst.held_before_minor : null;
  const heldFill = inst.held_cap_minor !== null && stake !== null ? meterFill(stake, inst.held_cap_minor) : null;
  const stakeText = money(stake, cur);
  const out = money(inst.paid_out_minor, cur);
  const inn = money(inst.paid_in_minor, cur);
  return (
    <section className="sb-strip" aria-label={BOARD_STRIP_LABEL}>
      <Gauge id="room" label={BOARD_INST.room} onOpen={() => onOpen('money')}>
        <span className="sb-v num">{room ?? <NotYet what={BOARD_INST.room} />}</span>
        <Meter value={roomFill ? roomFill.fill : null} tone={roomFill?.near ? 'gold' : undefined} label={BOARD_INST.room} />
        <span className="sb-s">{cap ? BOARD_INST.roomOf(whole(cap)) : BOARD_INST.roomNone}</span>
      </Gauge>
      <Gauge id="deals" label={BOARD_INST.deals} onOpen={() => onOpen('money')}>
        <span className="sb-v num">{inst.deals_today === null ? <NotYet what={BOARD_INST.deals} /> : inst.deals_today}</span>
        <Meter value={dealsFill ? dealsFill.fill : null} tone={dealsFill?.near ? 'gold' : undefined} label={BOARD_INST.deals} />
        <span className="sb-s">{inst.deals_cap !== null ? BOARD_INST.dealsOf(inst.deals_cap) : BOARD_INST.roomNone}</span>
      </Gauge>
      <Gauge id="held" label={BOARD_INST.held} onOpen={() => onOpen('money')}>
        <span className="sb-v num">{stakeText ?? <NotYet what={BOARD_INST.held} />}</span>
        <Meter value={heldFill ? heldFill.fill : null} tone={heldFill?.near ? 'gold' : undefined} label={BOARD_INST.held} />
        <span className="sb-s">
          {money(inst.held_at_paypal_minor, cur) !== null && money(inst.held_before_minor, cur) !== null
            ? <>{BOARD_INST.heldAt(money(inst.held_at_paypal_minor, cur)!)} · {BOARD_INST.heldBefore(money(inst.held_before_minor, cur)!)}</>
            : BOARD_NOT_AVAILABLE}
        </span>
      </Gauge>
      <Gauge id="confirmed" label={BOARD_INST.confirmed} onOpen={() => onOpen('money')}>
        <span className="sb-v num">{out ?? <NotYet what={BOARD_INST.confirmed} />}</span>
        <span className="sb-s">{out ? BOARD_INST.confirmedOut(out) : BOARD_NOT_AVAILABLE}</span>
        <span className="sb-s">{inn ? BOARD_INST.confirmedIn(inn) : BOARD_NOT_AVAILABLE}</span>
      </Gauge>
      <Gauge id="records" label={BOARD_INST.records} onOpen={() => onOpen('safety')}>
        <span className={`sb-v rec${inst.records ? ` ${inst.records}` : ''}`}>{inst.records === 'intact' ? BOARD_INST.recordsIntact : inst.records === 'broken' ? BOARD_INST.recordsBroken : <NotYet what={BOARD_INST.records} />}</span>
        <span className="sb-s">{inst.records === 'broken' ? BOARD_INST.recordsBrokenLine : inst.records_count !== null ? BOARD_INST.recordsCount(inst.records_count) : BOARD_NOT_AVAILABLE}</span>
      </Gauge>
    </section>
  );
}
