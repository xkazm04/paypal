// The deal page's "Who you're dealing with" view (rebuild WP3c; moved from deal/Columns.tsx
// WhoYouDealWith and its sheet): identity, how they get paid, history, the scam check, their note
// (quarantined exactly as NoteChip does: shown as theirs, never as instructions), and the wallet
// key one disclosure down.
import type { ReactNode } from 'react';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Deal } from '@bindings/Deal';
import { shortId } from '../../../../../lib/format';
import { DEAL_WHO, houseWords, shieldWord } from '../../../../../lib/words';
import { Chip, Disclosure, Kv } from '../../../../../shared/ui';
import { pairingFact } from '../../../logic';
import { NoteChip } from '../shared/NoteChip';

export type Cp = { name: string; house: boolean; known: boolean; entry?: CounterpartyDisplay };

const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function WhoView({ deal, cp, offersUsed }: { deal: Deal; cp: Cp; offersUsed: string | null }) {
  const pf = pairingFact(cp.entry);
  const sw = deal.shield ? shieldWord(deal.shield) : null;
  const row = (k: string, v: ReactNode) => <div className="dv-row"><span className="dv-k">{k}</span><span className="dv-v">{v}</span></div>;
  return (
    <div className="dv-panel dv-who">
      <header className="dv-ph">
        <h3 className="coral" title={houseWords(cp.name)}>{houseWords(cp.name)}</h3>
        <span className="dim">{cp.house ? DEAL_WHO.house : cp.known ? DEAL_WHO.known : DEAL_WHO.unknown}</span>
      </header>
      <div className="dv-rows">
        {row(DEAL_WHO.identity, <Chip tone={pf.tone} title={pf.why}>{pf.text}</Chip>)}
        {cp.entry?.declared_payee ? row(DEAL_WHO.paidAs, <span title={DEAL_WHO.paidAsTitle}>{houseWords(cp.entry.declared_payee)}</span>) : null}
        {cp.entry ? row(DEAL_WHO.since, DEAL_WHO.sinceLine(fmtDate(cp.entry.first_seen), cp.entry.deals_closed)) : null}
        {row(DEAL_WHO.scam, sw ? <Chip tone={sw.tone} title={sw.means}>{sw.text}</Chip> : <span className="dim">{DEAL_WHO.notRun}</span>)}
        {deal.kind === 'haggle' ? row(deal.side === 'buyer' ? DEAL_WHO.lowest : DEAL_WHO.highest, <span className="dim" title={DEAL_WHO.privateTitle}>{DEAL_WHO.private}</span>) : null}
        {offersUsed ? row(DEAL_WHO.offers, offersUsed) : null}
        {row(DEAL_WHO.note, <NoteChip dealId={deal.id} who={cp.name} title={DEAL_WHO.noteTitle(cp.name)} />)}
      </div>
      <p className="dv-p muted">{DEAL_WHO.identity}: {pf.why} {deal.shield ? DEAL_WHO.shield[deal.shield] : DEAL_WHO.shield.none}</p>
      <Disclosure summary={DEAL_WHO.details} className="dv-gap">
        <Kv items={[
          cp.entry ? [DEAL_WHO.earlier, String(cp.entry.deals_closed)] : null,
          [DEAL_WHO.walletKey, <span className="mono">{deal.counterparty}</span>],
          [DEAL_WHO.shortKey, <span className="mono">{shortId(deal.counterparty, 6, 3)}</span>],
        ]} />
      </Disclosure>
      <p className="ui-hint">{DEAL_WHO.theirWords}</p>
    </div>
  );
}
