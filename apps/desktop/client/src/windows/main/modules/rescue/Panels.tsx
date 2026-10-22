// Round 2 pieces of the Rescue page (experiment r2-rescue): what the subscriber would get for each
// fix, and a Why? on each fix. Display only: nothing here sends a fix, creates an
// invoice or moves money. Facts and wording: ./preview.ts. Styles: rescue.css (.rs-get, .rs-fix).
import { RESCUE } from '../../../../lib/words';
import { Icon, Why, type IconName } from '../../../../shared/ui';
import type { Preview, PreviewChannel } from './preview';

// ---- what the subscriber would get ---------------------------------------------------------------------------

const CHANNEL_ICON: Record<PreviewChannel, IconName> = { invoice: 'rules', email: 'chat', retry: 'renew' };

/** A small mock of the invoice line or email subject. An amount that is not chosen yet is dashed. */
export function FixGet({ preview }: { preview: Preview }) {
  return (
    <div className={`rs-get ${preview.channel}`} role="group" aria-label={RESCUE.get.label}>
      <div className="mock">
        <span className="ch"><Icon name={CHANNEL_ICON[preview.channel]} size={12} />{RESCUE.get.kind(preview.kind)}</span>
        <span className="ln">{preview.line}</span>
        {preview.amount ? <span className="amw">{preview.amount.label ? <span className="al">{preview.amount.label}</span> : null}<span className={`am ${preview.amount.unknown ? 'unk' : ''}`}>{preview.amount.text}</span></span> : null}
        {preview.note ? <span className="nt">{preview.note}</span> : null}
      </div>
    </div>
  );
}

/** A switched-off fix has nothing to preview: a dashed placeholder keeps the cards the same height. */
export function FixGetOff() {
  return (
    <div className="rs-get off" role="group" aria-label={RESCUE.get.label}>
      <div className="mock"><span className="ch">{RESCUE.get.theyGet}</span><span className="ln">{RESCUE.get.nothing}</span></div>
    </div>
  );
}

/** "Why?" behind a fix: two sentences from the lever list and facts on the card. */
export function FixWhy({ question, lines }: { question: string; lines: readonly [string, string] }) {
  return <Why question={question}><p>{lines[0]}</p><p>{lines[1]}</p></Why>;
}
