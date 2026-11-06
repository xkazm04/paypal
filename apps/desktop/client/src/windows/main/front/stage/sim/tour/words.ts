// Prototype strings for the TOUR simulated first project (spark abstract-first-home, round 3).
// Every count reaches these functions as an argument from useStart; no figure is typed here.
import type { StartStepKey } from '../../../../../../lib/words';
import type { MarkRegion } from './plan';

/** One coach mark: a short title and one or two plain sentences. */
export type MarkWords = { title: string; text: string };

/** The tour over the real home, region by region. */
export const MARK: Record<MarkRegion, MarkWords> = {
  status: {
    title: 'Your status line',
    text: 'The first line always says how things stand: is your money safe, and does anything need you. Read it and you know your day.',
  },
  need: {
    title: 'The one thing to do first',
    text: 'The one thing to do next always sits right under the status line. For a new wallet that is getting set up: four short steps, ticked off here as you go.',
  },
  'side-switcher': {
    title: 'Your six modules',
    text: 'Tables, Spend, Counter, Book, Shield and Rescue. Pick one to list only its items; All lists everything, the ones that need you first.',
  },
  'side-list': {
    title: 'One line per item',
    text: 'Empty for now: your deals land here as they start. Click a line and it opens in the middle as its own page; Esc brings you back to today.',
  },
  ask: {
    title: 'Ask anything',
    text: 'Type a question, like “what needs me?”. Answers land in the conversation and can open a page or filter the list. Press / to jump here.',
  },
};

/** What a finished step changed, said where it now lives (the mark after the step's page). */
export const AFTER: Record<StartStepKey, MarkWords> = {
  paypal: {
    title: 'Keys saved',
    text: 'Your PayPal sandbox keys are kept securely on this computer. Test money only. Setup goes on from here.',
  },
  rules: {
    title: 'Rules signed',
    text: 'Your agents now act only inside the rules you signed. Anything outside them comes to you first, and waiting never sends money.',
  },
  practice: {
    title: 'The house seller is connected',
    text: 'Its practice table opens in Tables: a practice deal shows up in this list as a line like any real one, marked as practice.',
  },
  engine: {
    title: 'Agent app chosen',
    text: 'Your agents run in it from now on, and it answers what you ask here. You can change it any time.',
  },
};

/** The setup page for each step (the Stage item-page pattern). */
export const PAGE: Record<StartStepKey, { short: string; why: string; how: string }> = {
  paypal: {
    short: 'PayPal keys',
    why: 'Your agents pay through PayPal sandbox: test money only, nothing real moves. Registering at developer.paypal.com gives you a sandbox business account and its two keys.',
    how: 'The keys go into the secure step, never into this page: nothing secret passes through the app’s pages.',
  },
  rules: {
    short: 'Rules',
    why: 'Rules say how much your agents may spend, with whom and when they must ask you. They cannot act outside them, and the wallet checks every move against them.',
    how: 'The secure step offers ready-made sets: pick one, check its limits, change what you like, then sign.',
  },
  practice: {
    short: 'Practice',
    why: 'The house seller is a demo shop built into the app and always open. A practice deal with it shows how a deal goes, with sandbox money.',
    how: 'Say where your money comes from, then connect. You confirm the connection in the secure step: four words that must match on both sides.',
  },
  engine: {
    short: 'Agent app',
    why: 'Your agents run in an app on this computer: claude-code or codex-cli. Until you choose one, a practice agent with fixed price rules plays for you.',
    how: 'Pick an installed app, or keep the practice agent for now and add one later.',
  },
};

export const TOUR_W = {
  label: 'Tour',
  dialog: 'First project tour',
  setup: 'Setup',
  today: 'Today',
  next: 'Next',
  back: 'Back',
  skip: 'Skip for now',
  skipTitle: 'Close the tour. Your progress is kept: “Continue setup” in the conversation picks it up again.',
  startSetup: 'Start setup',
  nextStep: (n: number, short: string): string => `Next: step ${n} · ${short}`,
  finish: 'Finish',
  later: 'Do this later',
  laterTitle: 'Leave this step for now and go on; it stays on your setup list',
  keys: 'Enter next · Esc skip',
  tourCount: (n: number, total: number): string => `${n} of ${total}`,
  setupCount: (done: number, total: number): string => `Setup ${done} of ${total} done`,
  stepOf: (n: number, total: number, short: string): string => `Step ${n} of ${total} · ${short}`,
  why: 'Why this step',
  doIt: 'Do it here',
  // the secure step, inline
  secureOpen: 'Open the secure step',
  secureOpenTitle: 'Opens the approval window’s own page right here, under this text',
  secureLoading: 'Opening the secure step…',
  houseJoin: 'Connect to the house seller',
  samplePayee: 'owner@example.com',
  houseWhat: 'House seller',
  secureLabel: 'Secure step',
  secureNote: 'In the app this is its own window',
  secureWhy: 'This is the approval window’s real page, framed here because this is the browser preview. Only it can save keys or sign rules; this page never can.',
  secureWaiting: 'Finish in the secure step below. The tour carries on by itself when it is done.',
  secureFrame: 'Secure step: the approval window',
  stepDone: (n: number, total: number): string => `Step ${n} of ${total} done`,
  // the conversation
  paused: (done: number, total: number): string => `Setup paused, ${done} of ${total} done. Pick it up whenever you like; nothing waits on it.`,
  continue: 'Continue setup',
  setupLead: 'Your first need is getting set up: four short steps, each on its own page. About three minutes.',
  setUp: 'You’re set up.',
  tourDone: 'That’s the tour.',
  setUpSub: 'Your wallet is ready for a first safe deal. Nothing can pay until you say so, and waiting never sends money.',
  almost: (done: number, total: number): string => `Tour done. Setup is ${done} of ${total}: the rest can wait.`,
  whereAgain: 'Where to find things again',
  again: [
    'The status line at the top says how things stand.',
    'The modules are on the right: one line per item, click to open it.',
    'The ask box at the bottom answers questions and opens pages.',
  ],
  retake: 'Take the tour again',
} as const;
