// One PayPal tick's mark (moved from Rewind.tsx by rebuild WP3c): a bar coloured by who decided
// (you gold, a rule you signed teal, the buyer's approval green, the safe default grey), or an x
// for a refusal. The Rewind's tape and the deal page's "Who decided" share it.
import type { TickTone } from '../../../logic';

export function TickMark({ tone }: { tone: TickTone }) {
  return <i className={`rw-mark t-${tone}`} aria-hidden="true">{tone === 'refused' ? '×' : null}</i>;
}
