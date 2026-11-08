// The reply's suggested next steps, drawn by the host (moved out of Switchboard.tsx for the Proof
// Table; behaviour unchanged). A proposal is armed only if the host resolves it (resolve.ts); one that
// changes the wallet is drawn as a consent box whose every word comes from the resolution, never from
// the reply, and its one act-tier command runs only on the owner's press (Switchboard `perform`). The
// act's undo is the host's own button. Nothing here approves, signs, captures, voids or releases.
import type { WalletError } from '../../../lib/contract';
import { BOARD_ACT, BOARD_PROPOSAL } from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { Btn } from '../../../shared/ui';
import { resolveAction, undoAvailable, type ActRun, type BoardFacts, type Consent, type Run } from './resolve';
import type { BoardKey } from './useBoardModel';
import type { UiOp } from '../../../lib/assistant';

export type Proposal = { id: number; action: Extract<UiOp, { op: 'propose' }>['action']; why: string };
/** The outcome of an act the owner pressed on this page (kept until the next act or Esc). */
export type Acted = { proposal: Proposal; run: ActRun; fingerprint: string; reverse: string; phase: 'done' | 'undone' };

export type ProposalsProps = {
  proposals: readonly Proposal[];
  acted: Acted | null;
  byId: ReadonlyMap<string, BoardKey>;
  facts: BoardFacts;
  stale: ReadonlySet<number>;
  locked: boolean;
  /** The approval window is opening. */
  opening: boolean;
  act: { pending: boolean; error: WalletError | null };
  undoAct: { pending: boolean; error: WalletError | null };
  perform: (p: Proposal, shown: Consent) => void;
  undo: (a: Acted) => void;
  run: (r: Run) => void;
  /** May the first armed hand-off be the page's one gold button? Only when these steps sit in the
   *  focused answer and that answer draws no gold of its own (Switchboard decides). */
  gold: boolean;
};

/** Is there anything to draw? */
export const hasProposals = (p: Pick<ProposalsProps, 'proposals' | 'acted'>): boolean => p.proposals.length > 0 || p.acted !== null;

export function Proposals({ proposals, acted, byId, facts, stale, locked, opening, act, undoAct, perform, undo, run, gold }: ProposalsProps) {
  // The one gold button: the first armed hand-off to the approval window, if gold is allowed here.
  const goldId = gold ? proposals.find((p) => { const r = resolveAction(p.action, byId, facts); return r.armed && !r.act && r.run.kind === 'approval'; })?.id ?? null : null;
  return (
    <>
      {proposals.length ? (
        <ul className="sb-proposals" aria-label={BOARD_PROPOSAL.label}>
          {proposals.map((p) => {
            // An act whose outcome is shown below is not offered again beside it.
            if (acted && acted.phase === 'done' && acted.proposal === p) return null;
            const r = resolveAction(p.action, byId, facts);
            const why = <span className="sb-why"><b>{BOARD_PROPOSAL.because}:</b> {p.why}</span>;
            if (r.armed && r.act) {
              // The consent box: every word from the resolution (fixed words + the wallet's facts).
              const c = r.consent;
              return (
                <li key={p.id} className="sb-proposal act" data-proposal={p.action.action} data-act={r.run.act}>
                  {why}
                  <section className="sb-consent ui-rail" data-tone="gold" aria-label={BOARD_ACT.boxLabel} data-consent={r.run.act}>
                    <span className="sb-ok">{r.confirm}</span>
                    <b className="sb-ct">{c.title}</b>
                    <span>{c.does}</span>
                    <span>{c.doesNot}</span>
                    <span className="sb-quiet">{c.reverse}</span>
                    <span className="sb-actions">
                      <Btn sm disabled={act.pending || undoAct.pending} onClick={() => perform(p, c)} data-press={r.run.act}>{act.pending ? c.pressing : c.press}</Btn>
                    </span>
                    {stale.has(p.id) ? <span className="sb-quiet" data-stale>{BOARD_ACT.whyDisarmed.changed}</span> : null}
                    {act.error ? <WalletNotice error={act.error} what={BOARD_ACT.failed} /> : null}
                  </section>
                </li>
              );
            }
            return (
              <li key={p.id} className={`sb-proposal${r.armed ? '' : ' off'}`} data-proposal={p.action.action}>
                <Btn sm kind={p.id === goldId ? 'gold' : 'default'} disabled={!r.armed || opening} onClick={() => { if (r.armed && !r.act) run(r.run); }} locked={r.armed && !r.act && r.run.kind === 'approval' && locked}>{r.label}</Btn>
                {why}
                <span className="sb-quiet">{r.armed ? r.confirm : `${BOARD_PROPOSAL.disarmed}: ${r.reason}`}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {acted ? (
        <div className="sb-acted" role="status" data-acted={`${acted.run.act}:${acted.phase}`}>
          <span>{acted.phase === 'done' ? acted.run.done : acted.run.undone}</span>
          {acted.phase === 'done' && undoAvailable(acted.run, facts) ? (
            <span className="sb-actions">
              <Btn sm disabled={undoAct.pending || act.pending} onClick={() => undo(acted)} title={acted.run.undoTitle} data-undo={acted.run.act}>{undoAct.pending ? BOARD_ACT.undoing : BOARD_ACT.undo}</Btn>
              <span className="sb-quiet">{acted.reverse}</span>
            </span>
          ) : null}
          {undoAct.error ? <WalletNotice error={undoAct.error} what={BOARD_ACT.undoFailed} /> : null}
        </div>
      ) : null}
    </>
  );
}
