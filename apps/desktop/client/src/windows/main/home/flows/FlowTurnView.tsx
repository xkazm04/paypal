// Renders one flow turn with its flow's component (the transcript calls this, nothing else).
import { ConnectionsFlow } from './ConnectionsFlow';
import { RewindFlow } from './RewindFlow';
import { RulesFlow } from './RulesFlow';
import { SettingsFlow } from './SettingsFlow';
import type { FlowTurn } from './store';
import './flows.css';

export function FlowTurnView({ turn }: { turn: FlowTurn }) {
  switch (turn.kind) {
    case 'rules': return <RulesFlow turn={turn} />;
    case 'settings': return <SettingsFlow turn={turn} />;
    case 'connections': return <ConnectionsFlow turn={turn} />;
    case 'rewind': return <RewindFlow turn={turn} />;
  }
}
