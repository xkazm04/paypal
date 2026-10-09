// BROWSER PREVIEW ONLY. What a scenario beat can do, and how it is done on the mock world.
//
// Every action is something the Rust core would make happen on its own (time passing, a signed
// step arriving, a deadline default, a Tumbler form, a window opening) or a window the owner
// opens. None of them approves, captures, pays or releases anything: there is deliberately no
// such action, so a script cannot move money even in the preview. Approving stays a human click
// in the approval window, and in the mock that click moves no real money either.
import type { AttentionItem } from '@bindings/AttentionItem';
import type { DealState } from '@bindings/DealState';
import type { Form } from '@bindings/Form';
import type { ShieldVerdict } from '@bindings/ShieldVerdict';
import type { VisualState } from '@bindings/VisualState';
import { nowUnix } from '../lib/format';
import { saveTour, TOUR_NEW, tourEnd, tourKey, tourMove, type TourWindow } from '../lib/tour';
import type { TourStopId } from '../lib/words';
import type { MockWorld } from '../mock/backend';

export type Action =
  /** Time passes: move the shared clock forward; every deadline that passes takes its safe default. */
  | { do: 'advance'; seconds: number }
  /** Move the clock forward to `left` seconds before a deal's deadline (negative: after it). */
  | { do: 'until'; deal: string; left: number }
  /** Show a deal as it stood after its first `upTo` signed steps (the rest arrive later). */
  | { do: 'rewind'; deal: string; upTo: number; interim?: { state: DealState; shield: ShieldVerdict | null } }
  /** The core reports a new Tumbler form. */
  | { do: 'form'; form: Form }
  /** A notification was clicked: the core opens that deal's card in the Tumbler. */
  | { do: 'select'; deal: string }
  /** The core's puck hint (opacity, breathing). */
  | { do: 'visual'; visual: VisualState }
  /** PayPal opened in the system browser (never drawn here): the Tumbler's hand-off form. */
  | { do: 'handoff'; deal: string | null; within?: number }
  /** The core polled PayPal and saw the order approved. */
  | { do: 'approved_on_paypal'; deal: string }
  /** A new decision arrives (a sample item that is not part of the stored week). */
  | { do: 'arrival' }
  /** An agent request was stopped by the rules (the count only). */
  | { do: 'refused' }
  /** The approval window idle-locks (or unlocks, as after Windows Hello). */
  | { do: 'lock'; locked: boolean }
  /** The Table (main window) opens or closes, optionally on a route ("#d=D-0193", "#m=spend"). */
  | { do: 'main'; open: boolean; route?: string }
  /** The approval window opens on a deal's review, or closes (null). Opening never decides. */
  | { do: 'approval'; deal: string | null }
  /** The approval window opens on the owner's own setup (no deal), as `approval_open` with no deal
   *  does. Opening never signs or saves; closing it is `{ do: 'approval', deal: null }`. */
  | { do: 'owner' }
  /** Presentation only: a window's onboarding tour shows this stop (null: the tour is put away).
   *  It points; it never presses Next, Back or Skip inside a window. */
  | { do: 'tour'; win: TourWindow; at: TourStopId | null };

export type ActionKind = Action['do'];

/** Actions that change the mock world (and so must be replayed when the director seeks). */
export const WORLD_ACTIONS: ReadonlySet<ActionKind> = new Set(['advance', 'until', 'rewind']);

/** Where presentation actions land: the director's three frames, or the Tumbler's preview stage. */
export interface Stage {
  world: MockWorld;
  /** The core reports a Tumbler form (director: an event; preview stage: tumbler_set_form). */
  form(form: Form): void;
  /** Show or hide The Table, optionally routing it. A stage without a main window ignores it. */
  main(open: boolean, route: string | null): void;
  /** Open the approval window on a deal id, or close it. A stage without one ignores it. */
  approval(dealId: string | null): void;
  /** Open the approval window on the owner's setup. A stage without one leaves it out. */
  owner?(): void;
}

const dealId = (w: MockWorld, label: string): string | null => w.deal(label)?.deal.id ?? null;

/** Apply one action's effect on the world only (no frames). Returns the labels that lapsed. */
export function applyWorld(w: MockWorld, a: Action): string[] {
  switch (a.do) {
    case 'advance':
      return w.advance(a.seconds);
    case 'until': {
      const due = w.deal(a.deal)?.display.deadline;
      if (due == null) return w.sweep();
      // The clock only moves forward, as it does for the core.
      return w.advance(Math.max(0, due - a.left - nowUnix()));
    }
    case 'rewind':
      w.rewind(a.deal, a.upTo, a.interim);
      return [];
    default:
      return [];
  }
}

/** A sample decision the preview can drop in ("New decision arrives"); not part of the stored week. */
export function sampleArrival(now: number): AttentionItem {
  return {
    deal_id: '01JDPREVIEWARRIVAL00000207', label: 'D-0207', kind: 'gate', module: 'counter', headline: 'Countersign $48.00', amount_minor: 4800, currency: 'USD',
    counterparty: 'lark’s agent', clause: null, deadline: now + 3 * 3600, on_silence: 'the quote lapses at its deadline · no money moves', urgency: 'calm', mode: 'sandbox',
    actions: ['review', 'withdraw', 'let_lapse', 'snooze30', 'open_in_table'],
  };
}

/** Run one action on a stage: world effects first, then the Rust-shaped events and frames. */
export function runAction(stage: Stage, a: Action): void {
  const w = stage.world;
  if (WORLD_ACTIONS.has(a.do)) {
    applyWorld(w, a);
    return;
  }
  switch (a.do) {
    case 'form':
      stage.form(a.form);
      return;
    case 'select': {
      const id = dealId(w, a.deal);
      if (!id) return;
      stage.form('card');
      w.emit('tumbler:selected', { deal_id: id });
      return;
    }
    case 'visual':
      w.emit('tumbler:visual', a.visual);
      return;
    case 'handoff': {
      if (a.deal) {
        const d = w.deal(a.deal);
        if (!d) return;
        w.emit('tumbler:handoff', { deal_id: d.deal.id, approve_until: a.within !== undefined ? nowUnix() + a.within : d.display.deadline ?? nowUnix() + 3600 });
      }
      stage.form('handoff');
      return;
    }
    case 'approved_on_paypal': {
      const d = w.deal(a.deal);
      if (!d) return;
      w.emit('receipt:created', { deal_id: d.deal.id, evidence: { deal_id: d.deal.id, receipt: 'NONE', reconciliation: 'not_applicable' }, mode: d.deal.mode, state: 'APPROVED', on_silence: 'approved on PayPal · polled, never the redirect' });
      return;
    }
    case 'arrival': {
      const s = w.attention();
      w.emit('attention:changed', { ...s, items: [...s.items, sampleArrival(nowUnix())].sort((x, y) => (x.deadline ?? Infinity) - (y.deadline ?? Infinity)) });
      return;
    }
    case 'refused': {
      const s = w.attention();
      w.emit('attention:changed', { ...s, stopped_today: s.stopped_today + 1 });
      return;
    }
    case 'lock':
      w.emit('settings:changed', { ...w.settings(), locked: a.locked });
      w.emit('attention:changed', { ...w.attention(), locked: a.locked });
      return;
    case 'main':
      stage.main(a.open, a.route ?? null);
      return;
    case 'approval':
      stage.approval(a.deal ? dealId(w, a.deal) : null);
      return;
    case 'owner':
      stage.owner?.();
      return;
    case 'tour':
      pointTour(a.win, a.at);
      return;
  }
}

/**
 * A framed window's tour shows `at` (null: put away), written as that window's saved progress under
 * the first-run world's key; the window follows the write (shared/tour.tsx). Nothing is clicked.
 */
export function pointTour(win: TourWindow, at: TourStopId | null | undefined): void {
  saveTour(win, at === undefined ? TOUR_NEW : at === null ? tourEnd('finished') : tourMove(at), tourKey(true));
}

const TOUR_WINDOWS: readonly TourWindow[] = ['main', 'tumbler', 'approval'];

/** On a seek: every window's tour as the earlier beats left it (a window never pointed starts anew). */
export function placeTours(tour: Scene['tour']): void {
  for (const w of TOUR_WINDOWS) pointTour(w, tour[w]);
}

export function runActions(stage: Stage, actions: readonly Action[]): void {
  for (const a of actions) runAction(stage, a);
}

// ---- the scene: what the frames show after a run of beats (for seeking) -------------------------

export type Scene = {
  main: { open: boolean; route: string | null };
  /** Deal label the approval window is open on, or null. */
  approval: string | null;
  /** The approval window is open on the owner's setup (no deal). */
  owner: boolean;
  /** The stop each window's tour was pointed at (null: put away; missing: never pointed). */
  tour: Partial<Record<TourWindow, TourStopId | null>>;
  form: Form;
  selected: string | null;
  visual: VisualState | null;
};

export const INITIAL_SCENE: Scene = { main: { open: true, route: null }, approval: null, owner: false, tour: {}, form: 'rest', selected: null, visual: null };

export function foldScene(scene: Scene, actions: readonly Action[]): Scene {
  let s = scene;
  for (const a of actions) {
    switch (a.do) {
      case 'form': s = { ...s, form: a.form }; break;
      case 'select': s = { ...s, form: 'card', selected: a.deal }; break;
      case 'handoff': s = { ...s, form: 'handoff' }; break;
      case 'visual': s = { ...s, visual: a.visual }; break;
      case 'main': s = { ...s, main: { open: a.open, route: a.route ?? s.main.route } }; break;
      case 'approval': s = { ...s, approval: a.deal, owner: false }; break;
      case 'owner': s = { ...s, approval: null, owner: true }; break;
      case 'tour': s = { ...s, tour: { ...s.tour, [a.win]: a.at } }; break;
      default: break;
    }
  }
  return s;
}
