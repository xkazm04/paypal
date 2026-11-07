// STUB (spark chat-configure WP0): the owning package replaces this body; the signature is the contract.
import { FlowCard } from './FlowCard';
import type { FlowTurn } from './store';

export function RewindFlow({ turn }: { turn: FlowTurn }) {
  return <FlowCard turn={turn}><p>{turn.step}</p></FlowCard>;
}
