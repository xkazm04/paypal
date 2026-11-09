// Undo a "Let it lapse" (deal_lapse_undo, act tier, main window). Shown where the owner just let a
// deal lapse (the deal page, a purchase), until the deadline the lapse runs to: the wallet refuses an
// undo once the deal has ended, so after the deadline the button is gone and the line says why. The
// undo puts the needs-you item back (the wallet's attention:changed event re-reads the list); it
// starts no agent and moves no money.
import { clockLabel } from '../../../../../lib/format';
import { useMutation, useNow } from '../../../../../lib/hooks';
import { LAPSE_UNDO } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, useToast } from '../../../../../shared/ui';
import { clearLapsed, useLapsed } from './lapsed';

export function LapseUndo({ dealId, title, ended, onToast }: {
  dealId: string;
  /** The deal's short title: the button's accessible name says which deal it takes back. */
  title: string;
  /** The deal already ended: nothing is left to undo, so nothing shows. */
  ended: boolean;
  /** The surface's own toast, when it has one (the purchase pane); the shared toast otherwise. */
  onToast?: (text: string, tone?: 'gold' | 'ok') => void;
}) {
  const mark = useLapsed(dealId);
  const now = useNow();
  const undo = useMutation('deal_lapse_undo');
  const toast = useToast();
  if (!mark || ended) return null;
  const passed = mark.deadline !== null && now >= mark.deadline;
  if (passed) return <p className="dv-quiet lu-gone">{LAPSE_UNDO.gone}</p>;
  const run = async () => {
    const r = await undo.run({ deal_id: dealId });
    if (r !== null) return;
    clearLapsed(dealId);
    const said = LAPSE_UNDO.undone(title);
    if (onToast) onToast(said, 'ok');
    else toast(said, 'ok');
  };
  return (
    <div className="dv-quiet lu-undo">
      <div className="cs-acts">
        <span>{mark.deadline !== null ? LAPSE_UNDO.left(clockLabel(mark.deadline, now)) : LAPSE_UNDO.leftNoTime}</span>
        <Btn sm disabled={undo.pending} aria-label={LAPSE_UNDO.undoLabel(title)} title={LAPSE_UNDO.undoTitle} onClick={() => void run()}>
          {undo.pending ? LAPSE_UNDO.undoing : LAPSE_UNDO.undo}
        </Btn>
      </div>
      {undo.error ? <WalletNotice error={undo.error} what={LAPSE_UNDO.failed} /> : null}
    </div>
  );
}
