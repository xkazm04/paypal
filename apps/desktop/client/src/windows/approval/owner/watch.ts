// Watching subscriptions for a failed renewal (rescue_watch_add / rescue_watch_stop): the owner's
// list, kept by the wallet and checked with PayPal every few hours. Pure; the sheet in
// RescueWatch.tsx only draws it. Every value here is re-checked by Rust.
import type { RescueWatchArgs } from '@bindings/RescueWatchArgs';
import type { RescueWatchView } from '@bindings/RescueWatchView';
import { isEmail, isPlan, isSubscriptionId } from './replay';

export type WatchDraft = { subscription: string; email: string; plan: string };
export type WatchBuilt = { ok: true; args: RescueWatchArgs } | { ok: false; problems: string[] };

/** Rust RESCUE_WATCH_MAX: the most subscriptions one wallet watches. */
export const WATCH_MAX = 20;

export function buildWatch(d: WatchDraft, watching: readonly RescueWatchView[]): WatchBuilt {
  const problems: string[] = [];
  const subscription = d.subscription.trim();
  const email = d.email.trim();
  const plan = d.plan.trim();
  if (!isSubscriptionId(subscription)) problems.push('Enter the PayPal subscription id, like I-BW452GLLEP1G.');
  if (!isEmail(email)) problems.push('Enter the subscriber’s email address.');
  if (!isPlan(plan)) problems.push('Enter the plan as one word, like care-plan.');
  if (watching.length >= WATCH_MAX && !watching.some((w) => w.subscription_id === subscription)) {
    problems.push('You’re watching as many subscriptions as your wallet checks. Stop watching one first.');
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, args: { subscription_id: subscription, subscriber_email: email, plan } };
}

/** When the wallet checks a watched subscription next, in a few words ("in 3 h", "soon"). */
export function nextCheckWords(w: Pick<RescueWatchView, 'next_read_at'>, now: number): string {
  const left = w.next_read_at - now;
  if (left <= 60) return 'checked again soon';
  const h = Math.floor(left / 3600);
  const m = Math.ceil((left % 3600) / 60);
  return `checked again in ${h ? `${h} h` : `${m} min`}`;
}
