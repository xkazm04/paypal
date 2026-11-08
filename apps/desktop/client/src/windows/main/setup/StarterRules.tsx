// The Set up page's rules step as one small card: three spending sizes, the rules read back in one
// sentence, and one button. The button opens the approval window with the rules already filled in
// (the practice shop is the approved payee), so there is nothing to type before signing. The card
// never signs anything: SecureStep hands over to the approval window, and `done` comes from the wallet.
import { useMemo, useState } from 'react';
import { useMutation } from '../../../lib/hooks';
import { clockNow } from '../../../lib/clock';
import { Btn, useToast } from '../../../shared/ui';
import { RULES_START, proposalOf, rulesCtx, type RulesAsk } from '../home/guide/rules';
import { SAY } from '../../../lib/words';
import { STARTER } from './starterWords';
import './starter.css';

const ASKS: Record<(typeof STARTER.sizes)[number]['key'], RulesAsk> = {
  careful: RULES_START,
  everyday: { perDeal: 250_00, perDay: 400_00, askAbove: 100_00, ends: 'for a week' },
  roomy: { perDeal: 500_00, perDay: 1000_00, askAbove: 250_00, ends: 'for a week' },
};

export function StarterRules({ onOpened }: { done?: boolean; onOpened: () => void }) {
  const [size, setSize] = useState<keyof typeof ASKS>('careful');
  const open = useMutation('approval_open');
  const toast = useToast();
  const p = useMemo(() => {
    const t = Math.floor(clockNow() / 60) * 60;
    return proposalOf(ASKS[size], rulesCtx(t, -new Date(t * 1000).getTimezoneOffset()));
  }, [size]);
  const go = async () => {
    if (!p) return;
    const r = await open.run({ deal_id: null, target: 'mandate', draft: p.draft });
    if (r === null) { toast(SAY.opened, 'gold'); onOpened(); }
  };
  return (
    <div className="st-card" data-starter="rules">
      <h2 className="cs-h3">{STARTER.title}</h2>
      <div className="st-sizes" role="radiogroup" aria-label={STARTER.sizesLabel}>
        {STARTER.sizes.map((s) => (
          <button key={s.key} type="button" role="radio" aria-checked={size === s.key} className={`st-size${size === s.key ? ' on' : ''}`} onClick={() => setSize(s.key)}>
            <b>{s.label}</b><span>{s.line}</span>
          </button>
        ))}
      </div>
      {p ? <p className="st-reads"><span>{STARTER.reads}</span>{p.sentence}</p> : null}
      <div className="cs-acts"><Btn kind="gold" disabled={!p || open.pending} title={STARTER.goTitle} onClick={() => void go()}>{STARTER.go} ↗</Btn></div>
      <p className="st-safe">{STARTER.safe}</p>
    </div>
  );
}
