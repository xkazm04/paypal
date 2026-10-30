// BROWSER PREVIEW ONLY. The director's stories, chosen by `director.html?story=<id>`: Maya's week
// (the default, beats.ts), First run (firstRunStory.ts) and Watch the haggle (watchStory.ts, on Maya's
// week). A story says which mock world its frames open in, so First run plays on the `?first_run=1`
// world and the sample week's storage stays as it was. Pure: the page's search string goes in, the story and the frames' addresses come out.
import { FIRST_RUN_PARAM, SCALE_PARAM, scalePreview, withFirstRun } from '../mock/firstRun';
import type { ScaleName } from '../lib/preview';
import { BEATS, CHAPTERS, SCRIPT_LENGTH, type Beat, type Chapter } from './beats';
import { FIRST_RUN_BEATS, FIRST_RUN_CHAPTERS, FIRST_RUN_LENGTH } from './firstRunStory';
import { SAY_BEATS, SAY_CHAPTERS, SAY_EXPECT, SAY_LENGTH } from './sayStory';
import { EXPECT, FIRST_RUN_EXPECT, WATCH_EXPECT, type Expect } from './takes';
import { WATCH_BEATS, WATCH_CHAPTERS, WATCH_LENGTH } from './watchStory';

export const STORY_PARAM = 'story';
export type StoryId = 'maya' | 'first-run' | 'watch' | 'say';

export type Story = {
  id: StoryId;
  title: string;
  beats: readonly Beat<string>[];
  chapters: readonly Chapter<string>[];
  /** Seconds from the first beat to the end of the last caption. */
  length: number;
  /** Each beat's settled end state, for the rehearsal (takes.ts). */
  expect: Readonly<Record<string, readonly Expect[]>>;
  /** The frames open in the brand-new wallet's world (`?first_run=1`), not the sample week. */
  firstRun: boolean;
};

export const STORIES: Readonly<Record<StoryId, Story>> = {
  maya: { id: 'maya', title: 'Maya’s week', beats: BEATS, chapters: CHAPTERS, length: SCRIPT_LENGTH, expect: EXPECT, firstRun: false },
  'first-run': { id: 'first-run', title: 'First run', beats: FIRST_RUN_BEATS, chapters: FIRST_RUN_CHAPTERS, length: FIRST_RUN_LENGTH, expect: FIRST_RUN_EXPECT, firstRun: true },
  watch: { id: 'watch', title: 'Watch the haggle', beats: WATCH_BEATS, chapters: WATCH_CHAPTERS, length: WATCH_LENGTH, expect: WATCH_EXPECT, firstRun: false },
  // Say it, then see it plays on Maya's own sample week (it needs her deals for the timeline's forecast).
  say: { id: 'say', title: 'Say it, then see it', beats: SAY_BEATS, chapters: SAY_CHAPTERS, length: SAY_LENGTH, expect: SAY_EXPECT, firstRun: false },
};

const isStoryId = (v: string | null): v is StoryId => v !== null && (Object.keys(STORIES) as string[]).includes(v);

/** The story a director page plays: `?story=first-run`, or Maya's week when there is none (or an unknown one). */
export function storyFor(search: string = typeof location === 'undefined' ? '' : location.search): Story {
  let id: string | null = null;
  try {
    id = new URLSearchParams(search).get(STORY_PARAM);
  } catch {
    id = null;
  }
  return isStoryId(id) ? STORIES[id] : STORIES.maya;
}

/** The framed windows' addresses for a story: in the first-run world they all carry `first_run=1`.
 *  Maya's week plays on her own sample week: its beats name her deals ("D-0193"), which a sized
 *  sample (`?scale=`) does not have, so its frames never open in one (scale finding #20). */
export function frameUrls(story: Pick<Story, 'firstRun'>, scale: ScaleName | null = scalePreview()) {
  const w = (page: string) => withFirstRun(page, story.firstRun, story.firstRun ? scale : null);
  return {
    main: (route: string | null) => w(`index.html${route ?? ''}`),
    tumbler: w('tumbler.html?frame=director'),
    approval: (dealId: string | null) => (dealId ? w(`approval.html?deal=${encodeURIComponent(dealId)}&target=deal`) : 'about:blank'),
    /** The approval window on the owner's setup (no deal). */
    owner: w('approval.html'),
    /** The approval window's editor, opened on a typed rules draft (what Review rules hands over). */
    ownerRules: (draft: unknown) => w(`approval.html?target=mandate&draft=${encodeURIComponent(JSON.stringify(draft))}`),
  };
}

/**
 * The director page's own address for a story: the mock core it holds reads its world from the
 * page's search, so a first-run story's page carries `first_run=1` too. Null when it already does.
 */
export function directorSearchFor(story: Pick<Story, 'firstRun'>, search: string): string | null {
  const q = new URLSearchParams(search);
  if (!story.firstRun) {
    // Maya's week names her deals: the page's own mock core plays it on her week, never on a
    // sized sample (scale finding #20: "no deal D-0193").
    if (!q.has(SCALE_PARAM)) return null;
    q.delete(SCALE_PARAM);
    const rest = q.toString();
    return rest ? `?${rest}` : '';
  }
  if (q.get(FIRST_RUN_PARAM) === '1') return null;
  q.set(FIRST_RUN_PARAM, '1');
  return `?${q}`;
}
