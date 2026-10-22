// Round 2 pieces of the Shield page (experiment r2-shield): the week strip, "what's normal vs this
// payment", the three check lights and a Why? on each reason. Display only: nothing here decides,
// releases or sends anything. Facts and wording: ./normal.ts. Styles: ../shield.css (.sh-wk, .sh-cmp, .sh-lights).
import type { ReactNode } from 'react';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Deal } from '@bindings/Deal';
import { SHIELD } from '../../../../lib/words';
import { Icon, Why, type IconName } from '../../../../shared/ui';
import type { Reason } from './matrix';
import { checkLights, compareRows, whyFor, whyQuestion, type CompareCell, type Light, type LightState, type WeekStrip } from './normal';

// ---- the week strip: checked, paused, blocked --------------------------------------------------------------

function Tile({ tone, icon, n, label, sub }: { tone: 'teal' | 'gold' | 'red'; icon: IconName; n: number; label: string; sub: ReactNode }) {
  return (
    <li className={`sh-tile ${tone} ${n ? 'has' : 'zero'}`}>
      <span className="ico" aria-hidden="true"><Icon name={icon} size={18} /></span>
      <span className="n">{n}</span>
      <span className="tx"><b>{label}</b><small>{sub}</small></span>
    </li>
  );
}

/** Three large tiles. The counts are the page's own lists, so the strip and the rows below always agree. */
export function WeekTiles({ strip }: { strip: WeekStrip }) {
  const W = SHIELD.panels;
  const since = strip.scope === 'week' ? W.thisWeek : W.soFar;
  return (
    <ul className="sh-wk" aria-label={W.stripLabel(since)}>
      <Tile tone="teal" icon="shield" n={strip.checked} label={W.checked(since)} sub={strip.checked ? (strip.safe ? W.looked(strip.safe) : W.noneLooked) : W.nothingToCheck} />
      <Tile tone="gold" icon="pause" n={strip.paused} label={W.pausedForYou} sub={strip.paused ? (strip.waiting ? W.waiting(strip.waiting) : W.noneWaiting) : W.nothingPaused} />
      <Tile tone="red" icon="block" n={strip.blocked} label={W.blocked} sub={strip.blocked ? W.stoppedForGood : W.nothingBlocked} />
    </ul>
  );
}

// ---- Why? on a reason ---------------------------------------------------------------------------------------

/** "Why?" behind one reason of a paused payment: two sentences from facts on the card. */
export function ReasonWhy({ reason, deal, cp, now }: { reason: Reason; deal: Deal; cp: CounterpartyDisplay | undefined; now: number }) {
  const [a, b] = whyFor(reason.kind, deal, cp, now);
  return <Why question={whyQuestion(reason.kind)}><p>{a}</p><p>{b}</p></Why>;
}

// ---- what's normal vs this payment ---------------------------------------------------------------------------

function Cell({ c, here, diff }: { c: CompareCell; here?: boolean; diff?: boolean }) {
  return (
    <td className={`${here ? 'here' : 'norm'} ${c.unknown ? 'unk' : ''} ${diff && here ? 'diff' : ''}`}>
      <span className="v">{c.text}</span>
      {c.sub ? <span className="s">{c.sub}</span> : null}
    </td>
  );
}

/** Two columns, one row per fact: the left is what is usual, the right is this payment; the rows
 *  that differ are highlighted. A fact the client does not hold is dashed, never green. */
export function ComparePanel({ deal, cp, known, now }: { deal: Deal; cp: CounterpartyDisplay | undefined; known: { known: number; total: number } | null; now: number }) {
  const rows = compareRows(deal, cp, known, now);
  const diffs = rows.filter((r) => r.tone === 'differs').length;
  return (
    <section className="sh-cmp" aria-label={SHIELD.panels.compare}>
      <table>
        <colgroup><col className="lab" /><col /><col /></colgroup>
        <thead>
          <tr>
            <th scope="col" className="lab"><span className="sr">{SHIELD.panels.fact}</span></th>
            <th scope="col" className="norm">{SHIELD.panels.normal}</th>
            <th scope="col" className="here">{SHIELD.panels.thisPayment}{diffs ? <span className="cnt">{SHIELD.panels.difference(diffs)}</span> : null}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.tone}>
              <th scope="row" className="lab">{r.label}</th>
              <Cell c={r.normal} />
              <Cell c={r.here} here diff={r.tone === 'differs'} />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---- the three check lights ------------------------------------------------------------------------------------

const LIGHT_ICON: Record<LightState, IconName> = { tripped: 'alert', passed: 'check', skipped: 'eye', unknown: 'eye' };

function Lamp({ l }: { l: Light }) {
  return (
    <li className={`sh-lamp ${l.state}`} title={l.detail}>
      <span className="bulb" aria-hidden="true"><Icon name={LIGHT_ICON[l.state]} size={13} /></span>
      <span className="tx"><b>{l.name}</b><small>{l.word}</small></span>
    </li>
  );
}

/** Fixed checks · Price check · Message check (not active yet): which tripped, which passed, which did not stop it (dashed). */
export function CheckLights({ deal, cp, now }: { deal: Deal; cp: CounterpartyDisplay | undefined; now: number }) {
  const lights = checkLights(deal, cp, now);
  return (
    <section className="sh-lights" aria-label={SHIELD.panels.checks}>
      <div className="hd">{SHIELD.panels.checks}</div>
      <ul>{lights.map((l) => <Lamp key={l.stage} l={l} />)}</ul>
    </section>
  );
}
