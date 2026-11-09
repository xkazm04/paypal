// Shared row parts for every list of the console (rebuild WP2.5): an amount, a state chip, a
// countdown chip, a counterparty chip, and a whole deal row built from them. Honest by
// construction: an amount is integer minor units through lib/format (never parsed back out of
// text); a state is said in words (stateWord), and a state the words do not know reads "Not
// available yet" on a dashed chip, never the raw name; an unknown amount or deadline is the dash,
// never zero or green. Counterparty names are their own words only as a name: truncated with the
// full name in the title, quoted in full one level deeper (the deal), never as instructions.
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import type { Money } from '@bindings/Money';
import { clockLabel, formatMinor } from '../../../lib/format';
import { useNow } from '../../../lib/hooks';
import { AMOUNT_UNKNOWN_TITLE, houseWords, IF_NOTHING, NO_DEADLINE, STATE_UNKNOWN, STATE_UNKNOWN_TITLE, stateWord, WHO_UNKNOWN, type WordTone } from '../../../lib/words';
import { Countdown as Ticking } from '../../../shared/honesty';
import { MODULE } from '../../../shared/modules';
import { UNKNOWN } from '../../../shared/ui';
import { shortTitle, timeLeft } from '../home/model';
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

/** A DealRow's accessible name: the row draws no "If you do nothing" (its page says it once), so the
 *  name carries it for a deal that waits for the owner. */
export const dealRowSay = (title: string, need?: AttentionItem | null): string => (need ? `${title}. ${IF_NOTHING}: ${need.on_silence}` : title);

/** One deal as a list row's content: what it is, with whom, the amount, its state, and - when it
 *  waits for the owner - its countdown. Content only: put it inside the ListEngine row (which is the
 *  button) or any other container. */
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
  return (
    <span className={`cs-dealrow${need ? ' needs' : ''}`} style={style}>
      <span className="dot" aria-hidden="true" />
      <span className="t">
        <b>{disp ? shortTitle(disp.title) : UNKNOWN}</b>
        <span className="sub"><WhoChip name={who} />{extra ? <> · {extra}</> : null}</span>
      </span>
      <Amount money={dealTotal(deal)} tone={amountTone(deal)} />
      <StateChip deal={deal} />
      {need ? <Countdown deadline={need.deadline} /> : null}
    </span>
  );
}

/** Column widths of a one-line row (the `.row1` contract): the name takes what is left, the state,
 *  the amount and the time are fixed so the columns line up from row to row. */
export const ROW1_COLS = 'minmax(9rem, 1fr) 8.5rem 6.5rem 8rem';
/** Whether a row may draw its note: false inside a split view (the list shares the sheet with a pane,
 *  so the note is said in the pane and the row title instead). */
export const RowNoteContext = createContext(true);
/** The note track, added after the others when a row has a note. */
const ROW1_NOTE = 'minmax(0, 1.2fr)';

/** One list row on one line (cells: what and with whom, state, amount, time, then the note). The
 *  note is the row's old second line: a trailing single-line cell that the engine's CSS hides on a
 *  narrow window; it is also the row's title, and the area's detail pane says it in full. Content
 *  only (the ListEngine row is the button): no control goes in a row. */
export function Row1({ cols = ROW1_COLS, note, title, className, children }: {
  cols?: string; note?: ReactNode; title?: string; className?: string; children: ReactNode;
}) {
  const room = useContext(RowNoteContext);
  const noted = room && note !== undefined && note !== null && note !== '';
  const style = { '--cols': noted ? `${cols} ${ROW1_NOTE}` : cols, '--cols-lite': cols } as CSSProperties;
  return (
    <span className={`row1${className ? ` ${className}` : ''}`} style={style} title={title} data-noted={noted ? '' : undefined}>
      {children}
      {noted ? <span className="c-note">{note}</span> : null}
    </span>
  );
}

/** A deal as a one-line row: its name and who, the state, the amount, and the time (the countdown
 *  when it waits for the owner, else when it last moved). `note` is the optional trailing cell. */
export function DealRow1({ deal, need, who, note, picked }: {
  deal: Deal; need?: AttentionItem | null; who?: string | null; note?: ReactNode; picked?: boolean;
}) {
  const disp = useDisplayOf(deal.id);
  const moduleOf = useWorldSelector(selCp);
  const at = deal.updated_at ?? deal.created_at ?? null;
  return (
    <Row1 className={`${need ? 'needs ' : ''}${picked ? 'picked' : ''}`.trim() || undefined} note={note} title={typeof note === 'string' ? note : undefined}>
      <span className="c-who" style={{ '--c': MODULE[moduleOf(deal)].cssVar } as CSSProperties}>
        <span className="dot" aria-hidden="true" />
        <b title={disp?.title}>{disp ? shortTitle(disp.title) : UNKNOWN}</b>
        <WhoChip name={who} />
      </span>
      <span className="c-state"><StateChip deal={deal} /></span>
      <Amount money={dealTotal(deal)} tone={amountTone(deal)} />
      <span className="c-time">{need ? <Countdown deadline={need.deadline} /> : at ? clockLabel(at) : UNKNOWN}</span>
    </Row1>
  );
}
