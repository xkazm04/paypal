// Honesty copy for the arena that sits beside lib/words/arena.ts (kept here so the page's claim about what
// is recorded and what is not can be read in one place). Rules as there: sentence case, no machinery names,
// no figure typed. Registry: demo-data-plane / fake-surface-honesty-contract (the fake surface says it is fake,
// at the top, in the place the viewer acts).

/** Near the top of the page: what PayPal is here, and what every answer is. */
export const ARENA_RECORDER = 'PayPal is a recorder on this page, not the real service. Every answer you see is the wallet’s recorded answer, played back. Nothing you do here is sent live.';

/** Where the note is typed. */
export const NOTE_HONEST = 'Your words stay on this page. They do not reach a wallet; the answers shown are recorded ones.';

/** A typed note the word-matcher read nothing in. */
export const NOTE_NOT_ANALYSED = 'Your note was not analysed in this preview. All that ran is a simple word match for amounts, paying, accepting, accounts and rule changes, and it found none. That does not mean the note is safe.';
/** The heading when nothing matched. */
export const NOTE_NONE_HEAD = 'Not analysed in this preview';
/** The heading over matches (they are word matches, not a reading). */
export const NOTE_MATCH_HEAD = 'Recorded attacks your words match';
/** The label over the sent message when the typed note matched nothing. */
export const NOTE_SENT_STAND_IN = 'The recorded note shown instead of yours';
/** What the typed note did get: kept in the sample week only. */
export const NOTE_KEPT = 'Your note was kept in the sample week. Maya can open it from the chip; it is shown only there, as unchecked words.';

/** Over the quoted text of a recorded attack that stands beside a typed note: it is the recorded attack's own text, never the visitor's words. */
export const NOTE_RECORDED_TEXT = 'The recorded attack text that matched, not your words';
