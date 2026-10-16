// "note ›": the counterparty's own words, behind a chip. Their text is untrusted: it is shown only
// through <Quarantine> (plain text, never markdown or links, never instructions to an agent).
// The words come from `counterparty_note` (main window only): the latest NOTE the counterparty
// signed on this deal, verified with the transcript and length-capped in Rust, never parsed. It is
// read only when the owner opens the chip. Shared by the deal page and the Shield (moved here from
// modules/shield/ in rebuild WP4a, words in lib/words/framework.ts NOTE_CHIP, unchanged).
import { useState } from 'react';
import { clockLabel } from '../../../../../lib/format';
import { useQuery } from '../../../../../lib/hooks';
import { NOTE_CHIP } from '../../../../../lib/words';
import { Quarantine, WalletNotice } from '../../../../../shared/honesty';
import { Chip, Loading, Popover } from '../../../../../shared/ui';

export function NoteChip({ dealId, who, title }: { dealId: string; who: string; title?: string }) {
  const [a, setA] = useState<HTMLElement | null>(null);
  return (
    <>
      <Chip tone="dashed" className="notechip" title={NOTE_CHIP.chipTitle}
        onClick={(e) => { const t = e.currentTarget; setA((x) => (x ? null : t)); }}>
        {NOTE_CHIP.chip}
      </Chip>
      {a ? (
        <Popover anchor={a} onClose={() => setA(null)} title={title ?? NOTE_CHIP.title(who)}>
          <NoteText dealId={dealId} from={who} />
        </Popover>
      ) : null}
    </>
  );
}

/** The quarantined read itself, for a popover or a section. Mounted only when the owner asks. */
export function NoteText({ dealId, from }: { dealId: string; from: string }) {
  const q = useQuery('counterparty_note', { deal_id: dealId }, { refreshOn: ['deal:changed'] });
  if (q.error) return <WalletNotice error={q.error} what={NOTE_CHIP.what} />;
  if (q.data === undefined) return <Loading what={NOTE_CHIP.reading} />;
  if (q.data === null) return <p className="ui-hint">{NOTE_CHIP.none(from)}</p>;
  return (
    <>
      <Quarantine text={q.data.text} label={NOTE_CHIP.from(from)} />
      <p className="ui-hint">{NOTE_CHIP.sent(clockLabel(q.data.at))}</p>
    </>
  );
}
