// Putting a lagging recording back on the beat file's clock.
import { describe, expect, it } from 'vitest';
import { alignMarks, distinctChanges, placeRows, retimePlan, setptsExpr, type RetimePlan } from './retime';

/** Where raw second T lands in the output under a plan (what ffmpeg's setpts does). */
function place(plan: RetimePlan, t: number): number {
  const s = plan.segments.find((x) => t >= x.from && t < x.to) ?? plan.segments[plan.segments.length - 1]!;
  return s.at + (t - s.from) * s.speed;
}

describe('retiming a take', () => {
  // three beats at 0, 9 and 18 s, the take ends at 25; the recorder lags 2 s, then 5 s
  const input = { changes: [13.5, 25.5], beats: [0, 9, 18], end: 25, lead: 0.4, tail: 1.5, rawLength: 40 };

  it('puts every caption change back on its beat and cuts the lead-in', () => {
    const plan = retimePlan(input)!;
    expect(plan).not.toBeNull();
    expect(plan.cues).toEqual([0, 9.4, 18.4]);
    expect(plan.cut).toBe(4.1); // 13.5 - 9.4
    expect(place(plan, 13.5)).toBeCloseTo(9.4, 6);
    expect(place(plan, 25.5)).toBeCloseTo(18.4, 6);
    expect(plan.duration).toBeCloseTo(0.4 + 25 + 1.5, 6);
    expect(plan.end).toBeCloseTo(25.5 + (26.9 - 18.4), 6);
    expect(plan.drift).toEqual([0, 3]); // the second change came 3 s late against the first
    // first and last stretches keep their speed, the middle one plays faster to catch up
    expect(plan.segments.map((s) => s.speed)).toEqual([1, 0.75, 1]);
  });

  it('keeps the raw order of time and never runs past the recording', () => {
    const plan = retimePlan({ ...input, rawLength: 27 })!;
    expect(plan.end).toBe(27);
    let prev = -1;
    for (let t = plan.cut; t < plan.end; t += 0.25) {
      const out = place(plan, t);
      expect(out).toBeGreaterThan(prev);
      prev = out;
    }
  });

  it('gives up (null) when the captions do not match the beats one for one', () => {
    expect(retimePlan({ ...input, changes: [13.5] })).toBeNull();
    expect(retimePlan({ ...input, changes: [13.5, 25.5, 30, 31] })).toBeNull();
    expect(retimePlan({ ...input, changes: [5, 25.5] })).toBeNull(); // starts before the recording
    expect(retimePlan({ ...input, changes: [13.5, 50] })).toBeNull(); // a stretch warped past 2x
    expect(retimePlan({ ...input, beats: [0] , changes: [] })).toBeNull();
  });

  it('skips the loading line giving way to the first caption', () => {
    expect(retimePlan({ ...input, changes: [2.2, 13.5, 25.5] })).toEqual(retimePlan(input));
    expect(retimePlan({ ...input, changes: [0.2, 3.5, 13.5, 25.5] })).toEqual(retimePlan(input));
  });

  it('counts a caption fading over two frames as one change', () => {
    expect(distinctChanges([25.5, 13.5, 13.54, Number.NaN, 26.1, 40])).toEqual([13.5, 25.5, 40]);
    expect(retimePlan({ ...input, changes: [13.5, 13.58, 25.5] })?.cues).toEqual([0, 9.4, 18.4]);
  });

  it('writes the plan as one setpts expression over raw time', () => {
    const plan = retimePlan(input)!;
    expect(setptsExpr(plan)).toBe('if(lt(T,13.5),0+(T-4.1)*1,if(lt(T,25.5),9.4+(T-13.5)*0.75,18.4+(T-25.5)*1))');
  });
});

describe('finding each beat’s sync mark in a film take', () => {
  const frames = (level: number, n: number) => Array.from({ length: n }, () => level);

  it('finds each mark in beat order, where it first shows and how long it stays', () => {
    const levels = [...frames(235, 4), ...frames(48, 10), ...frames(57, 8), ...frames(66, 6)];
    expect(alignMarks(levels, [48, 57, 66])).toEqual([{ first: 4, last: 13 }, { first: 14, last: 21 }, { first: 22, last: 27 }]);
    // a frame or two of the right grey is noise, not the mark; a mark never seen is null
    expect(alignMarks([...frames(48, 2), ...frames(100, 3), ...frames(48, 3)], [48])).toEqual([{ first: 5, last: 7 }]);
    expect(alignMarks(frames(48, 10), [48, 139])).toEqual([{ first: 0, last: 9 }, null]);
  });

  it('never matches a beat on the frames of the beat before it, even when the two share a grey', () => {
    // syncShade repeats every 20 beats: beats 3 and 23 played one after the other (the rig jumps
    // through beat 22 in between) show the same grey, and the second must be found after the first
    const levels = [...frames(75, 30), ...frames(66, 8), ...frames(75, 20)];
    expect(alignMarks(levels, [75, 66, 75])).toEqual([{ first: 0, last: 29 }, { first: 30, last: 37 }, { first: 38, last: 57 }]);
    expect(alignMarks([...frames(75, 30), ...frames(235, 5), ...frames(75, 20)], [75, 75])).toEqual([{ first: 0, last: 29 }, { first: 35, last: 54 }]);
  });
});

describe('moving a film take’s rows onto the video’s clock', () => {
  const rows = [{ id: 'a', startMs: 1000, endMs: 4000, rects: {} }, { id: 'b', startMs: 5000, endMs: 9000, rects: {} }];

  it('shifts each row by where its mark showed, and ends it with its mark', () => {
    // 10 ms frames: a's mark at frames 150..349 (played at 1000 ms on the wall clock), b's at 400..900
    const r = placeRows(rows, [1000, 5000], [{ first: 150, last: 349 }, { first: 400, last: 900 }], 10);
    expect(r.rows).toEqual([{ id: 'a', startMs: 1500, endMs: 3499, rects: {} }, { id: 'b', startMs: 4000, endMs: 8000, rects: {} }]);
    expect(r.shifts).toEqual([500, -1000]);
    expect(r.missing).toEqual([]);
  });

  it('names a row whose mark was never found: its window is still on the wall clock', () => {
    const r = placeRows(rows, [1000, 5000], [{ first: 150, last: 349 }, null], 10);
    expect(r.missing).toEqual(['b']);
    expect(r.rows[1]).toBe(rows[1]);
    expect(r.shifts).toEqual([500]);
  });
});
