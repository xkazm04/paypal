// Pairing, Main side (prototype/pages/pairing/variant-1, "Two desks"): the step a pairing is at,
// as Main can know it. Main sees the code (pairing_create), the words (pairing_join / poll) and
// hands confirmation to the approval window (approval_open({pairing})). Pinning happens there; Rust
// tells Main afterwards with the `pairing:pinned` event, and only then is the Pin step done here.

export type PairMode = 'create' | 'join' | 'house';

/** idle: nothing sent · code: our code is out, polling · words: the four words arrived. */
export type PairPhase = 'idle' | 'code' | 'words';

export type StepState = 'todo' | 'on' | 'done' | 'elsewhere';
export type Step = { label: 'Code' | 'Words' | 'Pin'; state: StepState };

export function pairPhase(hasOffer: boolean, hasWords: boolean): PairPhase {
  if (hasWords) return 'words';
  return hasOffer ? 'code' : 'idle';
}

/** Code › Words › Pin. For join and HOUSE the "code" is the other side's code or the release pin;
 *  it reads done once words arrive. Pin happens in the approval window ("elsewhere") and is done
 *  only once Rust's `pairing:pinned` event for these words arrived. */
export function pairSteps(phase: PairPhase, pinned = false): Step[] {
  return [
    { label: 'Code', state: phase === 'words' ? 'done' : 'on' },
    { label: 'Words', state: pinned ? 'done' : phase === 'words' ? 'on' : 'todo' },
    { label: 'Pin', state: pinned ? 'done' : 'elsewhere' },
  ];
}

/** While words are on screen, switching mode would drop them: other tabs are disabled. */
export function modeLocked(phase: PairPhase, mode: PairMode, candidate: PairMode): boolean {
  return phase !== 'idle' && candidate !== mode;
}

/** The trimmed code, or null when the field is empty. Codes are passed to Rust as typed (trimmed);
 *  Rust decides validity, Main never rewrites a code. */
export function joinCode(raw: string): string | null {
  const c = raw.trim();
  return c ? c : null;
}

/** Can the primary act run? (Main validates presence only; Rust validates content.) */
export function canSubmit(mode: PairMode, fields: { payee: string; code: string }, house: 'unavailable' | 'idle' | 'waking' | 'ready'): boolean {
  if (!fields.payee.trim()) return false;
  if (mode === 'join') return joinCode(fields.code) !== null;
  if (mode === 'house') return house !== 'unavailable' && house !== 'waking';
  return true;
}

// ---- the wizard (docs/ux/ROUND-1.md): three large panels, one active at a time -----------------

export type WizardKey = 'code' | 'words' | 'confirm';
export type WizardState = 'todo' | 'on' | 'done';

/** Share a code › Match 4 words › Confirm. `matched` is only the owner's own "all four match" click
 *  on this screen (display only: nothing is pinned by it); `pinned` is Rust's pairing:pinned event. */
export function wizardSteps(phase: PairPhase, matched: boolean, pinned: boolean): { key: WizardKey; state: WizardState }[] {
  const words = phase === 'words';
  return [
    { key: 'code', state: words || pinned ? 'done' : 'on' },
    { key: 'words', state: pinned || (words && matched) ? 'done' : words ? 'on' : 'todo' },
    { key: 'confirm', state: pinned ? 'done' : words && matched ? 'on' : 'todo' },
  ];
}

export type PairAnswer = { tone: 'calm' | 'need' | 'done'; title: string; sub: string };

/** The one sentence at the top of the Connections sheet: where the connection stands. */
export function pairAnswer(mode: PairMode, phase: PairPhase, matched: boolean, pinned: boolean): PairAnswer {
  if (pinned) return { tone: 'done', title: 'You’re connected', sub: 'You can open a table now. No money moved.' };
  if (phase === 'words' && matched) return { tone: 'need', title: 'Confirm in the approval window', sub: 'Only you can confirm there. Until you do, nobody is connected.' };
  if (phase === 'words') return { tone: 'need', title: 'Match the four words with them', sub: 'If all four match, go on. If even one differs, stop.' };
  if (phase === 'code') return { tone: 'calm', title: 'Waiting for them to type your code', sub: 'Give them only the code. You match four words next.' };
  if (mode === 'join') return { tone: 'calm', title: 'Type the code they gave you', sub: 'You match four words next. No money moves while connecting.' };
  if (mode === 'house') return { tone: 'calm', title: 'Connect with the house seller', sub: 'A practice shop that is always there. No money moves while connecting.' };
  return { tone: 'calm', title: 'Connect with another wallet', sub: 'Make a code and give it to them. No money moves while connecting.' };
}

// ---- round 2 (r2-connect): the mirror and the word ticks ---------------------------------------
// Display only. Ticking a word pins nothing and sends nothing: the owner's own "I see this too" per
// word, so "All four match" cannot be pressed on a glance. Pinning still happens only in the approval
// window (approval_open / pairing_confirm there), and pairing:pinned is still what marks Confirm done.

/** One flag per word: has the owner seen this word on the other screen too? */
export type Ticks = readonly boolean[];

export const newTicks = (count = 4): Ticks => Array.from({ length: Math.max(0, count) }, () => false);

/** Flip one word's tick. An index outside the words changes nothing. */
export function toggleTick(ticks: Ticks, i: number): Ticks {
  if (!Number.isInteger(i) || i < 0 || i >= ticks.length) return ticks;
  return ticks.map((t, k) => (k === i ? !t : t));
}

export const ticksDone = (ticks: Ticks): number => ticks.filter(Boolean).length;

/** "All four match" enables only when every word is ticked (and there are words to tick). */
export const allTicked = (ticks: Ticks): boolean => ticks.length > 0 && ticks.every(Boolean);

/** "Tick each word you see" / "2 of 4 seen" / "All 4 seen". */
export function tickProgress(ticks: Ticks): string {
  const n = ticks.length;
  const d = ticksDone(ticks);
  if (n === 0) return '';
  if (d === 0) return 'Tick each word you see on their screen';
  return d === n ? `All ${n} seen` : `${d} of ${n} seen`;
}

/** What each tile says. The house has no screen of its own: its words are in the approval window. */
export const tickLabel = (mode: PairMode): string => (mode === 'house' ? 'Same in approval window' : 'I see this too');

/** Where the other side is, for the mirror beside the wizard. */
export type MirrorStage = 'start' | 'code' | 'words' | 'confirm' | 'done';

export function mirrorStage(mode: PairMode, phase: PairPhase, matched: boolean, pinned: boolean): MirrorStage {
  if (pinned) return 'done';
  if (phase === 'words') return matched ? 'confirm' : 'words';
  return mode === 'create' && phase === 'code' ? 'code' : 'start';
}

export type Mirror = { title: string; line: string };

/** What the other person should be looking at, in one calm line each. It describes what the steps
 *  lead to; it does not claim to know what they have done (Main cannot see their screen). */
export function mirrorText(mode: PairMode, stage: MirrorStage): Mirror {
  if (mode === 'house') {
    if (stage === 'words') return { title: 'The house has no screen', line: 'It shows the same four words in your approval window.' };
    if (stage === 'confirm') return { title: 'Your approval window', line: 'You check the house’s words there. Nothing else to do on its side.' };
    if (stage === 'done') return { title: 'Connected with the house', line: 'It is a practice shop, so it only ever sells to you.' };
    return { title: 'The house has no screen', line: 'It answers by itself, so there is nobody to read words to.' };
  }
  switch (stage) {
    case 'start': return mode === 'join'
      ? { title: 'They are waiting for you', line: 'When you join, their screen shows four words.' }
      : { title: 'Nothing yet', line: 'After you share the code, they choose “I have a code” and type it.' };
    case 'code': return { title: 'A box for your code', line: 'They type it, and four words appear on both screens.' };
    case 'words': return { title: 'The same four words', line: 'In the same order. If one differs, stop.' };
    case 'confirm': return { title: 'They confirm too', line: 'Each of you confirms in your own approval window.' };
    case 'done': return { title: 'Connected on your side', line: 'They are connected once they confirm in their own window.' };
  }
}
