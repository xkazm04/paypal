// The rehearsal rig's pure side: still names, chapter takes, the story date, and the per-beat
// end-state check that makes a broken beat fail before a take.
import { describe, expect, it } from 'vitest';
import { BEATS, CHAPTERS, SCRIPT_LENGTH, type Beat } from './beats';
import { HAGGLE, HOLD, MISMATCH } from './helpers';
import { BANNER, EXPECT, MOCK_BADGE, checkBeat, expectedDeals, selectChapter, slug, stillName, storyStartOn, takePlan, wholeTake, type Seen } from './takes';

const beat = (id: string, chapter: Beat['chapter']): Pick<Beat, 'id' | 'chapter'> => ({ id, chapter });

function seen(over: Partial<Seen> = {}): Seen {
  return {
    banner: BANNER,
    text: { main: `This week ${MOCK_BADGE}`, tumbler: MOCK_BADGE, approval: '' },
    buttons: { main: [], tumbler: [], approval: [] },
    open: { main: true, approval: false },
    states: { [HAGGLE]: 'NEGOTIATING', [MISMATCH]: 'NEGOTIATING', [HOLD]: 'AUTHORIZED' },
    ...over,
  };
}

describe('still names', () => {
  it('are NN-chapter-beat.png with the ?beat= index, never repeating the chapter', () => {
    expect(stillName(0, beat('intro', 'intro'))).toBe('00-intro.png');
    expect(stillName(4, beat('haggle-gate', 'haggle'))).toBe('04-haggle-gate.png');
    expect(stillName(12, beat('card', 'mismatch'))).toBe('12-mismatch-card.png');
    expect(stillName(7, beat('Silence Soon!', 'silence'), 'jpg')).toBe('07-silence-soon.jpg');
    expect(slug('  Maya’s week  ')).toBe('maya-s-week');
  });

  it('are unique, ordered and file-safe for the whole beat file', () => {
    const names = takePlan().beats.map((b) => b.still);
    expect(names).toHaveLength(BEATS.length);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);
    for (const n of names) expect(n).toMatch(/^\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.png$/);
    expect(names[0]).toBe('00-intro.png');
    expect(names.at(-1)).toBe(`${BEATS.length - 1}-end.png`);
  });
});

describe('chapter takes', () => {
  it('count chapters as the caption rail does, by number or id', () => {
    const haggle = selectChapter(1);
    expect(haggle?.chapter.id).toBe('haggle');
    expect(selectChapter('1')).toEqual(haggle);
    expect(selectChapter('haggle')).toEqual(haggle);
    expect(selectChapter(' haggle ')).toEqual(haggle);
    expect(selectChapter(0)?.chapter.id).toBe('intro');
    expect(selectChapter(CHAPTERS.length)).toBeNull();
    expect(selectChapter('nope')).toBeNull();
    expect(selectChapter(-1)).toBeNull();
  });

  it('cover a chapter’s beats and run until the next chapter starts', () => {
    const h = selectChapter('haggle');
    const ids = BEATS.slice(h?.first, (h?.last ?? 0) + 1).map((b) => b.id);
    expect(ids.every((id) => id.startsWith('haggle-'))).toBe(true);
    expect(h?.from).toBe(BEATS[h?.first ?? 0]?.at);
    expect(h?.to).toBe(BEATS[(h?.last ?? 0) + 1]?.at);
    const last = selectChapter(CHAPTERS.length - 1);
    expect(last?.last).toBe(BEATS.length - 1);
    expect(last?.to).toBe(SCRIPT_LENGTH);
    // the chapters tile the whole story with no gap
    let at = 0;
    for (let n = 0; n < CHAPTERS.length; n++) {
      const c = selectChapter(n);
      expect(c?.from).toBe(at);
      at = c?.to ?? NaN;
    }
    expect(at).toBe(wholeTake().to);
    expect(wholeTake()).toEqual({ first: 0, last: BEATS.length - 1, from: 0, to: SCRIPT_LENGTH });
  });
});

describe('the story date', () => {
  it('starts at 14:02:04 local on the given day, or today when the day is not real', () => {
    const today = new Date(2026, 9, 8, 9, 30);
    const at = new Date(storyStartOn('2026-11-05', today) * 1000);
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes(), at.getSeconds()]).toEqual([2026, 10, 5, 14, 2, 4]);
    for (const bad of [null, undefined, '', '2026-02-30', '5 Nov', '2026-13-01']) {
      const d = new Date(storyStartOn(bad, today) * 1000);
      expect([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([9, 8, 14, 2]);
    }
  });
});

describe('each beat’s end state', () => {
  it('is written for every beat, and names only deals of the story', () => {
    for (const b of BEATS) expect(EXPECT[b.id]?.length, b.id).toBeGreaterThan(0);
    expect(Object.keys(EXPECT).sort()).toEqual(BEATS.map((b) => b.id).sort());
    expect(expectedDeals().sort()).toEqual([HOLD, HAGGLE, MISMATCH].sort());
  });

  it('passes when the stage shows it and names what is missing when it does not', () => {
    expect(checkBeat('intro', seen())).toEqual([]);
    expect(checkBeat('intro', seen({ text: { main: MOCK_BADGE, tumbler: MOCK_BADGE, approval: '' } }))).toEqual(['The Table should show “This week”']);
    expect(checkBeat('intro', seen({ open: { main: true, approval: true }, text: { main: `This week ${MOCK_BADGE}`, tumbler: MOCK_BADGE, approval: MOCK_BADGE } })))
      .toEqual(['the approval window should be closed']);
    expect(checkBeat('intro', seen({ states: { [HAGGLE]: 'WITHDRAWN', [MISMATCH]: 'NEGOTIATING' } }))).toEqual([`${HAGGLE} should be NEGOTIATING, is WITHDRAWN`]);
    expect(checkBeat('nope', seen())).toEqual(['no expected end state is written for beat “nope”']);
  });

  it('folds whitespace in text and fails on a pay button the Tumbler must not have', () => {
    const card = (buttons: string[]) => seen({ text: { main: MOCK_BADGE, tumbler: `Review and decide Withdraw ${MOCK_BADGE}`, approval: '' }, buttons: { main: [], tumbler: buttons, approval: [] } });
    expect(checkBeat('haggle-card', card(['Review and decide ↗', 'Withdraw']))).toEqual([]);
    expect(checkBeat('haggle-card', card(['Review and decide ↗', 'Pay $329.00']))).toEqual([
      'the Tumbler should offer a button like /^Withdraw\\b/',
      'the Tumbler should offer no button like /^\\s*(pay|approve|accept|capture|release|confirm)\\b/i, offers “Pay $329.00”',
    ]);
    // a held request's card: its sentence wraps across lines, and it may only offer to show why
    const held = (buttons: string[]) => seen({
      text: { main: MOCK_BADGE, tumbler: `Amount didn’t match:\n  asked $339.00,   agreed $329.00 ${MOCK_BADGE}`, approval: '' },
      buttons: { main: [], tumbler: buttons, approval: [] },
    });
    expect(checkBeat('mismatch-card', held(['See why ↗']))).toEqual([]);
    expect(checkBeat('mismatch-card', held(['See why ↗', 'Withdraw']))).toEqual(['the Tumbler should offer no button like /^Withdraw\\b/, offers “Withdraw”']);
  });

  it('always wants the preview banner and a badge in every open window', () => {
    expect(checkBeat('intro', seen({ banner: '' }))).toEqual(['the preview banner is missing']);
    expect(checkBeat('intro', seen({ text: { main: 'This week', tumbler: '', approval: '' } }))).toEqual([
      `The Table shows no “${MOCK_BADGE}” badge`,
      `the Tumbler shows no “${MOCK_BADGE}” badge`,
    ]);
    // a closed window needs no badge, an open one does
    const closed = checkBeat('closed-table', seen({ open: { main: false, approval: false }, text: { main: '', tumbler: `The Table is closed ${MOCK_BADGE}`, approval: '' } }));
    expect(closed).toEqual([]);
  });

  it('wants the haggle’s review to be a live decision and the mismatch’s to have no way to pay', () => {
    const review = (approval: string, buttons: string[]) =>
      checkBeat('haggle-review', seen({ open: { main: true, approval: true }, text: { main: MOCK_BADGE, tumbler: MOCK_BADGE, approval: `Accept the offer from Dan ${approval} ${MOCK_BADGE}` }, buttons: { main: [], tumbler: [], approval: buttons } }));
    expect(review('Checked by your wallet 4 passed', ['Withdraw', 'Hold the button down for a moment: Hold to approve $329.00'])).toEqual([]);
    expect(review('Checked by your wallet 3 passed 1 failed', ['Withdraw'])).toHaveLength(2);
    const mismatch = checkBeat('mismatch-review', seen({
      open: { main: true, approval: true },
      text: { main: MOCK_BADGE, tumbler: MOCK_BADGE, approval: `Nothing can be paid. ${MOCK_BADGE}` },
      buttons: { main: [], tumbler: [], approval: ['Close this window', 'Approve anyway'] },
      states: { [MISMATCH]: 'MISMATCH' },
    }));
    expect(mismatch).toEqual(['the approval window should offer no button like /^\\s*(pay|approve|accept|capture|release|confirm)\\b/i, offers “Approve anyway”']);
  });
});
