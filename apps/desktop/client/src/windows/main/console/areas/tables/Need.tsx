// A table that needs the owner (rebuild WP3a): the question in her words, why she is asked, the
// amount, and her options: review in the approval window (the one gold action; `approval_open` only),
// withdraw (a confirm first; `deal_withdraw` moves no money), or open the deal. The "If you do
// nothing" line is always there.
import { useState } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import { APPROVAL_LOCKED_TITLE, APPROVAL_OPEN_TITLE, headlineWords, OPEN_THE_DEAL, ruleNameOf, stateWord, TABLES, TABLES_TRADE, tablesItem } from '../../../../../lib/words';
import { useMutation } from '../../../../../lib/hooks';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, DecisionCard, Kv, Sheet, type DecisionOption } from '../../../../../shared/ui';
import { canWithdraw, isOwnerAccept } from '../../../logic';
import { short } from '../../../modules/tables/ladder';
import { LockGlyph } from '../../../ui';
import { useLocked, type Display } from '../../../world';

export function NeedCard({ deal, disp, need, who, onDeal, onToast }: {
  deal: Deal; disp: Display; need: AttentionItem; who: string; onDeal: () => void; onToast: (text: string, tone?: 'gold' | 'ok') => void;
}) {
  const locked = useLocked();
  const open = useMutation('approval_open');
  const withdraw = useMutation('deal_withdraw');
  const [ask, setAsk] = useState(false);
  const review = need.actions.includes('review');
  const accept = isOwnerAccept(need, deal);
  const mayWithdraw = canWithdraw(deal) && (need.actions.includes('withdraw') || deal.kind === 'haggle');
  const item = tablesItem(disp.title);
  const amt = need.amount_minor ? short(need.amount_minor, need.currency) : null;
  const question = review && amt
    ? (accept ? TABLES.acceptQ(who, amt, item) : TABLES.approveQ(amt, who, item))
    : headlineWords(need.headline);
  const why = need.clause ? TABLES.ruleKeeps(ruleNameOf(need.clause.number)) : stateWord(deal.state, deal).means;
  const options: DecisionOption[] = [];
  if (review) {
    options.push({
      kind: 'gold', label: <>{locked ? <LockGlyph locked /> : null}{accept ? TABLES.reviewAccept : TABLES.reviewApprove} ↗</>,
      means: deal.side === 'buyer' ? TABLES.reviewMeansBuyer : TABLES.reviewMeansSeller,
      title: locked ? APPROVAL_LOCKED_TITLE : APPROVAL_OPEN_TITLE,
      disabled: open.pending,
      onClick: async () => { const r = await open.run({ deal_id: deal.id }); if (r !== undefined) onToast(TABLES_TRADE.handedOff, 'gold'); },
    });
  }
  if (mayWithdraw) options.push({ kind: 'danger', label: TABLES.withdraw, means: TABLES.withdrawMeans, onClick: () => setAsk(true) });
  if (!review) options.push({ label: OPEN_THE_DEAL, means: TABLES.openDealMeans, onClick: onDeal });
  return (
    <>
      <DecisionCard className="tb-need" context={<>{TABLES.tableWith(who)}</>}
        question={question} why={why} amount={amt && review ? <span className="num">{amt}</span> : undefined} options={options}
        silence={need.on_silence} deadline={need.deadline}>
        {open.error ? <WalletNotice error={open.error} what={TABLES_TRADE.approvalWhat} /> : null}
        {withdraw.error ? <WalletNotice error={withdraw.error} what={TABLES.withdrawWhat} /> : null}
      </DecisionCard>
      {ask ? (
        <Sheet title={TABLES.withdrawQ(who)} size="narrow" onClose={() => setAsk(false)} className="ar-tables"
          footer={<>
            <Btn onClick={() => setAsk(false)}>{TABLES.keep}</Btn>
            <Btn kind="danger" disabled={withdraw.pending} onClick={async () => {
              const r = await withdraw.run({ deal_id: deal.id });
              setAsk(false);
              if (r === null) onToast(TABLES.withdrawn(disp.title), 'ok');
            }}>{withdraw.pending ? TABLES.sending : TABLES.withdraw}</Btn>
          </>}>
          <p>{TABLES.withdrawBody(disp.title)}</p>
          <Kv items={TABLES.withdrawFacts} />
        </Sheet>
      ) : null}
    </>
  );
}
