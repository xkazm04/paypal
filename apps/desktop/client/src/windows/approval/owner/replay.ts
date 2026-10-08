// The labelled replay of a failed renewal (rescue_replay): PayPal documents no way to make a sandbox
// renewal fail, so the owner records one. Pure; the sheet in RescueReplay.tsx only draws it. Every
// value here is re-checked by Rust, which also works out the one fix inside the signed fixes rule.
import type { Clause } from '@bindings/Clause';
import type { Currency } from '@bindings/Currency';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { RescueReplayArgs } from '@bindings/RescueReplayArgs';

export type ReplayDraft = { subscription: string; email: string; plan: string; price: string };
export type Lever = Extract<Clause, { type: 'lever' }>;

/** Rust valid_subscription_id: 1-64 letters, digits, `-` or `_`. */
export const isSubscriptionId = (s: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(s);
/** Rust Recipient::new: one @, a dotted domain, plain characters only. */
export function isEmail(s: string): boolean {
  const parts = s.split('@');
  if (s.length > 254 || parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  return !!local && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.') && /^[A-Za-z0-9@.\-_+]+$/.test(s);
}
/** Rust ItemRef: 1-128 letters, digits or `-_.:@+`. */
export const isPlan = (s: string): boolean => /^[A-Za-z0-9\-_.:@+]{1,128}$/.test(s);

/** The rules a replay is recorded under: the newest active set that carries the fixes rule. */
export function rescueRules(entries: readonly MandateListEntry[], now: number): { entry: MandateListEntry; lever: Lever; currency: Currency } | null {
  const live = entries.filter((m) => !m.refusal && m.payload.not_before <= now && m.payload.expires > now);
  for (let i = live.length - 1; i >= 0; i--) {
    const m = live[i]!;
    const lever = m.payload.clauses.find((c): c is Lever => c.type === 'lever');
    if (lever) return { entry: m, lever, currency: lever.max_discount.currency };
  }
  return null;
}

export type ReplayBuilt = { ok: true; args: RescueReplayArgs } | { ok: false; problems: string[] };

export function buildReplay(d: ReplayDraft, currency: Currency, parse: (text: string, c: Currency) => number | null): ReplayBuilt {
  const problems: string[] = [];
  const subscription = d.subscription.trim();
  const email = d.email.trim();
  const plan = d.plan.trim();
  if (!isSubscriptionId(subscription)) problems.push('Enter the PayPal subscription id, like I-BW452GLLEP1G.');
  if (!isEmail(email)) problems.push('Enter the subscriber’s email address.');
  if (!isPlan(plan)) problems.push('Enter the plan as one word, like care-plan.');
  const minor = parse(d.price, currency);
  if (minor === null || minor <= 0) problems.push('Enter the renewal’s price, above zero.');
  if (problems.length || minor === null) return { ok: false, problems };
  return { ok: true, args: { subscription_id: subscription, subscriber_email: email, plan, amount: { minor, currency } } };
}
