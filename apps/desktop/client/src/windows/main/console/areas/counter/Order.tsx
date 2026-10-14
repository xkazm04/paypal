// One order at the owner's counter (rebuild WP3a): where it stands, who is buying, the item and its
// lowest price, where the money is, what happens if nobody acts, the decision when there is one
// (`approval_open` only), the signed history (read only for this order) and their words, quarantined.
import type { Deal } from '@bindings/Deal';
import { clockLabel, formatMoney } from '../../../../../lib/format';
import { COUNTER, houseWords, moneyCheckNow, stateWord, TABLES_TRADE } from '../../../../../lib/words';
import { ModeBadge, WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, Disclosure, Kv, Loading, Section, Silence, type ChipTone } from '../../../../../shared/ui';
import { stepWords } from '../../../deal/model';
import { isLive, isTerminal, moneyNow, pairingFact, stripFor } from '../../../logic';
import { underDraft, type CatalogRow, type FloorDraft } from '../../../modules/counter/model';
import { useCpLookup } from '../../../ui';
import { useNeedOf, type Display } from '../../../world';
import { useLayerNav } from '../../layers';
import { Amount, Countdown, StateChip } from '../../rows';
import { HandOff, TheirWords, useTranscript } from '../tables/parts';

const BY_TONE: Record<string, ChipTone | undefined> = { you: 'teal', them: 'coral', house: 'line' };

/** The order's path as a few segments: done, current, to come. */
export function MiniBar({ deal }: { deal: Deal }) {
  const steps = stripFor(deal);
  const text = stateWord(deal.state, { side: deal.side, kind: deal.kind }).text;
  return (
    <span className="ctr-qdots" role="img" aria-label={COUNTER.stepOf(steps.findIndex((s) => s.status === 'cur') + 1, steps.length, text)}>
      {steps.map((s) => <i key={s.state} className={s.status === 'done' ? 'd' : s.status === 'cur' ? `c ${s.tone ?? ''}` : ''} />)}
    </span>
  );
}

export function OrderPane({ deal, disp, row, draft }: { deal: Deal; disp: Display; row: CatalogRow | undefined; draft: FloorDraft }) {
  const nav = useLayerNav();
  const need = useNeedOf(deal.id);
  const c = useCpLookup()(deal.counterparty);
  const tr = useTranscript(deal.id);
  const steps = stripFor(deal);
  const pp = deal.paypal;
  const refs = [pp.order && COUNTER.refOrder(pp.order), pp.authorization && COUNTER.refHold(pp.authorization), pp.capture && COUNTER.refPayment(pp.capture)].filter((x): x is string => !!x);
  const silence = need?.on_silence ?? disp.on_silence;
  const live = isLive(deal);
  const now = need?.money_check ? moneyCheckNow(isTerminal(deal)) : moneyNow(deal);
  const deadline = need?.deadline ?? disp.deadline;
  const pf = pairingFact(c.entry);
  return (
    <div className="ctr-pane">
      <header className="tr-phead">
        <h2 title={disp.title}>{disp.title}</h2>
        <span className="tr-with" title={c.name}>{COUNTER.from(c.name)}</span>
        <span className="ui-spacer" />
        <Btn sm kind="plain" onClick={() => nav.deal(deal.id)} title={TABLES_TRADE.openDealTitle}>{TABLES_TRADE.openDeal}</Btn>
      </header>
      <div className="ctr-top">
        <StateChip deal={deal} />
        <Amount money={{ minor: deal.terms.unit_price.minor * deal.terms.qty, currency: deal.terms.currency }} className="big" />
        {live ? <Countdown deadline={deadline} /> : null}
        {deal.mode !== 'sandbox' ? <ModeBadge mode={deal.mode} /> : null}
      </div>
      <ol className="ctr-steps" aria-label={COUNTER.orderSteps(stateWord(deal.state, deal).text)}>
        {steps.map((s) => <li key={s.state} className={`${s.status} ${s.status === 'cur' ? s.tone ?? '' : ''}`} aria-current={s.status === 'cur' ? 'step' : undefined} title={s.label}>{s.label}</li>)}
      </ol>
      {need ? (
        <Section title={COUNTER.needsYou} className="ctr-need">
          {need.actions.includes('review') ? <HandOff args={{ deal_id: deal.id }}>{COUNTER.reviewApprove}</HandOff> : null}
          <p><Silence text={need.on_silence} deadline={need.deadline} /></p>
        </Section>
      ) : null}
      {underDraft(deal, row, draft) ? <p className="ctr-warn">{COUNTER.underWarn}</p> : null}
      <Kv items={[
        [COUNTER.buyer, <><span title={c.name}>{c.name}</span> · <span title={pf.why}>{pf.text}</span>{c.entry ? COUNTER.firstSeen(clockLabel(c.entry.first_seen), c.entry.deals_closed) : null}{c.entry?.declared_payee ? ` · ${COUNTER.paysFrom(houseWords(c.entry.declared_payee))}` : ''}</>],
        [COUNTER.item, <>{disp.title}{deal.terms.qty > 1 ? ` · ${deal.terms.qty} ×` : ''}{row?.signed ? COUNTER.lowestOf(formatMoney(row.signed)) : COUNTER.noLowest}</>],
        [COUNTER.money, now],
        [live ? COUNTER.ifNothing : COUNTER.outcome, silence ?? (live ? COUNTER.noMoney : now)],
      ]} />
      <Section title={COUNTER.happened} end={COUNTER.happenedEnd}>
        {tr.error ? <WalletNotice error={tr.error} what={COUNTER.historyWhat} message={COUNTER.historyUnread} /> : !tr.data ? <Loading what={COUNTER.historyReading} /> : !tr.data.length ? (
          <p className="ui-hint">{COUNTER.historyNone}</p>
        ) : (
          <ol className="ctr-tl">
            {tr.data.map((s) => (
              <li key={s.seq}><time>{clockLabel(s.at)}</time><Chip tone={BY_TONE[s.by]}>{COUNTER.by[s.by] ?? COUNTER.by.them}</Chip>
                <span>{stepWords(s, c.name).who} {stepWords(s, c.name).verb}{s.price ? ` · ${formatMoney(s.price)}` : ''}{s.verified ? COUNTER.verified : ''}</span></li>
            ))}
          </ol>
        )}
      </Section>
      {refs.length ? <Disclosure summary={COUNTER.references}><p className="tr-mono">{refs.join(' · ')}</p></Disclosure> : null}
      <TheirWords dealId={deal.id} who={c.name} />
    </div>
  );
}
