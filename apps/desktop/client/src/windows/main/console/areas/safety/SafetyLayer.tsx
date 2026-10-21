// "Your safety record" (#p=safety), a layer of the one main window (rebuild WP3c). The wallet checks
// its whole record the way the hostile-agent tests do and says what it found: the verdict is the
// layer's one answer, a finding is a red alert under it naming its deals (each opens its deal), and
// four cards open one level down: the record itself (the chain, its head, the counts), who decided
// each money step (the bar in the Rewind's colours), why agents were refused, and how many deals
// were checked. "Check again" reads it again. Read-only; every number is the wallet's own
// (safety_record); a finding is never softened.
import type { SafetyRecord } from '@bindings/SafetyRecord';
import { clockLabel } from '../../../../../lib/format';
import { useQuery } from '../../../../../lib/hooks';
import {
  AUDIT_BROKEN, NOTICE_WHAT, SAFETY_CARD, SAFETY_FOUND, SAFETY_KICKER, SAFETY_LAYER, SAFETY_READING, SAFETY_READING_SUB, SAFETY_UNREAD, SAFETY_UNREAD_SUB, SAFETY_VIEW,
} from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Kv, Silence } from '../../../../../shared/ui';
import { authorityParts, count, FAMILY_WORDS, headGroups, moneySteps, plural, safetyWords, scopeWords, VIOLATION_WORDS } from '../../../safety/model';
import { shortTitle } from '../../../home/model';
import { useDeals, useWorldSelector, type World } from '../../../world';
import type { LayerProps } from '../../layers';
import { PlaceFrame, type LensCard } from '../settings/frame';

export type DealName = { label: string; title: string };

const selDisplay = (w: World) => w.display;

/** The record's figures, for the facts strip and "The record itself". Past a broken chain Rust
 *  counts nothing (table-runtime safety.rs returns zeros), so only the records and the chain are
 *  shown: a count that was never taken must not read as a zero (UX-GUIDE: unknown is never zero). */
export function recordFacts(r: SafetyRecord): [string, string][] {
  const head: [string, string][] = [[SAFETY_VIEW.records, count(r.records)], [SAFETY_VIEW.chain, r.intact ? SAFETY_VIEW.chainOk : SAFETY_VIEW.chainBroken]];
  if (!r.intact) return head;
  return [
    ...head,
    [SAFETY_VIEW.dealsChecked, SAFETY_VIEW.of(count(r.deals_checked), count(r.deals_total))],
    [SAFETY_VIEW.histories, SAFETY_VIEW.of(count(r.transcripts_verified), count(r.deals_checked))],
    [SAFETY_VIEW.refusedDeals, SAFETY_VIEW.refusedDealsLine(count(r.refused_deals), count(r.refused_deal_calls))],
    [SAFETY_VIEW.moneySteps, count(moneySteps(r.money))],
  ];
}

/** The Refused card: not counted (null, drawn unknown) past a broken chain, like Money steps and Deals checked. */
export function refusedCard(r: SafetyRecord): { value: string | null; note: string | undefined } {
  if (!r.intact) return { value: null, note: undefined };
  return {
    value: r.refusals ? SAFETY_CARD.refusedValue(count(r.refusals)) : SAFETY_CARD.refusedNone,
    note: r.refusals ? (r.refused_deal_calls === 0 && r.violations_total === 0 ? SAFETY_CARD.refusedNote : SAFETY_CARD.refusedNoteCalls) : undefined,
  };
}

export function SafetyLayer({ nav }: LayerProps) {
  const q = useQuery('safety_record', null);
  const deals = useDeals().data;
  const display = useWorldSelector(selDisplay);
  const name = (id: string): DealName | null => {
    const d = deals?.find((x) => x.id === id);
    if (!d) return null;
    const disp = display(d);
    return { label: disp.label, title: shortTitle(disp.title) };
  };
  const r = q.data;
  const again = <Btn disabled={q.loading} onClick={() => void q.refetch()} title={SAFETY_LAYER.againTitle}>{SAFETY_LAYER.again}</Btn>;
  if (!r) {
    return (
      <PlaceFrame root="ar-safety" place="safety" tone="var(--teal)" kicker={SAFETY_KICKER('…')} answer={q.error ? SAFETY_UNREAD : SAFETY_READING}
        sub={q.error ? SAFETY_UNREAD_SUB : SAFETY_READING_SUB} action={again}>
        {q.error ? <WalletNotice error={q.error} what={NOTICE_WHAT.safety} /> : null}
      </PlaceFrame>
    );
  }
  const words = safetyWords(r);
  const steps = moneySteps(r.money);
  const cards: LensCard[] = [
    {
      id: 'records', label: SAFETY_CARD.records, value: SAFETY_CARD.recordsValue(count(r.records)),
      note: r.intact ? SAFETY_CARD.unbroken : SAFETY_CARD.broken, chip: r.intact ? undefined : SAFETY_VIEW.chainBroken, chipTone: 'red',
      view: { title: SAFETY_VIEW.details, sub: SAFETY_VIEW.detailsSub, render: () => <SafetyDetails record={r} dealName={name} onDeal={nav.deal} /> },
    },
    {
      id: 'money', label: SAFETY_CARD.money, value: r.intact ? count(steps) : null, note: !r.intact ? undefined : steps ? SAFETY_CARD.moneyNote : SAFETY_CARD.moneyNone,
    },
    {
      id: 'refused', label: SAFETY_CARD.refused, ...refusedCard(r),
      view: { title: SAFETY_VIEW.refused, sub: SAFETY_VIEW.refusedSub, render: () => <SafetyRefusals record={r} /> },
    },
    { id: 'deals', label: SAFETY_CARD.deals, value: r.intact ? SAFETY_CARD.dealsValue(count(r.deals_checked), count(r.deals_total)) : null, note: scopeWords(r) },
  ];
  return (
    <PlaceFrame root="ar-safety" place="safety" tone="var(--teal)" kicker={SAFETY_KICKER(clockLabel(r.checked_at))} answer={words.verdict}
      sub={words.lines.join(' ')} action={again} cards={cards}
      latest={{
        title: SAFETY_VIEW.details,
        // The record at a glance (the same figures as "Your record", read-only; a broken chain says so).
        facts: recordFacts(r),
      }}
      lead={r.violations_total > 0 ? <SafetyFindings record={r} detailed={false} dealName={name} onDeal={nav.deal} /> : null}
      className={words.tone === 'bad' ? 'bad' : 'ok'}>
      {q.error ? <WalletNotice error={q.error} what={NOTICE_WHAT.safety} /> : null}
      {r.intact && steps > 0 ? (
        <section className="sf-sum" aria-label={SAFETY_VIEW.who}>
          <h2 className="cs-h3">{SAFETY_VIEW.who}</h2>
          <p className="sf-sub">{SAFETY_VIEW.whoSub}</p>
          <SafetyWho record={r} />
        </section>
      ) : null}
    </PlaceFrame>
  );
}

/** What broke the rules: red, unmissable, each finding naming its deal by title (its label and the
 *  precise words only when `detailed`), with a way to open the deal. */
export function SafetyFindings({ record: r, detailed, dealName, onDeal }: { record: SafetyRecord; detailed: boolean; dealName: (id: string) => DealName | null; onDeal: (id: string) => void }) {
  if (r.violations_total <= 0) return null;
  const words = safetyWords(r);
  return (
    <section className="sf-found" role="alert" aria-label={SAFETY_FOUND.label}>
      <p className="sf-v">{words.verdict}</p>
      <h3>{r.violations_total === 1 ? SAFETY_FOUND.one : SAFETY_FOUND.many(count(r.violations_total))}</h3>
      <ul>
        {r.violations.map((v, i) => {
          const d = v.deal_id ? dealName(v.deal_id) : null;
          return (
            <li key={`${v.kind}-${v.deal_id ?? 'chain'}-${i}`}>
              <span className="sf-x" aria-hidden="true">×</span>
              <span className="sf-what">
                <b>{VIOLATION_WORDS[v.kind]}</b>
                {d ? <span className="sf-deal">{d.title}</span> : null}
                {detailed ? <span className="sf-detail mono">{d ? `${d.label} · ` : ''}{v.detail}</span> : null}
              </span>
              {v.deal_id ? <Btn sm onClick={() => onDeal(v.deal_id as string)}>{SAFETY_FOUND.open}</Btn> : null}
            </li>
          );
        })}
      </ul>
      {r.violations_total > r.violations.length ? <p className="ui-hint">{SAFETY_FOUND.first(count(r.violations.length), count(r.violations_total))}</p> : null}
      {!r.intact ? <ul className="sf-todo">{AUDIT_BROKEN.todo.map((t) => <li key={t}>{t}</li>)}</ul> : null}
      {detailed ? null : <p className="sf-if"><Silence text={SAFETY_FOUND.ifNothing} /></p>}
    </section>
  );
}

/** Who decided each money step, as one bar in the Rewind's colours and its legend. */
export function SafetyWho({ record: r }: { record: SafetyRecord }) {
  const parts = authorityParts(r.money);
  if (!r.intact || moneySteps(r.money) === 0) return null;
  return (
    <section className="sf-who" aria-label={SAFETY_VIEW.who}>
      <div className="sf-bar" role="img" aria-label={SAFETY_VIEW.whoLabel(parts.map((p) => p.words).join(', '))}>
        {parts.map((p) => <span key={p.key} className={`sf-seg t-${p.tone}`} style={{ flexGrow: p.n }} title={p.words} />)}
      </div>
      <ul className="sf-legend">
        {parts.map((p) => <li key={p.key}><span className={`sf-key t-${p.tone}`} aria-hidden="true" />{p.label}<span className="sf-n">{count(p.n)}</span></li>)}
      </ul>
    </section>
  );
}

export function SafetyRefusals({ record: r }: { record: SafetyRecord }) {
  if (!r.refusal_families.length) return <p className="dim">{SAFETY_VIEW.refusedNone}</p>;
  return <Kv className="sf-fam" items={r.refusal_families.map((f) => [FAMILY_WORDS[f.family], plural(f.count, 'time', 'times')] as const)} />;
}

/** The record itself: the chain, its head, the counts, and the precise findings. */
export function SafetyDetails({ record: r, dealName, onDeal }: { record: SafetyRecord; dealName: (id: string) => DealName | null; onDeal: (id: string) => void }) {
  const [records, chain, ...counted] = recordFacts(r);
  return (
    <section className="sf-details" aria-label={SAFETY_VIEW.details}>
      <Kv items={[
        records ?? null,
        chain ?? null,
        r.head ? [SAFETY_VIEW.latest, <span key="h" className="mono sf-head" title={SAFETY_VIEW.latestTitle}>{headGroups(r.head).join(' ')}</span>] : null,
        ...counted,
      ]} />
      {r.refusal_families.length ? (
        <>
          <h3 className="cs-h3">{SAFETY_VIEW.refused}</h3>
          <SafetyRefusals record={r} />
        </>
      ) : null}
      {r.violations_total > 0 ? <SafetyFindings record={r} detailed dealName={dealName} onDeal={onDeal} /> : null}
      <p className="ui-hint sf-scope">{scopeWords(r)} {SAFETY_VIEW.checked(clockLabel(r.checked_at))}</p>
    </section>
  );
}
