// The contract between the home (Home.tsx) and the guide that leads setup in its conversation
// (guide/Guide.tsx). The home implements GuideHost and mounts the guide while the wallet is in setup;
// the guide drives the home only through this host, never by reaching into its state.
import type { ReactNode } from 'react';
import type { Module } from '@bindings/Module';

/** Regions the home marks with `data-region="<name>"`, for the guide's spotlight. */
export type HomeRegion = 'status' | 'need' | 'chips' | 'transcript' | 'ask' | 'side' | 'side-switcher' | 'side-list' | 'stage';

/** A local assistant turn the guide adds to the conversation (never sent to the model). */
export type GuideTurn = { text: string; card?: ReactNode };

export type GuideHost = {
  /** The element the home marked for this region, or null if it is not on screen now. */
  region(r: HomeRegion): HTMLElement | null;
  /** Ask the assistant as if the owner typed it (goes through useBoardAssistant). */
  ask(question: string): void;
  /** Drive the side panel: switch module (or 'all') and open a row (rowId null = just switch). */
  pick(module: Module | 'all', rowId: string | null): void;
  /** Return main to today's conversation (as Esc / the Today crumb). */
  back(): void;
  /** Append a local assistant turn to today's conversation and bring it into view. */
  say(turn: GuideTurn): void;
};

/** `asked`: mounted on a set-up wallet because a setup step was asked for: offer it, even if setup
 *  was finished or skipped before. */
export type GuideProps = { host: GuideHost; asked?: boolean };

// "Show me that setup step": a reply's setup proposal or a setup panel's step asks the guide to offer
// its current step again, under the conversation's newest turn. The guide registers while mounted.
let offer: (() => void) | null = null;
export function onOfferSetup(f: () => void): () => void {
  offer = f;
  return () => { if (offer === f) offer = null; };
}
/** False when no guide is mounted (the caller then does what it does on a set-up wallet). */
export function offerSetup(): boolean {
  if (!offer) return false;
  offer();
  return true;
}
