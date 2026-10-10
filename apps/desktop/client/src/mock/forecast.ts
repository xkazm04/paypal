// Browser mock of the walk-away forecast and the quit confirm's lines. Mirrors
// crates/table-attention/src/forecast.rs (`forecast`) and quit.rs (`quit_lines`, the same
// sentences) over the mock deals, so the Tumbler and the quit sheet draw what Rust would send.
// The pipeline's own gates (shield, mandate window) are not modelled: every seller deal is
// treated as allowed, which is what the sample data shows.
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import type { ForecastLine } from '@bindings/ForecastLine';
import type { QuitLine } from '@bindings/QuitLine';

const ORDER_CREATED_DEADLINE_SECS = 6 * 3600;
const AUTHORIZED_DEADLINE_SECS = 72 * 3600;
export const FORECAST_HORIZON_SECS = 72 * 3600;

const TERMINAL: ReadonlySet<DealState> = new Set(['CAPTURED', 'RECEIPTED', 'RECONCILED', 'WITHDRAWN', 'EXPIRED', 'REFUSED', 'FAILED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED', 'DISPUTED', 'UNCONFIRMED']);
const PRE_CAPTURE: ReadonlySet<DealState> = new Set(['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED']);

/** `receiptAt`: when a buyer's seller-attested receipt was accepted (RECEIPTED only), else null / absent. */
export type ForecastDeal = { deal: Deal; label: string; deadline: number | null; receiptAt?: number | null };
const CORROBORATION_SECS = 72 * 3600;
export type ForecastCtx = { now: number; paused: boolean; executorConfigured: boolean };

function amountOf(deal: Deal): number {
  return deal.terms.unit_price.minor * deal.terms.qty;
}

/** What the scheduler does to every open deal if nobody decides anything (forecast.rs). */
export function mockForecast(deals: readonly ForecastDeal[], ctx: ForecastCtx): ForecastLine[] {
  const out: ForecastLine[] = [];
  const horizonEnd = ctx.now + FORECAST_HORIZON_SECS;
  for (const { deal, label, deadline: dealDeadline, receiptAt } of deals) {
    if (deal.mode === 'replay') continue;
    // A buyer's deal only the seller says is paid ends UNCONFIRMED unless PayPal's statement matches
    // first (forecast.rs, Ledger::lapse_corroboration): the time alone, no PayPal call, no money.
    if (deal.state === 'RECEIPTED' && deal.side === 'buyer' && receiptAt != null) {
      const due = receiptAt + CORROBORATION_SECS;
      if (due <= horizonEnd) {
        const overdue = due <= ctx.now;
        out.push({
          deal_id: deal.id, label, amount_minor: amountOf(deal), currency: deal.terms.currency, before: null,
          trigger: overdue ? 'next_tick' : 'deadline', at: overdue ? null : due,
          action: 'unconfirm', authority: 'safe_default', direction: 'none', end_state: 'UNCONFIRMED',
        });
      }
      continue;
    }
    if (TERMINAL.has(deal.state)) continue;
    const before = dealDeadline;
    const line = (o: Pick<ForecastLine, 'trigger' | 'at' | 'action' | 'authority' | 'direction' | 'end_state'>): ForecastLine => ({
      deal_id: deal.id, label, amount_minor: amountOf(deal), currency: deal.terms.currency,
      before: o.trigger === 'buyer_approves' ? before : null, ...o,
    });
    const capture = (trigger: ForecastLine['trigger']) => line({ trigger, at: null, action: 'capture', authority: 'seller_mandate', direction: 'in', end_state: 'RECEIPTED' });
    const authorize = (trigger: ForecastLine['trigger']) => line({ trigger, at: null, action: 'authorize', authority: 'seller_mandate', direction: 'none', end_state: 'AUTHORIZED' });
    let state = deal.state;
    let deadline = dealDeadline;
    const due = deadline !== null && deadline <= ctx.now;
    const digital = deal.terms.delivery.type === 'digital_now';
    const sellerMay = ctx.executorConfigured;
    if (!due && deal.side === 'seller') {
      if (state === 'AGREED' && !ctx.paused && ctx.executorConfigured) {
        out.push(line({ trigger: 'next_tick', at: null, action: 'create_order', authority: 'mandate_rule', direction: 'none', end_state: 'AWAITING_APPROVAL' }));
        state = 'AWAITING_APPROVAL';
        deadline = ctx.now + ORDER_CREATED_DEADLINE_SECS;
      } else if (state === 'APPROVED' && sellerMay) {
        out.push(authorize('next_tick'));
        state = 'AUTHORIZED';
        deadline = ctx.now + AUTHORIZED_DEADLINE_SECS;
        if (digital) { out.push(capture('next_tick')); state = 'CAPTURED'; }
      } else if (state === 'AUTHORIZED' && digital && sellerMay) {
        out.push(capture('next_tick'));
        state = 'CAPTURED';
      } else if (state === 'AWAITING_APPROVAL' && sellerMay) {
        out.push(authorize('buyer_approves'));
        if (digital) out.push(capture('buyer_approves'));
        else if (ctx.now + AUTHORIZED_DEADLINE_SECS <= horizonEnd) {
          out.push(line({ trigger: 'buyer_approves', at: ctx.now + AUTHORIZED_DEADLINE_SECS, action: 'auto_void', authority: 'safe_default', direction: 'none', end_state: 'AUTO_VOIDED' }));
        }
      }
    }
    if (deadline === null || !PRE_CAPTURE.has(state) || deadline > horizonEnd) continue;
    const [action, end_state]: [ForecastLine['action'], DealState] =
      state === 'AUTHORIZED' ? ['auto_void', 'AUTO_VOIDED']
        : state === 'SETTLING' || state === 'AWAITING_APPROVAL' || state === 'APPROVED' ? ['expire', 'EXPIRED']
          : ['lapse', 'WITHDRAWN'];
    out.push(line({ trigger: 'deadline', at: deadline, action, authority: 'safe_default', direction: 'none', end_state }));
  }
  return out.sort((a, b) => (a.at ?? -Infinity) - (b.at ?? -Infinity) || a.deal_id.localeCompare(b.deal_id));
}

// quit.rs sentences, word for word
export const ON_QUIT = 'Quitting stops the wallet: agents stop, PayPal is not checked and deadlines wait until you open The Table again. Nothing is paid from here while it is off. To keep it working, close the window instead; the wallet stays in the tray.';
const T = {
  request_not_sent: 'The payment request is not sent to the buyer until you open The Table again.',
  not_collected: 'The payment the buyer approved is not collected until you open The Table again.',
  not_held: 'The payment the buyer approved is not put on hold for you until you open The Table again.',
  not_collected_if: 'If the buyer approves on PayPal, the payment is not collected until you open The Table again.',
  not_held_if: 'If the buyer approves on PayPal, the payment is not put on hold for you until you open The Table again.',
  waits: 'Waits for you. Nothing is paid from here while The Table is off.',
  waits_deadline: 'Waits for you. If its time runs out, it ends when you open The Table again, and no money moves.',
  request_runs_out: 'If it is not approved on PayPal in time, the payment request runs out there by itself. No money moves.',
  hold_runs_out: 'Stays on hold at PayPal. If it is not collected, PayPal releases the hold by itself (29 days at most); the wallet releases it sooner once you are back and its time is up.',
  seller_may_collect: 'You approved this payment on PayPal, so the seller can still collect it while The Table is off.',
} as const;

/** `DealState::terminal()` in table-core. */
const ENDED: ReadonlySet<DealState> = new Set(['WITHDRAWN', 'EXPIRED', 'REFUSED', 'MISMATCH', 'FAILED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED', 'DISPUTED', 'RECONCILED', 'UNCONFIRMED']);
/** A deal the quit confirm lists (dispatcher.rs `quit_summary`). */
export function quitPending(deal: Deal): boolean {
  return ['AGREED', 'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED', 'MISMATCH'].includes(deal.state)
    || ((deal.shield === 'HOLD' || deal.shield === 'BLOCK') && !ENDED.has(deal.state));
}

/** quit.rs `quit_lines`: what will not happen while off, and what PayPal still does itself. */
export function mockQuitLines(pending: readonly ForecastDeal[], forecast: readonly ForecastLine[]): { while_off: QuitLine[]; at_paypal: QuitLine[] } {
  const while_off: QuitLine[] = [];
  const at_paypal: QuitLine[] = [];
  for (const { deal, label } of pending) {
    const line = (effect: QuitLine['effect'], text: string): QuitLine => ({ deal_id: deal.id, label, effect, amount_minor: amountOf(deal), currency: deal.terms.currency, text });
    const mine = forecast.filter((l) => l.deal_id === deal.id);
    const step = mine.find((l) => l.action === 'capture') ?? mine.find((l) => l.action === 'authorize');
    const paypal: QuitLine[] = [];
    if (deal.side === 'buyer' && (deal.state === 'APPROVED' || deal.state === 'AUTHORIZED')) paypal.push(line('seller_may_collect', T.seller_may_collect));
    if (deal.state === 'AWAITING_APPROVAL') paypal.push(line('request_runs_out', T.request_runs_out));
    if (deal.state === 'AUTHORIZED') paypal.push(line('hold_runs_out', T.hold_runs_out));
    if (step) {
      const collects = step.action === 'capture';
      while_off.push(step.trigger === 'buyer_approves'
        ? line('not_collected_if_approved', collects ? T.not_collected_if : T.not_held_if)
        : line('not_collected', collects ? T.not_collected : T.not_held));
    } else if (mine.some((l) => l.action === 'create_order')) {
      while_off.push(line('request_not_sent', T.request_not_sent));
    } else if (!paypal.length) {
      while_off.push(line('waits', mine.some((l) => l.trigger === 'deadline') ? T.waits_deadline : T.waits));
    }
    at_paypal.push(...paypal);
  }
  return { while_off, at_paypal };
}
