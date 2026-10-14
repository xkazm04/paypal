// The deal page's "Rules that applied" view (rebuild WP3c; moved from deal/Columns.tsx YourRules and
// its sheet): the signed rules read against this deal, exceptions first, the rules checked only
// when the wallet pays one disclosure away, then what each rule says about this deal and the rule
// set's proof in Details. Rules only change in the approval window; "Agent rules" opens the layer.
import { useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { WalletError } from '../../../../../lib/contract';
import { DEAL_RULES, rulesName } from '../../../../../lib/words';
import { Btn, ChecksSummary, Disclosure, Empty, Icon, Kv, Loading } from '../../../../../shared/ui';
import type { ClauseReading, Reading } from '../../../deal/model';
import { ruleChecks } from '../../../deal/story';

export type MandateState = { entry: MandateListEntry | undefined; newer: boolean; error: WalletError | null; loading: boolean };

const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const GLYPH: Record<Reading, [string, string]> = { within: ['✓', 'okc'], outside: ['✗', 'red'], asks: ['!', 'gold'], na: ['–', 'dim'], unknown: ['?', 'dim'] };

export function RulesView({ deal, mandate, readings, onRules }: { deal: Deal; mandate: MandateState; readings: ClauseReading[]; onRules: () => void }) {
  const [more, setMore] = useState(false);
  const checks = ruleChecks(readings);
  const known = checks.filter((c) => c.state !== 'unknown');
  const unknown = checks.filter((c) => c.state === 'unknown');
  const asItem = (c: (typeof checks)[number]) => ({ name: c.name, state: c.state, value: c.value, title: c.title });
  const p = mandate.entry?.payload;
  const status = mandate.error ? DEAL_RULES.statusUnread : mandate.entry ? DEAL_RULES.statusActive : mandate.newer ? DEAL_RULES.statusReplaced : DEAL_RULES.statusOff;
  return (
    <div className="dv-panel dv-rules">
      <header className="dv-ph">
        <h3>{mandate.entry ? DEAL_RULES.yours(rulesName(mandate.entry.agent).toLowerCase()) : DEAL_RULES.plain}</h3>
        {p ? <span className="dim">{DEAL_RULES.validUntil(fmtDate(p.expires))}</span> : null}
        <Btn kind="plain" sm className="end" onClick={onRules}>{DEAL_RULES.toRules}</Btn>
      </header>
      {mandate.error ? (
        <Empty>{DEAL_RULES.unread}</Empty>
      ) : mandate.loading ? <Loading what={DEAL_RULES.reading} /> : !mandate.entry ? (
        <Empty>{mandate.newer ? DEAL_RULES.newer : DEAL_RULES.gone}</Empty>
      ) : (
        <>
          {known.length ? <ChecksSummary label={DEAL_RULES.checks} checks={known.map(asItem)} openAll /> : <p className="dim">{DEAL_RULES.noneHere}</p>}
          {unknown.length ? (
            more ? <ChecksSummary label={DEAL_RULES.whenPays} checks={unknown.map(asItem)} />
              : <button type="button" className="dv-fold" onClick={() => setMore(true)} title={unknown.map((c) => c.name).join(', ')}>
                <Icon name="eye" size={13} />{unknown.length === 1 ? DEAL_RULES.foldOne : DEAL_RULES.foldMany(unknown.length)} <span>{DEAL_RULES.show}</span>
              </button>
          ) : null}
        </>
      )}
      <h3 className="cs-h3 dv-sh">{DEAL_RULES.each}</h3>
      <div className="dv-readings">
        {readings.length ? readings.map((c) => {
          const [g, cls] = GLYPH[c.reading];
          return (
            <div key={c.key} className="dv-reading">
              <span className={`dv-vg ${cls}`} role="img" aria-label={DEAL_RULES.glyph[c.reading]}>{g}</span>
              <span className="main"><span className="t1">{c.title} · <span className="dim">{c.rule}</span></span><span className="t2" title={c.fact}>{c.fact}</span></span>
            </div>
          );
        }) : <Empty>{DEAL_RULES.noRules}</Empty>}
      </div>
      <Disclosure summary={DEAL_RULES.details} className="dv-gap">
        <Kv items={[
          [DEAL_RULES.status, status],
          mandate.entry ? [DEAL_RULES.for, DEAL_RULES.forAgent(mandate.entry.agent)] : null,
          p ? [DEAL_RULES.valid, `${fmtDate(p.not_before)} → ${fmtDate(p.expires)}`] : null,
          [DEAL_RULES.version, `${deal.mandate_version}`],
          mandate.entry ? [DEAL_RULES.signature, <span className="mono">{mandate.entry.owner_sig.slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('')}…</span>] : null,
        ]} />
      </Disclosure>
      <p className="ui-hint">{DEAL_RULES.onlyApproval}</p>
    </div>
  );
}
