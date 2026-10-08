// The three sections that follow the decision, each readable on its own:
//   What happened          the conversation as a chat (theirs on the left, yours on the right, newest at
//                          the bottom, prices large) with ledger events as small centred lines, plus a
//                          "where it stands" panel of the numbers that matter
//   Your rules             the signed rules read against this deal (ChecksSummary: exceptions first)
//   Who you're dealing with  identity, how they get paid, history, the scam check, their note
// Ids, signatures and rule numbers live one layer down (Popover / Sheet).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Clause } from '@bindings/Clause';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Deal } from '@bindings/Deal';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import type { WalletError } from '../../../lib/contract';
import { clockLabel, formatMoney, shortHash, shortId } from '../../../lib/format';
import { houseWords, ruleNameOf, rulesName, shieldWord } from '../../../lib/words';
import { Btn, Chip, ChecksSummary, Empty, Icon, Kv, Loading, Popover, Sheet } from '../../../shared/ui';
import { isLive, pairingFact } from '../logic';
import { NoteChip } from '../modules/shield/NoteChip';
import { envelopeLink, stepWords, type ClauseReading, type EnvelopeLink, type Reading } from './model';
import { ruleChecks, threadRows, type Fact } from './story';

type Cp = { name: string; house: boolean; known: boolean; entry?: CounterpartyDisplay };

const GLYPH: Record<Reading, [string, string, string]> = {
  within: ['✓', 'okc', 'within your rule'],
  outside: ['✗', 'red', 'outside your rule'],
  asks: ['!', 'gold', 'asks you'],
  na: ['–', 'dim', 'does not apply'],
  unknown: ['?', 'dim', 'not checked on this screen'],
};

const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
/** "Dan" from "Dan · north-desk". */
const firstName = (n: string) => n.split(' · ')[0] ?? n;

/** Up / down moves between the messages (Enter / Space open the details, as on any row). */
function arrows(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')];
  const i = rows.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
}

// ---- what happened -----------------------------------------------------------------------------

export function WhatHappened({ deal, steps, error, clauses, theirName, facts, factsTitle }: {
  deal: Deal; steps: TranscriptStep[] | undefined; error: WalletError | null; clauses: readonly Clause[]; theirName: string; facts: Fact[]; factsTitle: string;
}) {
  const [pop, setPop] = useState<{ el: HTMLElement; s: TranscriptStep } | null>(null);
  const box = useRef<HTMLOListElement>(null);
  const rows = useMemo(() => (steps ? threadRows(steps, deal) : []), [steps, deal]);
  const nEnv = steps?.length ?? 0;
  const allOk = !!steps && steps.every((s) => s.verified);
  const them = firstName(theirName);
  const newest = steps?.reduce<number>((m, s) => Math.max(m, s.seq), -1) ?? -1;
  // Newest at the bottom: open the thread scrolled to it. The top edge fades only while something
  // is hidden above it, so a short thread never looks cut off.
  const [hidden, setHidden] = useState(false);
  useEffect(() => { const el = box.current; if (el) { el.scrollTop = el.scrollHeight; setHidden(el.scrollTop > 0); } }, [rows.length]);
  return (
    <div className={`dv-happen ${facts.length ? 'has-facts' : ''}`}>
      <section className="dv-thread" aria-label="What happened">
        {nEnv ? (
          <header className="dv-thead">
            <span className="dv-who-l coral"><i aria-hidden="true" />{them}</span>
            <span className={allOk ? 'okc' : 'red'} title={allOk ? 'Every message carries a valid signature' : 'Some signatures could not be checked'}>
              <Icon name={allOk ? 'check' : 'block'} size={13} /> {nEnv} signed {nEnv === 1 ? 'message' : 'messages'}
            </span>
            <span className="dv-who-r teal">You<i aria-hidden="true" /></span>
          </header>
        ) : null}
        {error ? (
          <Empty>The conversation couldn’t be loaded right now. It is still stored with the deal.</Empty>
        ) : !steps ? <Loading what="the conversation" /> : (
          <ol className={`dv-chat ${hidden ? 'more-above' : ''}`} ref={box} onKeyDown={arrows} onScroll={(e) => setHidden(e.currentTarget.scrollTop > 0)}>
            {!nEnv ? (
              <li className="sys wide"><span>{deal.kind !== 'haggle' ? 'Nothing was negotiated.' : isLive(deal) ? 'No offers yet.' : 'No offers are stored with this deal.'}</span></li>
            ) : null}
            {rows.map((r) => {
              if (r.kind === 'event') return <li key={r.key} className="sys"><span>{r.text}</span></li>;
              if (r.kind !== 'env') {
                // "Now: ..." is the current state, not an event with a time of its own.
                return <li key={r.key} className="sys"><span>{r.text.charAt(0).toUpperCase() + r.text.slice(1)}</span>{r.key === 'updated' ? null : <time>{clockLabel(r.at)}</time>}</li>;
              }
              const sw = stepWords(r.step, them);
              const price = r.step.price ? formatMoney(r.step.price) : null;
              return (
                <li key={r.key} className={`msg ${r.step.by}`}>
                  <button type="button" data-nav="" className={`bub ${price ? '' : 'np'} ${r.step.seq === newest ? 'newest' : ''} ${pop?.s.seq === r.step.seq ? 'on' : ''}`}
                    aria-label={`${sw.who} ${sw.verb}${price ? ` ${price}` : ''}`}
                    title="Show who signed it and which rule it was checked against"
                    onClick={(e) => { const t = e.currentTarget; setPop((p) => (p?.s.seq === r.step.seq ? null : { el: t, s: r.step })); }}>
                    <span className="vb">{sw.who} {sw.verb}</span>
                    {price ? <span className="px">{price}</span> : null}
                    <span className="tm">{r.step.verified ? null : <span className="red" title="This signature could not be checked">✗ unchecked · </span>}{clockLabel(r.step.at)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      {facts.length ? (
        <aside className="dv-stand" aria-label={factsTitle}>
          <h3>{factsTitle}</h3>
          <dl>
            {facts.map((f) => <div key={f.k} className={f.tone ?? ''}><dt>{f.k}</dt><dd>{f.v}</dd></div>)}
          </dl>
        </aside>
      ) : null}
      {pop ? (
        <Popover anchor={pop.el} onClose={() => setPop(null)} title={`${stepWords(pop.s, them).who} ${stepWords(pop.s, them).verb}`} className="dv-pop">
          <EnvelopeDetail deal={deal} s={pop.s} who={pop.s.by === 'you' ? 'you' : theirName} link={envelopeLink(pop.s, deal, clauses)} />
        </Popover>
      ) : null}
    </div>
  );
}

function EnvelopeDetail({ deal, s, who, link }: { deal: Deal; s: TranscriptStep; who: string; link: EnvelopeLink }) {
  return (
    <Kv items={[
      ['When', new Date(s.at * 1000).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })],
      ['Who', <>{who}{s.price ? <> · <b className="money">{formatMoney(s.price)}</b></> : null}</>],
      ['Signature', s.verified ? <span className="okc">✓ checked against {s.by === 'you' ? 'your agent’s key' : 'their verified key'}</span> : <span className="red">✗ could not be checked</span>],
      ['Checked against', link.clauses.length ? link.clauses.map((n) => ruleNameOf(n)).join(' · ') : s.by === 'them' ? 'their own rules, not yours' : 'no rule of yours sets this price'],
      ['Message', <span className="mono">#{s.seq} · {s.typ.toLowerCase()} · record {shortHash(deal.transcript_head)}</span>],
    ]} />
  );
}

// ---- your rules ---------------------------------------------------------------------------------

export type MandateState = { entry: MandateListEntry | undefined; newer: boolean; error: WalletError | null; loading: boolean };

export function YourRules({ deal, mandate, readings }: { deal: Deal; mandate: MandateState; readings: ClauseReading[] }) {
  const [sheet, setSheet] = useState(false);
  const [more, setMore] = useState(false);
  const checks = ruleChecks(readings);
  const known = checks.filter((c) => c.state !== 'unknown');
  const unknown = checks.filter((c) => c.state === 'unknown');
  const asItem = (c: (typeof checks)[number]) => ({ name: c.name, state: c.state, value: c.value, title: c.title });
  return (
    <div className="dv-panel dv-rules">
      <header className="dv-ph">
        <h3>{mandate.entry ? `Your ${rulesName(mandate.entry.agent).toLowerCase()}` : 'Your rules'}</h3>
        {mandate.entry ? <span className="dim">valid until {fmtDate(mandate.entry.payload.expires)}</span> : null}
        <Btn kind="plain" sm className="end" onClick={() => setSheet(true)}>All rules ›</Btn>
      </header>
      {mandate.error ? (
        <Empty>Your rules couldn’t be loaded right now. This deal is still bound by them.</Empty>
      ) : mandate.loading ? <Loading what="your rules" /> : !mandate.entry ? (
        <Empty>{mandate.newer ? 'You have signed newer rules since. This deal keeps the version it started with.' : 'These rules are no longer active.'}</Empty>
      ) : (
        <>
          {known.length ? <ChecksSummary label="Rule checks" checks={known.map(asItem)} openAll /> : <p className="dim">None of your rules can be read against this deal here.</p>}
          {unknown.length ? (
            more ? <ChecksSummary label="Checked when it pays" checks={unknown.map(asItem)} />
              : <button type="button" className="dv-fold" onClick={() => setMore(true)} title={unknown.map((c) => c.name).join(', ')}>
                <Icon name="eye" size={13} />{unknown.length} {unknown.length === 1 ? 'rule is' : 'rules are'} checked by your wallet when it pays <span>show</span>
              </button>
          ) : null}
        </>
      )}
      {sheet ? <MandateSheet deal={deal} mandate={mandate} readings={readings} onClose={() => setSheet(false)} /> : null}
    </div>
  );
}

function MandateSheet({ deal, mandate, readings, onClose }: { deal: Deal; mandate: MandateState; readings: ClauseReading[]; onClose: () => void }) {
  const p = mandate.entry?.payload;
  const status = mandate.error ? 'couldn’t be loaded' : mandate.entry ? 'signed and active' : mandate.newer ? 'replaced by newer rules' : 'not active';
  const name = mandate.entry ? rulesName(mandate.entry.agent) : 'Rules';
  const glyph = (r: Reading) => { const [g, cls, label] = GLYPH[r]; return <span className={`dv-vg ${cls}`} role="img" aria-label={label}>{g}</span>; };
  return (
    <Sheet title={`${name} for this deal`} onClose={onClose} footer={<Btn kind="primary" onClick={onClose}>Done</Btn>}>
      <Kv items={[
        ['Status', status],
        mandate.entry ? ['For', `your ${mandate.entry.agent} agent`] : null,
        p ? ['Valid', `${fmtDate(p.not_before)} → ${fmtDate(p.expires)}`] : null,
      ]} />
      <div className="ui-section-h dv-sh"><h3>What each rule says about this deal</h3></div>
      <div className="ui-group">
        {readings.length ? readings.map((c) => (
          <div key={c.key} className="ui-row two">
            {glyph(c.reading)}
            <span className="main"><span className="t1">{c.title} · <span className="dim">{c.rule}</span></span><span className="t2" title={c.fact}>{c.fact}</span></span>
          </div>
        )) : <Empty>No rules to show.</Empty>}
      </div>
      <details className="ui-disclosure dv-gap">
        <summary>Details</summary>
        <Kv items={[
          ['Rules id', <span className="mono">{deal.mandate_id}</span>],
          ['Version', `${deal.mandate_version}`],
          mandate.entry ? ['Your signature', <span className="mono">{mandate.entry.owner_sig.slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('')}…</span>] : null,
          ['Rule numbers', readings.map((c) => `${c.n} ${c.title}`).join(' · ')],
        ]} />
      </details>
      <p className="ui-hint">Rules only change when you sign new ones in the approval window.</p>
    </Sheet>
  );
}

// ---- who you're dealing with ----------------------------------------------------------------------

export function WhoYouDealWith({ deal, cp, offersUsed }: { deal: Deal; cp: Cp; offersUsed: string | null }) {
  const [sheet, setSheet] = useState(false);
  const pf = pairingFact(cp.entry);
  const sw = deal.shield ? shieldWord(deal.shield) : null;
  const row = (k: string, v: ReactNode) => <div className="ui-row"><span className="dv-k">{k}</span><span className="dv-v">{v}</span></div>;
  return (
    <div className="dv-panel dv-who">
      <header className="dv-ph">
        <h3 className="coral">{cp.name}</h3>
        <Btn kind="plain" sm className="end" onClick={() => setSheet(true)}>About ›</Btn>
      </header>
      <div className="ui-group">
        {row('Identity', <Chip tone={pf.tone} title={pf.why}>{pf.text}</Chip>)}
        {cp.entry?.declared_payee ? row('Gets paid as', <span title="The PayPal payee they declared when you connected; checked again before any payment">{houseWords(cp.entry.declared_payee)}</span>) : null}
        {cp.entry ? row('Known since', `${fmtDate(cp.entry.first_seen)} · ${cp.entry.deals_closed} earlier ${cp.entry.deals_closed === 1 ? 'deal' : 'deals'}`) : null}
        {row('Scam check', sw ? <Chip tone={sw.tone} title={sw.means}>{sw.text}</Chip> : <span className="dim">not run</span>)}
        {deal.kind === 'haggle' ? row(deal.side === 'buyer' ? 'Their lowest' : 'Their highest', <span className="dim" title="Only a sealed commitment is shared; you never see their limit, and they never see yours">kept private</span>) : null}
        {offersUsed ? row('Offers', offersUsed) : null}
        {row('Their note', <NoteChip dealId={deal.id} who={cp.name} title={`Note from ${cp.name}`} />)}
      </div>
      {sheet ? (
        <Sheet title={cp.name} onClose={() => setSheet(false)} footer={<Btn kind="primary" onClick={() => setSheet(false)}>Done</Btn>}>
          <Kv items={[
            ['Who', cp.house ? 'The house seller, built into this app' : cp.known ? 'A wallet you have dealt with' : 'A wallet you never named'],
            ['Identity', pf.why],
            cp.entry?.declared_payee ? ['Gets paid as', houseWords(cp.entry.declared_payee)] : null,
            cp.entry ? ['Known since', fmtDate(cp.entry.first_seen)] : null,
            cp.entry ? ['Earlier deals', String(cp.entry.deals_closed)] : null,
            deal.kind === 'haggle' ? [deal.side === 'buyer' ? 'Their lowest price' : 'Their highest price', <span className="dim">kept private · only a sealed commitment is shared</span>] : null,
            ['Scam check', <>{sw ? <Chip tone={sw.tone}>{sw.text}</Chip> : <span className="dim">not run</span>} {shieldText(deal)}</>],
          ]} />
          <details className="ui-disclosure dv-gap">
            <summary>Details</summary>
            <Kv items={[['Wallet key', <span className="mono">{deal.counterparty}</span>], ['Short key', <span className="mono">{shortId(deal.counterparty, 6, 3)}</span>]]} />
          </details>
          <p className="ui-hint">Anything they write is shown as-is, marked as theirs, and never given to your agent as instructions.</p>
        </Sheet>
      ) : null}
    </div>
  );
}

function shieldText(deal: Deal): string {
  switch (deal.shield) {
    case 'CLEAR': return 'Nothing suspicious found. Your rules still decide.';
    case 'ASK': return 'A check wants you to confirm before anything moves.';
    case 'HOLD': return 'Paused before any PayPal call. Release it in the approval window by typing the payee’s name, or leave it.';
    case 'BLOCK': return 'Blocked for good. No PayPal link is ever opened.';
    case null: return 'No scam check is recorded for this deal.';
  }
}
