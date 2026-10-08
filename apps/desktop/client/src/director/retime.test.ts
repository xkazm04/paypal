// Putting a lagging recording back on the beat file's clock.
import { describe, expect, it } from 'vitest';
import { distinctChanges, retimePlan, setptsExpr, type RetimePlan } from './retime';

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
