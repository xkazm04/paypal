// Words of the Settings flow (spark chat-configure): one question per card, the owner's words.
export const SETTINGS_FLOW = {
  locked: 'Your wallet is locked. Unlock it to change a setting.',
  topic: {
    ask: 'What would you like to change?',
    look: 'How it looks',
    alerts: 'Alerts',
    pause: 'Pause or resume agents',
    sum: { look: 'Changing how it looks', alerts: 'Changing alerts', pause: 'Changing the agents' },
  },
  theme: {
    ask: 'Which theme?',
    dark: 'Dark',
    light: 'Light',
    sum: (v: string): string => `Theme: ${v}`,
  },
  calm: {
    ask: 'Calm motion?',
    on: 'Calm motion on',
    off: 'Calm motion off',
    sum: (v: string): string => `${v}`,
  },
  alerts: {
    ask: 'Which notices should reach you?',
    all: 'Tell me when something needs me',
    dnd: 'Do not disturb',
    none: 'No Windows notices',
    sum: (v: string): string => `Alerts: ${v}`,
    unread: 'Your notification settings cannot be read right now. Nothing changed.',
  },
  pause: {
    working: 'Your agents are working. Pausing stops them taking new steps; deadlines still run.',
    paused: 'Your agents are paused. Resuming lets them work again inside your rules.',
    doPause: 'Pause all agents',
    doResume: 'Resume all agents',
    sum: { pause: 'Pause all agents', resume: 'Resume all agents' },
  },
  confirm: {
    ask: (what: string): string => `You are about to apply: ${what}.`,
    apply: 'Apply',
  },
  failed: 'That did not apply. Nothing changed.',
  done: {
    applied: (what: string): string => `Applied: ${what}.`,
    undo: 'Undo',
    undone: 'Undone. Back as it was.',
    closed: (what: string): string => `Changed: ${what}`,
  },
  pausedTitle: 'Agents paused',
  resumedTitle: 'Agents resumed',
} as const;
export const UNDO_MS = 8000;
