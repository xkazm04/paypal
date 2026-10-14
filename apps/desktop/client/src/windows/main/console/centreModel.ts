// The decision centre's pure model: the queue order, the seal's state from the facts, the facts
// strip, the deadline arc and how many cards fit the stack row. No React, no IO. Every sentence
// comes from lib/words.ts or from the wallet's own words (the attention item), never invented here.
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { SealState } from '../../../shared/brand';
import type { Fact } from '../../../shared/ui';
import { formatMinor } from '../../../lib/format';
import {
  FACT, factWith, houseWords, MONEY_CHECK_ENDED_SHORT, moneyCheckNow, moneyCheckPill, NO_DEADLINE, ruleNameOf, SEAL_LINE, SEAL_WORD, yourRule,
} from '../../../lib/words';
import { moneyCheckEnded, sortItems } from '../../tumbler/logic';
import { timeLeft } from '../home/model';
import { beadKind, isTerminal, moneyNow, stateLabel } from '../logic';

/** The queue as the centre walks it: Rust's order (deadline, no clock last, then id; the Tumbler's
 *  `sortItems`), with the decisions put off with "Later" moved to the back in the order they were
 *  put off. Only the order changes: nothing is hidden, nothing is decided. */
export function orderQueue(needs: readonly AttentionItem[], later: readonly string[]): AttentionItem[] {
  const sorted = sortItems(needs);
  if (!later.length) return sorted;
  const back = new Set(later);
  const front = sorted.filter((n) => !back.has(n.deal_id));
  const byId = new Map(sorted.map((n) => [n.deal_id, n]));
  const tail = later.flatMap((id) => { const n = byId.get(id); return n ? [n] : []; });
  return [...front, ...tail];
}

/** "Later": the decision goes to the back (once; putting it off again moves it to the very end). */
export const putOff = (later: readonly string[], id: string): string[] => [...later.filter((x) => x !== id), id];

/** The index of the current decision: the one picked, while it still waits; else the first. */
export function currentIndex(queue: readonly AttentionItem[], picked: string | null): number {
  if (!queue.length) return -1;
  const i = picked === null ? -1 : queue.findIndex((n) => n.deal_id === picked);
  return i < 0 ? 0 : i;
}

/** One step through the queue, wrapping round. */
export const cycle = (i: number, d: 1 | -1, n: number): number => (n <= 0 ? -1 : (i + d + n) % n);

export type Presence = { state: SealState; word: string; line: string };

/** The seal and the presence line, from the facts (never decoration only):
 *  - first run: quiet, nothing can pay until the charter is signed;
 *  - a payment that just went through (a receipt event): paid;
 *  - nothing needs the owner: holding when money is on hold at PayPal, watching when deals are in
 *    progress, else quiet;
 *  - the decision in front: a payment being checked with PayPal is watching (or stopped once its
 *    deal ended without PayPal showing what happened), a paused payment and a hold at PayPal are
 *    holding, a deal that will not be paid is stopped, anything else needs the owner. */
export function presenceOf(o: {
  firstRun: boolean;
  top: AttentionItem | undefined;
  deal: Deal | undefined;
  heldAtPayPal: number;
  moving: number;
  paidFlash?: boolean;
}): Presence {
  const at = (state: SealState, line: string, word: string = SEAL_WORD[state]): Presence => ({ state, word, line });
  if (o.firstRun) return at('quiet', SEAL_LINE.setup);
  if (o.paidFlash) return at('paid', SEAL_LINE.paid);
  const t = o.top;
  if (!t) {
    if (o.heldAtPayPal > 0) return at('holding', SEAL_LINE.holding);
    if (o.moving > 0) return at('watching', SEAL_LINE.watching);
    return at('quiet', SEAL_LINE.quiet);
  }
  if (t.money_check) return moneyCheckEnded(t) ? at('stopped', MONEY_CHECK_ENDED_SHORT) : at('watching', SEAL_LINE.checking);
  if (t.kind === 'hold') return at('holding', SEAL_LINE.paused);
  if (o.deal && o.deal.state === 'AUTHORIZED') return at('holding', SEAL_LINE.holding);
  if (o.deal && beadKind(o.deal) === 'stopped') return at('stopped', SEAL_LINE.stopped);
  return at('needs', SEAL_LINE.needs);
}

/** The fraction of a deadline still left (for the seal's gold arc), or null when the deadline or
 *  the deal's start is not known: no arc rather than a guessed one. */
export function deadlineProgress(deadline: number | null, created: number | undefined, now: number): number | null {
  if (deadline === null || created === undefined || deadline <= created) return null;
  return Math.max(0, Math.min(1, (deadline - now) / (deadline - created)));
}

/** The three facts under a decision, in the wallet's own words: the amount (and with whom), what
 *  the money is doing now, and why it asks the owner (the rule) with the time left. Unknown values
 *  are null (the strip dashes them). */
export function centreFacts(item: AttentionItem, deal: Deal | undefined, now: number): Fact[] {
  const amount = formatMinor(item.amount_minor, item.currency);
  const who = item.counterparty ? houseWords(item.counterparty) : null;
  const held = deal?.state === 'AUTHORIZED';
  const ended = deal ? isTerminal(deal) : moneyCheckEnded(item);
  const state = item.money_check ? moneyCheckPill(item.money_check, ended).text : deal ? stateLabel(deal.state, deal) : null;
  const money = item.money_check ? moneyCheckNow(ended) : deal ? moneyNow(deal) : null;
  const left = timeLeft(item.deadline, now);
  return [
    { key: 'amount', k: held ? FACT.held : FACT.amount, v: amount, tone: 'gold', num: true, note: who ? factWith(who) : undefined },
    { key: 'now', k: FACT.now, v: state, note: money ?? undefined },
    { key: 'why', k: FACT.why, v: item.clause ? yourRule(ruleNameOf(item.clause.number)) : FACT.noRule, note: left ? left.text : NO_DEADLINE },
  ];
}

/** How many cards the "Next in the stack" row shows at a width: 2 narrow, 4, 6 wide. */
export function stackSlots(width: number): number {
  if (width <= 760) return 2;
  if (width >= 1700) return 6;
  return 4;
}
