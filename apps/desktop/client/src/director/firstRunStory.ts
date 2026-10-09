// BROWSER PREVIEW ONLY. "First run" as data: the onboarding played across the three windows on
// the `?first_run=1` world (a brand-new wallet, src/mock/firstRun.ts), so the sample week's stored
// state is never touched. Home shows the four getting-started steps with the agent app still to
// do (the practice agent is selected), and the tour's coach mark walks each window's stops.
//
// Same shape as Maya's week (beats.ts): a time, a caption in plain words, the window the camera
// follows, and actions (actions.ts). The tour moves by `{ do: 'tour' }`, which only says which stop
// a window's mark shows: nothing here clicks inside a window, presses Next, Back or Skip, signs,
// saves or pays.
import type { Action } from './actions';
import type { Beat, Chapter } from './beats';

export type FirstRunChapterId = 'start' | 'table' | 'tumbler' | 'approval' | 'end';

export const FIRST_RUN_CHAPTERS: readonly Chapter<FirstRunChapterId>[] = [
  { id: 'start', title: 'Day one' },
  { id: 'table', title: 'The Table' },
  { id: 'tumbler', title: 'The Tumbler' },
  { id: 'approval', title: 'The approval window' },
  { id: 'end', title: 'Ready for a first deal' },
];

const tour = (win: 'main' | 'tumbler' | 'approval', at: Extract<Action, { do: 'tour' }>['at']): Action => ({ do: 'tour', win, at });

export const FIRST_RUN_BEATS: readonly Beat<FirstRunChapterId>[] = [
  {
    id: 'start', chapter: 'start', at: 0, focus: 'desk',
    caption: 'Day one. Maya has just installed The Table: no PayPal keys, no signed rules, nobody connected. Three windows, and nothing can pay yet.',
    do: [
      { do: 'main', open: true, route: '' },
      { do: 'approval', deal: null },
      { do: 'form', form: 'rest' },
      tour('main', 'main.hub'),
    ],
  },
  {
    id: 'table-hub', chapter: 'table', at: 8, focus: 'main',
    caption: 'The tour starts by itself on Home. Four steps lead to a first safe deal, and the gold button always points to the next one.',
    do: [tour('main', 'main.hub')],
  },
  {
    id: 'table-promise', chapter: 'table', at: 16, focus: 'main',
    caption: 'The promise is on every screen: nothing pays without her or a rule she signed. Waiting never sends money.',
    do: [tour('main', 'main.promise')],
  },
  {
    id: 'table-steps', chapter: 'table', at: 22, focus: 'main',
    caption: 'Each step opens where it happens, in any order. A tick means it is done.',
    do: [tour('main', 'main.steps')],
  },
  {
    id: 'table-engine', chapter: 'table', at: 27, focus: 'main',
    caption: 'Step four, the agent app, is still to do. Until she picks claude-code or codex-cli, a practice agent plays for her.',
    do: [tour('main', 'main.engine')],
  },
  {
    id: 'table-approval', chapter: 'table', at: 34, focus: 'main',
    caption: 'Paying, saving her keys and signing rules happen in one other window. The Table only opens it.',
    do: [tour('main', 'main.approval')],
  },
  {
    id: 'tumbler-what', chapter: 'tumbler', at: 40, focus: 'tumbler',
    caption: 'The Tumbler is the small window that stays on her desk. On day one it greets her with the same steps.',
    do: [{ do: 'form', form: 'welcome' }, tour('tumbler', 'tumbler.what')],
  },
  {
    id: 'tumbler-needs', chapter: 'tumbler', at: 46, focus: 'tumbler',
    caption: 'A gold ring means something needs her. Each step here opens where it happens.',
    do: [tour('tumbler', 'tumbler.needs')],
  },
  {
    id: 'tumbler-engine', chapter: 'tumbler', at: 51, focus: 'tumbler',
    caption: 'The agent app is chosen in The Table. From here, that step only opens it.',
    do: [tour('tumbler', 'tumbler.engine')],
  },
  {
    id: 'tumbler-waiting', chapter: 'tumbler', at: 56, focus: 'tumbler',
    caption: 'And the rule that holds everywhere: if she does nothing, nothing is sent.',
    do: [tour('tumbler', 'tumbler.waiting')],
  },
  {
    id: 'approval-only', chapter: 'approval', at: 61, focus: 'approval',
    caption: 'The approval window is the only place that can approve a payment, save her PayPal keys or sign rules.',
    // the Tumbler goes back to its puck, so its welcome does not sit over the approval window
    do: [{ do: 'form', form: 'rest' }, { do: 'owner' }, tour('approval', 'approval.only')],
  },
  {
    id: 'approval-steps', chapter: 'approval', at: 67, focus: 'approval',
    caption: 'The same four steps. Keys and rules are one click here. The other two say where they happen.',
    do: [tour('approval', 'approval.steps')],
  },
  {
    id: 'approval-engine', chapter: 'approval', at: 73, focus: 'approval',
    caption: 'The agent app step is still to do here too. This window only shows which app her agents use.',
    do: [tour('approval', 'approval.engine')],
  },
  {
    id: 'approval-config', chapter: 'approval', at: 79, focus: 'approval',
    caption: 'Her wallet setup lives here as well. Nothing on this page pays anyone.',
    do: [tour('approval', 'approval.config')],
  },
  {
    id: 'end', chapter: 'end', at: 84, focus: 'desk',
    caption: 'That is the tour. It only points: it never clicks, signs or pays. Next, Maya connects PayPal sandbox, with test money only.',
    do: [
      { do: 'approval', deal: null },
      { do: 'main', open: true, route: '' },
      tour('main', null),
      tour('tumbler', null),
      tour('approval', null),
    ],
  },
];

/** How long the last caption stays before the story ends. */
export const FIRST_RUN_HOLD_LAST = 10;
export const FIRST_RUN_LENGTH = (FIRST_RUN_BEATS[FIRST_RUN_BEATS.length - 1]?.at ?? 0) + FIRST_RUN_HOLD_LAST;
