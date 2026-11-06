// spark abstract-first-home round 4 (prototype): the bare keys form, the secure step's first and best
// moment. What it can honestly be depends on where it runs:
//   desktop app  the keys never pass through a page. set_credentials opens the Windows credential
//                dialog (table-os credential_prompt.rs: Client ID in User name, Secret in Password)
//                and stores them itself; the command carries only WHICH key. So the form is the way
//                into that dialog: what goes where, and one button.
//   preview      (a browser on the mock world, or the desktop app's demo mode) there is no Windows
//                dialog. The form stands in for it: Client ID and Secret fields, checked for shape,
//                then thrown away; the same set_credentials call (it takes no secret in the mock
//                either) records the keys as saved. Labelled so.
// Either way the call is the approval window's privileged set_credentials through the session
// (label + token + unlocked); nothing here is a new path to the wallet.
import { useId, useRef, useState, type ClipboardEvent } from 'react';
import type { WalletError } from '../../../lib/contract';
import { inDesktopApp } from '../../../lib/preview';
import { backend } from '../../../lib/runtime';
import { WalletNotice } from '../../../shared/honesty';
import { Btn } from '../../../shared/ui';
import { useSession } from '../session';
import { cleanKey, keyProblem, keysReady, pairProblem, splitPair } from './keyShape';
import { BareDone, Gate } from './parts';
import { postToHost } from './protocol';
import { BARE_KEYS as W } from './words';

/** The keys go through the Windows dialog, not this page (the desktop app, live wallet). */
export function keysViaDialog(): boolean {
  if (!inDesktopApp()) return false;
  try { return backend().kind === 'tauri'; } catch { return true; }
}

export function BareKeys() {
  const s = useSession();
  const [saved, setSaved] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<WalletError | null>(null);
  const [dialog] = useState(keysViaDialog);
  const stored = !!s.settings?.payment_executor_configured;

  const save = async (): Promise<boolean> => {
    setError(null);
    const r = await s.call('set_credentials', 'paypal_sandbox', true);
    await s.refreshSettings();
    if (!r.ok) { setError(r.error); return false; }
    setSaved(true);
    setReplacing(false);
    postToHost({ type: 'secure-done', kind: 'keys' });
    return true;
  };

  if ((saved || stored) && !replacing) {
    return (
      <BareDone title={W.saved} sub={W.savedSub} note={W.kept}
        action={<Btn kind="plain" sm onClick={() => { setSaved(false); setReplacing(true); }}>{W.replace}</Btn>} />
    );
  }

  return (
    <section className="sc-form sc-keys" aria-labelledby="sc-keys-h">
      <header className="sc-head">
        <h1 id="sc-keys-h">{W.title}</h1>
        <p>{W.what}</p>
        <p className="sc-get">
          <a href={W.getHref} target="_blank" rel="noopener noreferrer">{W.get} <span aria-hidden="true">↗</span></a>
          <span className="sc-dim"> · {W.getWhere}</span>
        </p>
      </header>
      {dialog ? <DialogWay busy={s.pending === 'set_credentials'} onOpen={() => void save()} /> : <StandIn busy={s.pending === 'set_credentials'} onSave={save} />}
      {error ? <WalletNotice error={error} what={W.notSaved} /> : null}
    </section>
  );
}

/** The desktop app: the one button into the Windows dialog, and what goes where in it. */
function DialogWay({ busy, onOpen }: { busy: boolean; onOpen: () => void }) {
  return (
    <>
      <div className="sc-dialog">
        <p>{W.dialogLead}</p>
        <ol>
          <li>{W.dialogId}</li>
          <li>{W.dialogSecret}</li>
        </ol>
      </div>
      <Gate>
        <div className="sc-acts">
          <Btn kind="gold" disabled={busy} onClick={onOpen}>{busy ? W.dialogWaiting : W.dialogOpen}</Btn>
        </div>
      </Gate>
      <p className="sc-kept"><Lock />{W.kept}</p>
    </>
  );
}

/** The preview: the stand-in for the Windows dialog. The values live only in this component's state,
 *  are never sent anywhere and are cleared on save. */
function StandIn({ busy, onSave }: { busy: boolean; onSave: () => Promise<boolean> }) {
  const uid = useId();
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState<{ id: boolean; secret: boolean }>({ id: false, secret: false });
  const secretRef = useRef<HTMLInputElement>(null);
  const idErr = touched.id ? keyProblem(id) : null;
  const secretErr = touched.secret ? keyProblem(secret) : null;
  const pairErr = touched.id && touched.secret ? pairProblem(id, secret) : null;
  const ready = keysReady(id, secret);

  const pasteBoth = (e: ClipboardEvent<HTMLInputElement>) => {
    const pair = splitPair(e.clipboardData.getData('text'));
    if (!pair) return;
    e.preventDefault();
    setId(pair.id);
    setSecret(pair.secret);
    setTouched({ id: true, secret: true });
  };
  const submit = async () => {
    if (!ready) { setTouched({ id: true, secret: true }); return; }
    if (await onSave()) { setId(''); setSecret(''); }
  };

  return (
    <form className="sc-fields" onSubmit={(e) => { e.preventDefault(); void submit(); }} autoComplete="off">
      <div className="sc-field">
        <label htmlFor={`${uid}-id`}>{W.id}</label>
        <input id={`${uid}-id`} className="ui-field sc-in" value={id} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          onChange={(e) => setId(e.target.value)} onBlur={() => { setId(cleanKey(id)); setTouched((t) => ({ ...t, id: true })); }}
          onPaste={pasteBoth} aria-invalid={!!idErr} aria-describedby={`${uid}-id-h`} placeholder="AY…" />
        <small id={`${uid}-id-h`} className={idErr ? 'sc-err' : 'sc-dim'}>{idErr ? `${W.id} ${idErr}` : W.idHint}</small>
      </div>
      <div className="sc-field">
        <label htmlFor={`${uid}-secret`}>{W.secret}</label>
        <span className="sc-secret">
          <input ref={secretRef} id={`${uid}-secret`} className="ui-field sc-in" type={show ? 'text' : 'password'} value={secret} spellCheck={false}
            autoCapitalize="off" autoCorrect="off" autoComplete="new-password"
            onChange={(e) => setSecret(e.target.value)} onBlur={() => { setSecret(cleanKey(secret)); setTouched((t) => ({ ...t, secret: true })); }}
            onPaste={pasteBoth} aria-invalid={!!secretErr || !!pairErr} aria-describedby={`${uid}-secret-h`} placeholder="EL…" />
          <Btn kind="plain" sm aria-label={show ? W.hideLabel : W.showLabel} aria-pressed={show} onClick={() => { setShow((x) => !x); secretRef.current?.focus(); }}>{show ? W.hide : W.show}</Btn>
        </span>
        <small id={`${uid}-secret-h`} className={secretErr || pairErr ? 'sc-err' : 'sc-dim'}>{secretErr ? `${W.secret} ${secretErr}` : pairErr ?? W.secretHint}</small>
      </div>
      <Gate>
        <div className="sc-acts">
          <Btn kind="gold" type="submit" disabled={!ready || busy}>{busy ? W.saving : W.save}</Btn>
          <span className="sc-dim sc-tip">{W.pasteBoth}</span>
        </div>
      </Gate>
      <p className="sc-kept"><Lock />{W.kept}</p>
      <p className="sc-preview" role="note">{W.preview}</p>
    </form>
  );
}

function Lock() {
  return (
    <svg className="sc-lock" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
