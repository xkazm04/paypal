// The Book layer (rebuild WP3b): every payment, and plain-language questions about them. The
// summary is one answer ("This week: $X paid out, $Y paid in."), what is held or being checked
// apart from it, and four cards: the week's money (the ledger), the outlook (what waits on a
// deadline), the record (every step, newest first) and Ask your book. One level down: the ledger
// (totals and every deal; "Recent payments" is the same list, newest first), the outlook, the
// record, the questions and the proof check. Book only reads: nothing here can move money.
import { useMemo, useState, type ReactNode } from 'react';
import { useAttention, useNeeds } from '../../../world';
import { BOOK, BOOK_VIEWS_TITLE, LATEST_OF, OPEN_THE_DEAL } from '../../../../../lib/words';
import { Btn } from '../../../../../shared/ui';
import { WalletNotice } from '../../../../../shared/honesty';
import { silenceParts } from '../../../home/model';
import { Loading } from '../../../ui';
import { useModuleRoute } from '../../../viewNav';
import type { LayerProps } from '../../layers';
import { MAX_ROWS, type LatestProps } from '../../Latest';
import { ModuleLayer, type ModuleViewDef } from '../../ModuleLayer';
import { Ask } from './Ask';
import { Ledger, LedgerActions, LedgerRow, type LedgerScope } from './Ledger';
import { dealsIn, figures, outlookCount, stampOf } from './model';
import { Outlook, useOutlook } from './Outlook';
import { moneyList, useBookWorld, type BookWorld } from './parts';
import { Proof } from './Proof';
import { Record } from './Record';
import { paidTodayText, usePaidToday } from './today';

/** The answer line and the line under it, from the week's figures alone. */
function answerOf(b: BookWorld): { answer: string; sub: string | null } {
  const f = figures(b.weekDeals, b.checking);
  const out = moneyList(f.paidOut);
  const inn = moneyList(f.paidIn);
  if (!b.all.length) return { answer: BOOK.answer.nothing, sub: BOOK.answer.nothingSub };
  const answer = out && inn ? BOOK.answer.both(out, inn) : out ? BOOK.answer.out(out) : inn ? BOOK.answer.in(inn) : BOOK.answer.none;
  const held = BOOK.answer.held(moneyList(f.heldOut), moneyList(f.heldIn));
  const bits = [held, f.checking ? BOOK.checkingLine(f.checking) : null, f.nStopped ? BOOK.answer.stopped(f.nStopped) : null].filter((x): x is string => !!x);
  return { answer, sub: bits.length ? bits.join(' ') : null };
}

export function BookLayer({ nav }: LayerProps) {
  const b = useBookWorld();
  const route = useModuleRoute();
  const att = useAttention().data;
  const needs = useNeeds();
  const items = useOutlook(b);
  const [scope, setScope] = useState<LedgerScope>('week');

  // The Book's "paid out today" is the footer meter's own reading (one function, one set: paid buyer
  // deals of the wallet's day, never a hold; scale finding #9).
  const today = usePaidToday(att?.exposure, b.all, needs);
  const f = useMemo(() => figures(b.weekDeals, b.checking), [b.weekDeals, b.checking]);
  const waiting = outlookCount(items);
  const firstNeed = items.flatMap((it) => it.deals).map((d) => b.needOf.get(d.id)).find((n) => !!n);
  const views = useViews(b, scope, setScope, items, route.open);

  if (!b.loaded) {
    return (
      <ModuleLayer module="book" answer={BOOK.title} yourCall={null}>
        {b.error ? <WalletNotice error={b.error} what={BOOK.ledgerWhat} /> : <Loading what={BOOK.loading} />}
      </ModuleLayer>
    );
  }
  const { answer, sub } = answerOf(b);
  const out = moneyList(f.paidOut);
  const todayLine = today ? BOOK.cards.today(paidTodayText(today, BOOK.cards.nothingToday)) : null;
  // Latest: the week's payments, newest first (the ledger's own row, without its statement read).
  const pool = b.weekDeals.length ? b.weekDeals : b.all;
  const newest = [...pool].sort((x, y) => (stampOf(y) ?? 0) - (stampOf(x) ?? 0)).slice(0, MAX_ROWS);
  const latest: LatestProps = {
    title: LATEST_OF.book, total: pool.length,
    rows: newest.map((d) => ({ key: d.id, label: `${b.title(d)}, ${OPEN_THE_DEAL}`, onOpen: () => nav.deal(d.id), node: <LedgerRow deal={d} b={b} statement={false} /> })),
    seeAll: { onOpen: () => route.open('recent') },
  };
  return (
    <div className="ar-book">
      <ModuleLayer module="book" answer={answer} sub={sub} latest={latest}
        action={<Btn sm onClick={() => nav.place('safety')} title={BOOK.safetyTitle} data-fk="safety">{BOOK.safety}</Btn>}
        cards={[
          { id: 'ledger', view: 'ledger', label: BOOK.cards.money, value: out ? BOOK.cards.paidOut(out) : BOOK.cards.noOut,
            note: [todayLine, moneyList(f.paidIn) ? BOOK.cards.paidIn(moneyList(f.paidIn)) : BOOK.payments(f.nOut)].filter(Boolean).join(' · ') },
          { id: 'outlook', view: 'outlook', label: BOOK.cards.outlook, value: waiting ? BOOK.cards.waits(waiting) : BOOK.cards.nothingWaits,
            note: waiting ? BOOK.cards.outlookNote(moneyList(f.heldOut)) : BOOK.cards.outlookNone, chip: waiting ? BOOK.cards.check : undefined, chipTone: 'gold',
            ifNothing: firstNeed ? silenceParts(firstNeed.on_silence).head : null },
          { id: 'record', view: 'record', label: BOOK.cards.record, value: BOOK.cards.recordValue, note: BOOK.cards.recordNote },
          { id: 'ask', view: 'ask', label: BOOK.cards.ask, value: BOOK.cards.askValue, note: BOOK.cards.askNote },
        ]}
        explain={{ summary: BOOK.how.title, body: <ul className="bk-how">{BOOK.how.items.map((x) => <li key={x.title}><b>{x.title}.</b> {x.text}</li>)}</ul> }}
        views={views} />
    </div>
  );
}

function useViews(b: BookWorld, scope: LedgerScope, setScope: (s: LedgerScope) => void, items: ReturnType<typeof useOutlook>, open: (v: string | null, card?: string) => void): Record<string, ModuleViewDef> {
  const toProof = () => open('proof');
  const ledgerSub = (s: LedgerScope): ReactNode => (s === 'week' ? BOOK.ledgerSubWeek(dealsIn(b.all, b.week).length) : BOOK.ledgerSubAll(b.all.length));
  return {
    ledger: { title: BOOK_VIEWS_TITLE.ledger, sub: ledgerSub(scope), actions: <LedgerActions b={b} scope={scope} onScope={setScope} onProof={toProof} />, render: () => <Ledger b={b} scope={scope} /> },
    recent: { title: BOOK_VIEWS_TITLE.recent, sub: BOOK.recentSub, actions: <LedgerActions b={b} scope={scope} onScope={setScope} onProof={toProof} />, render: () => <Ledger b={b} scope={scope} /> },
    outlook: { title: BOOK_VIEWS_TITLE.outlook, sub: BOOK.outlookSub, render: () => <Outlook b={b} items={items} /> },
    record: { title: BOOK_VIEWS_TITLE.record, sub: BOOK.record.sub, actions: <Btn sm onClick={toProof} title={BOOK.proofTitle}>{BOOK.proofOpen}</Btn>, render: () => <Record b={b} /> },
    ask: { title: BOOK_VIEWS_TITLE.ask, sub: BOOK.ask.sub, render: () => <Ask b={b} /> },
    proof: { title: BOOK_VIEWS_TITLE.proof, sub: BOOK.proof.sub, render: () => <Proof /> },
  };
}
