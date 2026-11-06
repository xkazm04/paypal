// spark abstract-first-home round 4 (prototype): the bare pairing confirm, the four words and Confirm.
// The words come from Rust for the pairing selected for this window (approval_pairing; the mock
// selects it from `pairing=` as approval_open writes it), never from the host page. The calls are
// PairingConfirm's exactly: pairing_confirm (privileged, idle-locked: pins the peer) and
// pairing_abort (never locked: it only stops), with PairingConfirm's own name rule (nameProblem).
import { useId, useState } from 'react';
import type { WalletError } from '../../../lib/contract';
import { useQuery } from '../../../lib/hooks';
import { WalletNotice } from '../../../shared/honesty';
import { Btn } from '../../../shared/ui';
import { footerNoticeText } from '../model';
import { nameProblem } from '../PairingConfirm';
import { useSession } from '../session';
import { postToHost } from './protocol';
import { BareDone, Gate } from './parts';
import { BARE_PAIRING as W } from './words';
import '../owner.css';

export function BarePairing() {
  const s = useSession();
  const uid = useId();
  const pairing = useQuery('approval_pairing', null, { refreshOn: ['settings:changed'] });
  const p = pairing.data;
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<WalletError | null>(null);
  const [result, setResult] = useState<{ ok: true; name: string } | { ok: false } | null>(null);

  if (result?.ok) return <BareDone title={W.connected(result.name)} sub={W.connectedSub} note={W.what} />;
  if (result) return <BareDone title={W.stopped} sub={W.stoppedSub} />;
  if (pairing.error) return <section className="sc-form"><WalletNotice error={pairing.error} what={W.notConnected} message={footerNoticeText('pairing_read', pairing.error)} /></section>;
  if (pairing.loading && p === undefined) return <section className="sc-form" aria-busy="true"><p className="sc-dim" role="status">{W.reading}</p></section>;
  if (!p) return <section className="sc-form"><p>{W.none}</p></section>;

  const shown = name ?? (p.house ? W.useHouse : '');
  const problem = nameProblem(shown);
  const confirm = async () => {
    if (problem) return;
    setError(null);
    const display_name = shown.trim();
    const r = await s.call('pairing_confirm', { pairing_id: p.pairing_id, words: p.words, display_name }, true);
    if (r.ok) {
      setResult({ ok: true, name: display_name });
      postToHost({ type: 'secure-done', kind: 'pairing' });
    } else setError(r.error);
    void pairing.refetch();
  };
  const stop = async () => {
    setError(null);
    const r = await s.call('pairing_abort', { pairing_id: p.pairing_id, code: null });
    if (r.ok) setResult({ ok: false }); else setError(r.error);
    void pairing.refetch();
  };

  return (
    <section className="sc-form sc-pairing" aria-labelledby={`${uid}-h`}>
      <header className="sc-head">
        <h1 id={`${uid}-h`}>{W.title}</h1>
        <p>{p.house ? W.house : W.other}</p>
      </header>
      <ol className="ow-words sc-words" aria-label="The four words">
        {p.words.map((w, i) => <li key={i}><small>{i + 1}</small><span>{w}</span></li>)}
      </ol>
      <label className="sc-field sc-field-row">
        <span>{W.name}</span>
        <input id={`${uid}-n`} className="ui-field sc-in" value={shown} autoComplete="off" spellCheck={false}
          onChange={(e) => setName(e.target.value)} aria-invalid={!!shown.trim() && problem !== null} />
      </label>
      {shown.trim() && problem ? <p className="sc-err">{problem}</p> : null}
      <div className="sc-acts">
        <Gate>
          <Btn kind="gold" disabled={problem !== null || !s.tokenReady || s.pending !== null} onClick={() => void confirm()}>
            {s.pending === 'pairing_confirm' ? W.confirming : W.confirm}
          </Btn>
        </Gate>
        <Btn kind="danger" disabled={s.pending !== null} onClick={() => void stop()}>{W.stop}</Btn>
      </div>
      <p className="sc-kept sc-dim">{W.what}</p>
      {error ? <WalletNotice error={error} what={W.notConnected} message={footerNoticeText('pairing', error)} /> : null}
    </section>
  );
}
