// BROWSER PREVIEW ONLY. Every hand-pressed control of the Tumbler preview stage, as a beat helper
// the scenario director can script. The stage's buttons run these same helpers, so a control and
// its beat cannot drift apart. Each returns plain data (see actions.ts).
import type { Action } from './actions';

const MIN = 60;
const HOUR = 3600;

/** The deal the stage's controls act on by default: Maya's monitor haggle with Dan. */
export const HAGGLE = 'D-0193';
/** The payment request whose amount does not match the signed deal. */
export const MISMATCH = 'D-0199';
/** The $64 dock on hold at PayPal. */
export const HOLD = 'D-0190';

export const helpers = {
  /** "The Table closed (first time)": the core shows the welcome form. */
  tableClosedFirstTime: (): Action[] => [{ do: 'form', form: 'welcome' }],
  /** "Dock to screen edge": a snap to the edge, the tab form. */
  dock: (): Action[] => [{ do: 'form', form: 'tab' }],
  /** "Undock": a drag back into free space, the resting puck. */
  undock: (): Action[] => [{ do: 'form', form: 'rest' }],
  /** "PayPal opened in browser": the hand-off for a deal, until its deadline. No PayPal page is drawn. */
  paypalOpened: (deal = HAGGLE): Action[] => [{ do: 'handoff', deal }],
  /** "...with 15 min or less to approve": the hand-off with 12 minutes left on PayPal. */
  paypalOpenedLate: (deal = HAGGLE): Action[] => [{ do: 'handoff', deal, within: 12 * MIN }],
  /** "Hand-off form only": an older shell sends no deal, so the hand-off stays generic. */
  handoffOnly: (): Action[] => [{ do: 'handoff', deal: null }],
  /** "Simulate: PayPal APPROVED (polled)": the core saw the order approved. */
  paypalApproved: (deal = HAGGLE): Action[] => [{ do: 'approved_on_paypal', deal }],
  /** "Deadline within 2 h": the clock runs to 100 minutes before the deadline; the ring breathes. */
  deadlineSoon: (deal = HAGGLE): Action[] => [{ do: 'until', deal, left: 100 * MIN }, { do: 'visual', visual: { opacity_percent: 100, breathe: true } }],
  /** "Deadline within 15 min": the clock runs to 14 minutes before the deadline; urgency now. */
  deadlineNow: (deal = HAGGLE): Action[] => [{ do: 'until', deal, left: 14 * MIN }, { do: 'visual', visual: { opacity_percent: 100, breathe: true } }],
  /** A deadline passes: the clock runs a minute past it and its safe default runs (never a capture). */
  deadlinePasses: (deal = HAGGLE): Action[] => [{ do: 'until', deal, left: -MIN }],
  /** "Notification clicked": the core opens that deal's card (tumbler:selected). */
  notificationClicked: (deal = HAGGLE): Action[] => [{ do: 'select', deal }],
  /** "MISMATCH arrives": the seller's payment request does not match the signed deal; a HOLD. */
  mismatchArrives: (deal = MISMATCH): Action[] => [
    { do: 'rewind', deal, upTo: 4, interim: { state: 'AGREED', shield: 'CLEAR' } },
    { do: 'rewind', deal, upTo: Number.MAX_SAFE_INTEGER },
  ],
  /** "New decision arrives": ring, bead and the arrival ticker. */
  newDecision: (): Action[] => [{ do: 'arrival' }],
  /** "Agent refused": the STOP ticker; it never pulses. */
  agentRefused: (): Action[] => [{ do: 'refused' }],
  /** "Idle lock": the approval window locks after 15 minutes idle (false: unlocked again). */
  idleLock: (locked = true): Action[] => [{ do: 'lock', locked }],
  /** "Quiet dim": the puck dims to 55 % after 45 s idle. */
  quietDim: (): Action[] => [{ do: 'visual', visual: { opacity_percent: 55, breathe: false } }],
  /** Time passes with nobody at the desk. */
  hoursPass: (hours = 1): Action[] => [{ do: 'advance', seconds: Math.round(hours * HOUR) }],
} as const;

export type HelperName = keyof typeof helpers;
