// "Wallet limits" in the owner configuration (T14): one cap above every set of rules, signed with
// the owner key like rules are (envelope_sign, privileged). Layer 1 is three rows with today's
// meters; the change sheet holds the three numbers, what they would have done to this week's
// purchases (envelope_simulate: Rust's own check, read-only), and the one gold button.
import { useEffect, useRef, useState } from 'react';
import type { Currency } from '@bindings/Currency';
import type { EnvelopeSignArgs } from '@bindings/EnvelopeSignArgs';
import type { ExposureView } from '@bindings/ExposureView';
import type { MandateSimulation } from '@bindings/MandateSimulation';
import type { SimulatedLine } from '@bindings/SimulatedLine';
import type { SimulatedVerdict } from '@bindings/SimulatedVerdict';
import { toWalletError, type WalletError } from '../../../lib/contract';
import { clockLabel, formatMinor, formatMoney, nowUnix } from '../../../lib/format';
import { backend } from '../../../lib/runtime';
import { buildLimits, readLimits, type LimitsDraft } from '../../../lib/limits';
import { LIMIT_WORDS, NO_WALLET_LIMIT, WALLET_LIMITS_ABOUT } from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { Btn, Chip, Field, Group, Hint, Meter, Row, Section, Sheet } from '../../../shared/ui';
import { minorToInput, parseMoneyInput } from '../model';
import { useSession } from '../session';
import { SIMULATE_DEBOUNCE_MS } from './data';
import { changed } from './simulation';

const LASTS = [7, 30, 90] as const;

/** A REFUSED from envelope_sign, as one plain sentence. */
export function limitRefusalWords(message: string): string {
  if (/zero/.test(message)) return 'A limit of zero would stop every payment. Enter amounts above zero.';
  if (/currency/.test(message)) return 'All three limits must be in one currency.';
  if (/run out|expir/.test(message)) return 'Choose how long the limits last, from today.';
  return 'These limits can’t be signed as they are.';
}

/** Which limit stops a purchase, in words (Rust names it first: "max_deals_day: …"). */
const STOPPED_BY: ReadonlyArray<[RegExp, string]> = [
  [/^max_out_day/, LIMIT_WORDS.out.name],
  [/^max_held/, LIMIT_WORDS.held.name],
  [/^max_deals_day/, LIMIT_WORDS.deals.name],
  [/^currency/, 'Another currency'],
  [/^expires/, 'Limits ran out'],
  [/^signature/, 'Limits couldn’t be checked'],
];
export function stoppedBy(v: SimulatedVerdict): string | null {
  if (v.type !== 'refuse') return null;
  return STOPPED_BY.find(([re]) => re.test(v.reason))?.[1] ?? 'Your wallet limits';
}

/** The one line above Sign: "These limits would have stopped 2 of 9 purchases this week." */
export function limitsWhatIfWords(lines: readonly SimulatedLine[]): string {
  if (!lines.length) return 'No purchases this week to try these limits on.';
  const n = lines.length;
  const stopped = lines.filter((l) => l.after.type === 'refuse').length;
  const freed = lines.filter((l) => l.before.type === 'refuse' && l.after.type !== 'refuse').length;
  const of = `${n} ${n === 1 ? 'purchase' : 'purchases'} this week`;
  const head = `These limits would have stopped ${stopped ? `${stopped} of ${of}` : `none of the ${of}`}.`;
  return freed ? `${head} ${freed === 1 ? '1 purchase' : `${freed} purchases`} your limits now stop would go through.` : head;
}

/** The wallet's own replay of draft limits over this week's purchases, asked once the draft has
 *  been still for a moment; the last answer stays on screen (marked as updating) until the next. */
function useLimitsWhatIf(args: EnvelopeSignArgs | null) {
  // The expiry moves with the clock on every render; it never changes this week's answer.
  const key = args ? JSON.stringify({ ...args, expires: 0 }) : null;
  const latest = useRef(args);
  latest.current = args;
  const [answer, setAnswer] = useState<{ key: string | null; sim: MandateSimulation | null; error: WalletError | null }>({ key: null, sim: null, error: null });
  useEffect(() => {
    if (key === null) return;
    let live = true;
    const timer = setTimeout(() => {
      const draft = latest.current;
      if (!draft) return;
      backend().invoke('envelope_simulate', { draft }).then(
        (sim) => live && setAnswer({ key, sim, error: null }),
        (e: unknown) => live && setAnswer((a) => ({ key, sim: a.sim, error: toWalletError(e) })),
      );
    }, SIMULATE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  return { sim: answer.sim, error: answer.error, updating: key !== null && answer.key !== key };
}

function Outcome({ v }: { v: SimulatedVerdict }) {
  const by = stoppedBy(v);
  return by ? (
    <span className="ow-vd" title={by}><Chip tone="coral">stopped</Chip><span className="why">{by}</span></span>
  ) : <span className="ow-vd"><Chip tone="teal">goes through</Chip></span>;
}

/** What the draft limits would have done this week: one sentence, then only the purchases whose
 *  answer changes (when, which, how much, now → with these limits). */
function LimitsWhatIf({ args }: { args: EnvelopeSignArgs | null }) {
  const { sim, error, updating } = useLimitsWhatIf(args);
  if (!args) return null;
  if (error) return <WalletNotice error={error} what="This week’s purchases couldn’t be tried" message={error.code === 'REFUSED' ? limitRefusalWords(error.message) : undefined} />;
  if (!sim) return updating ? <Hint>Trying these limits on this week’s purchases…</Hint> : null;
  const moved = sim.lines.filter(changed);
  return (
    <div className={`ow-wi ${updating ? 'updating' : ''}`} aria-busy={updating}>
      <p className="ow-p" aria-live="polite">{limitsWhatIfWords(sim.lines)}</p>
      {moved.length ? (
        <table className="ui-table ow-rp" aria-label="Purchases these limits would treat differently">
          <thead>
            <tr><th>When</th><th>Purchase</th><th className="num">Amount</th><th>Now</th><th>With these limits</th></tr>
          </thead>
          <tbody>
            {moved.map((l) => (
              <tr key={l.deal_id} className="chg">
                <td className="t">{clockLabel(l.at)}</td>
                <td className="clip" title={`${l.label} · ${l.title}`}><span className="id">{l.label}</span> <span className="it">{l.title}</span></td>
                <td className="num">{formatMoney(l.amount)}</td>
                <td><Outcome v={l.before} /></td>
                <td><Outcome v={l.after} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
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
      <LimitsWhatIf args={built.ok ? built.args : null} />
      <Hint>When they run out, your agents can’t pay anyone until you set them again. Nothing here pays anyone.</Hint>
      {error ? <WalletNotice error={error} what="Wallet limits not signed" message={error.code === 'REFUSED' ? limitRefusalWords(error.message) : undefined} /> : null}
    </Sheet>
  );
}
