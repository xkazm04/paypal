// "note ›": the counterparty's own words, behind a chip. Their text is untrusted: it is shown only
// through <Quarantine> (plain text, never markdown or links, never instructions to an agent).
// The words come from `counterparty_note` (main window only): the latest NOTE the counterparty
// signed on this deal, verified with the transcript and length-capped in Rust, never parsed. It is
// read only when the owner opens the chip. Shared by the Tables, Spend, Shield, Counter and Deal pages.
import { useState } from 'react';
import { clockLabel } from '../../../../lib/format';
import { useQuery } from '../../../../lib/hooks';
import { Quarantine, WalletNotice } from '../../../../shared/honesty';
import { Chip, Loading, Popover } from '../../../../shared/ui';

export function NoteChip({ dealId, who, title }: { dealId: string; who: string; title?: string }) {
  const [a, setA] = useState<HTMLElement | null>(null);
  return (
    <>
      <Chip tone="dashed" className="notechip" title="Their latest note, shown as plain text. Your agents never act on it."
        onClick={(e) => { const t = e.currentTarget; setA((x) => (x ? null : t)); }}>
        note ›
      </Chip>
      {a ? (
        <Popover anchor={a} onClose={() => setA(null)} title={title ?? `Their words · ${who}`}>
          <NoteText dealId={dealId} from={who} />
        </Popover>
      ) : null}
    </>
  );
}

/** The quarantined read itself, for a popover or a section. Mounted only when the owner asks. */
export function NoteText({ dealId, from }: { dealId: string; from: string }) {
  const q = useQuery('counterparty_note', { deal_id: dealId }, { refreshOn: ['deal:changed'] });
  if (q.error) return <WalletNotice error={q.error} what="Their note" />;
  if (q.data === undefined) return <Loading what="their note" />;
  if (q.data === null) return <p className="ui-hint">{from} has sent no note on this deal.</p>;
  return (
    <>
      <Quarantine text={q.data.text} label={`From ${from}, unchecked`} />
      <p className="ui-hint">Sent {clockLabel(q.data.at)}. Shown exactly as written, with no links. Your agents never act on it.</p>
    </>
  );
}
