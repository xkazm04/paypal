// BROWSER PREVIEW ONLY. The wire across the top of the table: the attacker, the wallet's rules, PayPal.
// A played attack's pulse runs from the attacker into the rules and stops there; the line to PayPal
// lights only for the requests the record says reached it (none, in every recorded attack), so the
// picture can never claim more than the record does.
import { ARENA_WIRE, RULE_NAME } from '../lib/words/arena';
import { verdictOf, type Verdict } from './model';
import { isRefusal, type RecordedAttack } from './record';

export type WirePhase = 'idle' | 'travel' | 'hit';

const WALL_WORDS: Record<Verdict, string> = { refused: ARENA_WIRE.stopped, turnedAway: ARENA_WIRE.stopped, kept: ARENA_WIRE.kept, counted: ARENA_WIRE.counted };

export function Wire({ attack, phase, n }: { attack: RecordedAttack | null; phase: WirePhase; n: number }) {
  const v = attack ? verdictOf(attack) : null;
  const reached = attack ? attack.paypal_requests : 0;
  const code = attack && isRefusal(attack.answer) ? attack.answer.code : null;
  return (
    <div key={n} className={`ar-wire p-${phase}${attack ? ` s-${attack.suit}` : ''}${v ? ` v-${v}` : ''}${reached ? ' reached' : ''}`} role="img"
      aria-label={attack ? `${ARENA_WIRE.label}: ${WALL_WORDS[v ?? 'refused']}, ${ARENA_WIRE.paypal} ${ARENA_WIRE.requests(reached)}` : `${ARENA_WIRE.label}: ${ARENA_WIRE.idle}`}>
      <div className="ar-node from">
        <span className="ar-node-dot" />
        <span className="ar-node-l">{attack?.suit === 'counterparty' ? ARENA_WIRE.seller : ARENA_WIRE.agent}</span>
      </div>
      <div className="ar-seg a"><span className="ar-pulse" /></div>
      <div className="ar-node wall">
        <span className="ar-wall" />
        <span className="ar-node-l">{ARENA_WIRE.wall}</span>
        <span className="ar-wall-v">{attack && phase === 'hit' ? (code ? RULE_NAME[code] ?? WALL_WORDS[v ?? 'refused'] : WALL_WORDS[v ?? 'refused']) : ' '}</span>
      </div>
      <div className="ar-seg b"><span className="ar-seg-l num">{ARENA_WIRE.requests(reached)}</span></div>
      <div className="ar-node paypal">
        <span className="ar-node-dot" />
        <span className="ar-node-l">{ARENA_WIRE.paypal}</span>
      </div>
    </div>
  );
}
