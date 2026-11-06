// spark abstract-first-home round 3: the contract between the Stage front door and the simulated
// first-project experiences (sim/guide, sim/tour, sim/story). Stage implements StageHost and mounts
// <Sim/> when `?sim=` names a variant; a sim drives Stage only through this host, never by reaching
// into Stage's state. Prototype-only: the winner is promoted, the others and `?sim=` are removed.
import type { ReactNode } from 'react';
import type { Module } from '@bindings/Module';

export type SimVariant = 'guide' | 'tour' | 'story';
export const SIM_VARIANTS: readonly SimVariant[] = ['guide', 'tour', 'story'];

export function simVariant(search: string = typeof location === 'undefined' ? '' : location.search): SimVariant | null {
  const v = new URLSearchParams(search).get('sim');
  return (SIM_VARIANTS as readonly string[]).includes(v ?? '') ? (v as SimVariant) : null;
}

/** The URL that starts a simulated first project: a fresh first-run mock world with the sim on. */
export const simUrl = (v: SimVariant): string => `?home=stage&first_run=1&sim=${v}`;
/** Where a sim exits to: the ordinary Stage on the sample world. */
export const SIM_EXIT_URL = '?home=stage';

/** Regions Stage marks with `data-sim-region="<name>"`, for coach marks and spotlights. */
export type SimRegion = 'status' | 'need' | 'chips' | 'transcript' | 'ask' | 'side' | 'side-switcher' | 'side-list' | 'stage';

/** A local assistant turn a sim adds to the transcript (never sent to the model). */
export type SimTurn = { text: string; card?: ReactNode };

export type StageHost = {
  /** The element Stage marked for this region, or null if it is not on screen now. */
  region(r: SimRegion): HTMLElement | null;
  /** Ask the assistant as if the owner typed it (goes through useBoardAssistant). */
  ask(question: string): void;
  /** Drive the side panel: switch module (or 'all') and open a row (rowId null = just switch). */
  pick(module: Module | 'all', rowId: string | null): void;
  /** Return main to today's conversation (as Esc / the Today crumb). */
  back(): void;
  /** Put sim content in the main column's stage slot (an item-page-like view); null clears it. */
  setMain(node: ReactNode | null): void;
  /** Append a local assistant turn to today's transcript and bring the conversation into view. */
  say(turn: SimTurn): void;
};

export type SimProps = { host: StageHost; exit: () => void };
