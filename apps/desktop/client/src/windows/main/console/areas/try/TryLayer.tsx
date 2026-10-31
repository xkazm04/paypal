// Area: try. "Try to break it": Break The Table hosted as a place of the console (#p=try), beside the
// safety record. The component is the arena page's own (src/arena/BreakTheTable.tsx); here it only gets
// its one move out, to the safety record, through LayerNav. It plays the wallet's recorded answers: it
// calls no command that moves money (console/guard.test.ts reads this file too).
import { BreakTheTable } from '../../../../../arena/BreakTheTable';
import type { LayerProps } from '../../layers';

export function TryLayer({ nav }: LayerProps) {
  return <BreakTheTable host="console" onOpenSafety={() => nav.place('safety')} />;
}
