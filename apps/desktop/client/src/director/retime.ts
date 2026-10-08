// BROWSER PREVIEW ONLY. Puts a recorded take back on the beat file's clock.
//
// Chromium's screen recording falls behind real time when the machine is busy (measured: up to
// 7 s late by the end of the 2:51 story on a loaded 4-core host), so a raw webm does not keep the
// beats' timing. `scripts/takes.mjs` finds where each caption changes in the raw video and this
// module maps those moments back onto the times the beats really play: the stretches between two
// caption changes are sped up or slowed down to fit, the first and last stretch are only trimmed.
//
// Pure, no imports and only erasable TypeScript: the Node script loads this file directly.

/** One stretch of the raw video, [from, to) seconds, played from output second `at` at `speed`
 *  (output seconds per raw second: below 1 plays it faster). */
export type RetimeSegment = { from: number; to: number; at: number; speed: number };

export type RetimePlan = {
  segments: RetimeSegment[];
  /** Raw second the take starts at (the loading lead-in before it is cut). */
  cut: number;
  /** Raw second the take ends at. */
  end: number;
  /** Length of the retimed take, seconds. */
  duration: number;
  /** Output second each beat of the take starts at (the first beat: 0). */
  cues: number[];
  /** How late each caption change was in the raw recording, against the beat file, seconds. */
  drift: number[];
};

export type RetimeInput = {
  /** Raw-video seconds where the caption changed, as detected: one per beat after the first,
   *  possibly after a few before them (the recording's first frame, the loading line giving way
   *  to the first beat's caption). Nothing changes after the take's last beat. */
  changes: readonly number[];
  /** Scenario seconds of the take's beats, first beat first. */
  beats: readonly number[];
  /** Scenario second the take ends at (the next chapter's start, or the end of the story). */
  end: number;
  /** Seconds of the first beat, settled, before the story starts running. */
  lead: number;
  /** Seconds kept after the take's end. */
  tail: number;
  /** Length of the raw video, seconds. */
  rawLength: number;
};

/** Changes closer than this are one change seen twice (a caption fading across two frames). */
const SAME_CHANGE = 1;
/** A stretch played at more than twice or less than half its speed means the changes were
 *  matched to the wrong beats: give up rather than warp the take. */
const MAX_WARP = 2;

/** Drop detections that repeat an earlier one within a second, and anything out of order. */
export function distinctChanges(times: readonly number[]): number[] {
  const out: number[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (!Number.isFinite(t)) continue;
    if (last === undefined || t - last >= SAME_CHANGE) out.push(t);
  }
  return out;
}

/**
 * The retime plan, or null when the detected changes cannot be matched to the beats one for one
 * (then the take is only trimmed, and says so).
 */
export function retimePlan(input: RetimeInput): RetimePlan | null {
  const { beats, end, lead, tail, rawLength } = input;
  const k = beats.length - 1;
  const seen = distinctChanges(input.changes);
  const changes = seen.length > k ? seen.slice(seen.length - k) : seen;
  const a0 = beats[0];
  if (a0 === undefined || k < 1 || changes.length !== k) return null;
  // output second of each beat: the first at 0, the second after the lead and its own wait, ...
  const r = beats.map((a, i) => (i === 0 ? 0 : lead + (a - a0)));
  const total = lead + (end - a0) + tail;
  const c = [Number.NaN, ...changes];
  const segments: RetimeSegment[] = [];
  const c1 = c[1] as number;
  const r1 = r[1] as number;
  const cut = c1 - r1;
  if (cut < 0) return null; // the recording started after the story did: nothing to align to
  segments.push({ from: cut, to: c1, at: 0, speed: 1 });
  for (let i = 1; i < k; i++) {
    const from = c[i] as number;
    const to = c[i + 1] as number;
    const at = r[i] as number;
    const want = (r[i + 1] as number) - at;
    if (!(to > from) || !(want > 0)) return null;
    const speed = want / (to - from);
    if (speed > MAX_WARP || speed < 1 / MAX_WARP) return null;
    segments.push({ from, to, at, speed });
  }
  const ck = c[k] as number;
  const rk = r[k] as number;
  const last = Math.min(rawLength, ck + (total - rk));
  if (!(last > ck)) return null;
  segments.push({ from: ck, to: last, at: rk, speed: 1 });
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    segments: segments.map((s) => ({ from: round(s.from), to: round(s.to), at: round(s.at), speed: round(s.speed * 1e6) / 1e6 })),
    cut: round(cut),
    end: round(last),
    duration: round(rk + (last - ck)),
    cues: r.map(round),
    drift: changes.map((t, i) => round(t - cut - (r[i + 1] as number))),
  };
}

/**
 * The ffmpeg `setpts` expression for a plan, in seconds of raw time `T` (divide by TB for PTS):
 * each stretch maps raw T to `at + (T - from) * speed`.
 */
export function setptsExpr(plan: RetimePlan): string {
  const piece = (s: RetimeSegment) => `${s.at}+(T-${s.from})*${s.speed}`;
  const segs = plan.segments;
  const lastSeg = segs[segs.length - 1];
  if (!lastSeg) return 'PTS';
  let expr = piece(lastSeg);
  for (let i = segs.length - 2; i >= 0; i--) {
    const s = segs[i] as RetimeSegment;
    expr = `if(lt(T,${s.to}),${piece(s)},${expr})`;
  }
  return expr;
}
