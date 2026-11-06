// The secure step's words, host side (the sheet and the desktop app's waiting card).
import type { SecureKind } from './contract';

export const SC = {
  lock: 'Secure step',
  lockWhere: 'runs in the approval window’s context',
  loading: 'Opening the secure step…',
  sheetTitle: { keys: 'Add your PayPal sandbox keys', rules: 'Sign your agents’ rules', pairing: 'Confirm the practice shop' } satisfies Record<SecureKind, string>,
  close: 'Close',
  closeEsc: 'Close (Esc)',
  // the desktop app: the step runs in the approval window
  open: { keys: 'Add keys in a secure window', rules: 'Review and sign in a secure window', pairing: 'Check the words in a secure window' } satisfies Record<SecureKind, string>,
  openWhy: 'Keys, signatures and connections are only ever handled by the approval window, never by this page.',
  waiting: 'Finish in the secure window',
  waitingSub: 'This turns into a tick when the wallet confirms it.',
  focus: 'Bring it to front',
  // done
  done: { keys: 'PayPal sandbox keys saved', rules: 'Rules signed with your owner key', pairing: 'Practice shop connected' } satisfies Record<SecureKind, string>,
  doneSub: { keys: 'Kept in your computer’s credential store, never in the app’s pages.', rules: 'Your agents follow them from their next request.', pairing: 'Its offers can reach your agents, within your rules.' } satisfies Record<SecureKind, string>,
  frameTitle: (k: SecureKind) => `Secure step: ${SC_KIND[k]}`,
} as const;

const SC_KIND: Record<SecureKind, string> = { keys: 'PayPal sandbox keys', rules: 'sign your rules', pairing: 'confirm the four words' };
