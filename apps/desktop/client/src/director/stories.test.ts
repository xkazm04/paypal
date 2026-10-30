// The director's two stories: `?story=` picks one (Maya's week stays the default), First run's
// beat file follows the same rules as Maya's (beats.test.ts), and its frames open in the brand-new
// wallet's world so the sample week's storage is never touched.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActionKind } from './actions';
import { BEATS, CHAPTERS, SCRIPT_LENGTH } from './beats';
import { FIRST_RUN_BEATS, FIRST_RUN_CHAPTERS, FIRST_RUN_LENGTH } from './firstRunStory';
import { SAY_BEATS, SAY_CHAPTERS, SAY_EXPECT, SAY_LENGTH, SAY_PARTIAL, SAY_SENTENCE } from './sayStory';
import { read } from '../lib/say/read';
import { rulesOf } from '../lib/say/draft';
import { directorSearchFor, frameUrls, STORIES, storyFor } from './stories';

/** What a First run beat may do: open and close windows, set a Tumbler form, point the tour. */
const PRESENTATION: readonly ActionKind[] = ['main', 'approval', 'owner', 'form', 'tour'];

describe('choosing a story', () => {
  it('plays Maya’s week with no story, an empty one or an unknown one', () => {
    for (const q of ['', '?beat=3', '?story=', '?story=nope', '?story=MAYA']) {
      const s = storyFor(q);
      expect(s.id, q).toBe('maya');
      expect(s.beats).toBe(BEATS);
      expect(s.chapters).toBe(CHAPTERS);
      expect(s.length).toBe(SCRIPT_LENGTH);
      expect(s.firstRun).toBe(false);
    }
    expect(storyFor('?story=maya')).toBe(STORIES.maya);
  });

  it('plays First run with ?story=first-run', () => {
    const s = storyFor('?story=first-run&beat=2');
    expect(s.id).toBe('first-run');
    expect(s.title).toBe('First run');
    expect(s.beats).toBe(FIRST_RUN_BEATS);
    expect(s.firstRun).toBe(true);
  });

  it('keeps Maya’s frames where they were and puts First run’s in the first-run world', () => {
    const maya = frameUrls(STORIES.maya);
    expect(maya.main(null)).toBe('index.html');
    expect(maya.main('#d=D-0193')).toBe('index.html#d=D-0193');
    expect(maya.tumbler).toBe('tumbler.html?frame=director');
    expect(maya.approval('01ABC')).toBe('approval.html?deal=01ABC&target=deal');
    expect(maya.approval(null)).toBe('about:blank');
    const fr = frameUrls(STORIES['first-run']);
    expect(fr.main(null)).toBe('index.html?first_run=1');
    expect(fr.main('')).toBe('index.html?first_run=1');
    expect(fr.tumbler).toBe('tumbler.html?frame=director&first_run=1');
    expect(fr.owner).toBe('approval.html?first_run=1');
    expect(fr.approval(null)).toBe('about:blank');
  });

  it('puts First run’s own page in the first-run world, and leaves Maya’s address alone', () => {
    expect(directorSearchFor(STORIES.maya, '?beat=2')).toBeNull();
    // Maya's beats name her deals: a sized sample has none of them, so her page leaves it (#20)
    expect(directorSearchFor(STORIES.maya, '?scale=large&beat=2')).toBe('?beat=2');
    expect(directorSearchFor(STORIES.maya, '?scale=small')).toBe('');
    expect(frameUrls(STORIES.maya, 'large').main('#d=D-0193')).toBe('index.html#d=D-0193');
    expect(directorSearchFor(STORIES['first-run'], '?story=first-run&beat=2')).toBe('?story=first-run&beat=2&first_run=1');
    expect(directorSearchFor(STORIES['first-run'], '?story=first-run&first_run=1')).toBeNull();
  });
});

describe('the First run beat file', () => {
  it('is well-formed, ordered and about 60 to 100 seconds long', () => {
    expect(FIRST_RUN_BEATS[0]?.at).toBe(0);
    expect(new Set(FIRST_RUN_BEATS.map((b) => b.id)).size).toBe(FIRST_RUN_BEATS.length);
    for (let i = 1; i < FIRST_RUN_BEATS.length; i++) expect(FIRST_RUN_BEATS[i]!.at).toBeGreaterThan(FIRST_RUN_BEATS[i - 1]!.at);
    const order = FIRST_RUN_BEATS.map((b) => b.chapter).filter((c, i, a) => a[i - 1] !== c);
    expect(order).toEqual(FIRST_RUN_CHAPTERS.map((c) => c.id));
    expect(FIRST_RUN_LENGTH).toBeGreaterThanOrEqual(60);
    expect(FIRST_RUN_LENGTH).toBeLessThanOrEqual(100);
    for (const b of FIRST_RUN_BEATS) {
      expect(b.caption.length).toBeGreaterThan(10);
      expect(b.caption.length).toBeLessThanOrEqual(220);
      expect(b.do.length).toBeGreaterThan(0);
    }
  });

  it('gives a viewer enough time to read each caption (the beats.test rule)', () => {
    const all = [...FIRST_RUN_BEATS, { id: 'the end', at: FIRST_RUN_LENGTH, caption: '' }];
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]!;
      const words = prev.caption.split(/\s+/).length;
      expect(all[i]!.at - prev.at, prev.id).toBeGreaterThanOrEqual(Math.min(9, Math.ceil(words / 3.5)));
    }
  });

  it('captions speak plain words: no internals, no vendor names, no em dashes', () => {
    for (const b of FIRST_RUN_BEATS) {
      expect(b.caption, b.id).not.toMatch(/Rust|backend|mock|clause \d|\bD-\d{4}\b|_list|_query|UNAVAILABLE|tumbler:|attention|mandate|countersign|capture|void|first_run|scripted/i);
      // the engines are named by their ids only
      expect(b.caption.replace(/\b(claude-code|codex-cli)\b/g, ''), b.id).not.toMatch(/claude|codex|anthropic|openai/i);
      expect(b.caption, b.id).not.toMatch(/[—–]/);
    }
  });

  it('only opens windows, sets a Tumbler form and points the tour: no world, money or lock action', () => {
    for (const b of FIRST_RUN_BEATS) for (const a of b.do) {
      expect(PRESENTATION, `${b.id} → ${a.do}`).toContain(a.do);
      if (a.do === 'approval') expect(a.deal, b.id).toBeNull();
      if (a.do === 'main' && a.route) expect(a.route).toBe('');
    }
    expect(JSON.stringify(FIRST_RUN_BEATS)).not.toMatch(/countersign|capture|owner_accept|shield_release|rescue_approve|open_paypal|mandate_sign|unlock|deal_void|"lock"/i);
  });

  // Re-pinned deliberately (polish A): two beats were added inside the same 182 s - a module summary
  // (silence-tables) and the Rewind (end-rewind) - in gaps the reading-time rule already allowed.
  // Re-pinned again (demo-film hero): a Shopping around chapter of three beats after the opening
  // (+23 s for every later beat) and the dock's proof after end-table (+9 s more from end-rewind on).
  it('keeps Maya’s week at 214 s: 28 beats, with shopping around, a module summary, the proof and the Rewind among them', () => {
    expect(BEATS).toHaveLength(28);
    expect(SCRIPT_LENGTH).toBe(214);
    expect(BEATS.filter((b) => b.chapter === 'shop').map((b) => [b.id, b.at])).toEqual([['shop-ask', 9], ['shop-prices', 18], ['shop-rule', 24]]);
    expect(BEATS.find((b) => b.id === 'shop-ask')?.do).toContainEqual({ do: 'main', open: true, route: '#m=tables&v=shop' });
    expect(BEATS.find((b) => b.id === 'end-proof')?.do).toContainEqual({ do: 'main', open: true, route: '#d=D-0190&dv=proof' });
    expect(BEATS.findIndex((b) => b.id === 'end-proof')).toBe(BEATS.findIndex((b) => b.id === 'end-table') + 1);
    expect(BEATS.find((b) => b.id === 'silence-tables')?.do).toContainEqual({ do: 'main', open: true, route: '#m=tables' });
    expect(BEATS.find((b) => b.id === 'end-rewind')?.do).toContainEqual({ do: 'main', open: true, route: '#r=rewind' });
  });
});

describe('the Tumbler frame on the desk', () => {
  it('is transparent in both themes: its iframe sets no colour-scheme of its own', () => {
    // A frame whose colour-scheme differs from its page's is painted opaque white by the browser,
    // which hid the approval window and the tour's marks behind the Tumbler in the light theme.
    const css = readFileSync(resolve(process.cwd(), 'src/director/director.css'), 'utf8');
    const rule = css.split('\n').find((l) => l.startsWith('.dir-tum iframe'));
    expect(rule).toBeDefined();
    expect(rule).toContain('background: transparent');
    expect(rule).not.toContain('color-scheme');
  });
});

describe('the Say it story', () => {
  const NOW = Date.UTC(2026, 9, 30, 14, 2) / 1000;
  const ctx = { now: NOW, offsetMin: 0, payees: ['north-desk'] };

  it('is chosen with ?story=say and plays on Maya’s own sample week', () => {
    const s = storyFor('?story=say&beat=2');
    expect(s.id).toBe('say');
    expect(s.beats).toBe(SAY_BEATS);
    expect(s.chapters).toBe(SAY_CHAPTERS);
    expect(s.firstRun).toBe(false);
    expect(frameUrls(s).main('#r=rewind')).toBe('index.html#r=rewind');
    expect(directorSearchFor(s, '?story=say&beat=2')).toBeNull();
  });

  it('opens the approval window’s editor on a typed rules draft, never on a deal', () => {
    const u = frameUrls(STORIES.say).ownerRules({ type: 'rules', agent: 'negotiator' });
    expect(u).toMatch(/^approval\.html\?target=mandate&draft=/);
    expect(decodeURIComponent(u.split('draft=')[1] ?? '')).toBe('{"type":"rules","agent":"negotiator"}');
    expect(u).not.toContain('deal=');
  });

  it('is well-formed, ordered, readable and about a minute and a half', () => {
    expect(SAY_BEATS[0]?.at).toBe(0);
    expect(new Set(SAY_BEATS.map((b) => b.id)).size).toBe(SAY_BEATS.length);
    for (let i = 1; i < SAY_BEATS.length; i++) expect(SAY_BEATS[i]!.at).toBeGreaterThan(SAY_BEATS[i - 1]!.at);
    expect(SAY_BEATS.map((b) => b.chapter).filter((c, i, a) => a[i - 1] !== c)).toEqual(SAY_CHAPTERS.map((c) => c.id));
    expect(SAY_LENGTH).toBeGreaterThanOrEqual(60);
    expect(SAY_LENGTH).toBeLessThanOrEqual(100);
    const all = [...SAY_BEATS, { id: 'the end', at: SAY_LENGTH, caption: '' }];
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]!;
      expect(all[i]!.at - prev.at, prev.id).toBeGreaterThanOrEqual(Math.min(9, Math.ceil(prev.caption.split(/\s+/).length / 3.5)));
    }
    for (const b of SAY_BEATS) {
      expect(b.caption.length, b.id).toBeGreaterThan(10);
      expect(b.caption.length, b.id).toBeLessThanOrEqual(220);
    }
  });

  it('speaks plain words: no internals, no vendor names, no em dashes', () => {
    for (const b of SAY_BEATS) {
      expect(b.caption, b.id).not.toMatch(/Rust|backend|mock|clause \d|D-\d{4}|_list|_query|UNAVAILABLE|tumbler:|attention|mandate|countersign|capture|void|first_run|scripted|LLM|model/i);
      expect(b.caption, b.id).not.toMatch(/[—–]/);
    }
  });

  it('only says a sentence, points the camera, routes the window and opens the approval window: no world, money or lock action', () => {
    const allowed: readonly ActionKind[] = ['main', 'approval', 'owner', 'say', 'look'];
    for (const b of SAY_BEATS) for (const a of b.do) {
      expect(allowed, `${b.id} → ${a.do}`).toContain(a.do);
      if (a.do === 'approval') expect(a.deal, b.id).toBeNull();
      if (a.do === 'main') expect(a.route === undefined || a.route === '#r=rewind', b.id).toBe(true);
    }
    expect(JSON.stringify(SAY_BEATS)).not.toMatch(/countersign|capture|owner_accept|shield_release|rescue_approve|open_paypal|mandate_sign|unlock|deal_void|"lock"/i);
  });

  it('every beat has a settled screen to check, and none of them lets the approval window pay', () => {
    for (const b of SAY_BEATS) expect(SAY_EXPECT[b.id]?.length, b.id).toBeGreaterThan(0);
    expect(Object.keys(SAY_EXPECT).sort()).toEqual(SAY_BEATS.map((b) => b.id).sort());
  });

  it('the sentence reads as five solid parts, and the partial one asks instead of guessing', () => {
    const full = read(SAY_SENTENCE, ctx);
    for (const k of ['item', 'ceiling', 'ask', 'offers', 'ends'] as const) expect(full.from[k], k).toBe('said');
    expect(full.questions).toEqual([]);
    // "for 3 days" ends on the hour, never past what was said: 14:02 + 3 days is 14:00
    expect(full.facts.ends).toBe(Math.floor((NOW + 3 * 86400) / 3600) * 3600);
    expect(rulesOf(full, ctx)?.clauses.find((c) => c.type === 'human_present_over')).toMatchObject({ amount: { minor: 32000 } });
    const part = read(SAY_PARTIAL, ctx);
    expect(part.questions.map((q) => q.id)).toEqual(['ceiling']);
    expect(part.facts.ceiling).toBeNull();
  });
});
