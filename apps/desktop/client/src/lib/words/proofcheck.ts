// "Check this proof" (the proof checker that runs in the browser): its words. The names of the
// checks themselves are PROOF_CHECKS in lib/words.ts, keyed by the verifier's stable ids, so a line
// reads the same here, in the Book and in the wallet. Plain words, no internals.
import type { TamperId } from '../proof/tamper';

export const PROOF_CHECKER = {
  title: 'Check this proof',
  intro: 'A deal’s signed proof file, checked right here in your browser. Nothing is installed and the file is not sent anywhere.',
  sampleKicker: 'Practice deal',
  sample: 'A real signed file, made with the wallet’s own signing code and checked by the same rules the wallet uses.',
  checksHead: 'The checks',
  run: 'Check this proof',
  running: 'Checking…',
  rerun: 'Check the file again',
  progress: (made: number, total: number) => `${made} of ${total} checks made`,
  idle: 'Not checked yet',
  passed: 'Every check that applies passed',
  passedWhy: (dashed: number) => (dashed === 0
    ? 'Nothing in the file is unchecked.'
    : `${dashed === 1 ? 'One line is' : `${dashed} lines are`} dashed: the deal had nothing of that kind, or this page can’t make that check yet. A dashed line is never a pass.`),
  failed: 'This file does not check out',
  failedWhy: (n: number) => (n === 1 ? 'One check caught a problem.' : `${n} checks caught a problem.`),
  unmade: 'Not every check could be made',
  noSignatures: 'This browser can’t check signatures, so signature checks read “not checked”. A current version of your browser can.',
  first: 'First to catch it',
  caughtBy: 'Caught by',
  private: 'Checked in this page. Nothing is installed and the file is not sent anywhere.',
  tamperFirst: 'Check the file first, then break it.',
  caught: 'What it means',
  checkerSaid: 'The checker said',
  sr: { passed: 'passed', failed: 'did not pass', unchecked: 'not checked' },
  // the checks that read "not checked" for a reason other than the deal having nothing of the kind
  notYetBuilt: 'Not checked: this page can’t make this check yet.',
  noEd25519: 'Not checked: this browser can’t check signatures.',

  fileHead: 'The file',
  save: 'Save this file',
  open: 'Open another file',
  dropHint: 'Or drop a .tableproof file anywhere on this page.',
  dropNow: 'Drop the file to check it',
  readFailed: 'That file could not be read.',
  sizeOf: (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`),

  tamperHead: 'Try to break it',
  tamperIntro: 'Change one thing in the file, then see which checks notice.',
  changed: 'You changed',
  undo: 'Put the file back',
  editedByHand: 'the file, by hand',
  edit: 'Edit the file yourself',
  editLabel: 'The proof file, as text',
  editHint: 'The keys, hashes and signatures are shown as hex so the file fits on a screen. Change anything, then check it.',
  jump: 'Go to',
  jumpTo: { price: 'the price', payee: 'the payee', paypal: 'PayPal’s amount', line: 'a line of the record', signature: 'a signature' },
  checkEdited: 'Check the edited file',
  notJson: 'That isn’t valid JSON, so it isn’t a proof file.',

  keyHead: 'Owner key',
  keyByEye: 'To compare by eye',
  keyAnchor: 'The checks trust the keys inside the file. Compare this owner key with the key the owner shows you, in a channel you trust.',
  keyCopy: 'Copy the key',
  keyCopied: 'Copied',

  limitsHead: 'What this can’t show',
  limits: [
    'Whether newer records were removed from the end of the wallet’s record.',
    'Whether the owner key belongs to who you think. That’s for you to compare.',
    'Anything on a dashed line. It is never a pass.',
  ],

  // the deal page's card
  card: {
    key: 'The signed proof',
    value: 'Check it yourself',
    why: 'Open this deal’s signed file in your browser, and try to break it.',
    none: 'Only one deal here has one',
    noneWhy: (label: string) => `This preview signs one practice deal, ${label}, the monitor Maya’s shop sold. Open it to check its proof.`,
    open: (label: string) => `Open ${label}`,
  },
  // the page of its own
  page: {
    title: 'Check a proof',
    lede: 'Drop a deal’s .tableproof file here, or use the practice deal, and see whether it holds. Then break it.',
    use: 'Use the practice deal',
    back: 'The Table, in the browser',
  },
} as const;

/** The checks by a short name, for the strip that says which ones caught a change. */
export const PROOF_SHORT: Readonly<Record<string, string>> = {
  format: 'The file', mandate: 'Owner’s rules', transcript: 'Messages', countersign: 'Approvals', authority: 'Authority', paypal_order: 'PayPal’s order', audit: 'The record',
  receipt: 'Receipt', owner_saw: 'Owner’s checklist', one_request: 'One request', group: 'Shopping around', shield: 'Safety check', house_record: 'House record',
  permissions: 'Permissions', market: 'Market price', evidence: 'The seal',
};

/** What a red line means, by check id: the plain claim that no longer holds. */
export const PROOF_CAUGHT: Readonly<Record<string, string>> = {
  format: 'The file does not read as the kind of proof file it says it is.',
  mandate: 'The owner’s signature no longer matches the rules, or the key that signed them is not the one the file names.',
  transcript: 'A message was changed, moved or left out: the signatures, or the chain that links each message to the one before, no longer hold.',
  countersign: 'An approval no longer matches the deal: it names a different price, payee or set of rules than the file now shows.',
  authority: 'A money step has no valid authority behind it: no owner decision, no signed rule, and it was not a safe default.',
  paypal_order: 'PayPal’s order disagrees with the deal: the price, payee or invoice no longer matches what was signed.',
  audit: 'A line in the record of what happened was changed, or no longer links to the line before it.',
  receipt: 'The receipt does not match the signed message, or the price the deal agreed.',
  owner_saw: 'A payment the owner approved has no earlier record of the checklist the owner saw.',
  one_request: 'A payment was sent to PayPal under a second request, which could have paid twice.',
  group: 'More than one seller’s deal was agreed, or the others were not called off.',
  shield: 'Money moved while a safety check had paused or blocked the deal.',
  house_record: 'The house seller’s signed record got shorter, or was rewritten.',
  permissions: 'The file does not say which permissions it was saved under.',
  market: 'The market prices kept with the deal no longer give the typical price it was agreed on.',
  evidence: 'The deal’s agent signed the whole file when it was saved, so any change at all breaks that seal. It says something changed, not what; the lines above say what.',
};

/** The tamper buttons: what the person does, in their words. */
export const TAMPER_WORDS: Readonly<Record<TamperId, { label: string; what: string }>> = {
  price: { label: 'Raise the price', what: 'the price in the deal’s terms' },
  'paypal-amount': { label: 'Change PayPal’s amount', what: 'the amount in PayPal’s order' },
  payee: { label: 'Pay someone else', what: 'who the approval pays' },
  receipt: { label: 'Change the receipt', what: 'the amount on the receipt' },
  'audit-line': { label: 'Rewrite a line of the record', what: 'one line of the record of what happened' },
  'audit-gap': { label: 'Delete an approval record', what: 'the record of the checklist the owner saw before capturing' },
  signature: { label: 'Damage a signature', what: 'one character of one message’s signature' },
  refund: { label: 'Slip in a refund', what: 'a PayPal call that no one authorized' },
  rules: { label: 'Loosen the rules after the fact', what: 'the price limit in the owner’s signed rules' },
  relabel: { label: 'Call it an older file', what: 'the kind of file it says it is' },
  'owner-key': { label: 'Swap the owner key', what: 'the owner key the checks are anchored to' },
};
/** The tampers offered on screen, in order. */
export const TAMPERS_SHOWN: readonly TamperId[] = ['price', 'paypal-amount', 'payee', 'receipt', 'audit-line', 'audit-gap', 'signature', 'refund', 'rules', 'owner-key'];
