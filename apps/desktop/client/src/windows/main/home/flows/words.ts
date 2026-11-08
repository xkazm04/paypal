// Words of the chat flows (spark chat-configure). Shared strings live in FLOW_WORDS; each package adds
// its flow's own strings in its own file (rulesWords.ts, settingsWords.ts, connectionsWords.ts,
// rewindWords.ts) so no two packages edit one file. Sentence case, the owner's words.
import type { FlowKind } from './store';

export const FLOW_WORDS = {
  title: { rules: 'Change your limits', settings: 'Change a setting', connections: 'Connections', rewind: 'Replay your days' } satisfies Record<FlowKind, string>,
  stepOf: (n: number, of: number): string => `Step ${n} of ${of}`,
  cancel: 'Cancel',
  cancelled: 'Left as it was. Nothing changed.',
  left: 'Left as it was.',
  chipsLabel: 'Change something, step by step',
  /** The chips the chat offers for each flow, in order. */
  chip: { rules: 'Change my limits', settings: 'Change a setting', connections: 'Connect a shop', rewind: 'Replay a day' } satisfies Record<FlowKind, string>,
} as const;
