// Shared row parts for every list of the console (rebuild WP2.5): an amount, a state chip, a
// countdown chip, a counterparty chip, and a whole deal row built from them. Honest by
// construction: an amount is integer minor units through lib/format (never parsed back out of
// text); a state is said in words (stateWord), and a state the words do not know reads "Not
// available yet" on a dashed chip, never the raw name; an unknown amount or deadline is the dash,
// never zero or green. Counterparty names are their own words only as a name: truncated with the
// full name in the title, quoted in full one level deeper (the deal), never as instructions.
import type { CSSProperties, ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import type { Money } from '@bindings/Money';
import { formatMinor } from '../../../lib/format';
import { useNow } from '../../../lib/hooks';
import { AMOUNT_UNKNOWN_TITLE, houseWords, IF_NOTHING, NO_DEADLINE, STATE_UNKNOWN, STATE_UNKNOWN_TITLE, stateWord, WHO_UNKNOWN, type WordTone } from '../../../lib/words';
import { Countdown as Ticking } from '../../../shared/honesty';
import { MODULE } from '../../../shared/modules';
import { UNKNOWN } from '../../../shared/ui';
import { shortTitle, silenceParts, timeLeft } from '../home/model';
import { amountTone, dealTotal } from '../logic';
import { useDisplayOf, useWorldSelector, type World } from '../world';

/** How an amount reads: money that moved, money on hold, a proposal, or money that never moved. */
export type AmountTone = 'moved' | 'held' | 'proposed' | 'struck';

/** An amount from integer minor units. `null` (not known yet) is the dash, never $0.00. */
export function Amount({ money, minor, currency, tone, className }: {
  money?: Money | null; minor?: number | null; currency?: Currency | null; tone?: AmountTone; className?: string;
}) {
  const m = money !== undefined ? money : minor !== undefined && minor !== null && currency ? { minor, currency } : null;
  if (!m || !Number.isSafeInteger(m.minor)) return <span className={`cs-amt unknown${className ? ` ${className}` : ''}`} title={AMOUNT_UNKNOWN_TITLE}>{UNKNOWN}</span>;
  return <span className={`cs-amt num${tone ? ` ${tone}` : ''}${className ? ` ${className}` : ''}`}>{formatMinor(m.minor, m.currency)}</span>;
}

const KNOWN_TONES: ReadonlySet<WordTone> = new Set(['teal', 'gold', 'ok', 'red', 'coral', 'line']);

/** A deal's state in plain words, coloured by its meaning (never by colour alone: the words are
 *  there). A state the words have no entry for is "Not available yet" on a dashed chip. */
export function StateChip({ state, deal }: { state?: DealState | string | null; deal?: Pick<Deal, 'state' | 'side' | 'kind'> }) {
  const s = deal?.state ?? state ?? null;
  let w: { text: string; tone: WordTone; means: string } | null = null;
  try {
    w = s ? stateWord(s as DealState, deal ? { side: deal.side, kind: deal.kind } : {}) : null;
  } catch {
    w = null;
  }
  if (!w || typeof w.text !== 'string' || !KNOWN_TONES.has(w.tone)) {
    return <span className="cs-state dashed" title={STATE_UNKNOWN_TITLE}>{STATE_UNKNOWN}</span>;
  }
  return <span className={`cs-state t-${w.tone}`} title={w.means}>{w.text}</span>;
}

/** Time left to a deadline as a chip that never wraps (tabular figures). No deadline is said so,
 *  dimmed; the time is up reads urgent. `ticking` shows the running clock instead of "2 h left". */
export function Countdown({ deadline, ticking, className }: { deadline: number | null | undefined; ticking?: boolean; className?: string }) {
  const now = useNow();
  if (deadline === null || deadline === undefined) return <span className={`cs-cd none${className ? ` ${className}` : ''}`}>{NO_DEADLINE}</span>;
  const left = timeLeft(deadline, now);
  return (
    <span className={`cs-cd${left?.urgent ? ' urgent' : ''}${className ? ` ${className}` : ''}`}>
      {ticking ? <Ticking deadline={deadline} /> : left?.text}
    </span>
  );
}

/** A counterparty's name as a chip: truncated, the full name in its title. `null` = not named yet. */
export function WhoChip({ name, className }: { name: string | null | undefined; className?: string }) {
  if (!name) return <span className={`cs-who-chip unknown${className ? ` ${className}` : ''}`}>{WHO_UNKNOWN}</span>;
  const full = houseWords(name);
  return <span className={`cs-who-chip${className ? ` ${className}` : ''}`} title={full}>{full}</span>;
}

const selCp = (w: World) => w.moduleOfDeal;

/** One deal as a list row's content: what it is, with whom, the amount, its state, and - when it
 *  waits for the owner - the "If you do nothing" line and its countdown. Content only: put it inside
 *  the ListEngine row (which is the button) or any other container. */
export function DealRow({ deal, need, who, extra }: {
  deal: Deal;
  /** The open decision on this deal, if any (World useNeedOf). */
  need?: AttentionItem | null;
  /** The counterparty's display name (ui.tsx useCpLookup), if known. */
  who?: string | null;
  /** One more line under the title (a module's own fact). */
  extra?: ReactNode;
}) {
  const disp = useDisplayOf(deal.id);
  const moduleOf = useWorldSelector(selCp);
  const m = moduleOf(deal);
  const style = { '--c': MODULE[m].cssVar } as CSSProperties;
  const sil = need ? silenceParts(need.on_silence) : null;
  return (
    <span className={`cs-dealrow${need ? ' needs' : ''}`} style={style}>
      <span className="dot" aria-hidden="true" />
      <span className="t">
        <b>{disp ? shortTitle(disp.title) : UNKNOWN}</b>
        <span className="sub"><WhoChip name={who} />{extra ? <> · {extra}</> : null}</span>
        {sil ? <span className="sil">{IF_NOTHING}: {sil.head}</span> : null}
      </span>
      <Amount money={dealTotal(deal)} tone={amountTone(deal)} />
      <StateChip deal={deal} />
      {need ? <Countdown deadline={need.deadline} /> : null}
    </span>
  );
}
