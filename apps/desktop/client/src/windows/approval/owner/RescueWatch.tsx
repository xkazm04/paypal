// "Watch subscriptions" (approval window, privileged): the owner's own subscriptions the wallet
// checks with PayPal every few hours for a failed renewal. Checking only reads; a failure opens one
// fix inside the signed fixes rule, and that fix waits for the owner's own decision here. The
// subscriber's email is the owner's entry: PayPal's subscription details don't give it.
import { useState } from 'react';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { RescueWatchView } from '@bindings/RescueWatchView';
import type { WalletError } from '../../../lib/contract';
import { useNow } from '../../../lib/hooks';
import { RESCUE_NO_RULES, RESCUE_WATCH_ABOUT, RESCUE_WATCH_EMAIL, RESCUE_WATCH_STATE, watchingWords } from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { Btn, Chip, Field, Group, Hint, Row, Sheet } from '../../../shared/ui';
import { useSession } from '../session';
import { rescueRules } from './replay';
import { buildWatch, nextCheckWords, type WatchDraft } from './watch';

export function RescueWatch({ entries, watching, locked, onClose, onChanged }: {
  entries: readonly MandateListEntry[]; watching: readonly RescueWatchView[]; locked: boolean; onClose: () => void; onChanged: () => void;
}) {
  const s = useSession();
  const now = useNow();
  const rules = rescueRules(entries, now);
  const [list, setList] = useState<readonly RescueWatchView[]>(watching);
  const [d, setD] = useState<WatchDraft>({ subscription: '', email: '', plan: '' });
  const [error, setError] = useState<WalletError | null>(null);
  const built = buildWatch(d, list);
  const typed = Object.values(d).some((v) => v.trim());
  const busy = s.pending !== null || s.unlocking;
  const add = async () => {
    if (!built.ok) return;
    setError(null);
    const r = await s.call('rescue_watch_add', built.args, true);
    if (r.ok) {
      setList(r.value);
      setD({ subscription: '', email: '', plan: '' });
      onChanged();
    } else setError(r.error);
  };
  const stop = async (subscription_id: string) => {
    setError(null);
    const r = await s.call('rescue_watch_stop', { subscription_id }, true);
    if (r.ok) {
      setList(r.value);
      onChanged();
    } else setError(r.error);
  };
  const footer = (
    <>
      <Btn className="left" onClick={onClose}>Done</Btn>
      {locked ? (
        <Btn kind="gold" locked disabled={!s.tokenReady || busy} onClick={() => void s.unlock()}>
          {s.unlocking ? 'Waiting for Windows Hello…' : 'Unlock with Windows Hello'}
        </Btn>
      ) : (
        <Btn kind="gold" disabled={!s.tokenReady || busy || !built.ok || !rules} onClick={() => void add()}>
          {s.pending === 'rescue_watch_add' ? 'Saving…' : 'Watch this subscription'}
        </Btn>
      )}
    </>
  );
  const field = (k: keyof WatchDraft, label: string, placeholder: string, extra?: { mono?: boolean; email?: boolean }) => (
    <label className="ow-lim-f">
      <span>{label}</span>
      <span className="ow-lim-in">
        <Field className={extra?.mono ? 'mono' : undefined} inputMode={extra?.email ? 'email' : undefined}
          value={d[k]} placeholder={placeholder} spellCheck={false} autoComplete="off" onChange={(e) => setD({ ...d, [k]: e.target.value })} />
      </span>
    </label>
  );
  return (
    <Sheet title="Watch subscriptions" onClose={onClose} footer={footer} className="ow-lim-sheet ow-rr ow-rw">
      <p className="ow-p">{RESCUE_WATCH_ABOUT}</p>
      <Group label={watchingWords(list.length)} empty={watchingWords(0)}>
        {list.map((w) => {
          const st = RESCUE_WATCH_STATE[w.state];
          return (
            <Row key={w.subscription_id} title={<><span className="mono">{w.subscription_id}</span> · {w.plan}</>}
              sub={`${w.recipient} · ${nextCheckWords(w, now)}`}>
              <Chip tone={st.tone} title={st.means}>{st.text}</Chip>
              <Btn sm disabled={locked || busy} onClick={() => void stop(w.subscription_id)}>
                {s.pending === 'rescue_watch_stop' ? 'Stopping…' : 'Stop watching'}
              </Btn>
            </Row>
          );
        })}
      </Group>
      {rules ? (
        <>
          <div className="ow-lim-form">
            {field('subscription', 'PayPal subscription', 'I-BW452GLLEP1G', { mono: true })}
            {field('email', 'Subscriber’s email', 'name@example.com', { email: true })}
            {field('plan', 'Plan', 'care-plan', { mono: true })}
          </div>
          <Hint>{RESCUE_WATCH_EMAIL} Watching sends nothing; a fix still waits for you to approve it.</Hint>
          {!built.ok && typed ? <Hint>{built.problems[0]}</Hint> : null}
        </>
      ) : <Hint>{RESCUE_NO_RULES} Open agent rules, add “Fixes for failed renewals” to a set for rescuing renewals, and sign it.</Hint>}
      {error ? <WalletNotice error={error} what="Not saved" /> : null}
    </Sheet>
  );
}
