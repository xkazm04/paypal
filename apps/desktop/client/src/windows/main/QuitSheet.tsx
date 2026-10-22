// The quit confirm as a sheet (prototype/tumbler NOTES: "the quit confirm is a sheet"). Quitting
// stops the wallet process: agents, PayPal checks and deadlines stop until The Table is opened
// again. Closing the window is different: the wallet keeps running in the tray. Every sentence
// is Rust's (quit_summary, worded from the walk-away forecast); quit_confirm binds what is shown,
// so a change in between is refused and the sheet reloads the current lines.
import { BOUNDARY_RETRY, NOTICE_WHAT, QUIT_SHEET } from '../../lib/words';
import { useState } from 'react';
import { useMutation, useQuery } from '../../lib/hooks';
import { WalletNotice } from '../../shared/honesty';
import { Btn, Sheet } from '../../shared/ui';
import { shortTitle } from './home/model';
import { quitView } from './quit';
import { useWorldSelector, type World } from './world';
import './quit.css';

const selNames = (w: World) => ({ dealById: w.dealById, display: w.display });
const sameNames = (a: ReturnType<typeof selNames>, b: ReturnType<typeof selNames>) => a.dealById === b.dealById && a.display === b.display;

export function QuitSheet({ onClose }: { onClose: () => void }) {
  const summary = useQuery('quit_summary', null, { refreshOn: ['attention:changed', 'deal:changed'] });
  const confirm = useMutation('quit_confirm');
  const { dealById, display } = useWorldSelector(selNames, sameNames);
  // each line names its deal by title (UX-GUIDE: ids live in Details); the label only when no title is known
  const nameOf = (id: string, label: string) => { const d = dealById.get(id); return d ? shortTitle(display(d).title) : label; };
  const [state, setState] = useState<'ask' | 'changed' | 'quitting'>('ask');
  const s = summary.data;
  const view = s ? quitView(s) : null;

  const quit = async () => {
    if (!s) return;
    const r = await confirm.run({ confirmation_id: s.confirmation_id });
    if (r === undefined) {
      // What was shown changed (or the wallet refused): show the current lines before asking again.
      setState('changed');
      void summary.refetch();
      return;
    }
    setState('quitting');
  };

  return (
    <Sheet title={QUIT_SHEET.title} size="narrow" onClose={onClose} className="quit-sheet"
      footer={state === 'quitting' ? <span className="ui-hint left">The Table is closing. The wallet stops now.</span> : (
        <>
          <Btn onClick={onClose}>{QUIT_SHEET.keep}</Btn>
          <Btn kind="danger" disabled={!s || confirm.pending} onClick={() => void quit()}>Quit The Table</Btn>
        </>
      )}>
      {view ? <p className="q-lead">{view.note}</p> : null}
      {summary.error && !s ? (
        // Quit needs the forecast it confirms (quit_confirm binds it): without it, read it again.
        <>
          <WalletNotice error={summary.error} what={NOTICE_WHAT.quitSummary} />
          <p><Btn sm onClick={() => void summary.refetch()}>{BOUNDARY_RETRY}</Btn></p>
        </>
      ) : null}
      {!s && !summary.error ? <p className="ui-hint" role="status">Checking your open deals…</p> : null}
      {state === 'changed' && confirm.error?.code === 'INVALID' ? <p className="q-changed" role="status">Something changed since this opened. Check the list again before you quit.</p>
        : confirm.error ? <WalletNotice error={confirm.error} what={NOTICE_WHAT.quit} /> : null}
      {view ? (
        <>
          <p className="q-count">{view.lead}</p>
          {view.unknown ? <p className="q-unknown">What each deal does while The Table is off couldn’t be checked just now.</p> : null}
          {view.sections.map((sec) => (
            <section key={sec.key} className={`ui-section q-sec q-${sec.key}`}>
              <div className="ui-section-h"><h3>{sec.title}</h3></div>
              <ul className="q-rows">
                {sec.rows.map((r) => (
                  <li key={r.key}>
                    <span className="q-id"><span className="q-name">{nameOf(r.dealId, r.label)}</span><b className="q-amt">{r.amount}</b></span>
                    <span className="q-text">{r.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      ) : null}
    </Sheet>
  );
}
