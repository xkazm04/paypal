// "Join the house seller's table" / "Open a table" (approval window, privileged). Join: the house's
// practice table came from The Table in the hand-off draft (approval_handoff); the owner picks one
// of their own buyer rules and joins, which calls deal_join. Open: a seller picks a wallet they
// connected, one of their seller rules, the kind of thing, the item and the asking price, which
// calls deal_create (Rust signs and queues the listing). Neither moves money or calls PayPal; Rust
// re-checks the rules, the counterparty and the house's table. The deal then runs as any other.
// Join with a code: another owner's table shows a listing code; the buyer pastes it, sees the terms
// it decodes to, and joins with the seller's deal id (deal_join). The seller's signed listing must
// then match those terms in Rust, or the buyer's deal never gets an offer.
import { useState } from 'react';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Deal } from '@bindings/Deal';
import type { HouseTableDraft } from '@bindings/HouseTableDraft';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { WalletError } from '../../../lib/contract';
import { clockLabel, formatMoney, nowUnix } from '../../../lib/format';
import { APPROVAL_TABLE as W, houseWords, rulesName, RULES_CATEGORY } from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { Btn, Field, Hint, Kv, Seg, Sheet, useToast } from '../../../shared/ui';
import { parseMoneyInput } from '../model';
import { useSession } from '../session';
import { decodeListingCode, encodeListingCode } from '../listingCode';
import { buildListing, codeJoinArgs, codeProblem, houseJoinArgs, tableCategories, tableCounterparties, tableItems, tableMandates, type ListingDraft } from '../tableDraft';

export type TableSeed = { counterparty: string; house: HouseTableDraft | null } | null;

export function TableSheet({ seed, entries, counterparties, locked, onClose }: {
  /** The hand-off draft: the house's table to join, or a wallet to sell to; null = open, pick everything here. */
  seed: TableSeed; entries: readonly MandateListEntry[]; counterparties: readonly CounterpartyDisplay[]; locked: boolean; onClose: () => void;
}) {
  const s = useSession();
  const now = nowUnix();
  const house = seed?.house ?? null;
  const toast = useToast();
  /** Another owner's table: open one to sell, or join one with the seller's code. */
  const [mode, setMode] = useState<'sell' | 'code'>('sell');
  const byCode = !house && mode === 'code';
  const side = house || byCode ? 'buyer' : 'seller';
  const rules = tableMandates(entries, side, now);
  const sellTo = tableCounterparties(counterparties);
  const [pasted, setPasted] = useState('');
  const [d, setD] = useState<ListingDraft>(() => ({
    counterparty: seed && !house && sellTo.some((c) => c.key_id === seed.counterparty) ? seed.counterparty : sellTo[0]?.key_id ?? '',
    mandateId: rules[0]?.payload.id ?? '', category: '', item: '', qty: '1', price: '',
  }));
  const [error, setError] = useState<WalletError | null>(null);
  const [done, setDone] = useState<Deal | null>(null);
  /** The main window did not open: the sheet stays and says so. */
  const [followError, setFollowError] = useState<WalletError | null>(null);
  const busy = s.pending !== null || s.unlocking;
  // Switching between selling and buying changes which rules fit; the first fitting one stands in.
  const mandateId = rules.some((m) => m.payload.id === d.mandateId) ? d.mandateId : rules[0]?.payload.id ?? '';
  const picked = rules.find((m) => m.payload.id === mandateId) ?? null;
  const categories = picked ? tableCategories(picked) : [];
  const items = picked ? tableItems(picked) : [];
  // The first category and item the picked rules allow, unless the owner chose one.
  const draft: ListingDraft = { ...d, category: d.category || categories[0] || '', item: d.item || items[0] || '' };
  const built = house || byCode ? null : buildListing({ ...draft, mandateId }, rules, parseMoneyInput);
  const decoded = byCode && pasted.trim() ? decodeListingCode(pasted) : null;
  const ended = !!house && house.negotiation_deadline <= now;
  const ready = !!picked && (house ? !ended && !!seed : byCode ? !!decoded?.ok && !!d.counterparty : !!built?.ok);

  /** The seller's table shows its code once it is open; the buyer pastes it into their own sheet. */
  const shownCode = done && done.side === 'seller' && draft.category
    ? encodeListingCode({ dealId: done.id, terms: done.terms, category: draft.category }) : null;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(W.codeCopied, 'ok');
    } catch {
      toast(W.codeNoCopy, 'bad');
    }
  };

  const go = async () => {
    if (!ready || !picked) return;
    setError(null);
    const r = house && seed
      ? await s.call('deal_join', houseJoinArgs(house, seed.counterparty, picked), true)
      : byCode ? (decoded?.ok ? await s.call('deal_join', codeJoinArgs(decoded.table, d.counterparty, picked), true) : null)
      : built?.ok ? await s.call('deal_create', built.args, true) : null;
    if (!r) return;
    if (r.ok) setDone(r.value);
    else setError(r.error);
  };

  const follow = async (dealId: string) => {
    setFollowError(null);
    const r = await s.call('main_open', { deal_id: dealId });
    if (r.ok) onClose();
    else setFollowError(r.error);
  };

  if (done) {
    return (
      <Sheet title={house || byCode ? W.joined : W.opened} onClose={onClose} className="ow-lim-sheet ow-tbl"
        footer={<>
          <Btn className="left" onClick={onClose}>{W.close}</Btn>
          <Btn kind="primary" disabled={busy} onClick={() => void follow(done.id)}>{W.follow} ↗</Btn>
        </>}>
        <Kv items={[
          [W.item, done.terms.item_ref],
          [W.price, `${done.terms.qty} × ${formatMoney(done.terms.unit_price)}`],
          ...(house ? [[W.until, clockLabel(house.negotiation_deadline)] as [string, string]] : []),
        ]} />
        {shownCode ? (
          <>
            <p className="ow-p">{W.codeShown}</p>
            <div className="ow-lim-in">
              <Field className="mono" readOnly value={shownCode} spellCheck={false} aria-label={W.codeShown} onFocus={(e) => e.currentTarget.select()} />
              <Btn sm onClick={() => void copy(shownCode)}>{W.codeCopy}</Btn>
            </div>
            <Hint>{W.codeShownSub}</Hint>
          </>
        ) : null}
        <Hint>{W.doneSub}</Hint>
        {followError ? <WalletNotice error={followError} what={W.failFollow} /> : null}
      </Sheet>
    );
  }

  const ruleSelect = (
    <label className="ow-lim-f">
      <span>{W.rules}</span>
      <select className="ui-field" value={mandateId} onChange={(e) => setD({ ...d, mandateId: e.target.value, category: '', item: '' })}>
        {rules.length ? null : <option value="">{W.pickRules}</option>}
        {rules.map((m) => <option key={`${m.payload.id}:${m.payload.version}`} value={m.payload.id}>{rulesName(m.agent)}</option>)}
      </select>
    </label>
  );
  const footer = (
    <>
      <Btn className="left" onClick={onClose}>{W.notNow}</Btn>
      {locked ? (
        <Btn kind="gold" locked disabled={!s.tokenReady || busy} onClick={() => void s.unlock()}>{s.unlocking ? W.unlocking : W.unlock}</Btn>
      ) : (
        <Btn kind="gold" disabled={!s.tokenReady || busy || !ready} onClick={() => void go()}>
          {house || byCode ? (s.pending === 'deal_join' ? W.joining : W.join) : s.pending === 'deal_create' ? W.opening : W.open}
        </Btn>
      )}
    </>
  );
  return (
    <Sheet title={house ? W.joinTitle : byCode ? W.codeMode : W.openTitle} onClose={onClose} footer={footer} className="ow-lim-sheet ow-tbl">
      {house ? null : (
        <Seg label={W.section} value={mode} onChange={setMode} options={[{ value: 'sell', label: W.sellMode }, { value: 'code', label: W.codeMode }]} />
      )}
      <p className="ow-p">{house ? W.joinAbout : byCode ? W.codeAbout : W.openAbout}</p>
      {house ? (
        <>
          <Kv items={[
            [W.item, house.terms.item_ref],
            [W.price, `${house.terms.qty} × ${formatMoney(house.terms.unit_price)}`],
            [W.category, RULES_CATEGORY[house.category]],
            [W.until, clockLabel(house.negotiation_deadline)],
          ]} />
          <div className="ow-lim-form">{ruleSelect}</div>
          {ended ? <Hint>{W.ended}</Hint> : null}
          {rules.length ? null : <Hint>{W.noBuyRules}</Hint>}
        </>
      ) : byCode ? (
        <>
          <div className="ow-lim-form">
            <label className="ow-lim-f">
              <span>{W.codeWho}</span>
              <select className="ui-field" value={d.counterparty} onChange={(e) => setD({ ...d, counterparty: e.target.value })}>
                {sellTo.length ? null : <option value="">{W.noneToJoin}</option>}
                {sellTo.map((c) => <option key={c.key_id} value={c.key_id}>{houseWords(c.display_name)}</option>)}
              </select>
            </label>
            <label className="ow-lim-f">
              <span>{W.codeField}</span>
              <span className="ow-lim-in"><Field className="mono" value={pasted} placeholder={W.codePlaceholder} spellCheck={false} autoComplete="off" onChange={(e) => setPasted(e.target.value)} /></span>
            </label>
            {ruleSelect}
          </div>
          {decoded?.ok ? (
            <>
              <Kv items={[
                [W.item, decoded.table.terms.item_ref],
                [W.price, `${decoded.table.terms.qty} × ${formatMoney(decoded.table.terms.unit_price)}`],
                [W.category, RULES_CATEGORY[decoded.table.category]],
              ]} />
              <Hint>{W.codeCheck}</Hint>
            </>
          ) : decoded ? <Hint>{codeProblem(decoded.why)}</Hint> : null}
          {rules.length ? null : <Hint>{W.noBuyRules}</Hint>}
        </>
      ) : (
        <>
          <div className="ow-lim-form">
            <label className="ow-lim-f">
              <span>{W.who}</span>
              <select className="ui-field" value={d.counterparty} onChange={(e) => setD({ ...d, counterparty: e.target.value })}>
                {sellTo.length ? null : <option value="">{W.noneToSell}</option>}
                {sellTo.map((c) => <option key={c.key_id} value={c.key_id}>{houseWords(c.display_name)}</option>)}
              </select>
            </label>
            {ruleSelect}
            <label className="ow-lim-f">
              <span>{W.category}</span>
              <select className="ui-field" value={draft.category} onChange={(e) => setD({ ...d, category: e.target.value as ListingDraft['category'] })}>
                {categories.map((c) => <option key={c} value={c}>{RULES_CATEGORY[c]}</option>)}
              </select>
            </label>
            <label className="ow-lim-f">
              <span>{W.item}</span>
              <select className="ui-field mono" value={draft.item} onChange={(e) => setD({ ...d, item: e.target.value })}>
                {items.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label className="ow-lim-f">
              <span>{W.qty}</span>
              <span className="ow-lim-in"><Field className="num" inputMode="numeric" value={d.qty} onChange={(e) => setD({ ...d, qty: e.target.value })} /></span>
            </label>
            <label className="ow-lim-f">
              <span>{W.price}</span>
              <span className="ow-lim-in">
                <Field className="num" inputMode="decimal" value={d.price} placeholder="120.00" spellCheck={false} autoComplete="off" onChange={(e) => setD({ ...d, price: e.target.value })} />
                {picked ? <span className="dim">{picked.payload.clauses.find((c) => c.type === 'per_deal')?.max_amount.currency}</span> : null}
              </span>
            </label>
          </div>
          {rules.length ? null : <Hint>{W.noSellRules}</Hint>}
          {built && !built.ok && (d.price.trim() || !sellTo.length) ? <Hint>{built.problems[0]}</Hint> : null}
        </>
      )}
      {error ? <WalletNotice error={error} what={house || byCode ? W.failJoin : W.failOpen} message={error.code === 'REFUSED' ? W.refused : error.code === 'INVALID' ? W.invalid : undefined} /> : null}
    </Sheet>
  );
}
