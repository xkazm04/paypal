// spark abstract-first-home round 1, variant "brief": the prototype's own words. Shared words (module
// names, step titles, engine words, standing answers) are imported where they are used; only what
// this front door says for itself lives here.
export const FB = {
  mainLabel: 'Your brief',
  reading: 'Reading your wallet…',
  // ---- the headline: one line, status first ----
  headline: {
    broken: 'Your safety record is broken. Look at it before anything else.',
    needs: (n: number, soonest: string | null): string => `${n === 1 ? 'One thing needs' : `${n} things need`} you${soonest ? `, the first by ${soonest}` : ''}.`,
    calm: 'Nothing needs you.',
    safe: 'Your money is safe.',
    firstRun: 'Nothing is set up yet.',
    firstRunTail: 'Try it first: nothing real moves until you sign.',
    allSet: 'Set up and quiet.',
  },
  // ---- the items ----
  rankLabel: (i: number): string => `${i + 1}`,
  open: 'Show detail',
  close: 'Hide detail',
  need: {
    kicker: 'First need',
    more: (n: number): string => `and ${n} more waiting`,
    seeAll: (n: number): string => `See all ${n}`,
  },
  risk: {
    kicker: 'If you do nothing',
    brokenKicker: 'Safety record',
  },
  away: {
    kicker: 'While you were away',
    gotIt: 'Got it',
    more: (n: number): string => `${n} more`,
    partial: 'Only the most recent part of the record was read.',
  },
  answer: {
    kicker: 'Answer',
    thinking: 'Thinking…',
    nothing: 'The assistant had nothing to say to that.',
    dropped: (n: number): string => `${n} ${n === 1 ? 'part' : 'parts'} of the answer could not be shown.`,
    fellBack: 'The live assistant did not answer; the preview assistant did.',
    dismiss: 'Dismiss the answer',
    shown: 'Shown below',
    actNote: 'This one changes the wallet. Do it from the board, where its consent box and undo live.',
  },
  panel: { kicker: 'Detail', remove: 'Remove from the brief' },
  // ---- the ask line ----
  ask: { placeholder: 'Ask about anything', label: 'Ask about anything', send: 'Ask', stop: 'Stop' },
  // ---- the module dock ----
  dock: {
    label: 'Modules',
    all: 'Everything',
    allTitle: 'Open the full console',
    needs: (n: number): string => `${n} need${n === 1 ? 's' : ''} you`,
    peekLead: (long: string): string => long,
    moving: 'Moving',
    stopped: 'Stopped',
    needsWord: 'Needs you',
    paid: 'Paid',
    quiet: 'Nothing here yet.',
    open: (name: string): string => `Open ${name}`,
    lit: 'Pointed out by the answer',
  },
  // ---- getting started: try first, sign last ----
  try: {
    kicker: 'Start here',
    title: 'Try it first: nothing real moves',
    gist: 'Pick who plays your agents, then meet the practice shop. Two minutes, all in this window.',
    doneGist: 'Agent chosen and practice shop connected.',
    engineTitle: 'Pick who plays your agents',
    engineSub: 'The practice agent can play while you look around; switch any time.',
    practiceTitle: 'Meet the practice shop',
    practiceSub: 'A demo shop that is always open, sandbox money only.',
    // Honest: the mock (and Rust) open a deal only under signed rules (mock/backend.ts openTable).
    practiceHonest: 'Connecting it pins who you trade with, so its last confirm opens the secure window once. The practice deal itself starts as soon as your rules are signed.',
    stepDone: 'Done',
    stepNow: 'Now',
    stepLater: 'Next',
  },
  real: {
    kicker: 'Last',
    title: 'Make it real',
    gist: 'Sign your agents’ rules, then add your PayPal sandbox keys. Both happen in the secure window.',
    doneGist: 'Rules signed and keys saved.',
    explain: 'The next step opens a separate secure window. It is the only place that can sign rules or store keys; this window never can. Finish there and this line ticks itself.',
    go: (what: string): string => `Open the secure window: ${what}`,
    waiting: 'Waiting for the secure window…',
    waitingSub: 'This line ticks itself when that step is done there.',
    reopen: 'Reopen the secure window',
  },
} as const;
