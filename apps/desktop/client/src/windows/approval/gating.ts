// Which controls the approval window offers, and when they are enabled.
//
// This module never grants anything: Rust re-checks every decision (label, token, lock, selected
// deal, terms hash, attempt, mandate, shield, state). The client only NARROWS what Rust allows,
// so a button never invites a call that the contract says must fail, and nothing money-moving is
// clickable while the wallet is locked, the capability is missing or Rust says can_release=false.
//
// Sources of truth for these rules: docs/build/STATUS.md "Client handoff" and the Rust summary
// (crates/table-runtime/src/service.rs `summary`/`decide`, table-core `DealState::terminal`).
import type { ApprovalCheckId } from '@bindings/ApprovalCheckId';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import type { DecisionArgs } from '@bindings/DecisionArgs';

export type Gate = {
  /** Rendered at all. A hidden control is not "disabled": the contract has no such action here. */
  visible: boolean;
  /** Clickable now. */
  enabled: boolean;
  /** Why it is disabled (shown to the owner), null when enabled or hidden. */
  reason: string | null;
};

export type GateContext = {
  summary: ApprovalSummary;
  /** settings.locked from get_settings / settings:changed. */
  settingsLocked: boolean;
  /** A privileged call answered LOCKED since the last successful unlock. */
  lockedByError: boolean;
  /** The approval capability was obtained (held in memory only). */
  tokenReady: boolean;
  /** Text the owner typed to release a shield HOLD. */
  typedName: string;
  /** The display name the owner must type exactly (payee / counterparty display). */
  expectedName: string | null;
};

export type Gates = {
  /** Owner ACCEPT of the counterparty's latest COUNTER on a buyer haggle (deal_owner_accept). */
  ownerAccept: Gate;
  countersign: Gate;
  openPaypal: Gate;
  capture: Gate;
  void: Gate;
  releaseHold: Gate;
  rescue: Gate;
  withdraw: Gate;
  bandSet: Gate;
};

const HIDDEN: Gate = { visible: false, enabled: false, reason: null };

/** Rust `DealState::terminal()`. */
export const TERMINAL: ReadonlySet<DealState> = new Set<DealState>([
  'WITHDRAWN', 'EXPIRED', 'REFUSED', 'MISMATCH', 'FAILED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED', 'DISPUTED', 'RECONCILED', 'UNCONFIRMED',
]);

/** Rust `transition(s, Withdraw)`: pre-capture and not an authorization (that one is voided). */
export const WITHDRAWABLE: ReadonlySet<DealState> = new Set<DealState>([
  'PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING_APPROVAL', 'APPROVED',
]);

/** States before settlement, where band_set may still rebind the mandate version. */
const BAND_MOVABLE: ReadonlySet<DealState> = new Set<DealState>(['PAIRING', 'LISTED', 'NEGOTIATING']);

export function isTerminal(state: DealState): boolean {
  return TERMINAL.has(state);
}

/**
 * The owner's own PayPal resources: seller-side deals and the owner's own purchases. A buyer's
 * haggle or shop order runs on the SELLER's credentials, so the buyer never authorizes,
 * captures or voids it (STATUS: "do not offer buyer-side capture/authorize buttons").
 * A rescue's invoice has its own decision (the rescue gate); invoices are deferred; replay is
 * never executed.
 */
export function ownsPaypalResource(deal: Pick<Deal, 'side' | 'kind' | 'mode'>): boolean {
  if (deal.kind === 'rescue' || deal.kind === 'invoice') return false;
  if (deal.mode === 'replay') return false;
  return deal.side === 'seller' || deal.kind === 'purchase';
}

/**
 * Owner ACCEPT exists only where Rust says so (`can_owner_accept === true`; absent means false,
 * for older shells) and only on a buyer haggle: the seller side and the owner's own purchases
 * have no counter-offer to accept. Rust also checks the deadline, rounds, mandate and shield.
 */
export function offersOwnerAccept(summary: Pick<ApprovalSummary, 'can_owner_accept' | 'deal'>): boolean {
  const d = summary.deal;
  return summary.can_owner_accept === true && d.side === 'buyer' && d.kind === 'haggle' && d.mode !== 'replay';
}

/**
 * The wallet's checklist lets a money decision through: it has lines and none fails. A release
 * of a shield hold is the decision about the shield line, so that one line is exempt for it
 * (Rust applies the same rule when the decision arrives). A wait line is checked by the step
 * the decision starts, before any money moves, so it never blocks. No checklist (an older
 * shell) allows nothing.
 */
export function checksAllow(summary: Pick<ApprovalSummary, 'checks'>, exempt?: ApprovalCheckId): boolean {
  const checks = summary.checks ?? [];
  return checks.length > 0 && checks.every((c) => c.status !== 'fail' || c.id === exempt);
}
const CHECK_BLOCK = 'A check above failed, so this can’t go ahead.';

export function isLocked(ctx: Pick<GateContext, 'summary' | 'settingsLocked' | 'lockedByError'>): boolean {
  return ctx.summary.locked || ctx.settingsLocked || ctx.lockedByError;
}

/** Normalise for the exact-name check: trim and collapse inner whitespace, case-sensitive. */
export function namesMatch(typed: string, expected: string | null): boolean {
  if (!expected) return false;
  const n = (s: string) => s.trim().replace(/\s+/g, ' ');
  return n(typed).length > 0 && n(typed) === n(expected);
}

export function deriveGates(ctx: GateContext): Gates {
  const { summary } = ctx;
  const deal = summary.deal;
  const state = deal.state;
  const locked = isLocked(ctx);
  const terminal = isTerminal(state);
  const mismatch = state === 'MISMATCH';
  const shield = deal.shield;
  const held = shield === 'HOLD' || shield === 'BLOCK';
  const owns = ownsPaypalResource(deal);

  // The common blocker for everything that needs the capability + unlock, in priority order.
  const privilegedBlock = (): string | null => {
    if (!ctx.tokenReady) return 'This window can’t approve right now. Open it again from The Table.';
    if (locked) return 'Locked. Unlock with Windows Hello first.';
    return null;
  };
  // Every money decision needs the wallet's checklist to have no failed line.
  const checkBlock = checksAllow(summary) ? null : CHECK_BLOCK;
  // Money-moving controls additionally need Rust's can_release.
  const moneyBlock = (): string | null =>
    privilegedBlock() ?? checkBlock ?? (summary.can_release ? null : summary.unavailable_reason ?? 'The wallet can’t do this for this deal right now.');

  const gate = (visible: boolean, block: string | null): Gate =>
    visible ? { visible: true, enabled: block === null, reason: block } : HIDDEN;

  // Owner ACCEPT: sign the counterparty's latest COUNTER under the owner key. Moves no money
  // (PayPal approval follows later in the browser), but it commits the owner to a price, so it
  // needs the capability + unlock like every other decision. Never on a mismatch or a held shield.
  const ownerAccept = gate(
    offersOwnerAccept(summary) && !terminal && !mismatch && !held,
    privilegedBlock() ?? checkBlock ?? (summary.counter_hash ? null : 'Their latest offer hasn’t arrived yet.'),
  );

  // Countersign: AGREED → create the order, APPROVED → authorize. Owned resources only; a held
  // or blocked shield is released (or not) first; never on a mismatch.
  const countersign = gate(
    owns && !mismatch && !held && (state === 'AGREED' || state === 'APPROVED'),
    moneyBlock(),
  );

  // Browser approval: the buyer approves the core-verified order in the system browser. Gated
  // separately on can_open_paypal (buyer credentials are unnecessary). Never on a mismatch, never
  // under a HOLD/BLOCK, and only when no line of the wallet's checklist fails.
  const openPaypal = gate(
    deal.side === 'buyer' && state === 'AWAITING_APPROVAL' && !mismatch && !held,
    privilegedBlock() ??
      (checkBlock ? 'A check above failed, so PayPal won’t open.' : null) ??
      (summary.can_open_paypal ? null : 'Waiting until the seller’s payment request is checked.'),
  );

  // Capture / void an authorization the owner holds (the 3-day honor clock).
  const authorized = owns && state === 'AUTHORIZED' && !mismatch;
  const capture = gate(authorized && shield !== 'BLOCK', moneyBlock());
  // Void is the safe direction: it needs the capability and can_release, never the checklist.
  const voidGate = gate(authorized, privilegedBlock() ?? (summary.can_release ? null : summary.unavailable_reason ?? 'The wallet can’t do this for this deal right now.'));

  // Shield HOLD → ASK only, after the owner types the name exactly. BLOCK has no release at all.
  const releaseHold = gate(
    shield === 'HOLD' && !terminal,
    privilegedBlock() ??
      (checksAllow(summary, 'shield') ? null : CHECK_BLOCK) ??
      (namesMatch(ctx.typedName, ctx.expectedName) ? null : ctx.expectedName ? 'Type the name exactly as shown to unpause.' : 'The payee’s name isn’t available to confirm.'),
  );

  // Rescue fix: the owner approves the one discount invoice for a failed renewal (AGREED), or the
  // send of an invoice already made (SETTLING, only when Rust says it is the next step).
  const rescue = gate(deal.kind === 'rescue' && !held && (state === 'AGREED' || (state === 'SETTLING' && summary.can_release)), moneyBlock());

  // Withdraw is the safe direction: no unlock, no capability, no PayPal call.
  const withdraw = gate(WITHDRAWABLE.has(state), null);

  const bandSet = gate(deal.kind === 'haggle' && BAND_MOVABLE.has(state), privilegedBlock());

  return { ownerAccept, countersign, openPaypal, capture, void: voidGate, releaseHold, rescue, withdraw, bandSet };
}

/** True when any control that can move money (or advance toward it) is clickable. */
export function anyMoneyEnabled(g: Gates): boolean {
  return g.ownerAccept.enabled || g.countersign.enabled || g.openPaypal.enabled || g.capture.enabled || g.void.enabled || g.releaseHold.enabled || g.rescue.enabled;
}

/** DecisionArgs come only from the Rust summary - never composed from UI state. They carry the
 *  hash of the exact checklist shown, so Rust refuses the decision if it changed since. */
export function decisionArgs(s: ApprovalSummary): DecisionArgs {
  return { deal_id: s.deal.id, attempt: s.attempt, terms_hash: s.terms_hash, checks_hash: s.checks_hash };
}

/** Owner ACCEPT additionally binds the exact latest inbound COUNTER digest Rust reported.
 *  null when the summary carries none (the call would fail, so it is never made). */
export function ownerAcceptArgs(s: ApprovalSummary): DecisionArgs | null {
  if (!s.counter_hash) return null;
  return { ...decisionArgs(s), counter_hash: s.counter_hash };
}
