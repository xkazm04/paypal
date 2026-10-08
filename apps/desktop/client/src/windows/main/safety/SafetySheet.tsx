// "Your safety record": the wallet checks its whole record the way the hostile-agent tests do and
// says what it found. Read-only; every number is the wallet's own (safety_record). A finding is
// red and names its deals, never softened. Details (Layer 2) holds the chain head, the counts per
// kind of refusal and the precise findings.
import type { SafetyRecord } from '@bindings/SafetyRecord';
import { clockLabel } from '../../../lib/format';
import { useQuery } from '../../../lib/hooks';
import { AUDIT_BROKEN } from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { Btn, DetailToggle, Kv, Sheet, useDetail } from '../../../shared/ui';
import { Loading } from '../ui';
import { useWorld } from '../world';
import { authorityParts, count, FAMILY_WORDS, headGroups, moneySteps, plural, safetyWords, scopeWords, VIOLATION_WORDS } from './model';
import './safety.css';

export function SafetySheet({ onClose, onDeal }: { onClose: () => void; onDeal: (id: string) => void }) {
  const q = useQuery('safety_record', null);
  const [detail, setDetail] = useDetail('safety');
  const w = useWorld();
  const name = (id: string): DealName | null => {
    const d = w.deals.data?.find((x) => x.id === id);
    return d ? w.display(d) : null;
  };
  const r = q.data;
  return (
    <Sheet title="Your safety record" onClose={onClose} className={`sf-sheet det-${detail}`}
      head={<DetailToggle value={detail} onChange={setDetail} />}
      footer={<>
        <Btn className="left" disabled={q.loading} onClick={() => void q.refetch()}
          title="Check every entry and every deal again, now">Check again</Btn>
        <Btn kind="primary" onClick={onClose}>Done</Btn>
      </>}>
      {q.error ? <WalletNotice error={q.error} what="Safety record" /> : null}
      {r ? <SafetyView record={r} detailed={detail === 'detailed'} dealName={name} onDeal={onDeal} /> : !q.error ? <Loading what="your safety record" /> : null}
    </Sheet>
  );
}

type DealName = { label: string; title: string };

/** The record itself. `dealName` names a deal by its title (its label only in Details). */
export function SafetyView({ record: r, detailed, dealName, onDeal }: { record: SafetyRecord; detailed: boolean; dealName: (id: string) => DealName | null; onDeal: (id: string) => void }) {
  const words = safetyWords(r);
  const parts = authorityParts(r.money);
  const steps = moneySteps(r.money);
  return (
    <div className="sf">
      <div className={`sf-verdict ${words.tone}`} role={words.tone === 'bad' ? 'alert' : 'status'}>
        <span className="sf-mark" aria-hidden="true">{words.tone === 'ok' ? '✓' : '×'}</span>
        <div>
          <p className="sf-v">{words.verdict}</p>
          {words.lines.map((l) => <p key={l} className="sf-l">{l}</p>)}
        </div>
      </div>

      {r.violations_total > 0 ? (
        <section className="sf-found" aria-label="What broke the rules">
          <h3>{r.violations_total === 1 ? 'Look at this now' : `Look at these ${count(r.violations_total)} now`}</h3>
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
                  {v.deal_id ? <Btn sm onClick={() => onDeal(v.deal_id as string)}>Open deal ›</Btn> : null}
                </li>
              );
            })}
          </ul>
          {r.violations_total > r.violations.length ? <p className="ui-hint">Showing the first {count(r.violations.length)} of {count(r.violations_total)}.</p> : null}
          {!r.intact ? <ul className="sf-todo">{AUDIT_BROKEN.todo.map((t) => <li key={t}>{t}</li>)}</ul> : null}
        </section>
      ) : null}

      {r.intact && steps > 0 ? (
        <section className="sf-who" aria-label="Who decided each money step">
          <div className="sf-bar" role="img" aria-label={`Who decided each money step: ${parts.map((p) => p.words).join(', ')}`}>
            {parts.map((p) => <span key={p.key} className={`sf-seg t-${p.tone}`} style={{ flexGrow: p.n }} title={p.words} />)}
          </div>
          <ul className="sf-legend">
            {parts.map((p) => (
              <li key={p.key}><span className={`sf-key t-${p.tone}`} aria-hidden="true" />{p.label}<span className="sf-n">{count(p.n)}</span></li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="ui-hint sf-scope">{scopeWords(r)} Checked {clockLabel(r.checked_at)}.</p>

      {detailed ? (
        <section className="sf-details" aria-label="Details">
          <Kv items={[
            ['Records', count(r.records)],
            ['Chain', r.intact ? 'each record links to the one before it' : 'broken'],
            r.head ? ['Latest record', <span key="h" className="mono sf-head" title="The fingerprint of the newest record. Any change to an earlier record changes it.">{headGroups(r.head).join(' ')}</span>] : null,
            ['Deals checked', `${count(r.deals_checked)} of ${count(r.deals_total)}`],
            ['Message histories verified', `${count(r.transcripts_verified)} of ${count(r.deals_checked)}`],
            ['Refused deals', `${count(r.refused_deals)} · PayPal calls on them: ${count(r.refused_deal_calls)}`],
            ['Money steps', count(steps)],
          ]} />
          {r.refusal_families.length ? (
            <>
              <h3>Why your agents were refused</h3>
              <Kv className="sf-fam" items={r.refusal_families.map((f) => [FAMILY_WORDS[f.family], plural(f.count, 'time', 'times')] as const)} />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
