// "Wallet limits" in the owner configuration (T14): one cap above every set of rules, signed with
// the owner key like rules are (envelope_sign, privileged). Layer 1 is three rows with today's
// meters; the change sheet holds the three numbers and the one gold button.
import { useState } from 'react';
import type { Currency } from '@bindings/Currency';
import type { ExposureView } from '@bindings/ExposureView';
import type { WalletError } from '../../../lib/contract';
import { formatMinor, nowUnix } from '../../../lib/format';
import { buildLimits, readLimits, type LimitsDraft } from '../../../lib/limits';
import { LIMIT_WORDS, NO_WALLET_LIMIT, WALLET_LIMITS_ABOUT } from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { Btn, Chip, Field, Group, Hint, Meter, Row, Section, Sheet } from '../../../shared/ui';
import { minorToInput, parseMoneyInput } from '../model';
import { useSession } from '../session';

const LASTS = [7, 30, 90] as const;

/** A REFUSED from envelope_sign, as one plain sentence. */
export function limitRefusalWords(message: string): string {
  if (/zero/.test(message)) return 'A limit of zero would stop every payment. Enter amounts above zero.';
  if (/currency/.test(message)) return 'All three limits must be in one currency.';
  if (/run out|expir/.test(message)) return 'Choose how long the limits last, from today.';
  return 'These limits can’t be signed as they are.';
}

export function WalletLimits({ view, error, loading, currency, locked, onSigned }: {
  view: ExposureView | undefined; error: WalletError | null; loading: boolean;
  /** The currency new limits use when none are signed yet (the agents' rules' currency). */
  currency: Currency; locked: boolean; onSigned: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const reading = readLimits(view);
  const limits = view?.status === 'active' || view?.status === 'expired' ? view.limits ?? null : null;
  const chip = !view ? <Chip tone="dashed">unknown</Chip>
    : view.status === 'active' ? <Chip tone="ok">in force</Chip>
      : view.status === 'none' ? <Chip tone="line">none</Chip>
        : <Chip tone="gold">sign again</Chip>;
  const money = (m: { minor: number; currency: Currency }) => formatMinor(m.minor, m.currency);
  const rows = limits ? [
    { k: 'out' as const, limit: `${money(limits.max_out_day)} ${LIMIT_WORDS.out.per}` },
    { k: 'held' as const, limit: `${money(limits.max_held)} ${LIMIT_WORDS.held.per}` },
    { k: 'deals' as const, limit: `${limits.max_deals_day} ${LIMIT_WORDS.deals.per}` },
  ] : [];
  return (
    <Section title="Wallet limits" end={<>{chip}<Btn sm onClick={() => setEditing(true)}>{limits ? 'Change…' : 'Set limits…'}</Btn></>}>
      {error ? <WalletNotice error={error} what="Wallet limits" /> : null}
      <Group empty={loading && !view ? 'Reading your wallet limits…' : `${NO_WALLET_LIMIT}. Only each set of rules limits your agents.`}>
        {view && view.status !== 'active' && view.status !== 'none' ? (
          <Row title={view.status === 'expired' ? 'Your wallet limits ran out' : 'Your wallet limits couldn’t be checked'} sub="Your agents can’t pay anyone until you set them again." need>
            <Chip tone="gold">needs you</Chip>
          </Row>
        ) : null}
        {limits && view?.status === 'active' ? rows.map(({ k, limit }) => {
          const m = reading?.meters.find((x) => x.key === k);
          return (
            <Row key={k} title={LIMIT_WORDS[k].name} sub={m ? `${m.label}: ${m.value}` : 'nothing yet today'} className="ow-lim">
              <span className="ow-lim-m" title={m?.why}>
                <span className="amt">{limit}</span>
                <Meter value={m?.fill ?? 0} tone={m?.near ? 'gold' : undefined} label={`${LIMIT_WORDS[k].short} against ${limit}`} />
              </span>
            </Row>
          );
        }) : null}
      </Group>
      <Hint>{WALLET_LIMITS_ABOUT}</Hint>
      {editing ? <LimitsSheet view={view} currency={limits?.currency ?? currency} locked={locked} onClose={() => setEditing(false)} onSigned={() => { setEditing(false); onSigned(); }} /> : null}
    </Section>
  );
}

function LimitsSheet({ view, currency, locked, onClose, onSigned }: {
  view: ExposureView | undefined; currency: Currency; locked: boolean; onClose: () => void; onSigned: () => void;
}) {
  const s = useSession();
  const now = nowUnix();
  const was = view?.limits ?? null;
  const [d, setD] = useState<LimitsDraft>({
    out: was ? minorToInput(was.max_out_day.minor, currency) : '',
    held: was ? minorToInput(was.max_held.minor, currency) : '',
    deals: was ? String(was.max_deals_day) : '',
    days: 30,
  });
  const [error, setError] = useState<WalletError | null>(null);
  const built = buildLimits(d, currency, now, parseMoneyInput);
  const busy = s.pending !== null || s.unlocking;
  const sign = async () => {
    if (!built.ok) return;
    setError(null);
    const r = await s.call('envelope_sign', built.args, true);
    if (r.ok) onSigned();
    else setError(r.error);
  };
  const footer = (
    <>
      <Btn className="left" onClick={onClose}>Keep as is</Btn>
      {locked ? (
        <Btn kind="gold" locked disabled={!s.tokenReady || busy} onClick={() => void s.unlock()}>
          {s.unlocking ? 'Waiting for Windows Hello…' : 'Unlock with Windows Hello'}
        </Btn>
      ) : (
        <Btn kind="gold" disabled={!s.tokenReady || busy || !built.ok} onClick={() => void sign()}>
          {s.pending === 'envelope_sign' ? 'Signing…' : 'Sign with your owner key'}
        </Btn>
      )}
    </>
  );
  const field = (k: 'out' | 'held' | 'deals', unit: string) => (
    <label className="ow-lim-f">
      <span>{LIMIT_WORDS[k].name}</span>
      <span className="ow-lim-in">
        <Field inputMode={k === 'deals' ? 'numeric' : 'decimal'} className="num" value={d[k]} placeholder={k === 'deals' ? '8' : '600.00'}
          onChange={(e) => setD({ ...d, [k]: e.target.value })} />
        <span className="dim">{unit}</span>
      </span>
    </label>
  );
  return (
    <Sheet title={was ? 'Change your wallet limits' : 'Set your wallet limits'} onClose={onClose} footer={footer} className="ow-lim-sheet">
      <p className="ow-p">{WALLET_LIMITS_ABOUT}</p>
      <div className="ow-lim-form">
        {field('out', `${currency} ${LIMIT_WORDS.out.per}`)}
        {field('held', `${currency} ${LIMIT_WORDS.held.per}`)}
        {field('deals', `deals ${LIMIT_WORDS.deals.per}`)}
        <label className="ow-lim-f">
          <span>How long they last</span>
          <span className="ow-lim-in">
            {LASTS.map((n) => (
              <Btn key={n} sm kind={d.days === n ? 'default' : 'plain'} aria-pressed={d.days === n} onClick={() => setD({ ...d, days: n })}>{n} days</Btn>
            ))}
          </span>
        </label>
      </div>
      {!built.ok && (d.out || d.held || d.deals) ? <Hint>{built.problems[0]}</Hint> : null}
      <Hint>When they run out, your agents can’t pay anyone until you set them again. Nothing here pays anyone.</Hint>
      {error ? <WalletNotice error={error} what="Wallet limits not signed" message={error.code === 'REFUSED' ? limitRefusalWords(error.message) : undefined} /> : null}
    </Sheet>
  );
}
