// The owner's key, whole and in groups of four (Layer 2: Settings › Detailed › Your keys, the
// approval window's Details, the Book's "Check a proof file"). A proof file names the owner key
// whose signatures it carries; the person checking one compares that key with the owner's own, so
// the owner must be able to see and send theirs. The id is public: the private key never leaves
// the computer's secure store.
import { useState } from 'react';
import type { WalletError } from '../lib/contract';
import { keyGroups } from '../lib/format';
import { OWNER_KEY } from '../lib/words';
import { WalletNotice } from './honesty';
import { Btn, Chip } from './ui';
import './ownerKey.css';

/** A key id in groups of four, every character kept. `cols` groups per line (4 or 8). */
export function KeyId({ id, cols = 8 }: { id: string; cols?: 4 | 8 }) {
  return (
    <span className={`key-id mono c${cols}`}>
      {keyGroups(id).map((g, i) => <span key={i}>{g}</span>)}
    </span>
  );
}

/** "Your owner key": the grouped id, a Copy button and what it is for. `heading={false}` when the
 *  surrounding row already names it. */
export function OwnerKey({ id, error, cols = 8, heading = true }: { id: string | null | undefined; error?: WalletError | null; cols?: 4 | 8; heading?: boolean }) {
  const [copy, setCopy] = useState<'ok' | 'no' | null>(null);
  const run = async () => {
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopy('ok');
    } catch {
      setCopy('no');
    }
  };
  const copyBtn = () => <Btn sm onClick={() => void run()} aria-label={`Copy ${OWNER_KEY.label.toLowerCase()}`}>{copy === 'ok' ? 'Copied' : 'Copy'}</Btn>;
  return (
    <div className="owner-key">
      {heading ? <div className="ok-head"><b>{OWNER_KEY.label}</b>{id ? copyBtn() : null}</div> : null}
      {id ? (heading ? <KeyId id={id} cols={cols} /> : <div className="ok-head"><KeyId id={id} cols={cols} />{copyBtn()}</div>)
        : error ? <WalletNotice error={error} what={OWNER_KEY.label} /> : <Chip tone="dashed">not loaded yet</Chip>}
      <p className="ui-hint" aria-live="polite">{copy === 'ok' ? OWNER_KEY.copied : copy === 'no' ? OWNER_KEY.noCopy : OWNER_KEY.why}</p>
    </div>
  );
}
