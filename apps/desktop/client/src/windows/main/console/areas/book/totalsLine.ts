// The one line that sums deals, in owner words: the grid's pinned totals row and a group's amount read
// it. Money honesty lives here: paid out and paid in apart, on hold apart, one figure per currency,
// nothing added across those. Only money PayPal confirmed is paid; a payment being checked with PayPal
// is neither paid nor held, and is only counted as being checked. Pure.
import type { Deal } from '@bindings/Deal';
import type { Money } from '@bindings/Money';
import { formatMinor } from '../../../../../lib/format';
import { BOOK } from '../../../../../lib/words';
import { figures } from './model';

const list = (ms: readonly Money[]): string => ms.map((m) => formatMinor(m.minor, m.currency)).join(' · ');

/** "Paid out $120.00 · €40.00, Paid in $5.00, On hold going out $3.00"; the dash when there is no money to say. */
export function totalsLine(deals: readonly Deal[], checking: (d: Deal) => boolean): string {
  const f = figures(deals, checking);
  const parts: string[] = [];
  if (f.paidOut.length) parts.push(`${BOOK.tiles.out} ${list(f.paidOut)}`);
  if (f.paidIn.length) parts.push(`${BOOK.tiles.in} ${list(f.paidIn)}`);
  const both = f.heldOut.length > 0 && f.heldIn.length > 0;
  if (f.heldOut.length) parts.push(`${BOOK.tiles.held}${both ? ` ${BOOK.goingOut}` : ''} ${list(f.heldOut)}`);
  if (f.heldIn.length) parts.push(`${BOOK.tiles.held}${both ? ` ${BOOK.comingIn}` : ''} ${list(f.heldIn)}`);
  if (f.checking) parts.push(BOOK.checkingShort(f.checking));
  return parts.length ? parts.join(', ') : BOOK.dash;
}
