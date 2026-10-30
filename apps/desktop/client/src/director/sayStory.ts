// BROWSER PREVIEW ONLY. "Say it, then see it" as data (`director.html?story=say`): Maya says one sentence in
// The Table's Say it box and the same page shows what it means, from the week behind her through the gold
// "now" line into the next 72 hours, and how her two open tables for that monitor line up against it; then
// Review rules opens the approval window with the rules filled in. It plays on Maya's own sample week (the
// timeline's forecast and the tables come from her open deals).
//
// Same shape as the other stories (beats.ts): a time, a caption in plain words, the window the camera follows,
// and actions (actions.ts). Nothing here clicks inside a window, signs, saves or pays: a beat only says the
// sentence (the wallet reads it with a fixed word list, no AI), shows an answer to the question it asked, and
// opens the approval window on the rules it read, where the viewer would sign. The sentence ends "for 3 days",
// not "until Friday", so it means the same thing whichever day the preview is opened on.
import type { Beat, Chapter } from './beats';
import type { Expect } from './takes';

export type SayChapterId = 'say' | 'see' | 'ask' | 'hand';

export const SAY_CHAPTERS: readonly Chapter<SayChapterId>[] = [
  { id: 'say', title: 'Say it' },
  { id: 'see', title: 'See it' },
  { id: 'ask', title: 'When it is not sure' },
  { id: 'hand', title: 'You sign' },
];

/** The sentence. Three days from now, so it reads the same on any day. */
export const SAY_SENTENCE = 'Haggle for a monitor, up to $340, ask me above $320, six offers, for 3 days';
/** The same, with the most she will pay left out: the reader must ask, not guess. */
export const SAY_PARTIAL = 'Haggle for a monitor, ask me above $320, six offers, for 3 days';
/** Her answer to "which monitor?": the 27-inch 4K, the one with two open tables in her week. */
export const SAY_PICK: Readonly<Record<string, string>> = { 'item-which': 'monitor-27-4k' };

export const SAY_BEATS: readonly Beat<SayChapterId>[] = [
  {
    id: 'say-open', chapter: 'say', at: 0, focus: 'main',
    caption: 'Maya wants her agent to buy a monitor. She would rather say what she wants than fill in a form.',
    do: [{ do: 'say', text: '' }, { do: 'approval', deal: null }, { do: 'main', open: true, route: '#r=rewind' }],
  },
  {
    id: 'say-type', chapter: 'say', at: 6, focus: 'main',
    caption: 'She types one sentence. She could say it into the microphone instead. Her wallet reads it with a fixed word list: no AI is involved, and nothing is signed.',
    do: [{ do: 'say', text: SAY_SENTENCE }],
  },
  {
    id: 'say-pick', chapter: 'say', at: 16, focus: 'main',
    caption: 'Two monitors are open on her tables, so it asks which one she means. She taps the 27-inch 4K. Five parts she said stand out; what she left out is filled in safely, and marked.',
    do: [{ do: 'say', text: SAY_SENTENCE, answers: { ...SAY_PICK } }],
  },
  {
    id: 'see-ahead', chapter: 'see', at: 27, focus: 'main',
    caption: 'Below, the week behind her and the next three days. Past the gold Now line, dashed ticks show what happens if she walks away: nothing leaves, and two holds end on their own.',
    do: [],
  },
  {
    id: 'see-tables', chapter: 'see', at: 38, focus: 'main',
    caption: 'Her two open tables for that monitor, against her own numbers: the house seller at $312 is inside what her agent may do alone, and Dan at $329 is above $320, so it would stop and ask her.',
    do: [],
  },
  {
    id: 'see-rule', chapter: 'see', at: 49, focus: 'main',
    caption: 'Her new rule is drawn on the same hours. Until it ends, her agent could agree on its own up to $320. Above that, it asks her.',
    do: [],
  },
  {
    id: 'ask-partial', chapter: 'ask', at: 58, focus: 'main',
    caption: 'Say less, and it asks one question instead of guessing. The most she will pay stays a dashed, open part, and it is left out of the rules.',
    do: [{ do: 'say', text: SAY_PARTIAL, answers: { ...SAY_PICK } }],
  },
  {
    id: 'ask-done', chapter: 'ask', at: 69, focus: 'main',
    caption: 'She says it in full again, and the part is solid.',
    do: [{ do: 'say', text: SAY_SENTENCE, answers: { ...SAY_PICK } }],
  },
  {
    id: 'hand-review', chapter: 'hand', at: 75, focus: 'approval',
    caption: 'Review rules opens the approval window with every limit filled in. She changes anything she likes and signs there. The wallet never signs from the sentence.',
    do: [{ do: 'owner', rules: SAY_SENTENCE, answers: { ...SAY_PICK } }],
  },
  {
    id: 'hand-end', chapter: 'hand', at: 86, focus: 'desk',
    caption: 'One sentence, then what it means over the next three days. Waiting never sends money.',
    do: [],
  },
];

/** How long the last caption stays before the story ends. */
export const SAY_HOLD = 9;
export const SAY_LENGTH = (SAY_BEATS[SAY_BEATS.length - 1]?.at ?? 0) + SAY_HOLD;

const PAYS = /^\s*(pay|approve|accept|capture|release|confirm)\b/i;

/** What each beat's settled screen must show (the rehearsal rig, takes.ts). */
export const SAY_EXPECT: Readonly<Record<string, readonly Expect[]>> = {
  'say-open': [{ window: 'main', open: true }, { window: 'approval', open: false }, { in: 'main', text: 'Say a rule, then see it below' }],
  'say-type': [{ in: 'main', text: 'Which monitor do you mean?' }, { in: 'main', text: 'no AI involved' }],
  'say-pick': [{ in: 'main', text: 'Which monitor do you mean?', absent: true }, { in: 'main', text: 'Most you’ll pay' }, { in: 'main', text: 'I filled in' }],
  'see-ahead': [{ in: 'main', text: 'If you walk away' }, { in: 'main', text: '$0 leaves' }],
  'see-tables': [{ in: 'main', text: 'your agent could agree to this on its own' }, { in: 'main', text: 'so your agent would stop and ask you' }],
  'see-rule': [{ in: 'main', text: 'can agree up to $320 on its own' }],
  'ask-partial': [{ in: 'main', text: 'What’s the most you’ll pay for the 27-inch 4K monitor?' }],
  'ask-done': [{ in: 'main', text: 'What’s the most you’ll pay for the 27-inch 4K monitor?', absent: true }],
  'hand-review': [
    { window: 'approval', open: true },
    { in: 'approval', text: 'Filled in from what you said' },
    { in: 'approval', button: PAYS, absent: true },
  ],
  'hand-end': [{ window: 'main', open: true }],
};
