// Words for demo mode (polish wave, builder B): the footer's sample-data switcher, its badge, the
// switching overlay, the sample approval's strip, the fallback note and Find's "Demo: ..." entries. Re-exported from
// lib/words.ts by one `export *` line; imports nothing from it. Rules (docs/ux/UX-GUIDE.md): Maya's
// words, sentence case, no internals (no window labels, storage keys, file or command names), PayPal
// the only vendor name, and every demo surface says plainly that nothing is paid.

/** The sample worlds, as the owner reads them (lib/preview.ts DemoWorld). */
export const DEMO_WORLD = {
  small: { name: 'Small shop', sub: 'one person, a few deals a week' },
  large: { name: 'Busy merchant', sub: 'hundreds of deals, many of them waiting' },
  first_run: { name: 'First run', sub: 'a brand-new wallet, nothing set up yet' },
  sample: { name: 'Sample week', sub: 'Maya’s week, the guided sample' },
} as const;

export const DEMO_LIVE = { name: 'Live wallet', sub: 'your own wallet and your own deals' } as const;

/** The persistent footer badge while the desktop app shows sample data. */
export const DEMO_BADGE = 'Demo · sample data · nothing is paid';
export const DEMO_BADGE_TITLE = 'You are looking at sample data. Nothing here reaches PayPal, your saved keys or your real deals.';

/** The switcher (footer chip + popover). */
export const DEMO_SWITCH = {
  group: 'Sample data',
  live: 'Demo',
  chipTitle: 'Look around the wallet on sample data. Nothing in a sample reaches PayPal.',
  title: 'Look around on sample data',
  sub: 'A sample wallet runs right here, on this computer. Nothing in it reaches PayPal, your saved keys or your real deals.',
  browser: 'This preview always runs on sample data.',
  worlds: 'Samples',
  current: 'shown now',
  more: 'More',
  unavailable: 'Sample data isn’t part of this version of the app. Your live wallet is unchanged.',
  miniWindow: 'The small window and the approval window keep showing your live wallet.',
  notStored: 'That choice couldn’t be saved, so nothing changed.',
  exit: 'Exit demo',
  exitTitle: 'Back to your live wallet',
} as const;

export const DEMO_DEGRADED = { name: 'Older app version', sub: 'some details can’t be read, as on an older wallet' } as const;
export const DEMO_LOCKED = { name: 'Locked', sub: 'as the wallet looks after you step away' } as const;

export const DEMO_RESET = {
  name: 'Reset sample data',
  sub: (world: string): string => `Starts the ${world.toLowerCase()} sample over. Other samples stay as they are.`,
  ask: (world: string): string => `Start the ${world.toLowerCase()} sample over? What you did in it is cleared.`,
  yes: 'Start over',
  no: 'Keep it',
} as const;

/** The calm overlay shown for the moment the window reloads into the new choice. */
export const demoSwitching = (world: string | null): string => (world === null ? 'Back to your live wallet' : `Switching to the ${world.toLowerCase()} sample`);
export const DEMO_SWITCHING_SUB = 'Nothing is paid and nothing changes in your live wallet.';

/** The sample approval page (the main window's own view in demo mode). */
export const DEMO_APPROVAL = {
  strip: 'Demo approval · simulated · nothing is paid',
  title: 'This approval runs on sample data. Back to The Table or Esc returns where you were.',
} as const;

/** The one-time note after the sample data could not open and the window went back to live. */
export const DEMO_FALLBACK_NOTE = 'The sample data couldn’t open, so this is your live wallet. Nothing in it changed.';

/** Find's entries (the switcher's choices, prefixed so a search for "demo" lists them all). */
export const DEMO_FIND = {
  title: (what: string): string => `Demo: ${what}`,
  world: (sub: string): string => `sample data · ${sub}`,
  live: 'leave the sample data · your own wallet',
  degraded: 'sample data · as on an older wallet version',
  locked: 'sample data · as the wallet looks after you step away',
} as const;
