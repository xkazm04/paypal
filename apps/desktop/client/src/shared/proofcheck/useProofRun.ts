// Running the checks so a person can watch them: one line at a time, in the verifier's own order,
// each line made for real (never a timer pretending). The pace between lines is only for the eye
// and is zero under reduced motion. A new run cancels the one before it. A run "again" (after a
// change to the file) keeps the lines the last run made and replaces them one by one, so a line that
// holds still stays put and a line that turns red is the only one that moves.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Money } from '../../lib/proof/bundle';
import { CHECK_IDS, type CheckLine } from '../../lib/proof/checks';
import { type Side, sideOf } from '../../lib/proof/sides';
import { prepareProof, verified } from '../../lib/proof/verify';
import { isCalm } from '../../design/motion';

/** What the file says about the deal, read from the file being checked (after any change to it). */
export interface Facts {
  deal_id: string;
  mode: string;
  side: string;
  state: string;
  owner_key_id: string;
  price: Money;
  qty: number;
  payee: string | null;
  authority_manifest: string | null;
  /** False when this browser cannot check Ed25519. */
  signatures: boolean;
}
export interface RunState {
  phase: 'idle' | 'running' | 'done';
  /** One slot per check, in report order; null until a run has made the line. */
  lines: Array<CheckLine | null>;
  /** How many lines the run in progress has made so far. */
  made: number;
  /** The lines before this run replaced them (null for a first run), to see which ones moved. */
  before: Array<CheckLine | null> | null;
  refused: string | null;
  verified: boolean | null;
  facts: Facts | null;
  /** What the file says about the deal, to set beside the other side's file; its verdict once done. */
  side: Side | null;
  /** Counts up with each run, so a view can restart an animation. */
  run: number;
}
const EMPTY: RunState = { phase: 'idle', lines: CHECK_IDS.map(() => null), made: 0, before: null, refused: null, verified: null, facts: null, side: null, run: 0 };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** How long a line stays up before the next: a dashed line passes quickly, a made one lingers. */
const PACE = { first: 230, again: 90, dashed: 0.4 } as const;

export function useProofRun(): { state: RunState; start: (text: string, pace?: 'first' | 'again') => Promise<void>; reset: () => void } {
  const [state, setState] = useState<RunState>(EMPTY);
  const latest = useRef(state);
  latest.current = state;
  const token = useRef(0);
  const runs = useRef(0);
  useEffect(() => () => { token.current += 1; }, []);

  const start = useCallback(async (text: string, pace: 'first' | 'again' = 'first') => {
    const mine = ++token.current;
    const run = ++runs.current;
    const kept = pace === 'again' && latest.current.lines.some(Boolean) ? latest.current.lines : null;
    setState({ ...EMPTY, lines: kept ?? EMPTY.lines, before: kept, phase: 'running', run });
    const prepared = await prepareProof(text);
    if (mine !== token.current) return;
    if ('refused' in prepared) {
      setState({ ...EMPTY, phase: 'done', refused: prepared.refused, run });
      return;
    }
    const bundle = prepared.bundle;
    const facts: Facts = {
      deal_id: prepared.deal_id,
      mode: prepared.mode,
      side: bundle.deal.side,
      state: bundle.deal.state,
      owner_key_id: prepared.owner_key_id,
      price: bundle.deal.terms.unit_price,
      qty: bundle.deal.terms.qty,
      payee: bundle.closed_mandates[0]?.mandate.payee ?? null,
      authority_manifest: prepared.authority_manifest,
      signatures: prepared.signatures,
    };
    const side = await sideOf(prepared, false);
    if (mine !== token.current) return;
    setState((s) => ({ ...s, facts, side }));
    const made: CheckLine[] = [];
    const lines: Array<CheckLine | null> = kept ? [...kept] : CHECK_IDS.map(() => null);
    for (const [index, id] of CHECK_IDS.entries()) {
      const line = await prepared.check(id);
      if (mine !== token.current) return;
      made.push(line);
      lines[index] = line;
      setState((s) => ({ ...s, lines: [...lines], made: made.length }));
      const wait = isCalm() ? 0 : line.applies ? PACE[pace] : PACE.dashed * PACE[pace];
      if (wait > 0) await sleep(wait);
      if (mine !== token.current) return;
    }
    const ok = verified(made);
    setState((s) => ({ ...s, phase: 'done', verified: ok, side: s.side ? { ...s.side, verified: ok } : null }));
  }, []);

  const reset = useCallback(() => {
    token.current += 1;
    setState(EMPTY);
  }, []);
  return { state, start, reset };
}
