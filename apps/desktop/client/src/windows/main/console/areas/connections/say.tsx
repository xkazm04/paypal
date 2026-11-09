// One explanation behind the info button (shared/ui/Hint.tsx): the short line stays, the full text
// is one press away.
import type { ReactNode } from 'react';
import { ExplainHint } from '../../../../../shared/ui';

export function explained(full: ReactNode, line: ReactNode, label: string, body: ReactNode = full): ReactNode {
  return <ExplainHint label={label} line={line}>{body}</ExplainHint>;
}
