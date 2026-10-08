// Browser mock of the wallet's rescue arithmetic and wording (Rust: table-core rescue.rs). The
// offer and the invoice text are computed exactly as Rust computes them, so the page and the
// approval window show the same numbers and words in the preview as in the app.
import type { Clause } from '@bindings/Clause';
import type { Currency } from '@bindings/Currency';
import type { InvoiceText } from '@bindings/InvoiceText';
import type { Money } from '@bindings/Money';
import type { OpenMandate } from '@bindings/OpenMandate';
import type { RescueOffer } from '@bindings/RescueOffer';
import { exponent } from '../lib/format';
import { percentWords } from '../lib/words';

type Lever = Extract<Clause, { type: 'lever' }>;

/** Money's Display in Rust: "9.60 USD". */
export function moneyDisplay(m: Money): string {
  const exp = exponent(m.currency);
  if (!exp) return `${m.minor} ${m.currency}`;
  const s = Math.abs(m.minor).toString().padStart(exp + 1, '0');
  return `${s.slice(0, -exp)}.${s.slice(-exp)} ${m.currency}`;
}

export const leverOf = (m: OpenMandate | undefined): Lever | undefined =>
  m?.payload.clauses.find((c): c is Lever => c.type === 'lever');

/** propose_discount: the largest discount inside both bounds; null when none fits (zero or
 *  another currency). */
export function proposeDiscount(cycle: Money, lever: Pick<Lever, 'max_discount_bp' | 'max_discount'>): RescueOffer | null {
  const { max_discount_bp: bp, max_discount: cap } = lever;
  if (cycle.currency !== cap.currency || bp <= 0 || bp >= 10000 || cycle.minor < 2) return null;
  const minor = Math.min(Math.floor((cycle.minor * bp) / 10000), cap.minor);
  if (minor <= 0) return null;
  const currency: Currency = cycle.currency;
  return {
    lever: 'DISCOUNT_THIS_CYCLE',
    cycle,
    discount: { minor, currency },
    invoice: { minor: cycle.minor - minor, currency },
    discount_bp: Math.floor((minor * 10000) / cycle.minor),
  };
}

/** invoice_text: the wallet's fixed template, filled only with the offer's numbers. */
export function invoiceText(o: RescueOffer): InvoiceText {
  return {
    item: 'Your renewal for this cycle, at a one-time discount',
    note: `Your last renewal payment did not go through. This invoice covers this cycle at ${percentWords(o.discount_bp)} off: ${moneyDisplay(o.invoice)} instead of ${moneyDisplay(o.cycle)}. The discount is for this cycle only; your plan and its price stay the same.`,
  };
}

/** Recipient::masked: "s•••@example.com". */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** Recipient::new: one @, a dotted domain, plain characters only. */
export function validEmail(email: string): boolean {
  const parts = email.split('@');
  if (email.length > 254 || parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  return !!local && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.') && /^[A-Za-z0-9@.\-_+]+$/.test(email);
}

/** valid_subscription_id: 1-64 letters, digits, `-` or `_`. */
export const validSubscriptionId = (id: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(id);
