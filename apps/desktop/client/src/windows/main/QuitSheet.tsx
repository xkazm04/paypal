// The quit confirm as a sheet (prototype/tumbler NOTES: "the quit confirm is a sheet"). Quitting
// stops the wallet process: agents, PayPal checks and deadlines stop until The Table is opened
// again. Closing the window is different: the wallet keeps running in the tray. Every sentence
// is Rust's (quit_summary, worded from the walk-away forecast); quit_confirm binds what is shown,
// so a change in between is refused and the sheet reloads the current lines.
import { useState } from 'react';
import { useMutation, useQuery } from '../../lib/hooks';
import { WalletNotice } from '../../shared/honesty';
import { Btn, Sheet } from '../../shared/ui';
import { quitView } from './quit';
import './quit.css';

export function QuitSheet({ onClose }: { onClose: () => void }) {
  const summary = useQuery('quit_summary', null, { refreshOn: ['attention:changed', 'deal:changed'] });
  const confirm = useMutation('quit_confirm');
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
    <Sheet title="Quit The Table?" size="narrow" onClose={onClose} className="quit-sheet"
      footer={state === 'quitting' ? <span className="ui-hint left">The Table is closing. The wallet stops now.</span> : (
        <>
          <Btn onClick={onClose}>Keep it running</Btn>
          <Btn kind="danger" disabled={!s || confirm.pending} onClick={() => void quit()}>Quit The Table</Btn>
        </>
      )}>
      {view ? <p className="q-lead">{view.note}</p> : null}
      {summary.error && !s ? <WalletNotice error={summary.error} what="What happens when you quit" /> : null}
      {!s && !summary.error ? <p className="ui-hint">Checking your open deals…</p> : null}
      {state === 'changed' && confirm.error?.code === 'INVALID' ? <p className="q-changed" role="status">Something changed since this opened. Check the list again before you quit.</p>
        : confirm.error ? <WalletNotice error={confirm.error} what="Quit" /> : null}
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
                    <span className="q-id">{r.label}<b className="q-amt">{r.amount}</b></span>
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
