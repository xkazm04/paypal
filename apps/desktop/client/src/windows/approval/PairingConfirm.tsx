// Pairing confirmation (prototype/pages/pairing/variant-1 "Two desks", the approval-window side):
// both owners compare four words and each confirms in their OWN approval window.
// "Words match: pin key" calls pairing_confirm (privileged, idle-locked: pins the peer identity,
// payee and mailbox seed); "They differ: abort" calls pairing_abort, which is never locked (it only
// restricts) and ends this pairing in Rust: nothing is pinned and the words cannot be confirmed later.
//
// The words reach this window from Rust (approval_pairing), never from Main's page: Main calls
// approval_open({deal_id:null, pairing}) and the shell selects that pending pairing for this
// window. approval_pairing answers null when nothing is selected, or when the pairing expired or
// was already confirmed. display_context is a fixed Rust string (not peer prose).
import { useState } from 'react';
import type { KeyId } from '@bindings/KeyId';
import type { PendingPairing } from '@bindings/PendingPairing';
import type { WalletError } from '../../lib/contract';
import { clockLabel, shortId } from '../../lib/format';
import { useNow, useQuery } from '../../lib/hooks';
import { WalletNotice } from '../../shared/honesty';
import { AnswerBar, Btn, Chip, Hourglass, Kv, Popover, Sheet } from '../../shared/ui';
import { useSession } from './session';

/** Rust stores the label as ShortText<32>: at most 32 UTF-8 bytes, no control characters. */
export const NAME_MAX_BYTES = 32;
export function nameProblem(name: string): string | null {
  const t = name.trim();
  if (!t) return 'give them a name first';
  if (new TextEncoder().encode(t).length > NAME_MAX_BYTES) return 'that name is too long · shorten it';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(t)) return 'the name has a character that can’t be used';
  return null;
}

type Props = {
  /** undefined = still reading; null = no pending pairing selected for this window. */
  pending: PendingPairing | null | undefined;
  readError: WalletError | null;
  onSettled: () => void;
};

type Pinned = { key: KeyId; name: string; words: readonly string[]; house: boolean; at: number };

const POP = {
  how: ['How it works', 'Both wallets turn the code into the same four words. Read them to each other; each of you confirms in your own approval window. Connecting never touches PayPal and pays nobody.'],
  why: ['Why the words', 'If someone tried to sit between you, your two screens would show different words. Comparing them is how that gets caught: if even one word differs, stop, and nothing is connected.'],
  house: ['The house seller', 'A demo shop built into this app. The wallet already checks it is the real one; compare the words with its page all the same.'],
  lock: ['Why it’s locked', 'After 15 quiet minutes the wallet locks. Connecting a wallet asks for Windows Hello. Stopping never needs it.'],
  again: ['Why start again', 'Words that differ can mean someone is in the middle. Nothing was connected or saved, and this attempt is over. Start again in The Table, and share the new code another way (a call instead of chat).'],
} as const;
type PopKey = keyof typeof POP;

function Info({ k, open, setOpen }: { k: PopKey; open: { k: PopKey; el: HTMLElement } | null; setOpen: (v: { k: PopKey; el: HTMLElement } | null) => void }) {
  return (
    <Btn kind="plain" sm aria-label={POP[k][0]} aria-haspopup="dialog" onClick={(e) => { const el = e.currentTarget; setOpen(open?.k === k ? null : { k, el }); }}>
      ⓘ
    </Btn>
  );
}

function Words({ words }: { words: readonly string[] }) {
  return (
    <ol className="ow-words" aria-label="The four words">
      {words.map((w, i) => (
        <li key={i}>
          <small>{i + 1}</small>
          <span>{w}</span>
        </li>
      ))}
    </ol>
  );
}

export function PairingConfirm({ pending, readError, onSettled }: Props) {
  const s = useSession();
  const now = useNow();
  const [name, setName] = useState('');
  const [error, setError] = useState<WalletError | null>(null);
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const [rejected, setRejected] = useState(false);
  const [pop, setPop] = useState<{ k: PopKey; el: HTMLElement } | null>(null);
  const [detail, setDetail] = useState(false);
  const locked = s.settingsLocked || s.lockedByError;
  const unsupported = s.settings ? !s.settings.native_reauth_available : false;

  const popover = pop ? (
    <Popover anchor={pop.el} onClose={() => setPop(null)} title={POP[pop.k][0]} className="ow-pop">
      <p className="ow-p">{POP[pop.k][1]}</p>
    </Popover>
  ) : null;

  // A finished ceremony stays on screen even after approval_pairing turns null.
  if (pinned) {
    return (
      <div className="ow-pair done">
        <h2><span className="okc">✓</span> Connected · {pinned.name}</h2>
        <div className="ow-ctx">
          <span className="mono">{shortId(pinned.key, 6, 4)}</span>
          <span>· their wallet and payee are now verified{pinned.house ? ' · house seller' : ''}</span>
        </div>
        <p className="ui-hint">Nothing touched PayPal. Nobody was paid and no deal started.</p>
        <div className="ow-acts">
          <Btn onClick={() => setDetail(true)}>Details…</Btn>
        </div>
        {detail ? <PinnedSheet p={pinned} onClose={() => setDetail(false)} /> : null}
      </div>
    );
  }
  if (rejected) {
    return (
      <div className="ow-pair done" role="alert">
        <h2><span className="red">✕</span> Not connected</h2>
        <div className="ow-ctx">
          <span>Nothing was connected and this attempt is over. Start again in The Table with a new code.</span>
          <Info k="again" open={pop} setOpen={setPop} />
        </div>
        {popover}
      </div>
    );
  }

  if (readError) return <WalletNotice error={readError} what="Nothing to confirm" />;
  if (pending === undefined) return <p className="ui-hint">Looking for a waiting connection…</p>;
  if (pending === null) {
    return (
      <p className="ow-p">
        No connection is waiting for you. Connecting starts in The Table: one of you creates a code, the other joins it. The Table then brings you here with four words, and each of you confirms them <b>here</b>. An expired or finished one doesn’t come back.
      </p>
    );
  }

  const problem = nameProblem(name);
  const confirm = async () => {
    if (problem) return;
    setError(null);
    const display_name = name.trim();
    const r = await s.call('pairing_confirm', { pairing_id: pending.pairing_id, words: pending.words, display_name }, true);
    if (r.ok) {
      setPinned({ key: r.value, name: display_name, words: pending.words, house: pending.house, at: now });
      onSettled();
    } else {
      setError(r.error);
      if (r.error.code === 'INVALID' || r.error.code === 'NOT_FOUND') onSettled();
    }
  };

  const abort = async () => {
    setError(null);
    const r = await s.call('pairing_abort', { pairing_id: pending.pairing_id, code: null });
    if (r.ok) { setRejected(true); onSettled(); } else setError(r.error);
  };

  return (
    <div className="ow-pair">
      <div className="ow-ans">
        <AnswerBar
          tone="need"
          icon="link"
          title={pending.house ? 'Connect the house seller? Check four words on its page first.' : 'Someone wants to connect their wallet. Check four words with them first.'}
          sub="Connecting lets their offers reach your agents, within your rules. It pays nobody and never touches PayPal."
        />
      </div>
      <div className="ow-ctx">
        {pending.house ? <Chip tone="gold">House seller</Chip> : <Chip tone="coral">Another owner</Chip>}
        <b>{pending.display_context}</b>
        <span className="ui-hint">confirm by {clockLabel(pending.expires)}</span>
        <Info k={pending.house ? 'house' : 'how'} open={pop} setOpen={setPop} />
      </div>
      <h2>
        Do all four words match the other screen, in order? <Info k="why" open={pop} setOpen={setPop} />
      </h2>
      <Words words={pending.words} />
      <div className="ow-name">
        <label htmlFor="ow-pname">Name (only you see it)</label>
        <input
          id="ow-pname"
          className="ui-field"
          value={name}
          maxLength={NAME_MAX_BYTES}
          onChange={(e) => setName(e.target.value)}
          placeholder={pending.house ? 'House seller' : 'e.g. Dan · north-desk'}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={name.trim() !== '' && problem !== null}
          aria-describedby="ow-pname-e"
        />
        {pending.house && !name.trim() ? <Btn kind="plain" sm onClick={() => setName('House seller')}>Use “House seller”</Btn> : null}
      </div>
      <p id="ow-pname-e" className={`ui-hint ${name.trim() && problem ? 'red' : ''}`}>{name.trim() && problem ? problem : 'Saved on this computer only. They never see it.'}</p>
      <div className="ow-decide">
        {locked ? (
          <Btn kind="gold" locked disabled={!s.tokenReady || s.unlocking || unsupported} onClick={() => void s.unlock()}>
            {s.unlocking ? 'Waiting for Windows Hello…' : 'Unlock with Windows Hello'}
          </Btn>
        ) : (
          <Btn kind="gold" disabled={problem !== null || !s.tokenReady || s.pending !== null} title={problem ? 'Give them a name first' : undefined} onClick={() => void confirm()}>
            {s.pending === 'pairing_confirm' ? 'Connecting…' : 'All four match: connect'}
          </Btn>
        )}
        <Btn kind="danger" disabled={s.pending !== null} onClick={() => void abort()}>They don’t match: stop</Btn>
      </div>
      {locked ? (
        <p className="ui-hint gold">
          {unsupported ? 'Windows Hello isn’t set up on this computer, so connecting can’t unlock here. Stopping still works.' : 'Locked · connecting asks for Windows Hello; stopping doesn’t.'} <Info k="lock" open={pop} setOpen={setPop} />
        </p>
      ) : null}
      {s.unlockError ? <WalletNotice error={s.unlockError} what="Still locked" /> : null}
      {error ? <WalletNotice error={error} what="Not connected" /> : null}
      <p className="ui-silence">
        <Hourglass /><span className="if">If you do nothing: </span><b>it waits, then lapses</b> · nothing is connected, nobody is paid
      </p>
      {popover}
    </div>
  );
}

/** The after-pin detail (Layer 2). Facts this window has: the key, the words, the time, and what
 *  counterparty_list reports (first seen, deals, the declared payee). */
function PinnedSheet({ p, onClose }: { p: Pinned; onClose: () => void }) {
  const cps = useQuery('counterparty_list', null);
  const cp = cps.data?.find((c) => c.key_id === p.key);
  return (
    <Sheet title={`Connected · ${p.name}`} size="wide" onClose={onClose} footer={<Btn kind="primary" onClick={onClose}>Done</Btn>} className="ow-pinned">
      <Kv
        items={[
          ['Connected by', p.house ? 'the built-in check and the four words' : 'a code and the four words · the code can’t be used again'],
          ['Words', <span key="w"><b>{p.words.join(' · ')}</b> · {clockLabel(p.at)}</span>],
          ['First seen', cp ? clockLabel(cp.first_seen) : cps.error ? <span key="f" className="dim">not shown here</span> : <span key="f" className="dim">not yet</span>],
          ['Deals closed', cp ? String(cp.deals_closed) : '—'],
          ['Their payee', cp?.declared_payee ? <span key="p" className="mono">{cp.declared_payee}</span> : <span key="p" className="dim">not yet</span>],
          ['Wallet key', <span key="k" className="mono ow-fpr">{p.key}</span>],
        ]}
      />
      <div className="ow-means">
        <div>
          <h3>Connecting means</h3>
          <ul>
            <li>Offers signed by this wallet can reach your agents, within your rules.</li>
            <li>Payments go only to the payee they declared.</li>
          </ul>
        </div>
        <div>
          <h3>It does not</h3>
          <ul>
            <li>Pay anyone, start a deal or open PayPal.</li>
            <li>Raise any limit: your signed rules still set every number.</li>
          </ul>
        </div>
      </div>
    </Sheet>
  );
}
