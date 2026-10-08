// "Replay a failed renewal" (approval window, privileged): PayPal can't make a sandbox renewal fail,
// so the owner records one, labelled REPLAY. Rust works out the one fix inside the signed fixes
// rule and opens it for review here; the invoice it leads to is real and never counted as
// recovered. Nothing here sends anything: approving the fix is its own held decision.
import { useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { WalletError } from '../../../lib/contract';
import { formatMoney, nowUnix } from '../../../lib/format';
import { RESCUE_NO_RULES, RESCUE_REPLAY_ABOUT, ruleSentence } from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { Btn, Field, Hint, Sheet } from '../../../shared/ui';
import { parseMoneyInput } from '../model';
import { useSession } from '../session';
import { buildReplay, rescueRules, type ReplayDraft } from './replay';

export function RescueReplay({ entries, locked, onClose, onReplayed }: {
  entries: readonly MandateListEntry[]; locked: boolean; onClose: () => void; onReplayed: (deal: Deal) => void;
}) {
  const s = useSession();
  const rules = rescueRules(entries, nowUnix());
  const currency = rules?.currency ?? 'USD';
  const [d, setD] = useState<ReplayDraft>({ subscription: '', email: '', plan: '', price: '' });
  const [error, setError] = useState<WalletError | null>(null);
  const built = buildReplay(d, currency, parseMoneyInput);
  const typed = Object.values(d).some((v) => v.trim());
  const busy = s.pending !== null || s.unlocking;
  const replay = async () => {
    if (!built.ok) return;
    setError(null);
    const r = await s.call('rescue_replay', built.args, true);
    if (r.ok) onReplayed(r.value);
    else setError(r.error);
  };
  const footer = (
    <>
      <Btn className="left" onClick={onClose}>Not now</Btn>
      {locked ? (
        <Btn kind="gold" locked disabled={!s.tokenReady || busy} onClick={() => void s.unlock()}>
          {s.unlocking ? 'Waiting for Windows Hello…' : 'Unlock with Windows Hello'}
        </Btn>
      ) : (
        <Btn kind="gold" disabled={!s.tokenReady || busy || !built.ok || !rules} onClick={() => void replay()}>
          {s.pending === 'rescue_replay' ? 'Recording…' : 'Replay this failure'}
        </Btn>
      )}
    </>
  );
  const field = (k: keyof ReplayDraft, label: string, placeholder: string, extra?: { mono?: boolean; unit?: string; mode?: 'decimal' | 'email' }) => (
    <label className="ow-lim-f">
      <span>{label}</span>
      <span className="ow-lim-in">
        <Field className={extra?.mono ? 'mono' : extra?.unit ? 'num' : undefined} inputMode={extra?.mode === 'decimal' ? 'decimal' : extra?.mode === 'email' ? 'email' : undefined}
          value={d[k]} placeholder={placeholder} spellCheck={false} autoComplete="off" onChange={(e) => setD({ ...d, [k]: e.target.value })} />
        {extra?.unit ? <span className="dim">{extra.unit}</span> : null}
      </span>
    </label>
  );
  return (
    <Sheet title="Replay a failed renewal" onClose={onClose} footer={footer} className="ow-lim-sheet ow-rr">
      <p className="ow-p">{RESCUE_REPLAY_ABOUT}</p>
      {rules ? (
        <>
          <div className="ow-lim-form">
            {field('subscription', 'PayPal subscription', 'I-BW452GLLEP1G', { mono: true })}
            {field('email', 'Subscriber’s email', 'name@example.com', { mode: 'email' })}
            {field('plan', 'Plan', 'care-plan', { mono: true })}
            {field('price', 'Renewal price', `12.00`, { unit: currency, mode: 'decimal' })}
          </div>
          <Hint>Your rules allow {ruleSentence(rules.lever)}. Your wallet works out the one fix; you approve it next, and nothing is sent before that.</Hint>
          {!built.ok && typed ? <Hint>{built.problems[0]}</Hint> : null}
        </>
      ) : <Hint>{RESCUE_NO_RULES} Open agent rules, add “Fixes for failed renewals” to a set for rescuing renewals, and sign it.</Hint>}
      {error ? <WalletNotice error={error} what="Not replayed" message={error.code === 'REFUSED' ? replayRefusal(error.message, rules ? formatMoney(rules.lever.max_discount) : null) : undefined} /> : null}
    </Sheet>
  );
}

/** A refusal of the replay, as one plain sentence (the clause numbers stay out of sight). */
export function replayRefusal(message: string, cap: string | null): string {
  if (/no discount/.test(message)) return `No discount your rules allow fits this renewal${cap ? ` (at most ${cap} off)` : ''}.`;
  if (/clause 3|per.deal|max_amount/.test(message)) return 'This renewal is above your limit per rescue.';
  if (/clause 5|day/.test(message)) return 'This would go over your daily limit for rescues.';
  return 'Your rules for rescuing renewals don’t allow this replay.';
}
