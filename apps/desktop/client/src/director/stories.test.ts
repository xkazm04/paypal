// The director's two stories: `?story=` picks one (Maya's week stays the default), First run's
// beat file follows the same rules as Maya's (beats.test.ts), and its frames open in the brand-new
// wallet's world so the sample week's storage is never touched.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActionKind } from './actions';
import { BEATS, CHAPTERS, SCRIPT_LENGTH } from './beats';
import { FIRST_RUN_BEATS, FIRST_RUN_CHAPTERS, FIRST_RUN_LENGTH } from './firstRunStory';
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

  it('leaves Maya’s week as it was: 22 beats, the last caption ending at 182 s', () => {
    expect(BEATS).toHaveLength(22);
    expect(SCRIPT_LENGTH).toBe(182);
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
