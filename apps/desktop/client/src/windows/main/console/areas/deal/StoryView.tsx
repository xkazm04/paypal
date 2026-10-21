// The deal page's "What happened" view (rebuild WP3c; moved from deal/Columns.tsx and
// deal/WhoDecided.tsx): the conversation as a chat (theirs on the left, yours on the right, newest
// at the bottom, prices large) with ledger events as small centred lines, the numbers that matter
// ("where it stands"), and "who decided" from the wallet's own verified record (deal_history),
// one line each. Its own chunk; the record is read when this view opens.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import type { WalletError } from '../../../../../lib/contract';
import { clockLabel, formatMoney, shortHash } from '../../../../../lib/format';
import { useQuery } from '../../../../../lib/hooks';
import { DEAL_DECIDED, DEAL_DETAILS, DEAL_STORY, ruleNameOf } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Empty, Icon, Kv, Loading, Popover } from '../../../../../shared/ui';
import { envelopeLink, stepWords, type EnvelopeLink } from '../../../deal/model';
import { threadRows, type Fact } from '../../../deal/story';
import { endedBeforePayPalShowed, isLive, isMoneyCall, isRefusal, stepSentence, stepTime, tickTone } from '../../../logic';
import { TickMark } from '../rewind/TickMark';
import { decidedLine, decisionSteps } from './decided';

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

export function StoryView({ deal, steps, error, clauses, theirName, facts, factsTitle, title }: {
  deal: Deal; steps: TranscriptStep[] | undefined; error: WalletError | null; clauses: readonly Clause[]; theirName: string; facts: Fact[]; factsTitle: string; title: string;
}) {
  return (
    <>
      <WhatHappened deal={deal} steps={steps} error={error} clauses={clauses} theirName={theirName} facts={facts} factsTitle={factsTitle} />
      <WhoDecided deal={deal} title={title} />
    </>
  );
}

function WhatHappened({ deal, steps, error, clauses, theirName, facts, factsTitle }: {
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
      <section className="dv-thread" aria-label={DEAL_STORY.label}>
        {nEnv ? (
          <header className="dv-thead">
            <span className="dv-who-l coral"><i aria-hidden="true" />{them}</span>
            <span className={allOk ? 'okc' : 'red'} title={allOk ? DEAL_STORY.allSigned : DEAL_STORY.someUnchecked}>
              <Icon name={allOk ? 'check' : 'block'} size={13} /> {DEAL_STORY.signed(nEnv)}
            </span>
            <span className="dv-who-r teal">{DEAL_STORY.you}<i aria-hidden="true" /></span>
          </header>
        ) : null}
        {error ? (
          <Empty>{DEAL_STORY.unread}</Empty>
        ) : !steps ? <Loading what={DEAL_STORY.reading} /> : (
          <ol className={`dv-chat ${hidden ? 'more-above' : ''}`} ref={box} onKeyDown={arrows} onScroll={(e) => setHidden(e.currentTarget.scrollTop > 0)}>
            {!nEnv ? (
              <li className="sys wide"><span>{deal.kind !== 'haggle' ? DEAL_STORY.nothing : isLive(deal) ? DEAL_STORY.noOffers : DEAL_STORY.noOffersStored}</span></li>
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
                    aria-label={`${sw.who} ${sw.verb}${price ? ` ${price}` : ''}${r.step.verified ? '' : ` · ${DEAL_STORY.uncheckedTitle}`}`} title={DEAL_STORY.showWho}
                    onClick={(e) => { const t = e.currentTarget; setPop((p) => (p?.s.seq === r.step.seq ? null : { el: t, s: r.step })); }}>
                    <span className="vb">{sw.who} {sw.verb}</span>
                    {price ? <span className="px">{price}</span> : null}
                    <span className="tm">{r.step.verified ? null : <span className="red" title={DEAL_STORY.uncheckedTitle}>{DEAL_STORY.unchecked}</span>}{clockLabel(r.step.at)}</span>
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
        <Popover anchor={pop.el} onClose={() => setPop(null)} title={`${stepWords(pop.s, them).who} ${stepWords(pop.s, them).verb}`} className="dv-pop ar-deal-sheet">
          <EnvelopeDetail deal={deal} s={pop.s} who={pop.s.by === 'you' ? DEAL_STORY.youWord : theirName} link={envelopeLink(pop.s, deal, clauses)} />
        </Popover>
      ) : null}
    </div>
  );
}

function EnvelopeDetail({ deal, s, who, link }: { deal: Deal; s: TranscriptStep; who: string; link: EnvelopeLink }) {
  return (
    <Kv items={[
      [DEAL_STORY.when, new Date(s.at * 1000).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })],
      [DEAL_STORY.who, <>{who}{s.price ? <> · <b className="money">{formatMoney(s.price)}</b></> : null}</>],
      [DEAL_STORY.signature, s.verified ? <span className="okc">{s.by === 'you' ? DEAL_STORY.checkedYours : DEAL_STORY.checkedTheirs}</span> : <span className="red">{DEAL_STORY.notChecked}</span>],
      [DEAL_STORY.against, link.clauses.length ? link.clauses.map((n) => ruleNameOf(n)).join(' · ') : s.by === 'them' ? DEAL_STORY.theirRules : DEAL_STORY.noRule],
      [DEAL_STORY.message, <span className="mono">#{s.seq} · {s.typ.toLowerCase()} · {DEAL_DETAILS.record.toLowerCase()} {shortHash(deal.transcript_head)}</span>],
    ]} />
  );
}

/** "Who decided": this deal's decisions from the wallet's own verified record, one line each:
 *  when, what happened in plain words, and who decided it. The same steps the Rewind replays. */
function WhoDecided({ deal, title }: { deal: Deal; title: string }) {
  const q = useQuery('deal_history', { deal_id: deal.id }, { refreshOn: ['deal:changed', 'receipt:created'] });
  const all = q.data?.steps ?? [];
  const steps = decisionSteps(all);
  return (
    <section className="dv-who-decided" aria-label={DEAL_DECIDED.title}>
      <header>
        <h3>{DEAL_DECIDED.title}</h3>
        <span className="dim">{DEAL_DECIDED.from}</span>
      </header>
      {q.error ? <WalletNotice error={q.error} what={DEAL_DECIDED.unread} />
        : !q.data ? <Loading what={DEAL_DECIDED.reading} />
          : !steps.length ? <p className="dv-wd-none">{DEAL_DECIDED.none}</p> : (
            <ol>
              {steps.map((s) => {
                const money = isMoneyCall(s) || isRefusal(s);
                const tone = tickTone(s);
                return (
                  <li key={s.seq} className={money ? `t-${tone}` : ''}>
                    {money ? <TickMark tone={tone} /> : <i className="dv-wd-dot" aria-hidden="true" />}
                    <time>{stepTime(s.at)}</time>
                    <span className="say">{stepSentence(s, { title, side: deal.side, unshown: endedBeforePayPalShowed(all, s) })}</span>
                    <span className="by">{decidedLine(s)}</span>
                  </li>
                );
              })}
            </ol>
          )}
      {q.data?.truncated ? <p className="dim">{DEAL_DECIDED.older}</p> : null}
    </section>
  );
}
